import { isSupabaseConfigured, supabase } from '../supabase'
import type { HelpAssistantAIRequest, HelpAssistantAIResponse } from './types'

/**
 * Adaptador de Capa 2 para el Asistente Docente.
 * - Invoca la Edge Function `teacher-help-assistant` usando la sesión JWT activa del docente.
 * - Jamás expone llaves de IA en el navegador.
 * - Degrada limpiamente si el dispositivo está sin internet o el servicio no está disponible.
 */
export async function invokeTeacherHelpAssistant(
  request: HelpAssistantAIRequest
): Promise<HelpAssistantAIResponse> {
  if (!request.context.isOnline) {
    return {
      ok: false,
      error: request.screenshotBase64
        ? 'Para analizar capturas de pantalla necesitas conexión a internet. Sin conexión puedes escribirme tu duda y te ayudo al instante.'
        : 'Sin conexión a internet en este momento. Sigo respondiendo con las guías integradas de EvaluEdu.',
    }
  }

  if (!isSupabaseConfigured || !supabase) {
    return {
      ok: false,
      error: 'La asistencia en línea no está disponible en este entorno. Usa las guías integradas.',
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('teacher-help-assistant', {
      body: {
        query: request.query,
        context: {
          role: request.context.role,
          view: request.context.view,
          activeActivityType: request.context.activeActivityType ?? null,
        },
        graphRagContext: request.graphRagContext,
        history: request.history ?? [],
        ...(request.screenshotBase64 ? { screenshotBase64: request.screenshotBase64 } : {}),
      },
    })

    const payload = data as { ok?: boolean; answer?: string; error?: string } | null
    if (!error && payload?.ok && typeof payload.answer === 'string' && payload.answer.trim()) {
      return {
        ok: true,
        answer: payload.answer.trim(),
      }
    }

    if (payload?.error && typeof payload.error === 'string') {
      return { ok: false, error: payload.error }
    }

    // Recuperar mensaje limpio del cuerpo JSON cuando la Edge Function responde 4xx/5xx
    if (error && typeof error === 'object' && 'context' in error) {
      const ctx = (error as { context?: unknown }).context
      if (ctx instanceof Response) {
        try {
          const errBody = (await ctx.clone().json()) as { error?: unknown; attempts?: unknown } | null
          console.warn('[EvaluEdu Asistente] HTTP', ctx.status, errBody?.error ?? '', errBody?.attempts ?? '')
          if (typeof errBody?.error === 'string' && errBody.error.trim()) {
            return { ok: false, error: errBody.error.trim() }
          }
        } catch {
          console.warn('[EvaluEdu Asistente] HTTP', ctx.status)
        }
      }
    } else if (error) {
      console.warn('[EvaluEdu Asistente] Error al invocar asistencia:', error.message)
    }

    return {
      ok: false,
      error: request.screenshotBase64
        ? 'No pude revisar la captura en este momento. Descríbeme en una frase qué ocurre en pantalla y te ayudo al instante.'
        : 'No pude ampliar esta respuesta en línea ahora. Revisa las guías relacionadas o intenta reformular tu pregunta.',
    }
  } catch {
    return {
      ok: false,
      error: request.screenshotBase64
        ? 'No hubo conexión estable para enviar la captura. Inténtalo de nuevo o descríbeme el problema por texto.'
        : 'No hubo conexión estable en este momento. Sigo disponible con las guías integradas.',
    }
  }
}
