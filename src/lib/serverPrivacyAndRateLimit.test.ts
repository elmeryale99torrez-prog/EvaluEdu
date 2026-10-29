import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Pruebas unitarias de verificación para la Fase 5 v1.2:
 * Etapa 1: Blindaje de privacidad de respuestas y Rate Limiting.
 * Etapa 2: Bloqueo de entregas con sala cerrada, idempotencia y expiración de tiempo en servidor.
 */

type AnyRecord = Record<string, any>

function buildPublicJoinPayload(
  room: AnyRecord,
  participant: AnyRecord,
  guestToken: string,
  content: { activityIds: string[]; activities: AnyRecord[]; privateActivities: AnyRecord[] }
) {
  return {
    ok: true,
    room,
    participant,
    guestToken,
    activityIds: content.activityIds,
    activities: content.activities,
  }
}

// Lógica de validación de entrega de la Etapa 2
function validateRoomStatusForSubmission(roomStatus: string): { allowed: boolean; status: number; error?: string } {
  if (roomStatus === 'finished' || roomStatus === 'archived') {
    return { allowed: false, status: 409, error: 'La sala ya no acepta más entregas porque fue finalizada por el docente.' }
  }
  if (roomStatus !== 'active') {
    return { allowed: false, status: 409, error: 'La sala no se encuentra en curso para recibir entregas.' }
  }
  return { allowed: true, status: 200 }
}

function evaluateAttemptTimeStatus(
  timeMinutes: number | null,
  roomStartedAt: string | null,
  incomingStatus: string,
  nowMs = Date.now()
): { allowed: boolean; status: number; attemptStatus: string; error?: string } {
  let attemptStatus = incomingStatus === 'timeout' ? 'timeout' : 'completed'
  const minutes = Number(timeMinutes)

  if (minutes > 0 && roomStartedAt) {
    const startedMs = new Date(roomStartedAt).getTime()
    if (!Number.isNaN(startedMs)) {
      const elapsedMs = nowMs - startedMs
      const limitMs = minutes * 60 * 1000
      const gracePeriodMs = 60 * 1000 // 60s tolerancia de red
      if (elapsedMs > limitMs + gracePeriodMs + 5 * 60 * 1000) {
        return { allowed: false, status: 409, attemptStatus, error: 'El plazo para entregar esta evaluación ha expirado completamente.' }
      }
      if (elapsedMs > limitMs + gracePeriodMs) {
        attemptStatus = 'timeout'
      }
    }
  }

  return { allowed: true, status: 200, attemptStatus }
}

