/**
 * Contrato aislado de la actividad: Marcar Palabras Clave en el Texto (markWords) — v1.3
 *
 * Propósito pedagógico:
 * Presentar un párrafo de lectura continuo donde ciertos términos o sintagmas diana
 * se configuran como elementos interactivos resaltables táctilmente. El estudiante debe
 * leer comprensivamente y resaltar con su dedo o cursor todos los términos que cumplan
 * un criterio determinado (por ejemplo: fuentes renovables, órganos, causas, conceptos clave),
 * sin marcar los términos distractores.
 *
 * Sintaxis amigable en texto:
 * Las palabras o frases interactivas se delimitan entre corchetes `[término]`.
 * Si el término termina con asterisco `[término*]`, se define como correcto (`correct: true`).
 * Si no lleva asterisco `[término]`, se define como distractor (`correct: false`).
 *
 * Reglas de aislamiento:
 * - No importa React, Supabase ni el DOM.
 * - Separa estrictamente la definición privada (con `correct` y `explanation`)
 *   de la proyección pública para el estudiante (`MarkWordsPublic`).
 * - Al evaluar, el estudiante recibe únicamente `studentHint` (la pista orientadora),
 *   sin revelar cuáles términos debían ser marcados.
 */

export const MARK_WORDS_TYPE = 'markWords' as const;

export const MARK_WORDS_LIMITS = {
  context: 1500,
  prompt: 600,
  text: 2500,
  wordLabel: 100,
  hint: 400,
  explanation: 1000,
  minWords: 3,
  maxWords: 10,
  minCorrect: 1,
  minDistractors: 1,
} as const;

export interface MarkWordsTokenDefinition {
  id: string;
  text: string;
  correct: boolean;
}

export interface MarkWordsTokenPublic {
  id: string;
  text: string;
}

export type MarkWordsSegment =
  | { kind: 'text'; text: string }
  | { kind: 'word'; id: string; text: string; index: number };

export interface MarkWordsDefinition {
  type: typeof MARK_WORDS_TYPE;
  id: string;
  context?: string;
  prompt: string;
  text: string;
  words: MarkWordsTokenDefinition[];
  hint: string;
  explanation?: string;
  sourceRef?: string;
}

export interface MarkWordsPublic {
  type: typeof MARK_WORDS_TYPE;
  id: string;
  context?: string;
  prompt: string;
  text: string;
  words: MarkWordsTokenPublic[];
  hint: string;
}

export interface MarkWordsResponse {
  type: typeof MARK_WORDS_TYPE;
  values: string[];
}

export interface MarkWordsValidationIssue {
  path: string;
  message: string;
}

export type MarkWordsAttemptStatus = 'omitted' | 'answered';

export interface MarkWordsEvaluation {
  type: typeof MARK_WORDS_TYPE;
  activityId: string;
  status: MarkWordsAttemptStatus;
  selectedWords: string[];
  expectedWords: string[];
  correct: boolean | null;
  score: number;
  maxScore: number;
  studentHint: string;
}

export interface MarkWordsTeacherReport {
  activityId: string;
  type: typeof MARK_WORDS_TYPE;
  prompt: string;
  context: string;
  studentAnswer: string;
  expectedWords: string;
  status: MarkWordsAttemptStatus;
  correct: boolean | null;
  score: number;
  maxScore: number;
  hintShownToStudent: string;
  privateExplanation: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Parsea un texto con corchetes `[palabra*]` o `[palabra]` extrayendo
 * tanto los segmentos de texto/palabra como la lista de fichas interactivas.
 */
export function parseMarkWordsText(rawText: string): {
  segments: MarkWordsSegment[];
  tokens: MarkWordsTokenDefinition[];
} {
  const segments: MarkWordsSegment[] = [];
  const tokens: MarkWordsTokenDefinition[] = [];

  if (!rawText) return { segments, tokens };

  const regex = /\[([^[\]]+?)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenCounter = 1;

  while ((match = regex.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: 'text',
        text: rawText.slice(lastIndex, match.index),
      });
    }

    const rawContent = match[1].trim();
    const isCorrect = rawContent.endsWith('*');
    const cleanWord = isCorrect ? rawContent.slice(0, -1).trim() : rawContent;
    const tokenId = `mw-${tokenCounter}`;

    const tokenDef: MarkWordsTokenDefinition = {
      id: tokenId,
      text: cleanWord,
      correct: isCorrect,
    };

    tokens.push(tokenDef);
    segments.push({
      kind: 'word',
      id: tokenId,
      text: cleanWord,
      index: tokenCounter - 1,
    });

    tokenCounter += 1;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < rawText.length) {
    segments.push({
      kind: 'text',
      text: rawText.slice(lastIndex),
    });
  }

