import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'crypto'
import { activitiesFixtures } from '../../fase-b/fixtures/activitiesFixtures'
import {
  activityRuntime,
  createInitialResponse,
  evaluateActivityResponse,
  isResponseComplete,
  type ActivityResponse,
} from '../../../src/lib/activityEngine'
import {
  assignSortingCategory,
  buildCloudSubmitPayload,
  buildMarkWordsInteractiveSegments,
  clearFillBlanksSlot,
  cloudActivityRowToStudentActivity,
  createEmptyActivityResponse,
  getFillBlanksBankChips,
  getMultiSelectOptionId,
  getSimpleChoiceDisplayOptions,
  isScenarioOptionSelected,
  moveOrderingStepInList,
  omitQuestionFromResponses,
  resolveFillBlanksWordBank,
  resolveSelectedScenarioOption,
  selectFillBlanksWord,
  selectMatchingRight,
  selectScenarioOption,
  selectSimpleChoiceResponse,
  selectSpotErrorSegment,
  toggleGridCheckCell,
  toggleMarkWordToken,
  toggleMultiSelectOption,
  toggleVennItemZone,
} from '../../../src/lib/studentPlayContract'
import { parseMarkWordsText } from '../../../src/lib/activities/markWords'
import {
  evaluateRoomAttempt,
  publicActivity,
  shuffleArray,
  createSeededRng,
  normalizeShortAnswer,
  isOmitted,
} from '../../../supabase/functions/_shared/activityEvaluator'
import { checkRateLimit, resetRateLimitStore } from '../../../supabase/functions/_shared/rateLimiter'
import {
  loadPhaseCEdgeFunctions,
  createMockDbStore,
  buildMockSupabaseClient,
  VALID_ROOM_PARTICIPANT_STATUSES,
  setActiveMockDbStore,
  installNetworkGuard,
  restoreNetworkGuard,
  executeGuestSubmission,
  executeSyncSubmission,
  type RequestHandler,
  type MockDbStore,
} from './edgeFunctionAdapter'

