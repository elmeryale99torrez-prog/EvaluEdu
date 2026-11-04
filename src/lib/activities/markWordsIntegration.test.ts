import { describe, expect, it } from 'vitest';
import {
  Activity,
  compareActivityResponse,
  createInitialResponse,
  evaluateActivityResponse,
  isResponseComplete,
} from '../activityEngine';

const demoMarkWords: Activity = {
  id: 'act-mw-1',
  title: 'Identificación de fuentes renovables en el texto',
  type: 'markWords',
  topic: 'Sostenibilidad ambiental',
  difficulty: 'Intermedio',
  prompt: 'Lee el siguiente texto y resalta con un toque todas las fuentes de energía renovable mencionadas:',
  options: ['energía solar', 'viento', 'carbón', 'petróleo'],
  answer: ['energía solar', 'viento'],
  feedback: 'Identifica las energías que provienen de fuentes naturales inagotables y no de combustibles fósiles.',
  details: {
    markWords: {
      context: 'Transición energética hacia un modelo comunitario descarbonizado.',
      text: 'En el ecosistema local, la [energía solar*] y el [viento*] actúan como fuentes limpias, mientras que el [carbón] y el [petróleo] generan altas emisiones.',
      words: [
        { id: 'mw-1', text: 'energía solar', correct: true },
        { id: 'mw-2', text: 'viento', correct: true },
        { id: 'mw-3', text: 'carbón', correct: false },
        { id: 'mw-4', text: 'petróleo', correct: false },
      ],
      hint: 'Identifica las energías que provienen de fuentes naturales inagotables y no de combustibles fósiles.',
      explanation: 'La energía solar y el viento son renovables; el carbón y petróleo son fósiles con altas emisiones.',
    },
  },
  status: 'published',
};

describe('Integración en motor central: markWords (Marcar Palabras en el Texto)', () => {
  it('inicializa una respuesta vacía y la clasifica como omitida', () => {
    const initial = createInitialResponse(demoMarkWords);
    expect(initial).toEqual({ type: 'markWords', values: [] });
    expect(isResponseComplete(demoMarkWords, initial)).toBe(false);

    const evaluated = evaluateActivityResponse(demoMarkWords, initial, 10);
    expect(evaluated).toEqual({
      response: '',
      status: 'omitted',
      correct: null,
      score: 0,
    });
  });

  it('califica con puntaje completo al seleccionar exactamente todas las palabras correctas por ID o texto', () => {
    const byId = evaluateActivityResponse(
      demoMarkWords,
      { type: 'markWords', values: ['mw-1', 'mw-2'] },
      10,
    );
    expect(byId.status).toBe('answered');
    expect(byId.correct).toBe(true);
    expect(byId.score).toBe(10);
    expect(byId.response).toContain('mw-1');

    const byText = evaluateActivityResponse(
      demoMarkWords,
      { type: 'markWords', values: ['viento', 'energía solar'] },
      10,
    );
    expect(byText.status).toBe('answered');
    expect(byText.correct).toBe(true);
    expect(byText.score).toBe(10);
  });

  it('califica con 0 puntos si la selección es parcial o incluye distractores', () => {
    // Selección parcial (falta 'viento')
    expect(
      compareActivityResponse(demoMarkWords, { type: 'markWords', values: ['mw-1'] }),
    ).toBe(false);
    const partial = evaluateActivityResponse(
      demoMarkWords,
      { type: 'markWords', values: ['mw-1'] },
      10,
    );
    expect(partial.status).toBe('answered');
    expect(partial.correct).toBe(false);
    expect(partial.score).toBe(0);

    // Selección con distractor ('carbón')
    const withDistractor = evaluateActivityResponse(
      demoMarkWords,
      { type: 'markWords', values: ['mw-1', 'mw-2', 'mw-3'] },
      10,
    );
    expect(withDistractor.status).toBe('answered');
    expect(withDistractor.correct).toBe(false);
    expect(withDistractor.score).toBe(0);
  });
});