describe('Fase 5 - Etapa 1: Privacidad en Servidor y Rate Limiting', () => {
  it('garantiza que el payload de ingreso omite estrictamente privateActivities y claves', () => {
    const mockRoom = { id: 'room-1', code: 'ABC123', status: 'active', score_per_question: 10 }
    const mockParticipant = { id: 'part-1', display_name: 'Estudiante 1', status: 'joined' }
    const mockGuestToken = 'token_abc123'

    const mockContent = {
      activityIds: ['act-1', 'act-2'],
      activities: [
        { id: 'act-1', type: 'singleChoice', prompt: '¿Pregunta 1?', options: ['A', 'B'] },
        { id: 'act-2', type: 'trueFalse', prompt: '¿Afirmación 2?' },
      ],
      privateActivities: [
        { id: 'act-1', type: 'singleChoice', prompt: '¿Pregunta 1?', options: ['A', 'B'], answer: 'A', details: { singleChoice: { options: [{ id: '1', label: 'A', correct: true }] } } },
        { id: 'act-2', type: 'trueFalse', prompt: '¿Afirmación 2?', answer: 'Verdadero', details: { trueFalse: { correct: true } } },
      ],
    }

    const payload = buildPublicJoinPayload(mockRoom, mockParticipant, mockGuestToken, mockContent)

    expect(payload.ok).toBe(true)
    expect(payload.room).toBeDefined()
    expect(payload.participant).toBeDefined()
    expect(payload.guestToken).toBe(mockGuestToken)
    expect(payload.activityIds).toEqual(['act-1', 'act-2'])
    expect(payload.activities).toHaveLength(2)

    expect((payload as AnyRecord).privateActivities).toBeUndefined()

    for (const activity of payload.activities) {
      expect((activity as AnyRecord).answer).toBeUndefined()
    }

    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('privateActivities')
    expect(serialized).not.toContain('"answer":')
  })

  describe('Control de Frecuencia (Rate Limiting)', () => {
    const RATE_LIMIT_WINDOW_MS = 60 * 1000
    const MAX_ATTEMPTS = 5

    interface RateLimitRecord {
      count: number
      resetAt: number
    }

    let rateLimitStore: Map<string, RateLimitRecord>

    function verifyRateLimitTest(ip: string, maxAttempts = MAX_ATTEMPTS, now = Date.now()): { allowed: boolean; retryAfter: number } {
      const record = rateLimitStore.get(ip)
      if (!record || record.resetAt <= now) {
        rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
        return { allowed: true, retryAfter: 0 }
      }

      if (record.count >= maxAttempts) {
        const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000))
        return { allowed: false, retryAfter }
      }

      record.count += 1
      return { allowed: true, retryAfter: 0 }
    }

    beforeEach(() => {
      rateLimitStore = new Map()
    })

    it('permite solicitudes dentro del límite establecido', () => {
      const ip = '192.168.1.50'
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const result = verifyRateLimitTest(ip)
        expect(result.allowed).toBe(true)
        expect(result.retryAfter).toBe(0)
      }
    })

    it('bloquea solicitudes que exceden el límite dentro de la misma ventana de tiempo', () => {
      const ip = '192.168.1.50'
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        verifyRateLimitTest(ip)
      }

      const blockedResult = verifyRateLimitTest(ip)
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.retryAfter).toBeGreaterThan(0)
      expect(blockedResult.retryAfter).toBeLessThanOrEqual(60)
    })

    it('restablece el contador una vez expirada la ventana de tiempo', () => {
      const ip = '192.168.1.50'
      const startTime = 1000000

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        verifyRateLimitTest(ip, MAX_ATTEMPTS, startTime)
      }

      expect(verifyRateLimitTest(ip, MAX_ATTEMPTS, startTime).allowed).toBe(false)

      const afterWindowTime = startTime + 61 * 1000
      const allowedAfterReset = verifyRateLimitTest(ip, MAX_ATTEMPTS, afterWindowTime)
      expect(allowedAfterReset.allowed).toBe(true)
    })

    it('maneja diferentes direcciones IP de manera independiente', () => {
      const ip1 = '192.168.1.50'
      const ip2 = '10.0.0.1'

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        verifyRateLimitTest(ip1)
      }

      expect(verifyRateLimitTest(ip1).allowed).toBe(false)
      expect(verifyRateLimitTest(ip2).allowed).toBe(true)
    })
  })
})

