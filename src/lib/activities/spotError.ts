/**
 * Contrato aislado de la actividad: Identificación / Detección del Error (spotError) — v1.3
 *
 * Propósito pedagógico:
 * Presentar entre 3 y 6 fragmentos, pasos o enunciados de un caso, definición o procedimiento
 * donde todos son conceptualmente válidos excepto exactamente UNO que contiene un error.
 * El estudiante debe analizar críticamente cada fragmento y señalar aquel que contiene el error.
 *
 * Reglas de aislamiento:
 * - No importa React, Supabase ni el DOM.
 * - Separa estrictamente la definición privada (con `hasError`, `correction` y `explanation`)
 *   de la proyección pública para el estudiante (`SpotErrorPublic`).
 * - Al evaluar, el estudiante recibe únicamente `studentHint` (la pista orientadora),
 *   sin revelar cuál fragmento tenía el error ni la corrección privada.
 */

export const SPOT_ERROR_TYPE = 'spotError' as const;

export const SPOT_ERROR_LIMITS = {
  context: 1500,
  prompt: 600,
  segmentText: 300,
  correction: 500,
  hint: 400,
  explanation: 1000,
  minSegments: 3,
  maxSegments: 6,
} as const;

export interface SpotErrorSegmentDefinition {
  id: string;
  text: string;
  hasError: boolean;
}

export interface SpotErrorSegmentPublic {
  id: string;
  text: string;
}

export interface SpotErrorDefinition {
  type: typeof SPOT_ERROR_TYPE;
  id: string;
  context?: string;
  prompt: string;
  segments: SpotErrorSegmentDefinition[];
  correction?: string;
  hint: string;
  explanation?: string;
  sourceRef?: string;
}

export interface SpotErrorPublic {
  type: typeof SPOT_ERROR_TYPE;
  id: string;
  context?: string;
  prompt: string;
  segments: SpotErrorSegmentPublic[];
  hint: string;
}

export interface SpotErrorResponse {
  type: typeof SPOT_ERROR_TYPE;
  selectedSegmentId: string | null;
}

export interface SpotErrorValidationIssue {
  path: string;
  message: string;
}

export type SpotErrorAttemptStatus = 'omitted' | 'answered';

export interface SpotErrorEvaluation {
  type: typeof SPOT_ERROR_TYPE;
  activityId: string;
  status: SpotErrorAttemptStatus;
  selectedSegmentId: string | null;
  selectedText: string;
  expectedSegmentId: string;
  expectedText: string;
  correction: string;
  correct: boolean | null;
  score: number;
  maxScore: number;
  studentHint: string;
}

