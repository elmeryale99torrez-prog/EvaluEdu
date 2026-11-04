/**
 * Contrato modular de la actividad "Completar Espacios Guiado" (fillBlanks) — EduEval v1.3.
 *
 * Propósito:
 * - Un archivo independiente por actividad para escalar sin mezclar reglas.
 * - El docente define un texto con marcadores `{{1}}`, `{{2}}`, ..., la lista de respuestas correctas (`blanks`)
 *   y un conjunto de palabras distractoras (`distractors`) para formar un banco cerrado de fichas táctiles.
 * - La vista pública (`FillBlanksPublic`) entrega únicamente el texto con marcadores, los identificadores de los espacios
 *   y el banco de palabras barajado (`bank`), sin revelar cuáles son correctas ni cuáles son distractores.
 * - Tras confirmar todos los espacios, el estudiante recibe únicamente `hint` (pista orientadora neutral).
 * - La calificación es por coincidencia exacta: 100% de los espacios completados con su ficha correcta otorga el puntaje completo.
 */

export const FILL_BLANKS_TYPE = 'fillBlanks' as const;

export const FILL_BLANKS_LIMITS = {
  context: 1500,
  prompt: 600,
  textWithBlanks: 1600,
  wordLabel: 120,
  hint: 400,
  explanation: 1000,
  minBlanks: 1,
  maxBlanks: 6,
  minDistractors: 1,
  maxDistractors: 6,
} as const;

export type FillBlankItem = {
  id: string;
  answer: string;
};

/** Definición completa que manejan el editor docente, el backend y los reportes privados. */
export type FillBlanksPrivate = {
  type: typeof FILL_BLANKS_TYPE;
  id: string;
  prompt: string;
  /** Párrafo o enunciado que contiene los marcadores `{{1}}`, `{{2}}`, etc. */
  textWithBlanks: string;
  /** Lista ordenada de espacios; `blanks[0]` corresponde a `{{1}}`, `blanks[1]` a `{{2}}`, etc. */
  blanks: FillBlankItem[];
  /** Palabras o términos distractores que se suman al banco de fichas. */
  distractors: string[];
  /** Pista orientadora obligatoria que ve el estudiante tras confirmar. */
  hint: string;
  /** Contexto o marco conceptual opcional. */
  context?: string;
  /** Justificación privada opcional para el docente y el CSV. */
  explanation?: string;
};

/** Vista pública enviada al estudiante: texto con marcadores y banco de fichas barajado sin distinguir correctas de distractores. */
export type FillBlanksPublic = {
  type: typeof FILL_BLANKS_TYPE;
  id: string;
  prompt: string;
  textWithBlanks: string;
  blankIds: string[];
  bank: string[];
  context?: string;
};

export type FillBlanksResponseStatus = 'confirmed' | 'omitted' | 'partial_timeout';

/** Respuesta del estudiante para una ocurrencia específica dentro de la sala. */
export type FillBlanksResponse = {
  occurrenceId: string;
  activityId: string;
  activityType: typeof FILL_BLANKS_TYPE;
  status: FillBlanksResponseStatus;
  /** Mapa `{ [blankId]: selectedWord }` o `{ "1": selectedWord }`. */
  answers: Record<string, string>;
};

export type FillBlanksOutcome = 'correct' | 'incorrect' | 'omitted' | 'timeout' | 'rejected';

export type FillBlanksResult = {
  outcome: FillBlanksOutcome;
  correct: boolean | null;
  score: number;
  maxScore: number;
  correctBlanksCount: number;
  totalBlanks: number;
  recordedAnswers: Record<string, string>;
  studentFeedback: string | null;
  explanation: string | null;
  rejectionReason?: string;
};

export type FillBlanksIssue = {
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
  issues: FillBlanksIssue[],
  source: Record<string, unknown>,
  field: 'prompt' | 'textWithBlanks' | 'hint' | 'context' | 'explanation',
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
  const limit = FILL_BLANKS_LIMITS[field];
  if (trimmed.length > limit) {
    issues.push({ path: field, message: `Supera el máximo de ${limit} caracteres.` });
  }
}

