import { describe, expect, it } from 'vitest';
import {
  createEmptyMultiSelectResponse,
  evaluateMultiSelect,
  formatMultiSelectReport,
  isMultiSelectDefinition,
  MULTI_SELECT_LIMITS,
  toMultiSelectPublic,
  validateMultiSelectDefinition,
  type MultiSelectPrivate,
} from './multiSelect';

const sampleDefinition: MultiSelectPrivate = {
  type: 'multiSelect',
  id: 'ms-1',
  context: 'Un equipo de biología analiza los factores que aceleran la fotosíntesis en plantas acuáticas bajo condiciones de laboratorio.',
  prompt: '¿Cuáles de las siguientes condiciones incrementan directamente la tasa fotosintética hasta su punto de saturación?',
  options: [
    { id: 'opt-1', label: 'Aumento de la intensidad lumínica dentro del rango óptimo', correct: true },
    { id: 'opt-2', label: 'Disponibilidad adecuada de dióxido de carbono disuelto', correct: true },
    { id: 'opt-3', label: 'Ausencia total de pigmentos clorofílicos en las hojas', correct: false },
    { id: 'opt-4', label: 'Temperatura ambiental mantenida en el rango enzimático óptimo', correct: true },
  ],
  hint: 'Analiza qué factores actúan como insumos energéticos, sustratos químicos o reguladores catalíticos de la fase luminosa y oscura.',
  explanation: 'La luz, el CO2 y una temperatura óptima impulsan la fotosíntesis; sin clorofila no hay captación fotónica.',
};

