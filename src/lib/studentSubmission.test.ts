import { describe, expect, it } from 'vitest'
import {
  activityRuntime,
  compareActivityResponse,
  evaluateActivityResponse,
  isResponseComplete,
  serializeActivityResponse,
  type Activity,
  type ActivityResponse,
} from './activityEngine'
import { cloudActivityRowToStudentActivity } from './studentPlayContract'
import {
  classifyGuestJoinOrStatusFailure,
  classifyGuestSubmitFailure,
  parseGuestFunctionResponse,
  parseRetryAfterSeconds,
  resolveStudentReceiptEntries,
} from './studentSubmission'

function makeFakeErrorResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    message: `Edge Function returned status ${status}`,
    context: {
      status,
      headers: {
        get: (name: string) => {
          const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())
          return found ? found[1] : null
        },
      },
      clone: () => ({
        json: async () => body,
        text: async () => JSON.stringify(body),
      }),
    },
  }
}

describe('Contrato de respuestas estudiantiles y comprobantes (R2-A)', () => {
  it('distingue 409 por conflicto de nombre (1B) vs 409 alreadyAttempted (1A)', async () => {
    const conflictErr = makeFakeErrorResponse(409, {
      error: 'Ese nombre ya está participando en la sala. Usa una variante o recupera tu sesión con tu credencial original.',
    })
    const parsedConflict = await parseGuestFunctionResponse(conflictErr, null, 'fallback')
    expect(parsedConflict.httpStatus).toBe(409)
    expect(parsedConflict.alreadyAttempted).toBe(false)
    expect(classifyGuestJoinOrStatusFailure(parsedConflict)).toBe('name_conflict')

    const alreadyErr = makeFakeErrorResponse(409, {
      ok: false,
      alreadyAttempted: true,
      error: 'Ya tienes un intento registrado para esta sala.',
    })
    const parsedAlready = await parseGuestFunctionResponse(alreadyErr, null, 'fallback')
    expect(parsedAlready.httpStatus).toBe(409)
    expect(parsedAlready.alreadyAttempted).toBe(true)
    expect(classifyGuestJoinOrStatusFailure(parsedAlready)).toBe('already_attempted')
  })

  it('clasifica 401/403/404/409 en submit_attempt como rechazo terminal y 429/500/200-sin-attemptId como pending_sync', async () => {
    for (const status of [400, 401, 403, 404, 409]) {
      const err = makeFakeErrorResponse(status, { error: `Error ${status}` })
      const parsed = await parseGuestFunctionResponse(err, null, 'fallback')
      const classified = classifyGuestSubmitFailure(parsed, false)
      expect(classified.outcome).toBe('rejected')
    }

    const rateErr = makeFakeErrorResponse(
      429,
      { error: 'Demasiadas solicitudes', retryAfter: 18 },
      { 'Retry-After': '18' }
    )
    const parsedRate = await parseGuestFunctionResponse(rateErr, null, 'fallback')
    expect(parsedRate.retryAfterSeconds).toBe(18)
    const rateClassified = classifyGuestSubmitFailure(parsedRate, false)
    expect(rateClassified.outcome).toBe('pending_sync')
    if (rateClassified.outcome === 'pending_sync') {
      expect(rateClassified.retryAfterSeconds).toBe(18)
    }

    const parsed500 = await parseGuestFunctionResponse(
      makeFakeErrorResponse(500, { error: 'Internal server failure' }),
      null,
      'fallback'
    )
    expect(classifyGuestSubmitFailure(parsed500, false).outcome).toBe('pending_sync')

    const parsedIncomplete200 = await parseGuestFunctionResponse(null, { ok: true }, 'fallback')
    expect(classifyGuestSubmitFailure(parsedIncomplete200, false).outcome).toBe('pending_sync')
  })

  it('parsea Retry-After en segundos o fecha HTTP-Date', () => {
    const baseMs = Date.parse('2026-11-15T12:00:00.000Z')
    expect(parseRetryAfterSeconds('25', undefined, baseMs)).toBe(25)
    expect(parseRetryAfterSeconds(null, 12, baseMs)).toBe(12)
    expect(parseRetryAfterSeconds('Sun, 15 Nov 2026 12:00:30 GMT', undefined, baseMs)).toBe(30)
  })

  it('ordena el comprobante estudiantil por la secuencia real del intento incluso con shuffle o multiplicidad', () => {
    const actA: Activity = {
      id: 'act-A',
      title: 'Pregunta A',
      type: 'trueFalse',
      topic: 'T1',
      difficulty: 'Inicial',
      prompt: 'Prompt A',
      options: ['Verdadero', 'Falso'],
      answer: 'Verdadero',
      feedback: 'Pista A',
      status: 'published',
    }
    const actB: Activity = {
      id: 'act-B',
      title: 'Pregunta B',
      type: 'singleChoice',
      topic: 'T1',
      difficulty: 'Inicial',
      prompt: 'Prompt B',
      options: ['Op1', 'Op2'],
      answer: 'Op1',
      feedback: 'Pista B',
      status: 'published',
    }

    // La sala tiene orden [A, B, A], pero el alumno recibió secuencia barajada [B, A, A]
    const studentResponses: Record<number, ActivityResponse> = {
      0: { type: 'singleChoice', value: 'Op1' },
      1: { type: 'trueFalse', value: 'Verdadero' },
      2: { type: 'trueFalse', value: 'Falso' },
    }
    const attemptAnswers = [
      {
        index: 0,
        activityId: 'act-B',
        occurrenceId: 'occ-2',
        activityTitle: 'Pregunta B',
        activityType: 'singleChoice' as const,
        response: 'Op1',
        status: 'answered' as const,
        correct: true,
        score: 10,
        timeSeconds: 5,
      },
      {
        index: 1,
        activityId: 'act-A',
        occurrenceId: 'occ-1',
        activityTitle: 'Pregunta A',
        activityType: 'trueFalse' as const,
        response: 'Verdadero',
        status: 'answered' as const,
        correct: true,
        score: 10,
        timeSeconds: 4,
      },
      {
        index: 2,
        activityId: 'act-A',
        occurrenceId: 'occ-3',
        activityTitle: 'Pregunta A',
        activityType: 'trueFalse' as const,
        response: 'Falso',
        status: 'answered' as const,
        correct: false,
        score: 0,
        timeSeconds: 3,
      },
    ]

    const entries = resolveStudentReceiptEntries({
      mode: 'student',
      roomActivityIds: ['act-A', 'act-B', 'act-A'],
      activities: [actA, actB],
      attemptAnswers,
      questionOrderIds: ['act-B', 'act-A', 'act-A'],
      studentResponses,
    })

    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.activity.id)).toEqual(['act-B', 'act-A', 'act-A'])
    expect(entries[0].structuredResponse).toEqual({ type: 'singleChoice', value: 'Op1' })
    expect(entries[1].structuredResponse).toEqual({ type: 'trueFalse', value: 'Verdadero' })
    expect(entries[2].structuredResponse).toEqual({ type: 'trueFalse', value: 'Falso' })
  })
})