/** Extrae en orden todos los números de marcadores `{{n}}` presentes en el texto. */
export function extractBlankMarkers(textWithBlanks: string): number[] {
  const matches = textWithBlanks.matchAll(/\{\{(\d+)\}\}/g);
  const numbers: number[] = [];
  for (const match of matches) {
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isNaN(parsed)) numbers.push(parsed);
  }
  return numbers;
}

/** Divide un texto con marcadores `{{1}}`, `{{2}}` en segmentos de texto y ranuras numeradas. */
export type TextBlankSegment =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; index: number; blankNumber: number };

export function parseTextWithBlanks(textWithBlanks: string): TextBlankSegment[] {
  const segments: TextBlankSegment[] = [];
  const regex = /\{\{(\d+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(textWithBlanks);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: textWithBlanks.slice(lastIndex, match.index) });
    }
    const blankNumber = Number.parseInt(match[1], 10);
    segments.push({ kind: 'blank', index: blankNumber - 1, blankNumber });
    lastIndex = match.index + match[0].length;
    match = regex.exec(textWithBlanks);
  }
  if (lastIndex < textWithBlanks.length) {
    segments.push({ kind: 'text', text: textWithBlanks.slice(lastIndex) });
  }
  return segments;
}

/**
 * Construye y desordena determinísticamente el banco de palabras combinando
 * las respuestas correctas y los distractores para que nunca aparezcan en el orden de solución.
 */
export function scrambleWordBank(correctAnswers: string[], distractors: string[]): string[] {
  const cleanCorrect = correctAnswers.map((w) => w.trim()).filter(Boolean);
  const cleanDistractors = distractors.map((w) => w.trim()).filter(Boolean);
  const combined: string[] = [];
  const maxLen = Math.max(cleanCorrect.length, cleanDistractors.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i < cleanDistractors.length) combined.push(cleanDistractors[i]);
    if (i < cleanCorrect.length) combined.push(cleanCorrect[cleanCorrect.length - 1 - i]);
  }
  // Evitar duplicados exactos si llegaran de datos antiguos
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const word of combined) {
    const norm = normalizeForComparison(word);
    if (!seen.has(norm)) {
      seen.add(norm);
      unique.push(word);
    }
  }
  return unique;
}

