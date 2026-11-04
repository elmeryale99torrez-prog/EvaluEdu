/**
 * Contrato modular de la actividad "Selección de Opción Múltiple" (multiSelect) — EduEval v1.3 (Fase 7).
 *
 * Propósito:
 * - Un archivo independiente por actividad para escalar sin mezclar reglas.
 * - Evalúa discriminación analítica integral donde 2 o más opciones son correctas y existe al menos 1 distractor.
 * - La vista pública del estudiante nunca incluye la clave (`correct`), ni cuántas opciones son correctas,
 *   ni la explicación privada (`explanation`), ni la pista (`hint`) antes de confirmar.
 * - Tras confirmar una respuesta válida, el estudiante recibe únicamente `hint` (pista orientadora neutral),
 *   igual si acierta o falla, sin revelar cuáles ni cuántas opciones son las correctas.
 * - Criterio de calificación: acierto exacto (100 % de las opciones correctas marcadas y 0 distractores marcados).
 */

export const MULTI_SELECT_TYPE = 'multiSelect' as const;

export const MULTI_SELECT_LIMITS = {
  context: 1500,
  prompt: 600,
  optionLabel: 300,
  hint: 400,
  explanation: 1000,
  minOptions: 3,
  maxOptions: 6,
  minCorrect: 2,
} as const;

export type MultiSelectOptionPrivate = {
  id: string;
  label: string;
  correct: boolean;
};

export type MultiSelectOptionPublic = {
  id: string;
  label: string;
};

/** Definición completa que manejan el editor docente, el backend y los reportes privados. */
export type MultiSelectPrivate = {
  type: typeof MULTI_SELECT_TYPE;
  id: string;
  prompt: string;
  options: MultiSelectOptionPrivate[];
  /** Pista orientadora obligatoria que ve el estudiante tras confirmar. No debe delatar las opciones correctas ni su cantidad. */
  hint: string;
  /** Contexto o caso opcional que enmarca la pregunta. */
  context?: string;
  /** Justificación privada opcional para el docente y la exportación CSV. */
  explanation?: string;
};

/** Vista pública enviada al estudiante. No incluye `correct`, cantidad de claves, `explanation` ni `hint`. */
export type MultiSelectPublic = {
  type: typeof MULTI_SELECT_TYPE;
  id: string;
  prompt: string;
  options: MultiSelectOptionPublic[];
  context?: string;
};

export type MultiSelectResponseStatus = 'confirmed' | 'omitted' | 'partial_timeout';

/** Respuesta del estudiante para una ocurrencia específica dentro de la sala. */
export type MultiSelectResponse = {
  occurrenceId: string;
  activityId: string;
  activityType: typeof MULTI_SELECT_TYPE;
  status: MultiSelectResponseStatus;
  /** Lista de IDs o etiquetas de las opciones seleccionadas (vacía cuando se omite). */
  values: string[];
};

export type MultiSelectOutcome = 'correct' | 'incorrect' | 'omitted' | 'timeout' | 'rejected';

export type MultiSelectResult = {
  outcome: MultiSelectOutcome;
  correct: boolean | null;
  score: number;
  maxScore: number;
  /** Etiquetas legibles de las opciones registradas. */
  recordedValues: string[];
  /** IDs de las opciones registradas. */
  recordedOptionIds: string[];
  /** Pista orientadora mostrada al estudiante solo cuando confirma una respuesta válida. */
  studentFeedback: string | null;
  /** Explicación privada para el docente y el CSV. */
  explanation: string | null;
  rejectionReason?: string;
};

export type MultiSelectIssue = {
  path: string;
  message: string;
};

