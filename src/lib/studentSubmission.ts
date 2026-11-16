import type { Activity, ActivityResponse } from './activityEngine'

export type GuestResponseLike = {
  status?: number
  headers?: { get?: (name: string) => string | null }
  clone?: () => {
    json: () => Promise<unknown>
    text?: () => Promise<string>
  }
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

export type ParsedGuestResponse = {
  httpStatus: number | null
  body: Record<string, unknown> | null
  message: string
  code: string | null
  alreadyAttempted: boolean
  retryAfterSeconds: number | null
  isNetworkError: boolean
}

export type GuestJoinStatusOutcome =
  | 'already_attempted'
  | 'name_conflict'
  | 'terminal_rejected'
  | 'transient'

export type GuestSubmitClassification =
  | { outcome: 'rejected'; error: string; httpStatus: number | null; code: string | null }
  | { outcome: 'pending_sync'; reason: string; httpStatus: number | null; retryAfterSeconds: number | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
  bodyRetryAfter?: unknown,
  nowMs = Date.now()
): number | null {
  if (typeof bodyRetryAfter === 'number' && Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
    return Math.ceil(bodyRetryAfter)
  }
  if (typeof headerValue === 'string' && headerValue.trim()) {
    const trimmed = headerValue.trim()
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.ceil(numeric)
    }
    const parsedDate = Date.parse(trimmed)
    if (Number.isFinite(parsedDate)) {
      const diffSec = Math.ceil((parsedDate - nowMs) / 1000)
      if (diffSec > 0) return diffSec
    }
  }
  return null
}

function getContextLike(error: unknown): GuestResponseLike | null {
  if (!isRecord(error)) return null
  const ctx = error.context
  if (!ctx || typeof ctx !== 'object') return null
  return ctx as GuestResponseLike
}

export async function parseGuestFunctionResponse(
  error: unknown,
  data: unknown,
  fallback: string,
  nowMs = Date.now()
): Promise<ParsedGuestResponse> {
  let body: Record<string, unknown> | null = isRecord(data) ? data : null
  const ctx = getContextLike(error)
  const httpStatus = typeof ctx?.status === 'number' && Number.isFinite(ctx.status) ? ctx.status : null

  if (!body && ctx) {
    try {
      const readable = typeof ctx.clone === 'function' ? ctx.clone() : ctx
      if (typeof readable.json === 'function') {
        const parsed = await readable.json()
        if (isRecord(parsed)) body = parsed
      }
    } catch {
      try {
        const readable = typeof ctx.clone === 'function' ? ctx.clone() : ctx
        if (typeof readable.text === 'function') {
          const text = await readable.text()
          if (text && text.trim().startsWith('{')) {
            const parsed = JSON.parse(text) as unknown
            if (isRecord(parsed)) body = parsed
          }
        }
      } catch {
        // Ignorar cuerpos no JSON
      }
    }
  }

  const headerRetry = typeof ctx?.headers?.get === 'function' ? ctx.headers.get('Retry-After') : null
  const retryAfterSeconds = parseRetryAfterSeconds(headerRetry, body?.retryAfter, nowMs)

  const code =
    typeof body?.code === 'string' && body.code.trim()
      ? body.code.trim()
      : null

  const alreadyAttempted =
    body?.alreadyAttempted === true ||
    (isRecord(data) && data.alreadyAttempted === true) ||
    code === 'ALREADY_ATTEMPTED' ||
    body?.error === 'ALREADY_ATTEMPTED'

  let message = fallback
  if (typeof body?.error === 'string' && body.error.trim() && body.error !== 'ALREADY_ATTEMPTED') {
    message = body.error.trim()
  } else if (typeof body?.message === 'string' && body.message.trim()) {
    message = body.message.trim()
  } else if (httpStatus === 401) {
    message = 'Tu sesión estudiantil expiró o no es válida.'
  } else if (httpStatus === 403) {
    message = 'La sala ya no admite participantes ni nuevas operaciones.'
  } else if (httpStatus === 404) {
    message = 'No se encontró la sala solicitada.'
  } else if (httpStatus === 429) {
    message = 'Demasiadas solicitudes. Espera unos segundos antes de reintentar.'
  }

  const errorName = isRecord(error) && typeof error.name === 'string' ? error.name : ''
  const errorMessage = error instanceof Error ? error.message : isRecord(error) && typeof error.message === 'string' ? error.message : ''
  const isNetworkError =
    Boolean(error) &&
    httpStatus === null &&
    (errorName === 'FunctionsFetchError' ||
      error instanceof TypeError ||
      /failed to fetch|network|offline|abort|load failed|timeout/i.test(errorMessage))

  return {
    httpStatus,
    body,
    message,
    code,
    alreadyAttempted,
    retryAfterSeconds,
    isNetworkError,
  }
}

export function isTerminalGuestCode(code: string | null): boolean {
  return (
    code === 'TOKEN_EXPIRED' ||
    code === 'PARTICIPANT_NOT_FOUND' ||
    code === 'ROOM_NOT_FOUND' ||
    code === 'SNAPSHOT_MISSING_RECOVERABLE'
  )
}