/** Valida que una definición de Completar Espacios esté lista para publicarse. */
export function validateFillBlanksDefinition(input: unknown): FillBlanksIssue[] {
  if (!isRecord(input)) return [{ path: '', message: 'La actividad debe ser un objeto.' }];
  const issues: FillBlanksIssue[] = [];

  const allowed = ['type', 'id', 'prompt', 'textWithBlanks', 'blanks', 'distractors', 'hint', 'context', 'explanation'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      issues.push({ path: key, message: 'Propiedad no permitida en Completar Espacios.' });
    }
  }

  if (input.type !== FILL_BLANKS_TYPE) {
    issues.push({ path: 'type', message: 'El tipo debe ser "fillBlanks".' });
  }
  if (typeof input.id !== 'string' || !input.id.trim()) {
    issues.push({ path: 'id', message: 'El identificador es obligatorio.' });
  }

  checkTextField(issues, input, 'prompt', true);
  checkTextField(issues, input, 'textWithBlanks', true);
  checkTextField(issues, input, 'hint', true);
  checkTextField(issues, input, 'context', false);
  checkTextField(issues, input, 'explanation', false);

  if (!Array.isArray(input.blanks)) {
    issues.push({ path: 'blanks', message: 'Los espacios deben ser una lista.' });
    return issues;
  }

  if (input.blanks.length < FILL_BLANKS_LIMITS.minBlanks || input.blanks.length > FILL_BLANKS_LIMITS.maxBlanks) {
    issues.push({
      path: 'blanks',
      message: `La actividad debe tener entre ${FILL_BLANKS_LIMITS.minBlanks} y ${FILL_BLANKS_LIMITS.maxBlanks} espacios para completar.`,
    });
  }

  const seenBlankIds = new Set<string>();
  const seenBankWords = new Set<string>();

  input.blanks.forEach((rawBlank, index) => {
    const blankPath = `blanks[${index}]`;
    if (!isRecord(rawBlank)) {
      issues.push({ path: blankPath, message: 'Cada espacio debe ser un objeto.' });
      return;
    }

    const blankAllowed = ['id', 'answer'];
    for (const key of Object.keys(rawBlank)) {
      if (!blankAllowed.includes(key)) {
        issues.push({ path: `${blankPath}.${key}`, message: 'Propiedad no permitida en un espacio.' });
      }
    }

    const id = typeof rawBlank.id === 'string' ? rawBlank.id.trim() : '';
    if (!id) {
      issues.push({ path: `${blankPath}.id`, message: 'Cada espacio necesita un identificador.' });
    } else if (seenBlankIds.has(id)) {
      issues.push({ path: `${blankPath}.id`, message: 'El identificador del espacio está repetido.' });
    } else {
      seenBlankIds.add(id);
    }

    const answer = typeof rawBlank.answer === 'string' ? rawBlank.answer.trim() : '';
    if (!answer) {
      issues.push({ path: `${blankPath}.answer`, message: `Completa la respuesta correcta del espacio {{${index + 1}}}.` });
    } else {
      if (answer.length > FILL_BLANKS_LIMITS.wordLabel) {
        issues.push({
          path: `${blankPath}.answer`,
          message: `La respuesta del espacio {{${index + 1}}} supera el máximo de ${FILL_BLANKS_LIMITS.wordLabel} caracteres.`,
        });
      }
      if (FORBIDDEN_PLACEHOLDERS.has(answer.toLowerCase())) {
        issues.push({
          path: `${blankPath}.answer`,
          message: `El espacio {{${index + 1}}} no puede usar marcadores como "N/A" o "pendiente".`,
        });
      }
      const norm = normalizeForComparison(answer);
      if (seenBankWords.has(norm)) {
        issues.push({
          path: `${blankPath}.answer`,
          message: `La palabra "${answer}" está duplicada. Cada espacio debe tener una ficha única en el banco.`,
        });
      } else {
        seenBankWords.add(norm);
      }
    }
  });

  if (typeof input.textWithBlanks === 'string' && input.textWithBlanks.trim() && input.blanks.length > 0) {
    const blanksCount = input.blanks.length;
    const markers = extractBlankMarkers(input.textWithBlanks);
    if (markers.length === 0) {
      issues.push({
        path: 'textWithBlanks',
        message: 'El texto debe incluir al menos el marcador {{1}} donde irá el espacio en blanco.',
      });
    } else {
      for (let i = 1; i <= blanksCount; i += 1) {
        const count = markers.filter((m) => m === i).length;
        if (count === 0) {
          issues.push({
            path: 'textWithBlanks',
            message: `Falta el marcador {{${i}}} dentro del texto con espacios.`,
          });
        } else if (count > 1) {
          issues.push({
            path: 'textWithBlanks',
            message: `El marcador {{${i}}} aparece repetido en el texto. Usa un número distinto para cada espacio.`,
          });
        }
      }
      const outOfRange = markers.find((m) => m < 1 || m > blanksCount);
      if (outOfRange !== undefined) {
        issues.push({
          path: 'textWithBlanks',
          message: `El texto contiene el marcador {{${outOfRange}}}, pero solo se definieron ${blanksCount} espacios.`,
        });
      }
    }
  }

  if (!Array.isArray(input.distractors)) {
    issues.push({ path: 'distractors', message: 'Los distractores deben ser una lista.' });
    return issues;
  }

  if (
    input.distractors.length < FILL_BLANKS_LIMITS.minDistractors ||
    input.distractors.length > FILL_BLANKS_LIMITS.maxDistractors
  ) {
    issues.push({
      path: 'distractors',
      message: `Define entre ${FILL_BLANKS_LIMITS.minDistractors} y ${FILL_BLANKS_LIMITS.maxDistractors} fichas distractoras para el banco de palabras.`,
    });
  }

  input.distractors.forEach((rawDistractor, index) => {
    const dPath = `distractors[${index}]`;
    const word = typeof rawDistractor === 'string' ? rawDistractor.trim() : '';
    if (!word) {
      issues.push({ path: dPath, message: `Completa el texto del distractor ${index + 1}.` });
      return;
    }
    if (word.length > FILL_BLANKS_LIMITS.wordLabel) {
      issues.push({
        path: dPath,
        message: `El distractor ${index + 1} supera el máximo de ${FILL_BLANKS_LIMITS.wordLabel} caracteres.`,
      });
    }
    if (FORBIDDEN_PLACEHOLDERS.has(word.toLowerCase())) {
      issues.push({
        path: dPath,
        message: `El distractor ${index + 1} no puede usar marcadores como "N/A" o "pendiente".`,
      });
    }
    const norm = normalizeForComparison(word);
    if (seenBankWords.has(norm)) {
      issues.push({
        path: dPath,
        message: `El distractor "${word}" repite una palabra ya presente en el banco.`,
      });
    } else {
      seenBankWords.add(norm);
    }
  });

  return issues;
}

