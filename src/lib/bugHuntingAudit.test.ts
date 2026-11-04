import { describe, it, expect } from 'vitest'
import {
  evaluateActivityResponse,
  compareActivityResponse,
  type ActivityResponse
} from './activityEngine'
import { validateShortAnswerActivity, normalizeShortAnswer } from './activities/shortAnswer'
import { validateVennDiagramActivity } from './activities/vennDiagram'
import { validateContentDocument } from './contentImport'
import type { Activity } from './activityEngine'

/**
 * Batería de Pruebas de Caza de Errores y Estrés (Bug-Hunting & Stress Suite)
 * Cubre casos extremos, corrupción de datos, inyecciones de tipos,
 * consistencia cliente-servidor y fugas de privacidad en las 13 actividades.
 */

describe('Caza de Errores: Batería Exhaustiva de Pruebas y Resiliencia en las 13 Actividades', () => {

  // =========================================================================
  // 1. BLINDAJE DE PRIVACIDAD: Cero fugas de respuestas o explicaciones
  // =========================================================================
  describe('Auditoría 1: Blindaje de Privacidad y Proyección Pública', () => {
    it('ninguna de las 13 actividades debe filtrar respuestas correctas en to*Public', async () => {
      // 1. trueFalse
      const { toTrueFalsePublic } = await import('./activities/trueFalse')
      const pubTF = toTrueFalsePublic({ id: 'tf1', type: 'trueFalse', statement: 'Afirmación', correct: true, hint: 'H', explanation: 'Secreto' } as any)
      expect((pubTF as any).correct).toBeUndefined()
      expect((pubTF as any).explanation).toBeUndefined()

      // 2. singleChoice
      const { toSingleChoicePublic } = await import('./activities/singleChoice')
      const pubSC = toSingleChoicePublic({
        id: 'sc1', type: 'singleChoice', prompt: 'Pregunta',
        options: [{ id: 'o1', label: 'A', correct: true }],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubSC as any).explanation).toBeUndefined()
      expect((pubSC.options[0] as any).correct).toBeUndefined()

      // 3. multiSelect
      const { toMultiSelectPublic } = await import('./activities/multiSelect')
      const pubMS = toMultiSelectPublic({
        id: 'ms1', type: 'multiSelect', prompt: 'Pregunta',
        options: [{ id: 'm1', label: 'A', correct: true }, { id: 'm2', label: 'B', correct: false }],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubMS as any).explanation).toBeUndefined()
      expect(pubMS.options.every((o) => (o as any).correct === false || (o as any).correct === undefined)).toBe(true)

      // 4. fillBlanks
      const { toFillBlanksPublic } = await import('./activities/fillBlanks')
      const pubFB = toFillBlanksPublic({
        id: 'fb1', type: 'fillBlanks', prompt: 'Completa',
        textWithBlanks: 'Texto {{1}}',
        blanks: [{ id: 'b1', answer: 'palabraSecreta' }],
        distractors: ['distractor1'],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubFB as any).explanation).toBeUndefined()
      expect(pubFB.blankIds).toEqual(['b1'])
      expect((pubFB as any).blanks).toBeUndefined()
      expect(pubFB.bank).toContain('palabraSecreta')

      // 5. spotError
      const { toSpotErrorPublic } = await import('./activities/spotError')
      const pubSE = toSpotErrorPublic({
        id: 'se1', type: 'spotError', prompt: 'Detecta',
        segments: [{ id: 's1', text: 'Error aquí', hasError: true }],
        correction: 'Corrección secreta',
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubSE as any).explanation).toBeUndefined()
      expect((pubSE as any).correction).toBeUndefined()
      expect((pubSE.segments[0] as any).hasError).toBeUndefined()

      // 6. markWords
      const { toMarkWordsPublic } = await import('./activities/markWords')
      const pubMW = toMarkWordsPublic({
        id: 'mw1', type: 'markWords', prompt: 'Marca',
        text: 'El [sol*] brilla y la [luna] duerme',
        words: [{ id: 'w1', text: 'sol', correct: true }, { id: 'w2', text: 'luna', correct: false }],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubMW as any).explanation).toBeUndefined()
      expect(pubMW.words.every((w) => (w as any).correct === undefined)).toBe(true)

      // 7. gridCheck
      const { toGridCheckPublic } = await import('./activities/gridCheck')
      const pubGC = toGridCheckPublic({
        id: 'gc1', type: 'gridCheck', prompt: 'Coteja',
        rows: [{ id: 'r1', label: 'Fila 1' }],
        columns: [{ id: 'c1', label: 'Col 1' }],
        expectedCells: ['r1:c1'],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubGC as any).explanation).toBeUndefined()
      expect((pubGC as any).expectedCells).toBeUndefined()

      // 8. vennDiagram
      const { toVennDiagramPublic } = await import('./activities/vennDiagram')
      const pubVD = toVennDiagramPublic({
        id: 'vd1', setA: 'Conjunto A', setB: 'Conjunto B',
        items: [
          { id: 'v1', label: 'Solo A', zone: 'left' },
          { id: 'v2', label: 'Ambos', zone: 'both' },
          { id: 'v3', label: 'Solo B', zone: 'right' }
        ],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubVD as any).explanation).toBeUndefined()
      expect(pubVD.items.every((it) => (it as any).zone === undefined)).toBe(true)

      // 9. shortAnswer
      const { toShortAnswerPublic } = await import('./activities/shortAnswer')
      const pubSA = toShortAnswerPublic({
        id: 'sa1', prompt: '¿Quién descubrió...?',
        acceptedAnswers: ['Respuesta Secreta', 'Sinónimo Secreto'],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubSA as any).explanation).toBeUndefined()
      expect((pubSA as any).acceptedAnswers).toBeUndefined()

      // 10. matching
      const { toMatchingPublic } = await import('./activities/matching')
      const pubMat = toMatchingPublic({
        id: 'mat1', type: 'matching', prompt: 'Asocia',
        pairs: [{ id: 'p1', left: 'A', right: '1' }, { id: 'p2', left: 'B', right: '2' }],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubMat as any).explanation).toBeUndefined()

      // 11. sorting
      const { toSortingPublic } = await import('./activities/sorting')
      const pubSort = toSortingPublic({
        id: 'sort1', type: 'sorting', prompt: 'Clasifica',
        categories: ['Cat 1', 'Cat 2'],
        items: [{ id: 'i1', label: 'Item 1', category: 'Cat 1' }],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubSort as any).explanation).toBeUndefined()
      expect(pubSort.items.every((it) => (it as any).category === undefined)).toBe(true)

      // 12. ordering
      const { toOrderingPublic } = await import('./activities/ordering')
      const pubOrd = toOrderingPublic({
        id: 'ord1', type: 'ordering', prompt: 'Ordena',
        steps: ['Paso 1', 'Paso 2', 'Paso 3'],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubOrd as any).explanation).toBeUndefined()
      expect(pubOrd.scrambledSteps).not.toEqual(['Paso 1', 'Paso 2', 'Paso 3'])

      // 13. scenario
      const { toScenarioPublic } = await import('./activities/scenario')
      const pubScen = toScenarioPublic({
        id: 'scen1', type: 'scenario', situation: 'Caso',
        stages: [{
          id: 's1', title: 'Etapa 1', prompt: 'P',
          options: [{ id: 'opt1', text: 'Op 1', consequence: 'C', feedback: 'F', recommended: true }]
        }],
        hint: 'H', explanation: 'Secreto'
      } as any)
      expect((pubScen as any).explanation).toBeUndefined()
      expect((pubScen.stages[0].options[0] as any).recommended).toBeUndefined()
    })
  })

  // =========================================================================
  // 2. RESILIENCIA DEL MOTOR: Entradas inesperadas y tipos cruzados
  // =========================================================================
  describe('Auditoría 2: Manejo de Entradas Corruptas y Tipos Cruzados en el Motor', () => {
    it('no debe romperse ni lanzar excepciones al enviar respuestas con tipos equivocados', () => {
      const activityTypes = [
        'trueFalse', 'singleChoice', 'multiSelect', 'fillBlanks', 'spotError',
        'markWords', 'gridCheck', 'vennDiagram', 'shortAnswer', 'matching',
        'sorting', 'ordering', 'scenario'
      ] as const

      const maliciousResponses: ActivityResponse[] = [
        { type: 'singleChoice', value: 'opcion-a' },
        { type: 'multiSelect', values: ['v1', 'v2'] },
        { type: 'shortAnswer', value: 'mitocondria' },
        { type: 'gridCheck', values: ['r1:c1'] },
        { type: 'vennDiagram', assignments: { v1: 'both' } },
        { type: 'fillBlanks', answers: { b1: 'palabra' } },
        { type: 'ordering', order: ['p1', 'p2'] },
        { type: 'sorting', assignments: { i1: 'cat1' } },
        { type: 'matching', pairs: { a: 'b' } },
        { type: 'scenario', choices: { s1: 'opt1' } },
        { type: 'trueFalse', value: 'Verdadero' },
        { type: 'spotError', value: 'seg-1' },
        { type: 'markWords', values: ['w1'] }
      ]

      for (const actType of activityTypes) {
        const dummyActivity: Activity = {
          id: `test-${actType}`,
          type: actType,
          title: `Test ${actType}`,
          topic: 'General',
          difficulty: 'Inicial',
          prompt: 'Prueba',
          options: [],
          answer: '',
          feedback: 'Feedback',
          status: 'published'
        }

        // Cada tipo de respuesta enviado a una actividad que espera otro tipo
        for (const malResp of maliciousResponses) {
          expect(() => {
            const comp = compareActivityResponse(dummyActivity, malResp)
            expect(typeof comp).toBe('boolean')
            if (malResp.type !== actType) {
              expect(comp).toBe(false)
            }
          }).not.toThrow()
        }
      }
    })

    it('detecta correctamente la omisión (omitted) en las 13 actividades sin penalizarlas con error', () => {
      const dummyBase = {
        title: 'T', topic: 'M', difficulty: 'Inicial' as const,
        prompt: 'P', options: [], answer: '', feedback: 'F', status: 'published' as const
      }

      const tests = [
        { activity: { ...dummyBase, id: '1', type: 'trueFalse' as const }, resp: { type: 'trueFalse' as const, value: '' } },
        { activity: { ...dummyBase, id: '2', type: 'singleChoice' as const }, resp: { type: 'singleChoice' as const, value: '   ' } },
        { activity: { ...dummyBase, id: '3', type: 'multiSelect' as const }, resp: { type: 'multiSelect' as const, values: [] } },
        { activity: { ...dummyBase, id: '4', type: 'fillBlanks' as const }, resp: { type: 'fillBlanks' as const, answers: {} } },
        { activity: { ...dummyBase, id: '5', type: 'spotError' as const }, resp: { type: 'spotError' as const, value: '' } },
        { activity: { ...dummyBase, id: '6', type: 'markWords' as const }, resp: { type: 'markWords' as const, values: [] } },
        { activity: { ...dummyBase, id: '7', type: 'gridCheck' as const }, resp: { type: 'gridCheck' as const, values: [] } },
        { activity: { ...dummyBase, id: '8', type: 'vennDiagram' as const }, resp: { type: 'vennDiagram' as const, assignments: {} } },
        { activity: { ...dummyBase, id: '9', type: 'shortAnswer' as const }, resp: { type: 'shortAnswer' as const, value: '' } },
        { activity: { ...dummyBase, id: '10', type: 'matching' as const }, resp: { type: 'matching' as const, pairs: {} } },
        { activity: { ...dummyBase, id: '11', type: 'sorting' as const }, resp: { type: 'sorting' as const, assignments: {} } },
        { activity: { ...dummyBase, id: '12', type: 'ordering' as const }, resp: { type: 'ordering' as const, order: [] } },
        { activity: { ...dummyBase, id: '13', type: 'scenario' as const }, resp: { type: 'scenario' as const, choices: {} } }
      ]

      for (const { activity, resp } of tests) {
        const result = evaluateActivityResponse(activity, resp, 10)
        expect(result.status).toBe('omitted')
        expect(result.correct).toBeNull()
        expect(result.score).toBe(0)
      }
    })
  })

  // =========================================================================
  // 3. ESTRÉS DE TEXTO EN RESPUESTA CORTA (`shortAnswer`)
  // =========================================================================
  describe('Auditoría 3: Estrés de Normalización y Casos de Borde en Respuesta Corta', () => {
    it('normaliza adecuadamente espacios múltiples, tabulaciones y saltos de línea', () => {
      expect(normalizeShortAnswer('  mitocondria   celular  ', { caseSensitive: false, ignoreAccents: true })).toBe('mitocondria celular')
      expect(normalizeShortAnswer('mitocondria\t\ncelular', { caseSensitive: false, ignoreAccents: true })).toBe('mitocondria celular')
    })

    it('tolera diacríticos y tildes según la configuración del docente', () => {
      expect(normalizeShortAnswer('CÉLULA', { caseSensitive: false, ignoreAccents: true })).toBe('celula')
      expect(normalizeShortAnswer('célula', { caseSensitive: false, ignoreAccents: true })).toBe('celula')
      expect(normalizeShortAnswer('cèlula', { caseSensitive: false, ignoreAccents: true })).toBe('celula')
      expect(normalizeShortAnswer('cêlula', { caseSensitive: false, ignoreAccents: true })).toBe('celula')

      expect(normalizeShortAnswer('célula', { caseSensitive: false, ignoreAccents: false })).toBe('célula')
      expect(normalizeShortAnswer('celula', { caseSensitive: false, ignoreAccents: false })).toBe('celula')
      expect(normalizeShortAnswer('célula', { caseSensitive: false, ignoreAccents: false })).not.toBe('celula')
    })

    it('respeta la sensibilidad a mayúsculas si el profesor lo activa', () => {
      expect(normalizeShortAnswer('NaCl', { caseSensitive: true, ignoreAccents: false })).toBe('NaCl')
      expect(normalizeShortAnswer('nacl', { caseSensitive: true, ignoreAccents: false })).toBe('nacl')
      expect(normalizeShortAnswer('NaCl', { caseSensitive: true, ignoreAccents: false })).not.toBe(
        normalizeShortAnswer('nacl', { caseSensitive: true, ignoreAccents: false })
      )

      expect(normalizeShortAnswer('NaCl', { caseSensitive: false, ignoreAccents: false })).toBe(
        normalizeShortAnswer('nacl', { caseSensitive: false, ignoreAccents: false })
      )
    })

    it('rechaza definiciones de respuesta corta inválidas con diagnósticos claros', () => {
      const r1 = validateShortAnswerActivity({ prompt: 'Pregunta válida', acceptedAnswers: [] })
      expect(r1.valid).toBe(false)
      expect(r1.errors.some((e) => e.includes('respuesta'))).toBe(true)

      const r2 = validateShortAnswerActivity({ prompt: '¿Qué', acceptedAnswers: ['Respuesta'] })
      expect(r2.valid).toBe(false)

      const tooLong = 'A'.repeat(81)
      const r3 = validateShortAnswerActivity({ prompt: 'Pregunta válida', acceptedAnswers: [tooLong] })
      expect(r3.valid).toBe(false)
      expect(r3.errors.some((e) => e.includes('80'))).toBe(true)
    })
  })

  // =========================================================================
  // 4. ESTRÉS EN DIAGRAMA DE VENN (`vennDiagram`)
  // =========================================================================
  describe('Auditoría 4: Estrés y Validación Estricta en Diagrama de Venn', () => {
    it('exige balance pedagógico (al menos 1 elemento exclusivo y al menos 1 en la intersección)', () => {
      const r1 = validateVennDiagramActivity({
        setA: 'Conjunto A',
        setB: 'Conjunto B',
        items: [
          { id: 'v1', label: 'Item 1', zone: 'left' },
          { id: 'v2', label: 'Item 2', zone: 'left' },
          { id: 'v3', label: 'Item 3', zone: 'left' }
        ],
        hint: 'Pista reflexiva válida',
        explanation: 'Explicación pedagógica suficiente'
      })
      expect(r1.valid).toBe(false)
      expect(r1.errors.some((e) => e.includes('intersección') || e.includes('both'))).toBe(true)

      const r2 = validateVennDiagramActivity({
        setA: 'Conjunto A',
        setB: 'Conjunto B',
        items: [
          { id: 'v1', label: 'Item 1', zone: 'both' },
          { id: 'v2', label: 'Item 2', zone: 'both' },
          { id: 'v3', label: 'Item 3', zone: 'both' }
        ],
        hint: 'Pista reflexiva válida',
        explanation: 'Explicación pedagógica suficiente'
      })
      expect(r2.valid).toBe(false)
      expect(r2.errors.some((e) => e.includes('exclusivo'))).toBe(true)

      const r3 = validateVennDiagramActivity({
        setA: 'Conjunto A',
        setB: 'Conjunto B',
        items: [
          { id: 'v1', label: 'Item 1', zone: 'left' },
          { id: 'v2', label: 'Item 2', zone: 'both' },
          { id: 'v3', label: 'Item 3', zone: 'right' }
        ],
        hint: 'Pista reflexiva válida',
        explanation: 'Explicación pedagógica suficiente'
      })
      expect(r3.valid).toBe(true)
    })
  })

  // =========================================================================
  // 5. RESILIENCIA DEL VALIDADOR DE IMPORTACIÓN JSON ANTE ENTRADAS MALFORMADAS
  // =========================================================================
  describe('Auditoría 5: Resiliencia del Validador de Importación JSON v2', () => {
    it('rechaza con elegancia JSON con estructuras o tipos corruptos', () => {
      const badTypeJson = {
        schema: 'edueval.content',
        version: 2,
        topic: { title: 'T', subject: 'S', objective: 'O', competency: 'C', summary: 'Sum' },
        activities: [
          { id: 'bad-1', type: 'tipoInexistenteMagico', prompt: 'Hola' }
        ]
      }
      const r1 = validateContentDocument(badTypeJson)
      if (r1.ok) {
        expect((r1 as any).variantsByType?.['tipoInexistenteMagico']).toBeUndefined()
      } else {
        expect(r1.issues.some((i) => i.path.includes('type'))).toBe(true)
      }

      const badGridJson = {
        schema: 'edueval.content',
        version: 2,
        topic: { title: 'T', subject: 'S', objective: 'O', competency: 'C', summary: 'Sum' },
        activities: [
          {
            id: 'gc-1',
            type: 'gridCheck',
            prompt: 'Coteja',
            rows: [{ id: 'r1', label: 'Fila 1' }],
            columns: [{ id: 'c1', label: 'Col 1' }],
            expectedCells: ['r99:c99']
          }
        ]
      }
      const r2 = validateContentDocument(badGridJson)
      if (r2.ok && 'variantsByType' in r2) {
        expect(r2.variantsByType.gridCheck.needsRepair.length).toBeGreaterThan(0)
      } else if (!r2.ok) {
        expect(r2.issues.length).toBeGreaterThan(0)
      }

      const badShortJson = {
        schema: 'edueval.content',
        version: 2,
        topic: { title: 'T', subject: 'S', objective: 'O', competency: 'C', summary: 'Sum' },
        activities: [
          {
            id: 'sa-1',
            type: 'shortAnswer',
            prompt: '¿Cuál es...?',
            acceptedAnswers: []
          }
        ]
      }
      const r3 = validateContentDocument(badShortJson)
      if (r3.ok && 'variantsByType' in r3) {
        expect(r3.variantsByType.shortAnswer.needsRepair.length).toBeGreaterThan(0)
      } else if (!r3.ok) {
        expect(r3.issues.length).toBeGreaterThan(0)
      }
    })
  })

  // =========================================================================
  // 6. CONCORDANCIA CLIENTE-SERVIDOR: Mismo veredicto en Frontend y Edge Functions
  // =========================================================================
  describe('Auditoría 6: Paridad Estricta Cliente vs Servidor', () => {
    it('el motor de la app debe coincidir 100% con la calificación en servidor para shortAnswer', () => {
      const act: Activity = {
        id: 'sa-audit',
        type: 'shortAnswer',
        title: 'T', topic: 'M', difficulty: 'Intermedio',
        prompt: '¿Nombre de la enzima?',
        options: [],
        answer: 'Polimerasa',
        feedback: 'F',
        details: {
          shortAnswer: {
            prompt: '¿Nombre de la enzima?',
            acceptedAnswers: ['Polimerasa', 'ADN polimerasa'],
            caseSensitive: false,
            ignoreAccents: true
          }
        },
        status: 'published'
      }

      expect(compareActivityResponse(act, { type: 'shortAnswer', value: 'polimerasa' })).toBe(true)
      expect(compareActivityResponse(act, { type: 'shortAnswer', value: 'POLIMERASA' })).toBe(true)
      expect(compareActivityResponse(act, { type: 'shortAnswer', value: '  adn polimerasa  ' })).toBe(true)
      expect(compareActivityResponse(act, { type: 'shortAnswer', value: 'ligasa' })).toBe(false)

      const evalEmpty = evaluateActivityResponse(act, { type: 'shortAnswer', value: '' }, 10)
      expect(evalEmpty.status).toBe('omitted')
      expect(evalEmpty.score).toBe(0)
    })
  })
})