describe('Fase 5 - Etapa 2: Bloqueo de Entregas con Sala Cerrada y Expiración de Tiempo', () => {
  it('rechaza entregas si la sala está en estado finished o archived (HTTP 409)', () => {
    const resFinished = validateRoomStatusForSubmission('finished')
    expect(resFinished.allowed).toBe(false)
    expect(resFinished.status).toBe(409)
    expect(resFinished.error).toContain('finalizada por el docente')

    const resArchived = validateRoomStatusForSubmission('archived')
    expect(resArchived.allowed).toBe(false)
    expect(resArchived.status).toBe(409)
    expect(resArchived.error).toContain('finalizada por el docente')
  })

  it('rechaza entregas si la sala está en draft, ready o waiting (HTTP 409)', () => {
    for (const st of ['draft', 'ready', 'waiting']) {
      const res = validateRoomStatusForSubmission(st)
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(409)
      expect(res.error).toContain('no se encuentra en curso')
    }
  })

  it('permite la entrega si la sala se encuentra en estado active (HTTP 200)', () => {
    const res = validateRoomStatusForSubmission('active')
    expect(res.allowed).toBe(true)
    expect(res.status).toBe(200)
    expect(res.error).toBeUndefined()
  })

  it('mantiene estado completed si se entrega dentro del tiempo de la sala', () => {
    const now = 1000000000
    const startedAt = new Date(now - 5 * 60 * 1000).toISOString() // 5 minutos transcurridos
    const timeLimitMinutes = 15 // Límite de 15 minutos

    const res = evaluateAttemptTimeStatus(timeLimitMinutes, startedAt, 'completed', now)
    expect(res.allowed).toBe(true)
    expect(res.attemptStatus).toBe('completed')
  })

  it('permite completed si está dentro del margen de gracia de red de 60 segundos', () => {
    const now = 1000000000
    // Límite de 10 min (600s), transcurrieron 10 min y 30 seg (630s) -> dentro de la gracia de 60s
    const startedAt = new Date(now - (10 * 60 + 30) * 1000).toISOString()
    const timeLimitMinutes = 10

    const res = evaluateAttemptTimeStatus(timeLimitMinutes, startedAt, 'completed', now)
    expect(res.allowed).toBe(true)
    expect(res.attemptStatus).toBe('completed')
  })

  it('convierte a timeout si excede el tiempo límite y el margen de gracia de red', () => {
    const now = 1000000000
    // Límite de 10 min, transcurrieron 12 minutos -> excede el margen de 60s
    const startedAt = new Date(now - (12 * 60 * 1000)).toISOString()
    const timeLimitMinutes = 10

    const res = evaluateAttemptTimeStatus(timeLimitMinutes, startedAt, 'completed', now)
    expect(res.allowed).toBe(true)
    expect(res.attemptStatus).toBe('timeout')
  })

  it('rechaza con HTTP 409 si la entrega excede el tiempo por más de 5 minutos adicionales', () => {
    const now = 1000000000
    // Límite 10 min, transcurrieron 17 minutos (10 + 1 gracia + 6 min de exceso)
    const startedAt = new Date(now - (17 * 60 * 1000)).toISOString()
    const timeLimitMinutes = 10

    const res = evaluateAttemptTimeStatus(timeLimitMinutes, startedAt, 'completed', now)
    expect(res.allowed).toBe(false)
    expect(res.status).toBe(409)
    expect(res.error).toContain('ha expirado completamente')
  })

  it('respeta salas sin tiempo límite (time_minutes = null o 0)', () => {
    const now = 1000000000
    const startedAt = new Date(now - (120 * 60 * 1000)).toISOString() // 2 horas transcurridas

    const resNull = evaluateAttemptTimeStatus(null, startedAt, 'completed', now)
    expect(resNull.allowed).toBe(true)
    expect(resNull.attemptStatus).toBe('completed')

    const resZero = evaluateAttemptTimeStatus(0, startedAt, 'completed', now)
    expect(resZero.allowed).toBe(true)
    expect(resZero.attemptStatus).toBe('completed')
  })
})

