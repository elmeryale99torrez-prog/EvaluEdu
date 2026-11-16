import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import crypto from 'crypto'
import {
  loadRealEdgeFunctions,
  createMockDbStore,
  setActiveMockDbStore,
  installNetworkGuard,
  restoreNetworkGuard,
  executeGuestSubmission,
  executeSyncSubmission,
  type RequestHandler,
  type MockDbStore,
} from './edgeFunctionAdapter'
import { activitiesFixtures } from '../fixtures/activitiesFixtures'

const TYPE_TO_PREFIX: Record<string, string> = {
  trueFalse: 'TF',
  singleChoice: 'SC',
  matching: 'MAT',
  sorting: 'SRT',
  ordering: 'ORD',
  scenario: 'SCN',
  multiSelect: 'MS',
  fillBlanks: 'FB',
  spotError: 'SE',
  markWords: 'MW',
  gridCheck: 'GC',
  vennDiagram: 'VN',
  shortAnswer: 'SA',
}

const TYPE_TO_NUM: Record<string, number> = {
  trueFalse: 1,
  singleChoice: 2,
  matching: 3,
  sorting: 4,
  ordering: 5,
  scenario: 6,
  multiSelect: 7,
  fillBlanks: 8,
  spotError: 9,
  markWords: 10,
  gridCheck: 11,
  vennDiagram: 12,
  shortAnswer: 13,
}