export function isFillBlanksDefinition(input: unknown): input is FillBlanksPrivate {
  return validateFillBlanksDefinition(input).length === 0;
}

/** Proyección pública: entrega el texto con marcadores y el banco barajado, ocultando qué palabras son correctas. */
export function toFillBlanksPublic(definition: FillBlanksPrivate): FillBlanksPublic {
  const result: FillBlanksPublic = {
    type: FILL_BLANKS_TYPE,
    id: definition.id,
    prompt: definition.prompt,
    textWithBlanks: definition.textWithBlanks,
    blankIds: definition.blanks.map((b) => b.id),
    bank: scrambleWordBank(
      definition.blanks.map((b) => b.answer),
      definition.distractors,
    ),
  };
  if (definition.context) result.context = definition.context;
  return result;
}

function resolveStudentBlankAnswer(
  definition: FillBlanksPrivate,
  answers: Record<string, unknown>,
  blank: FillBlankItem,
  index: number,
): string {
  const byId = answers[blank.id];
  if (typeof byId === 'string' && byId.trim()) return byId.trim();
  const byNumber = answers[String(index + 1)];
  if (typeof byNumber === 'string' && byNumber.trim()) return byNumber.trim();
  return '';
}

/** Valida la respuesta del estudiante contra la definición privada de la actividad. */
export function validateFillBlanksResponse(
  definition: FillBlanksPrivate,
  response: unknown,
): { ok: true; value: FillBlanksResponse } | { ok: false; reason: string } {
  if (!isRecord(response)) {
    return { ok: false, reason: 'La respuesta debe ser un objeto.' };
  }
  if (response.activityType !== FILL_BLANKS_TYPE) {
    return { ok: false, reason: 'El tipo de respuesta no coincide con "fillBlanks".' };
  }
  if (typeof response.occurrenceId !== 'string' || !response.occurrenceId.trim()) {
    return { ok: false, reason: 'occurrenceId es obligatorio para distinguir actividades en la sala.' };
  }
  if (response.activityId !== definition.id) {
    return { ok: false, reason: 'activityId no coincide con la actividad evaluada.' };
  }
  if (
    response.status !== 'confirmed' &&
    response.status !== 'omitted' &&
    response.status !== 'partial_timeout'
  ) {
    return { ok: false, reason: 'El estado de la respuesta no es válido.' };
  }
  if (!isRecord(response.answers)) {
    return { ok: false, reason: 'Las asignaciones de espacios deben ser un objeto.' };
  }

  const validBankSet = new Set<string>([
    ...definition.blanks.map((b) => b.answer.trim()),
    ...definition.distractors.map((d) => d.trim()),
  ]);

  const normalizedAnswers: Record<string, string> = {};
  const usedWords = new Set<string>();

  for (let index = 0; index < definition.blanks.length; index += 1) {
    const blank = definition.blanks[index];
    const word = resolveStudentBlankAnswer(definition, response.answers, blank, index);
    if (!word) continue;
    if (!validBankSet.has(word)) {
      return { ok: false, reason: `La ficha "${word}" no pertenece al banco de palabras de la actividad.` };
    }
    if (usedWords.has(word)) {
      return { ok: false, reason: `La ficha "${word}" fue asignada a más de un espacio.` };
    }
    usedWords.add(word);
    normalizedAnswers[blank.id] = word;
  }

  if (response.status === 'confirmed' && Object.keys(normalizedAnswers).length !== definition.blanks.length) {
    return { ok: false, reason: 'Una respuesta confirmada debe completar todos los espacios en blanco.' };
  }

  if (response.status === 'omitted' && Object.keys(normalizedAnswers).length > 0) {
    return { ok: false, reason: 'Una respuesta omitida no debe contener fichas asignadas.' };
  }

  return {
    ok: true,
    value: {
      occurrenceId: response.occurrenceId.trim(),
      activityId: definition.id,
      activityType: FILL_BLANKS_TYPE,
      status: response.status,
      answers: normalizedAnswers,
    },
  };
}