describe('Contrato modular multiSelect v1.3', () => {
  it('acepta una definición completa y válida con 2 o más opciones correctas y al menos 1 distractor', () => {
    expect(validateMultiSelectDefinition(sampleDefinition)).toEqual([]);
    expect(isMultiSelectDefinition(sampleDefinition)).toBe(true);
  });

  it('rechaza definiciones con menos de 2 opciones correctas o sin ningún distractor', () => {
    const onlyOneCorrect = {
      ...sampleDefinition,
      options: sampleDefinition.options.map((opt, idx) => ({ ...opt, correct: idx === 0 })),
    };
    const allCorrectNoDistractor = {
      ...sampleDefinition,
      options: sampleDefinition.options.map((opt) => ({ ...opt, correct: true })),
    };
    expect(validateMultiSelectDefinition(onlyOneCorrect).map((issue) => issue.path)).toContain('correct');
    expect(validateMultiSelectDefinition(allCorrectNoDistractor).map((issue) => issue.path)).toContain('correct');
  });

  it('exige entre 3 y 6 opciones y rechaza textos duplicados o marcadores prohibidos', () => {
    const onlyTwoOptions = {
      ...sampleDefinition,
      options: sampleDefinition.options.slice(0, 2),
    };
    expect(validateMultiSelectDefinition(onlyTwoOptions).map((issue) => issue.path)).toContain('options');

    const duplicated = {
      ...sampleDefinition,
      options: [
        { id: 'opt-1', label: 'Intensidad lumínica', correct: true },
        { id: 'opt-2', label: '  intensidad   LUMÍNICA ', correct: true },
        { id: 'opt-3', label: 'Ausencia de luz', correct: false },
      ],
    };
    expect(validateMultiSelectDefinition(duplicated).some((issue) => issue.path === 'options[1].label')).toBe(true);

    const withPlaceholder = {
      ...sampleDefinition,
      hint: 'pendiente',
      options: [
        { id: 'opt-1', label: 'Opción A', correct: true },
        { id: 'opt-2', label: 'Opción B', correct: true },
        { id: 'opt-3', label: 'N/A', correct: false },
      ],
    };
    const paths = validateMultiSelectDefinition(withPlaceholder).map((issue) => issue.path);
    expect(paths).toContain('hint');
    expect(paths).toContain('options[2].label');
  });

  it('valida los límites de longitud de enunciado, contexto, opciones, pista y explicación', () => {
    const tooLong = {
      ...sampleDefinition,
      context: 'x'.repeat(MULTI_SELECT_LIMITS.context + 1),
      prompt: 'x'.repeat(MULTI_SELECT_LIMITS.prompt + 1),
      hint: 'x'.repeat(MULTI_SELECT_LIMITS.hint + 1),
      explanation: 'x'.repeat(MULTI_SELECT_LIMITS.explanation + 1),
      options: [
        { id: 'opt-1', label: 'x'.repeat(MULTI_SELECT_LIMITS.optionLabel + 1), correct: true },
        { id: 'opt-2', label: 'Opción 2', correct: true },
        { id: 'opt-3', label: 'Opción 3', correct: false },
      ],
    };
    const paths = validateMultiSelectDefinition(tooLong).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['context', 'prompt', 'hint', 'explanation', 'options[0].label']));
  });

  it('elimina las claves correctas, la cantidad de respuestas correctas, la pista y la explicación en la proyección pública', () => {
    const pub = toMultiSelectPublic(sampleDefinition);
    expect(pub).toEqual({
      type: 'multiSelect',
      id: 'ms-1',
      context: sampleDefinition.context,
      prompt: sampleDefinition.prompt,
      options: [
        { id: 'opt-1', label: 'Aumento de la intensidad lumínica dentro del rango óptimo' },
        { id: 'opt-2', label: 'Disponibilidad adecuada de dióxido de carbono disuelto' },
        { id: 'opt-3', label: 'Ausencia total de pigmentos clorofílicos en las hojas' },
        { id: 'opt-4', label: 'Temperatura ambiental mantenida en el rango enzimático óptimo' },
      ],
    });
    expect('hint' in pub).toBe(false);
    expect('explanation' in pub).toBe(false);
    expect('correctCount' in pub).toBe(false);
    pub.options.forEach((option) => {
      expect('correct' in option).toBe(false);
    });
  });

  it('califica con puntaje completo solo cuando se seleccionan exactamente todas las opciones correctas y ningún distractor', () => {
    const exactMatch = evaluateMultiSelect(
      sampleDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'ms-1',
        activityType: 'multiSelect',
        status: 'confirmed',
        values: ['opt-1', 'opt-2', 'opt-4'],
      },
      10,
    );
    expect(exactMatch).toMatchObject({
      outcome: 'correct',
      correct: true,
      score: 10,
      recordedOptionIds: ['opt-1', 'opt-2', 'opt-4'],
      studentFeedback: sampleDefinition.hint,
    });

    // Selección incompleta (faltó opt-4)
    const partialSelection = evaluateMultiSelect(
      sampleDefinition,
      {
        occurrenceId: 'occ-2',
        activityId: 'ms-1',
        activityType: 'multiSelect',
        status: 'confirmed',
        values: ['opt-1', 'opt-2'],
      },
      10,
    );
    expect(partialSelection).toMatchObject({
      outcome: 'incorrect',
      correct: false,
      score: 0,
      studentFeedback: sampleDefinition.hint,
    });

    // Selección con distractor incluido (opt-3)
    const withDistractor = evaluateMultiSelect(
      sampleDefinition,
      {
        occurrenceId: 'occ-3',
        activityId: 'ms-1',
        activityType: 'multiSelect',
        status: 'confirmed',
        values: ['opt-1', 'opt-2', 'opt-3', 'opt-4'],
      },
      10,
    );
    expect(withDistractor).toMatchObject({
      outcome: 'incorrect',
      correct: false,
      score: 0,
      studentFeedback: sampleDefinition.hint,
    });
  });

  it('distingue omisión y tiempo agotado sin otorgar puntos ni mostrar pista', () => {
    const empty = createEmptyMultiSelectResponse('occ-1', 'ms-1');
    const omitted = evaluateMultiSelect(sampleDefinition, empty, 10);
    expect(omitted).toMatchObject({
      outcome: 'omitted',
      correct: null,
      score: 0,
      recordedValues: [],
      studentFeedback: null,
    });

    const timeout = evaluateMultiSelect(
      sampleDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'ms-1',
        activityType: 'multiSelect',
        status: 'partial_timeout',
        values: ['opt-1', 'opt-2'],
      },
      10,
    );
    expect(timeout).toMatchObject({
      outcome: 'timeout',
      correct: null,
      score: 0,
      recordedOptionIds: ['opt-1', 'opt-2'],
      studentFeedback: null,
    });
  });

  it('rechaza respuestas con opciones inexistentes, duplicadas o de otro tipo', () => {
    const unknownOption = evaluateMultiSelect(
      sampleDefinition,
      { occurrenceId: 'occ-1', activityId: 'ms-1', activityType: 'multiSelect', status: 'confirmed', values: ['opt-99'] },
      10,
    );
    expect(unknownOption.outcome).toBe('rejected');

    const duplicateSelection = evaluateMultiSelect(
      sampleDefinition,
      { occurrenceId: 'occ-1', activityId: 'ms-1', activityType: 'multiSelect', status: 'confirmed', values: ['opt-1', 'opt-1'] },
      10,
    );
    expect(duplicateSelection.outcome).toBe('rejected');
  });

  it('genera fila legible para el docente y exportación CSV sin exponer IDs internos', () => {
    const hit = evaluateMultiSelect(
      sampleDefinition,
      {
        occurrenceId: 'occ-1',
        activityId: 'ms-1',
        activityType: 'multiSelect',
        status: 'confirmed',
        values: ['opt-1', 'opt-2', 'opt-4'],
      },
      10,
    );
    const report = formatMultiSelectReport(sampleDefinition, hit);
    expect(report).toEqual({
      pregunta: sampleDefinition.prompt,
      clavesCorrectas:
        'Aumento de la intensidad lumínica dentro del rango óptimo | Disponibilidad adecuada de dióxido de carbono disuelto | Temperatura ambiental mantenida en el rango enzimático óptimo',
      respuestaEstudiante:
        'Aumento de la intensidad lumínica dentro del rango óptimo | Disponibilidad adecuada de dióxido de carbono disuelto | Temperatura ambiental mantenida en el rango enzimático óptimo',
      resultado: 'Correcta',
      puntaje: '10/10',
      pistaEntregada: sampleDefinition.hint,
      explicacion: sampleDefinition.explanation,
    });
  });
});
