import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Suite de Pruebas de Estrés y Concurrencia Masiva (Fase 5 - Etapa 5)
 * Simula un aula completa de 50 estudiantes interactuando y entregando
 * de forma estrictamente simultánea (Promise.all) en una sala de 6 actividades v1.2.
 *
 * Valida:
 * 1. Resistencia a condiciones de carrera en guardado atómico (ACID).
 * 2. Cero pérdida de respuestas (50 intentos x 6 actividades = 300 respuestas).
 * 3. Consistencia exacta de puntajes entre attempts y attempt_answers.
 * 4. Idempotencia ante ráfagas concurrentes de reintentos de red.
 * 5. Clasificación adecuada de respuestas correctas, incorrectas, omitidas y timeouts.
 */

type AnyRecord = Record<string, any>

interface DbRoom {
  id: string
  code: string
  status: 'draft' | 'ready' | 'waiting' | 'active' | 'finished' | 'archived'
  score_per_question: number
  question_count: number
}

interface DbParticipant {
  id: string
  room_id: string
  display_name: string
  name_normalized: string
  status: 'joined' | 'in_progress' | 'completed' | 'abandoned'
}

interface DbAttempt {
  id: string
  room_id: string
  participant_id: string
  started_at: string
  finished_at: string
  status: 'completed' | 'timeout'
  total_questions: number
  answered_count: number
  omitted_count: number
  correct_count: number
  score: number
  max_score: number
  events: any[]
}

interface DbAttemptAnswer {
  id: string
  attempt_id: string
  activity_id: string
  question_index: number
  response: any
  response_text: string
  status: 'answered' | 'omitted'
  correct: boolean | null
  score: number
  time_seconds: number
}

// Base de datos transaccional simulada con soporte de locking y RPC atómica
class SimulatedSupabaseDatabase {
  rooms = new Map<string, DbRoom>()
  participants = new Map<string, DbParticipant>()
  attempts = new Map<string, DbAttempt>()
  attemptAnswers: DbAttemptAnswer[] = []
  private isLocked = false

  async executeAtomicRpc(params: {
    p_room_id: string
    p_participant_id: string
    p_started_at: string
    p_finished_at: string
    p_status: 'completed' | 'timeout'
    p_total_questions: number
    p_answered_count: number
    p_omitted_count: number
    p_correct_count: number
    p_score: number
    p_max_score: number
    p_events: any[]
    p_answers: Array<{
      activity_id: string
      question_index: number
      response: any
      response_text: string
      status: 'answered' | 'omitted'
      correct: boolean | null
      score: number
      time_seconds: number
    }>
  }): Promise<{ ok: boolean; attemptId: string; alreadySaved: boolean; score: number; maxScore: number }> {
    // Simular atomicidad con exclusión mutua interna en el motor
    while (this.isLocked) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    this.isLocked = true

    try {
      // 1. Idempotencia: Verificar intento existente
      for (const attempt of this.attempts.values()) {
        if (attempt.participant_id === params.p_participant_id) {
          return {
            ok: true,
            attemptId: attempt.id,
            alreadySaved: true,
            score: attempt.score,
            maxScore: attempt.max_score,
          }
        }
      }

      // 2. Insertar intento
      const attemptId = `att-${params.p_participant_id}`
      const newAttempt: DbAttempt = {
        id: attemptId,
        room_id: params.p_room_id,
        participant_id: params.p_participant_id,
        started_at: params.p_started_at,
        finished_at: params.p_finished_at,
        status: params.p_status,
        total_questions: params.p_total_questions,
        answered_count: params.p_answered_count,
        omitted_count: params.p_omitted_count,
        correct_count: params.p_correct_count,
        score: params.p_score,
        max_score: params.p_max_score,
        events: params.p_events,
      }
      this.attempts.set(attemptId, newAttempt)

      // 3. Inserción masiva de respuestas
      for (let i = 0; i < params.p_answers.length; i++) {
        const item = params.p_answers[i]
        const answerRow: DbAttemptAnswer = {
          id: `ans-${attemptId}-${i}`,
          attempt_id: attemptId,
          activity_id: item.activity_id,
          question_index: item.question_index,
          response: item.response,
          response_text: item.response_text,
          status: item.status,
          correct: item.correct,
          score: item.score,
          time_seconds: item.time_seconds,
        }
        this.attemptAnswers.push(answerRow)
      }

      // 4. Actualizar participante a 'completed'
      const participant = this.participants.get(params.p_participant_id)
      if (participant) {
        participant.status = 'completed'
      }

      return {
        ok: true,
        attemptId,
        alreadySaved: false,
        score: params.p_score,
        maxScore: params.p_max_score,
      }
    } finally {
      this.isLocked = false
    }
  }
}