export interface SpotErrorTeacherReport {
  activityId: string;
  type: typeof SPOT_ERROR_TYPE;
  prompt: string;
  context: string;
  studentAnswer: string;
  expectedErrorSegment: string;
  correction: string;
  status: SpotErrorAttemptStatus;
  correct: boolean | null;
  score: number;
  maxScore: number;
  hintShownToStudent: string;
  privateExplanation: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function resolveSegment(
  segments: SpotErrorSegmentDefinition[],
  value: string,
): SpotErrorSegmentDefinition | undefined {
  const clean = value.trim();
  if (!clean) return undefined;
  return segments.find((seg) => seg.id === clean || seg.text.trim() === clean);
}

/**
 * Valida que una definición de Detección del Error cumpla todos los requisitos
 * contractuales y pedagógicos antes de guardarse o publicarse.
 */
export function validateSpotErrorDefinition(input: unknown): SpotErrorValidationIssue[] {
  const issues: SpotErrorValidationIssue[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [{ path: '', message: 'La definición de detección del error debe ser un objeto válido.' }];
  }

  const raw = input as Record<string, unknown>;

  if (raw.type !== SPOT_ERROR_TYPE) {
    issues.push({
      path: 'type',
      message: `El tipo de actividad debe ser "${SPOT_ERROR_TYPE}".`,
    });
  }

  if (!isNonEmptyString(raw.id)) {
    issues.push({ path: 'id', message: 'El identificador de la actividad es obligatorio.' });
  }

  if (raw.context !== undefined && raw.context !== null && raw.context !== '') {
    if (typeof raw.context !== 'string' || !raw.context.trim()) {
      issues.push({ path: 'context', message: 'Si se incluye contexto, debe ser texto con contenido.' });
    } else if (raw.context.trim().length > SPOT_ERROR_LIMITS.context) {
      issues.push({
        path: 'context',
        message: `El contexto no puede superar ${SPOT_ERROR_LIMITS.context} caracteres.`,
      });
    }
  }

  if (!isNonEmptyString(raw.prompt)) {
    issues.push({ path: 'prompt', message: 'La consigna de la actividad es obligatoria.' });
  } else if (raw.prompt.trim().length > SPOT_ERROR_LIMITS.prompt) {
    issues.push({
      path: 'prompt',
      message: `La consigna no puede superar ${SPOT_ERROR_LIMITS.prompt} caracteres.`,
    });
  }

  if (!Array.isArray(raw.segments)) {
    issues.push({ path: 'segments', message: 'Los fragmentos deben ser una lista.' });
  } else {
    if (raw.segments.length < SPOT_ERROR_LIMITS.minSegments) {
      issues.push({
        path: 'segments',
        message: `Define al menos ${SPOT_ERROR_LIMITS.minSegments} fragmentos para analizar.`,
      });
    }
    if (raw.segments.length > SPOT_ERROR_LIMITS.maxSegments) {
      issues.push({
        path: 'segments',
        message: `No se permiten más de ${SPOT_ERROR_LIMITS.maxSegments} fragmentos por actividad.`,
      });
    }

    const seenIds = new Set<string>();
    const seenTexts = new Set<string>();
    let errorCount = 0;

    raw.segments.forEach((item, index) => {
      const segPath = `segments[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push({ path: segPath, message: `El fragmento ${index + 1} debe ser un objeto válido.` });
        return;
      }

      const seg = item as Record<string, unknown>;

      if (!isNonEmptyString(seg.id)) {
        issues.push({
          path: `${segPath}.id`,
          message: `El identificador del fragmento ${index + 1} es obligatorio.`,
        });
      } else {
        const cleanId = seg.id.trim();
        if (seenIds.has(cleanId)) {
          issues.push({
            path: `${segPath}.id`,
            message: `El identificador "${cleanId}" está repetido en los fragmentos.`,
          });
        }
        seenIds.add(cleanId);
      }

      if (!isNonEmptyString(seg.text)) {
        issues.push({
          path: `${segPath}.text`,
          message: `El texto del fragmento ${index + 1} no puede estar vacío.`,
        });
      } else {
        const cleanText = seg.text.trim();
        if (cleanText.length > SPOT_ERROR_LIMITS.segmentText) {
          issues.push({
            path: `${segPath}.text`,
            message: `El fragmento ${index + 1} no puede superar ${SPOT_ERROR_LIMITS.segmentText} caracteres.`,
          });
        }
        const normalized = normalizeText(cleanText);
        if (seenTexts.has(normalized)) {
          issues.push({
            path: `${segPath}.text`,
            message: `El fragmento ${index + 1} está duplicado. Todos los fragmentos deben ser distintos.`,
          });
        }
        seenTexts.add(normalized);
      }

      if (typeof seg.hasError !== 'boolean') {
        issues.push({
          path: `${segPath}.hasError`,
          message: `El fragmento ${index + 1} debe indicar explícitamente si contiene el error (true o false).`,
        });
      } else if (seg.hasError) {
        errorCount += 1;
      }
    });

    if (raw.segments.length >= SPOT_ERROR_LIMITS.minSegments && errorCount !== 1) {
      issues.push({
        path: 'hasError',
        message:
          errorCount === 0
            ? 'Debes marcar exactamente un fragmento que contenga el error.'
            : `Hay ${errorCount} fragmentos marcados con error; solo puede haber uno.`,
      });
    }
  }

  if (raw.correction !== undefined && raw.correction !== null && raw.correction !== '') {
    if (typeof raw.correction !== 'string' || !raw.correction.trim()) {
      issues.push({
        path: 'correction',
        message: 'Si se incluye la corrección del error, debe ser texto con contenido.',
      });
    } else if (raw.correction.trim().length > SPOT_ERROR_LIMITS.correction) {
      issues.push({
        path: 'correction',
        message: `La corrección no puede superar ${SPOT_ERROR_LIMITS.correction} caracteres.`,
      });
    }
  }

  if (!isNonEmptyString(raw.hint)) {
    issues.push({
      path: 'hint',
      message: 'La pista orientadora para el estudiante es obligatoria.',
    });
  } else if (raw.hint.trim().length > SPOT_ERROR_LIMITS.hint) {
    issues.push({
      path: 'hint',
      message: `La pista orientadora no puede superar ${SPOT_ERROR_LIMITS.hint} caracteres.`,
    });
  }

  if (raw.explanation !== undefined && raw.explanation !== null && raw.explanation !== '') {
    if (typeof raw.explanation !== 'string' || !raw.explanation.trim()) {
      issues.push({
        path: 'explanation',
        message: 'Si se incluye explicación privada, debe ser texto con contenido.',
      });
    } else if (raw.explanation.trim().length > SPOT_ERROR_LIMITS.explanation) {
      issues.push({
        path: 'explanation',
        message: `La explicación privada no puede superar ${SPOT_ERROR_LIMITS.explanation} caracteres.`,
      });
    }
  }

  return issues;
}

/**
 * Genera la versión pública segura para enviar al estudiante.
 * Elimina `hasError`, `correction`, `explanation` y `sourceRef`.
 */
export function toSpotErrorPublic(definition: SpotErrorDefinition): SpotErrorPublic {
  const base: SpotErrorPublic = {
    type: SPOT_ERROR_TYPE,
    id: (definition.id ?? '').trim(),
    prompt: (definition.prompt ?? '').trim(),
    segments: (definition.segments ?? []).map((seg) => ({
      id: (seg.id ?? '').trim(),
      text: (seg.text ?? '').trim(),
    })),
    hint: (definition.hint ?? '').trim(),
  };

  if (definition.context && definition.context.trim()) {
    base.context = definition.context.trim();
  }

  return base;
}

/**
 * Valida que la respuesta enviada por el estudiante corresponda al contrato `spotError`
 * y que el fragmento elegido pertenezca a la definición.
 */
export function validateSpotErrorResponse(
  definition: SpotErrorDefinition,
  response: unknown,
): SpotErrorValidationIssue[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return [{ path: '', message: 'La respuesta debe ser un objeto válido.' }];
  }

  const raw = response as Record<string, unknown>;
  if (raw.type !== SPOT_ERROR_TYPE) {
    return [
      {
        path: 'type',
        message: `Se esperaba una respuesta de tipo "${SPOT_ERROR_TYPE}", pero se recibió "${String(raw.type ?? '')}".`,
      },
    ];
  }

  if (raw.selectedSegmentId === null || raw.selectedSegmentId === undefined || raw.selectedSegmentId === '') {
    return [];
  }

  if (typeof raw.selectedSegmentId !== 'string') {
    return [
      {
        path: 'selectedSegmentId',
        message: 'El identificador del fragmento seleccionado debe ser texto o null.',
      },
    ];
  }

  const found = resolveSegment(definition.segments, raw.selectedSegmentId);
  if (!found) {
    return [
      {
        path: 'selectedSegmentId',
        message: `El fragmento "${raw.selectedSegmentId}" no pertenece a esta actividad.`,
      },
    ];
  }

  return [];
}

/**
 * Evalúa la respuesta de un estudiante contra la definición privada de Detección del Error.
 */
export function evaluateSpotError(
  definition: SpotErrorDefinition,
  response: SpotErrorResponse | null | undefined,
  maxScore: number,
): SpotErrorEvaluation {
  const safeMaxScore = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 0;
  const studentHint = definition.hint.trim();
  const errorSegment = definition.segments.find((seg) => seg.hasError) ?? definition.segments[0];
  const expectedSegmentId = errorSegment?.id.trim() ?? '';
  const expectedText = errorSegment?.text.trim() ?? '';
  const correction = definition.correction?.trim() ?? '';

  if (
    !response ||
    response.type !== SPOT_ERROR_TYPE ||
    response.selectedSegmentId === null ||
    response.selectedSegmentId === undefined ||
    response.selectedSegmentId.trim() === ''
  ) {
    return {
      type: SPOT_ERROR_TYPE,
      activityId: definition.id,
      status: 'omitted',
      selectedSegmentId: null,
      selectedText: '',
      expectedSegmentId,
      expectedText,
      correction,
      correct: null,
      score: 0,
      maxScore: safeMaxScore,
      studentHint,
    };
  }

  const matched = resolveSegment(definition.segments, response.selectedSegmentId);
  if (!matched) {
    return {
      type: SPOT_ERROR_TYPE,
      activityId: definition.id,
      status: 'answered',
      selectedSegmentId: response.selectedSegmentId,
      selectedText: response.selectedSegmentId,
      expectedSegmentId,
      expectedText,
      correction,
      correct: false,
      score: 0,
      maxScore: safeMaxScore,
      studentHint,
    };
  }

  const isCorrect = matched.hasError === true;

  return {
    type: SPOT_ERROR_TYPE,
    activityId: definition.id,
    status: 'answered',
    selectedSegmentId: matched.id.trim(),
    selectedText: matched.text.trim(),
    expectedSegmentId,
    expectedText,
    correction,
    correct: isCorrect,
    score: isCorrect ? safeMaxScore : 0,
    maxScore: safeMaxScore,
    studentHint,
  };
}

/**
 * Construye el registro privado para el docente y la exportación CSV.
 */
export function formatSpotErrorReport(
  definition: SpotErrorDefinition,
  evaluation: SpotErrorEvaluation,
): SpotErrorTeacherReport {
  return {
    activityId: definition.id,
    type: SPOT_ERROR_TYPE,
    prompt: definition.prompt.trim(),
    context: definition.context?.trim() ?? '',
    studentAnswer: evaluation.status === 'omitted' ? 'Omitida' : evaluation.selectedText,
    expectedErrorSegment: evaluation.expectedText,
    correction: definition.correction?.trim() ?? '',
    status: evaluation.status,
    correct: evaluation.correct,
    score: evaluation.score,
    maxScore: evaluation.maxScore,
    hintShownToStudent: evaluation.studentHint,
    privateExplanation: definition.explanation?.trim() ?? '',
  };
}