/**
 * Evalúa la respuesta de Completar Espacios aplicando coincidencia exacta:
 * - Si todos los espacios coinciden con la ficha correcta -> `score = maxScore`.
 * - Si falta algún espacio o se eligió un distractor/ficha cruzada -> `score = 0`.
 */
export function evaluateFillBlanks(
  definition: FillBlanksPrivate,
  response: unknown,
  maxScore: number,
): FillBlanksResult {
  const safeMax = Number.isFinite(maxScore) && maxScore >= 0 ? maxScore : 0;
  const totalBlanks = definition.blanks.length;
  const check = validateFillBlanksResponse(definition, response);

  if (!check.ok) {
    return {
      outcome: 'rejected',
      correct: null,
      score: 0,
      maxScore: safeMax,
      correctBlanksCount: 0,
      totalBlanks,
      recordedAnswers: {},
      studentFeedback: null,
      explanation: definition.explanation ?? null,
      rejectionReason: check.reason,
    };
  }

  const { status, answers } = check.value;

  let correctBlanksCount = 0;
  for (const blank of definition.blanks) {
    if (answers[blank.id] === blank.answer.trim()) {
      correctBlanksCount += 1;
    }
  }

  if (status === 'omitted') {
    return {
      outcome: 'omitted',
      correct: null,
      score: 0,
      maxScore: safeMax,
      correctBlanksCount: 0,
      totalBlanks,
      recordedAnswers: {},
      studentFeedback: null,
      explanation: definition.explanation ?? null,
    };
  }

  if (status === 'partial_timeout') {
    return {
      outcome: 'timeout',
      correct: null,
      score: 0,
      maxScore: safeMax,
      correctBlanksCount,
      totalBlanks,
      recordedAnswers: answers,
      studentFeedback: null,
      explanation: definition.explanation ?? null,
    };
  }

  const isAllCorrect = totalBlanks > 0 && correctBlanksCount === totalBlanks;
  return {
    outcome: isAllCorrect ? 'correct' : 'incorrect',
    correct: isAllCorrect,
    score: isAllCorrect ? safeMax : 0,
    maxScore: safeMax,
    correctBlanksCount,
    totalBlanks,
    recordedAnswers: answers,
    studentFeedback: definition.hint,
    explanation: definition.explanation ?? null,
  };
}

/** Formatea los campos para el reporte privado docente y la exportación CSV/Excel. */
export function formatFillBlanksReport(definition: FillBlanksPrivate, result: FillBlanksResult) {
  const expectedSummary = definition.blanks
    .map((b, idx) => `[${idx + 1}] ${b.answer.trim()}`)
    .join(' | ');
  const recordedSummary = definition.blanks
    .map((b, idx) => {
      const chosen = result.recordedAnswers[b.id];
      return chosen ? `[${idx + 1}] ${chosen}` : null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join(' | ');

  return {
    activityId: definition.id,
    activityType: FILL_BLANKS_TYPE,
    prompt: definition.prompt,
    textWithBlanks: definition.textWithBlanks,
    expectedAnswer: expectedSummary,
    studentAnswer: recordedSummary,
    outcome: result.outcome,
    correct: result.correct,
    correctBlanksCount: result.correctBlanksCount,
    totalBlanks: result.totalBlanks,
    score: result.score,
    maxScore: result.maxScore,
    hintShownToStudent: result.studentFeedback ?? '',
    privateExplanation: result.explanation ?? '',
  };
}