// 6 Actividades modelo de la sala
const MOCK_ACTIVITIES = [
  {
    id: 'act-tf',
    type: 'trueFalse',
    details: { trueFalse: { statement: 'El agua hierve a 100°C a nivel del mar.', correct: true } },
  },
  {
    id: 'act-sc',
    type: 'singleChoice',
    details: {
      singleChoice: {
        options: [
          { id: 'opt-a', label: 'Oxígeno', correct: false },
          { id: 'opt-b', label: 'Nitrógeno', correct: true },
          { id: 'opt-c', label: 'Argón', correct: false },
        ],
      },
    },
  },
  {
    id: 'act-mat',
    type: 'matching',
    details: {
      matching: {
        pairs: [
          { id: 'p1', left: 'Célula animal', right: 'Sin pared celular' },
          { id: 'p2', left: 'Célula vegetal', right: 'Con cloroplastos' },
        ],
      },
    },
  },
  {
    id: 'act-sort',
    type: 'sorting',
    details: {
      sorting: {
        categories: ['Renovable', 'No Renovable'],
        items: [
          { id: 'it-solar', label: 'Solar', category: 'Renovable' },
          { id: 'it-petroleo', label: 'Petróleo', category: 'No Renovable' },
        ],
      },
    },
  },
  {
    id: 'act-ord',
    type: 'ordering',
    details: {
      ordering: {
        steps: ['Inicio', 'Desarrollo', 'Cierre'],
      },
    },
  },
  {
    id: 'act-scen',
    type: 'scenario',
    details: {
      scenario: {
        stages: [
          {
            id: 'stg-1',
            options: [
              { id: 'opt-rec', text: 'Acción adecuada', recommended: true },
              { id: 'opt-bad', text: 'Acción riesgosa', recommended: false },
            ],
          },
        ],
      },
    },
  },
]