export function classifyGuestJoinOrStatusFailure(parsed: ParsedGuestResponse): GuestJoinStatusOutcome {
  if (parsed.alreadyAttempted) {
    return 'already_attempted'
  }
  if (parsed.httpStatus === 409) {
    return 'name_conflict'
  }
  if (
    parsed.httpStatus === 400 ||
    parsed.httpStatus === 401 ||
    parsed.httpStatus === 403 ||
    parsed.httpStatus === 404 ||
    isTerminalGuestCode(parsed.code)
  ) {
    return 'terminal_rejected'
  }
  return 'transient'
}

export function classifyGuestSubmitFailure(
  parsed: ParsedGuestResponse,
  hasValidAttemptId: boolean
): GuestSubmitClassification {
  // En submit_attempt, student-room-guest devuelve HTTP 200 alreadySaved: true si ya existe intento.
  // Cualquier 400/401/403/404 o 409 sin alreadyAttempted en submit_attempt es un rechazo terminal de negocio/autorización.
  if (
    parsed.httpStatus === 400 ||
    parsed.httpStatus === 401 ||
    parsed.httpStatus === 403 ||
    parsed.httpStatus === 404 ||
    (parsed.httpStatus === 409 && !parsed.alreadyAttempted) ||
    isTerminalGuestCode(parsed.code)
  ) {
    return {
      outcome: 'rejected',
      error: parsed.message,
      httpStatus: parsed.httpStatus,
      code: parsed.code,
    }
  }

  if (parsed.httpStatus === 429 || (parsed.httpStatus !== null && parsed.httpStatus >= 500 && parsed.httpStatus <= 599) || parsed.isNetworkError || parsed.httpStatus === null) {
    return {
      outcome: 'pending_sync',
      reason: parsed.message,
      httpStatus: parsed.httpStatus,
      retryAfterSeconds: parsed.retryAfterSeconds,
    }
  }

  if (!hasValidAttemptId) {
    return {
      outcome: 'pending_sync',
      reason: 'Respuesta del servidor incompleta (falta identificador oficial de entrega).',
      httpStatus: parsed.httpStatus,
      retryAfterSeconds: parsed.retryAfterSeconds,
    }
  }

  return {
    outcome: 'pending_sync',
    reason: parsed.message,
    httpStatus: parsed.httpStatus,
    retryAfterSeconds: parsed.retryAfterSeconds,
  }
}

export type StudentReceiptAnswerLike = {
  index: number
  activityId: string
  occurrenceId?: string
  activityTitle: string
  activityType: Activity['type']
  response: string
  status: 'answered' | 'omitted'
  correct: boolean | null
  score: number
  timeSeconds: number
}

export type OrderedReceiptEntry<TAnswer extends StudentReceiptAnswerLike> = {
  questionIndex: number
  activity: Activity
  answer?: TAnswer
  structuredResponse?: ActivityResponse
}

export function resolveStudentReceiptEntries<TAnswer extends StudentReceiptAnswerLike>(params: {
  mode: 'blank' | 'student'
  roomActivityIds: readonly string[]
  activities: readonly Activity[]
  attemptAnswers?: readonly TAnswer[]
  questionOrderIds?: readonly string[]
  studentResponses?: Record<number, ActivityResponse>
}): OrderedReceiptEntry<TAnswer>[] {
  const activityById = new Map(params.activities.map((a) => [a.id, a]))

  if (params.mode === 'blank') {
    const entries: OrderedReceiptEntry<TAnswer>[] = []
    params.roomActivityIds.forEach((id, idx) => {
      const act = activityById.get(id)
      if (act) {
        entries.push({ questionIndex: idx, activity: act })
      }
    })
    return entries
  }

  const orderedAnswers = params.attemptAnswers && params.attemptAnswers.length > 0
    ? [...params.attemptAnswers].sort((a, b) => a.index - b.index)
    : null

  if (orderedAnswers) {
    const entries: OrderedReceiptEntry<TAnswer>[] = []
    orderedAnswers.forEach((ans, pos) => {
      const act = activityById.get(ans.activityId)
      if (!act) return
      const respIdx = typeof ans.index === 'number' ? ans.index : pos
      entries.push({
        questionIndex: pos,
        activity: act,
        answer: ans,
        structuredResponse: params.studentResponses?.[respIdx],
      })
    })
    if (entries.length > 0) return entries
  }

  const fallbackIds =
    params.questionOrderIds && params.questionOrderIds.length > 0 ? params.questionOrderIds : params.roomActivityIds
  const entries: OrderedReceiptEntry<TAnswer>[] = []
  fallbackIds.forEach((id, idx) => {
    const act = activityById.get(id)
    if (!act) return
    entries.push({
      questionIndex: idx,
      activity: act,
      structuredResponse: params.studentResponses?.[idx],
    })
  })
  return entries
}