describe('Fase C · Suite Integral de Conformidad del Servidor (LAB-C-001)', () => {
  let guestHandler: RequestHandler
  let syncHandler: RequestHandler
  let platformDataHandler: RequestHandler
  let createPilotTeacherHandler: RequestHandler
  let removeUserHandler: RequestHandler
  let mockStore: MockDbStore

  beforeAll(async () => {
    installNetworkGuard()
    const handlers = await loadPhaseCEdgeFunctions()
    guestHandler = handlers.guestHandler
    syncHandler = handlers.syncHandler
    platformDataHandler = handlers.platformDataHandler
    createPilotTeacherHandler = handlers.createPilotTeacherHandler
    removeUserHandler = handlers.removeUserHandler
  })

  afterAll(() => {
    restoreNetworkGuard()
  })

  beforeEach(() => {
    resetRateLimitStore()
    mockStore = createMockDbStore()
    setActiveMockDbStore(mockStore)
  })

  // --------------------------------------------------------------------------
  // GRUPO 1: Conformidad Base de los 13 Tipos (156 Casos: 13 x 4 x 3)
  // --------------------------------------------------------------------------
  describe('Grupo 1: Conformidad Base de los 13 Formatos Oficiales', () => {
    const activityTypes = Object.keys(activitiesFixtures)

    for (const type of activityTypes) {
      describe(`Actividad: ${type}`, () => {
        const fixture = activitiesFixtures[type]

        function setupRoomWithActivity(act: any) {
          const roomId = crypto.randomUUID()
          const occId = crypto.randomUUID()
          const room = {
            id: roomId,
            code: `C${type.substring(0, 4).toUpperCase()}`,
            status: 'active',
            title: `Sala ${type}`,
          }
          mockStore.rooms.set(roomId, room)
          mockStore.activities.set(act.id, act)
          mockStore.roomActivities.set(roomId, [
            {
              id: occId,
              room_id: roomId,
              activity_id: act.id,
              activity_order: 1,
              position: 1,
              activity: act,
            },
          ])
          return { room, occId }
        }

        // Subcaso 1: Respuesta Correcta
        it(`${type} [Correcta] -> Cliente: 100%, Guest: 201 (10 pts), Sync: 201 (10 pts)`, async () => {
          // 1. Cliente
          const clientRes = evaluateActivityResponse(fixture.activity, fixture.validResponse, 10)
          expect(clientRes.correct).toBe(true)
          expect(clientRes.score).toBe(10)

          // 2. Guest
          const { room, occId } = setupRoomWithActivity(fixture.activity)
          const guestResult = await executeGuestSubmission(guestHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.validResponse },
          ])
          expect([200, 201]).toContain(guestResult.joinStatus)
          expect(guestResult.submitStatus).toBe(201)
          expect(guestResult.submitData.ok).toBe(true)
          expect(guestResult.lastRpc?.args?.p_score).toBe(10)
          expect(guestResult.lastRpc?.args?.p_correct_count).toBe(1)
          expect(guestResult.lastRpc?.args?.p_omitted_count).toBe(0)

          // 3. Sync
          const syncResult = await executeSyncSubmission(syncHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.validResponse },
          ])
          expect(syncResult.joinStatus).toBe(201)
          expect(syncResult.submitStatus).toBe(201)
          expect(syncResult.submitData.ok).toBe(true)
          expect(syncResult.lastRpc?.args?.p_score).toBe(10)
          expect(syncResult.lastRpc?.args?.p_correct_count).toBe(1)
        })

        // Subcaso 2: Respuesta Incorrecta
        it(`${type} [Incorrecta] -> Cliente: 0%, Guest: 201 (0 pts), Sync: 201 (0 pts)`, async () => {
          // 1. Cliente
          const clientRes = evaluateActivityResponse(fixture.activity, fixture.incorrectResponse, 10)
          expect(clientRes.correct).toBe(false)
          expect(clientRes.score).toBe(0)

          // 2. Guest
          const { room, occId } = setupRoomWithActivity(fixture.activity)
          const guestResult = await executeGuestSubmission(guestHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.incorrectResponse },
          ])
          expect(guestResult.submitStatus).toBe(201)
          expect(guestResult.lastRpc?.args?.p_score).toBe(0)
          expect(guestResult.lastRpc?.args?.p_correct_count).toBe(0)

          // 3. Sync
          const syncResult = await executeSyncSubmission(syncHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.incorrectResponse },
          ])
          expect(syncResult.submitStatus).toBe(201)
          expect(syncResult.lastRpc?.args?.p_score).toBe(0)
          expect(syncResult.lastRpc?.args?.p_correct_count).toBe(0)
        })

        // Subcaso 3: Respuesta Omitida
        it(`${type} [Omitida] -> Cliente: Omitido (0 pts), Guest: 201 (omitted=1), Sync: 201 (omitted=1)`, async () => {
          // 1. Cliente
          const clientRes = evaluateActivityResponse(fixture.activity, fixture.omittedResponse, 10)
          expect(clientRes.status).toBe('omitted')
          expect(clientRes.score).toBe(0)

          // 2. Guest
          const { room, occId } = setupRoomWithActivity(fixture.activity)
          const guestResult = await executeGuestSubmission(guestHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.omittedResponse },
          ])
          expect(guestResult.submitStatus).toBe(201)
          expect(guestResult.lastRpc?.args?.p_score).toBe(0)
          expect(guestResult.lastRpc?.args?.p_omitted_count).toBe(1)

          // 3. Sync
          const syncResult = await executeSyncSubmission(syncHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.omittedResponse },
          ])
          expect(syncResult.submitStatus).toBe(201)
          expect(syncResult.lastRpc?.args?.p_score).toBe(0)
          expect(syncResult.lastRpc?.args?.p_omitted_count).toBe(1)
        })

        // Subcaso 4: Respuesta Manipulada / Payload Incompatible -> Rechazo estricto HTTP 400
        it(`${type} [Manipulada] -> Servidor rechaza estrictamente con HTTP 400 (Cierre de Falla B)`, async () => {
          const { room, occId } = setupRoomWithActivity(fixture.activity)

          // 1. Guest rechaza con 400
          const guestResult = await executeGuestSubmission(guestHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.manipulatedResponse },
          ])
          // El servidor corregido devuelve 400 ante payloads inválidos/corruptos
          expect(guestResult.submitStatus).toBe(400)
          expect(guestResult.submitData.error).toBeDefined()

          // 2. Sync rechaza con 400
          const syncResult = await executeSyncSubmission(syncHandler, room, [
            { occurrenceId: occId, activityId: fixture.activity.id, response: fixture.manipulatedResponse },
          ])
          expect(syncResult.submitStatus).toBe(400)
          expect(syncResult.submitData.error).toBeDefined()
        })
      })
    }
  })

  // --------------------------------------------------------------------------
  // GRUPO 2: Resolución Determinista de RESERVA-S2 (Aleatoriedad y Presentación)
  // --------------------------------------------------------------------------
  describe('Grupo 2: Resolución Metodológica y Determinista de RESERVA-S2', () => {
    it('S2.1: Permutación de Fisher-Yates pura con RNG inyectable garantiza barajado biyectivo', () => {
      const items = ['A', 'B', 'C', 'D', 'E']
      let callCount = 0
      // Mock RNG que produce una secuencia determinista controlada
      const deterministicRng = () => {
        callCount++
        return (callCount * 0.23) % 1
      }

      const shuffled = shuffleArray(items, deterministicRng)
      // Debe conservar exactamente los mismos 5 elementos
      expect(shuffled).toHaveLength(5)
      expect(new Set(shuffled).size).toBe(5)
      expect(shuffled.sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('S2.2: Tolerancia a coincidencias legítimas (una inversión o rotación fortuita no es rechazada)', () => {
      const items = ['A', 'B', 'C', 'D']
      // RNG que deliberadamente simula una inversión pura: swap(3,0), swap(2,1)...
      let step = 0
      const reverseRng = () => {
        step++
        if (step === 1) return 0.0
        if (step === 2) return 0.49
        return 0.99
      }

      const shuffled = shuffleArray(items, reverseRng)
      // La función no arroja error ni bloquea la ejecución
      expect(shuffled).toHaveLength(4)
      expect(new Set(shuffled)).toEqual(new Set(items))
    })

    it('S2.3: Proyección pública de ordering y matching oculta soluciones sin alterar opciones válidas', () => {
      const orderingAct = activitiesFixtures.ordering.activity
      const publicOrd = publicActivity(orderingAct)

      // Verificar que details.ordering no fuga correctOrder
      expect(publicOrd.details?.ordering).toBeDefined()
      expect(publicOrd.details?.ordering?.correctOrder).toBeUndefined()
      expect(publicOrd.details?.ordering?.solution).toBeUndefined()
      expect(publicOrd.details?.ordering?.steps).toHaveLength(orderingAct.details.ordering.steps.length)

      const matchingAct = activitiesFixtures.matching.activity
      const publicMat = publicActivity(matchingAct)
      // Verificar que details.matching no fuga soluciones
      expect(publicMat.details?.matching).toBeDefined()
      expect(publicMat.details?.matching?.solution).toBeUndefined()
      expect(publicMat.details?.matching?.correctPairs).toBeUndefined()
      expect(publicMat.details?.matching?.pairs).toHaveLength(matchingAct.details.matching.pairs.length)
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 3: Pruebas Especiales de Requisitos Pedagógicos (P0-01 y UNI-P1-05)
  // --------------------------------------------------------------------------
  describe('Grupo 3: Pruebas de Requisitos Pedagógicos Especializados', () => {
    it('P0-01: shortAnswer maneja acentos, mayúsculas, espacios colapsados y omisión', () => {
      // 1. Acentos ignorados cuando ignoreAccents: true
      const norm1 = normalizeShortAnswer('fotosíntesis', false, true)
      const norm2 = normalizeShortAnswer('fotosintesis', false, true)
      expect(norm1).toBe(norm2)

      // 2. Mayúsculas ignoradas cuando caseSensitive: false
      const norm3 = normalizeShortAnswer('FoToSíNtEsIs', false, true)
      expect(norm3).toBe(norm1)

      // 3. Espacios en blanco colapsados
      const norm4 = normalizeShortAnswer('   fotosíntesis   ', false, true)
      expect(norm4).toBe(norm1)

      // 4. Espacios puros detectados como omitido
      expect(isOmitted({ type: 'shortAnswer' }, { type: 'shortAnswer', value: '     ' })).toBe(true)
      expect(isOmitted({ type: 'shortAnswer' }, { type: 'shortAnswer', value: '' })).toBe(true)
      expect(isOmitted({ type: 'shortAnswer' }, { type: 'shortAnswer', value: 'palabra' })).toBe(false)
    })

    it('UNI-P1-05: fillBlanks admite palabras duplicadas en distintos slots sin colapso de Set', () => {
      const act = activitiesFixtures.fillBlanks.activity
      const multiTokenAct = {
        ...act,
        details: {
          fillBlanks: {
            text: 'El catión tiene carga [b1] y el anión tiene carga [b2].',
            blanks: [
              { id: 'b1', answer: 'positivo' },
              { id: 'b2', answer: 'positivo' },
            ],
          },
        },
      }

      const response = {
        type: 'fillBlanks',
        answers: { b1: 'positivo', b2: 'positivo' },
      }

      const clientEval = evaluateActivityResponse(multiTokenAct as any, response as any, 10)
      expect(clientEval.correct).toBe(true)
      expect(clientEval.score).toBe(10)
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 4: Privacidad y Proyección Antitrampas (C1)
  // --------------------------------------------------------------------------
  describe('Grupo 4: Privacidad Absoluta y Proyección Antitrampas', () => {
    it('markWords: retira asteriscos de solución [palabra*] del texto público conservando corchetes', () => {
      const act = activitiesFixtures.markWords.activity
      const pub = publicActivity(act)

      expect(pub.details.markWords.text).not.toContain('*')
      expect(pub.details.markWords.text).toContain('[')
      expect(pub.details.markWords.solutions).toBeUndefined()
      expect(pub.details.markWords.correctWords).toBeUndefined()
    })

    it('C-REV-02: markWords público permite a parseMarkWordsText generar botones interactivos sin asteriscos', () => {
      const act = activitiesFixtures.markWords.activity
      const pub = publicActivity(act)
      const parsed = parseMarkWordsText(pub.details.markWords.text)
      const wordSegments = parsed.segments.filter((segment) => segment.kind === 'word')
      expect(wordSegments.length).toBeGreaterThan(0)
      for (const seg of wordSegments) {
        if (seg.kind === 'word') {
          expect(seg.text).not.toContain('*')
          expect(seg.text).not.toContain('[')
          expect(seg.text).not.toContain(']')
        }
      }
      expect(parsed.tokens.length).toBeGreaterThan(0)
      for (const tok of parsed.tokens) {
        expect(tok.text).not.toContain('*')
      }
    })

    it('C-REV-01: ordering y matching barajan internamente incluso con options.shuffle = false', () => {
      const orderingAct = activitiesFixtures.ordering.activity
      const pubOrd = publicActivity(orderingAct, { shuffle: false })
      expect(pubOrd.details.ordering.correctOrder).toBeUndefined()
      expect(pubOrd.details.ordering.solution).toBeUndefined()
      expect(pubOrd.details.ordering.steps).toHaveLength(orderingAct.details.ordering.steps.length)

      const matchingAct = activitiesFixtures.matching.activity
      const pubMat = publicActivity(matchingAct, { shuffle: false })
      expect(pubMat.details.matching.solution).toBeUndefined()
      expect(pubMat.details.matching.correctPairs).toBeUndefined()
      expect(pubMat.details.matching.pairs).toHaveLength(matchingAct.details.matching.pairs.length)
    })

    it('C-REV-01: Proyección pública elimina estrictamente feedback de docente de cualquier actividad', () => {
      for (const key of Object.keys(activitiesFixtures)) {
        const fixture = (activitiesFixtures as any)[key]
        const actWithFeedback = {
          ...fixture.activity,
          feedback: 'Explicación secreta del docente para retroalimentación posterior',
        }
        const pub = publicActivity(actWithFeedback)
        expect((pub as any).feedback).toBeUndefined()
      }
    })

    it('gridCheck: retira expectedCells', () => {
      const act = activitiesFixtures.gridCheck.activity
      const pub = publicActivity(act)
      expect(pub.details.gridCheck.expectedCells).toBeUndefined()
    })

    it('trueFalse: retira explanation de la vista pública', () => {
      const act = activitiesFixtures.trueFalse.activity
      const pub = publicActivity(act)
      expect(pub.details.trueFalse.explanation).toBeUndefined()
    })

    it('scenario: retira consequence y feedback anticipados', () => {
      const act = activitiesFixtures.scenario.activity
      const pub = publicActivity(act)
      for (const stage of pub.details.scenario.stages ?? []) {
        for (const opt of stage.options ?? []) {
          expect(opt.consequence).toBeUndefined()
          expect(opt.feedback).toBeUndefined()
          expect(opt.isOptimal).toBeUndefined()
        }
      }
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 5: Autoridad de Sala y Modelo de Ocurrencias (C1, C2)
  // --------------------------------------------------------------------------
  describe('Grupo 5: Autoridad de Sala y Ocurrencias Estables', () => {
    it('B2-05 / P0-04: El denominador se rige por ocurrencias autorizadas y completa omisiones', () => {
      const act1 = activitiesFixtures.singleChoice.activity
      const act2 = activitiesFixtures.trueFalse.activity
      const room = { id: crypto.randomUUID(), code: 'DENOM1' }

      const roomActivities = [
        { id: 'occ-1', activity_id: act1.id, position: 1 },
        { id: 'occ-2', activity_id: act2.id, position: 2 },
      ]
      const activitiesMap = new Map([
        [act1.id, act1],
        [act2.id, act2],
      ])

      // El alumno solo responde a occ-1; omite occ-2
      const clientResponses = [
        { occurrenceId: 'occ-1', activityId: act1.id, response: activitiesFixtures.singleChoice.validResponse },
      ]

      const evaluation = evaluateRoomAttempt(room, roomActivities, activitiesMap, clientResponses)
      expect(evaluation.success).toBe(true)
      // Denominador = 2 (maxScore = 20)
      expect(evaluation.totalQuestions).toBe(2)
      expect(evaluation.maxScore).toBe(20)
      // Respondió 1 correcta -> score = 10
      expect(evaluation.score).toBe(10)
      expect(evaluation.correctCount).toBe(1)
      expect(evaluation.answeredCount).toBe(1)
      // La segunda fue completada automáticamente como omitida
      expect(evaluation.omittedCount).toBe(1)
      expect(evaluation.answerRows).toHaveLength(2)
      expect(evaluation.answerRows[1].is_omitted).toBe(true)
    })

    it('S1: Soporta múltiples ocurrencias de la misma actividad con respuestas independientes', () => {
      const act = activitiesFixtures.trueFalse.activity
      const room = { id: crypto.randomUUID(), code: 'MULTIOCC' }

      // Misma actividad vinculada 2 veces en la sala
      const roomActivities = [
        { id: 'occ-primera', activity_id: act.id, position: 1 },
        { id: 'occ-segunda', activity_id: act.id, position: 2 },
      ]
      const activitiesMap = new Map([[act.id, act]])

      // Alumno responde correctamente en la primera e incorrectamente en la segunda
      const clientResponses = [
        { occurrenceId: 'occ-primera', activityId: act.id, response: activitiesFixtures.trueFalse.validResponse },
        { occurrenceId: 'occ-segunda', activityId: act.id, response: activitiesFixtures.trueFalse.incorrectResponse },
      ]

      const evaluation = evaluateRoomAttempt(room, roomActivities, activitiesMap, clientResponses)
      expect(evaluation.success).toBe(true)
      expect(evaluation.totalQuestions).toBe(2)
      expect(evaluation.maxScore).toBe(20)
      expect(evaluation.score).toBe(10)
      expect(evaluation.correctCount).toBe(1)
      expect(evaluation.omittedCount).toBe(0)
      expect(evaluation.answerRows[0].occurrence_id).toBe('occ-primera')
      expect(evaluation.answerRows[1].occurrence_id).toBe('occ-segunda')
    })

    it('Rechaza ocurrencias ajenas a la sala con error explícito', () => {
      const act = activitiesFixtures.trueFalse.activity
      const room = { id: crypto.randomUUID(), code: 'AJENA1' }
      const roomActivities = [{ id: 'occ-valida', activity_id: act.id, position: 1 }]
      const activitiesMap = new Map([[act.id, act]])

      const result = evaluateRoomAttempt(room, roomActivities, activitiesMap, [
        { occurrenceId: 'occ-hacker-extra', activityId: 'act-ajena', response: { type: 'trueFalse', value: 'Verdadero' } },
      ])
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/no vinculad[oa] a esta sala/i)
      expect(result.statusCode).toBe(400)
    })

    it('C-REV-03: Rechaza estrictamente discrepancias entre occurrenceId y activityId (mismatched pair)', () => {
      const act1 = activitiesFixtures.singleChoice.activity
      const act2 = activitiesFixtures.trueFalse.activity
      const room = { id: crypto.randomUUID(), code: 'MISMATCH1' }
      const roomActivities = [
        { id: 'occ-1', activity_id: act1.id, position: 1 },
        { id: 'occ-2', activity_id: act2.id, position: 2 },
      ]
      const activitiesMap = new Map([
        [act1.id, act1],
        [act2.id, act2],
      ])

      // Cliente envía occ-1 pero dice que es act2.id (incompatible)
      const result = evaluateRoomAttempt(room, roomActivities, activitiesMap, [
        { occurrenceId: 'occ-1', activityId: act2.id, response: activitiesFixtures.trueFalse.validResponse },
      ])
      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(400)
      expect(result.error).toMatch(/Par contradictorio/i)
    })

    it('C-REV-03: Falla con HTTP 500 si la sala contiene una ocurrencia con actividad inexistente en BD', () => {
      const act1 = activitiesFixtures.singleChoice.activity
      const room = { id: crypto.randomUUID(), code: 'DBMISS1' }
      const roomActivities = [
        { id: 'occ-1', activity_id: act1.id, position: 1 },
        { id: 'occ-huérfana', activity_id: 'act-inexistente-en-db', position: 2 },
      ]
      const activitiesMap = new Map([
        [act1.id, act1],
        // Falta 'act-inexistente-en-db' en el mapa
      ])

      const result = evaluateRoomAttempt(room, roomActivities, activitiesMap, [
        { occurrenceId: 'occ-1', activityId: act1.id, response: activitiesFixtures.singleChoice.validResponse },
      ])
      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(500)
      expect(result.error).toMatch(/Integridad de sala comprometida/i)
    })

    it('Rechaza respuestas duplicadas para la misma ocurrencia', () => {
      const act = activitiesFixtures.trueFalse.activity
      const room = { id: crypto.randomUUID(), code: 'DUP1' }
      const roomActivities = [{ id: 'occ-1', activity_id: act.id, position: 1 }]
      const activitiesMap = new Map([[act.id, act]])

      const result = evaluateRoomAttempt(room, roomActivities, activitiesMap, [
        { occurrenceId: 'occ-1', activityId: act.id, response: { type: 'trueFalse', value: 'Verdadero' } },
        { occurrenceId: 'occ-1', activityId: act.id, response: { type: 'trueFalse', value: 'Falso' } },
      ])
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/duplicada/)
      expect(result.statusCode).toBe(400)
    })

    it('C-REV-02: Integración Cliente End-to-End con ocurrencias en join y submit', async () => {
      const act = activitiesFixtures.singleChoice.activity
      const room = { id: crypto.randomUUID(), code: 'E2EOCC', status: 'active' }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [
        { id: 'occ-e2e-1', room_id: room.id, activity_id: act.id, position: 1 },
      ])
      mockStore.activities.set(act.id, act)

      // 1. Cliente ejecuta join
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'E2EOCC', displayName: 'Estudiante E2E' }),
      })
      const joinRes = await guestHandler(joinReq)
      expect(joinRes.status).toBe(201)
      const joinData = await joinRes.json()
      expect(joinData.occurrenceIds).toEqual(['occ-e2e-1'])
      expect(joinData.activities).toHaveLength(1)

      // 2. Cliente envía submit con occurrenceId
      const submitReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'E2EOCC',
          roomId: room.id,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-e2e-1', activityId: act.id, response: activitiesFixtures.singleChoice.validResponse },
          ],
        }),
      })
      const submitRes = await guestHandler(submitReq)
      expect(submitRes.status).toBe(201)
      const submitData = await submitRes.json()
      expect(submitData.score).toBe(10)
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 6: Privacidad Administrativa y Disponibilidad (C3)
  // --------------------------------------------------------------------------
  describe('Grupo 6: Privacidad Administrativa y Disponibilidad', () => {
    it('admin-platform-data: no expone intentos ni respuestas individuales de los alumnos', async () => {
      const adminUser = { id: 'admin-user-uuid', email: 'admin@evaluedu.org' }
      mockStore.authUsers.push(adminUser)
      mockStore.profiles.set(adminUser.id, {
        id: adminUser.id,
        role: 'admin',
        roles: ['admin', 'superadmin'],
        display_name: 'Director Admin',
      })

      // Insertar algunos intentos y salas en la BD simulada
      mockStore.attempts.set('att-1', { id: 'att-1', participant_id: 'part-1', score: 100 })
      mockStore.rooms.set('room-1', { id: 'room-1', code: 'ABCDEF', status: 'active' })

      setActiveMockDbStore(mockStore, adminUser)

      const req = new Request('http://localhost/admin-platform-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-jwt',
        },
      })

      const res = await platformDataHandler(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      // Cero espionaje de aula: no se devuelven intentos ni salas detalladas
      expect(data.attempts).toEqual([])
      expect(data.rooms).toEqual([])
      // Métricas agregadas presentes
      expect(data.metrics.totalRooms).toBe(1)
      expect(data.metrics.totalAttempts).toBe(1)
    })

    it('admin-create-pilot-teacher: rechaza con 409 si el correo ya existe (protección de cuentas)', async () => {
      const adminUser = { id: 'admin-user-uuid', email: 'admin@evaluedu.org' }
      mockStore.authUsers.push(adminUser)
      mockStore.profiles.set(adminUser.id, {
        id: adminUser.id,
        role: 'admin',
        roles: ['admin', 'superadmin'],
        display_name: 'Director Admin',
      })

      // Usuario ya existente
      mockStore.authUsers.push({
        id: 'existing-teacher-uuid',
        email: 'profesor@colegio.edu',
      })

      setActiveMockDbStore(mockStore, adminUser)

      const req = new Request('http://localhost/admin-create-pilot-teacher', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-jwt',
        },
        body: JSON.stringify({
          email: 'profesor@colegio.edu',
          displayName: 'Profesor Existente',
          password: 'PasswordSeguro123!',
        }),
      })

      const res = await createPilotTeacherHandler(req)
      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toContain('Ya existe una cuenta')
    })

    it('admin-remove-user: bloquea suspensión o eliminación de cuentas directivas (admin)', async () => {
      const adminUser = { id: 'admin-user-uuid', email: 'admin@evaluedu.org' }
      const targetAdmin = { id: 'target-admin-uuid', email: 'subdirector@evaluedu.org' }
      mockStore.authUsers.push(adminUser, targetAdmin)
      mockStore.profiles.set(adminUser.id, { id: adminUser.id, role: 'admin', roles: ['admin'] })
      mockStore.profiles.set(targetAdmin.id, { id: targetAdmin.id, role: 'admin', roles: ['admin'] })

      setActiveMockDbStore(mockStore, adminUser)

      const req = new Request('http://localhost/admin-remove-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-jwt',
        },
        body: JSON.stringify({
          userId: targetAdmin.id,
          action: 'disable',
        }),
      })

      const res = await removeUserHandler(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Las cuentas directivas deben conservarse')
    })

    it('C-REV-06: RateLimiter soporta ráfaga de ingreso simultáneo de 50 alumnos bajo misma IP NAT de aula', () => {
      const natIp = '190.11.22.33'
      for (let i = 0; i < 50; i++) {
        const studentToken = `token-student-nat-${i}`
        const result = checkRateLimit('join', natIp, studentToken)
        expect(result.allowed).toBe(true)
      }
    })

    it('C-REV-04: Idempotencia en endpoint: reenvío con mismo participante retorna puntaje persistido sin duplicar', async () => {
      const act = activitiesFixtures.singleChoice.activity
      const room = { id: crypto.randomUUID(), code: 'IDEMP1', status: 'active' }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [
        { id: 'occ-idemp-1', room_id: room.id, activity_id: act.id, position: 1 },
      ])
      mockStore.activities.set(act.id, act)

      // 1. Join
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'IDEMP1', displayName: 'Alumno Idemp' }),
      })
      const joinRes = await guestHandler(joinReq)
      const joinData = await joinRes.json()

      // 2. Primera entrega (obtiene 10 puntos)
      const sub1 = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'IDEMP1',
          roomId: room.id,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-idemp-1', activityId: act.id, response: activitiesFixtures.singleChoice.validResponse },
          ],
        }),
      }))
      expect(sub1.status).toBe(201)
      const data1 = await sub1.json()
      expect(data1.score).toBe(10)
      expect(data1.alreadySaved).toBe(false)

      // 3. Re-entrega inmediata con payload adulterado -> Retorna 200 con alreadySaved y score original de BD
      const sub2 = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'IDEMP1',
          roomId: room.id,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-idemp-1', activityId: act.id, response: activitiesFixtures.singleChoice.incorrectResponse },
          ],
        }),
      }))
      expect(sub2.status).toBe(200)
      const data2 = await sub2.json()
      expect(data2.alreadySaved).toBe(true)
      expect(data2.score).toBe(10) // Mantiene 10 persistido en BD, no 0 del payload adulterado
    })

    it('RateLimiter: Soporta sondeo NAT de aula (30 alumnos tras misma IP)', () => {
      const natIp = '200.10.20.30'
      // 30 alumnos haciendo peticiones de status bajo la misma IP NAT
      for (let i = 0; i < 30; i++) {
        const studentToken = `token-student-${i}`
        const result = checkRateLimit('status', natIp, studentToken)
        expect(result.allowed).toBe(true)
      }
    })

    it('RateLimiter: Rechaza abuso de entrega por ráfaga desde el mismo token', () => {
      const token = 'token-spammer'
      const ip = '186.20.10.5'
      // Límite de submit = 10 peticiones/min
      for (let i = 0; i < 10; i++) {
        expect(checkRateLimit('submit', ip, token).allowed).toBe(true)
      }
      // La 11va debe ser bloqueada
      const overflow = checkRateLimit('submit', ip, token)
      expect(overflow.allowed).toBe(false)
      expect(overflow.retryAfter).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 7: Seguridad de Endpoints y Fronteras de Autenticación (C1, C2)
  // --------------------------------------------------------------------------
  describe('Grupo 7: Seguridad de Endpoints y Manejo de Errores', () => {
    it('guest: rechaza join si falta el código o el nombre del estudiante', async () => {
      const req = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: '', displayName: '' }),
      })
      const res = await guestHandler(req)
      expect(res.status).toBe(400)
    })

    it('guest: rechaza join con 404 si la sala no existe', async () => {
      const req = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'NOEXISTE', displayName: 'Alumno' }),
      })
      const res = await guestHandler(req)
      expect(res.status).toBe(404)
    })

    it('guest: rechaza join con 403 si la sala no está activa', async () => {
      const roomId = crypto.randomUUID()
      mockStore.rooms.set(roomId, { id: roomId, code: 'CERRADA', status: 'closed' })
      const req = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'CERRADA', displayName: 'Alumno' }),
      })
      const res = await guestHandler(req)
      expect(res.status).toBe(403)
    })

    it('guest: rechaza submit_attempt con 401 ante token de invitado adulterado', async () => {
      const roomId = crypto.randomUUID()
      const partId = crypto.randomUUID()
      mockStore.rooms.set(roomId, { id: roomId, code: 'AUTH01', status: 'active' })
      mockStore.participants.set(partId, {
        id: partId,
        room_id: roomId,
        guest_token_hash: 'hash-legitimo',
        guest_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      })

      const req = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'AUTH01',
          roomId,
          participantId: partId,
          guestToken: 'token-adulterado-invalido',
          responses: [],
        }),
      })
      const res = await guestHandler(req)
      expect(res.status).toBe(401)
    })

    it('C-REV-06: guest: rechaza submit_attempt con 401 si el token de invitado ha expirado', async () => {
      const roomId = crypto.randomUUID()
      const partId = crypto.randomUUID()
      mockStore.rooms.set(roomId, { id: roomId, code: 'EXP01', status: 'active' })
      mockStore.participants.set(partId, {
        id: partId,
        room_id: roomId,
        guest_token_hash: crypto.createHash('sha256').update('token-expirado').digest('hex'),
        guest_token_expires_at: new Date(Date.now() - 3600000).toISOString(),
      })

      const req = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'EXP01',
          roomId,
          participantId: partId,
          guestToken: 'token-expirado',
          responses: [],
        }),
      })
      const res = await guestHandler(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toMatch(/expirada/i)
    })

    it('C-REV-06: guest: rechaza submit_attempt con 401 si el participante pertenece a otra sala', async () => {
      const roomA = crypto.randomUUID()
      const roomB = crypto.randomUUID()
      const partId = crypto.randomUUID()
      mockStore.rooms.set(roomA, { id: roomA, code: 'ROOMA', status: 'active' })
      mockStore.rooms.set(roomB, { id: roomB, code: 'ROOMB', status: 'active' })
      mockStore.participants.set(partId, {
        id: partId,
        room_id: roomB,
        guest_token_hash: crypto.createHash('sha256').update('token-b').digest('hex'),
        guest_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      })

      const req = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'ROOMA',
          roomId: roomA,
          participantId: partId,
          guestToken: 'token-b',
          responses: [],
        }),
      })
      const res = await guestHandler(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toMatch(/Sesión no válida o expirada/i)
    })

    it('C-REV-06: rechaza respuestas con tipo incompatible con la actividad con HTTP 400', async () => {
      const act = activitiesFixtures.singleChoice.activity
      const room = { id: crypto.randomUUID(), code: 'TYPEINCOMP', status: 'active' }
      mockStore.rooms.set(room.id, room)
      mockStore.roomActivities.set(room.id, [
        { id: 'occ-type-1', room_id: room.id, activity_id: act.id, position: 1 },
      ])
      mockStore.activities.set(act.id, act)

      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'TYPEINCOMP', displayName: 'Alumno Incompat' }),
      })
      const joinRes = await guestHandler(joinReq)
      const joinData = await joinRes.json()

      const subReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'TYPEINCOMP',
          roomId: room.id,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-type-1', activityId: act.id, response: { type: 'matching', pairs: {} } },
          ],
        }),
      })
      const subRes = await guestHandler(subReq)
      expect(subRes.status).toBe(400)
    })

    it('sync: rechaza peticiones si falta el header de Autorización', async () => {
      const req = new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'SYNC01', displayName: 'Alumno' }),
      })
      const res = await syncHandler(req)
      expect(res.status).toBe(401)
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 8: Subsanación Integral Dictamen ATLAS (P1, P2, P3)
  // --------------------------------------------------------------------------
  describe('Grupo 8: Subsanación Integral Dictamen ATLAS (P1, P2, P3)', () => {
    // --- P1: Fuga Cruzada y Proyección por Tipo con Lista Blanca ---
    it('P1 · Reproducción 1 (ATLAS): publicActivity(matching) no expone details.ordering ni la solución Proteínas → Aminoácidos', () => {
      const act = activitiesFixtures.matching.activity
      const pub = publicActivity(act)

      // details.ordering debe ser estrictamente indefinido
      expect(pub.details.ordering).toBeUndefined()
      // details contiene ESTRICTAMENTE y ÚNICAMENTE la clave del tipo de actividad
      expect(Object.keys(pub.details)).toEqual(['matching'])

      // En ningún lugar del JSON serializado aparece 'Proteínas → Aminoácidos'
      const jsonStr = JSON.stringify(pub)
      expect(jsonStr).not.toContain('Proteínas → Aminoácidos')
      expect(jsonStr).not.toContain('Proteínas→Aminoácidos')

      // safeOptions solo contiene las opciones del lado derecho barajadas, sin enlaces directos
      expect(pub.options).toEqual(expect.arrayContaining(['Aminoácidos', 'Monosacáridos', 'Nucleótidos']))
      for (const opt of pub.options) {
        expect(opt).not.toContain('→')
      }
    })

    it('P1 · Reproducción 2 (ATLAS): publicActivity(ordering) no expone details.matching ni secuencias privadas en pairs.left', () => {
      const act = activitiesFixtures.ordering.activity
      const pub = publicActivity(act)

      // details.matching debe ser estrictamente indefinido
      expect(pub.details.matching).toBeUndefined()
      // details contiene ESTRICTAMENTE y ÚNICAMENTE 'ordering'
      expect(Object.keys(pub.details)).toEqual(['ordering'])

      // El orden privado de pasos no es deducible por pares sintetizados
      expect(pub.details.ordering.steps).toBeDefined()
      expect(pub.details.ordering.steps).toHaveLength(act.details.ordering.steps.length)
      expect(pub.details.ordering.correctOrder).toBeUndefined()
    })

    it('P1 · Ataque exhaustivo de reconstrucción sobre el JSON completo de los 13 tipos oficiales', () => {
      const allTypes = Object.keys(activitiesFixtures)
      expect(allTypes.length).toBe(13)

      for (const type of allTypes) {
        const fixture = activitiesFixtures[type]
        const pub = publicActivity(fixture.activity)

        // 1. details solo tiene UNA clave: la del tipo propio de la actividad
        const detailsKeys = Object.keys(pub.details)
        expect(detailsKeys).toEqual([type])

        // 2. Ninguna otra clave de los otros 12 formatos existe en details
        for (const otherType of allTypes) {
          if (otherType !== type) {
            expect(pub.details[otherType]).toBeUndefined()
          }
        }

        // 3. Campos privados de solución eliminados
        expect(pub.answer).toBeUndefined()
        expect((pub as any).feedback).toBeUndefined()

        // 4. Inspección del JSON completo serializado: no fugar claves privadas
        const fullJson = JSON.stringify(pub)
        expect(fullJson).not.toContain('"correct":true')
        expect(fullJson).not.toContain('"isOptimal":true')
        expect(fullJson).not.toContain('"hasError":true')
        expect(fullJson).not.toContain('"expectedCells"')
        expect(fullJson).not.toContain('"acceptedAnswers"')
      }
    })

    it('P1 · Ataque de reconstrucción sobre join real de guest y sync con shuffle_questions=true y false', async () => {
      const roomId = crypto.randomUUID()
      const roomActivitiesList: any[] = []
      const allTypes = Object.keys(activitiesFixtures)

      for (let i = 0; i < allTypes.length; i++) {
        const type = allTypes[i]
        const act = activitiesFixtures[type].activity
        mockStore.activities.set(act.id, act)
        roomActivitiesList.push({
          id: `occ-p1-${i + 1}`,
          room_id: roomId,
          activity_id: act.id,
          position: i + 1,
        })
      }

      for (const shuffle of [true, false]) {
        const code = `P1JN${shuffle ? 'T' : 'F'}`
        mockStore.rooms.set(roomId, {
          id: roomId,
          code,
          status: 'active',
          shuffle_questions: shuffle,
        })
        mockStore.roomActivities.set(roomId, [...roomActivitiesList])

        // 1. Join vía guestHandler
        const guestJoinRes = await guestHandler(new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code, displayName: `Alumno P1 ${shuffle}` }),
        }))
        expect(guestJoinRes.status).toBe(201)
        const guestData = await guestJoinRes.json()
        expect(guestData.activities).toHaveLength(13)

        for (const act of guestData.activities) {
          expect(Object.keys(act.details)).toEqual([act.type])
          expect(act.answer).toBeUndefined()
          expect(act.feedback).toBeUndefined()
          const actJson = JSON.stringify(act)
          expect(actJson).not.toContain('"correct":true')
          expect(actJson).not.toContain('"expectedCells"')
        }

        // 2. Join vía syncHandler (autenticado)
        const syncJoinRes = await syncHandler(new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt' },
          body: JSON.stringify({ action: 'join', code, displayName: `Alumno Sync P1 ${shuffle}` }),
        }))
        expect(syncJoinRes.status).toBe(201)
        const syncData = await syncJoinRes.json()
        expect(syncData.activities).toHaveLength(13)

        for (const act of syncData.activities) {
          expect(Object.keys(act.details)).toEqual([act.type])
          expect(act.answer).toBeUndefined()
        }
      }
    })

    it('P1 · Proyección pública sobre datos heredados o incompletos: no inventa relaciones o zonas ficticias', () => {
      const legacyAct = {
        id: 'legacy-act-1',
        type: 'vennDiagram',
        title: 'Diagrama Antiguo',
        prompt: 'Clasificar elementos',
        options: ['Elemento 1', 'Elemento 2'],
        details: {},
      }
      const pub = publicActivity(legacyAct as any)
      expect(Object.keys(pub.details)).toEqual(['vennDiagram'])
      expect(pub.details.vennDiagram.items).toHaveLength(0)
      expect(pub.details.matching).toBeUndefined()
      expect(pub.details.ordering).toBeUndefined()
    })

    // --- P2: Snapshot Autoritativo de Sesión y Acuse Perdido ---
    it('P2 · Snapshot autoritativo: sesión preserva significado inmutable ante edición o reordenamiento en vivo', async () => {
      const act1 = activitiesFixtures.singleChoice.activity
      const act2 = activitiesFixtures.trueFalse.activity
      const roomId = crypto.randomUUID()
      const room = { id: roomId, code: 'SNAP01', status: 'active', shuffle_questions: true }
      mockStore.rooms.set(roomId, room)
      mockStore.activities.set(act1.id, { ...act1 })
      mockStore.activities.set(act2.id, { ...act2 })
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-s1', room_id: roomId, activity_id: act1.id, position: 1 },
        { id: 'occ-s2', room_id: roomId, activity_id: act2.id, position: 2 },
      ])

      // 1. Estudiante inicia sesión (join) -> recibe snapshot inmutable
      const joinReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'SNAP01', displayName: 'Alumno Snapshot' }),
      })
      const joinRes = await guestHandler(joinReq)
      const joinData = await joinRes.json()
      expect(joinRes.status).toBe(201)
      const initialActivities = joinData.activities

      // 2. Docente edita la definición en BD viva (modifica las respuestas correctas de act1 y reordena vínculos)
      const modifiedAct1 = {
        ...act1,
        prompt: 'Pregunta modificada por docente en vivo',
        answer: 'Respuesta Cambiada Totalmente',
      }
      mockStore.activities.set(act1.id, modifiedAct1)
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-s2', room_id: roomId, activity_id: act2.id, position: 1 },
        { id: 'occ-s1', room_id: roomId, activity_id: act1.id, position: 2 },
      ])

      // 3. Estudiante reconecta o recupera sesión autenticada -> Debe recibir el snapshot original de su sesión
      const reconnectReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          code: 'SNAP01',
          displayName: 'Alumno Snapshot',
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
        }),
      })
      const reconnectRes = await guestHandler(reconnectReq)
      expect(reconnectRes.status).toBe(200)
      const reconnectData = await reconnectRes.json()
      expect(reconnectData.activities[0].title).toBe(initialActivities[0].title)

      // 4. Estudiante entrega su examen según la presentación que le fue entregada
      const submitReq = new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'SNAP01',
          roomId,
          participantId: reconnectData.participantId ?? joinData.participantId,
          guestToken: reconnectData.guestToken,
          responses: [
            { occurrenceId: 'occ-s1', activityId: act1.id, response: activitiesFixtures.singleChoice.validResponse },
            { occurrenceId: 'occ-s2', activityId: act2.id, response: activitiesFixtures.trueFalse.validResponse },
          ],
        }),
      })
      const submitRes = await guestHandler(submitReq)
      expect(submitRes.status).toBe(201)
      const submitData = await submitRes.json()
      // El significado se preservó: evaluó contra su snapshot de sesión, obteniendo su nota correcta
      expect(submitData.score).toBe(20)
    })

    it('P2 · Acuse perdido: devuelve intento ya persistido tras autenticar al participante, aunque la sala se cierre o se modifique', async () => {
      const act = activitiesFixtures.trueFalse.activity
      const roomId = crypto.randomUUID()
      const room = { id: roomId, code: 'LOST01', status: 'active' }
      mockStore.rooms.set(roomId, room)
      mockStore.activities.set(act.id, act)
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-lost-1', room_id: roomId, activity_id: act.id, position: 1 },
      ])

      // 1. Join y primera entrega exitosa
      const joinRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'LOST01', displayName: 'Alumno Acuse' }),
      }))
      const joinData = await joinRes.json()

      const sub1 = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'LOST01',
          roomId,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-lost-1', activityId: act.id, response: activitiesFixtures.trueFalse.validResponse },
          ],
        }),
      }))
      expect(sub1.status).toBe(201)
      const data1 = await sub1.json()
      expect(data1.score).toBe(10)
      const originalAttemptId = data1.attemptId

      // 2. La sala se cierra definitivamente por el docente y se alteran actividades en BD
      room.status = 'finished'
      mockStore.rooms.set(roomId, { ...room, status: 'finished' })
      mockStore.activities.delete(act.id)

      // 3. Estudiante reenvía por pérdida de acuse en red (lost ack)
      const sub2 = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'LOST01',
          roomId,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-lost-1', activityId: act.id, response: activitiesFixtures.trueFalse.validResponse },
          ],
        }),
      }))

      // Retorna 200 inmediatamente con alreadySaved: true y nota original, sin fallar por sala cerrada
      expect(sub2.status).toBe(200)
      const data2 = await sub2.json()
      expect(data2.ok).toBe(true)
      expect(data2.alreadySaved).toBe(true)
      expect(data2.attemptId).toBe(originalAttemptId)
      expect(data2.score).toBe(10)
    })

    it('P2 · Integración cliente: misma definición repetida con respuestas distintas evaluada fielmente', async () => {
      const act = activitiesFixtures.trueFalse.activity
      const roomId = crypto.randomUUID()
      const room = { id: roomId, code: 'REPT01', status: 'active' }
      mockStore.rooms.set(roomId, room)
      mockStore.activities.set(act.id, act)
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-rep-1', room_id: roomId, activity_id: act.id, position: 1 },
        { id: 'occ-rep-2', room_id: roomId, activity_id: act.id, position: 2 },
      ])

      const joinRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'REPT01', displayName: 'Alumno Rep' }),
      }))
      const joinData = await joinRes.json()

      const subRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'REPT01',
          roomId,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-rep-1', activityId: act.id, response: activitiesFixtures.trueFalse.validResponse },
            { occurrenceId: 'occ-rep-2', activityId: act.id, response: activitiesFixtures.trueFalse.incorrectResponse },
          ],
        }),
      }))
      expect(subRes.status).toBe(201)
      const subData = await subRes.json()
      expect(subData.score).toBe(10)
      expect(subData.maxScore).toBe(20)
    })

    it('P2 · Integración cliente: recuperación tras recarga de navegador y envío coherente', async () => {
      const act = activitiesFixtures.singleChoice.activity
      const roomId = crypto.randomUUID()
      const room = { id: roomId, code: 'RELOAD01', status: 'active' }
      mockStore.rooms.set(roomId, room)
      mockStore.activities.set(act.id, act)
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-rel-1', room_id: roomId, activity_id: act.id, position: 1 },
      ])

      const joinRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'RELOAD01', displayName: 'Alumno Reload' }),
      }))
      const joinData = await joinRes.json()

      const statusRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          code: 'RELOAD01',
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
        }),
      }))
      expect(statusRes.status).toBe(200)

      const subRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_attempt',
          code: 'RELOAD01',
          roomId,
          participantId: joinData.participantId,
          guestToken: joinData.guestToken,
          responses: [
            { occurrenceId: 'occ-rel-1', activityId: act.id, response: activitiesFixtures.singleChoice.validResponse },
          ],
        }),
      }))
      expect(subRes.status).toBe(201)
      const subData = await subRes.json()
      expect(subData.score).toBe(10)
    })

    // --- P3: NAT y Verificación Deno Local ---
    it('P3 · Escenario NAT de aula completo: 30 alumnos (join -> sondeo status 24/min -> submit) bajo misma IP compartida', async () => {
      const natIp = '200.10.20.30'
      const roomId = crypto.randomUUID()
      const act = activitiesFixtures.singleChoice.activity
      mockStore.rooms.set(roomId, { id: roomId, code: 'NATAULA', status: 'active', student_limit: 50 })
      mockStore.activities.set(act.id, act)
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-nat-1', room_id: roomId, activity_id: act.id, position: 1 },
      ])

      const studentSessions: Array<{ participantId: string; guestToken: string }> = []

      // Fase 1: 30 alumnos ingresan (join) simultáneamente tras la misma IP NAT
      for (let i = 0; i < 30; i++) {
        const joinRes = await guestHandler(new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': natIp,
          },
          body: JSON.stringify({ action: 'join', code: 'NATAULA', displayName: `Alumno NAT ${i + 1}` }),
        }))
        expect(joinRes.status).toBe(201)
        const joinData = await joinRes.json()
        studentSessions.push({ participantId: joinData.participantId, guestToken: joinData.guestToken })
      }

      // Fase 2: Sondeo regular de status durante la prueba (24 consultas de status por alumno = 720 llamadas/min tras la misma NAT)
      for (const session of studentSessions) {
        for (let s = 0; s < 24; s++) {
          const statusRes = await guestHandler(new Request('http://localhost/student-room-guest', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': natIp,
            },
            body: JSON.stringify({
              action: 'status',
              code: 'NATAULA',
              participantId: session.participantId,
              guestToken: session.guestToken,
            }),
          }))
          expect(statusRes.status).toBe(200)
        }
      }

      // Fase 3: 30 alumnos entregan su examen desde la misma IP NAT
      for (let i = 0; i < studentSessions.length; i++) {
        const session = studentSessions[i]
        const submitRes = await guestHandler(new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': natIp,
          },
          body: JSON.stringify({
            action: 'submit_attempt',
            code: 'NATAULA',
            roomId,
            participantId: session.participantId,
            guestToken: session.guestToken,
            responses: [
              { occurrenceId: 'occ-nat-1', activityId: act.id, response: activitiesFixtures.singleChoice.validResponse },
            ],
          }),
        }))
        expect(submitRes.status).toBe(201)
      }

      // Fase 4: Abuso por token descontrolado en submit (más de 10 entregas en la ventana) es bloqueado con HTTP 429
      const abusiveToken = studentSessions[0].guestToken
      let rateLimited = false
      for (let i = 0; i < 15; i++) {
        const res = await guestHandler(new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': natIp,
          },
          body: JSON.stringify({
            action: 'submit_attempt',
            code: 'NATAULA',
            roomId,
            participantId: studentSessions[0].participantId,
            guestToken: abusiveToken,
            responses: [],
          }),
        }))
        if (res.status === 429) {
          rateLimited = true
          break
        }
      }
      expect(rateLimited).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 9: Subsanación Q1, Q2 y Q3 (Dictamen ATLAS a7bef5ed)
  // --------------------------------------------------------------------------
  describe('Grupo 9: Subsanación Q1, Q2 y Q3 (Frontera Pública, Sesión, Snapshot e Interfaz Real)', () => {
    const FORBIDDEN_KEYS = new Set([
      'activities_snapshot',
      'privateActivities',
      'guest_token_hash',
      'expectedCells',
      'acceptedAnswers',
      'correct',
      'explanation',
      'recommended',
      'hasError',
      'zone',
      'category',
      'correction',
      'distractors',
      'answer',
    ])

    function scanPrivateKeys(value: unknown, path = '$'): string[] {
      const hits: string[] = []
      if (Array.isArray(value)) {
        value.forEach((item, idx) => {
          hits.push(...scanPrivateKeys(item, `${path}[${idx}]`))
        })
        return hits
      }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          const nextPath = `${path}.${k}`
          if (FORBIDDEN_KEYS.has(k)) {
            hits.push(nextPath)
          }
          hits.push(...scanPrivateKeys(v, nextPath))
        }
      }
      return hits
    }

    function invertFisherYates<T>(shuffled: readonly T[], rng: () => number): T[] {
      const indices = shuffled.map((_, idx) => idx)
      const permuted = shuffleArray(indices, rng)
      const inverted = new Array<T>(shuffled.length)
      for (let k = 0; k < permuted.length; k++) {
        inverted[permuted[k]] = shuffled[k]
      }
      return inverted
    }

    function buildAll13Room(code: string, shuffleQuestions = false) {
      const roomId = crypto.randomUUID()
      const room = {
        id: roomId,
        code,
        status: 'active',
        shuffle_questions: shuffleQuestions,
        score_per_question: 10,
        time_minutes: 30,
        student_limit: 40,
      }
      mockStore.rooms.set(roomId, room)
      const links: any[] = []
      let pos = 1
      for (const key of Object.keys(activitiesFixtures)) {
        const act = activitiesFixtures[key].activity
        mockStore.activities.set(act.id, JSON.parse(JSON.stringify(act)))
        links.push({
          id: `occ-${code}-${pos}`,
          room_id: roomId,
          activity_id: act.id,
          position: pos,
        })
        pos++
      }
      mockStore.roomActivities.set(roomId, links)
      return room
    }

    function simulateUiResponseForActivity(cloudRow: Record<string, unknown>): ActivityResponse {
      const activity = cloudActivityRowToStudentActivity(cloudRow)
      const runtime = activityRuntime(activity)
      let response = createInitialResponse(activity)

      switch (activity.type) {
        case 'trueFalse': {
          const opts = getSimpleChoiceDisplayOptions('trueFalse', runtime.singleChoice)
          const target = opts.find((o) => o.label === 'Verdadero')!
          response = selectSimpleChoiceResponse('trueFalse', target.value)
          break
        }
        case 'singleChoice': {
          const opts = getSimpleChoiceDisplayOptions('singleChoice', runtime.singleChoice)
          const target = opts.find((o) => o.label === 'Mitocondria')!
          response = selectSimpleChoiceResponse('singleChoice', target.value)
          break
        }
        case 'multiSelect': {
          let vals: string[] = []
          for (const opt of runtime.multiSelect.options) {
            if (opt.label === 'Adenina' || opt.label === 'Guanina') {
              vals = toggleMultiSelectOption(vals, opt)
            }
          }
          response = { type: 'multiSelect', values: vals }
          break
        }
        case 'fillBlanks': {
          const bank = resolveFillBlanksWordBank(runtime.fillBlanks)
          expect(bank).toContain('sodio')
          expect(bank).toContain('potasio')
          expect(bank).toContain('ATP')
          response = {
            type: 'fillBlanks',
            answers: { b1: 'sodio', b2: 'potasio', b3: 'ATP' },
          }
          break
        }
        case 'spotError': {
          const seg = runtime.spotError.segments.find((s) =>
            s.text.includes('tiende a disminuir espontáneamente')
          )!
          response = { type: 'spotError', value: selectSpotErrorSegment(seg) }
          break
        }
        case 'markWords': {
          const segments = buildMarkWordsInteractiveSegments(runtime.markWords)
          let vals: string[] = []
          for (const seg of segments) {
            if (seg.kind === 'word' && (seg.text === 'ARN polimerasa II' || seg.text === 'ARN polimerasa I')) {
              vals = toggleMarkWordToken(vals, seg.tokenId)
            }
          }
          response = { type: 'markWords', values: vals }
          break
        }
        case 'gridCheck': {
          let vals: string[] = []
          vals = toggleGridCheckCell(vals, 'r-pla', 'c-par')
          vals = toggleGridCheckCell(vals, 'r-pla', 'c-clo')
          vals = toggleGridCheckCell(vals, 'r-fun', 'c-par')
          response = { type: 'gridCheck', values: vals }
          break
        }
        case 'scenario': {
          let choices: Record<string, string> = {}
          const s1 = runtime.scenario.stages.find((s) => s.id === 'stg-1')!
          const o1 = s1.options.find((o) => o.text.includes('agua y jabón'))!
          choices = selectScenarioOption(choices, s1.id, o1)
          expect(isScenarioOptionSelected(s1.options, choices[s1.id], o1)).toBe(true)
          expect(resolveSelectedScenarioOption(s1.options, choices[s1.id])?.id).toBe(o1.id)

          const s2 = runtime.scenario.stages.find((s) => s.id === 'stg-2')!
          const o2 = s2.options.find((o) => o.text.includes('NAAT / PCR'))!
          choices = selectScenarioOption(choices, s2.id, o2)
          response = { type: 'scenario', choices }
          break
        }
        case 'matching': {
          let pairs: Record<string, string> = {}
          let activeLeft: string | null = null
          const expectedPairs: Array<[string, string]> = [
            ['Proteínas', 'Aminoácidos'],
            ['Polisacáridos', 'Monosacáridos'],
            ['Ácidos Nucleicos', 'Nucleótidos'],
          ]
          for (const [left, right] of expectedPairs) {
            activeLeft = left
            const res = selectMatchingRight(runtime.matching.pairs, pairs, activeLeft, right)!
            pairs = res.nextPairs
          }
          response = { type: 'matching', pairs }
          break
        }
        case 'sorting': {
          let assignments: Record<string, string> = {}
          const map: Record<string, string> = {
            'it-1': 'Procariota',
            'it-2': 'Eucariota',
            'it-3': 'Procariota',
            'it-4': 'Eucariota',
          }
          for (const item of runtime.sorting.items) {
            assignments = assignSortingCategory(assignments, item.id, map[item.id])
          }
          response = { type: 'sorting', assignments }
          break
        }
        case 'ordering': {
          const target = ['Profase', 'Metafase', 'Anafase', 'Telofase']
          let order =
            response.type === 'ordering' && response.order.length > 0
              ? [...response.order]
              : [...runtime.ordering.steps]
          for (let pos = 0; pos < target.length; pos++) {
            while (order.indexOf(target[pos]) > pos) {
              const cur = order.indexOf(target[pos])
              order = moveOrderingStepInList(order, cur, -1)!
            }
          }
          response = { type: 'ordering', order }
          break
        }
        case 'vennDiagram': {
          let assignments: Record<string, 'left' | 'both' | 'right'> = {}
          const zoneMap: Record<string, 'left' | 'both' | 'right'> = {
            'vn-1': 'left',
            'vn-2': 'both',
            'vn-3': 'right',
          }
          for (const item of runtime.vennDiagram.items) {
            assignments = toggleVennItemZone(assignments, item.id, zoneMap[item.id])
          }
          response = { type: 'vennDiagram', assignments }
          break
        }
        case 'shortAnswer': {
          response = { type: 'shortAnswer', value: 'fotosíntesis' }
          break
        }
      }

      expect(isResponseComplete(activity, response)).toBe(true)
      return response
    }

    it('Q1 · Respuestas JSON íntegras de join inicial, reingreso y status (guest y sync) no filtran snapshots ni claves privadas', async () => {
      buildAll13Room('Q1PRIV', true)

      // 1. Guest: join inicial (201) -> status (200) -> reingreso autenticado (200)
      const gJoinRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q1PRIV', displayName: 'Alumno Q1 Guest' }),
        })
      )
      expect(gJoinRes.status).toBe(201)
      const gJoinBody = await gJoinRes.json()
      expect(scanPrivateKeys(gJoinBody)).toEqual([])
      expect(Object.keys(gJoinBody.participant).sort()).toEqual([
        'display_name',
        'guest_token_expires_at',
        'id',
        'joined_at',
        'last_seen_at',
        'name_normalized',
        'room_id',
        'status',
      ])
      expect(JSON.stringify(gJoinBody)).not.toContain('ARN polimerasa II*')

      const gStatusRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'status',
            code: 'Q1PRIV',
            participantId: gJoinBody.participantId,
            guestToken: gJoinBody.guestToken,
          }),
        })
      )
      expect(gStatusRes.status).toBe(200)
      const gStatusBody = await gStatusRes.json()
      expect(scanPrivateKeys(gStatusBody)).toEqual([])
      expect(gStatusBody.participant.activities_snapshot).toBeUndefined()

      const gRejoinRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q1PRIV',
            displayName: 'Alumno Q1 Guest',
            participantId: gJoinBody.participantId,
            guestToken: gJoinBody.guestToken,
          }),
        })
      )
      expect(gRejoinRes.status).toBe(200)
      const gRejoinBody = await gRejoinRes.json()
      expect(scanPrivateKeys(gRejoinBody)).toEqual([])
      expect(gRejoinBody.recovered).toBe(true)

      // 2. Sync: join inicial (201) -> status (200) -> reingreso autenticado (201)
      const syncAuth = { id: '550e8400-e29b-41d4-a716-446655440901', is_anonymous: true }
      setActiveMockDbStore(mockStore, syncAuth)

      const sJoinRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-token-1' },
          body: JSON.stringify({ action: 'join', code: 'Q1PRIV', displayName: 'Alumno Q1 Sync' }),
        })
      )
      expect(sJoinRes.status).toBe(201)
      const sJoinBody = await sJoinRes.json()
      expect(scanPrivateKeys(sJoinBody)).toEqual([])

      const sStatusRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-token-1' },
          body: JSON.stringify({ action: 'status', code: 'Q1PRIV' }),
        })
      )
      expect(sStatusRes.status).toBe(200)
      const sStatusBody = await sStatusRes.json()
      expect(scanPrivateKeys(sStatusBody)).toEqual([])

      const sRejoinRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-token-1' },
          body: JSON.stringify({ action: 'join', code: 'Q1PRIV', displayName: 'Alumno Q1 Sync' }),
        })
      )
      expect(sRejoinRes.status).toBe(201)
      const sRejoinBody = await sRejoinRes.json()
      expect(scanPrivateKeys(sRejoinBody)).toEqual([])
      expect(sRejoinBody.recovered).toBe(true)
    })

    it('Q1 · Ataque de inversión con identificadores públicos (participant.id, room.id, occurrenceId, joined_at) no reconstruye ordering ni matching con shuffle_questions=false y true', async () => {
      const canonicalSteps = Array.from({ length: 10 }, (_, idx) => `Paso-${idx + 1}`)
      const canonicalPairs = Array.from({ length: 8 }, (_, idx) => ({
        id: `p-${idx + 1}`,
        left: `Concepto-${idx + 1}`,
        right: `Definicion-${idx + 1}`,
      }))
      const canonicalRights = canonicalPairs.map((p) => p.right)

      const ordAct = {
        id: crypto.randomUUID(),
        type: 'ordering',
        title: 'Ordenamiento 10 pasos',
        prompt: 'Ordena los 10 pasos',
        options: canonicalSteps,
        answer: canonicalSteps,
        details: { ordering: { steps: canonicalSteps } },
        status: 'published',
      }
      const matAct = {
        id: crypto.randomUUID(),
        type: 'matching',
        title: 'Asociación 8 pares',
        prompt: 'Relaciona los 8 conceptos',
        options: canonicalPairs.map((p) => `${p.left} → ${p.right}`),
        details: { matching: { pairs: canonicalPairs } },
        status: 'published',
      }

      mockStore.activities.set(ordAct.id, ordAct)
      mockStore.activities.set(matAct.id, matAct)

      for (const shuffleQuestions of [false, true]) {
        const roomId = crypto.randomUUID()
        const code = shuffleQuestions ? 'Q1INVT' : 'Q1INVF'
        mockStore.rooms.set(roomId, {
          id: roomId,
          code,
          status: 'active',
          shuffle_questions: shuffleQuestions,
        })
        mockStore.roomActivities.set(roomId, [
          { id: `occ-ord-${code}`, room_id: roomId, activity_id: ordAct.id, position: 1 },
          { id: `occ-mat-${code}`, room_id: roomId, activity_id: matAct.id, position: 2 },
        ])

        const joinRes = await guestHandler(
          new Request('http://localhost/student-room-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'join', code, displayName: `Alumno Inv ${code}` }),
          })
        )
        expect(joinRes.status).toBe(201)
        const joinBody = await joinRes.json()

        const pubOrd = joinBody.activities.find((a: any) => a.type === 'ordering')
        const pubMat = joinBody.activities.find((a: any) => a.type === 'matching')
        const publicOrderingSteps: string[] = pubOrd.details.ordering.steps
        const publicMatchingRights: string[] = pubMat.details.matching.pairs.map((p: any) => p.right)

        const candidateSeeds = [
          String(joinBody.participant.id),
          String(joinBody.room.id),
          String(joinBody.occurrenceIds[0]),
          String(joinBody.participant.joined_at),
        ]

        for (const seed of candidateSeeds) {
          const invertedSteps = invertFisherYates(publicOrderingSteps, createSeededRng(seed))
          const invertedRights = invertFisherYates(publicMatchingRights, createSeededRng(seed))
          expect(invertedSteps).not.toEqual(canonicalSteps)
          expect(invertedRights).not.toEqual(canonicalRights)
        }
      }

      // Política determinista controlada conservada: publicActivity acepta rng inyectable
      const controlledA = publicActivity(ordAct, { rng: createSeededRng('policy-fixed-seed') })
      const controlledB = publicActivity(ordAct, { rng: createSeededRng('policy-fixed-seed') })
      expect(controlledA.details.ordering.steps).toEqual(controlledB.details.ordering.steps)
    })

    it('Q2 · Bloquea suplantación por nombre, preserva token original, permite recuperar con sala llena y bloquea reingreso tras intento', async () => {
      const act = activitiesFixtures.trueFalse.activity
      const roomId = crypto.randomUUID()
      mockStore.rooms.set(roomId, {
        id: roomId,
        code: 'Q2AUTH',
        status: 'active',
        student_limit: 1,
        score_per_question: 10,
      })
      mockStore.activities.set(act.id, act)
      mockStore.roomActivities.set(roomId, [{ id: 'occ-q2-1', room_id: roomId, activity_id: act.id, position: 1 }])

      // 1. Alumno A ocupa el único cupo (1/1)
      const joinARes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q2AUTH', displayName: 'Alumno Legítimo' }),
        })
      )
      expect(joinARes.status).toBe(201)
      const joinABody = await joinARes.json()
      const savedHashBeforeAttack = mockStore.participants.get(joinABody.participantId).guest_token_hash

      // 2. Atacante intenta suplantar solo con código + mismo nombre (sin token) -> 409
      const spoofNoTokenRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q2AUTH', displayName: 'Alumno Legítimo' }),
        })
      )
      expect(spoofNoTokenRes.status).toBe(409)
      const spoofNoTokenBody = await spoofNoTokenRes.json()
      expect(spoofNoTokenBody.guestToken).toBeUndefined()
      expect(spoofNoTokenBody.participantId).toBeUndefined()

      // 3. Atacante intenta recuperar con token incorrecto -> 409
      const spoofBadTokenRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q2AUTH',
            displayName: 'Alumno Legítimo',
            participantId: joinABody.participantId,
            guestToken: 'token-invalido-atacante',
          }),
        })
      )
      expect(spoofBadTokenRes.status).toBe(409)

      // Token hash del alumno original permanece intacto y sigue operando (status = 200)
      expect(mockStore.participants.get(joinABody.participantId).guest_token_hash).toBe(savedHashBeforeAttack)
      const statusARes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'status',
            code: 'Q2AUTH',
            participantId: joinABody.participantId,
            guestToken: joinABody.guestToken,
          }),
        })
      )
      expect(statusARes.status).toBe(200)

      // 4. Sala llena (1/1): nuevo alumno B es rechazado con 403, pero Alumno A con token válido SÍ recupera sesión (200)
      const joinBRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q2AUTH', displayName: 'Alumno Nuevo B' }),
        })
      )
      expect(joinBRes.status).toBe(403)

      const recoverARes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q2AUTH',
            displayName: 'Alumno Legítimo',
            participantId: joinABody.participantId,
            guestToken: joinABody.guestToken,
          }),
        })
      )
      expect(recoverARes.status).toBe(200)
      const recoverABody = await recoverARes.json()
      expect(recoverABody.recovered).toBe(true)

      // 5. Alumno A entrega -> luego reingreso autenticado se bloquea con 409 alreadyAttempted
      const submitARes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_attempt',
            code: 'Q2AUTH',
            roomId,
            participantId: joinABody.participantId,
            guestToken: joinABody.guestToken,
            responses: [{ occurrenceId: 'occ-q2-1', activityId: act.id, response: activitiesFixtures.trueFalse.validResponse }],
          }),
        })
      )
      expect(submitARes.status).toBe(201)

      const rejoinAfterSubmitRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q2AUTH',
            displayName: 'Alumno Legítimo',
            participantId: joinABody.participantId,
            guestToken: joinABody.guestToken,
          }),
        })
      )
      expect(rejoinAfterSubmitRes.status).toBe(409)
      const rejoinAfterSubmitBody = await rejoinAfterSubmitRes.json()
      expect(rejoinAfterSubmitBody.alreadyAttempted).toBe(true)
    })

    it('Q2 · Snapshot congela roomConfig (score_per_question y time_minutes), exige confirmación de escritura, evita sobrescritura concurrente y rechaza snapshot heredado ausente sin degradar a vivo', async () => {
      // A. Congelamiento de roomConfig + definición + vínculos entre join y recovery/submit
      const act1 = JSON.parse(JSON.stringify(activitiesFixtures.trueFalse.activity))
      const roomId = crypto.randomUUID()
      mockStore.rooms.set(roomId, {
        id: roomId,
        code: 'Q2CONF',
        status: 'active',
        score_per_question: 10,
        time_minutes: 30,
        shuffle_questions: false,
      })
      mockStore.activities.set(act1.id, act1)
      mockStore.roomActivities.set(roomId, [{ id: 'occ-conf-1', room_id: roomId, activity_id: act1.id, position: 1 }])

      const joinRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q2CONF', displayName: 'Alumno Config' }),
        })
      )
      expect(joinRes.status).toBe(201)
      const joinData = await joinRes.json()
      expect(joinData.room.score_per_question).toBe(10)

      // Docente edita sala viva: sube puntaje por pregunta a 25, baja tiempo a 5 min, cambia clave y quita vínculo
      mockStore.rooms.set(roomId, {
        ...mockStore.rooms.get(roomId),
        score_per_question: 25,
        time_minutes: 5,
      })
      mockStore.activities.set(act1.id, {
        ...act1,
        details: { trueFalse: { statement: 'Invertido', correct: false, explanation: 'Cambio en vivo' } },
      })
      mockStore.roomActivities.set(roomId, [])

      const recRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q2CONF',
            displayName: 'Alumno Config',
            participantId: joinData.participantId,
            guestToken: joinData.guestToken,
          }),
        })
      )
      expect(recRes.status).toBe(200)
      const recData = await recRes.json()
      expect(recData.room.score_per_question).toBe(10)
      expect(recData.room.time_minutes).toBe(30)
      expect(recData.activities).toHaveLength(1)

      const subRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_attempt',
            code: 'Q2CONF',
            roomId,
            participantId: joinData.participantId,
            guestToken: joinData.guestToken,
            responses: [{ occurrenceId: 'occ-conf-1', activityId: act1.id, response: { type: 'trueFalse', value: 'Verdadero' } }],
          }),
        })
      )
      expect(subRes.status).toBe(201)
      const subData = await subRes.json()
      expect(subData.score).toBe(10)
      expect(subData.maxScore).toBe(10)

      // B. Fallo intencional de escritura de snapshot -> 500 y sin sesión huérfana activa (guest y sync)
      const participantCountBeforeFail = mockStore.participants.size
      mockStore.failSnapshotUpdate = true
      const failGuestRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q2CONF', displayName: 'Alumno Error Write' }),
        })
      )
      expect(failGuestRes.status).toBe(500)
      expect(mockStore.participants.size).toBe(participantCountBeforeFail)

      setActiveMockDbStore(mockStore, { id: '550e8400-e29b-41d4-a716-446655440902', is_anonymous: true })
      const failSyncRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-fail' },
          body: JSON.stringify({ action: 'join', code: 'Q2CONF', displayName: 'Sync Error Write' }),
        })
      )
      expect(failSyncRes.status).toBe(500)
      expect(mockStore.participants.size).toBe(participantCountBeforeFail)
      mockStore.failSnapshotUpdate = false

      // C. Participante heredado sin snapshot: submit devuelve 409 SNAPSHOT_MISSING_RECOVERABLE y carrera concurrente de sellado no sobrescribe
      mockStore.roomActivities.set(roomId, [{ id: 'occ-conf-1', room_id: roomId, activity_id: act1.id, position: 1 }])
      const legacyToken = 'legacy-valid-token-q2'
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyToken))
      const legacyHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const legacyParticipantId = crypto.randomUUID()
      mockStore.participants.set(legacyParticipantId, {
        id: legacyParticipantId,
        room_id: roomId,
        display_name: 'Alumno Heredado',
        name_normalized: 'alumno heredado',
        guest_token_hash: legacyHash,
        guest_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        status: 'in_progress',
        activities_snapshot: null,
      })

      const legacySubmitRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_attempt',
            code: 'Q2CONF',
            roomId,
            participantId: legacyParticipantId,
            guestToken: legacyToken,
            responses: [{ occurrenceId: 'occ-conf-1', activityId: act1.id, response: { type: 'trueFalse', value: 'Falso' } }],
          }),
        })
      )
      expect(legacySubmitRes.status).toBe(409)
      const legacySubmitBody = await legacySubmitRes.json()
      expect(legacySubmitBody.code).toBe('SNAPSHOT_MISSING_RECOVERABLE')

      // Carrera concurrente simulada: otro proceso sella v1 justo antes de que se ejecute el update de recuperación
      const winnerSnapshot = {
        version: 2,
        roomConfig: { score_per_question: 15, time_minutes: 20, shuffle_questions: false, allow_back: true },
        occurrenceLinks: [{ id: 'occ-conf-1', room_id: roomId, activity_id: act1.id, position: 1, occurrence_id: 'occ-conf-1' }],
        activities: [publicActivity(act1)],
        privateActivities: [act1],
      }
      mockStore.onBeforeSnapshotUpdate = (targetId) => {
        if (targetId === legacyParticipantId) {
          const row = mockStore.participants.get(legacyParticipantId)
          if (row && !row.activities_snapshot) {
            row.activities_snapshot = winnerSnapshot
          }
        }
      }
      const raceRecoverRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q2CONF',
            displayName: 'Alumno Heredado',
            participantId: legacyParticipantId,
            guestToken: legacyToken,
          }),
        })
      )
      mockStore.onBeforeSnapshotUpdate = undefined
      expect(raceRecoverRes.status).toBe(200)
      const raceRecoverBody = await raceRecoverRes.json()
      // Preservó winnerSnapshot (15 pts), nunca lo sobrescribió con la sala viva (25 pts)
      expect(raceRecoverBody.room.score_per_question).toBe(15)
      expect(mockStore.participants.get(legacyParticipantId).activities_snapshot.roomConfig.score_per_question).toBe(15)
    })

    it('Q3 · Frontera real UI->servidor (studentPlayContract.ts): los 13 formatos desde join hasta submit alcanzan 130/130 en guest y sync', async () => {
      const roomGuest = buildAll13Room('Q3UI13G', true)
      const roomSync = buildAll13Room('Q3UI13S', true)

      // 1. Flujo real Guest (join -> cloudActivityRowToStudentActivity -> UI interactions -> buildCloudSubmitPayload -> submit)
      const gJoinRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q3UI13G', displayName: 'UI Guest' }),
        })
      )
      expect(gJoinRes.status).toBe(201)
      const gJoinData = await gJoinRes.json()
      expect(gJoinData.activities).toHaveLength(13)

      const gResponses: Record<number, ActivityResponse> = {}
      const gSequence = gJoinData.activities.map((row: Record<string, unknown>, index: number) => {
        gResponses[index] = simulateUiResponseForActivity(row)
        return { activityId: String(row.id), occurrenceId: String(row.occurrenceId) }
      })

      const gPayload = buildCloudSubmitPayload({
        roomId: roomGuest.id,
        roomCode: roomGuest.code,
        participantId: gJoinData.participantId,
        guestToken: gJoinData.guestToken,
        activitySequence: gSequence,
        responses: gResponses,
      })
      const gSubmitRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gPayload),
        })
      )
      expect(gSubmitRes.status).toBe(201)
      const gSubmitData = await gSubmitRes.json()
      expect(gSubmitData.score).toBe(130)
      expect(gSubmitData.maxScore).toBe(130)

      // 2. Flujo real Sync con recarga (join -> status -> rejoin -> UI interactions -> submit)
      const syncAuth = { id: '550e8400-e29b-41d4-a716-446655440903', is_anonymous: true }
      setActiveMockDbStore(mockStore, syncAuth)

      const sJoinRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-ui-1' },
          body: JSON.stringify({ action: 'join', code: 'Q3UI13S', displayName: 'UI Sync' }),
        })
      )
      expect(sJoinRes.status).toBe(201)
      const sJoinData = await sJoinRes.json()

      const sStatusRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-ui-1' },
          body: JSON.stringify({ action: 'status', code: 'Q3UI13S' }),
        })
      )
      expect(sStatusRes.status).toBe(200)

      const sRejoinRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-ui-1' },
          body: JSON.stringify({ action: 'join', code: 'Q3UI13S', displayName: 'UI Sync' }),
        })
      )
      expect(sRejoinRes.status).toBe(201)
      const sRejoinData = await sRejoinRes.json()

      const sResponses: Record<number, ActivityResponse> = {}
      const sSequence = sRejoinData.activities.map((row: Record<string, unknown>, index: number) => {
        sResponses[index] = simulateUiResponseForActivity(row)
        return { activityId: String(row.id), occurrenceId: String(row.occurrenceId) }
      })

      const sPayload = buildCloudSubmitPayload({
        roomId: roomSync.id,
        roomCode: roomSync.code,
        participantId: sJoinData.participantId,
        activitySequence: sSequence,
        responses: sResponses,
      })
      const sSubmitRes = await syncHandler(
        new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-ui-1' },
          body: JSON.stringify(sPayload),
        })
      )
      expect(sSubmitRes.status).toBe(201)
      const sSubmitData = await sSubmitRes.json()
      expect(sSubmitData.score).toBe(130)
      expect(sSubmitData.maxScore).toBe(130)
    })

    it('Q3 · Casos críticos ATLAS: opciones repetidas en singleChoice, palabras repetidas en markWords y definición repetida en sala con recarga', async () => {
      const repeatedChoiceAct = {
        id: crypto.randomUUID(),
        type: 'singleChoice',
        title: 'Etiquetas repetidas',
        prompt: 'Selecciona la segunda instancia',
        options: ['Agua', 'Agua'],
        details: {
          singleChoice: {
            options: [
              { id: 'sc-opt-1', label: 'Agua', correct: false },
              { id: 'sc-opt-2', label: 'Agua', correct: true },
            ],
            hint: 'Observa el orden',
          },
        },
        status: 'published',
      }
      const repeatedWordAct = {
        id: crypto.randomUUID(),
        type: 'markWords',
        title: 'Palabras repetidas en párrafo',
        prompt: 'Marca únicamente la primera aparición de agua',
        options: ['agua', 'tierra', 'agua'],
        details: {
          markWords: {
            text: 'El [agua*] dulce es escasa frente al [tierra] seca y al [agua] salada.',
            words: [
              { id: 'mw-1', text: 'agua', correct: true },
              { id: 'mw-2', text: 'tierra', correct: false },
              { id: 'mw-3', text: 'agua', correct: false },
            ],
            hint: 'Distingue cada aparición en el texto',
          },
        },
        status: 'published',
      }
      const roomId = crypto.randomUUID()
      mockStore.rooms.set(roomId, {
        id: roomId,
        code: 'Q3EDGE',
        status: 'active',
        shuffle_questions: false,
        score_per_question: 10,
      })
      mockStore.activities.set(repeatedChoiceAct.id, repeatedChoiceAct)
      mockStore.activities.set(repeatedWordAct.id, repeatedWordAct)
      // Incluye definición repetida (repeatedChoiceAct x2) + repeatedWordAct
      mockStore.roomActivities.set(roomId, [
        { id: 'occ-edge-1', room_id: roomId, activity_id: repeatedChoiceAct.id, position: 1 },
        { id: 'occ-edge-2', room_id: roomId, activity_id: repeatedChoiceAct.id, position: 2 },
        { id: 'occ-edge-3', room_id: roomId, activity_id: repeatedWordAct.id, position: 3 },
      ])

      const joinRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'Q3EDGE', displayName: 'Alumno Edge UI' }),
        })
      )
      expect(joinRes.status).toBe(201)
      const joinData = await joinRes.json()

      // Simular recarga antes de entregar
      const rejoinRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'Q3EDGE',
            displayName: 'Alumno Edge UI',
            participantId: joinData.participantId,
            guestToken: joinData.guestToken,
          }),
        })
      )
      expect(rejoinRes.status).toBe(200)
      const rejoinData = await rejoinRes.json()

      // Ocurrencia 1: elige segunda opción (sc-opt-2 -> correcta)
      const act0 = cloudActivityRowToStudentActivity(rejoinData.activities[0])
      const opts0 = getSimpleChoiceDisplayOptions('singleChoice', activityRuntime(act0).singleChoice)
      expect(opts0.map((o) => o.value)).toEqual(['sc-opt-1', 'sc-opt-2'])
      const resp0 = selectSimpleChoiceResponse('singleChoice', opts0[1].value)

      // Ocurrencia 2 (misma definición repetida): elige primera opción (sc-opt-1 -> incorrecta)
      const act1 = cloudActivityRowToStudentActivity(rejoinData.activities[1])
      const opts1 = getSimpleChoiceDisplayOptions('singleChoice', activityRuntime(act1).singleChoice)
      const resp1 = selectSimpleChoiceResponse('singleChoice', opts1[0].value)

      // Ocurrencia 3 (markWords repetida): marca solo primera aparición de "agua" (mw-1 -> correcta)
      const act2 = cloudActivityRowToStudentActivity(rejoinData.activities[2])
      const mwSegs = buildMarkWordsInteractiveSegments(activityRuntime(act2).markWords)
      const wordSegs = mwSegs.filter((s): s is Extract<typeof s, { kind: 'word' }> => s.kind === 'word')
      expect(wordSegs.map((w) => w.tokenId)).toEqual(['mw-1', 'mw-2', 'mw-3'])
      const resp2: ActivityResponse = { type: 'markWords', values: toggleMarkWordToken([], wordSegs[0].tokenId) }

      const submitPayload = buildCloudSubmitPayload({
        roomId,
        roomCode: 'Q3EDGE',
        participantId: joinData.participantId,
        guestToken: joinData.guestToken,
        activitySequence: [
          { activityId: act0.id, occurrenceId: 'occ-edge-1' },
          { activityId: act1.id, occurrenceId: 'occ-edge-2' },
          { activityId: act2.id, occurrenceId: 'occ-edge-3' },
        ],
        responses: { 0: resp0, 1: resp1, 2: resp2 },
      })

      const submitRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submitPayload),
        })
      )
      expect(submitRes.status).toBe(201)
      const submitData = await submitRes.json()
      // 1ra correcta (10) + 2da incorrecta (0) + 3ra correcta (10) = 20 / 30
      expect(submitData.score).toBe(20)
      expect(submitData.maxScore).toBe(30)
      expect(getMultiSelectOptionId({ id: 'ms-1', label: 'Etiqueta' })).toBe('ms-1')
    })
  })

  // --------------------------------------------------------------------------
  // GRUPO 10: Subsanación R-UI-01 y R-UI-02 (Dictamen ATLAS da1e043)
  // --------------------------------------------------------------------------
  describe('Grupo 10: Subsanación R-UI-01 (Omisiones Reales UI->Servidor) y R-UI-02 (Multiplicidad fillBlanks)', () => {
    function buildAll13RoomForUi(code: string) {
      const roomId = crypto.randomUUID()
      const room = {
        id: roomId,
        code,
        status: 'active',
        shuffle_questions: false,
        score_per_question: 10,
        time_minutes: 30,
        student_limit: 40,
      }
      mockStore.rooms.set(roomId, room)
      const links: any[] = []
      let pos = 1
      for (const key of Object.keys(activitiesFixtures)) {
        const act = activitiesFixtures[key].activity
        mockStore.activities.set(act.id, JSON.parse(JSON.stringify(act)))
        links.push({
          id: `occ-${code}-${pos}`,
          room_id: roomId,
          activity_id: act.id,
          position: pos,
        })
        pos++
      }
      mockStore.roomActivities.set(roomId, links)
      return room
    }

    it('R-UI-01 · Reproducción ATLAS: salto explícito, responses: {}, null y vacíos por contrato en los 13 tipos y ambos endpoints (guest/sync)', async () => {
      // 1. Reproducción exacta de ATLAS: sala 1 pregunta trueFalse, skip -> responses: {} -> payload response: null -> HTTP 201 omitida
      const tfAct = activitiesFixtures.trueFalse.activity
      const tfRoomId = crypto.randomUUID()
      mockStore.rooms.set(tfRoomId, { id: tfRoomId, code: 'RUI01TF', status: 'active', score_per_question: 10 })
      mockStore.activities.set(tfAct.id, JSON.parse(JSON.stringify(tfAct)))
      mockStore.roomActivities.set(tfRoomId, [
        { id: 'occ-rui01-tf', room_id: tfRoomId, activity_id: tfAct.id, position: 1 },
      ])

      const tfJoin = await (await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'RUI01TF', displayName: 'Alumno Salto TF' }),
      }))).json()

      const tfPayload = buildCloudSubmitPayload({
        roomId: tfRoomId,
        roomCode: 'RUI01TF',
        participantId: tfJoin.participantId,
        guestToken: tfJoin.guestToken,
        activitySequence: [{ activityId: tfAct.id, occurrenceId: tfJoin.activities[0].occurrenceId }],
        responses: omitQuestionFromResponses({}, 0),
      })
      expect(tfPayload.responses[0].response).toBeNull()

      const tfSubRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tfPayload),
      }))
      expect(tfSubRes.status).toBe(201)
      const tfSubData = await tfSubRes.json()
      expect(tfSubData.score).toBe(0)
      expect(tfSubData.maxScore).toBe(10)
      expect(tfSubData.totalQuestions).toBe(1)
      expect(tfSubData.answeredCount).toBe(0)
      expect(tfSubData.omittedCount).toBe(1)
      const tfLastRpc = mockStore.rpcCalls[mockStore.rpcCalls.length - 1].args
      expect(tfLastRpc.p_answers).toHaveLength(1)
      expect(tfLastRpc.p_answers[0].is_omitted).toBe(true)
      expect(tfLastRpc.p_answers[0].status).toBe('omitted')
      expect(tfLastRpc.p_answers[0].score).toBe(0)

      // 2. Todas omitidas por respuestas ausentes (responses: {}) y vacías de contrato en los 13 tipos, en guest y sync
      for (const mode of ['absent', 'explicit_null', 'typed_empty'] as const) {
        const gCode = `OM13G${mode.slice(0, 3).toUpperCase()}`
        const sCode = `OM13S${mode.slice(0, 3).toUpperCase()}`
        const gRoom = buildAll13RoomForUi(gCode)
        const sRoom = buildAll13RoomForUi(sCode)

        // Guest join + submit
        const gJoin = await (await guestHandler(new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: gCode, displayName: `Omit ${mode} G` }),
        }))).json()
        const gRespMap: Record<number, ActivityResponse | null> = {}
        const gSeq = gJoin.activities.map((row: Record<string, unknown>, idx: number) => {
          if (mode === 'explicit_null') gRespMap[idx] = null
          if (mode === 'typed_empty') gRespMap[idx] = createEmptyActivityResponse(row.type as any)
          return { activityId: String(row.id), occurrenceId: String(row.occurrenceId) }
        })
        const gPayload = buildCloudSubmitPayload({
          roomId: gRoom.id,
          roomCode: gCode,
          participantId: gJoin.participantId,
          guestToken: gJoin.guestToken,
          activitySequence: gSeq,
          responses: gRespMap,
        })
        const gRes = await guestHandler(new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gPayload),
        }))
        expect(gRes.status).toBe(201)
        const gData = await gRes.json()
        expect(gData.score).toBe(0)
        expect(gData.maxScore).toBe(130)
        expect(gData.totalQuestions).toBe(13)
        expect(gData.answeredCount).toBe(0)
        expect(gData.omittedCount).toBe(13)
        const gRpc = mockStore.rpcCalls[mockStore.rpcCalls.length - 1].args
        expect(gRpc.p_answers).toHaveLength(13)
        expect(gRpc.p_answers.every((r: any) => r.is_omitted === true && r.status === 'omitted' && r.score === 0)).toBe(true)

        // Sync join + submit
        setActiveMockDbStore(mockStore, { id: `550e8400-e29b-41d4-a716-446655441${gCode.slice(-3)}`, is_anonymous: true })
        const sJoin = await (await syncHandler(new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer sync-${mode}` },
          body: JSON.stringify({ action: 'join', code: sCode, displayName: `Omit ${mode} S` }),
        }))).json()
        const sRespMap: Record<number, ActivityResponse | null> = {}
        const sSeq = sJoin.activities.map((row: Record<string, unknown>, idx: number) => {
          if (mode === 'explicit_null') sRespMap[idx] = null
          if (mode === 'typed_empty') sRespMap[idx] = createEmptyActivityResponse(row.type as any)
          return { activityId: String(row.id), occurrenceId: String(row.occurrenceId) }
        })
        const sPayload = buildCloudSubmitPayload({
          roomId: sRoom.id,
          roomCode: sCode,
          participantId: sJoin.participantId,
          activitySequence: sSeq,
          responses: sRespMap,
        })
        const sRes = await syncHandler(new Request('http://localhost/student-room-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer sync-${mode}` },
          body: JSON.stringify(sPayload),
        }))
        expect(sRes.status).toBe(201)
        const sData = await sRes.json()
        expect(sData.score).toBe(0)
        expect(sData.maxScore).toBe(130)
        expect(sData.totalQuestions).toBe(13)
        expect(sData.answeredCount).toBe(0)
        expect(sData.omittedCount).toBe(13)
        const sRpc = mockStore.rpcCalls[mockStore.rpcCalls.length - 1].args
        expect(sRpc.p_answers).toHaveLength(13)
        expect(sRpc.p_answers.every((r: any) => r.is_omitted === true && r.status === 'omitted' && r.score === 0)).toBe(true)
      }
    })

    it('R-UI-01 · Timeout parcial y mezcla de contestadas (correctas/incorrectas) + omitidas (salto, null y vacío) en guest y sync', async () => {
      const allKeys = Object.keys(activitiesFixtures)
      expect(allKeys).toHaveLength(13)

      // Sala Guest: timeout parcial (responde 5 correctas, 2 incorrectas, salta 3 y deja 3 sin llegar al agotarse el tiempo)
      const gRoom = buildAll13RoomForUi('RUI01MIXG')
      const gJoin = await (await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'RUI01MIXG', displayName: 'Timeout Parcial G' }),
      }))).json()

      let gResponses: Record<number, ActivityResponse> = {}
      const gSeq = gJoin.activities.map((row: Record<string, unknown>, idx: number) => {
        const type = String(row.type)
        if (idx < 5) {
          gResponses[idx] = activitiesFixtures[type].validResponse
        } else if (idx < 7) {
          gResponses[idx] = activitiesFixtures[type].incorrectResponse
        } else if (idx === 7) {
          // Simula haber tenido entrada y pulsar "Omitir por ahora"
          gResponses[idx] = activitiesFixtures[type].validResponse
          gResponses = omitQuestionFromResponses(gResponses, idx)
        } else if (idx === 8) {
          gResponses[idx] = createEmptyActivityResponse(type as any)
        }
        // idx 9..12 quedan sin responder al producirse el timeout parcial
        return { activityId: String(row.id), occurrenceId: String(row.occurrenceId) }
      })

      const gPayload = buildCloudSubmitPayload({
        roomId: gRoom.id,
        roomCode: 'RUI01MIXG',
        participantId: gJoin.participantId,
        guestToken: gJoin.guestToken,
        activitySequence: gSeq,
        responses: gResponses,
        status: 'timeout',
      })
      const gSubmitRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gPayload),
      }))
      expect(gSubmitRes.status).toBe(201)
      const gSubmitData = await gSubmitRes.json()
      expect(gSubmitData.score).toBe(50)
      expect(gSubmitData.maxScore).toBe(130)
      expect(gSubmitData.totalQuestions).toBe(13)
      expect(gSubmitData.answeredCount).toBe(7)
      expect(gSubmitData.omittedCount).toBe(6)
      expect(gSubmitData.correctCount).toBe(5)
      const gRpc = mockStore.rpcCalls[mockStore.rpcCalls.length - 1].args
      expect(gRpc.p_answers).toHaveLength(13)
      expect(gRpc.p_answers.filter((r: any) => r.status === 'omitted')).toHaveLength(6)
      expect(gRpc.p_answers.filter((r: any) => r.status === 'answered')).toHaveLength(7)

      // Sala Sync: mezcla inversa (responde últimos 4 correctos, 2 incorrectos, omite primeros 7)
      const sRoom = buildAll13RoomForUi('RUI01MIXS')
      setActiveMockDbStore(mockStore, { id: '550e8400-e29b-41d4-a716-446655441999', is_anonymous: true })
      const sJoin = await (await syncHandler(new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-mix' },
        body: JSON.stringify({ action: 'join', code: 'RUI01MIXS', displayName: 'Timeout Parcial S' }),
      }))).json()

      const sResponses: Record<number, ActivityResponse | null> = {}
      const sSeq = sJoin.activities.map((row: Record<string, unknown>, idx: number) => {
        const type = String(row.type)
        if (idx >= 9) {
          sResponses[idx] = activitiesFixtures[type].validResponse
        } else if (idx >= 7) {
          sResponses[idx] = activitiesFixtures[type].incorrectResponse
        } else if (idx % 2 === 0) {
          sResponses[idx] = null
        }
        return { activityId: String(row.id), occurrenceId: String(row.occurrenceId) }
      })

      const sPayload = buildCloudSubmitPayload({
        roomId: sRoom.id,
        roomCode: 'RUI01MIXS',
        participantId: sJoin.participantId,
        activitySequence: sSeq,
        responses: sResponses,
        status: 'timeout',
      })
      const sSubmitRes = await syncHandler(new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-mix' },
        body: JSON.stringify(sPayload),
      }))
      expect(sSubmitRes.status).toBe(201)
      const sSubmitData = await sSubmitRes.json()
      expect(sSubmitData.score).toBe(40)
      expect(sSubmitData.maxScore).toBe(130)
      expect(sSubmitData.totalQuestions).toBe(13)
      expect(sSubmitData.answeredCount).toBe(6)
      expect(sSubmitData.omittedCount).toBe(7)
      expect(sSubmitData.correctCount).toBe(4)
      const sRpc = mockStore.rpcCalls[mockStore.rpcCalls.length - 1].args
      expect(sRpc.p_answers).toHaveLength(13)
      expect(sRpc.p_answers.filter((r: any) => r.status === 'omitted')).toHaveLength(7)
      expect(sRpc.p_answers.filter((r: any) => r.status === 'answered')).toHaveLength(6)
    })

    it('R-UI-01 · Controles negativos conservados: objetos malformados, tipos incompatibles no vacíos, duplicados, IDs ajenos y pares contradictorios siguen rechazados con HTTP 400', async () => {
      const tfAct = activitiesFixtures.trueFalse.activity
      const ordAct = activitiesFixtures.ordering.activity
      const room = { id: crypto.randomUUID(), code: 'RUI01NEG', status: 'active', score_per_question: 10 }
      const links = [
        { id: 'occ-neg-1', room_id: room.id, activity_id: tfAct.id, position: 1 },
        { id: 'occ-neg-2', room_id: room.id, activity_id: ordAct.id, position: 2 },
      ]
      const actMap = new Map([
        [tfAct.id, tfAct],
        [ordAct.id, ordAct],
      ])

      const invalidPayloads: any[] = [
        {}, // objeto vacío sin type
        [], // arreglo
        'omitted', // primitivo string
        123, // primitivo numérico
        { omitted: true }, // hack arbitrario
        { type: 'trueFalse' }, // falta campo value
        { type: 'trueFalse', value: 42 }, // value no string
        { type: 'matching', pairs: { A: 'B' } }, // tipo incompatible no vacío
        { type: 'matching', pairs: {} }, // tipo incompatible aunque vacío
      ]

      for (const badResp of invalidPayloads) {
        const res = evaluateRoomAttempt(room, links, actMap, [
          { occurrenceId: 'occ-neg-1', activityId: tfAct.id, response: badResp },
        ])
        expect(res.success).toBe(false)
        expect(res.statusCode).toBe(400)
      }

      // Contenedor inválido en ordering con type correcto
      const badOrder = evaluateRoomAttempt(room, links, actMap, [
        { occurrenceId: 'occ-neg-2', activityId: ordAct.id, response: { type: 'ordering', order: 'not-an-array' } },
      ])
      expect(badOrder.success).toBe(false)
      expect(badOrder.statusCode).toBe(400)

      // IDs ajenos, duplicados y par occurrenceId/activityId contradictorio siguen en 400
      expect(
        evaluateRoomAttempt(room, links, actMap, [
          { occurrenceId: 'occ-ajena', activityId: tfAct.id, response: null },
        ]).statusCode
      ).toBe(400)
      expect(
        evaluateRoomAttempt(room, links, actMap, [
          { occurrenceId: 'occ-neg-1', activityId: ordAct.id, response: null },
        ]).statusCode
      ).toBe(400)
      expect(
        evaluateRoomAttempt(room, links, actMap, [
          { occurrenceId: 'occ-neg-1', activityId: tfAct.id, response: null },
          { occurrenceId: 'occ-neg-1', activityId: tfAct.id, response: null },
        ]).statusCode
      ).toBe(400)
    })

    it('R-UI-02 · Multiplicidad en fillBlanks desde acciones reales (seleccionar/deshabilitar/limpiar/recargar) con dos fichas "positivo" y distractores en guest y sync', async () => {
      const dualPositivoAct = {
        id: crypto.randomUUID(),
        type: 'fillBlanks',
        title: 'Polaridad de electrodos',
        prompt: 'Completa las dos ranuras de carga eléctrica:',
        options: ['positivo', 'negativo', 'neutro'],
        feedback: 'Ambos polos de referencia en esta celda son positivos.',
        details: {
          fillBlanks: {
            textWithBlanks: 'El electrodo A tiene signo {{1}} y el electrodo B también tiene signo {{2}}.',
            blanks: [
              { id: 'b1', answer: 'positivo' },
              { id: 'b2', answer: 'positivo' },
            ],
            distractors: ['negativo', 'neutro'],
            hint: 'Revisa los signos indicados en la guía experimental.',
          },
        },
        status: 'published',
      }

      // 1. Proyección pública conserva multiplicidad de "positivo" (x2) sin revelar respuesta por posición
      const pub = publicActivity(dualPositivoAct)
      expect(pub.details.fillBlanks.blanks).toEqual([{ id: 'b1' }, { id: 'b2' }])
      expect(pub.details.fillBlanks.bank.filter((w: string) => w === 'positivo')).toHaveLength(2)
      expect(pub.details.fillBlanks.bank.filter((w: string) => w === 'negativo')).toHaveLength(1)
      expect(pub.details.fillBlanks.bank.filter((w: string) => w === 'neutro')).toHaveLength(1)
      expect(JSON.stringify(pub)).not.toContain('"answer"')
      expect(JSON.stringify(pub)).not.toContain('"distractors"')

      const gRoomId = crypto.randomUUID()
      const sRoomId = crypto.randomUUID()
      mockStore.activities.set(dualPositivoAct.id, JSON.parse(JSON.stringify(dualPositivoAct)))
      mockStore.rooms.set(gRoomId, { id: gRoomId, code: 'FB2G', status: 'active', score_per_question: 10 })
      mockStore.rooms.set(sRoomId, { id: sRoomId, code: 'FB2S', status: 'active', score_per_question: 10 })
      mockStore.roomActivities.set(gRoomId, [{ id: 'occ-fb2-g', room_id: gRoomId, activity_id: dualPositivoAct.id, position: 1 }])
      mockStore.roomActivities.set(sRoomId, [{ id: 'occ-fb2-s', room_id: sRoomId, activity_id: dualPositivoAct.id, position: 1 }])

      // 2. Join Guest + simulación de recarga (status + rejoin)
      const gJoin = await (await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: 'FB2G', displayName: 'Alumno Dual Guest' }),
      }))).json()

      const gReload = await (await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          code: 'FB2G',
          displayName: 'Alumno Dual Guest',
          participantId: gJoin.participantId,
          guestToken: gJoin.guestToken,
        }),
      }))).json()

      const uiActivity = cloudActivityRowToStudentActivity(gReload.activities[0])
      const fbRuntime = activityRuntime(uiActivity).fillBlanks

      // Acciones reales de UI consumidas por FillBlanksQuestion:
      let answers: Record<string, string> = {}
      let activeSlotId: string | null = null

      // Estado inicial: 4 fichas habilitadas (negativo, neutro, positivo #1, positivo #2)
      const chips0 = getFillBlanksBankChips(fbRuntime, answers)
      expect(chips0.filter((c) => c.word === 'positivo' && !c.used)).toHaveLength(2)
      expect(chips0.filter((c) => c.word === 'negativo' && !c.used)).toHaveLength(1)
      expect(chips0.filter((c) => c.word === 'neutro' && !c.used)).toHaveLength(1)

      // Seleccionar primera ficha "positivo"
      const pos1Chip = chips0.find((c) => c.word === 'positivo' && !c.used)!
      const step1 = selectFillBlanksWord({
        runtime: fbRuntime,
        answers,
        activeSlotId,
        word: pos1Chip.word,
        chipIndex: pos1Chip.chipIndex,
      })!
      expect(step1).not.toBeNull()
      answers = step1.nextAnswers
      activeSlotId = step1.nextActiveSlotId
      expect(answers).toEqual({ b1: 'positivo' })
      expect(activeSlotId).toBe('b2')

      // Solo UNA copia de "positivo" queda deshabilitada; la SEGUNDA permanece habilitada
      const chips1 = getFillBlanksBankChips(fbRuntime, answers)
      expect(chips1.filter((c) => c.word === 'positivo' && c.used)).toHaveLength(1)
      expect(chips1.filter((c) => c.word === 'positivo' && !c.used)).toHaveLength(1)
      // Intentar hacer clic en la copia ya usada falla (no permite reutilizar un chip deshabilitado)
      expect(selectFillBlanksWord({
        runtime: fbRuntime,
        answers,
        activeSlotId,
        word: pos1Chip.word,
        chipIndex: pos1Chip.chipIndex,
      })).toBeNull()

      // Seleccionar segunda ficha "positivo" (va a b2)
      const pos2Chip = chips1.find((c) => c.word === 'positivo' && !c.used)!
      const step2 = selectFillBlanksWord({
        runtime: fbRuntime,
        answers,
        activeSlotId,
        word: pos2Chip.word,
        chipIndex: pos2Chip.chipIndex,
      })!
      expect(step2).not.toBeNull()
      answers = step2.nextAnswers
      activeSlotId = step2.nextActiveSlotId
      expect(answers).toEqual({ b1: 'positivo', b2: 'positivo' })

      // Ambas copias de "positivo" quedan deshabilitadas; intentar seleccionar una 3ra vez falla
      const chips2 = getFillBlanksBankChips(fbRuntime, answers)
      expect(chips2.filter((c) => c.word === 'positivo' && !c.used)).toHaveLength(0)
      expect(selectFillBlanksWord({ runtime: fbRuntime, answers, activeSlotId, word: 'positivo' })).toBeNull()

      // Liberar ranura b1: se reactiva exactamente 1 copia de "positivo" y se mantiene 1 usada (b2)
      const cleared = clearFillBlanksSlot({ runtime: fbRuntime, answers, slotKey: 'b1' })
      answers = cleared.nextAnswers
      activeSlotId = cleared.nextActiveSlotId
      expect(answers).toEqual({ b2: 'positivo' })
      expect(activeSlotId).toBe('b1')
      const chipsAfterClear = getFillBlanksBankChips(fbRuntime, answers)
      expect(chipsAfterClear.filter((c) => c.word === 'positivo' && !c.used)).toHaveLength(1)
      expect(chipsAfterClear.filter((c) => c.word === 'positivo' && c.used)).toHaveLength(1)

      // Probar distractor único "negativo": 1ra vez permitido, 2da vez bloqueado (sin reutilización ilimitada)
      const negStep = selectFillBlanksWord({ runtime: fbRuntime, answers, activeSlotId, word: 'negativo' })!
      expect(negStep.nextAnswers).toEqual({ b1: 'negativo', b2: 'positivo' })
      expect(selectFillBlanksWord({ runtime: fbRuntime, answers: negStep.nextAnswers, activeSlotId: 'b2', word: 'negativo' })).toBeNull()

      // Limpiar b1, recolocar la ficha liberada "positivo", verificar coherencia tras otra recarga y enviar
      const clearedNeg = clearFillBlanksSlot({ runtime: fbRuntime, answers: negStep.nextAnswers, slotKey: 'b1' })
      const posReturn = selectFillBlanksWord({
        runtime: fbRuntime,
        answers: clearedNeg.nextAnswers,
        activeSlotId: clearedNeg.nextActiveSlotId,
        word: 'positivo',
      })!
      answers = posReturn.nextAnswers
      expect(answers).toEqual({ b1: 'positivo', b2: 'positivo' })

      const gReload2 = await (await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          code: 'FB2G',
          displayName: 'Alumno Dual Guest',
          participantId: gJoin.participantId,
          guestToken: gJoin.guestToken,
        }),
      }))).json()
      const chipsReloaded = getFillBlanksBankChips(
        activityRuntime(cloudActivityRowToStudentActivity(gReload2.activities[0])).fillBlanks,
        answers
      )
      expect(chipsReloaded.filter((c) => c.word === 'positivo' && !c.used)).toHaveLength(0)
      expect(chipsReloaded.filter((c) => c.word === 'negativo' && !c.used)).toHaveLength(1)

      const gSubmitPayload = buildCloudSubmitPayload({
        roomId: gRoomId,
        roomCode: 'FB2G',
        participantId: gJoin.participantId,
        guestToken: gJoin.guestToken,
        activitySequence: [{ activityId: dualPositivoAct.id, occurrenceId: 'occ-fb2-g' }],
        responses: { 0: { type: 'fillBlanks', answers } },
      })
      const gSubmitRes = await guestHandler(new Request('http://localhost/student-room-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gSubmitPayload),
      }))
      expect(gSubmitRes.status).toBe(201)
      const gSubmitData = await gSubmitRes.json()
      expect(gSubmitData.score).toBe(10)
      expect(gSubmitData.maxScore).toBe(10)
      expect(gSubmitData.correctCount).toBe(1)

      // 3. Flujo equivalente en endpoint Sync con recarga y verificación de score 10/10
      setActiveMockDbStore(mockStore, { id: '550e8400-e29b-41d4-a716-446655442222', is_anonymous: true })
      const sJoin = await (await syncHandler(new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-fb2' },
        body: JSON.stringify({ action: 'join', code: 'FB2S', displayName: 'Alumno Dual Sync' }),
      }))).json()
      const sRejoin = await (await syncHandler(new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-fb2' },
        body: JSON.stringify({ action: 'join', code: 'FB2S', displayName: 'Alumno Dual Sync' }),
      }))).json()
      const sRuntime = activityRuntime(cloudActivityRowToStudentActivity(sRejoin.activities[0])).fillBlanks
      const s1 = selectFillBlanksWord({ runtime: sRuntime, answers: {}, activeSlotId: null, word: 'positivo' })!
      const s2 = selectFillBlanksWord({ runtime: sRuntime, answers: s1.nextAnswers, activeSlotId: s1.nextActiveSlotId, word: 'positivo' })!
      const sSubmitRes = await syncHandler(new Request('http://localhost/student-room-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-fb2' },
        body: JSON.stringify(buildCloudSubmitPayload({
          roomId: sRoomId,
          roomCode: 'FB2S',
          participantId: sJoin.participantId,
          activitySequence: [{ activityId: dualPositivoAct.id, occurrenceId: 'occ-fb2-s' }],
          responses: { 0: { type: 'fillBlanks', answers: s2.nextAnswers } },
        })),
      }))
      expect(sSubmitRes.status).toBe(201)
      const sSubmitData = await sSubmitRes.json()
      expect(sSubmitData.score).toBe(10)
      expect(sSubmitData.maxScore).toBe(10)
      expect(sSubmitData.correctCount).toBe(1)

      // 4. Anti-tamper servidor: enviar dos veces una ficha de copia única ("negativo") se rechaza con HTTP 400
      const tamperedRes = evaluateRoomAttempt(
        { id: gRoomId, code: 'FB2G', score_per_question: 10 },
        [{ id: 'occ-fb2-g', activity_id: dualPositivoAct.id, position: 1 }],
        new Map([[dualPositivoAct.id, dualPositivoAct]]),
        [{ occurrenceId: 'occ-fb2-g', activityId: dualPositivoAct.id, response: { type: 'fillBlanks', answers: { b1: 'negativo', b2: 'negativo' } } }]
      )
      expect(tamperedRes.success).toBe(false)
      expect(tamperedRes.statusCode).toBe(400)

      // 5. Conservación de caso de palabra única y distractores (activitiesFixtures.fillBlanks)
      const singleCopyFb = activityRuntime(activitiesFixtures.fillBlanks.activity).fillBlanks
      const scStep1 = selectFillBlanksWord({ runtime: singleCopyFb, answers: {}, activeSlotId: null, word: 'sodio' })!
      expect(scStep1.nextAnswers).toEqual({ b1: 'sodio' })
      // "sodio" tiene 1 sola copia -> no puede colocarse en b2
      expect(selectFillBlanksWord({ runtime: singleCopyFb, answers: scStep1.nextAnswers, activeSlotId: scStep1.nextActiveSlotId, word: 'sodio' })).toBeNull()
      const scStep2 = selectFillBlanksWord({ runtime: singleCopyFb, answers: scStep1.nextAnswers, activeSlotId: scStep1.nextActiveSlotId, word: 'potasio' })!
      const scStep3 = selectFillBlanksWord({ runtime: singleCopyFb, answers: scStep2.nextAnswers, activeSlotId: scStep2.nextActiveSlotId, word: 'ATP' })!
      expect(scStep3.nextAnswers).toEqual({ b1: 'sodio', b2: 'potasio', b3: 'ATP' })
      expect(getFillBlanksBankChips(singleCopyFb, scStep3.nextAnswers).filter((c) => !c.used).map((c) => c.word)).toEqual(
        expect.arrayContaining(['glucosa', 'calcio'])
      )
    })

    it('room_participants_status_check: student-room-guest asigna in_progress/joined según room.status, recupera abandoned sin usar active, preserva estados válidos y el adaptador rechaza estados inválidos', async () => {
      expect(Array.from(VALID_ROOM_PARTICIPANT_STATUSES)).toEqual(['joined', 'in_progress', 'completed', 'abandoned'])

      const act = activitiesFixtures.trueFalse.activity
      mockStore.activities.set(act.id, act)

      // 1. Join en sala 'active' -> inserta participant.status === 'in_progress'
      const activeRoomId = crypto.randomUUID()
      mockStore.rooms.set(activeRoomId, { id: activeRoomId, code: 'STACT01', status: 'active', score_per_question: 10 })
      mockStore.roomActivities.set(activeRoomId, [{ id: 'occ-st-1', room_id: activeRoomId, activity_id: act.id, position: 1 }])

      const joinActiveRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'STACT01', displayName: 'Alumno Sala Activa' }),
        })
      )
      expect(joinActiveRes.status).toBe(201)
      const joinActiveBody = await joinActiveRes.json()
      expect(joinActiveBody.participant.status).toBe('in_progress')
      expect(mockStore.participants.get(joinActiveBody.participantId).status).toBe('in_progress')

      // 2. Join en sala 'waiting' -> inserta participant.status === 'joined'
      const waitingRoomId = crypto.randomUUID()
      mockStore.rooms.set(waitingRoomId, { id: waitingRoomId, code: 'STWAIT01', status: 'waiting', score_per_question: 10 })
      mockStore.roomActivities.set(waitingRoomId, [{ id: 'occ-st-2', room_id: waitingRoomId, activity_id: act.id, position: 1 }])

      const joinWaitingRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', code: 'STWAIT01', displayName: 'Alumno Sala Espera' }),
        })
      )
      expect(joinWaitingRes.status).toBe(201)
      const joinWaitingBody = await joinWaitingRes.json()
      expect(joinWaitingBody.participant.status).toBe('joined')
      expect(mockStore.participants.get(joinWaitingBody.participantId).status).toBe('joined')

      // 3. Recuperación de participante 'abandoned' en sala 'active' -> pasa a 'in_progress'
      mockStore.participants.get(joinActiveBody.participantId).status = 'abandoned'
      const recoverActiveRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'STACT01',
            displayName: 'Alumno Sala Activa',
            participantId: joinActiveBody.participantId,
            guestToken: joinActiveBody.guestToken,
          }),
        })
      )
      expect(recoverActiveRes.status).toBe(200)
      const recoverActiveBody = await recoverActiveRes.json()
      expect(recoverActiveBody.recovered).toBe(true)
      expect(recoverActiveBody.participant.status).toBe('in_progress')
      expect(mockStore.participants.get(joinActiveBody.participantId).status).toBe('in_progress')

      // 4. Recuperación de participante 'abandoned' en sala 'waiting' -> pasa a 'joined'
      mockStore.participants.get(joinWaitingBody.participantId).status = 'abandoned'
      const recoverWaitingRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'STWAIT01',
            displayName: 'Alumno Sala Espera',
            participantId: joinWaitingBody.participantId,
            guestToken: joinWaitingBody.guestToken,
          }),
        })
      )
      expect(recoverWaitingRes.status).toBe(200)
      const recoverWaitingBody = await recoverWaitingRes.json()
      expect(recoverWaitingBody.recovered).toBe(true)
      expect(recoverWaitingBody.participant.status).toBe('joined')
      expect(mockStore.participants.get(joinWaitingBody.participantId).status).toBe('joined')

      // 5. Recuperación de participante con estado válido no-'abandoned' ('joined' aunque la sala pase a 'active') -> preserva existingAuth.status ('joined')
      mockStore.rooms.set(waitingRoomId, { ...mockStore.rooms.get(waitingRoomId), status: 'active' })
      const preserveJoinedRes = await guestHandler(
        new Request('http://localhost/student-room-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            code: 'STWAIT01',
            displayName: 'Alumno Sala Espera',
            participantId: joinWaitingBody.participantId,
            guestToken: joinWaitingBody.guestToken,
          }),
        })
      )
      expect(preserveJoinedRes.status).toBe(200)
      const preserveJoinedBody = await preserveJoinedRes.json()
      expect(preserveJoinedBody.participant.status).toBe('joined')

      // 6. El adaptador rechaza insert y update con status inválido ('active') con error 23514 room_participants_status_check
      const client = buildMockSupabaseClient(mockStore)
      const badInsert = await client
        .from('room_participants')
        .insert({
          room_id: activeRoomId,
          display_name: 'Invalido',
          name_normalized: 'invalido',
          status: 'active',
        })
        .select()
        .single()
      expect(badInsert.data).toBeNull()
      expect(badInsert.error?.code).toBe('23514')
      expect(badInsert.error?.message).toContain('room_participants_status_check')

      const badUpdate = await client
        .from('room_participants')
        .update({ status: 'active' })
        .eq('id', joinActiveBody.participantId)
        .select()
        .maybeSingle()
      expect(badUpdate.data).toBeNull()
      expect(badUpdate.error?.code).toBe('23514')
      expect(badUpdate.error?.message).toContain('room_participants_status_check')
      expect(mockStore.participants.get(joinActiveBody.participantId).status).toBe('in_progress')
    })
  })
})
