import { describe, expect, it } from 'vitest';
import {
  MARK_WORDS_TYPE,
  MarkWordsDefinition,
  evaluateMarkWords,
  formatMarkWordsReport,
  parseMarkWordsText,
  toMarkWordsPublic,
  validateMarkWordsDefinition,
  validateMarkWordsResponse,
} from './markWords';

const sampleParagraph =
  'En el ecosistema, la [energía solar*] y el [viento*] actúan como fuentes limpias, mientras que el [carbón] y el [petróleo] generan altas emisiones de carbono.';

const { tokens: sampleTokens } = parseMarkWordsText(sampleParagraph);

const validDefinition: MarkWordsDefinition = {
  type: MARK_WORDS_TYPE,
  id: 'mw-demo-1',
  context: 'Transición energética y sostenibilidad ambiental comunitaria.',
  prompt: 'Lee el siguiente texto y resalta con un toque todas las fuentes de energía renovable mencionadas:',
  text: sampleParagraph,
  words: sampleTokens,
  hint: 'Identifica las energías que provienen de fuentes naturales inagotables y no de combustibles fósiles.',
  explanation: 'La energía solar y el viento son fuentes renovables; el carbón y el petróleo son hidrocarburos fósiles.',
};

describe('Contrato aislado: markWords (Marcar Palabras en el Texto)', () => {
  it('parsea correctamente párrafos con corchetes identificando términos con y sin asterisco', () => {
    const { segments, tokens } = parseMarkWordsText(
      'La fotosíntesis requiere [luz solar*] y [agua*], pero no [ácido sulfúrico].',
    );
    expect(tokens).toHaveLength(3);
    expect(tokens[0].text).toBe('luz solar');
    expect(tokens[0].correct).toBe(true);
    expect(tokens[1].text).toBe('agua');
    expect(tokens[1].correct).toBe(true);
    expect(tokens[2].text).toBe('ácido sulfúrico');
    expect(tokens[2].correct).toBe(false);

    expect(segments.filter((s) => s.kind === 'word')).toHaveLength(3);
    expect(segments[0].kind).toBe('text');
  });

  it('acepta una definición válida con 3 a 10 términos interactivos, al menos 1 correcto y 1 distractor', () => {
    const issues = validateMarkWordsDefinition(validDefinition);
    expect(issues).toEqual([]);
  });

  it('rechaza definiciones con menos de 3 términos interactivos o sin distractores', () => {
    const tooFew = validateMarkWordsDefinition({
      ...validDefinition,
      words: validDefinition.words.slice(0, 2),
    });
    expect(tooFew.some((i) => i.path === 'words')).toBe(true);

    const noDistractors = validateMarkWordsDefinition({
      ...validDefinition,
      words: validDefinition.words.map((w) => ({ ...w, correct: true })),
    });
    expect(noDistractors.some((i) => i.path === 'words')).toBe(true);

    const noCorrect = validateMarkWordsDefinition({
      ...validDefinition,
      words: validDefinition.words.map((w) => ({ ...w, correct: false })),
    });
    expect(noCorrect.some((i) => i.path === 'words')).toBe(true);
  });

  it('oculta correct, explanation y sourceRef en la proyección pública para el estudiante', () => {
    const pub = toMarkWordsPublic(validDefinition);
    expect(pub.id).toBe(validDefinition.id);
    expect(pub.words).toHaveLength(4);
    for (const w of pub.words) {
      expect('correct' in w).toBe(false);
    }
    expect('explanation' in pub).toBe(false);
  });

  it('valida respuestas del estudiante y rechaza términos no interactivos', () => {
    expect(validateMarkWordsResponse(validDefinition, { type: 'markWords', values: ['mw-1', 'mw-2'] })).toEqual([]);
    expect(validateMarkWordsResponse(validDefinition, { type: 'markWords', values: ['energía solar'] })).toEqual([]);
    expect(validateMarkWordsResponse(validDefinition, { type: 'markWords', values: [] })).toEqual([]);

    const invalid = validateMarkWordsResponse(validDefinition, {
      type: 'markWords',
      values: ['palabra-fantasma'],
    });
    expect(invalid.some((i) => i.path === 'values')).toBe(true);
  });

  it('califica por coincidencia exacta (todos los correctos y ningún distractor)', () => {
    // Acierto exacto por ID
    const perfectById = evaluateMarkWords(validDefinition, { type: 'markWords', values: ['mw-1', 'mw-2'] }, 10);
    expect(perfectById.status).toBe('answered');
    expect(perfectById.correct).toBe(true);
    expect(perfectById.score).toBe(10);
    expect(perfectById.studentHint).toBe(validDefinition.hint);

    // Acierto exacto por texto
    const perfectByText = evaluateMarkWords(
      validDefinition,
      { type: 'markWords', values: ['viento', 'energía solar'] },
      10,
    );
    expect(perfectByText.correct).toBe(true);
    expect(perfectByText.score).toBe(10);

    // Selección parcial (falta 'viento') -> 0 puntos
    const partial = evaluateMarkWords(validDefinition, { type: 'markWords', values: ['energía solar'] }, 10);
    expect(partial.correct).toBe(false);
    expect(partial.score).toBe(0);

    // Selección con distractor ('carbón') -> 0 puntos
    const withDistractor = evaluateMarkWords(
      validDefinition,
      { type: 'markWords', values: ['energía solar', 'viento', 'carbón'] },
      10,
    );
    expect(withDistractor.correct).toBe(false);
    expect(withDistractor.score).toBe(0);

    // Sin respuesta -> omitida
    const omitted = evaluateMarkWords(validDefinition, { type: 'markWords', values: [] }, 10);
    expect(omitted.status).toBe('omitted');
    expect(omitted.correct).toBeNull();
    expect(omitted.score).toBe(0);
  });

  it('genera el reporte docente con las palabras esperadas y las respuestas del alumno', () => {
    const evaluation = evaluateMarkWords(validDefinition, { type: 'markWords', values: ['mw-1', 'mw-2'] }, 10);
    const report = formatMarkWordsReport(validDefinition, evaluation);
    expect(report.expectedWords).toContain('energía solar');
    expect(report.expectedWords).toContain('viento');
    expect(report.studentAnswer).toContain('energía solar');
    expect(report.correct).toBe(true);
    expect(report.privateExplanation).toContain('hidrocarburos fósiles');
  });
});
