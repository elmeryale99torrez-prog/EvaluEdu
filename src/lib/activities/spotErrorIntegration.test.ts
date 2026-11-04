import { describe, expect, it } from 'vitest';
import {
  Activity,
  compareActivityResponse,
  createInitialResponse,
  evaluateActivityResponse,
  isResponseComplete,
} from '../activityEngine';

const demoSpotError: Activity = {
  id: 'act-se-1',
  title: 'Detección de error en auditoría comunitaria',
  type: 'spotError',
  topic: 'Gestión comunitaria',
  difficulty: 'Intermedio',
  prompt: 'Señala cuál de los siguientes fragmentos del procedimiento presenta un error:',
  options: [
    '1. Convocar a los actores comunitarios con agenda clara.',
    '2. Omitir el acta de acuerdos para acelerar el cierre.',
    '3. Dar seguimiento a las metas con indicadores verificables.',
  ],
  answer: '2. Omitir el acta de acuerdos para acelerar el cierre.',
  feedback: 'Revisa qué paso vulnera la trazabilidad y el respaldo documental de los acuerdos.',
  details: {
    spotError: {
      context: 'Procedimiento de toma de decisiones en asamblea escolar.',
      segments: [
        { id: 'seg-1', text: '1. Convocar a los actores comunitarios con agenda clara.', hasError: false },
        { id: 'seg-2', text: '2. Omitir el acta de acuerdos para acelerar el cierre.', hasError: true },
        { id: 'seg-3', text: '3. Dar seguimiento a las metas con indicadores verificables.', hasError: false },
      ],
      correction: 'Siempre debe redactarse y firmarse el acta de acuerdos como respaldo institucional.',
      hint: 'Revisa qué paso vulnera la trazabilidad y el respaldo documental de los acuerdos.',
      explanation: 'Omitir el acta deja sin validez probatoria las decisiones adoptadas.',
    },
  },
  status: 'published',
};

describe('Integración en motor central: spotError (Detección del Error)', () => {
  it('inicializa una respuesta vacía y la clasifica como omitida', () => {
    const initial = createInitialResponse(demoSpotError);
    expect(initial).toEqual({ type: 'spotError', value: '' });
    expect(isResponseComplete(demoSpotError, initial)).toBe(false);

    const evaluated = evaluateActivityResponse(demoSpotError, initial, 10);
    expect(evaluated).toEqual({
      response: '',
      status: 'omitted',
      correct: null,
      score: 0,
    });
  });

  it('califica con puntaje completo al seleccionar el fragmento con error por ID o por texto', () => {
    const byId = evaluateActivityResponse(
      demoSpotError,
      { type: 'spotError', value: 'seg-2' },
      10,
    );
    expect(byId.status).toBe('answered');
    expect(byId.correct).toBe(true);
    expect(byId.score).toBe(10);

    const byText = evaluateActivityResponse(
      demoSpotError,
      { type: 'spotError', value: '2. Omitir el acta de acuerdos para acelerar el cierre.' },
      10,
    );
    expect(byText.correct).toBe(true);
    expect(byText.score).toBe(10);
  });

  it('califica con 0 puntos si el estudiante señala un fragmento que no tiene error', () => {
    expect(
      compareActivityResponse(demoSpotError, { type: 'spotError', value: 'seg-1' }),
    ).toBe(false);
    const wrong = evaluateActivityResponse(
      demoSpotError,
      { type: 'spotError', value: 'seg-3' },
      10,
    );
    expect(wrong.status).toBe('answered');
    expect(wrong.correct).toBe(false);
    expect(wrong.score).toBe(0);
  });
});
