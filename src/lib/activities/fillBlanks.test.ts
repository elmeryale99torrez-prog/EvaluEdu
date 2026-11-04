import { describe, expect, it } from 'vitest';
import {
  evaluateFillBlanks,
  extractBlankMarkers,
  FILL_BLANKS_LIMITS,
  formatFillBlanksReport,
  parseTextWithBlanks,
  scrambleWordBank,
  toFillBlanksPublic,
  validateFillBlanksDefinition,
  type FillBlanksPrivate,
} from './fillBlanks';

const validDefinition: FillBlanksPrivate = {
  type: 'fillBlanks',
  id: 'fb-agua-1',
  context: 'El ciclo hidrológico permite la renovación continua del agua en los ecosistemas terrestres.',
  prompt: 'Completa el párrafo ubicando cada proceso físico en el espacio que le corresponde.',
  textWithBlanks: 'La radiación solar provoca la {{1}} del agua superficial, mientras que el enfriamiento del vapor en la atmósfera genera su {{2}}.',
  blanks: [
    { id: 'b-1', answer: 'evaporación' },
    { id: 'b-2', answer: 'condensación' },
  ],
  distractors: ['filtración', 'solidificación'],
  hint: 'Analiza cuál proceso transforma el líquido en vapor por calor y cuál transforma el vapor nuevamente en gotas.',
  explanation: 'El calor solar evapora el agua líquida (evaporación) y el descenso térmico en altura condensa el vapor formando nubes (condensación).',
};