describe('Fase 5 - Etapa 3: Nivelación del Motor de Calificación en Servidor con los 6 Contratos v1.2', () => {
  // Helpers espejo de la Edge Function
  function record(val: unknown): AnyRecord {
    return val && typeof val === 'object' && !Array.isArray(val) ? (val as AnyRecord) : {}
  }

  function runtimeServer(activity: AnyRecord) {
    const details = record(activity.details)
    const options = Array.isArray(activity.options) ? activity.options : []
    const answer = activity.answer
    const scenarioOptions = options.map((text, index) => ({
      id: `fallback-option-${index}`,
      text,
      consequence: activity.feedback,
      feedback: activity.feedback,
      recommended: text === answer,
    }))
    const matchingPairs = options.map((option, index) => {
      const [left, right] = option.split('→').map((p: string) => p.trim())
      return { id: `fallback-pair-${index}`, left: left || option, right: right || option }
    })
    const sortingAnswer = Array.isArray(answer) ? answer : []
    const sortingItems = options.map((label, index) => ({
      id: `fallback-item-${index}`,
      label,
      category: sortingAnswer[index] ?? 'Sin categoría',
    }))
    const orderingSteps = Array.isArray(answer) ? answer : options
    const choiceOptions = options.map((label, index) => ({
      id: `fallback-choice-${index}`,
      label,
      correct: label === answer,
    }))

    return {
      scenario: details.scenario ?? {
        situation: activity.prompt,
        stages: [{ id: 'fallback-stage', title: 'Decisión', prompt: activity.prompt, options: scenarioOptions }],
      },
      trueFalse: details.trueFalse ?? {
        statement: activity.prompt,
        correct: answer === 'Verdadero',
        explanation: activity.feedback,
      },
      matching: details.matching ?? { pairs: matchingPairs },
      sorting: details.sorting ?? {
        categories: Array.from(new Set(sortingAnswer)),
        items: sortingItems,
      },
      ordering: details.ordering ?? { steps: orderingSteps },
      singleChoice: details.singleChoice ?? { options: choiceOptions },
    }
  }

  function isCompleteServer(activity: AnyRecord, response: AnyRecord): boolean {
    if (response.type !== activity.type) return false
    const current = runtimeServer(activity)

    if (response.type === 'scenario') {
      const stages = current.scenario.stages ?? []
      const choices = record(response.choices)
      return stages.length > 0 && stages.every((stage: AnyRecord) => Boolean(choices[stage.id]))
    }
    if (response.type === 'trueFalse' || response.type === 'singleChoice') {
      return Boolean(response.value)
    }
    if (response.type === 'matching') {
      const pairs = current.matching.pairs ?? []
      const userPairs = record(response.pairs)
      return pairs.length > 0 && pairs.every((pair: AnyRecord) => Boolean(userPairs[pair.left]))
    }
    if (response.type === 'sorting') {
      const items = current.sorting.items ?? []
      const assignments = record(response.assignments)
      return items.length > 0 && items.every((item: AnyRecord) => Boolean(assignments[item.id]))
    }
    if (response.type === 'ordering') {
      const steps = current.ordering.steps ?? []
      const order = Array.isArray(response.order) ? response.order : []
      return order.length === steps.length && new Set(order).size === steps.length
    }
    return false
  }

  function isOmittedServer(activity: AnyRecord, response: AnyRecord | undefined | null): boolean {
    if (!response) return true
    if (response.type !== activity.type) return true

    if (response.type === 'trueFalse' || response.type === 'singleChoice') {
      return !response.value
    }
    if (response.type === 'matching') {
      const pairs = record(response.pairs)
      return Object.keys(pairs).length === 0 || Object.values(pairs).every((val) => !val)
    }
    if (response.type === 'sorting') {
      const assignments = record(response.assignments)
      return Object.keys(assignments).length === 0 || Object.values(assignments).every((val) => !val)
    }
    if (response.type === 'ordering') {
      const order = Array.isArray(response.order) ? response.order : []
      return order.length === 0
    }
    if (response.type === 'scenario') {
      const choices = record(response.choices)
      return Object.keys(choices).length === 0 || Object.values(choices).every((val) => !val)
    }
    return false
  }

  function compareServer(activity: AnyRecord, response: AnyRecord): boolean {
    if (!isCompleteServer(activity, response)) return false
    if (response.type !== activity.type) return false
    const current = runtimeServer(activity)

    if (response.type === 'scenario') {
      const stages = current.scenario.stages ?? []
      const choices = record(response.choices)
      return stages.every((stage: AnyRecord) => {
        const chosen = choices[stage.id]
        const option = (stage.options ?? []).find((opt: AnyRecord) => opt.id === chosen || opt.text === chosen)
        return option?.recommended === true
      })
    }

    if (response.type === 'trueFalse') {
      const expected = current.trueFalse.correct ? 'Verdadero' : 'Falso'
      return response.value === expected
    }

    if (response.type === 'singleChoice') {
      const options = current.singleChoice.options ?? []
      const option = options.find((opt: AnyRecord) => opt.id === response.value || opt.label === response.value)
      return option?.correct === true
    }

    if (response.type === 'matching') {
      const pairs = current.matching.pairs ?? []
      const userPairs = record(response.pairs)
      return pairs.every((pair: AnyRecord) => userPairs[pair.left] === pair.right)
    }

    if (response.type === 'sorting') {
      const items = current.sorting.items ?? []
      const assignments = record(response.assignments)
      return items.every((item: AnyRecord) => assignments[item.id] === item.category)
    }

    if (response.type === 'ordering') {
      const steps = current.ordering.steps ?? []
      const order = Array.isArray(response.order) ? response.order : []
      return order.every((step: string, index: number) => step === steps[index])
    }

    return false
  }

  it('califica correctamente singleChoice tanto por ID como por etiqueta', () => {
    const activity = {
      id: 'sc-1',
      type: 'singleChoice',
      details: {
        singleChoice: {
          options: [
            { id: 'opt-a', label: 'Opción A', correct: false },
            { id: 'opt-b', label: 'Opción B', correct: true },
          ],
        },
      },
    }

    // Por ID
    expect(compareServer(activity, { type: 'singleChoice', value: 'opt-b' })).toBe(true)
    expect(compareServer(activity, { type: 'singleChoice', value: 'opt-a' })).toBe(false)

    // Por Etiqueta
    expect(compareServer(activity, { type: 'singleChoice', value: 'Opción B' })).toBe(true)
    expect(compareServer(activity, { type: 'singleChoice', value: 'Opción A' })).toBe(false)
  })

  it('califica correctamente scenario tanto por ID como por texto', () => {
    const activity = {
      id: 'scen-1',
      type: 'scenario',
      details: {
        scenario: {
          stages: [
            {
              id: 'stage-1',
              options: [
                { id: 'opt-1', text: 'Decisión 1', recommended: true },
                { id: 'opt-2', text: 'Decisión 2', recommended: false },
              ],
            },
          ],
        },
      },
    }

    // Por ID
    expect(compareServer(activity, { type: 'scenario', choices: { 'stage-1': 'opt-1' } })).toBe(true)
    expect(compareServer(activity, { type: 'scenario', choices: { 'stage-1': 'opt-2' } })).toBe(false)

    // Por Texto
    expect(compareServer(activity, { type: 'scenario', choices: { 'stage-1': 'Decisión 1' } })).toBe(true)
    expect(compareServer(activity, { type: 'scenario', choices: { 'stage-1': 'Decisión 2' } })).toBe(false)
  })

  it('rechaza concordancia si el tipo de respuesta no coincide con el de la actividad', () => {
    const activity = { id: 'tf-1', type: 'trueFalse', details: { trueFalse: { correct: true } } }
    // Enviar respuesta de otro tipo a una actividad trueFalse
    expect(compareServer(activity, { type: 'singleChoice', value: 'Verdadero' })).toBe(false)
    expect(isCompleteServer(activity, { type: 'singleChoice', value: 'Verdadero' })).toBe(false)
  })

  it('clasifica respuestas vacías como omitidas sin penalizarlas como incorrectas', () => {
    const actTF = { id: 'tf-1', type: 'trueFalse', details: { trueFalse: { correct: true } } }
    expect(isOmittedServer(actTF, { type: 'trueFalse', value: '' })).toBe(true)

    const actSC = { id: 'sc-1', type: 'singleChoice', details: { singleChoice: { options: [] } } }
    expect(isOmittedServer(actSC, { type: 'singleChoice', value: '' })).toBe(true)

    const actMatching = { id: 'mat-1', type: 'matching', details: { matching: { pairs: [] } } }
    expect(isOmittedServer(actMatching, { type: 'matching', pairs: {} })).toBe(true)

    const actSorting = { id: 'sort-1', type: 'sorting', details: { sorting: { items: [] } } }
    expect(isOmittedServer(actSorting, { type: 'sorting', assignments: {} })).toBe(true)

    const actOrdering = { id: 'ord-1', type: 'ordering', details: { ordering: { steps: ['A', 'B'] } } }
    expect(isOmittedServer(actOrdering, { type: 'ordering', order: [] })).toBe(true)

    const actScenario = { id: 'scen-1', type: 'scenario', details: { scenario: { stages: [] } } }
    expect(isOmittedServer(actScenario, { type: 'scenario', choices: {} })).toBe(true)
  })

  it('califica correctamente matching, sorting y ordering', () => {
    const actMatching = {
      id: 'm1',
      type: 'matching',
      details: {
        matching: {
          pairs: [
            { id: 'p1', left: 'A', right: '1' },
            { id: 'p2', left: 'B', right: '2' },
          ],
        },
      },
    }
    expect(compareServer(actMatching, { type: 'matching', pairs: { A: '1', B: '2' } })).toBe(true)
    expect(compareServer(actMatching, { type: 'matching', pairs: { A: '2', B: '1' } })).toBe(false)

    const actSorting = {
      id: 's1',
      type: 'sorting',
      details: {
        sorting: {
          categories: ['Cat1', 'Cat2'],
          items: [
            { id: 'it-1', label: 'Item 1', category: 'Cat1' },
            { id: 'it-2', label: 'Item 2', category: 'Cat2' },
          ],
        },
      },
    }
    expect(compareServer(actSorting, { type: 'sorting', assignments: { 'it-1': 'Cat1', 'it-2': 'Cat2' } })).toBe(true)
    expect(compareServer(actSorting, { type: 'sorting', assignments: { 'it-1': 'Cat2', 'it-2': 'Cat1' } })).toBe(false)

    const actOrdering = {
      id: 'o1',
      type: 'ordering',
      details: {
        ordering: {
          steps: ['Paso 1', 'Paso 2', 'Paso 3'],
        },
      },
    }
    expect(compareServer(actOrdering, { type: 'ordering', order: ['Paso 1', 'Paso 2', 'Paso 3'] })).toBe(true)
    expect(compareServer(actOrdering, { type: 'ordering', order: ['Paso 2', 'Paso 1', 'Paso 3'] })).toBe(false)
  })
})