const FORBIDDEN_PLACEHOLDERS = new Set(['n/a', 'na', 'ninguno', 'ninguna', 'null', 'undefined', 'todo', 'pendiente', '...']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function checkTextField(
  issues: MultiSelectIssue[],
  source: Record<string, unknown>,
  field: 'prompt' | 'hint' | 'context' | 'explanation',
  required: boolean,
) {
  const raw = source[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) issues.push({ path: field, message: 'Este campo es obligatorio.' });
    return;
  }
  if (typeof raw !== 'string') {
    issues.push({ path: field, message: 'Debe ser un texto.' });
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    if (required) issues.push({ path: field, message: 'No puede quedar vacío ni contener solo espacios.' });
    return;
  }
  if (FORBIDDEN_PLACEHOLDERS.has(trimmed.toLowerCase())) {
    issues.push({ path: field, message: 'No uses marcadores vacíos como "N/A" o "pendiente".' });
  }
  const limit = MULTI_SELECT_LIMITS[field];
  if (trimmed.length > limit) {
    issues.push({ path: field, message: `Supera el máximo de ${limit} caracteres.` });
  }
}

/** Valida que una definición de Selección Múltiple esté lista para publicarse. */
export function validateMultiSelectDefinition(input: unknown): MultiSelectIssue[] {
  if (!isRecord(input)) return [{ path: '', message: 'La actividad debe ser un objeto.' }];
  const issues: MultiSelectIssue[] = [];

  const allowed = ['type', 'id', 'prompt', 'options', 'hint', 'context', 'explanation'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      issues.push({ path: key, message: 'Propiedad no permitida en Selección múltiple.' });
    }
  }

  if (input.type !== MULTI_SELECT_TYPE) {
    issues.push({ path: 'type', message: 'El tipo debe ser "multiSelect".' });
  }
  if (typeof input.id !== 'string' || !input.id.trim()) {
    issues.push({ path: 'id', message: 'El identificador es obligatorio.' });
  }

  checkTextField(issues, input, 'prompt', true);
  checkTextField(issues, input, 'hint', true);
  checkTextField(issues, input, 'context', false);
  checkTextField(issues, input, 'explanation', false);

  if (!Array.isArray(input.options)) {
    issues.push({ path: 'options', message: 'Las opciones deben ser una lista.' });
    return issues;
  }

  if (input.options.length < MULTI_SELECT_LIMITS.minOptions || input.options.length > MULTI_SELECT_LIMITS.maxOptions) {
    issues.push({
      path: 'options',
      message: `La actividad debe tener entre ${MULTI_SELECT_LIMITS.minOptions} y ${MULTI_SELECT_LIMITS.maxOptions} opciones.`,
    });
  }

  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  let correctCount = 0;
  let distractorCount = 0;

  input.options.forEach((rawOption, index) => {
    const optionPath = `options[${index}]`;
    if (!isRecord(rawOption)) {
      issues.push({ path: optionPath, message: 'Cada opción debe ser un objeto.' });
      return;
    }

    const optionAllowed = ['id', 'label', 'correct'];
    for (const key of Object.keys(rawOption)) {
      if (!optionAllowed.includes(key)) {
        issues.push({ path: `${optionPath}.${key}`, message: 'Propiedad no permitida en una opción.' });
      }
    }

    const id = typeof rawOption.id === 'string' ? rawOption.id.trim() : '';
    if (!id) {
      issues.push({ path: `${optionPath}.id`, message: 'Cada opción necesita un identificador.' });
    } else if (seenIds.has(id)) {
      issues.push({ path: `${optionPath}.id`, message: 'El identificador de la opción está repetido.' });
    } else {
      seenIds.add(id);
    }

    const label = typeof rawOption.label === 'string' ? rawOption.label.trim() : '';
    if (!label) {
      issues.push({ path: `${optionPath}.label`, message: `Completa el texto de la opción ${index + 1}.` });
    } else {
      if (label.length > MULTI_SELECT_LIMITS.optionLabel) {
        issues.push({
          path: `${optionPath}.label`,
          message: `La opción ${index + 1} supera el máximo de ${MULTI_SELECT_LIMITS.optionLabel} caracteres.`,
        });
      }
      if (FORBIDDEN_PLACEHOLDERS.has(label.toLowerCase())) {
        issues.push({
          path: `${optionPath}.label`,
          message: `La opción ${index + 1} no puede usar marcadores como "N/A" o "pendiente".`,
        });
      }
      const normalizedLabel = normalizeForComparison(label);
      if (seenLabels.has(normalizedLabel)) {
        issues.push({ path: `${optionPath}.label`, message: `La opción "${label}" está duplicada.` });
      } else {
        seenLabels.add(normalizedLabel);
      }
    }

    if (typeof rawOption.correct !== 'boolean') {
      issues.push({ path: `${optionPath}.correct`, message: 'El indicador de opción correcta debe ser booleano.' });
    } else if (rawOption.correct) {
      correctCount += 1;
    } else {
      distractorCount += 1;
    }
  });

  if (correctCount < MULTI_SELECT_LIMITS.minCorrect) {
    issues.push({
      path: 'correct',
      message: `En Selección múltiple debes marcar al menos ${MULTI_SELECT_LIMITS.minCorrect} opciones como correctas.`,
    });
  } else if (distractorCount < 1) {
    issues.push({
      path: 'correct',
      message: 'Debe existir al menos un distractor (opción incorrecta) para que la actividad sea evaluable.',
    });
  }

  return issues;
}