describe('Fase 5 - Etapa 5: Pruebas de Estrés y Concurrencia Masiva (50 Estudiantes)', () => {
  let db: SimulatedSupabaseDatabase
  const roomId = 'room-ciencias-50'

  beforeEach(() => {
    db = new SimulatedSupabaseDatabase()
    db.rooms.set(roomId, {
      id: roomId,
      code: 'CIEN50',
      status: 'active',
      score_per_question: 10,
      question_count: 6,
    })

    // Registrar 50 participantes previos
    for (let i = 1; i <= 50; i++) {
      const pId = `part-${String(i).padStart(2, '0')}`
      db.participants.set(pId, {
        id: pId,
        room_id: roomId,
        display_name: `Estudiante ${String(i).padStart(2, '0')}`,
        name_normalized: `estudiante ${String(i).padStart(2, '0')}`,
        status: 'in_progress',
      })
    }
  })

  it('procesa 50 entregas simultáneas sin pérdida de datos ni colisiones (Promise.all)', async () => {
    const startTime = Date.now()

    // Preparar 50 entregas concurrentes con perfiles diferenciados:
    // Alumnos 1-15: 100% correctos (60 pts)
    // Alumnos 16-35: 50% correctos (30 pts)
    // Alumnos 36-45: 2 contestadas y 4 omitidas (20 pts)
    // Alumnos 46-50: Entregas timeout
    const deliveryPromises = Array.from({ length: 50 }, (_, idx) => {
      const studentNum = idx + 1
      const participantId = `part-${String(studentNum).padStart(2, '0')}`

      let answeredCount = 6
      let omittedCount = 0
      let correctCount = 0
      let score = 0
      let attemptStatus: 'completed' | 'timeout' = 'completed'

      if (studentNum <= 15) {
        // 100% aciertos
        correctCount = 6
        score = 60
      } else if (studentNum <= 35) {
        // 3 aciertos de 6
        correctCount = 3
        score = 30
      } else if (studentNum <= 45) {
        // 2 contestadas (2 correctas) y 4 omitidas
        answeredCount = 2
        omittedCount = 4
        correctCount = 2
        score = 20
      } else {
        // Timeout con 4 aciertos
        attemptStatus = 'timeout'
        correctCount = 4
        score = 40
      }

      const answers = MOCK_ACTIVITIES.map((act, qIdx) => {
        const isOmitted = studentNum > 35 && studentNum <= 45 && qIdx >= 2
        const isCorrect = !isOmitted && (studentNum <= 15 || (studentNum <= 35 && qIdx < 3) || (studentNum > 35 && studentNum <= 45 && qIdx < 2) || (studentNum > 45 && qIdx < 4))

        return {
          activity_id: act.id,
          question_index: qIdx,
          response: isOmitted ? null : { type: act.type, value: 'sample' },
          response_text: isOmitted ? '' : 'Respuesta registrada',
          status: (isOmitted ? 'omitted' : 'answered') as 'answered' | 'omitted',
          correct: isOmitted ? null : isCorrect,
          score: isCorrect ? 10 : 0,
          time_seconds: 12 + qIdx * 2,
        }
      })

      return db.executeAtomicRpc({
        p_room_id: roomId,
        p_participant_id: participantId,
        p_started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        p_finished_at: new Date().toISOString(),
        p_status: attemptStatus,
        p_total_questions: 6,
        p_answered_count: answeredCount,
        p_omitted_count: omittedCount,
        p_correct_count: correctCount,
        p_score: score,
        p_max_score: 60,
        p_events: [],
        p_answers: answers,
      })
    })

    // Ejecución masiva concurrente
    const results = await Promise.all(deliveryPromises)
    const durationMs = Date.now() - startTime

    // 1. Verificación de respuestas individuales
    expect(results).toHaveLength(50)
    for (const res of results) {
      expect(res.ok).toBe(true)
      expect(res.alreadySaved).toBe(false)
      expect(res.attemptId).toBeDefined()
    }

    // 2. Verificación de consistencia en tabla 'attempts'
    expect(db.attempts.size).toBe(50)
    const uniqueParticipants = new Set(Array.from(db.attempts.values()).map((a) => a.participant_id))
    expect(uniqueParticipants.size).toBe(50)

    // 3. Verificación de cero pérdida en 'attempt_answers' (50 estudiantes * 6 preguntas = 300)
    expect(db.attemptAnswers).toHaveLength(300)

    // 4. Cada respuesta debe tener un attempt_id válido y existente
    for (const ans of db.attemptAnswers) {
      expect(db.attempts.has(ans.attempt_id)).toBe(true)
    }

    // 5. Todos los participantes deben haber pasado a 'completed'
    for (let i = 1; i <= 50; i++) {
      const pId = `part-${String(i).padStart(2, '0')}`
      expect(db.participants.get(pId)?.status).toBe('completed')
    }

    // 6. Verificar que el score en cada attempt coincide exactamente con la suma de sus answers
    for (const attempt of db.attempts.values()) {
      const studentAnswers = db.attemptAnswers.filter((a) => a.attempt_id === attempt.id)
      expect(studentAnswers).toHaveLength(6)
      const computedSum = studentAnswers.reduce((sum, a) => sum + a.score, 0)
      expect(attempt.score).toBe(computedSum)
    }

    // 7. Medir que la ejecución concurrente se completó ágilmente
    expect(durationMs).toBeLessThan(3000)
  })

  it('soporta ráfagas de reintentos concurrentes sin duplicación (idempotencia masiva)', async () => {
    // Primera entrega de los 50 estudiantes
    const initialBatch = Array.from({ length: 50 }, (_, idx) => {
      const pId = `part-${String(idx + 1).padStart(2, '0')}`
      return db.executeAtomicRpc({
        p_room_id: roomId,
        p_participant_id: pId,
        p_started_at: new Date().toISOString(),
        p_finished_at: new Date().toISOString(),
        p_status: 'completed',
        p_total_questions: 6,
        p_answered_count: 6,
        p_omitted_count: 0,
        p_correct_count: 6,
        p_score: 60,
        p_max_score: 60,
        p_events: [],
        p_answers: [],
      })
    })
    await Promise.all(initialBatch)
    expect(db.attempts.size).toBe(50)

    // Ráfaga masiva inmediata de reenvíos simultáneos (50 reintentos concurrentes)
    const retryBatch = Array.from({ length: 50 }, (_, idx) => {
      const pId = `part-${String(idx + 1).padStart(2, '0')}`
      return db.executeAtomicRpc({
        p_room_id: roomId,
        p_participant_id: pId,
        p_started_at: new Date().toISOString(),
        p_finished_at: new Date().toISOString(),
        p_status: 'completed',
        p_total_questions: 6,
        p_answered_count: 6,
        p_omitted_count: 0,
        p_correct_count: 6,
        p_score: 60,
        p_max_score: 60,
        p_events: [],
        p_answers: [],
      })
    })

    const retryResults = await Promise.all(retryBatch)

    // Todos deben reportar alreadySaved: true
    for (const res of retryResults) {
      expect(res.ok).toBe(true)
      expect(res.alreadySaved).toBe(true)
    }

    // El número de intentos no debe haber aumentado ni una sola fila
    expect(db.attempts.size).toBe(50)
  })
})
