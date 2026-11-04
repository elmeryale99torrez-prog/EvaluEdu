import { describe, expect, it } from 'vitest'
import {
  compareActivityResponse,
  createInitialResponse,
  evaluateActivityResponse,
  isResponseComplete,
  type Activity,
} from '../activityEngine'

const fillBlanksActivity: Activity = {
  id: 'a-fb-1',
  title: 'Ciclo hidrológico',
  type: 'fillBlanks',
  topic: 'Sostenibilidad',
  difficulty: 'Intermedio',
  prompt: 'Completa el párrafo ubicando cada proceso en su espacio.',
  options: ['evaporación', 'condensación', 'filtración', 'solidificación'],
  answer: ['evaporación', 'condensación'],
  feedback: 'Recuerda qué proceso pasa de líquido a gas y cuál de gas a líquido.',
  details: {
    fillBlanks: {
      context: 'El sol impulsa los cambios de estado del agua en la atmósfera.',
      textWithBlanks: 'El calor solar provoca la {{1}} y el enfriamiento en altura produce la {{2}}.',
      blanks: [
        { id: 'b-1', answer: 'evaporación' },
        { id: 'b-2', answer: 'condensación' },
      ],
      distractors: ['filtración', 'solidificación'],
      hint: 'Recuerda qué proceso pasa de líquido a gas y cuál de gas a líquido.',
      explanation: 'Evaporación es el paso a vapor y condensación la formación de gotas en las nubes.',
    },
  },
  status: 'published',
}

describe('Integración de Completar Espacios (fillBlanks) en activityEngine', () => {
  it('crea respuesta inicial vacía y la evalúa como omitida sin penalizar', () => {
    const initial = createInitialResponse(fillBlanksActivity)
    expect(initial).toEqual({ type: 'fillBlanks', answers: {} })
    expect(isResponseComplete(fillBlanksActivity, initial)).toBe(false)

    const evaluated = evaluateActivityResponse(fillBlanksActivity, initial, 10)
    expect(evaluated).toEqual({
      response: '',
      status: 'omitted',
      correct: null,
      score: 0,
    })
  })

  it('califica como correcta cuando todos los espacios coinciden con su respuesta (por ID o índice)', () => {
    const byId = evaluateActivityResponse(
      fillBlanksActivity,
      { type: 'fillBlanks', answers: { 'b-1': 'evaporación', 'b-2': 'condensación' } },
      10,
    )
    expect(byId.status).toBe('answered')
    expect(byId.correct).toBe(true)
    expect(byId.score).toBe(10)

    const byIndex = evaluateActivityResponse(
      fillBlanksActivity,
      { type: 'fillBlanks', answers: { '1': 'evaporación', '2': 'condensación' } },
      10,
    )
    expect(byIndex.correct).toBe(true)
    expect(byIndex.score).toBe(10)
  })

  it('califica como incorrecta si hay un espacio vacío, invertido o con distractor, y rechaza cruce de tipos', () => {
    const partial = evaluateActivityResponse(
      fillBlanksActivity,
      { type: 'fillBlanks', answers: { 'b-1': 'evaporación' } },
      10,
    )
    expect(partial.status).toBe('answered')
    expect(partial.correct).toBe(false)
    expect(partial.score).toBe(0)

    const withDistractor = evaluateActivityResponse(
      fillBlanksActivity,
      { type: 'fillBlanks', answers: { 'b-1': 'evaporación', 'b-2': 'filtración' } },
      10,
    )
    expect(withDistractor.correct).toBe(false)
    expect(withDistractor.score).toBe(0)

    expect(compareActivityResponse(fillBlanksActivity, { type: 'singleChoice', value: 'evaporación' })).toBe(false)
  })
})