export function isMultiSelectDefinition(input: unknown): input is MultiSelectPrivate {
  return validateMultiSelectDefinition(input).length === 0;
}

/** Proyección pública: elimina el indicador `correct` de cada opción, la explicación y la pista, sin revelar cuántas opciones son correctas. */
export function toMultiSelectPublic(definition: MultiSelectPrivate): MultiSelectPublic {
  const result: MultiSelectPublic = {
    type: MULTI_SELECT_TYPE,
    id: definition.id,
    prompt: definition.prompt,
    options: definition.options.map((option) => ({ id: option.id, label: option.label })),
  };
  if (definition.context?.trim()) result.context = definition.context;
  return result;
}

export function createEmptyMultiSelectResponse(occurrenceId: string, activityId: string): MultiSelectResponse {
  return { occurrenceId, activityId, activityType: MULTI_SELECT_TYPE, status: 'omitted', values: [] };
}

/** Busca una opción de la actividad tanto por su `id` como por su `label`. */
export function findMultiSelectOption(
  definition: Pick<MultiSelectPrivate, 'options'>,
  value: string | null | undefined,
): MultiSelectOptionPrivate | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return (
    definition.options.find((option) => option.id === trimmed) ??
    definition.options.find((option) => option.label.trim() === trimmed)
  );
}

/** Comprueba la forma exacta de una respuesta recibida (cliente o servidor). */
export function validateMultiSelectResponse(
  input: unknown,
  definition: Pick<MultiSelectPrivate, 'id' | 'options'>,
): string | null {
  if (!isRecord(input)) return 'La respuesta debe ser un objeto.';
  const allowed = ['occurrenceId', 'activityId', 'activityType', 'status', 'values'];
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) return `Propiedad no permitida: ${extra}.`;
  if (input.activityType !== MULTI_SELECT_TYPE) return 'El tipo de respuesta no corresponde a Selección múltiple.';
  if (input.activityId !== definition.id) return 'La respuesta pertenece a otra actividad.';
  if (typeof input.occurrenceId !== 'string' || !input.occurrenceId.trim()) return 'Falta la ocurrencia.';
  if (input.status !== 'confirmed' && input.status !== 'omitted' && input.status !== 'partial_timeout') {
    return 'Estado de respuesta desconocido.';
  }
  if (!Array.isArray(input.values) || input.values.some((item) => typeof item !== 'string')) {
    return 'Los valores seleccionados deben ser una lista de textos.';
  }

  const resolvedIds = new Set<string>();
  for (const rawValue of input.values) {
    const matched = findMultiSelectOption(definition, rawValue);
    if (!matched) {
      return 'Una de las opciones seleccionadas no pertenece a esta actividad.';
    }
    if (resolvedIds.has(matched.id)) {
      return 'La respuesta contiene opciones seleccionadas duplicadas.';
    }
    resolvedIds.add(matched.id);
  }

  if (input.status === 'confirmed' && resolvedIds.size === 0) {
    return 'Una respuesta confirmada debe incluir al menos una opción seleccionada.';
  }
  if (input.status === 'omitted' && resolvedIds.size > 0) {
    return 'Una omisión no puede incluir opciones seleccionadas.';
  }
  return null;
}