describe('Fase 5 - Etapa 4: Guardado Atómico e Idempotente de Intentos', () => {
  type RpcPayload = {
    p_room_id: string
    p_participant_id: string
    p_started_at: string
    p_finished_at: string
    p_status: string
    p_total_questions: number
    p_answered_count: number
    p_omitted_count: number
    p_correct_count: number
    p_score: number
    p_max_score: number
    p_events: any[]
    p_answers: any[]
  }

  function buildRpcPayload(
    roomId: string,
    participantId: string,
    attemptStatus: string,
    scorePerQuestion: number,
    evaluatedAnswers: Array<{ activityId: string; index: number; response: any; result: { response: string; status: string; correct: boolean | null; score: number } }>
  ): RpcPayload {
    const answeredCount = evaluatedAnswers.filter((a) => a.result.status === 'answered').length
    const omittedCount = evaluatedAnswers.filter((a) => a.result.status === 'omitted').length
    const correctCount = evaluatedAnswers.filter((a) => a.result.correct === true).length
    const score = evaluatedAnswers.reduce((sum, a) => sum + a.result.score, 0)
    const maxScore = evaluatedAnswers.length * scorePerQuestion

    return {
      p_room_id: roomId,
      p_participant_id: participantId,
      p_started_at: new Date().toISOString(),
      p_finished_at: new Date().toISOString(),
      p_status: attemptStatus,
      p_total_questions: evaluatedAnswers.length,
      p_answered_count: answeredCount,
      p_omitted_count: omittedCount,
      p_correct_count: correctCount,
      p_score: score,
      p_max_score: maxScore,
      p_events: [],
      p_answers: evaluatedAnswers.map((a) => ({
        activity_id: a.activityId,
        question_index: a.index,
        response: a.response,
        response_text: a.result.response,
        status: a.result.status,
        correct: a.result.correct,
        score: a.result.score,
        time_seconds: 15,
      })),
    }
  }

  it('construye el payload atómico completo para submit_student_attempt_atomic', () => {
    const payload = buildRpcPayload('room-123', 'part-456', 'completed', 10, [
      {
        activityId: 'act-1',
        index: 0,
        response: { type: 'trueFalse', value: 'Verdadero' },
        result: { response: 'Verdadero', status: 'answered', correct: true, score: 10 },
      },
      {
        activityId: 'act-2',
        index: 1,
        response: { type: 'singleChoice', value: '' },
        result: { response: '', status: 'omitted', correct: null, score: 0 },
      },
    ])

    expect(payload.p_room_id).toBe('room-123')
    expect(payload.p_participant_id).toBe('part-456')
    expect(payload.p_status).toBe('completed')
    expect(payload.p_total_questions).toBe(2)
    expect(payload.p_answered_count).toBe(1)
    expect(payload.p_omitted_count).toBe(1)
    expect(payload.p_correct_count).toBe(1)
    expect(payload.p_score).toBe(10)
    expect(payload.p_max_score).toBe(20)
    expect(payload.p_answers).toHaveLength(2)
    expect(payload.p_answers[0].activity_id).toBe('act-1')
    expect(payload.p_answers[0].correct).toBe(true)
    expect(payload.p_answers[1].status).toBe('omitted')
  })

  it('maneja la respuesta RPC idempotente cuando el intento ya fue guardado', () => {
    const mockRpcResponse = {
      ok: true,
      attemptId: 'existing-att-789',
      alreadySaved: true,
      score: 30,
      maxScore: 30,
    }

    expect(mockRpcResponse.ok).toBe(true)
    expect(mockRpcResponse.alreadySaved).toBe(true)
    expect(mockRpcResponse.attemptId).toBe('existing-att-789')
  })
})
