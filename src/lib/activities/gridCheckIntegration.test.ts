import { describe, it, expect } from 'vitest';
import {
  Activity,
  createInitialResponse,
  isResponseComplete,
  compareActivityResponse,
  evaluateActivityResponse,
  serializeActivityResponse,
} from '../activityEngine';

describe('Capa 2: Integración de gridCheck (Matriz de Doble Entrada) en el Motor Central', () => {
  const sampleActivity: Activity = {
    id: 'act-grid-01',
    title: 'Comparativa Celular',
    type: 'gridCheck',
    topic: 'Biología Celular',
    difficulty: 'Intermedio',
    prompt: 'Marca las estructuras presentes en cada tipo de célula:',
    options: ['Célula Vegetal', 'Célula Animal', 'Bacteria'],
    answer: ['r1:c1', 'r1:c2', 'r2:c2', 'r3:c1'],
    feedback: 'Revisa las diferencias entre procariotas y eucariotas.',
    status: 'published',
    details: {
      gridCheck: {
        rows: [
          { id: 'r1', label: 'Célula Vegetal' },
          { id: 'r2', label: 'Célula Animal' },
          { id: 'r3', label: 'Bacteria' },
        ],
        columns: [
          { id: 'c1', label: 'Pared Celular' },
          { id: 'c2', label: 'Núcleo Celular' },
        ],
        expectedCells: ['r1:c1', 'r1:c2', 'r2:c2', 'r3:c1'],
        hint: 'Los animales no tienen pared celular; las bacterias no tienen núcleo.',
        explanation: 'La pared celular está presente en vegetales y bacterias; el núcleo solo en eucariotas vegetales y animales.',
      },
    },
  };

  it('inicializa la respuesta vacía y valida completitud adecuadamente', () => {
    const initial = createInitialResponse(sampleActivity);
    expect(initial).toEqual({ type: 'gridCheck', values: [] });
    expect(isResponseComplete(sampleActivity, initial)).toBe(false);

    const withCells = { type: 'gridCheck' as const, values: ['r1:c1'] };
    expect(isResponseComplete(sampleActivity, withCells)).toBe(true);
  });

  it('califica acierto exacto con puntaje completo y serializa la respuesta', () => {
    const correctResponse = {
      type: 'gridCheck' as const,
      values: ['r1:c1', 'r1:c2', 'r2:c2', 'r3:c1'],
    };

    expect(compareActivityResponse(sampleActivity, correctResponse)).toBe(true);

    const evaluated = evaluateActivityResponse(sampleActivity, correctResponse, 10);
    expect(evaluated.status).toBe('answered');
    expect(evaluated.correct).toBe(true);
    expect(evaluated.score).toBe(10);
    expect(serializeActivityResponse(correctResponse)).toBe('r1:c1 | r1:c2 | r2:c2 | r3:c1');
  });

  it('trata la respuesta vacía como omisión con score 0 y correct null', () => {
    const emptyResponse = {
      type: 'gridCheck' as const,
      values: [],
    };

    const evaluated = evaluateActivityResponse(sampleActivity, emptyResponse, 10);
    expect(evaluated.status).toBe('omitted');
    expect(evaluated.correct).toBeNull();
    expect(evaluated.score).toBe(0);
    expect(evaluated.response).toBe('');
  });
});
