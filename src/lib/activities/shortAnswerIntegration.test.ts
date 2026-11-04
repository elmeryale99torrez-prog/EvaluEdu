import { describe, it, expect } from 'vitest'
import {
  activityRuntime,
  createInitialResponse,
  evaluateActivityResponse,
  isResponseComplete,
  type Activity,
} from '../activityEngine'

describe('Integración de Actividad #13: Respuesta Corta en el Motor Central (activityEngine)', () => {
  const shortAnswerActivity: Activity = {
    id: 'act-sa-1',
    title: 'Autor de la Relatividad',
    type: 'shortAnswer',
    topic: 'Física',
    difficulty: 'Intermedio',
    prompt: '¿Quién propuso la teoría de la relatividad general?',
    options: ['Albert Einstein', 'Einstein'],
    answer: ['Albert Einstein', 'Einstein'],
    feedback: 'Científico de origen alemán galardonado con el Nobel de Física en 1921.',
    details: {
      shortAnswer: {
        prompt: '¿Quién propuso la teoría de la relatividad general?',
        acceptedAnswers: ['Albert Einstein', 'Einstein'],
        caseSensitive: false,
        ignoreAccents: true,
        placeholder: 'Escribe el nombre del científico...',
        hint: 'Científico de origen alemán galardonado con el Nobel de Física en 1921.',
        explanation: 'Albert Einstein publicó la teoría de la relatividad general en 1915.',
      },
    },
    status: 'published',
  }

  it('inicializa la respuesta en blanco y detecta completitud', () => {
    const initial = createInitialResponse(shortAnswerActivity)
    expect(initial).toEqual({ type: 'shortAnswer', value: '' })
    expect(isResponseComplete(shortAnswerActivity, initial)).toBe(false)

    expect(isResponseComplete(shortAnswerActivity, { type: 'shortAnswer', value: '   ' })).toBe(false)
    expect(isResponseComplete(shortAnswerActivity, { type: 'shortAnswer', value: 'Einstein' })).toBe(true)
  })

  it('evalúa una respuesta correcta sin importar mayúsculas ni espacios redundantes', () => {
    const res = evaluateActivityResponse(
      shortAnswerActivity,
      { type: 'shortAnswer', value: '  albert einstein  ' },
      10
    )
    expect(res.status).toBe('answered')
    expect(res.correct).toBe(true)
    expect(res.score).toBe(10)
    expect(res.response).toBe('albert einstein')
  })

  it('evalúa como omitida una respuesta vacía y como incorrecta una discrepante', () => {
    const omitted = evaluateActivityResponse(shortAnswerActivity, { type: 'shortAnswer', value: '' }, 10)
    expect(omitted.status).toBe('omitted')
    expect(omitted.correct).toBeNull()
    expect(omitted.score).toBe(0)

    const incorrect = evaluateActivityResponse(
      shortAnswerActivity,
      { type: 'shortAnswer', value: 'Isaac Newton' },
      10
    )
    expect(incorrect.status).toBe('answered')
    expect(incorrect.correct).toBe(false)
    expect(incorrect.score).toBe(0)
  })
})
