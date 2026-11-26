import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkRateLimit, getClientIp } from '../_shared/rateLimiter.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_MARKDOWN_CHARS = 120_000

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeRoles(value: unknown, primaryRole: string): string[] {
  const available = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
  return Array.from(new Set([primaryRole, ...available].filter(Boolean)))
}

function sanitizeSecret(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^["']|["']$/g, '').trim()
}

/**
 * Verifica que la salida del modelo contenga un objeto JSON completo y parseable
 * antes de enviarlo al docente (evita respuestas truncadas o texto de razonamiento).
 */
function extractCleanJsonObject(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const tryParse = (candidate: string): string | null => {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed)
      }
    } catch {
      try {
        const sanitized = candidate.replace(/,\s*([}\]])/g, '$1')
        const parsed = JSON.parse(sanitized)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return JSON.stringify(parsed)
        }
      } catch {
        return null
      }
    }
    return null
  }

  const direct = tryParse(trimmed)
  if (direct) return direct

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const res = tryParse(match[1].trim())
    if (res) return res
  }

  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) {
    return tryParse(trimmed.slice(first, last + 1))
  }

  return null
}

type ProviderAttemptLog = {
  provider: string
  model: string
  status: number | string
  detail: string
}

async function callGemini(
  apiKey: string,
  userMessage: string,
  attempts: ProviderAttemptLog[],
): Promise<{ rawJson: string; provider: string } | null> {
  const preferred = sanitizeSecret(Deno.env.get('EVALUEDU_GEMINI_MODEL'))
  const candidates = Array.from(
    new Set(
      [
        preferred,
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-flash-latest',
        'gemini-3.8-flash',
        'gemini-flash-lite-latest',
      ].filter(Boolean),
    ),
  )

  for (const model of candidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
        }),
      })

      if (!resp.ok) {
        const errText = (await resp.text()).slice(0, 220)
        console.error(`[teacher-document-analyze] Gemini ${model} HTTP ${resp.status}: ${errText}`)
        attempts.push({ provider: 'gemini', model, status: resp.status, detail: errText.slice(0, 140) })
        const low = errText.toLowerCase()
        if (resp.status === 401 || resp.status === 403 || low.includes('api key not valid') || low.includes('api_key')) {
          break
        }
        continue
      }

      const data = await resp.json()
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
      const cleanJson = typeof rawText === 'string' ? extractCleanJsonObject(rawText) : null
      if (cleanJson) {
        return { rawJson: cleanJson, provider: `Google Gemini (${model})` }
      }
      console.error(`[teacher-document-analyze] Gemini ${model} devolvió JSON inválido/truncado`)
      attempts.push({ provider: 'gemini', model, status: 200, detail: 'JSON inválido o truncado' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[teacher-document-analyze] Gemini ${model} error: ${msg}`)
      attempts.push({ provider: 'gemini', model, status: 'exception', detail: msg.slice(0, 140) })
    }
  }

  return null
}

async function callNvidiaNim(
  apiKey: string,
  userMessage: string,
  attempts: ProviderAttemptLog[],
): Promise<{ rawJson: string; provider: string } | null> {
  const preferred = sanitizeSecret(Deno.env.get('EVALUEDU_NVIDIA_MODEL'))
  // Priorizamos modelos directos rápidos y precisos en español y JSON (evitando tokens gastados en cadena de pensamiento)
  const candidates: Array<{ model: string; disableThinking?: boolean; useJsonFormat?: boolean }> = [
    ...(preferred ? [{ model: preferred, useJsonFormat: true }] : []),
    { model: 'mistralai/mistral-large-4-1t-a52b', useJsonFormat: true },
    { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', disableThinking: true, useJsonFormat: true },
    { model: 'google/gemma-3-12b-it', useJsonFormat: false },
    { model: 'z-ai/glm-5.3-flash', disableThinking: true, useJsonFormat: true },
  ]

  const seen = new Set<string>()
  for (const cfg of candidates) {
    if (seen.has(cfg.model)) continue
    seen.add(cfg.model)

    try {
      const reqBody: Record<string, unknown> = {
        model: cfg.model,
        messages: [
          {
            role: 'system',
            content:
              'Eres un especialista en evaluación universitaria para la plataforma EvaluEdu. Responde EXCLUSIVAMENTE con el objeto JSON válido y completo solicitado por el usuario, sin texto introductorio, sin explicaciones y sin etiquetas markdown.',
          },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }

      if (cfg.useJsonFormat) {
        reqBody.response_format = { type: 'json_object' }
      }
      if (cfg.disableThinking) {
        reqBody.chat_template_kwargs = { enable_thinking: false }
      }

      const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(40_000),
        body: JSON.stringify(reqBody),
      })

      if (!resp.ok) {
        const errText = (await resp.text()).slice(0, 220)
        console.error(`[teacher-document-analyze] NVIDIA ${cfg.model} HTTP ${resp.status}: ${errText}`)
        attempts.push({ provider: 'nvidia', model: cfg.model, status: resp.status, detail: errText.slice(0, 140) })
        if (resp.status === 401 || resp.status === 403) {
          break
        }
        continue
      }

      const data = await resp.json()
      const content = data?.choices?.[0]?.message?.content
      const finishReason = data?.choices?.[0]?.finish_reason
      const cleanJson = typeof content === 'string' ? extractCleanJsonObject(content) : null

      if (cleanJson) {
        return { rawJson: cleanJson, provider: `NVIDIA NIM (${cfg.model})` }
      }

      console.error(
        `[teacher-document-analyze] NVIDIA ${cfg.model} JSON inválido/truncado (finish_reason=${String(finishReason)}, len=${typeof content === 'string' ? content.length : 0})`,
      )
      attempts.push({
        provider: 'nvidia',
        model: cfg.model,
        status: 200,
        detail: `JSON inválido/truncado (finish_reason=${String(finishReason)})`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[teacher-document-analyze] NVIDIA ${cfg.model} error: ${msg}`)
      attempts.push({ provider: 'nvidia', model: cfg.model, status: 'exception', detail: msg.slice(0, 140) })
    }
  }

  return null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405)

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!token || !supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json({ ok: false, error: 'Configuración de autenticación incompleta.' }, 401)
  }

  // 1. Verificar sesión docente autenticada (cero acceso anónimo o estudiantil)
  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: authData, error: authError } = await callerClient.auth.getUser(token)
  if (authError || !authData.user) {
    return json({ ok: false, error: 'Sesión no válida.' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role, roles')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return json({ ok: false, error: 'No se encontró el perfil docente autorizado.' }, 403)
  }

  const userRoles = normalizeRoles(profile.roles, String(profile.role ?? ''))
  if (!userRoles.includes('teacher') && !userRoles.includes('admin') && !userRoles.includes('superadmin')) {
    return json({ ok: false, error: 'Solo docentes autorizados pueden importar documentos.' }, 403)
  }

  // 2. Rate limiting con presupuesto oficial del repositorio
  const rate = checkRateLimit('general', getClientIp(request), authData.user.id)
  if (!rate.allowed) {
    return json(
      { ok: false, error: `Demasiadas solicitudes seguidas. Intenta de nuevo en ${rate.retryAfter} s.` },
      429,
    )
  }

  // 3. Leer payload de Markdown limpio (el archivo pesado nunca sale del dispositivo del docente)
  let body: { markdown?: unknown; prompt?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Cuerpo JSON inválido.' }, 400)
  }

  const markdown = typeof body.markdown === 'string' ? body.markdown.trim() : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!markdown || !prompt) {
    return json({ ok: false, error: 'Falta el contenido del documento o las instrucciones pedagógicas.' }, 400)
  }

  const safeMarkdown = markdown.slice(0, MAX_MARKDOWN_CHARS)
  const userMessage = `${prompt}\n\n=== MATERIAL ACADÉMICO ===\n${safeMarkdown}`

  // 4. Invocar proveedor LLM configurado en Supabase Secrets con failover automático Gemini ↔ NVIDIA NIM
  const geminiKey = sanitizeSecret(Deno.env.get('GEMINI_API_KEY'))
  const nvidiaKey = sanitizeSecret(Deno.env.get('NVIDIA_API_KEY'))

  if (!geminiKey && !nvidiaKey) {
    return json({ ok: false, code: 'LLM_NOT_CONFIGURED', error: 'Motor IA aún no configurado en secretos del servidor.' }, 503)
  }

  const attempts: ProviderAttemptLog[] = []

  if (geminiKey) {
    const geminiResult = await callGemini(geminiKey, userMessage, attempts)
    if (geminiResult) {
      console.log(`[teacher-document-analyze] OK via ${geminiResult.provider}`)
      return json({ ok: true, provider: geminiResult.provider, rawJson: geminiResult.rawJson })
    }
  }

  if (nvidiaKey) {
    const nvidiaResult = await callNvidiaNim(nvidiaKey, userMessage, attempts)
    if (nvidiaResult) {
      console.log(`[teacher-document-analyze] OK via ${nvidiaResult.provider}`)
      return json({ ok: true, provider: nvidiaResult.provider, rawJson: nvidiaResult.rawJson })
    }
  }

  console.error('[teacher-document-analyze] Todos los proveedores fallaron:', JSON.stringify(attempts))
  return json(
    {
      ok: false,
      error: 'El servicio de análisis no respondió en este momento. Intenta nuevamente.',
      attempts,
    },
    502,
  )
})
