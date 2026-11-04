import { describe, expect, it } from 'vitest';
import { compareActivityResponse, evaluateActivityResponse, type Activity } from '../activityEngine';

// Integración del contrato v1.3 de Selección múltiple con el motor común (datos técnicos Fixture).
const activity: Activity = {
  id: 'ms-int',
  title: 'Fixture Selección múltiple',
  type: 'multiSelect',
  topic: 'Fixture',
  difficulty: 'Intermedio',
  prompt: '¿Cuáles de las siguientes acciones protegen una cuenca hidrográfica?',
  options: [
    'Reforestar las riberas con especies nativas',
    'Verter aguas residuales sin tratamiento',
    'Monitorear la calidad del agua periódicamente',
    'Eliminar los humedales naturales',
  ],
  answer: [
    'Reforestar las riberas con especies nativas',
    'Monitorear la calidad del agua periódicamente',
  ],
  feedback: 'Identifica las medidas que conservan la cobertura vegetal y vigilan el estado químico y biológico del cauce.',
  status: 'published',
  details: {
    multiSelect: {
      context: 'Un municipio diseña un plan de manejo integral para recuperar su río principal.',
      hint: 'Identifica las medidas que conservan la cobertura vegetal y vigilan el estado químico y biológico del cauce.',
      explanation: 'La reforestación ribereña y el monitoreo periódico protegen la cuenca; los vertimientos y drenajes la degradan.',
      options: [
        { id: 'opt-a', label: 'Reforestar las riberas con especies nativas', correct: true },
        { id: 'opt-b', label: 'Verter aguas residuales sin tratamiento', correct: false },
        { id: 'opt-c', label: 'Monitorear la calidad del agua periódicamente', correct: true },
        { id: 'opt-d', label: 'Eliminar los humedales naturales', correct: false },
      ],
    },
  },
};

describe('Motor común · Selección múltiple v1.3', () => {
  it('una respuesta vacía se registra como omitida, no como respuesta incorrecta', () => {
    expect(evaluateActivityResponse(activity, { type: 'multiSelect', values: [] }, 10)).toEqual({
      response: '',
      status: 'omitted',
      correct: null,
      score: 0,
    });
  });

  it('califica como correcta solo la selección exacta de todas las claves correctas (por etiqueta o ID)', () => {
    expect(
      evaluateActivityResponse(
        activity,
        {
          type: 'multiSelect',
          values: [
            'Reforestar las riberas con especies nativas',
            'Monitorear la calidad del agua periódicamente',
          ],
        },
        10,
      ),
    ).toMatchObject({ status: 'answered', correct: true, score: 10 });

    expect(
      evaluateActivityResponse(activity, { type: 'multiSelect', values: ['opt-a', 'opt-c'] }, 10),
    ).toMatchObject({ status: 'answered', correct: true, score: 10 });

    // Parcial (solo 1 de 2)
    expect(
      evaluateActivityResponse(activity, { type: 'multiSelect', values: ['opt-a'] }, 10),
    ).toMatchObject({ status: 'answered', correct: false, score: 0 });

    // Con distractor (opt-b)
    expect(
      evaluateActivityResponse(activity, { type: 'multiSelect', values: ['opt-a', 'opt-b', 'opt-c'] }, 10),
    ).toMatchObject({ status: 'answered', correct: false, score: 0 });
  });

  it('una respuesta de Selección múltiple no puntúa en una actividad de otro tipo', () => {
    const other: Activity = {
      ...activity,
      id: 'tf',
      type: 'trueFalse',
      options: ['Verdadero', 'Falso'],
      answer: 'Verdadero',
      details: { trueFalse: { statement: 'Afirmación', correct: true, explanation: 'Explicación' } },
    };
    expect(compareActivityResponse(other, { type: 'multiSelect', values: ['Verdadero'] })).toBe(false);
  });
});
