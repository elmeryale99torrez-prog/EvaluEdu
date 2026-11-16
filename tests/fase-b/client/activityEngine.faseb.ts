import { describe, it, expect } from 'vitest'
import {
  activityRuntime,
  compareActivityResponse,
  evaluateActivityResponse,
  serializeActivityResponse,
  isResponseComplete,
} from '../../../src/lib/activityEngine'
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

describe('Motor de Evaluación del Cliente (activityEngine.ts) · LAB-B-002', () => {
  const activityKeys = Object.keys(activitiesFixtures)

  it('Verificación de catálogo: cuenta con fixtures para los 13 formatos oficiales', () => {
    expect(activityKeys).toHaveLength(13)
  })

  // 1. Ejecución de los 52 Casos Base de Cliente (13 tipos × 4 estados)
  for (const type of activityKeys) {
    const fixture = activitiesFixtures[type]
    const pfx = TYPE_TO_PREFIX[type]

    describe(`Evaluación Cliente: ${type}`, () => {
      it(`[CASO-${pfx}-CORR-CLI] ${type} - Respuesta Correcta (100% acierto)`, () => {
        const isComplete = isResponseComplete(fixture.activity, fixture.validResponse)
        expect(isComplete).toBe(true)

        const isMatch = compareActivityResponse(fixture.activity, fixture.validResponse)
        expect(isMatch).toBe(true)

        const evaluation = evaluateActivityResponse(fixture.activity, fixture.validResponse, 10)
        expect(evaluation.status).toBe('answered')
        expect(evaluation.correct).toBe(true)
        expect(evaluation.score).toBe(10)
      })

      it(`[CASO-${pfx}-INCO-CLI] ${type} - Respuesta Incorrecta (score 0, correct false)`, () => {
        const isMatch = compareActivityResponse(fixture.activity, fixture.incorrectResponse)
        expect(isMatch).toBe(false)

        const evaluation = evaluateActivityResponse(fixture.activity, fixture.incorrectResponse, 10)
        expect(evaluation.correct).toBe(false)
        expect(evaluation.score).toBe(0)
      })

      it(`[CASO-${pfx}-OMIT-CLI] ${type} - Respuesta Omitida (score 0, correct null, status omitted)`, () => {
        const evaluation = evaluateActivityResponse(fixture.activity, fixture.omittedResponse, 10)
        expect(evaluation.status).toBe('omitted')
        expect(evaluation.correct).toBeNull()
        expect(evaluation.score).toBe(0)
      })

      it(`[CASO-${pfx}-MANI-CLI] ${type} - Respuesta Manipulada (evalúa falso / rechazo)`, () => {
        const isMatch = compareActivityResponse(fixture.activity, fixture.manipulatedResponse)
        expect(isMatch).toBe(false)
      })

      it(`[SERIALIZACION] ${type} - Serializa respuesta a string no vacío`, () => {
        const serialized = serializeActivityResponse(fixture.validResponse)
        expect(typeof serialized).toBe('string')
        expect(serialized.trim().length).toBeGreaterThan(0)
      })
    })
  }

  // 2. Casos Borde Específicos de Cliente
  describe('Casos Borde de Normalización y Sintagmas en Cliente', () => {
    const saFixture = activitiesFixtures.shortAnswer

    it('[CASO-EDGE-SA-NFD-CLI] shortAnswer: acepta sin tildes con ignoreAccents: true ("fotosintesis")', () => {
      const respSinTilde = { type: 'shortAnswer', value: 'fotosintesis' }
      expect(compareActivityResponse(saFixture.activity, respSinTilde)).toBe(true)
    })

    it('[CASO-EDGE-SA-CASE-CLI] shortAnswer: insensible a mayúsculas con caseSensitive: false ("FoToSíNtEsIs")', () => {
      const respCase = { type: 'shortAnswer', value: 'FoToSíNtEsIs' }
      expect(compareActivityResponse(saFixture.activity, respCase)).toBe(true)
    })

    it('[CASO-EDGE-SA-SPC-CLI] shortAnswer: colapso de espacios en blanco repetidos ("  fotosíntesis   ")', () => {
      const respEspaciada = { type: 'shortAnswer', value: '  fotosíntesis   ' }
      expect(compareActivityResponse(saFixture.activity, respEspaciada)).toBe(true)
    })

    it('[CASO-EDGE-SA-BLK-CLI] shortAnswer: espacios en blanco puros clasificados como omitido ("      ")', () => {
      const respEspacios = { type: 'shortAnswer', value: '      ' }
      const evalResp = evaluateActivityResponse(saFixture.activity, respEspacios, 10)
      expect(evalResp.status).toBe('omitted')
      expect(evalResp.correct).toBeNull()
      expect(evalResp.score).toBe(0)
    })

    it('[CASO-EDGE-MW-PHR-CLI] markWords: reconoce sintagma compuesto continuo', () => {
      const mwFixture = activitiesFixtures.markWords
      expect(compareActivityResponse(mwFixture.activity, mwFixture.validResponse)).toBe(true)
    })
  })

  // 3. Control de Sensibilidad de Aserciones en Cliente (SENS-01 a SENS-13)
  describe('Controles de Sensibilidad: invertir respuesta cambia evaluación de acierto a fallo', () => {
    let index = 1
    for (const type of activityKeys) {
      const fixture = activitiesFixtures[type]
      const idxStr = String(index++).padStart(2, '0')
      it(`[CASO-CTRL-SENS-${idxStr}-CLI] Sensibilidad en ${type}: evaluar válido da 10 y evaluar erróneo da 0`, () => {
        const evalValid = evaluateActivityResponse(fixture.activity, fixture.validResponse, 10)
        const evalInco = evaluateActivityResponse(fixture.activity, fixture.incorrectResponse, 10)

        expect(evalValid.score).toBe(10)
        expect(evalInco.score).toBe(0)
        expect(evalValid.correct).toBe(true)
        expect(evalInco.correct).toBe(false)
      })
    }
  })
})
