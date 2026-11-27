import type { AssistantRuntimeContext } from './types'

/**
 * Reglas de ventana de contexto del asistente docente:
 * - Conserva una conversación fluida de varios turnos para no perder el hilo ni alucinar.
 * - Refresca automáticamente tras inactividad prolongada o al superar un tope de turnos
 *   para no acumular contexto innecesario (el docente no conversa de forma continua todo el día).
 */
export const MAX_CONTEXT_TURNS = 12
export const MAX_IDLE_MS = 25 * 60 * 1000 // 25 minutos
export const ACTIVE_HISTORY_WINDOW = 6 // últimos 6 intercambios (12 mensajes) enviados a Capa 2

export interface ConversationHistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface RefreshCheckResult {
  shouldRefresh: boolean
  reason: 'idle_timeout' | 'turn_limit' | null
}

export function shouldRefreshConversation(params: {
  userTurnCount: number
  lastActivityAtMs: number
  nowMs?: number
}): RefreshCheckResult {
  const now = params.nowMs ?? Date.now()
  if (params.userTurnCount <= 0) {
    return { shouldRefresh: false, reason: null }
  }
  if (now - params.lastActivityAtMs >= MAX_IDLE_MS) {
    return { shouldRefresh: true, reason: 'idle_timeout' }
  }
  if (params.userTurnCount >= MAX_CONTEXT_TURNS) {
    return { shouldRefresh: true, reason: 'turn_limit' }
  }
  return { shouldRefresh: false, reason: null }
}

/**
 * Recorta el historial al bloque más reciente (`ACTIVE_HISTORY_WINDOW` pares)
 * y limita el tamaño de cada mensaje para evitar sobrecargar el contexto de la IA.
 */
export function trimHistoryForAI(
  turns: readonly ConversationHistoryTurn[],
  maxPairs = ACTIVE_HISTORY_WINDOW
): ConversationHistoryTurn[] {
  const maxMessages = Math.max(2, maxPairs * 2)
  return turns.slice(-maxMessages).map((turn) => ({
    role: turn.role,
    text: turn.text.replace(/\s+/g, ' ').trim().slice(0, 420),
  }))
}

export function extractTeacherFirstName(rawName?: string | null, email?: string | null): string {
  const cleanName = (rawName ?? '').trim()
  if (cleanName) {
    const first = cleanName.split(/\s+/)[0]
    if (first && first.length >= 2) {
      return first.charAt(0).toUpperCase() + first.slice(1)
    }
  }
  const cleanEmail = (email ?? '').trim()
  if (cleanEmail && cleanEmail.includes('@')) {
    const localPart = cleanEmail.split('@')[0].split(/[._\-+0-9]/).find((seg) => seg.length >= 2)
    if (localPart) {
      return localPart.charAt(0).toUpperCase() + localPart.slice(1).toLowerCase()
    }
  }
  return 'Docente'
}

export function buildPersonalizedGreeting(
  firstName: string,
  context: Pick<AssistantRuntimeContext, 'role' | 'view'>,
  nowHour = new Date().getHours()
): string {
  const timeGreeting =
    nowHour >= 5 && nowHour < 12
      ? 'Buenos días'
      : nowHour >= 12 && nowHour < 19
        ? 'Buenas tardes'
        : 'Buenas noches'

  const placeHint =
    context.role === 'student'
      ? 'Veo que estás probando la vista de estudiante.'
      : context.view === 'content'
        ? 'Estás en Contenido.'
        : context.view === 'proposals'
          ? 'Estás en Propuestas.'
          : context.view === 'rooms'
            ? 'Estás en Salas.'
            : context.view === 'results'
              ? 'Estás en Resultados.'
              : 'Estoy listo para acompañarte en EvaluEdu.'

  return `${timeGreeting}, ${firstName}. ${placeHint} Cuéntame qué necesitas resolver o si ocurrió algún problema con tus estudiantes.`
}