describe('Arnés y Suite de Pruebas de Código Real de Backend (LAB-B-002)', () => {
  let guestHandler: RequestHandler
  let syncHandler: RequestHandler
  let mockStore: MockDbStore

  const baseRoom = {
    id: '7b1c4e20-3d8a-4c11-b9f0-123456789abc',
    owner_id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Sala de Evaluación Canónica',
    code: 'EVAL100',
    instructions: 'Instrucciones oficiales del examen.',
    status: 'active',
    question_count: 1,
    student_limit: 50,
    time_minutes: 60,
    score_per_question: 10,
    shuffle_questions: false,
    allow_back: true,
  }

  beforeAll(async () => {
    installNetworkGuard()
    const handlers = await loadRealEdgeFunctions()
    guestHandler = handlers.guestHandler
    syncHandler = handlers.syncHandler
  })

  beforeEach(() => {
    mockStore = createMockDbStore()
    setActiveMockDbStore(mockStore)
  })

  afterAll(() => {
    restoreNetworkGuard()
    delete (globalThis as any).Deno
  })

  // Helper para preparar la sala con una actividad específica
  function setupRoomWithActivity(activityKey: string, customRoom?: any) {
    const fixture = activitiesFixtures[activityKey]
    const room = {
      ...(customRoom ?? baseRoom),
      question_count: customRoom?.question_count ?? 1,
    }
    mockStore.rooms.set(room.id, room)

    const actData = {
      ...fixture.activity,
      answer:
        (fixture.activity as any).details?.[activityKey]?.correct ??
        (fixture.activity as any).details?.[activityKey]?.acceptedAnswers?.[0] ??
        'dummy-answer',
    }
    mockStore.activities.set(fixture.activity.id, actData)

    mockStore.roomActivities.set(room.id, [
      {
        room_id: room.id,
        activity_id: fixture.activity.id,
        position: 1,
      },
    ])

    return { room, fixture }
  }

  // =========================================================================
  // SECCIÓN 1: Control de Red, Aislamiento y Filtros del Arnés (R2)
  // =========================================================================
  describe('Controles de Aislamiento, Red y Filtros del Arnés (R2)', () => {
    it('[CASO-CTRL-NETGUARD-STR] Intercepta y bloquea fetch con string URL externa', async () => {
      expect(() => {
        fetch('https://api.supabase.com/v1/prohibited-call')
      }).toThrow(/RED NO AUTORIZADA/)
    })

    it('[CASO-CTRL-NETGUARD-URL] Intercepta y bloquea fetch con instancia URL externa', async () => {
      expect(() => {
        fetch(new URL('https://malicious.org/data'))
      }).toThrow(/RED NO AUTORIZADA/)
    })

    it('[CASO-CTRL-NETGUARD-REQ] Intercepta y bloquea fetch con instancia Request externa', async () => {
      expect(() => {
        fetch(new Request('https://evil.corp/payload'))
      }).toThrow(/RED NO AUTORIZADA/)
    })

    it('[CASO-CTRL-NETGUARD-DECEPTIVE-HOST] Intercepta y bloquea host engañoso con prefijo localhost', async () => {
      expect(() => {
        fetch('http://localhost.example.com/api/steal')
      }).toThrow(/RED NO AUTORIZADA/)
    })

    it('[CASO-CTRL-NETGUARD-DECEPTIVE-IP] Intercepta y bloquea host engañoso con prefijo 127.0.0.1', async () => {
      expect(() => {
        fetch('http://127.0.0.1.attacker.com/leak')
      }).toThrow(/RED NO AUTORIZADA/)
    })

    it('[CASO-CTRL-MOCKDB-FILTERS] Controles positivos y negativos de filtros gt, neq y order en MockDbStore', async () => {
      // 1. Control de neq en participantes
      mockStore.participants.set('p-active-1', { id: 'p-active-1', code: 'EVAL-F', status: 'active' })
      mockStore.participants.set('p-aband-1', { id: 'p-aband-1', code: 'EVAL-F', status: 'abandoned' })

      const activeQuery = await (mockStore as any)
      // Construir cliente para verificar execute()
      const client = (await import('./edgeFunctionAdapter')).buildMockSupabaseClient(mockStore)

      const nonAbandoned = await client.from('room_participants').select('*').eq('code', 'EVAL-F').neq('status', 'abandoned')
      expect(nonAbandoned.data.id).toBe('p-active-1')

      // 2. Control de gt (expiración de tokens)
      const pastDate = new Date(Date.now() - 100000).toISOString()
      const futureDate = new Date(Date.now() + 100000).toISOString()
      const nowIso = new Date().toISOString()

      mockStore.participants.clear()
      mockStore.participants.set('p-exp', { id: 'p-exp', code: 'EVAL-G', guest_token_expires_at: pastDate })
      mockStore.participants.set('p-val', { id: 'p-val', code: 'EVAL-G', guest_token_expires_at: futureDate })

      const validTokens = await client.from('room_participants').select('*').eq('code', 'EVAL-G').gt('guest_token_expires_at', nowIso)
      expect(validTokens.data.id).toBe('p-val')

      // 3. Control de order en room_activities
      mockStore.roomActivities.set('room-ord', [
        { room_id: 'room-ord', activity_id: 'act-3', position: 3 },
        { room_id: 'room-ord', activity_id: 'act-1', position: 1 },
        { room_id: 'room-ord', activity_id: 'act-2', position: 2 },
      ])

      const orderedAsc = await client.from('room_activities').select('*').eq('room_id', 'room-ord').order('position', { ascending: true })
      expect(orderedAsc.data.map((r: any) => r.position)).toEqual([1, 2, 3])

      const orderedDesc = await client.from('room_activities').select('*').eq('room_id', 'room-ord').order('position', { ascending: false })
      expect(orderedDesc.data.map((r: any) => r.position)).toEqual([3, 2, 1])
    })
  })

  // =========================================================================
  // SECCIÓN 2: Los 52 Casos Base en student-room-guest (submit_attempt)
  // =========================================================================
  describe('Evaluación de las 13 Actividades en student-room-guest (GST)', () => {
    const activityKeys = Object.keys(activitiesFixtures)

    for (const type of activityKeys) {
      const pfx = TYPE_TO_PREFIX[type]
      const num = TYPE_TO_NUM[type]

      describe(`Actividad: ${type} (Guest)`, () => {
        it(`[CASO-${pfx}-CORR-GST] ${type} - Respuesta Válida`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const result = await executeGuestSubmission(
            guestHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.validResponse }],
            `10.0.${num}.1`,
            `Alumno ${type} Valido`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.ok).toBe(true)

          if (type === 'shortAnswer') {
            // FALLA DIAGNÓSTICA ESPERADA (P0-01): compare() no implementa shortAnswer
            expect(result.submitData.score).toBe(10)
          } else {
            expect(result.submitData.score).toBe(10)
            expect(result.lastRpc?.args.p_correct_count).toBe(1)
          }
        })

        it(`[CASO-${pfx}-INCO-GST] ${type} - Respuesta Incorrecta`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const result = await executeGuestSubmission(
            guestHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.incorrectResponse }],
            `10.0.${num}.2`,
            `Alumno ${type} Invalido`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.ok).toBe(true)
          expect(result.submitData.score).toBe(0)
          expect(result.lastRpc?.args.p_correct_count).toBe(0)
        })

        it(`[CASO-${pfx}-OMIT-GST] ${type} - Respuesta Omitida`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const result = await executeGuestSubmission(
            guestHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.omittedResponse }],
            `10.0.${num}.3`,
            `Alumno ${type} Omitido`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.ok).toBe(true)
          expect(result.submitData.score).toBe(0)
          expect(result.lastRpc?.args.p_omitted_count).toBe(1)
        })

        it(`[CASO-${pfx}-MANI-GST] ${type} - Respuesta Manipulada`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const result = await executeGuestSubmission(
            guestHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.manipulatedResponse }],
            `10.0.${num}.4`,
            `Alumno ${type} Manipulado`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.score).toBe(0)
        })
      })
    }
  })

  // =========================================================================
  // SECCIÓN 3: Los 52 Casos Base en student-room-sync (submit_attempt)
  // =========================================================================
  describe('Evaluación de las 13 Actividades en student-room-sync (SNC)', () => {
    const activityKeys = Object.keys(activitiesFixtures)

    for (const type of activityKeys) {
      const pfx = TYPE_TO_PREFIX[type]
      const num = TYPE_TO_NUM[type]
      const hexNum = num.toString(16).padStart(2, '0')

      describe(`Actividad: ${type} (Sync)`, () => {
        it(`[CASO-${pfx}-CORR-SNC] ${type} - Respuesta Válida`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const authUser = { id: `550e8400-e29b-41d4-a716-44665544${hexNum}01`, is_anonymous: true }
          const result = await executeSyncSubmission(
            syncHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.validResponse }],
            authUser,
            `Alumno Sync ${type} Valido`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.ok).toBe(true)

          if (type === 'shortAnswer') {
            // FALLA DIAGNÓSTICA ESPERADA (P0-01): compare() no implementa shortAnswer
            expect(result.submitData.score).toBe(10)
          } else {
            expect(result.submitData.score).toBe(10)
            expect(result.lastRpc?.args.p_correct_count).toBe(1)
          }
        })

        it(`[CASO-${pfx}-INCO-SNC] ${type} - Respuesta Incorrecta`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const authUser = { id: `550e8400-e29b-41d4-a716-44665544${hexNum}02`, is_anonymous: true }
          const result = await executeSyncSubmission(
            syncHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.incorrectResponse }],
            authUser,
            `Alumno Sync ${type} Invalido`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.ok).toBe(true)
          expect(result.submitData.score).toBe(0)
          expect(result.lastRpc?.args.p_correct_count).toBe(0)
        })

        it(`[CASO-${pfx}-OMIT-SNC] ${type} - Respuesta Omitida`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const authUser = { id: `550e8400-e29b-41d4-a716-44665544${hexNum}03`, is_anonymous: true }
          const result = await executeSyncSubmission(
            syncHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.omittedResponse }],
            authUser,
            `Alumno Sync ${type} Omitido`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.ok).toBe(true)
          expect(result.submitData.score).toBe(0)
          expect(result.lastRpc?.args.p_omitted_count).toBe(1)
        })

        it(`[CASO-${pfx}-MANI-SNC] ${type} - Respuesta Manipulada`, async () => {
          const { room, fixture } = setupRoomWithActivity(type)
          const authUser = { id: `550e8400-e29b-41d4-a716-44665544${hexNum}04`, is_anonymous: true }
          const result = await executeSyncSubmission(
            syncHandler,
            room,
            [{ activityId: fixture.activity.id, response: fixture.manipulatedResponse }],
            authUser,
            `Alumno Sync ${type} Manipulado`
          )

          expect(result.submitStatus).toBe(201)
          expect(result.submitData.score).toBe(0)
        })
      })
    }
  })

  // =========================================================================
  // SECCIÓN 4: Ocurrencias, Denominador y Mezcla (OC-01 a OC-06) (R1)
  // =========================================================================
  describe('Pruebas de Ocurrencias y Denominador (OC-01 a OC-06 / R1)', () => {
    it('[CASO-OC-01-CTRL-GST] Control de definiciones distintas: dos preguntas autorizadas con respuestas diferenciables evalúan individualmente (Guest)', async () => {
      // Control: verifica que dos actividades distintas en pos 1 y 2 evalúan individualmente
      const room = { ...baseRoom, question_count: 2 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })

      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      // Posición 1 correcta, Posición 2 incorrecta
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: scFixture.activity.id, response: scFixture.incorrectResponse },
        ],
        '10.0.20.1',
        'Alumno Dos Preguntas Diferenciables'
      )

      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(10)
      expect(result.lastRpc?.args.p_correct_count).toBe(1)
      expect(result.lastRpc?.args.p_total_questions).toBe(2)
    })

    it('[CASO-OC-01-CTRL-SNC] Control de definiciones distintas: dos preguntas autorizadas con respuestas diferenciables evalúan individualmente (Sync)', async () => {
      const room = { ...baseRoom, question_count: 2 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })

      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: scFixture.activity.id, response: scFixture.incorrectResponse },
        ],
        { id: '550e8400-e29b-41d4-a716-446655440051', is_anonymous: true },
        'Alumno Sync Dos Preguntas'
      )

      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(10)
      expect(result.lastRpc?.args.p_correct_count).toBe(1)
      expect(result.lastRpc?.args.p_total_questions).toBe(2)
    })

    it('[CASO-OC-01-SAME-DEF-GST] Misma definición en dos posiciones legítimas con respuestas distintas debe asociar cada ocurrencia (Guest / S1)', async () => {
      // S1: Misma activityId en dos vínculos legítimos de la sala (pos 1 y pos 2)
      const room = { ...baseRoom, question_count: 2 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })

      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 2 },
      ])

      // Estudiante responde válidamente en la ocurrencia de pos 1 y erróneamente en la ocurrencia de pos 2
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse, index: 0 },
          { activityId: tfFixture.activity.id, response: tfFixture.incorrectResponse, index: 1 },
        ],
        '10.0.20.2',
        'Alumno Misma Definicion Guest'
      )

      expect(result.submitStatus).toBe(201)
      // Inspección de asociación por ocurrencia en datos enviados a RPC:
      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S1):
      // Cada registro en p_answers debe asociarse a su identidad de ocurrencia única (occurrence_id o room_activity_id).
      // FALLA porque el protocolo actual colapsa ambas ocurrencias sobre activity_id sin rastreo de occurrenceId.
      const pAnswers = result.lastRpc?.args.p_answers ?? []
      expect(pAnswers.length).toBe(2)
      expect(pAnswers[0].occurrence_id).toBeDefined()
      expect(pAnswers[1].occurrence_id).toBeDefined()
      expect(pAnswers[0].occurrence_id).not.toEqual(pAnswers[1].occurrence_id)
    })

    it('[CASO-OC-01-SAME-DEF-SNC] Misma definición en dos posiciones legítimas con respuestas distintas debe asociar cada ocurrencia (Sync / S1)', async () => {
      const room = { ...baseRoom, question_count: 2 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })

      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 2 },
      ])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse, index: 0 },
          { activityId: tfFixture.activity.id, response: tfFixture.incorrectResponse, index: 1 },
        ],
        { id: '550e8400-e29b-41d4-a716-446655440052', is_anonymous: true },
        'Alumno Misma Definicion Sync'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S1)
      const pAnswers = result.lastRpc?.args.p_answers ?? []
      expect(pAnswers.length).toBe(2)
      expect(pAnswers[0].occurrence_id).toBeDefined()
      expect(pAnswers[1].occurrence_id).toBeDefined()
      expect(pAnswers[0].occurrence_id).not.toEqual(pAnswers[1].occurrence_id)
    })

    it('[CASO-OC-02-GST] Duplicación inválida: misma ocurrencia enviada dos veces debe ser rechazada explícitamente (Guest)', async () => {
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: tfFixture.activity.id, position: 1 }])

      // Payload abusivo con 2 respuestas a la misma única pregunta
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
        ],
        '10.0.20.2',
        'Alumno Duplicador'
      )

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // El servidor debe rechazar la duplicación con HTTP 400 Bad Request.
      // FALLA porque el servidor actual responde 201 y evalúa respuestas en bucle sin deduplicar ocurrencia.
      expect(result.submitStatus).toBe(400)
    })

    it('[CASO-OC-02-SNC] Duplicación inválida: misma ocurrencia enviada dos veces debe ser rechazada explícitamente (Sync)', async () => {
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: tfFixture.activity.id, position: 1 }])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
        ],
        { id: '550e8400-e29b-41d4-a716-446655440052', is_anonymous: true },
        'Alumno Sync Duplicador'
      )

      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitStatus).toBe(400)
    })

    it('[CASO-OC-03-GST-DEN] Ocurrencia faltante: preservación del total y denominador de 5 preguntas autorizadas (Guest)', async () => {
      // Sala con 5 preguntas oficialmente vinculadas
      const room = { ...baseRoom, question_count: 5, score_per_question: 10 }
      mockStore.rooms.set(room.id, room)

      const actKeys = ['trueFalse', 'singleChoice', 'matching', 'sorting', 'ordering']
      const links = actKeys.map((k, idx) => {
        const fix = activitiesFixtures[k]
        mockStore.activities.set(fix.activity.id, { ...fix.activity, answer: 'ok' })
        return { room_id: room.id, activity_id: fix.activity.id, position: idx + 1 }
      })
      mockStore.roomActivities.set(room.id, links)

      // Estudiante solo envía respuesta a la 1ª pregunta
      const tfFixture = activitiesFixtures.trueFalse
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: tfFixture.activity.id, response: tfFixture.validResponse }],
        '10.0.20.3',
        'Alumno Omision Denominador'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (P0-04 RED):
      // La sala tiene 5 preguntas autorizadas; total_questions debe ser 5 y maxScore 50.
      // FALLA porque el servidor calcula el denominador a partir de evaluated.length (1).
      expect(result.lastRpc?.args.p_total_questions).toBe(5)
      expect(result.submitData.maxScore).toBe(50)
    })

    it('[CASO-OC-03-GST-OMIT] Ocurrencia faltante: omisión automática de las 4 preguntas no contestadas (Guest)', async () => {
      const room = { ...baseRoom, question_count: 5, score_per_question: 10 }
      mockStore.rooms.set(room.id, room)

      const actKeys = ['trueFalse', 'singleChoice', 'matching', 'sorting', 'ordering']
      const links = actKeys.map((k, idx) => {
        const fix = activitiesFixtures[k]
        mockStore.activities.set(fix.activity.id, { ...fix.activity, answer: 'ok' })
        return { room_id: room.id, activity_id: fix.activity.id, position: idx + 1 }
      })
      mockStore.roomActivities.set(room.id, links)

      const tfFixture = activitiesFixtures.trueFalse
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: tfFixture.activity.id, response: tfFixture.validResponse }],
        '10.0.20.4',
        'Alumno Omision Contador'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (P0-04 RED):
      // De 5 preguntas autorizadas habiendo contestado 1, p_omitted_count debe ser 4.
      // FALLA porque el servidor no computa omisiones automáticas para ítems faltantes en el payload.
      expect(result.lastRpc?.args.p_omitted_count).toBe(4)
      expect(result.lastRpc?.args.p_correct_count).toBe(1)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-OC-03-SNC-DEN] Ocurrencia faltante: preservación del total y denominador de 5 preguntas autorizadas (Sync)', async () => {
      const room = { ...baseRoom, question_count: 5, score_per_question: 10 }
      mockStore.rooms.set(room.id, room)

      const actKeys = ['trueFalse', 'singleChoice', 'matching', 'sorting', 'ordering']
      const links = actKeys.map((k, idx) => {
        const fix = activitiesFixtures[k]
        mockStore.activities.set(fix.activity.id, { ...fix.activity, answer: 'ok' })
        return { room_id: room.id, activity_id: fix.activity.id, position: idx + 1 }
      })
      mockStore.roomActivities.set(room.id, links)

      const tfFixture = activitiesFixtures.trueFalse
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: tfFixture.activity.id, response: tfFixture.validResponse }],
        { id: '550e8400-e29b-41d4-a716-446655440053', is_anonymous: true },
        'Alumno Sync Omision Denominador'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (P0-04 RED)
      expect(result.lastRpc?.args.p_total_questions).toBe(5)
      expect(result.submitData.maxScore).toBe(50)
    })

    it('[CASO-OC-03-SNC-OMIT] Ocurrencia faltante: omisión automática de las 4 preguntas no contestadas (Sync)', async () => {
      const room = { ...baseRoom, question_count: 5, score_per_question: 10 }
      mockStore.rooms.set(room.id, room)

      const actKeys = ['trueFalse', 'singleChoice', 'matching', 'sorting', 'ordering']
      const links = actKeys.map((k, idx) => {
        const fix = activitiesFixtures[k]
        mockStore.activities.set(fix.activity.id, { ...fix.activity, answer: 'ok' })
        return { room_id: room.id, activity_id: fix.activity.id, position: idx + 1 }
      })
      mockStore.roomActivities.set(room.id, links)

      const tfFixture = activitiesFixtures.trueFalse
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: tfFixture.activity.id, response: tfFixture.validResponse }],
        { id: '550e8400-e29b-41d4-a716-446655440054', is_anonymous: true },
        'Alumno Sync Omision Contador'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (P0-04 RED)
      expect(result.lastRpc?.args.p_omitted_count).toBe(4)
      expect(result.lastRpc?.args.p_correct_count).toBe(1)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-OC-04-GST] Actividad u ocurrencia ajena no autorizada debe ser rechazada explícitamente (Guest)', async () => {
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: tfFixture.activity.id, position: 1 }])

      // Estudiante envía respuesta para una actividad ajena ('act-ajena-hack')
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: 'act-ajena-hack', response: { type: 'trueFalse', value: 'Verdadero' } }],
        '10.0.20.5',
        'Alumno Inyeccion Ajena'
      )

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // El servidor debe rechazar envíos con actividades ajenas a la sala con HTTP 400.
      // FALLA porque el servidor actual responde 201 y simplemente le otorga puntaje 0.
      expect(result.submitStatus).toBe(400)
    })

    it('[CASO-OC-04-SNC] Actividad u ocurrencia ajena no autorizada debe ser rechazada explícitamente (Sync)', async () => {
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: tfFixture.activity.id, position: 1 }])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: 'act-ajena-hack', response: { type: 'trueFalse', value: 'Verdadero' } }],
        { id: '550e8400-e29b-41d4-a716-446655440055', is_anonymous: true },
        'Alumno Sync Inyeccion Ajena'
      )

      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitStatus).toBe(400)
    })

    it('[CASO-OC-05-CHAR-PMAP-GST] Caracterización: shuffle_questions carece de PresentationMap o token de permutación persistido (Guest / S1)', async () => {
      // Sala con mezcla activada
      const room = { ...baseRoom, question_count: 2, shuffle_questions: true }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })
      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.20.6' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Shuffle Join' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(data.ok).toBe(true)
      // Caracterización fehaciente (PASA): El servidor actual entrega las actividades pero carece
      // de PresentationMap o token de permutación, evidenciando que el orden es puramente del lado del cliente.
      expect(data.presentationMap).toBeUndefined()
    })

    it('[CASO-OC-05-ORDER-INVAR-GST] Invarianza de orden con estado aislado: contrasta envíos en orden canónico e invertido (Guest / S1)', async () => {
      const room = { ...baseRoom, question_count: 2, shuffle_questions: true }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })
      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      // Estudiante A: Envío en orden canónico [tf, sc] con estado aislado
      const resA = await executeGuestSubmission(
        guestHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: scFixture.activity.id, response: scFixture.validResponse },
        ],
        '10.0.20.71',
        'Alumno Orden Canonico Guest'
      )
      expect(resA.submitStatus).toBe(201)
      expect(resA.submitData.score).toBe(20)
      expect(resA.lastRpc?.args.p_correct_count).toBe(2)

      // Estudiante B: Envío en orden invertido [sc, tf] con estado completamente aislado
      const resB = await executeGuestSubmission(
        guestHandler,
        room,
        [
          { activityId: scFixture.activity.id, response: scFixture.validResponse },
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
        ],
        '10.0.20.72',
        'Alumno Orden Invertido Guest'
      )
      expect(resB.submitStatus).toBe(201)
      expect(resB.submitData.score).toBe(20)
      expect(resB.lastRpc?.args.p_correct_count).toBe(2)

      // Limitación registrada: La invarianza se deriva de la búsqueda Map.get(item.activityId) en memoria,
      // sin que el servidor verifique la secuencia esperada contra un PresentationMap antitrampas.
    })

    it('[CASO-OC-05-CHAR-PMAP-SNC] Caracterización: shuffle_questions carece de PresentationMap o token de permutación persistido (Sync / S1)', async () => {
      const room = { ...baseRoom, question_count: 2, shuffle_questions: true }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })
      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      const authUser = { id: '550e8400-e29b-41d4-a716-446655440056', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Sync Shuffle Join' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(data.ok).toBe(true)
      expect(data.presentationMap).toBeUndefined()
    })

    it('[CASO-OC-05-ORDER-INVAR-SNC] Invarianza de orden con estado aislado: contrasta envíos en orden canónico e invertido (Sync / S1)', async () => {
      const room = { ...baseRoom, question_count: 2, shuffle_questions: true }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })
      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      // Estudiante A: Envío en orden canónico [tf, sc] con authUser A
      const authUserA = { id: '550e8400-e29b-41d4-a716-446655440057', is_anonymous: true }
      const resA = await executeSyncSubmission(
        syncHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: scFixture.activity.id, response: scFixture.validResponse },
        ],
        authUserA,
        'Alumno Sync Orden Canonico'
      )
      expect(resA.submitStatus).toBe(201)
      expect(resA.submitData.score).toBe(20)
      expect(resA.lastRpc?.args.p_correct_count).toBe(2)

      // Estudiante B: Envío en orden invertido [sc, tf] con authUser B
      const authUserB = { id: '550e8400-e29b-41d4-a716-446655440058', is_anonymous: true }
      const resB = await executeSyncSubmission(
        syncHandler,
        room,
        [
          { activityId: scFixture.activity.id, response: scFixture.validResponse },
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
        ],
        authUserB,
        'Alumno Sync Orden Invertido'
      )
      expect(resB.submitStatus).toBe(201)
      expect(resB.submitData.score).toBe(20)
      expect(resB.lastRpc?.args.p_correct_count).toBe(2)
    })

    it('[CASO-OC-06-GST] Discrepancia question_count vs vínculos: reconciliación autoritativa (Guest)', async () => {
      // Sala declara question_count: 10 pero solo existen 2 vínculos autorizados
      const room = { ...baseRoom, question_count: 10, score_per_question: 10 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })
      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: scFixture.activity.id, response: scFixture.validResponse },
        ],
        '10.0.20.7',
        'Alumno Reconciliacion'
      )

      expect(result.submitStatus).toBe(201)
      // Reconciliación autoritativa: La evaluación se rige por los 2 vínculos válidos
      expect(result.lastRpc?.args.p_total_questions).toBe(2)
      expect(result.submitData.maxScore).toBe(20)
      expect(result.submitData.score).toBe(20)
      expect(result.lastRpc?.args.p_correct_count).toBe(2)
      expect(result.lastRpc?.args.p_omitted_count).toBe(0)
    })

    it('[CASO-OC-06-SNC] Discrepancia question_count vs vínculos: reconciliación autoritativa (Sync)', async () => {
      const room = { ...baseRoom, question_count: 10, score_per_question: 10 }
      mockStore.rooms.set(room.id, room)
      const tfFixture = activitiesFixtures.trueFalse
      const scFixture = activitiesFixtures.singleChoice

      mockStore.activities.set(tfFixture.activity.id, { ...tfFixture.activity, answer: 'Verdadero' })
      mockStore.activities.set(scFixture.activity.id, { ...scFixture.activity, answer: 'opt-mit' })
      mockStore.roomActivities.set(room.id, [
        { room_id: room.id, activity_id: tfFixture.activity.id, position: 1 },
        { room_id: room.id, activity_id: scFixture.activity.id, position: 2 },
      ])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [
          { activityId: tfFixture.activity.id, response: tfFixture.validResponse },
          { activityId: scFixture.activity.id, response: scFixture.validResponse },
        ],
        { id: '550e8400-e29b-41d4-a716-446655440057', is_anonymous: true },
        'Alumno Sync Reconciliacion'
      )

      expect(result.submitStatus).toBe(201)
      expect(result.lastRpc?.args.p_total_questions).toBe(2)
      expect(result.submitData.maxScore).toBe(20)
      expect(result.submitData.score).toBe(20)
      expect(result.lastRpc?.args.p_correct_count).toBe(2)
      expect(result.lastRpc?.args.p_omitted_count).toBe(0)
    })
  })

  // =========================================================================
  // SECCIÓN 5: Pruebas Normativas de Privacidad en las 13 Actividades (R3)
  // =========================================================================
  describe('Pruebas Normativas de Privacidad en las 13 Actividades (PRV / R3)', () => {
    // 1. trueFalse
    it('[CASO-PRV-TF-EXPL-GST] trueFalse: la proyección pública debe ocultar la explicación docente (Guest / UNI-P1-08)', async () => {
      const { room } = setupRoomWithActivity('trueFalse')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.1' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad TF' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const tf = data.activities.find((a: any) => a.type === 'trueFalse')

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-guest:379 expone explanation en safeDetails.trueFalse
      expect(tf.details?.trueFalse?.explanation).toBeUndefined()
    })

    it('[CASO-PRV-TF-EXPL-SNC] trueFalse: la proyección pública debe ocultar la explicación docente (Sync / UNI-P1-08)', async () => {
      const { room } = setupRoomWithActivity('trueFalse')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440091', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad TF Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const tf = data.activities.find((a: any) => a.type === 'trueFalse')

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-sync:325 expone explanation en safeDetails.trueFalse
      expect(tf.details?.trueFalse?.explanation).toBeUndefined()
    })

    // 2. singleChoice
    it('[CASO-PRV-SC-GST] singleChoice: oculta correct y explanation en proyección pública (Guest)', async () => {
      const { room } = setupRoomWithActivity('singleChoice')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.2' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad SC' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const sc = data.activities.find((a: any) => a.type === 'singleChoice')

      expect(sc.details?.singleChoice?.explanation).toBeUndefined()
      expect(sc.details?.singleChoice?.options.every((o: any) => o.correct === false || o.correct === undefined)).toBe(true)
    })

    it('[CASO-PRV-SC-SNC] singleChoice: oculta correct y explanation en proyección pública (Sync)', async () => {
      const { room } = setupRoomWithActivity('singleChoice')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440092', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad SC Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const sc = data.activities.find((a: any) => a.type === 'singleChoice')

      expect(sc.details?.singleChoice?.explanation).toBeUndefined()
      expect(sc.details?.singleChoice?.options.every((o: any) => o.correct === false || o.correct === undefined)).toBe(true)
    })

    // 3. matching (Vulnerabilidad de Desplazamiento Cíclico)
    it('[CASO-PRV-MAT-SHIFT-REPRO-GST] matching: caracterización fehaciente del desplazamiento cíclico (Guest)', async () => {
      const { room } = setupRoomWithActivity('matching')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.3' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Mat Shift Repro' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const mat = data.activities.find((a: any) => a.type === 'matching')

      const originalPairs = activitiesFixtures.matching.activity.details!.matching!.pairs
      const projectedPairs = mat.details?.matching?.pairs

      // Demostración reproducible: El servidor aplica exactamente pairs[(i + 1) % n].right
      const matchesShift = projectedPairs.every(
        (p: any, i: number) => p.right === originalPairs[(i + 1) % originalPairs.length].right
      )
      expect(matchesShift).toBe(true)
    })

    it('[CASO-PRV-MAT-POLICY-NORMATIVE-GST] matching: la política pública debe producir permutaciones independientes y no una fórmula determinista estática (Guest / S2)', async () => {
      const { room } = setupRoomWithActivity('matching')
      // S2: En vez de prohibir una permutación en una sola corrida, evaluamos la política a través de 5 sesiones independientes.
      // Una política de mezcla aleatoria independiente produce variación entre sesiones (entropía > 0).
      // El servidor actual aplica una fórmula estática determinista pairs[(i+1)%n].right idéntica para todos los alumnos.
      const permutations = new Set<string>()

      for (let i = 1; i <= 5; i++) {
        const joinReq = new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.30.${10 + i}` },
          body: JSON.stringify({ action: 'join', code: room.code, displayName: `Alumno Mat Session ${i}` }),
        })
        const res = await guestHandler(joinReq)
        const data = await res.json()
        const mat = data.activities.find((a: any) => a.type === 'matching')
        permutations.add(JSON.stringify(mat.details?.matching?.pairs.map((p: any) => p.right)))
      }

      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S2):
      // Con una política de mezcla independiente legítima, 5 sesiones independientes generan permutaciones variadas (size > 1).
      // FALLA porque el servidor actual ejecuta una fórmula determinista estática idéntica en el 100% de las llamadas (size === 1).
      // Declaración formal: La inyección de PRNG con semilla controlada queda formalmente reservada para Fase C
      // al carecer el código actual de ganchos de inyección de generadores pseudoaleatorios.
      expect(permutations.size).toBeGreaterThan(1)
    })

    it('[CASO-PRV-MAT-SHIFT-REPRO-SNC] matching: caracterización fehaciente del desplazamiento cíclico (Sync)', async () => {
      const { room } = setupRoomWithActivity('matching')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440093', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Mat Shift Repro Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const mat = data.activities.find((a: any) => a.type === 'matching')

      const originalPairs = activitiesFixtures.matching.activity.details!.matching!.pairs
      const projectedPairs = mat.details?.matching?.pairs

      const matchesShift = projectedPairs.every(
        (p: any, i: number) => p.right === originalPairs[(i + 1) % originalPairs.length].right
      )
      expect(matchesShift).toBe(true)
    })

    it('[CASO-PRV-MAT-POLICY-NORMATIVE-SNC] matching: la política pública debe producir permutaciones independientes y no una fórmula determinista estática (Sync / S2)', async () => {
      const { room } = setupRoomWithActivity('matching')
      const permutations = new Set<string>()

      for (let i = 1; i <= 5; i++) {
        const authUser = { id: `550e8400-e29b-41d4-a716-4466554400a${i}`, is_anonymous: true }
        setActiveMockDbStore(mockStore, authUser)
        const joinReq = new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
          body: JSON.stringify({ action: 'join', code: room.code, displayName: `Alumno Mat Sync Session ${i}` }),
        })
        const res = await syncHandler(joinReq)
        const data = await res.json()
        const mat = data.activities.find((a: any) => a.type === 'matching')
        permutations.add(JSON.stringify(mat.details?.matching?.pairs.map((p: any) => p.right)))
      }

      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S2)
      expect(permutations.size).toBeGreaterThan(1)
    })

    // 4. sorting
    it('[CASO-PRV-SRT-GST] sorting: items no deben contener la categoría correcta (Guest)', async () => {
      const { room } = setupRoomWithActivity('sorting')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.5' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad Sorting' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const srt = data.activities.find((a: any) => a.type === 'sorting')

      expect(srt.details?.sorting?.items.every((item: any) => !item.category)).toBe(true)
    })

    it('[CASO-PRV-SRT-SNC] sorting: items no deben contener la categoría correcta (Sync)', async () => {
      const { room } = setupRoomWithActivity('sorting')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440095', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad Sorting Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const srt = data.activities.find((a: any) => a.type === 'sorting')

      expect(srt.details?.sorting?.items.every((item: any) => !item.category)).toBe(true)
    })

    // 5. ordering (Inversión Simétrica)
    it('[CASO-PRV-ORD-DEFECT-REPRO-GST] ordering: caracterización fehaciente del defecto de inversión simétrica (Guest)', async () => {
      const { room } = setupRoomWithActivity('ordering')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.6' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Ordering Repro' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const ord = data.activities.find((a: any) => a.type === 'ordering')

      const original = activitiesFixtures.ordering.activity.details!.ordering!.steps
      const projected = ord.details?.ordering?.steps

      expect(projected).toEqual([...original].reverse())
    })

    it('[CASO-PRV-ORD-POLICY-NORMATIVE-GST] ordering: la política pública debe producir permutaciones independientes y no una inversión determinista estática (Guest / S2)', async () => {
      const { room } = setupRoomWithActivity('ordering')
      // S2: Evaluamos la política de presentación a través de 5 sesiones independientes.
      // Una política de mezcla aleatoria independiente produce permutaciones variadas entre sesiones (entropía > 0).
      // El servidor actual aplica una inversión determinista estática [...steps].reverse() idéntica para todos los alumnos.
      const permutations = new Set<string>()

      for (let i = 1; i <= 5; i++) {
        const joinReq = new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.30.${20 + i}` },
          body: JSON.stringify({ action: 'join', code: room.code, displayName: `Alumno Ordering Session ${i}` }),
        })
        const res = await guestHandler(joinReq)
        const data = await res.json()
        const ord = data.activities.find((a: any) => a.type === 'ordering')
        permutations.add(JSON.stringify(ord.details?.ordering?.steps))
      }

      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S2):
      // Con una política de mezcla independiente, 5 sesiones independientes producen variación (size > 1).
      // FALLA porque el servidor actual ejecuta una inversión determinista fija idéntica en el 100% de las llamadas (size === 1).
      // Declaración formal: La verificación controlada con PRNG inyectado queda reservada para Fase C.
      expect(permutations.size).toBeGreaterThan(1)
    })

    it('[CASO-PRV-ORD-DEFECT-REPRO-SNC] ordering: caracterización fehaciente del defecto de inversión simétrica (Sync)', async () => {
      const { room } = setupRoomWithActivity('ordering')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440096', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Ordering Repro Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const ord = data.activities.find((a: any) => a.type === 'ordering')

      const original = activitiesFixtures.ordering.activity.details!.ordering!.steps
      const projected = ord.details?.ordering?.steps

      expect(projected).toEqual([...original].reverse())
    })

    it('[CASO-PRV-ORD-POLICY-NORMATIVE-SNC] ordering: la política pública debe producir permutaciones independientes y no una inversión determinista estática (Sync / S2)', async () => {
      const { room } = setupRoomWithActivity('ordering')
      const permutations = new Set<string>()

      for (let i = 1; i <= 5; i++) {
        const authUser = { id: `550e8400-e29b-41d4-a716-4466554400b${i}`, is_anonymous: true }
        setActiveMockDbStore(mockStore, authUser)
        const joinReq = new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
          body: JSON.stringify({ action: 'join', code: room.code, displayName: `Alumno Ordering Sync Session ${i}` }),
        })
        const res = await syncHandler(joinReq)
        const data = await res.json()
        const ord = data.activities.find((a: any) => a.type === 'ordering')
        permutations.add(JSON.stringify(ord.details?.ordering?.steps))
      }

      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S2)
      expect(permutations.size).toBeGreaterThan(1)
    })

    // 6. scenario (Separación de consequence y feedback)
    it('[CASO-PRV-SCN-CONSEQ-GST] scenario: la proyección pública debe ocultar consequence (Guest / UNI-P1-10)', async () => {
      const { room } = setupRoomWithActivity('scenario')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.8' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Scenario Conseq' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const scn = data.activities.find((a: any) => a.type === 'scenario')
      const opt = scn.details?.scenario?.stages?.[0]?.options?.[0]

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-guest:378 expone consequence en safeDetails.scenario
      expect(opt.consequence).toBeUndefined()
    })

    it('[CASO-PRV-SCN-FEEDBK-GST] scenario: la proyección pública debe ocultar feedback (Guest / UNI-P1-10)', async () => {
      const { room } = setupRoomWithActivity('scenario')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.9' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Scenario Feedbk' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const scn = data.activities.find((a: any) => a.type === 'scenario')
      const opt = scn.details?.scenario?.stages?.[0]?.options?.[0]

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-guest:378 expone feedback en safeDetails.scenario
      expect(opt.feedback).toBeUndefined()
    })

    it('[CASO-PRV-SCN-CONSEQ-SNC] scenario: la proyección pública debe ocultar consequence (Sync / UNI-P1-10)', async () => {
      const { room } = setupRoomWithActivity('scenario')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440098', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Scenario Conseq Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const scn = data.activities.find((a: any) => a.type === 'scenario')
      const opt = scn.details?.scenario?.stages?.[0]?.options?.[0]

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-sync:324 expone consequence en safeDetails.scenario
      expect(opt.consequence).toBeUndefined()
    })

    it('[CASO-PRV-SCN-FEEDBK-SNC] scenario: la proyección pública debe ocultar feedback (Sync / UNI-P1-10)', async () => {
      const { room } = setupRoomWithActivity('scenario')
      const authUser = { id: '550e8400-e29b-41d4-a716-446655440099', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Scenario Feedbk Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const scn = data.activities.find((a: any) => a.type === 'scenario')
      const opt = scn.details?.scenario?.stages?.[0]?.options?.[0]

      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-sync:324 expone feedback en safeDetails.scenario
      expect(opt.feedback).toBeUndefined()
    })

    // 7. multiSelect
    it('[CASO-PRV-MS-GST] multiSelect: oculta correct en opciones públicas (Guest)', async () => {
      const { room } = setupRoomWithActivity('multiSelect')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.10' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad MS' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const ms = data.activities.find((a: any) => a.type === 'multiSelect')

      expect(ms.details?.multiSelect?.options.every((o: any) => o.correct === false || o.correct === undefined)).toBe(true)
    })

    it('[CASO-PRV-MS-SNC] multiSelect: oculta correct en opciones públicas (Sync)', async () => {
      const { room } = setupRoomWithActivity('multiSelect')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009a', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad MS Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const ms = data.activities.find((a: any) => a.type === 'multiSelect')

      expect(ms.details?.multiSelect?.options.every((o: any) => o.correct === false || o.correct === undefined)).toBe(true)
    })

    // 8. fillBlanks
    it('[CASO-PRV-FB-GST] fillBlanks: blanks no contienen respuestas en proyección pública (Guest)', async () => {
      const { room } = setupRoomWithActivity('fillBlanks')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.11' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad FB' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const fb = data.activities.find((a: any) => a.type === 'fillBlanks')

      expect(fb.details?.fillBlanks?.blanks.every((b: any) => !b.answer)).toBe(true)
      expect(fb.details?.fillBlanks?.distractors.length).toBe(0)
    })

    it('[CASO-PRV-FB-SNC] fillBlanks: blanks no contienen respuestas en proyección pública (Sync)', async () => {
      const { room } = setupRoomWithActivity('fillBlanks')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009b', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad FB Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const fb = data.activities.find((a: any) => a.type === 'fillBlanks')

      expect(fb.details?.fillBlanks?.blanks.every((b: any) => !b.answer)).toBe(true)
      expect(fb.details?.fillBlanks?.distractors.length).toBe(0)
    })

    // 9. spotError
    it('[CASO-PRV-SE-GST] spotError: segmentos ocultan hasError en proyección pública (Guest)', async () => {
      const { room } = setupRoomWithActivity('spotError')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.12' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad SE' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const se = data.activities.find((a: any) => a.type === 'spotError')

      expect(se.details?.spotError?.segments.every((s: any) => s.hasError === false)).toBe(true)
    })

    it('[CASO-PRV-SE-SNC] spotError: segmentos ocultan hasError en proyección pública (Sync)', async () => {
      const { room } = setupRoomWithActivity('spotError')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009c', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad SE Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const se = data.activities.find((a: any) => a.type === 'spotError')

      expect(se.details?.spotError?.segments.every((s: any) => s.hasError === false)).toBe(true)
    })

    // 10. markWords (S3: Revisión de palabras, texto proyectado y reconstrucción de solución)
    it('[CASO-PRV-MW-WORDS-GST] markWords: palabras ocultan correct en proyección pública (Guest)', async () => {
      const { room } = setupRoomWithActivity('markWords')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.13' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad MW Words' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const mw = data.activities.find((a: any) => a.type === 'markWords')

      expect(mw.details?.markWords?.words.every((w: any) => w.correct === false)).toBe(true)
    })

    it('[CASO-PRV-MW-WORDS-SNC] markWords: palabras ocultan correct en proyección pública (Sync)', async () => {
      const { room } = setupRoomWithActivity('markWords')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009d', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad MW Words Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const mw = data.activities.find((a: any) => a.type === 'markWords')

      expect(mw.details?.markWords?.words.every((w: any) => w.correct === false)).toBe(true)
    })

    it('[CASO-PRV-MW-TEXT-GST] markWords: el texto proyectado no debe contener marcas o asteriscos de solución (Guest / S3)', async () => {
      const { room } = setupRoomWithActivity('markWords')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.16' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad MW Text' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const mw = data.activities.find((a: any) => a.type === 'markWords')

      const text = mw.details?.markWords?.text ?? ''
      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S3):
      // El texto público entregado al alumno NO debe contener marcas de solución como [palabra*].
      // FALLA porque student-room-guest:395 asigna directamente text: current.markWords.text conservando los asteriscos de respuesta.
      expect(text).not.toMatch(/\[.+?\*\]/)
    })

    it('[CASO-PRV-MW-TEXT-SNC] markWords: el texto proyectado no debe contener marcas o asteriscos de solución (Sync / S3)', async () => {
      const { room } = setupRoomWithActivity('markWords')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009f', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad MW Text Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const mw = data.activities.find((a: any) => a.type === 'markWords')

      const text = mw.details?.markWords?.text ?? ''
      // EXPECTATIVA NORMATIVA OBJETIVO (RED / S3)
      expect(text).not.toMatch(/\[.+?\*\]/)
    })

    it('[CASO-PRV-MW-RECONSTRUCT-GST] markWords: demostración de reconstrucción de solución desde el texto proyectado (Guest / S3)', async () => {
      const { room } = setupRoomWithActivity('markWords')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.17' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno MW Reconstruct Guest' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const mw = data.activities.find((a: any) => a.type === 'markWords')

      const text = mw.details?.markWords?.text ?? ''
      // Demostración de ataque: Un estudiante analiza el texto público y extrae todas las palabras marcadas con asterisco
      const matches = Array.from(text.matchAll(/\[([^\]]+?)\*\]/g)).map((m) => m[1].trim())

      // Verificación de que la reconstrucción obtiene el 100% de las respuestas correctas docentes
      expect(matches).toContain('ARN polimerasa II')
      expect(matches).toContain('ARN polimerasa I')
      expect(matches).not.toContain('ADN helicasa')
      expect(matches.length).toBe(2)
    })

    it('[CASO-PRV-MW-RECONSTRUCT-SNC] markWords: demostración de reconstrucción de solución desde el texto proyectado (Sync / S3)', async () => {
      const { room } = setupRoomWithActivity('markWords')
      const authUser = { id: '550e8400-e29b-41d4-a716-4466554400a0', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno MW Reconstruct Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const mw = data.activities.find((a: any) => a.type === 'markWords')

      const text = mw.details?.markWords?.text ?? ''
      const matches = Array.from(text.matchAll(/\[([^\]]+?)\*\]/g)).map((m) => m[1].trim())

      expect(matches).toContain('ARN polimerasa II')
      expect(matches).toContain('ARN polimerasa I')
      expect(matches).not.toContain('ADN helicasa')
      expect(matches.length).toBe(2)
    })

    // 11. gridCheck (S3: Validación de expectedCells real y control de sensibilidad)
    it('[CASO-PRV-GC-GST] gridCheck: no expone el campo real expectedCells ni alias privados (Guest / S3)', async () => {
      const { room } = setupRoomWithActivity('gridCheck')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.14' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad GC' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const gc = data.activities.find((a: any) => a.type === 'gridCheck')
      const gcd = gc.details?.gridCheck

      expect(gcd?.rows).toBeDefined()
      expect(gcd?.columns).toBeDefined()
      // Comprobación del campo contractual real expectedCells y cualquier alias privado
      expect(gcd?.expectedCells).toBeUndefined()
      expect(gcd?.cells).toBeUndefined()
      expect(gcd?.solutions).toBeUndefined()
      expect(gcd?.correctChecks).toBeUndefined()
    })

    it('[CASO-PRV-GC-SNC] gridCheck: no expone el campo real expectedCells ni alias privados (Sync / S3)', async () => {
      const { room } = setupRoomWithActivity('gridCheck')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009e', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad GC Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const gc = data.activities.find((a: any) => a.type === 'gridCheck')
      const gcd = gc.details?.gridCheck

      expect(gcd?.rows).toBeDefined()
      expect(gcd?.columns).toBeDefined()
      expect(gcd?.expectedCells).toBeUndefined()
      expect(gcd?.cells).toBeUndefined()
      expect(gcd?.solutions).toBeUndefined()
      expect(gcd?.correctChecks).toBeUndefined()
    })

    it('[CASO-CTRL-SENS-GC-PRIVACY] Control de sensibilidad: la inyección de expectedCells hace fallar al verificador de privacidad (S3)', () => {
      // Función verificadora de privacidad estricta para gridCheck
      function verifyGridCheckPrivacy(details: any) {
        expect(details?.rows).toBeDefined()
        expect(details?.columns).toBeDefined()
        expect(details?.expectedCells).toBeUndefined()
        expect(details?.cells).toBeUndefined()
        expect(details?.solutions).toBeUndefined()
      }

      // Payload limpio esperado
      const cleanPayload = {
        rows: [{ id: 'r1', label: 'Fila 1' }],
        columns: [{ id: 'c1', label: 'Col 1' }],
      }
      expect(() => verifyGridCheckPrivacy(cleanPayload)).not.toThrow()

      // Payload con fuga reintroducida (expectedCells privado)
      const leakedPayload = {
        ...cleanPayload,
        expectedCells: ['r1:c1'],
      }
      expect(() => verifyGridCheckPrivacy(leakedPayload)).toThrow()
    })

    // 12. vennDiagram
    it('[CASO-PRV-VN-GST] vennDiagram: items ocultan la zona asignada en proyección pública (Guest)', async () => {
      const { room } = setupRoomWithActivity('vennDiagram')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.15' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad VN' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const vn = data.activities.find((a: any) => a.type === 'vennDiagram')

      expect(vn.details?.vennDiagram?.items.every((i: any) => !i.zone)).toBe(true)
    })

    it('[CASO-PRV-VN-SNC] vennDiagram: items ocultan la zona asignada en proyección pública (Sync)', async () => {
      const { room } = setupRoomWithActivity('vennDiagram')
      const authUser = { id: '550e8400-e29b-41d4-a716-44665544009f', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad VN Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const vn = data.activities.find((a: any) => a.type === 'vennDiagram')

      expect(vn.details?.vennDiagram?.items.every((i: any) => !i.zone)).toBe(true)
    })

    // 13. shortAnswer
    it('[CASO-PRV-SA-GST] shortAnswer: oculta acceptedAnswers y explanation en proyección pública (Guest)', async () => {
      const { room } = setupRoomWithActivity('shortAnswer')
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.30.16' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad SA' }),
      })
      const res = await guestHandler(joinReq)
      const data = await res.json()
      const sa = data.activities.find((a: any) => a.type === 'shortAnswer')

      expect(sa.details?.shortAnswer?.acceptedAnswers).toBeUndefined()
      expect(sa.details?.shortAnswer?.explanation).toBeUndefined()
    })

    it('[CASO-PRV-SA-SNC] shortAnswer: oculta acceptedAnswers y explanation en proyección pública (Sync)', async () => {
      const { room } = setupRoomWithActivity('shortAnswer')
      const authUser = { id: '550e8400-e29b-41d4-a716-4466554400a0', is_anonymous: true }
      setActiveMockDbStore(mockStore, authUser)
      const joinReq = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-anon-jwt-token' },
        body: JSON.stringify({ action: 'join', code: room.code, displayName: 'Alumno Privacidad SA Sync' }),
      })
      const res = await syncHandler(joinReq)
      const data = await res.json()
      const sa = data.activities.find((a: any) => a.type === 'shortAnswer')

      expect(sa.details?.shortAnswer?.acceptedAnswers).toBeUndefined()
      expect(sa.details?.shortAnswer?.explanation).toBeUndefined()
    })
  })

  // =========================================================================
  // SECCIÓN 6: Casos Borde y Payloads Incompatibles en Backend (R3)
  // =========================================================================
  describe('Casos Borde de Backend y Payloads Incompatibles (R3)', () => {
    // 1. fillBlanks fichas repetidas
    it('[CASO-EDGE-FB-REP-GST] fillBlanks: dos ranuras con la misma palabra repetida vinculada a sala (Guest / UNI-P1-05)', async () => {
      const repeatActivity = {
        id: 'act-fb-repeat-linked',
        title: 'Cargas Subatómicas',
        type: 'fillBlanks',
        prompt: 'El catión es {{1}} y el protón es {{2}}.',
        options: ['positivo', 'negativo'],
        details: {
          fillBlanks: {
            textWithBlanks: 'El catión es {{1}} y el protón es {{2}}.',
            blanks: [
              { id: 'b1', answer: 'positivo' },
              { id: 'b2', answer: 'positivo' },
            ],
            distractors: ['negativo'],
            bank: ['positivo', 'negativo'],
          },
        },
      }
      mockStore.activities.set(repeatActivity.id, repeatActivity)
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: repeatActivity.id, position: 1 }])

      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: repeatActivity.id, response: { type: 'fillBlanks', answers: { b1: 'positivo', b2: 'positivo' } } }],
        '10.0.40.1',
        'Alumno FillBlanks Repetido'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (UNI-P1-05 RED):
      // Ambas ranuras fueron contestadas correctamente con "positivo", debe otorgar 10 puntos.
      // FALLA porque student-room-guest:172 ejecuta new Set(chosen).size === blanks.length
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-FB-REP-SNC] fillBlanks: dos ranuras con la misma palabra repetida vinculada a sala (Sync / UNI-P1-05)', async () => {
      const repeatActivity = {
        id: 'act-fb-repeat-sync',
        title: 'Cargas Subatómicas Sync',
        type: 'fillBlanks',
        prompt: 'El catión es {{1}} y el protón es {{2}}.',
        options: ['positivo', 'negativo'],
        details: {
          fillBlanks: {
            textWithBlanks: 'El catión es {{1}} y el protón es {{2}}.',
            blanks: [
              { id: 'b1', answer: 'positivo' },
              { id: 'b2', answer: 'positivo' },
            ],
            distractors: ['negativo'],
            bank: ['positivo', 'negativo'],
          },
        },
      }
      mockStore.activities.set(repeatActivity.id, repeatActivity)
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: repeatActivity.id, position: 1 }])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: repeatActivity.id, response: { type: 'fillBlanks', answers: { b1: 'positivo', b2: 'positivo' } } }],
        { id: '550e8400-e29b-41d4-a716-446655440077', is_anonymous: true },
        'Alumno Sync FillBlanks Repetido'
      )

      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (UNI-P1-05 RED)
      expect(result.submitData.score).toBe(10)
    })

    // 2. shortAnswer bordes en Backend (GST y SNC)
    it('[CASO-EDGE-SA-ACCENTS-TRUE-GST] shortAnswer: normalización de tildes activada califica correcto (Guest)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      // Fixture tiene acceptedAnswers: ['fotosíntesis', 'la fotosíntesis', 'fotosintesis'] con ignoreAccents: true
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: 'fotosintesis' } }],
        '10.0.40.2',
        'Alumno SA Tildes True'
      )
      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // FALLA porque student-room-guest no implementa compare() para shortAnswer y retorna 0.
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-SA-ACCENTS-TRUE-SNC] shortAnswer: normalización de tildes activada califica correcto (Sync)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: 'fotosintesis' } }],
        { id: '550e8400-e29b-41d4-a716-446655440078', is_anonymous: true },
        'Alumno Sync SA Tildes True'
      )
      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-SA-ACCENTS-FALSE-GST] shortAnswer: tildes estrictas rechaza respuesta sin tilde (Guest)', async () => {
      const saStrict = {
        ...activitiesFixtures.shortAnswer.activity,
        id: 'act-sa-strict-accents',
        details: {
          shortAnswer: {
            acceptedAnswers: ['célula'],
            caseSensitive: false,
            ignoreAccents: false,
          },
        },
      }
      mockStore.activities.set(saStrict.id, { ...saStrict, answer: 'célula' })
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: saStrict.id, position: 1 }])

      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: saStrict.id, response: { type: 'shortAnswer', value: 'celula' } }],
        '10.0.40.3',
        'Alumno SA Strict Accents'
      )
      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(0)
    })

    it('[CASO-EDGE-SA-ACCENTS-FALSE-SNC] shortAnswer: tildes estrictas rechaza respuesta sin tilde (Sync)', async () => {
      const saStrict = {
        ...activitiesFixtures.shortAnswer.activity,
        id: 'act-sa-strict-accents-sync',
        details: {
          shortAnswer: {
            acceptedAnswers: ['célula'],
            caseSensitive: false,
            ignoreAccents: false,
          },
        },
      }
      mockStore.activities.set(saStrict.id, { ...saStrict, answer: 'célula' })
      const room = { ...baseRoom, question_count: 1 }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [{ room_id: room.id, activity_id: saStrict.id, position: 1 }])

      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: saStrict.id, response: { type: 'shortAnswer', value: 'celula' } }],
        { id: '550e8400-e29b-41d4-a716-446655440079', is_anonymous: true },
        'Alumno Sync SA Strict Accents'
      )
      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(0)
    })

    it('[CASO-EDGE-SA-CASE-FALSE-GST] shortAnswer: mayúsculas insensibles acepta texto en mayúsculas (Guest)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: 'FOTOSÍNTESIS' } }],
        '10.0.40.4',
        'Alumno SA Case Insensitive'
      )
      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-SA-CASE-FALSE-SNC] shortAnswer: mayúsculas insensibles acepta texto en mayúsculas (Sync)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: 'FOTOSÍNTESIS' } }],
        { id: '550e8400-e29b-41d4-a716-44665544007a', is_anonymous: true },
        'Alumno Sync SA Case Insensitive'
      )
      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-SA-WHITESPACE-GST] shortAnswer: espacios redundantes alrededor del texto se normalizan (Guest)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: '   fotosíntesis   ' } }],
        '10.0.40.5',
        'Alumno SA Whitespace'
      )
      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-SA-WHITESPACE-SNC] shortAnswer: espacios redundantes alrededor del texto se normalizan (Sync)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: '   fotosíntesis   ' } }],
        { id: '550e8400-e29b-41d4-a716-44665544007b', is_anonymous: true },
        'Alumno Sync SA Whitespace'
      )
      expect(result.submitStatus).toBe(201)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.submitData.score).toBe(10)
    })

    it('[CASO-EDGE-SA-BLANK-OMIT-GST] shortAnswer: espacios en blanco puros se clasifican como omitido (Guest)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: '     ' } }],
        '10.0.40.6',
        'Alumno SA Blank Omit'
      )
      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(0)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED):
      // El backend debe considerar un string de solo espacios como respuesta omitida (p_omitted_count: 1).
      // FALLA porque el backend actual no normaliza espacios antes del cómputo de omisiones.
      expect(result.lastRpc?.args.p_omitted_count).toBe(1)
    })

    it('[CASO-EDGE-SA-BLANK-OMIT-SNC] shortAnswer: espacios en blanco puros se clasifican como omitido (Sync)', async () => {
      const { room, fixture } = setupRoomWithActivity('shortAnswer')
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'shortAnswer', value: '     ' } }],
        { id: '550e8400-e29b-41d4-a716-44665544007c', is_anonymous: true },
        'Alumno Sync SA Blank Omit'
      )
      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(0)
      // EXPECTATIVA NORMATIVA OBJETIVO (RED)
      expect(result.lastRpc?.args.p_omitted_count).toBe(1)
    })

    // 3. Payloads Incompatibles por Contrato
    it('[CASO-EDGE-INCOMPAT-PAYLOAD-GST] Payload incompatible enviado a actividad genera 0 puntos (Guest)', async () => {
      const { room, fixture } = setupRoomWithActivity('trueFalse')
      // Se envía payload estructurado de multiSelect hacia una actividad de tipo trueFalse
      const result = await executeGuestSubmission(
        guestHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'multiSelect', selected: [0, 1] } }],
        '10.0.40.7',
        'Alumno Incompat Payload'
      )
      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(0)
    })

    it('[CASO-EDGE-INCOMPAT-PAYLOAD-SNC] Payload incompatible enviado a actividad genera 0 puntos (Sync)', async () => {
      const { room, fixture } = setupRoomWithActivity('trueFalse')
      const result = await executeSyncSubmission(
        syncHandler,
        room,
        [{ activityId: fixture.activity.id, response: { type: 'multiSelect', selected: [0, 1] } }],
        { id: '550e8400-e29b-41d4-a716-44665544007d', is_anonymous: true },
        'Alumno Sync Incompat Payload'
      )
      expect(result.submitStatus).toBe(201)
      expect(result.submitData.score).toBe(0)
    })
  })
})
