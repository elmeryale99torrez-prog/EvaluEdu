import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Edge Function: teacher-help-assistant (EvaluEdu · Capa 2 Multimodal)
 *
 * Seguridad y privacidad:
 * - Exige JWT válido de usuario autenticado (no anónimo) y perfil con permiso docente en `profiles`.
 * - Jamás accede a tablas de estudiantes, notas ni salas privadas.
 * - Sanitiza correos y teléfonos antes de enviar consultas a modelos externos.
 * - Las capturas de pantalla se procesan únicamente en memoria RAM y nunca se almacenan.
 * - Cascada configurable por Secrets:
 *   · Texto: GEMINI_TEXT_MODELS -> respaldo NVIDIA_TEXT_MODELS
 *   · Visión (capturas): NVIDIA_VISION_MODELS -> respaldo GEMINI_VISION_MODELS
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_GEMINI_TEXT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
]

const DEFAULT_GEMINI_VISION_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
]

const DEFAULT_NVIDIA_VISION_MODELS = [
  'google/gemma-3-12b-it',
  'google/gemma-3-27b-it',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
]

const DEFAULT_NVIDIA_TEXT_MODELS = [
  'google/gemma-3-12b-it',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'meta/llama-3.3-70b-instruct',
]

const TEXT_TIMEOUT_MS = 10_000
const NVIDIA_VISION_TIMEOUT_MS = 8_000
const GEMINI_VISION_TIMEOUT_MS = 16_000
const MAX_QUERY_CHARS = 500
const MAX_GRAPH_RAG_CHARS = 4500
const MAX_SCREENSHOT_BASE64_CHARS = 1_400_000 // ~1 MB imagen codificada

// Límites por docente (en memoria de instancia)
interface Bucket {
  count: number
  resetAt: number
}
const minuteBuckets = new Map<string, Bucket>()
const dailyTextBuckets = new Map<string, Bucket>()
const dailyVisionBuckets = new Map<string, Bucket>()

const MAX_PER_MINUTE = 8
const MAX_TEXT_PER_DAY = 30
const MAX_VISION_PER_DAY = 8

function json(payload: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  })
}

function checkTeacherQuota(
  store: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  if (store.size > 3000) {
    for (const [k, v] of store.entries()) {
      if (v.resetAt <= now) store.delete(k)
    }
  }
  const current = store.get(key)
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfter: 0 }
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
  }
  current.count += 1
  return { allowed: true, retryAfter: 0 }
}

function sanitizeSecret(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^["']|["']$/g, '').trim()
}

function parseModelList(envKey: string, fallback: string[]): string[] {
  const raw = (Deno.env.get(envKey) ?? '').trim()
  if (!raw) return fallback
  const list = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  return list.length > 0 ? list : fallback
}

function sanitizePii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo]')
    .replace(/\b\+?\d[\d\s\-()]{7,}\d\b/g, '[telefono]')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string; fullDataUrl: string } | null {
  const match = dataUrl.trim().match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) return null
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  const base64 = match[2].replace(/\s+/g, '')
  if (!base64 || base64.length > MAX_SCREENSHOT_BASE64_CHARS) return null
  return { mimeType, base64, fullDataUrl: `data:${mimeType};base64,${base64}` }
}