  return { segments, tokens };
}

/**
 * Valida la definición de la actividad Marcar Palabras en el Texto.
 */
export function validateMarkWordsDefinition(input: unknown): MarkWordsValidationIssue[] {
  const issues: MarkWordsValidationIssue[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [{ path: '', message: 'La definición de marcar palabras debe ser un objeto válido.' }];
  }

  const raw = input as Record<string, unknown>;

  if (raw.type !== MARK_WORDS_TYPE) {
    issues.push({
      path: 'type',
      message: `El tipo de actividad debe ser "${MARK_WORDS_TYPE}".`,
    });
  }

  if (!isNonEmptyString(raw.id)) {
    issues.push({ path: 'id', message: 'El identificador de la actividad es obligatorio.' });
  }

  if (raw.context !== undefined && raw.context !== null && raw.context !== '') {
    if (typeof raw.context !== 'string' || !raw.context.trim()) {
      issues.push({ path: 'context', message: 'Si se incluye contexto, debe ser texto con contenido.' });
    } else if (raw.context.trim().length > MARK_WORDS_LIMITS.context) {
      issues.push({
        path: 'context',
        message: `El contexto no puede superar ${MARK_WORDS_LIMITS.context} caracteres.`,
      });
    }
  }

  if (!isNonEmptyString(raw.prompt)) {
    issues.push({ path: 'prompt', message: 'La consigna de la actividad es obligatoria.' });
  } else if (raw.prompt.trim().length > MARK_WORDS_LIMITS.prompt) {
    issues.push({
      path: 'prompt',
      message: `La consigna no puede superar ${MARK_WORDS_LIMITS.prompt} caracteres.`,
    });
  }

  if (!isNonEmptyString(raw.text)) {
    issues.push({ path: 'text', message: 'El párrafo de lectura interactivo es obligatorio.' });
  } else if (raw.text.trim().length > MARK_WORDS_LIMITS.text) {
    issues.push({
      path: 'text',
      message: `El texto no puede superar ${MARK_WORDS_LIMITS.text} caracteres.`,
    });
  }

  if (!Array.isArray(raw.words)) {
    issues.push({ path: 'words', message: 'Las palabras interactivas deben ser una lista.' });
  } else {
    if (raw.words.length < MARK_WORDS_LIMITS.minWords) {
      issues.push({
        path: 'words',
        message: `El texto debe contener al menos ${MARK_WORDS_LIMITS.minWords} términos interactivos entre corchetes [palabra].`,
      });
    }
    if (raw.words.length > MARK_WORDS_LIMITS.maxWords) {
      issues.push({
        path: 'words',
        message: `No se permiten más de ${MARK_WORDS_LIMITS.maxWords} términos interactivos por párrafo.`,
      });
    }

    const seenIds = new Set<string>();
    const seenTexts = new Set<string>();
    let correctCount = 0;
    let distractorCount = 0;

    raw.words.forEach((item, index) => {
      const itemPath = `words[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push({ path: itemPath, message: `El término ${index + 1} debe ser un objeto válido.` });
        return;
      }

      const word = item as Record<string, unknown>;

      if (!isNonEmptyString(word.id)) {
        issues.push({ path: `${itemPath}.id`, message: `El ID del término ${index + 1} es obligatorio.` });
      } else {
        const cleanId = word.id.trim();
        if (seenIds.has(cleanId)) {
          issues.push({ path: `${itemPath}.id`, message: `El ID "${cleanId}" está repetido.` });
        }
        seenIds.add(cleanId);
      }

      if (!isNonEmptyString(word.text)) {
        issues.push({ path: `${itemPath}.text`, message: `El texto del término ${index + 1} no puede estar vacío.` });
      } else {
        const cleanText = word.text.trim();
        if (cleanText.length > MARK_WORDS_LIMITS.wordLabel) {
          issues.push({
            path: `${itemPath}.text`,
            message: `El término "${cleanText}" supera el límite de ${MARK_WORDS_LIMITS.wordLabel} caracteres.`,
          });
        }
        const norm = normalizeWord(cleanText);
        if (seenTexts.has(norm)) {
          issues.push({
            path: `${itemPath}.text`,
            message: `El término "${cleanText}" aparece duplicado entre las palabras interactivas.`,
          });
        }
        seenTexts.add(norm);
      }

      if (typeof word.correct !== 'boolean') {
        issues.push({
          path: `${itemPath}.correct`,
          message: `El término ${index + 1} debe indicar si es correcto (true) o distractor (false).`,
        });
      } else if (word.correct) {
        correctCount += 1;
      } else {
        distractorCount += 1;
      }
    });

    if (raw.words.length >= MARK_WORDS_LIMITS.minWords) {
      if (correctCount < MARK_WORDS_LIMITS.minCorrect) {
        issues.push({
          path: 'words',
          message: `Marca al menos ${MARK_WORDS_LIMITS.minCorrect} término como correcto con asterisco [palabra*].`,
        });
      }
      if (distractorCount < MARK_WORDS_LIMITS.minDistractors) {
        issues.push({
          path: 'words',
          message: `Deja al menos ${MARK_WORDS_LIMITS.minDistractors} término distractor sin asterisco [palabra].`,
        });
      }
    }
  }

  if (!isNonEmptyString(raw.hint)) {
    issues.push({ path: 'hint', message: 'La pista orientadora para el estudiante es obligatoria.' });
  } else if (raw.hint.trim().length > MARK_WORDS_LIMITS.hint) {
    issues.push({
      path: 'hint',
      message: `La pista orientadora no puede superar ${MARK_WORDS_LIMITS.hint} caracteres.`,
    });
  }

  if (raw.explanation !== undefined && raw.explanation !== null && raw.explanation !== '') {
    if (typeof raw.explanation !== 'string' || !raw.explanation.trim()) {
      issues.push({ path: 'explanation', message: 'Si se incluye explicación privada, debe tener texto.' });
    } else if (raw.explanation.trim().length > MARK_WORDS_LIMITS.explanation) {
      issues.push({
        path: 'explanation',
        message: `La explicación no puede superar ${MARK_WORDS_LIMITS.explanation} caracteres.`,
      });
    }
  }

  return issues;
}

/**
 * Genera la versión pública segura para el estudiante.
 * Oculta cuáles palabras son correctas (`correct`), la explicación y sourceRef.
 */
export function toMarkWordsPublic(definition: MarkWordsDefinition): MarkWordsPublic {
  const base: MarkWordsPublic = {
    type: MARK_WORDS_TYPE,
    id: (definition.id ?? '').trim(),
    prompt: (definition.prompt ?? '').trim(),
    text: (definition.text ?? '').trim(),
    words: (definition.words ?? []).map((w) => ({
      id: (w.id ?? '').trim(),
      text: (w.text ?? '').trim(),
    })),
    hint: (definition.hint ?? '').trim(),
  };

  if (definition.context && definition.context.trim()) {
    base.context = definition.context.trim();
  }

  return base;
}

/**
 * Valida la respuesta enviada por el estudiante.
 */
export function validateMarkWordsResponse(
  definition: MarkWordsDefinition,
  response: unknown,
): MarkWordsValidationIssue[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return [{ path: '', message: 'La respuesta debe ser un objeto válido.' }];
  }

  const raw = response as Record<string, unknown>;
  if (raw.type !== MARK_WORDS_TYPE) {
    return [
      {
        path: 'type',
        message: `Se esperaba una respuesta de tipo "${MARK_WORDS_TYPE}", pero se recibió "${String(raw.type ?? '')}".`,
      },
    ];
  }

  if (!Array.isArray(raw.values)) {
    return [{ path: 'values', message: 'Las palabras seleccionadas deben enviarse en una lista.' }];
  }

  const knownIds = new Set(definition.words.map((w) => w.id));
  const knownTexts = new Set(definition.words.map((w) => normalizeWord(w.text)));

  for (const item of raw.values) {
    if (typeof item !== 'string') {
      return [{ path: 'values', message: 'Cada elemento seleccionado debe ser texto.' }];
    }
    const clean = item.trim();
    if (!knownIds.has(clean) && !knownTexts.has(normalizeWord(clean))) {
      return [{ path: 'values', message: `El término "${item}" no es un elemento interactivo de esta actividad.` }];
    }
  }

  return [];
}

/**
 * Evalúa la respuesta del estudiante con criterio de coincidencia exacta:
 * - Debe haber marcado el 100% de los términos con correct === true.
 * - No debe haber marcado ningún término distractor (correct === false).
 * - Si no marcó nada, se clasifica como 'omitted'.
 */
export function evaluateMarkWords(
  definition: MarkWordsDefinition,
  response: MarkWordsResponse | null | undefined,
  maxScore: number,
): MarkWordsEvaluation {
  const safeMaxScore = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 0;
  const studentHint = definition.hint.trim();
  const correctTokens = definition.words.filter((w) => w.correct);
  const expectedWords = correctTokens.map((w) => w.text.trim());
  const expectedSet = new Set(correctTokens.map((w) => w.id));

  if (!response || response.type !== MARK_WORDS_TYPE || !Array.isArray(response.values)) {
    return {
      type: MARK_WORDS_TYPE,
      activityId: definition.id,
      status: 'omitted',
      selectedWords: [],
      expectedWords,
      correct: null,
      score: 0,
      maxScore: safeMaxScore,
      studentHint,
    };
  }

  const cleanValues = response.values.map((v) => v.trim()).filter(Boolean);
  if (cleanValues.length === 0) {
    return {
      type: MARK_WORDS_TYPE,
      activityId: definition.id,
      status: 'omitted',
      selectedWords: [],
      expectedWords,
      correct: null,
      score: 0,
      maxScore: safeMaxScore,
      studentHint,
    };
  }

  // Resolver selección del estudiante a IDs de token
  const selectedTokens = cleanValues
    .map((val) => definition.words.find((w) => w.id === val || normalizeWord(w.text) === normalizeWord(val)))
    .filter(Boolean) as MarkWordsTokenDefinition[];

  const selectedWords = selectedTokens.map((t) => t.text.trim());
  const selectedIds = new Set(selectedTokens.map((t) => t.id));

  const hasAllCorrect = expectedSet.size > 0 && Array.from(expectedSet).every((id) => selectedIds.has(id));
  const hasNoDistractors = selectedTokens.every((t) => t.correct === true);
  const isExact = hasAllCorrect && hasNoDistractors && selectedIds.size === expectedSet.size;

  return {
    type: MARK_WORDS_TYPE,
    activityId: definition.id,
    status: 'answered',
    selectedWords,
    expectedWords,
    correct: isExact,
    score: isExact ? safeMaxScore : 0,
    maxScore: safeMaxScore,
    studentHint,
  };
}

/**
 * Genera el reporte para el docente y exportación CSV.
 */
export function formatMarkWordsReport(
  definition: MarkWordsDefinition,
  evaluation: MarkWordsEvaluation,
): MarkWordsTeacherReport {
  return {
    activityId: definition.id,
    type: MARK_WORDS_TYPE,
    prompt: definition.prompt.trim(),
    context: definition.context?.trim() ?? '',
    studentAnswer: evaluation.status === 'omitted' ? 'Omitida' : evaluation.selectedWords.join(' | '),
    expectedWords: evaluation.expectedWords.join(' | '),
    status: evaluation.status,
    correct: evaluation.correct,
    score: evaluation.score,
    maxScore: evaluation.maxScore,
    hintShownToStudent: evaluation.studentHint,
    privateExplanation: definition.explanation?.trim() ?? '',
  };
}