describe('Evaluación defensiva de proyecciones públicas sin respuestas (13 tipos)', () => {
  const publicRows: Array<{
    row: Record<string, unknown>
    answered: ActivityResponse
    omitted: ActivityResponse
  }> = [
    {
      row: {
        id: 'pub-tf',
        type: 'trueFalse',
        title: 'TF pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'La célula eucariota tiene núcleo.',
        options: ['Verdadero', 'Falso'],
        details: { trueFalse: { statement: 'La célula eucariota tiene núcleo.' } },
        status: 'published',
      },
      answered: { type: 'trueFalse', value: 'Verdadero' },
      omitted: { type: 'trueFalse', value: '' },
    },
    {
      row: {
        id: 'pub-sc',
        type: 'singleChoice',
        title: 'SC pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Orgánulo ATP',
        options: ['Mitocondria', 'Ribosoma'],
        details: { singleChoice: { options: [{ id: 'o1', label: 'Mitocondria' }, { id: 'o2', label: 'Ribosoma' }] } },
        status: 'published',
      },
      answered: { type: 'singleChoice', value: 'o1' },
      omitted: { type: 'singleChoice', value: '' },
    },
    {
      row: {
        id: 'pub-ms',
        type: 'multiSelect',
        title: 'MS pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Coenzimas',
        options: ['NADH', 'FADH2'],
        details: { multiSelect: { options: [{ id: 'm1', label: 'NADH' }, { id: 'm2', label: 'FADH2' }] } },
        status: 'published',
      },
      answered: { type: 'multiSelect', values: ['m1', 'm2'] },
      omitted: { type: 'multiSelect', values: [] },
    },
    {
      row: {
        id: 'pub-fb',
        type: 'fillBlanks',
        title: 'FillBlanks pública sin answer ni distractors',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Se producen [[1]] moléculas de [[2]].',
        options: ['ATP', 'ATP', 'mitocondria'],
        details: {
          fillBlanks: {
            textWithBlanks: 'Se producen [[1]] moléculas de [[2]].',
            text: 'Se producen [[1]] moléculas de [[2]].',
            blanks: [{ id: 'b1' }, { id: 'b2' }],
            bank: ['ATP', 'ATP', 'mitocondria'],
          },
        },
        status: 'published',
      },
      answered: { type: 'fillBlanks', answers: { b1: 'ATP', b2: 'ATP' } },
      omitted: { type: 'fillBlanks', answers: {} },
    },
    {
      row: {
        id: 'pub-se',
        type: 'spotError',
        title: 'SpotError pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Detecta error',
        options: ['Seg 1', 'Seg 2'],
        details: { spotError: { segments: [{ id: 's1', text: 'Seg 1' }, { id: 's2', text: 'Seg 2' }] } },
        status: 'published',
      },
      answered: { type: 'spotError', value: 's2' },
      omitted: { type: 'spotError', value: '' },
    },
    {
      row: {
        id: 'pub-mw',
        type: 'markWords',
        title: 'MarkWords pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Marca [cloroplasto] y [pared].',
        options: ['cloroplasto', 'pared'],
        details: {
          markWords: {
            text: 'Marca [cloroplasto] y [pared].',
            words: [{ id: 'w1', text: 'cloroplasto' }, { id: 'w2', text: 'pared' }],
          },
        },
        status: 'published',
      },
      answered: { type: 'markWords', values: ['w1'] },
      omitted: { type: 'markWords', values: [] },
    },
    {
      row: {
        id: 'pub-gc',
        type: 'gridCheck',
        title: 'GridCheck pública sin expectedCells',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Marca matriz',
        options: [],
        details: {
          gridCheck: {
            rows: [{ id: 'r1', label: 'Glucólisis' }],
            columns: [{ id: 'c1', label: 'Citosol' }],
          },
        },
        status: 'published',
      },
      answered: { type: 'gridCheck', values: ['r1:c1'] },
      omitted: { type: 'gridCheck', values: [] },
    },
    {
      row: {
        id: 'pub-vd',
        type: 'vennDiagram',
        title: 'Venn pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Ubica conceptos',
        options: ['Consume O2'],
        details: {
          vennDiagram: {
            setA: 'A',
            setB: 'B',
            intersectionLabel: 'Ambos',
            items: [{ id: 'v1', label: 'Consume O2' }],
          },
        },
        status: 'published',
      },
      answered: { type: 'vennDiagram', assignments: { v1: 'left' } },
      omitted: { type: 'vennDiagram', assignments: {} },
    },
    {
      row: {
        id: 'pub-sa',
        type: 'shortAnswer',
        title: 'ShortAnswer pública sin acceptedAnswers',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: '¿Movimiento neto de agua?',
        options: [],
        details: {
          shortAnswer: {
            prompt: '¿Movimiento neto de agua?',
            placeholder: 'Escribe tu respuesta...',
          },
        },
        status: 'published',
      },
      answered: { type: 'shortAnswer', value: 'ósmosis' },
      omitted: { type: 'shortAnswer', value: '' },
    },
    {
      row: {
        id: 'pub-mt',
        type: 'matching',
        title: 'Matching pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Asocia',
        options: ['Transporte activo'],
        details: {
          matching: {
            pairs: [{ id: 'p1', left: 'Bomba', right: 'Transporte activo' }],
          },
        },
        status: 'published',
      },
      answered: { type: 'matching', pairs: { Bomba: 'Transporte activo' } },
      omitted: { type: 'matching', pairs: {} },
    },
    {
      row: {
        id: 'pub-sr',
        type: 'sorting',
        title: 'Sorting pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Clasifica',
        options: ['Difusión'],
        details: {
          sorting: {
            categories: ['Pasivo', 'Activo'],
            items: [{ id: 'i1', label: 'Difusión' }],
          },
        },
        status: 'published',
      },
      answered: { type: 'sorting', assignments: { i1: 'Pasivo' } },
      omitted: { type: 'sorting', assignments: {} },
    },
    {
      row: {
        id: 'pub-or',
        type: 'ordering',
        title: 'Ordering pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Ordena',
        options: ['Paso 1', 'Paso 2'],
        details: {
          ordering: {
            steps: ['Paso 1', 'Paso 2'],
          },
        },
        status: 'published',
      },
      answered: { type: 'ordering', order: ['Paso 1', 'Paso 2'] },
      omitted: { type: 'ordering', order: [] },
    },
    {
      row: {
        id: 'pub-scn',
        type: 'scenario',
        title: 'Scenario pública',
        topic: 'T1',
        difficulty: 'Inicial',
        prompt: 'Decide',
        options: [],
        details: {
          scenario: {
            situation: 'Sin oxígeno',
            stages: [{ id: 'st1', title: 'Etapa 1', prompt: 'Qué haces', options: [{ id: 'so1', text: 'Fermentar' }] }],
          },
        },
        status: 'published',
      },
      answered: { type: 'scenario', choices: { st1: 'so1' } },
      omitted: { type: 'scenario', choices: {} },
    },
  ]

  it('evalúa, serializa y detecta completitud sin lanzar excepciones para las 13 proyecciones públicas', () => {
    expect(publicRows).toHaveLength(13)
    for (const sample of publicRows) {
      const activity = cloudActivityRowToStudentActivity(sample.row)
      expect(() => activityRuntime(activity)).not.toThrow()
      expect(isResponseComplete(activity, sample.answered)).toBe(true)
      expect(() => compareActivityResponse(activity, sample.answered)).not.toThrow()
      expect(serializeActivityResponse(sample.answered).length).toBeGreaterThan(0)

      const evalAnswered = evaluateActivityResponse(activity, sample.answered, 10)
      expect(evalAnswered.status).toBe('answered')
      expect(evalAnswered.response.length).toBeGreaterThan(0)

      const evalOmitted = evaluateActivityResponse(activity, sample.omitted, 10)
      expect(evalOmitted).toEqual({ response: '', status: 'omitted', correct: null, score: 0 })

      const evalUndefined = evaluateActivityResponse(activity, undefined, 10)
      expect(evalUndefined).toEqual({ response: '', status: 'omitted', correct: null, score: 0 })
    }
  })
})