/**
 * Evalúa una respuesta contra la definición privada.
 * - confirmada: acierto exacto (100 % de las opciones correctas marcadas y 0 incorrectas).
 * - omitida: 0 puntos, `correct: null`.
 * - tiempo agotado: se conservan las opciones marcadas como evidencia, pero no se puntúa.
 */
export function evaluateMultiSelect(
  definition: MultiSelectPrivate,
  response: unknown,
  maxScore: number,
): MultiSelectResult {
  const safeMax = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 0;
  const explanation = definition.explanation?.trim() ? definition.explanation : null;
  const base = { maxScore: safeMax, explanation };

  const problem = validateMultiSelectResponse(response, definition);
  if (problem) {
    return {
      ...base,
      outcome: 'rejected',
      correct: null,
      score: 0,
      recordedValues: [],
      recordedOptionIds: [],
      studentFeedback: null,
      rejectionReason: problem,
    };
  }
  const valid = response as MultiSelectResponse;

  if (valid.status === 'omitted') {
    return {
      ...base,
      outcome: 'omitted',
      correct: null,
      score: 0,
      recordedValues: [],
      recordedOptionIds: [],
      studentFeedback: null,
    };
  }

  const matchedOptions = valid.values
    .map((val) => findMultiSelectOption(definition, val))
    .filter((opt): opt is MultiSelectOptionPrivate => Boolean(opt));

  const recordedValues = matchedOptions.map((opt) => opt.label);
  const recordedOptionIds = matchedOptions.map((opt) => opt.id);

  if (valid.status === 'partial_timeout') {
    return {
      ...base,
      outcome: 'timeout',
      correct: null,
      score: 0,
      recordedValues,
      recordedOptionIds,
      studentFeedback: null,
    };
  }

  const expectedCorrectIds = new Set(definition.options.filter((opt) => opt.correct).map((opt) => opt.id));
  const selectedIds = new Set(recordedOptionIds);

  const isExactMatch =
    expectedCorrectIds.size > 0 &&
    selectedIds.size === expectedCorrectIds.size &&
    Array.from(expectedCorrectIds).every((id) => selectedIds.has(id));

  return {
    ...base,
    outcome: isExactMatch ? 'correct' : 'incorrect',
    correct: isExactMatch,
    score: isExactMatch ? safeMax : 0,
    recordedValues,
    recordedOptionIds,
    studentFeedback: definition.hint,
  };
}

const OUTCOME_LABEL: Record<MultiSelectOutcome, string> = {
  correct: 'Correcta',
  incorrect: 'Incorrecta',
  omitted: 'Omitida',
  timeout: 'Tiempo agotado sin confirmar',
  rejected: 'Respuesta rechazada',
};

/** Fila legible para docente y exportación (sin IDs técnicos). */
export function formatMultiSelectReport(definition: MultiSelectPrivate, result: MultiSelectResult) {
  const correctLabels = definition.options.filter((option) => option.correct).map((option) => option.label);
  return {
    pregunta: definition.prompt,
    clavesCorrectas: correctLabels.length ? correctLabels.join(' | ') : 'Sin claves definidas',
    respuestaEstudiante: result.recordedValues.length ? result.recordedValues.join(' | ') : 'Sin respuesta',
    resultado: OUTCOME_LABEL[result.outcome],
    puntaje: `${result.score}/${result.maxScore}`,
    pistaEntregada: result.studentFeedback ?? '',
    explicacion: result.explanation ?? '',
  };
}