describe('Contrato Completar Espacios Guiado (fillBlanks)', () => {
  it('acepta una definición válida con marcadores {{1}}, {{2}}, respuestas y distractores', () => {
    expect(validateFillBlanksDefinition(validDefinition)).toEqual([]);
  });

  it('extrae y segmenta correctamente los marcadores {{n}} del texto', () => {
    expect(extractBlankMarkers(validDefinition.textWithBlanks)).toEqual([1, 2]);
    const segments = parseTextWithBlanks('Inicio {{1}} medio {{2}} fin.');
    expect(segments).toEqual([
      { kind: 'text', text: 'Inicio ' },
      { kind: 'blank', index: 0, blankNumber: 1 },
      { kind: 'text', text: ' medio ' },
      { kind: 'blank', index: 1, blankNumber: 2 },
      { kind: 'text', text: ' fin.' },
    ]);
  });

  it('rechaza textos donde falte un marcador {{n}}, esté repetido o apunte fuera de rango', () => {
    const missingMarker = validateFillBlanksDefinition({
      ...validDefinition,
      textWithBlanks: 'Solo aparece el primer espacio {{1}} pero no el segundo.',
    });
    expect(missingMarker.some((i) => i.path === 'textWithBlanks' && i.message.includes('{{2}}'))).toBe(true);

    const repeatedMarker = validateFillBlanksDefinition({
      ...validDefinition,
      textWithBlanks: 'Espacio {{1}} repetido {{1}} y {{2}}.',
    });
    expect(repeatedMarker.some((i) => i.path === 'textWithBlanks' && i.message.includes('repetido'))).toBe(true);

    const outOfRange = validateFillBlanksDefinition({
      ...validDefinition,
      textWithBlanks: 'Espacio {{1}}, {{2}} y un marcador inexistente {{3}}.',
    });
    expect(outOfRange.some((i) => i.path === 'textWithBlanks' && i.message.includes('{{3}}'))).toBe(true);
  });

  it('rechaza si no hay distractores o si hay palabras duplicadas en el banco', () => {
    const noDistractors = validateFillBlanksDefinition({
      ...validDefinition,
      distractors: [],
    });
    expect(noDistractors.some((i) => i.path === 'distractors')).toBe(true);

    const duplicateWord = validateFillBlanksDefinition({
      ...validDefinition,
      distractors: ['Evaporación', 'precipitación'],
    });
    expect(duplicateWord.some((i) => i.path === 'distractors[0]')).toBe(true);
  });

  it('rechaza marcadores prohibidos y textos que exceden los límites', () => {
    const issues = validateFillBlanksDefinition({
      ...validDefinition,
      hint: 'pendiente',
      prompt: 'x'.repeat(FILL_BLANKS_LIMITS.prompt + 1),
    });
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['hint', 'prompt']));
  });

  it('proyecta la vista pública con el banco barajado y sin revelar cuáles son las respuestas correctas', () => {
    const pub = toFillBlanksPublic(validDefinition);
    expect(pub).toEqual({
      type: 'fillBlanks',
      id: 'fb-agua-1',
      context: validDefinition.context,
      prompt: validDefinition.prompt,
      textWithBlanks: validDefinition.textWithBlanks,
      blankIds: ['b-1', 'b-2'],
      bank: scrambleWordBank(['evaporación', 'condensación'], ['filtración', 'solidificación']),
    });
    expect(pub.bank).toHaveLength(4);
    expect('blanks' in pub).toBe(false);
    expect('distractors' in pub).toBe(false);
    expect('hint' in pub).toBe(false);
    expect('explanation' in pub).toBe(false);
  });

  it('califica con puntaje completo solo cuando todos los espacios tienen la ficha correcta', () => {
    const correctRes = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'confirmed',
        answers: { 'b-1': 'evaporación', 'b-2': 'condensación' },
      },
      10,
    );
    expect(correctRes.outcome).toBe('correct');
    expect(correctRes.correct).toBe(true);
    expect(correctRes.score).toBe(10);
    expect(correctRes.studentFeedback).toBe(validDefinition.hint);

    const swappedRes = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'confirmed',
        answers: { 'b-1': 'condensación', 'b-2': 'evaporación' },
      },
      10,
    );
    expect(swappedRes.outcome).toBe('incorrect');
    expect(swappedRes.correct).toBe(false);
    expect(swappedRes.score).toBe(0);
    expect(swappedRes.studentFeedback).toBe(validDefinition.hint);
  });

  it('registra estado omitido y timeout parcial sin otorgar puntaje', () => {
    const omitted = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'omitted',
        answers: {},
      },
      10,
    );
    expect(omitted.outcome).toBe('omitted');
    expect(omitted.correct).toBeNull();
    expect(omitted.score).toBe(0);

    const timeout = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'partial_timeout',
        answers: { 'b-1': 'evaporación' },
      },
      10,
    );
    expect(timeout.outcome).toBe('timeout');
    expect(timeout.correct).toBeNull();
    expect(timeout.score).toBe(0);
    expect(timeout.correctBlanksCount).toBe(1);
  });

  it('rechaza fichas inventadas fuera del banco o la misma ficha usada dos veces', () => {
    const fakeWord = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'confirmed',
        answers: { 'b-1': 'evaporación', 'b-2': 'sublimación' },
      },
      10,
    );
    expect(fakeWord.outcome).toBe('rejected');

    const duplicatedUse = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'confirmed',
        answers: { 'b-1': 'evaporación', 'b-2': 'evaporación' },
      },
      10,
    );
    expect(duplicatedUse.outcome).toBe('rejected');
  });

  it('formatea el reporte privado para el docente y el CSV', () => {
    const evalResult = evaluateFillBlanks(
      validDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'fb-agua-1',
        activityType: 'fillBlanks',
        status: 'confirmed',
        answers: { 'b-1': 'evaporación', 'b-2': 'filtración' },
      },
      10,
    );
    const report = formatFillBlanksReport(validDefinition, evalResult);
    expect(report.expectedAnswer).toBe('[1] evaporación | [2] condensación');
    expect(report.studentAnswer).toBe('[1] evaporación | [2] filtración');
    expect(report.correctBlanksCount).toBe(1);
    expect(report.totalBlanks).toBe(2);
  });
});