function buildSystemPrompt(params: {
  view: string
  role: string
  activeActivityType: string | null
  graphRagContext: string
  hasScreenshot: boolean
}): string {
  const locationLine =
    params.role === 'student'
      ? 'El docente está probando la vista de Estudiante (Probar como Estudiante).'
      : `El docente está actualmente en la sección "${params.view}" del Panel Docente.`

  const actLine = params.activeActivityType
    ? `Actividad visible en pantalla: ${params.activeActivityType}.`
    : ''

  return [
    'Eres el asistente oficial de EvaluEdu para docentes. Respondes siempre en español claro, cercano, breve y práctico.',
    'REGLAS ESTRICTAS:',
    '1. Usa exclusivamente la documentación verificada de EvaluEdu provista abajo y lo que veas en la captura (si hay imagen). Nunca inventes botones, menús ni funciones que no existan.',
    '2. NUNCA menciones términos técnicos internos como Supabase, Edge Function, API, Gemini, NVIDIA, JSON, RAG, base local, Fase 1, Fase 2, KB o píxeles.',
    '3. Estructura tus respuestas de forma escaneable (un párrafo breve y, si aplica, pasos numerados cortos de 1 a 4 puntos).',
    '4. Si la pregunta es pedagógica complementaria vinculada a cómo preparar mejores clases o actividades en EvaluEdu, ayuda de forma práctica conectándolo con los 13 formatos reales de EvaluEdu.',
    '5. Si el mensaje no tiene ninguna relación con EvaluEdu ni con la docencia, declina brevemente con amabilidad y vuelve a ofrecer ayuda sobre la plataforma.',
    params.hasScreenshot
      ? '6. MODO CAPTURA DE PANTALLA: observa cuidadosamente la imagen adjunta, identifica qué pantalla, estado o aviso aparece en EvaluEdu y explica en pasos concretos qué debe hacer el docente ahora mismo. Si ves un fallo visual o error inesperado real de la aplicación, indícalo claramente y sugiérele reportarlo desde Escribir sugerencia.'
      : '',
    '',
    `CONTEXTO ACTUAL: ${locationLine} ${actLine}`.trim(),
    params.graphRagContext
      ? `\nDOCUMENTACIÓN VERIFICADA DE EVALUEDU:\n${params.graphRagContext.slice(0, MAX_GRAPH_RAG_CHARS)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function normalizeAlternatingHistory(
  turns: Array<{ role: 'user' | 'assistant'; text: string }>
): Array<{ role: 'user' | 'assistant'; text: string }> {
  const clean: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const turn of turns) {
    const text = turn.text.trim()
    if (!text) continue
    if (clean.length === 0) {
      if (turn.role !== 'user') continue
      clean.push({ role: 'user', text })
      continue
    }
    const prev = clean[clean.length - 1]
    if (prev.role === turn.role) {
      prev.text = `${prev.text}\n${text}`.slice(0, 500)
    } else {
      clean.push({ role: turn.role, text })
    }
  }
  // El historial previo a un nuevo turno del usuario debe terminar en 'assistant'
  if (clean.length > 0 && clean[clean.length - 1].role === 'user') {
    clean.pop()
  }
  return clean
}

async function callGeminiModel(params: {
  apiKey: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; text: string }>
  userQuery: string
  image: { mimeType: string; base64: string } | null
  timeoutMs: number
}): Promise<{ ok: true; text: string } | { ok: false; retryable: boolean; status: number; detail?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    params.model
  )}:generateContent?key=${encodeURIComponent(params.apiKey)}`

  const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = []
  for (const turn of normalizeAlternatingHistory(params.history)) {
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    })
  }

  const userParts: Array<Record<string, unknown>> = []
  if (params.image) {
    userParts.push({
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.base64,
      },
    })
  }
  userParts.push({
    text: params.userQuery || 'Analiza esta captura de mi pantalla de EvaluEdu y explícame cómo resolver lo que ocurre.',
  })
  contents.push({ role: 'user', parts: userParts })

  // A partir de Gemini 3.6/3.8 y 3.5 Flash-Lite, temperature/top_p/top_k están obsoletos y deben omitirse
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 1400,
  }

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: params.systemPrompt }] },
          contents,
          generationConfig,
        }),
      },
      params.timeoutMs
    )

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 220)
      const isAuthFailure =
        res.status === 401 ||
        res.status === 403 ||
        detail.toLowerCase().includes('api key not valid') ||
        detail.toLowerCase().includes('api_key_invalid')
      return { ok: false, retryable: !isAuthFailure, status: res.status, detail }
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
    }
    const text =
      data.candidates?.[0]?.content?.parts
        ?.filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text ?? '')
        .join('')
        .trim() ?? ''

    if (!text) return { ok: false, retryable: true, status: 200, detail: 'Respuesta vacía' }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, retryable: true, status: 504, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function callNvidiaModel(params: {
  apiKey: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; text: string }>
  userQuery: string
  image: { fullDataUrl: string } | null
  timeoutMs: number
}): Promise<{ ok: true; text: string } | { ok: false; retryable: boolean; status: number; detail?: string }> {
  const safeHistory = normalizeAlternatingHistory(params.history)
  const messages: Array<Record<string, unknown>> = []

  const promptText =
    params.userQuery || 'Analiza esta captura de mi pantalla de EvaluEdu y explícame qué ocurre y cómo resolverlo paso a paso.'

  if (params.image) {
    // Muchos modelos VLM en NVIDIA NIM (Llama 3.2 Vision / Gemma 3) rechazan role:'system' con imágenes;
    // integramos las instrucciones dentro del turno del usuario para máxima compatibilidad.
    const recentHistoryText = safeHistory
      .slice(-4)
      .map((h) => `${h.role === 'user' ? 'Docente' : 'Asistente'}: ${h.text}`)
      .join('\n')
    const combinedPrompt = [
      params.systemPrompt,
      recentHistoryText ? `\nCONVERSACIÓN RECIENTE:\n${recentHistoryText}` : '',
      `\nCONSULTA ACTUAL DEL DOCENTE:\n${promptText}`,
    ]
      .filter(Boolean)
      .join('\n')

    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: combinedPrompt },
        { type: 'image_url', image_url: { url: params.image.fullDataUrl } },
      ],
    })
  } else {
    messages.push({ role: 'system', content: params.systemPrompt })
    for (const turn of safeHistory) {
      messages.push({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: turn.text,
      })
    }
    messages.push({ role: 'user', content: promptText })
  }

  try {
    const res = await fetchWithTimeout(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          messages,
          temperature: 0.2,
          max_tokens: 900,
        }),
      },
      params.timeoutMs
    )

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 220)
      const isAuthFailure = res.status === 401 || res.status === 403
      return { ok: false, retryable: !isAuthFailure, status: res.status, detail }
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = (data.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, retryable: true, status: 200, detail: 'Respuesta vacía' }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, retryable: true, status: 504, detail: err instanceof Error ? err.message : String(err) }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  // 1. Autenticación estricta de docente con correo real
  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!token || !supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json({ error: 'Sesión no autorizada.' }, 401)
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: authData, error: authError } = await callerClient.auth.getUser(token)
  if (authError || !authData.user || authData.user.is_anonymous || !authData.user.email) {
    return json({ error: 'Tu sesión expiró. Cierra sesión y vuelve a ingresar.' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role, roles')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return json({ error: 'No se encontró un perfil docente autorizado.' }, 403)
  }

  const userRoles = Array.isArray(profile.roles) ? profile.roles : []
  const isTeacherAuthorized =
    profile.role === 'teacher' ||
    profile.role === 'admin' ||
    profile.role === 'superadmin' ||
    userRoles.includes('teacher')
  if (!isTeacherAuthorized) {
    return json({ error: 'Solo docentes autorizados pueden usar esta asistencia.' }, 403)
  }

  // 2. Parseo y validación segura de entrada
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400)
  }

  const rawQuery = typeof body.query === 'string' ? sanitizePii(body.query).slice(0, MAX_QUERY_CHARS) : ''
  const rawScreenshot = typeof body.screenshotBase64 === 'string' ? body.screenshotBase64 : ''
  const parsedImage = rawScreenshot ? parseDataUrl(rawScreenshot) : null

  if (rawScreenshot && !parsedImage) {
    return json({ error: 'La captura enviada no tiene un formato válido o supera el tamaño permitido.' }, 400)
  }

  if (!rawQuery && !parsedImage) {
    return json({ error: 'Escribe tu consulta o adjunta una captura de pantalla.' }, 400)
  }

  // 3. Control de cuotas por docente
  const userId = authData.user.id
  const minQuota = checkTeacherQuota(minuteBuckets, userId, MAX_PER_MINUTE, 60 * 1000)
  if (!minQuota.allowed) {
    return json(
      { error: 'Estás enviando consultas muy rápido. Espera unos segundos e inténtalo de nuevo.' },
      429,
      { 'Retry-After': String(minQuota.retryAfter) }
    )
  }

  if (parsedImage) {
    const visionQuota = checkTeacherQuota(dailyVisionBuckets, userId, MAX_VISION_PER_DAY, 24 * 60 * 60 * 1000)
    if (!visionQuota.allowed) {
      return json(
        { error: 'Alcanzaste el límite diario de análisis de capturas. Puedes seguir consultando por texto.' },
        429,
        { 'Retry-After': String(visionQuota.retryAfter) }
      )
    }
  } else {
    const textQuota = checkTeacherQuota(dailyTextBuckets, userId, MAX_TEXT_PER_DAY, 24 * 60 * 60 * 1000)
    if (!textQuota.allowed) {
      return json(
        { error: 'Alcanzaste el límite diario de consultas ampliadas. Las guías rápidas de EvaluEdu siguen disponibles.' },
        429,
        { 'Retry-After': String(textQuota.retryAfter) }
      )
    }
  }

  const ctxObj = typeof body.context === 'object' && body.context !== null ? (body.context as Record<string, unknown>) : {}
  const view = typeof ctxObj.view === 'string' ? ctxObj.view : 'overview'
  const role = typeof ctxObj.role === 'string' ? ctxObj.role : 'teacher'
  const activeActivityType = typeof ctxObj.activeActivityType === 'string' ? ctxObj.activeActivityType : null
  const graphRagContext = typeof body.graphRagContext === 'string' ? body.graphRagContext : ''

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory
    .slice(-12)
    .filter((item): item is { role: 'user' | 'assistant'; text: string } => {
      if (!item || typeof item !== 'object') return false
      const rec = item as Record<string, unknown>
      return (rec.role === 'user' || rec.role === 'assistant') && typeof rec.text === 'string'
    })
    .map((item) => ({
      role: item.role,
      text: sanitizePii(item.text).slice(0, 380),
    }))

  const systemPrompt = buildSystemPrompt({
    view,
    role,
    activeActivityType,
    graphRagContext,
    hasScreenshot: Boolean(parsedImage),
  })

  const geminiApiKey = sanitizeSecret(Deno.env.get('GEMINI_API_KEY'))
  const nvidiaApiKey = sanitizeSecret(Deno.env.get('NVIDIA_API_KEY'))

  if (!geminiApiKey && !nvidiaApiKey) {
    return json(
      { ok: false, error: 'El servicio de asistencia ampliada todavía no está configurado en el servidor.' },
      503
    )
  }

  const attempts: Array<{ provider: string; model: string; status: number; detail: string }> = []

  // 4A. RUTA VISIÓN (Captura de pantalla): Cascada NVIDIA NIM Vision -> Respaldo Gemini Vision
  if (parsedImage) {
    if (nvidiaApiKey) {
      const nvidiaVisionModels = parseModelList('NVIDIA_VISION_MODELS', DEFAULT_NVIDIA_VISION_MODELS)
      for (const model of nvidiaVisionModels) {
        const result = await callNvidiaModel({
          apiKey: nvidiaApiKey,
          model,
          systemPrompt,
          history,
          userQuery: rawQuery,
          image: { fullDataUrl: parsedImage.fullDataUrl },
          timeoutMs: NVIDIA_VISION_TIMEOUT_MS,
        })
        if (result.ok) {
          console.log(`[teacher-help-assistant] vision OK via nvidia:${model}`)
          return json({ ok: true, answer: result.text }, 200)
        }
        attempts.push({ provider: 'nvidia', model, status: result.status, detail: (result.detail ?? '').slice(0, 140) })
        console.warn(`[teacher-help-assistant] vision fail nvidia:${model} status=${result.status} detail=${result.detail ?? ''}`)
        if (!result.retryable) break
      }
    }

    if (geminiApiKey) {
      const geminiVisionModels = parseModelList('GEMINI_VISION_MODELS', DEFAULT_GEMINI_VISION_MODELS)
      for (const model of geminiVisionModels) {
        const result = await callGeminiModel({
          apiKey: geminiApiKey,
          model,
          systemPrompt,
          history,
          userQuery: rawQuery,
          image: { mimeType: parsedImage.mimeType, base64: parsedImage.base64 },
          timeoutMs: GEMINI_VISION_TIMEOUT_MS,
        })
        if (result.ok) {
          console.log(`[teacher-help-assistant] vision OK via gemini:${model}`)
          return json({ ok: true, answer: result.text }, 200)
        }
        attempts.push({ provider: 'gemini', model, status: result.status, detail: (result.detail ?? '').slice(0, 140) })
        console.warn(`[teacher-help-assistant] vision fail gemini:${model} status=${result.status} detail=${result.detail ?? ''}`)
        if (!result.retryable) break
      }
    }

    return json(
      {
        ok: false,
        error: 'No pude analizar la captura en este momento. Descríbeme en una frase qué ves en pantalla y te ayudo al instante.',
        attempts,
      },
      503
    )
  }

  // 4B. RUTA TEXTO: Cascada de modelos Gemini -> Respaldo NVIDIA NIM Texto
  if (geminiApiKey) {
    const geminiTextModels = parseModelList('GEMINI_TEXT_MODELS', DEFAULT_GEMINI_TEXT_MODELS)
    for (const model of geminiTextModels) {
      const result = await callGeminiModel({
        apiKey: geminiApiKey,
        model,
        systemPrompt,
        history,
        userQuery: rawQuery,
        image: null,
        timeoutMs: TEXT_TIMEOUT_MS,
      })
      if (result.ok) {
        console.log(`[teacher-help-assistant] text OK via gemini:${model}`)
        return json({ ok: true, answer: result.text }, 200)
      }
      attempts.push({ provider: 'gemini', model, status: result.status, detail: (result.detail ?? '').slice(0, 140) })
      console.warn(`[teacher-help-assistant] text fail gemini:${model} status=${result.status} detail=${result.detail ?? ''}`)
      if (!result.retryable) break
    }
  }

  if (nvidiaApiKey) {
    const nvidiaTextModels = parseModelList('NVIDIA_TEXT_MODELS', DEFAULT_NVIDIA_TEXT_MODELS)
    for (const model of nvidiaTextModels) {
      const result = await callNvidiaModel({
        apiKey: nvidiaApiKey,
        model,
        systemPrompt,
        history,
        userQuery: rawQuery,
        image: null,
        timeoutMs: TEXT_TIMEOUT_MS,
      })
      if (result.ok) {
        console.log(`[teacher-help-assistant] text OK via nvidia:${model}`)
        return json({ ok: true, answer: result.text }, 200)
      }
      attempts.push({ provider: 'nvidia', model, status: result.status, detail: (result.detail ?? '').slice(0, 140) })
      console.warn(`[teacher-help-assistant] text fail nvidia:${model} status=${result.status} detail=${result.detail ?? ''}`)
      if (!result.retryable) break
    }
  }

  return json(
    {
      ok: false,
      error: 'El servicio en línea está ocupado en este momento. Puedes usar las guías rápidas disponibles sin conexión.',
      attempts,
    },
    503
  )
})
