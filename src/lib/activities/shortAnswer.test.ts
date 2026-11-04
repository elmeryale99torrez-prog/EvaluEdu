import { describe, it, expect } from 'vitest'
import {
  SHORT_ANSWER_LIMITS,
  normalizeShortAnswer,
  validateShortAnswerActivity,
  toShortAnswerPublic,
  evaluateShortAnswerResponse,
  generateShortAnswerTeacherReport,
  type ShortAnswerDefinition,
} from './shortAnswer'

describe('Actividad #13: Respuesta Corta Conceptual (shortAnswer)', () => {
  const sampleDef: ShortAnswerDefinition = {
    context: 'En el estudio de los orgánulos celulares y el metabolismo energético.',
    prompt: '¿Cuál es el orgánulo celular responsable de la respiración celular y la síntesis de ATP?',
    acceptedAnswers: ['Mitocondria', 'Las mitocondrias', 'Mitocondrias'],
    caseSensitive: false,
    ignoreAccents: true,
    placeholder: 'Escribe el nombre del orgánulo...',
    hint: 'Piensa en la central energética de las células eucariotas.',
    explanation: 'La mitocondria genera la mayor parte del ATP mediante la fosforilación oxidativa.',
  }

  describe('1. Normalización de texto (normalizeShortAnswer)', () => {
    it('ignora mayúsculas y espacios múltiples por defecto', () => {
      expect(normalizeShortAnswer('  MiToCoNdRiA   ')).toBe('mitocondria')
      expect(normalizeShortAnswer('Las    Mitocondrias')).toBe('las mitocondrias')
    })

    it('remueve tildes cuando ignoreAccents es true o no se especifica', () => {
      expect(normalizeShortAnswer('Célula')).toBe('celula')
      expect(normalizeShortAnswer('respiración aeróbica')).toBe('respiracion aerobica')
    })

    it('respeta mayúsculas si caseSensitive es true', () => {
      expect(normalizeShortAnswer('ADN', { caseSensitive: true })).toBe('ADN')
      expect(normalizeShortAnswer('adn', { caseSensitive: true })).toBe('adn')
    })

    it('conserva tildes si ignoreAccents es false explícitamente', () => {
      expect(normalizeShortAnswer('célula', { ignoreAccents: false })).toBe('célula')
      expect(normalizeShortAnswer('celula', { ignoreAccents: false })).toBe('celula')
    })
  })

  describe('2. Validación de definición (validateShortAnswerActivity)', () => {
    it('aprueba una definición válida', () => {
      const res = validateShortAnswerActivity(sampleDef)
      expect(res.valid).toBe(true)
      expect(res.errors).toHaveLength(0)
    })

    it('rechaza si falta la consigna o es muy corta', () => {
      const res = validateShortAnswerActivity({ ...sampleDef, prompt: '¿Qué' })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('consigna'))).toBe(true)
    })

    it('rechaza si no tiene respuestas aceptadas', () => {
      const res = validateShortAnswerActivity({ ...sampleDef, acceptedAnswers: [] })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('respuesta válida'))).toBe(true)
    })

    it('rechaza si excede el máximo de respuestas aceptadas', () => {
      const res = validateShortAnswerActivity({
        ...sampleDef,
        acceptedAnswers: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('No puedes incluir más'))).toBe(true)
    })

    it('rechaza si la pista orientadora es insuficiente', () => {
      const res = validateShortAnswerActivity({ ...sampleDef, hint: 'Ojo' })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.includes('pista orientadora'))).toBe(true)
    })
  })

  describe('3. Proyección pública (toShortAnswerPublic)', () => {
    it('oculta estrictamente acceptedAnswers y explanation', () => {
      const pub = toShortAnswerPublic(sampleDef)
      expect((pub as any).acceptedAnswers).toBeUndefined()
      expect((pub as any).explanation).toBeUndefined()
      expect(pub.prompt).toBe(sampleDef.prompt)
      expect(pub.placeholder).toBe(sampleDef.placeholder)
      expect(pub.hint).toBe(sampleDef.hint)
    })
  })

  describe('4. Evaluación pedagógica (evaluateShortAnswerResponse)', () => {
    it('califica como omitida una respuesta vacía o con solo espacios', () => {
      const res1 = evaluateShortAnswerResponse(sampleDef, { type: 'shortAnswer', value: '' }, 10)
      expect(res1.status).toBe('omitted')
      expect(res1.correct).toBeNull()
      expect(res1.score).toBe(0)

      const res2 = evaluateShortAnswerResponse(sampleDef, { type: 'shortAnswer', value: '   ' }, 10)
      expect(res2.status).toBe('omitted')
      expect(res2.correct).toBeNull()
    })

    it('otorga puntaje completo cuando la respuesta coincide con alguna variante aceptada', () => {
      // Coincidencia exacta
      const r1 = evaluateShortAnswerResponse(sampleDef, { type: 'shortAnswer', value: 'Mitocondria' }, 10)
      expect(r1.status).toBe('answered')
      expect(r1.correct).toBe(true)
      expect(r1.score).toBe(10)

      // Minúsculas y espacios
      const r2 = evaluateShortAnswerResponse(sampleDef, { type: 'shortAnswer', value: '  mitocondria  ' }, 10)
      expect(r2.correct).toBe(true)
      expect(r2.score).toBe(10)

      // Segunda variante ("Las mitocondrias")
      const r3 = evaluateShortAnswerResponse(sampleDef, { type: 'shortAnswer', value: 'las mitocondrias' }, 10)
      expect(r3.correct).toBe(true)
      expect(r3.score).toBe(10)
    })

    it('califica como incorrecta con 0 puntos cuando la respuesta no coincide', () => {
      const r = evaluateShortAnswerResponse(sampleDef, { type: 'shortAnswer', value: 'Cloroplasto' }, 10)
      expect(r.status).toBe('answered')
      expect(r.correct).toBe(false)
      expect(r.score).toBe(0)
    })
  })

  describe('5. Reporte docente (generateShortAnswerTeacherReport)', () => {
    it('genera el reporte completo de auditoría privada', () => {
      const rep = generateShortAnswerTeacherReport(sampleDef, { type: 'shortAnswer', value: 'mitocondria' })
      expect(rep.studentAnswer).toBe('mitocondria')
      expect(rep.isCorrect).toBe(true)
      expect(rep.acceptedAnswers).toEqual(sampleDef.acceptedAnswers)
      expect(rep.explanation).toBe(sampleDef.explanation)
    })
  })
})
