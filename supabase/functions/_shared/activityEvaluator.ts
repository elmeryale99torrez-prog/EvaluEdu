/**
 * activityEvaluator.ts
 * Módulo puro compartido de evaluación, validación, proyección pública y autoridad de sala
 * para Supabase Edge Functions (student-room-guest y student-room-sync) de EvaluEdu v1.3.
 * 
 * Implementación oficial de Fase C (LAB-C-001) para los 13 formatos de actividad.
 */

export type AnyRecord = Record<string, any>;
export type RandomGenerator = () => number;

export function record(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {};
}

export function isPlainRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalOmittedResponse(type: string): AnyRecord {
  switch (type) {
    case 'scenario':
      return { type: 'scenario', choices: {} };
    case 'multiSelect':
      return { type: 'multiSelect', values: [] };
    case 'fillBlanks':
      return { type: 'fillBlanks', answers: {} };
    case 'markWords':
      return { type: 'markWords', values: [] };
    case 'gridCheck':
      return { type: 'gridCheck', values: [] };
    case 'vennDiagram':
      return { type: 'vennDiagram', assignments: {} };
    case 'matching':
      return { type: 'matching', pairs: {} };
    case 'sorting':
      return { type: 'sorting', assignments: {} };
    case 'ordering':
      return { type: 'ordering', order: [] };
    default:
      return { type, value: '' };
  }
}

export function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Barajado Fisher-Yates puro con generador de números pseudoaleatorios inyectable.
 * Garantiza permutaciones sin sesgo ni dependencia fija de Math.random().
 */
export function shuffleArray<T>(items: readonly T[], rng: RandomGenerator = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const r = rng();
    const j = Math.floor((r >= 1 ? 0.999999999 : (r < 0 ? 0 : r)) * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Generador de números pseudoaleatorios determinista basado en semilla de texto.
 * Produce secuencias idénticas para la misma semilla (ej. sesión de participante).
 */
export function createSeededRng(seedStr: string): RandomGenerator {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function (): number {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Generador criptográfico independiente de identificadores públicos del participante.
 * Nunca deriva la permutación desde IDs visibles para el cliente.
 */
export function cryptoRandomRng(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}

export interface SessionRoomConfig {
  score_per_question: number;
  time_minutes?: number | null;
  shuffle_questions?: boolean;
  allow_back?: boolean;
}

export interface SessionSnapshot {
  version: number;
  roomConfig: SessionRoomConfig;
  occurrenceLinks: RoomOccurrenceLink[];
  activities: AnyRecord[];
  privateActivities: AnyRecord[];
}

export function hasValidSnapshot(snapshot: unknown): snapshot is SessionSnapshot {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const s = snapshot as AnyRecord;
  return (
    Array.isArray(s.activities) &&
    Array.isArray(s.occurrenceLinks) &&
    Array.isArray(s.privateActivities) &&
    Boolean(s.roomConfig && typeof s.roomConfig === 'object' && typeof s.roomConfig.score_per_question === 'number')
  );
}

export function buildEffectiveRoom(room: AnyRecord, roomConfig?: AnyRecord | null): AnyRecord {
  if (!roomConfig || typeof roomConfig !== 'object') return room;
  return {
    ...room,
    score_per_question:
      typeof roomConfig.score_per_question === 'number' ? roomConfig.score_per_question : room.score_per_question,
    time_minutes: roomConfig.time_minutes !== undefined ? roomConfig.time_minutes : room.time_minutes,
    shuffle_questions:
      roomConfig.shuffle_questions !== undefined ? roomConfig.shuffle_questions : room.shuffle_questions,
    allow_back: roomConfig.allow_back !== undefined ? roomConfig.allow_back : room.allow_back,
  };
}

/**
 * Normalización canónica para shortAnswer.
 * Respeta banderas configurables de mayúsculas y acentos.
 */
export function normalizeShortAnswer(text: string, caseSensitive = false, ignoreAccents = true): string {
  let res = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!caseSensitive) {
    res = res.toLowerCase();
  }
  if (ignoreAccents) {
    res = res.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return res;
}

/**
 * Reconstruye el runtime enriquecido de una actividad a partir de su definición y detalles.
 */
export function runtime(activity: AnyRecord): AnyRecord {
  const details = record(activity.details);
  const options = arrayOfStrings(activity.options);
  const answer = activity.answer;

  const scenarioOptions = options.map((text, index) => ({
    id: `fallback-option-${index}`,
    text,
    consequence: activity.feedback,
    feedback: activity.feedback,
    recommended: text === answer,
  }));

  const matchingPairs = options.map((option, index) => {
    const [left, right] = option.split('→').map((part) => part.trim());
    return { id: `fallback-pair-${index}`, left: left || option, right: right || option };
  });

  const sortingAnswer = Array.isArray(answer) ? answer : [];
  const sortingItems = options.map((label, index) => ({
    id: `fallback-item-${index}`,
    label,
    category: sortingAnswer[index] ?? 'Sin categoría',
  }));

  const orderingSteps = Array.isArray(answer) ? answer : options;
  const choiceOptions = options.map((label, index) => ({
    id: `fallback-choice-${index}`,
    label,
    correct: label === answer,
  }));

  const multiSelectAnswer = new Set(Array.isArray(answer) ? answer : []);
  const multiSelectOptions = options.map((label, index) => ({
    id: `fallback-ms-${index}`,
    label,
    correct: multiSelectAnswer.has(label),
  }));

  const fillBlanksAnswer = Array.isArray(answer) ? answer : [String(answer ?? '')];
  const fallbackBlanks = fillBlanksAnswer.filter(Boolean).map((ans, index) => ({
    id: String(index + 1),
    answer: String(ans),
  }));

  const spotErrorSegments = options.map((text, index) => ({
    id: `fallback-se-${index + 1}`,
    text,
    hasError: text === answer,
  }));

  const markWordsAnswer = new Set(Array.isArray(answer) ? answer : [String(answer ?? '')]);
  const markWordsTokens = options.map((text, index) => ({
    id: `fallback-mw-${index + 1}`,
    text,
    correct: markWordsAnswer.has(text),
  }));

  const gridCheckRows = details.gridCheck?.rows ?? [
    { id: 'r1', label: options[0] ?? 'Elemento 1' },
    { id: 'r2', label: options[1] ?? 'Elemento 2' },
  ];
  const gridCheckColumns = details.gridCheck?.columns ?? [
    { id: 'c1', label: 'Criterio A' },
    { id: 'c2', label: 'Criterio B' },
  ];
  const gridCheckExpected = details.gridCheck?.expectedCells ?? (Array.isArray(answer) ? answer : [String(answer ?? '')]).filter(Boolean);

  const shortAnswerConfig = details.shortAnswer ?? {
    acceptedAnswers: Array.isArray(answer) ? answer : [String(answer ?? '')].filter(Boolean),
    caseSensitive: false,
    ignoreAccents: true,
  };

  return {
    scenario: details.scenario ?? {
      situation: activity.prompt,
      stages: [{ id: 'fallback-stage', title: 'Decisión', prompt: activity.prompt, options: scenarioOptions }],
    },
    trueFalse: details.trueFalse ?? {
      statement: activity.prompt,
      correct: answer === 'Verdadero',
      explanation: activity.feedback,
    },
    matching: details.matching ?? { pairs: matchingPairs },
    sorting: details.sorting ?? { categories: Array.from(new Set(sortingAnswer)), items: sortingItems },
    ordering: details.ordering ?? { steps: orderingSteps },
    singleChoice: details.singleChoice ?? { options: choiceOptions },
    multiSelect: details.multiSelect ?? { options: multiSelectOptions },
    fillBlanks: details.fillBlanks ?? { textWithBlanks: activity.prompt, blanks: fallbackBlanks, distractors: options },
    spotError: details.spotError ?? { segments: spotErrorSegments },
    markWords: details.markWords ?? { text: activity.prompt, words: markWordsTokens },
    gridCheck: details.gridCheck ?? { rows: gridCheckRows, columns: gridCheckColumns, expectedCells: gridCheckExpected },
    vennDiagram: details.vennDiagram ?? {
      setA: 'Conjunto A',
      setB: 'Conjunto B',
      intersectionLabel: 'Ambos',
      items: options.map((label: string, index: number) => ({
        id: `fallback-venn-${index + 1}`,
        label,
        zone: index % 3 === 0 ? 'left' : index % 3 === 1 ? 'both' : 'right',
      })),
    },
    shortAnswer: shortAnswerConfig,
  };
}

/**
 * Determina si la respuesta remitida por el estudiante para una actividad está omitida.
 */
export function isOmitted(activity: AnyRecord, response: AnyRecord | undefined | null): boolean {
  if (!response) return true;
  if (response.type !== activity.type) return true;

  if (response.type === 'shortAnswer') {
    return response.value === undefined || response.value === null || String(response.value).trim() === '';
  }

  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError') {
    return !response.value || !String(response.value).trim();
  }

  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') {
    const values = arrayOfStrings(response.values);
    return values.length === 0 || values.every((val) => !val.trim());
  }

  if (response.type === 'fillBlanks') {
    const answers = record(response.answers);
    return Object.keys(answers).length === 0 || Object.values(answers).every((val) => !String(val ?? '').trim());
  }

  if (response.type === 'matching') {
    const pairs = record(response.pairs);
    return Object.keys(pairs).length === 0 || Object.values(pairs).every((val) => !val);
  }

  if (response.type === 'sorting') {
    const assignments = record(response.assignments);
    return Object.keys(assignments).length === 0 || Object.values(assignments).every((val) => !val);
  }

  if (response.type === 'ordering') {
    const order = Array.isArray(response.order) ? response.order : [];
    return order.length === 0;
  }

  if (response.type === 'scenario') {
    const choices = record(response.choices);
    return Object.keys(choices).length === 0 || Object.values(choices).every((val) => !val);
  }

  if (response.type === 'vennDiagram') {
    const assignments = record(response.assignments);
    return Object.keys(assignments).length === 0 || Object.values(assignments).every((val) => !val);
  }

  return false;
}

/**
 * Valida que la estructura del payload remitido sea rigurosamente conforme con la definición de la actividad.
 * Rechaza payloads manipulados, opciones inexistentes, categorías desconocidas o valores fuera de rango.
 */
export function validateResponseStructure(activity: AnyRecord, response: AnyRecord): { valid: boolean; error?: string } {
  if (!isPlainRecord(response)) {
    return { valid: false, error: 'Estructura de respuesta inválida.' };
  }
  if (response.type !== activity.type) {
    return { valid: false, error: `Tipo de respuesta '${response.type}' incompatible con la actividad '${activity.type}'.` };
  }

  const current = runtime(activity);

  if (response.type === 'trueFalse') {
    if (typeof response.value !== 'string') {
      return { valid: false, error: 'Formato inválido para respuesta de falso/verdadero.' };
    }
    const val = response.value.trim();
    if (val !== '' && val !== 'Verdadero' && val !== 'Falso') {
      return { valid: false, error: `Valor no permitido para falso/verdadero: ${val}` };
    }
    return { valid: true };
  }

  if (response.type === 'singleChoice') {
    if (typeof response.value !== 'string') {
      return { valid: false, error: 'Formato inválido para respuesta de selección única.' };
    }
    const val = response.value.trim();
    if (val === '') return { valid: true };
    const validIds = new Set((current.singleChoice.options ?? []).map((opt: AnyRecord) => opt.id));
    if (!validIds.has(val)) {
      return { valid: false, error: `Opción no válida para selección única: ${val}` };
    }
    return { valid: true };
  }

  if (response.type === 'multiSelect') {
    if (!Array.isArray(response.values) || response.values.some((v) => typeof v !== 'string')) {
      return { valid: false, error: 'Formato inválido para opciones de selección múltiple.' };
    }
    const values = response.values as string[];
    const validIds = new Set((current.multiSelect.options ?? []).map((opt: AnyRecord) => opt.id));
    if (new Set(values).size !== values.length) {
      return { valid: false, error: 'Opciones duplicadas en selección múltiple.' };
    }
    for (const v of values) {
      if (v && !validIds.has(v)) {
        return { valid: false, error: `Opción ajena en selección múltiple: ${v}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'shortAnswer') {
    if (typeof response.value !== 'string') {
      return { valid: false, error: 'Formato inválido para respuesta corta.' };
    }
    if (response.value.length > 150) {
      return { valid: false, error: 'La respuesta corta excede la longitud máxima permitida (150 caracteres).' };
    }
    return { valid: true };
  }

  if (response.type === 'matching') {
    if (!isPlainRecord(response.pairs)) {
      return { valid: false, error: 'Formato inválido para pares de asociación.' };
    }
    const pairs = response.pairs;
    const validLeft = new Set((current.matching.pairs ?? []).map((p: AnyRecord) => p.left));
    const validRight = new Set((current.matching.pairs ?? []).map((p: AnyRecord) => p.right));
    for (const [left, right] of Object.entries(pairs)) {
      if (typeof right !== 'string') {
        return { valid: false, error: `Valor de asociación inválido para ${left}.` };
      }
      if (!validLeft.has(left)) {
        return { valid: false, error: `Elemento de asociación ajeno: ${left}` };
      }
      if (right && !validRight.has(right)) {
        return { valid: false, error: `Valor de asociación ajeno: ${right}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'sorting') {
    if (!isPlainRecord(response.assignments)) {
      return { valid: false, error: 'Formato inválido para asignaciones de clasificación.' };
    }
    const assignments = response.assignments;
    const validItemIds = new Set((current.sorting.items ?? []).map((i: AnyRecord) => i.id));
    const validCategories = new Set(
      (current.sorting.categories ?? []).map((c: AnyRecord | string) =>
        typeof c === 'object' && c !== null ? (c.id ?? c.label ?? '') : String(c)
      )
    );
    for (const [item, cat] of Object.entries(assignments)) {
      if (typeof cat !== 'string') {
        return { valid: false, error: `Categoría de clasificación inválida para ${item}.` };
      }
      if (!validItemIds.has(item)) {
        return { valid: false, error: `Ítem de clasificación ajeno: ${item}` };
      }
      if (cat && !validCategories.has(cat)) {
        return { valid: false, error: `Categoría de clasificación desconocida: ${cat}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'ordering') {
    if (!Array.isArray(response.order) || response.order.some((s) => typeof s !== 'string')) {
      return { valid: false, error: 'Formato inválido para secuencia de ordenamiento.' };
    }
    const order = response.order as string[];
    const validSteps = new Set(current.ordering.steps ?? []);
    if (new Set(order).size !== order.length) {
      return { valid: false, error: 'Pasos duplicados en el ordenamiento.' };
    }
    for (const step of order) {
      if (!validSteps.has(step)) {
        return { valid: false, error: `Paso desconocido en ordenamiento: ${step}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'scenario') {
    if (!isPlainRecord(response.choices)) {
      return { valid: false, error: 'Formato inválido para decisiones de escenario.' };
    }
    const choices = response.choices;
    const stagesMap = new Map<string, Set<string>>(
      (current.scenario.stages ?? []).map((s: AnyRecord) => [s.id, new Set((s.options ?? []).map((o: AnyRecord) => o.id))])
    );
    for (const [stageId, optId] of Object.entries(choices)) {
      if (typeof optId !== 'string') {
        return { valid: false, error: `Opción de escenario inválida para ${stageId}.` };
      }
      const allowedOpts = stagesMap.get(stageId);
      if (!allowedOpts) {
        return { valid: false, error: `Etapa de escenario no válida: ${stageId}` };
      }
      if (optId && !allowedOpts.has(optId)) {
        return { valid: false, error: `Opción de escenario ajena: ${optId}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'fillBlanks') {
    if (!isPlainRecord(response.answers)) {
      return { valid: false, error: 'Formato inválido para respuestas de completar espacios.' };
    }
    const answers = response.answers;
    const validBlankIds = new Set((current.fillBlanks.blanks ?? []).map((b: AnyRecord) => b.id));
    const bankWords = [
      ...(current.fillBlanks.blanks ?? []).map((b: AnyRecord) => String(b.answer ?? '').trim().toLowerCase()),
      ...arrayOfStrings(current.fillBlanks.distractors).map((d) => d.trim().toLowerCase()),
    ].filter(Boolean);
    const allowedCounts = new Map<string, number>();
    for (const w of bankWords) {
      allowedCounts.set(w, (allowedCounts.get(w) ?? 0) + 1);
    }
    const usedCounts = new Map<string, number>();
    for (const [blankId, word] of Object.entries(answers)) {
      if (typeof word !== 'string') {
        return { valid: false, error: `Ficha inválida para el espacio ${blankId}.` };
      }
      if (!validBlankIds.has(blankId)) {
        return { valid: false, error: `Espacio de relleno desconocido: ${blankId}` };
      }
      const normWord = word.trim().toLowerCase();
      if (!normWord) continue;
      if (allowedCounts.size > 0) {
        const maxAvailable = allowedCounts.get(normWord) ?? 0;
        if (maxAvailable === 0) {
          return { valid: false, error: `Ficha ajena no permitida en completar espacios: ${word}` };
        }
        const nextUsed = (usedCounts.get(normWord) ?? 0) + 1;
        if (nextUsed > maxAvailable) {
          return { valid: false, error: `La ficha "${word}" excede la cantidad autorizada en el banco.` };
        }
        usedCounts.set(normWord, nextUsed);
      }
    }
    return { valid: true };
  }

  if (response.type === 'spotError') {
    if (typeof response.value !== 'string') {
      return { valid: false, error: 'Formato inválido para detección del error.' };
    }
    const val = response.value.trim();
    if (val === '') return { valid: true };
    const validSegments = new Set((current.spotError.segments ?? []).map((s: AnyRecord) => s.id));
    if (!validSegments.has(val)) {
      return { valid: false, error: `Segmento de error desconocido: ${val}` };
    }
    return { valid: true };
  }

  if (response.type === 'markWords') {
    if (!Array.isArray(response.values) || response.values.some((v) => typeof v !== 'string')) {
      return { valid: false, error: 'Formato inválido para palabras marcadas.' };
    }
    const values = response.values as string[];
    const validWordIds = new Set((current.markWords.words ?? []).map((w: AnyRecord) => w.id));
    if (new Set(values).size !== values.length) {
      return { valid: false, error: 'Palabras marcadas duplicadas.' };
    }
    for (const v of values) {
      if (v && !validWordIds.has(v)) {
        return { valid: false, error: `Palabra ajena marcada: ${v}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'gridCheck') {
    if (!Array.isArray(response.values) || response.values.some((v) => typeof v !== 'string')) {
      return { valid: false, error: 'Formato inválido para celdas de matriz.' };
    }
    const values = response.values as string[];
    const validRows = new Set((current.gridCheck.rows ?? []).map((r: AnyRecord) => r.id));
    const validCols = new Set((current.gridCheck.columns ?? []).map((c: AnyRecord) => c.id));
    if (new Set(values).size !== values.length) {
      return { valid: false, error: 'Celdas duplicadas en la matriz.' };
    }
    for (const cell of values) {
      const [r, c] = cell.split(':');
      if (!r || !c || !validRows.has(r) || !validCols.has(c)) {
        return { valid: false, error: `Celda de matriz no válida: ${cell}` };
      }
    }
    return { valid: true };
  }

  if (response.type === 'vennDiagram') {
    if (!isPlainRecord(response.assignments)) {
      return { valid: false, error: 'Formato inválido para asignaciones de diagrama de Venn.' };
    }
    const assignments = response.assignments;
    const validItems = new Set((current.vennDiagram.items ?? []).map((i: AnyRecord) => i.id));
    const validZones = new Set(['left', 'right', 'both']);
    for (const [itemId, zone] of Object.entries(assignments)) {
      if (typeof zone !== 'string') {
        return { valid: false, error: `Zona inválida para elemento ${itemId}.` };
      }
      if (!validItems.has(itemId)) {
        return { valid: false, error: `Elemento de diagrama de Venn ajeno: ${itemId}` };
      }
      if (zone && !validZones.has(zone)) {
        return { valid: false, error: `Zona no válida en diagrama de Venn: ${zone}` };
      }
    }
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Evalúa si la respuesta remitida por el estudiante es semánticamente correcta.
 */
export function compare(activity: AnyRecord, response: AnyRecord): boolean {
  if (response.type !== activity.type) return false;
  const current = runtime(activity);

  if (response.type === 'shortAnswer') {
    const sa = current.shortAnswer;
    const caseSensitive = Boolean(sa.caseSensitive);
    const ignoreAccents = sa.ignoreAccents !== false;
    const studentText = normalizeShortAnswer(response.value, caseSensitive, ignoreAccents);
    if (!studentText) return false;

    const accepted: string[] = Array.isArray(sa.acceptedAnswers)
      ? sa.acceptedAnswers.map((a: unknown) => String(a ?? ''))
      : [String(activity.answer ?? '')];

    return accepted.some((ans) => {
      const target = normalizeShortAnswer(ans, caseSensitive, ignoreAccents);
      return target.length > 0 && studentText === target;
    });
  }

  if (response.type === 'scenario') {
    const stages = current.scenario.stages ?? [];
    const choices = record(response.choices);
    if (stages.length === 0) return false;
    return stages.every((stage: AnyRecord) => {
      const choiceId = choices[stage.id];
      const opts = stage.options ?? [];
      const selected =
        opts.find((opt: AnyRecord) => opt.id === choiceId) ??
        opts.find((opt: AnyRecord) => opt.text === choiceId);
      return selected?.recommended === true || selected?.isRecommended === true;
    });
  }

  if (response.type === 'trueFalse') {
    const expected = current.trueFalse.correct ? 'Verdadero' : 'Falso';
    return String(response.value).trim() === expected;
  }

  if (response.type === 'singleChoice') {
    const options = current.singleChoice.options ?? [];
    const option =
      options.find((opt: AnyRecord) => opt.id === response.value) ??
      options.find((opt: AnyRecord) => opt.label === response.value);
    return option?.correct === true;
  }

  if (response.type === 'spotError') {
    const segments = current.spotError.segments ?? [];
    const seg =
      segments.find((s: AnyRecord) => s.id === response.value) ??
      segments.find((s: AnyRecord) => s.text === response.value);
    return seg?.hasError === true;
  }

  if (response.type === 'markWords') {
    const words = current.markWords.words ?? [];
    const values = arrayOfStrings(response.values).map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) return false;
    const selectedTokens = values
      .map(
        (val) =>
          words.find((w: AnyRecord) => w.id === val) ??
          words.find((w: AnyRecord) => String(w.text ?? '').toLowerCase() === val.toLowerCase())
      )
      .filter(Boolean) as AnyRecord[];
    if (selectedTokens.length !== values.length) return false;
    const selectedIds = new Set(selectedTokens.map((t: AnyRecord) => t.id));
    const expectedTokens = words.filter((w: AnyRecord) => w.correct === true);
    if (expectedTokens.length === 0) return false;
    const expectedIds = new Set(expectedTokens.map((t: AnyRecord) => t.id));
    const hasAllExpected = [...expectedIds].every((id) => selectedIds.has(id));
    const hasNoDistractors = selectedTokens.every((t) => t.correct === true);
    return hasAllExpected && hasNoDistractors && selectedIds.size === expectedIds.size;
  }

  if (response.type === 'gridCheck') {
    const expected = new Set(arrayOfStrings(current.gridCheck.expectedCells).map((c) => c.trim().toLowerCase()));
    const values = arrayOfStrings(response.values).map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (expected.size === 0 || values.length === 0) return false;
    const selected = new Set(values);
    if (selected.size !== expected.size) return false;
    return [...expected].every((cell) => selected.has(cell));
  }

  if (response.type === 'multiSelect') {
    const options = current.multiSelect.options ?? [];
    const values = arrayOfStrings(response.values);
    const selectedOptions = values
      .map(
        (val) =>
          options.find((opt: AnyRecord) => opt.id === val) ??
          options.find((opt: AnyRecord) => opt.label === val)
      )
      .filter(Boolean) as AnyRecord[];
    if (selectedOptions.length !== values.length) return false;
    const selectedIds = new Set(selectedOptions.map((opt) => opt.id));
    if (selectedIds.size !== values.length) return false;
    const correctIds = new Set(options.filter((opt: AnyRecord) => opt.correct === true).map((opt: AnyRecord) => opt.id));
    return correctIds.size > 0 && selectedIds.size === correctIds.size && [...correctIds].every((id) => selectedIds.has(id));
  }

  if (response.type === 'fillBlanks') {
    const blanks = current.fillBlanks.blanks ?? [];
    const answers = record(response.answers);
    if (blanks.length === 0) return false;
    // Evaluación estricta ranura por ranura: permite multiplicidad de fichas con la misma palabra
    return blanks.every((b: AnyRecord) => {
      const studentVal = String(answers[b.id] ?? '').trim().toLowerCase();
      const expectedVal = String(b.answer ?? '').trim().toLowerCase();
      return studentVal.length > 0 && studentVal === expectedVal;
    });
  }

  if (response.type === 'matching') {
    const pairs = current.matching.pairs ?? [];
    const userPairs = record(response.pairs);
    if (pairs.length === 0) return false;
    return pairs.every((pair: AnyRecord) => userPairs[pair.left] === pair.right);
  }

  if (response.type === 'sorting') {
    const items = current.sorting.items ?? [];
    const assignments = record(response.assignments);
    if (items.length === 0) return false;
    return items.every((item: AnyRecord) => assignments[item.id] === item.category);
  }

  if (response.type === 'ordering') {
    const steps = current.ordering.steps ?? [];
    const order = Array.isArray(response.order) ? response.order : [];
    if (steps.length === 0 || order.length !== steps.length) return false;
    return order.every((step: string, index: number) => step === steps[index]);
  }

  if (response.type === 'vennDiagram') {
    const items = current.vennDiagram.items ?? [];
    const assignments = record(response.assignments);
    if (items.length === 0) return false;
    return items.every((item: AnyRecord) => assignments[item.id] === item.zone);
  }

  return false;
}

/**
 * Serializa de forma canónica la respuesta del alumno para registro de auditoría.
 */
export function serializeResponse(response: AnyRecord): string {
  if (!response || typeof response !== 'object') return '';
  if (response.type === 'scenario') {
    return Object.entries(record(response.choices)).map(([stage, choice]) => `${stage}: ${choice}`).join(' | ');
  }
  if (response.type === 'trueFalse' || response.type === 'singleChoice' || response.type === 'spotError' || response.type === 'shortAnswer') {
    return String(response.value ?? '').trim();
  }
  if (response.type === 'multiSelect' || response.type === 'markWords' || response.type === 'gridCheck') {
    return arrayOfStrings(response.values).join(' | ');
  }
  if (response.type === 'fillBlanks') {
    return Object.entries(record(response.answers)).map(([id, val]) => `[${id}: ${val}]`).join(' | ');
  }
  if (response.type === 'matching') {
    return Object.entries(record(response.pairs)).map(([left, right]) => `${left} → ${right}`).join(' | ');
  }
  if (response.type === 'sorting') {
    return Object.entries(record(response.assignments)).map(([item, category]) => `${item} → ${category}`).join(' | ');
  }
  if (response.type === 'ordering') {
    return Array.isArray(response.order) ? response.order.join(' → ') : '';
  }
  if (response.type === 'vennDiagram') {
    return Object.entries(record(response.assignments)).map(([item, zone]) => `${item} → ${zone}`).join(' | ');
  }
  return '';
}

/**
 * Genera la proyección pública antitrampas para el estudiante.
 * Retira soluciones, claves privadas, explicaciones docentes y asteriscos de solución.
 * Aplica barajado Fisher-Yates seguro e independiente con generador inyectable.
 */
export function publicActivity(activity: AnyRecord, options?: { shuffle?: boolean; rng?: RandomGenerator }): AnyRecord {
  const current = runtime(activity);
  const rng = options?.rng ?? cryptoRandomRng;
  const type = String(activity.type ?? '');

  let typeDetails: AnyRecord;
  let safeOptions: string[] = [];

  switch (type) {
    case 'trueFalse': {
      typeDetails = {
        statement: String(current.trueFalse.statement ?? activity.prompt ?? ''),
      };
      safeOptions = ['Verdadero', 'Falso'];
      break;
    }

    case 'singleChoice': {
      const opts = (current.singleChoice.options ?? []).map((opt: AnyRecord) => ({
        id: String(opt.id),
        label: String(opt.label ?? opt.text ?? ''),
      }));
      typeDetails = { options: opts };
      safeOptions = opts.map((o: AnyRecord) => o.label);
      break;
    }

    case 'multiSelect': {
      const opts = (current.multiSelect.options ?? []).map((opt: AnyRecord) => ({
        id: String(opt.id),
        label: String(opt.label ?? opt.text ?? ''),
      }));
      typeDetails = { options: opts };
      safeOptions = opts.map((o: AnyRecord) => o.label);
      break;
    }

    case 'matching': {
      const explicitPairs = activity.details?.matching?.pairs;
      const rawMatchingPairs: AnyRecord[] = Array.isArray(explicitPairs)
        ? explicitPairs
        : Array.isArray(current.matching?.pairs) && activity.details?.matching
          ? current.matching.pairs
          : [];
      const rightOptions: string[] = rawMatchingPairs.map((p: AnyRecord) => String(p.right ?? '')).filter(Boolean);
      const shuffledRights: string[] = shuffleArray(rightOptions, rng);
      const pairs = rawMatchingPairs.map((pair: AnyRecord, index: number) => ({
        id: String(pair.id ?? `pair-${index}`),
        left: String(pair.left ?? ''),
        right: shuffledRights[index] ?? String(pair.right ?? ''),
      }));
      typeDetails = { pairs };
      safeOptions = shuffledRights;
      break;
    }

    case 'sorting': {
      const explicitItems = activity.details?.sorting?.items;
      const rawItems: AnyRecord[] = Array.isArray(explicitItems)
        ? explicitItems
        : Array.isArray(current.sorting?.items) && activity.details?.sorting
          ? current.sorting.items
          : [];
      const items = rawItems.map((item: AnyRecord, index: number) => ({
        id: String(item.id ?? `item-${index}`),
        label: String(item.label ?? ''),
      }));
      typeDetails = {
        categories: arrayOfStrings(activity.details?.sorting?.categories ?? (activity.details?.sorting ? current.sorting?.categories : [])),
        items,
      };
      safeOptions = items.map((it: AnyRecord) => it.label);
      break;
    }

    case 'ordering': {
      const rawSteps = arrayOfStrings(current.ordering.steps);
      const safeOrderingSteps = shuffleArray(rawSteps, rng);
      typeDetails = { steps: safeOrderingSteps };
      safeOptions = safeOrderingSteps;
      break;
    }

    case 'scenario': {
      typeDetails = {
        situation: String(current.scenario.situation ?? activity.prompt ?? ''),
        stages: (current.scenario.stages ?? []).map((stage: AnyRecord, sIdx: number) => ({
          id: String(stage.id ?? `stage-${sIdx}`),
          title: String(stage.title ?? `Etapa ${sIdx + 1}`),
          prompt: String(stage.prompt ?? ''),
          options: (stage.options ?? []).map((option: AnyRecord, oIdx: number) => ({
            id: String(option.id ?? `opt-${oIdx}`),
            text: String(option.text ?? ''),
          })),
        })),
      };
      safeOptions = [];
      break;
    }

    case 'fillBlanks': {
      const fillBlanksBank = [
        ...(current.fillBlanks.blanks ?? []).map((b: AnyRecord) => String(b.answer ?? '').trim()).filter(Boolean),
        ...arrayOfStrings(current.fillBlanks.distractors).map((d: string) => d.trim()).filter(Boolean),
      ].sort((a, b) => a.localeCompare(b, 'es'));
      const rawText = String(current.fillBlanks.textWithBlanks ?? current.fillBlanks.text ?? activity.prompt ?? '');
      typeDetails = {
        textWithBlanks: rawText,
        text: rawText,
        blanks: (current.fillBlanks.blanks ?? []).map((b: AnyRecord, idx: number) => ({
          id: String(b.id ?? `blank-${idx + 1}`),
        })),
        bank: fillBlanksBank,
      };
      safeOptions = fillBlanksBank;
      break;
    }

    case 'spotError': {
      const segments = (current.spotError.segments ?? []).map((s: AnyRecord, index: number) => ({
        id: String(s.id ?? `seg-${index + 1}`),
        text: String(s.text ?? ''),
      }));
      typeDetails = { segments };
      safeOptions = segments.map((s: AnyRecord) => s.text);
      break;
    }

    case 'markWords': {
      const rawMarkWordsText = String(current.markWords.text ?? activity.prompt ?? '');
      const cleanMarkWordsText = rawMarkWordsText.replace(/\[([^\]*]+)\*\]/g, '[$1]');
      const words = (current.markWords.words ?? []).map((w: AnyRecord, index: number) => ({
        id: String(w.id ?? `word-${index + 1}`),
        text: String(w.text ?? '').replace('*', ''),
      }));
      typeDetails = {
        text: cleanMarkWordsText,
        words,
      };
      safeOptions = words.map((w: AnyRecord) => w.text);
      break;
    }

    case 'gridCheck': {
      const rows = (current.gridCheck.rows ?? []).map((r: AnyRecord, idx: number) => ({
        id: String(r.id ?? `r${idx + 1}`),
        label: String(r.label ?? ''),
      }));
      const columns = (current.gridCheck.columns ?? []).map((c: AnyRecord, idx: number) => ({
        id: String(c.id ?? `c${idx + 1}`),
        label: String(c.label ?? ''),
      }));
      typeDetails = { rows, columns };
      safeOptions = [];
      break;
    }

    case 'vennDiagram': {
      const explicitItems = activity.details?.vennDiagram?.items;
      const rawItems: AnyRecord[] = Array.isArray(explicitItems)
        ? explicitItems
        : Array.isArray(current.vennDiagram?.items) && activity.details?.vennDiagram
          ? current.vennDiagram.items
          : [];
      const items = rawItems.map((item: AnyRecord, idx: number) => ({
        id: String(item.id ?? `item-${idx + 1}`),
        label: String(item.label ?? ''),
      }));
      typeDetails = {
        setA: String(activity.details?.vennDiagram?.setA ?? current.vennDiagram?.setA ?? 'Conjunto A'),
        setB: String(activity.details?.vennDiagram?.setB ?? current.vennDiagram?.setB ?? 'Conjunto B'),
        intersectionLabel: String(activity.details?.vennDiagram?.intersectionLabel ?? current.vennDiagram?.intersectionLabel ?? 'Ambos'),
        items,
      };
      safeOptions = items.map((i: AnyRecord) => i.label);
      break;
    }

    case 'shortAnswer': {
      typeDetails = {
        prompt: String(activity.prompt ?? ''),
        placeholder: 'Escribe tu respuesta...',
      };
      safeOptions = [];
      break;
    }

    default: {
      typeDetails = {};
      safeOptions = [];
      break;
    }
  }

  // Safe details contains STRICTLY AND ONLY the entry for the activity's own type
  const safeDetails: AnyRecord = {
    [type]: typeDetails,
  };

  const safePrompt = type === 'markWords'
    ? String(current.markWords.text ?? activity.prompt ?? '').replace(/\[([^\]*]+)\*\]/g, '[$1]')
    : String(activity.prompt ?? '');

  return {
    id: activity.id,
    template_id: activity.template_id,
    type: activity.type,
    title: activity.title,
    topic: activity.topic,
    difficulty: activity.difficulty,
    prompt: safePrompt,
    options: safeOptions,
    details: safeDetails,
    status: activity.status,
  };
}

export interface RoomOccurrenceLink {
  id?: string;
  room_id?: string;
  activity_id: string;
  position: number;
  occurrence_id?: string;
}

export interface EvaluatedRoomSubmission {
  success: boolean;
  error?: string;
  statusCode?: number;
  totalQuestions: number;
  maxScore: number;
  score: number;
  answeredCount: number;
  omittedCount: number;
  correctCount: number;
  answerRows: AnyRecord[];
}

/**
 * Evalúa autoritativamente el envío de un estudiante contra las ocurrencias reales de la sala.
 * Governa el denominador con las ocurrencias vinculadas a la sala y genera omisiones automáticas.
 */
export function evaluateRoomAttempt(
  room: AnyRecord,
  authorizedLinks: RoomOccurrenceLink[],
  activitiesById: Map<string, AnyRecord>,
  studentResponses: AnyRecord[]
): EvaluatedRoomSubmission {
  if (!authorizedLinks || authorizedLinks.length === 0) {
    return {
      success: false,
      error: 'La sala no contiene actividades vinculadas.',
      statusCode: 400,
      totalQuestions: 0,
      maxScore: 0,
      score: 0,
      answeredCount: 0,
      omittedCount: 0,
      correctCount: 0,
      answerRows: [],
    };
  }

  // 1. Integridad referencial: Toda actividad en la sala debe tener su definición cargada
  for (const link of authorizedLinks) {
    if (!activitiesById.has(link.activity_id)) {
      return {
        success: false,
        error: `Integridad de sala comprometida: la definición de actividad "${link.activity_id}" no fue encontrada en la base de datos.`,
        statusCode: 500,
        totalQuestions: 0,
        maxScore: 0,
        score: 0,
        answeredCount: 0,
        omittedCount: 0,
        correctCount: 0,
        answerRows: [],
      };
    }
  }

  // 2. Construir catálogo autorizado de ocurrencias y mapeos
  const authorizedOccurrences = new Map<string, RoomOccurrenceLink>();
  const occurrencesByActivity = new Map<string, RoomOccurrenceLink[]>();

  for (let idx = 0; idx < authorizedLinks.length; idx++) {
    const link = authorizedLinks[idx];
    const canonicalKey = String(link.occurrence_id ?? link.id ?? `occ-${link.position ?? idx + 1}`);
    authorizedOccurrences.set(canonicalKey, link);
    if (link.id) authorizedOccurrences.set(String(link.id), link);
    if (link.occurrence_id) authorizedOccurrences.set(String(link.occurrence_id), link);

    const list = occurrencesByActivity.get(link.activity_id) ?? [];
    list.push(link);
    occurrencesByActivity.set(link.activity_id, list);
  }

  // 3. Validar exhaustivamente las respuestas enviadas por el alumno
  const submittedByOccurrence = new Map<string, AnyRecord>();
  const seenCanonicalOccurrences = new Set<string>();

  for (const respItem of studentResponses) {
    if (!respItem || typeof respItem !== 'object') {
      return {
        success: false,
        error: 'Estructura de respuesta no válida.',
        statusCode: 400,
        totalQuestions: 0,
        maxScore: 0,
        score: 0,
        answeredCount: 0,
        omittedCount: 0,
        correctCount: 0,
        answerRows: [],
      };
    }

    const actId = String(respItem.activityId ?? respItem.activity_id ?? '').trim();
    if (!actId) {
      return {
        success: false,
        error: 'Cada respuesta debe especificar su identificador de actividad (activityId).',
        statusCode: 400,
        totalQuestions: 0,
        maxScore: 0,
        score: 0,
        answeredCount: 0,
        omittedCount: 0,
        correctCount: 0,
        answerRows: [],
      };
    }

    const rawOccId = respItem.occurrenceId ?? respItem.occurrence_id ?? respItem.linkId;
    const occId = rawOccId !== undefined && rawOccId !== null && String(rawOccId).trim() !== ''
      ? String(rawOccId).trim()
      : undefined;

    let targetLink: RoomOccurrenceLink;

    if (occId) {
      // Si se provee occurrenceId, verificar que exista en el catálogo de la sala
      const link = authorizedOccurrences.get(occId);
      if (!link) {
        return {
          success: false,
          error: `Identificador de ocurrencia "${occId}" foráneo o no vinculado a esta sala.`,
          statusCode: 400,
          totalQuestions: 0,
          maxScore: 0,
          score: 0,
          answeredCount: 0,
          omittedCount: 0,
          correctCount: 0,
          answerRows: [],
        };
      }
      // Verificar que el par occurrenceId y activityId no sea contradictorio
      if (link.activity_id !== actId) {
        return {
          success: false,
          error: `Par contradictorio: la ocurrencia "${occId}" pertenece a la actividad "${link.activity_id}", no a "${actId}".`,
          statusCode: 400,
          totalQuestions: 0,
          maxScore: 0,
          score: 0,
          answeredCount: 0,
          omittedCount: 0,
          correctCount: 0,
          answerRows: [],
        };
      }
      targetLink = link;
    } else {
      // Si no se provee occurrenceId, verificar si la actividad pertenece a la sala
      const linksForAct = occurrencesByActivity.get(actId);
      if (!linksForAct || linksForAct.length === 0) {
        return {
          success: false,
          error: `Actividad "${actId}" no vinculada a esta sala.`,
          statusCode: 400,
          totalQuestions: 0,
          maxScore: 0,
          score: 0,
          answeredCount: 0,
          omittedCount: 0,
          correctCount: 0,
          answerRows: [],
        };
      }
      if (linksForAct.length > 1) {
        return {
          success: false,
          error: `La sala contiene múltiples ocurrencias de la actividad "${actId}"; se requiere occurrenceId para desambiguar.`,
          statusCode: 400,
          totalQuestions: 0,
          maxScore: 0,
          score: 0,
          answeredCount: 0,
          omittedCount: 0,
          correctCount: 0,
          answerRows: [],
        };
      }
      targetLink = linksForAct[0];
    }

    const canonicalOccKey = String(targetLink.occurrence_id ?? targetLink.id ?? `occ-${targetLink.position}`);
    if (seenCanonicalOccurrences.has(canonicalOccKey)) {
      return {
        success: false,
        error: `Respuesta duplicada para la misma ocurrencia (${canonicalOccKey}).`,
        statusCode: 400,
        totalQuestions: 0,
        maxScore: 0,
        score: 0,
        answeredCount: 0,
        omittedCount: 0,
        correctCount: 0,
        answerRows: [],
      };
    }
    seenCanonicalOccurrences.add(canonicalOccKey);
    submittedByOccurrence.set(canonicalOccKey, respItem);
  }

  // 4. Iterar exhaustivamente sobre TODAS las ocurrencias autorizadas de la sala
  const scorePerQuestion = Number(room.score_per_question ?? 10);
  const totalQuestions = authorizedLinks.length;
  const maxScore = totalQuestions * scorePerQuestion;

  let totalScore = 0;
  let answeredCount = 0;
  let omittedCount = 0;
  let correctCount = 0;
  const answerRows: AnyRecord[] = [];

  for (let idx = 0; idx < authorizedLinks.length; idx++) {
    const link = authorizedLinks[idx];
    const activity = activitiesById.get(link.activity_id)!;
    const occId = String(link.occurrence_id ?? link.id ?? `occ-${link.position ?? idx + 1}`);
    const submittedItem = submittedByOccurrence.get(occId);

    if (submittedItem) {
      const rawResponse = submittedItem.response;

      if (rawResponse === null || rawResponse === undefined) {
        omittedCount++;
        answerRows.push({
          occurrence_id: occId,
          activity_id: activity.id,
          question_index: link.position ?? idx + 1,
          response: canonicalOmittedResponse(activity.type),
          response_text: '',
          status: 'omitted',
          is_omitted: true,
          correct: false,
          score: 0,
          time_seconds: Number(submittedItem.timeSeconds ?? 0),
        });
        continue;
      }

      if (!isPlainRecord(rawResponse)) {
        return {
          success: false,
          error: 'Estructura de respuesta inválida.',
          statusCode: 400,
          totalQuestions: 0,
          maxScore: 0,
          score: 0,
          answeredCount: 0,
          omittedCount: 0,
          correctCount: 0,
          answerRows: [],
        };
      }

      const resp = rawResponse;

      // Validación estructural y compatibilidad estricta
      const validation = validateResponseStructure(activity, resp);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error ?? `Tipo de respuesta incompatible para la actividad ${activity.type}.`,
          statusCode: 400,
          totalQuestions: 0,
          maxScore: 0,
          score: 0,
          answeredCount: 0,
          omittedCount: 0,
          correctCount: 0,
          answerRows: [],
        };
      }

      const omitted = isOmitted(activity, resp);
      if (omitted) {
        omittedCount++;
        answerRows.push({
          occurrence_id: occId,
          activity_id: activity.id,
          question_index: link.position ?? idx + 1,
          response: resp,
          response_text: '',
          status: 'omitted',
          is_omitted: true,
          correct: false,
          score: 0,
          time_seconds: Number(submittedItem.timeSeconds ?? 0),
        });
      } else {
        const isCorrect = compare(activity, resp);
        const earnedScore = isCorrect ? scorePerQuestion : 0;
        answeredCount++;
        if (isCorrect) correctCount++;
        totalScore += earnedScore;

        answerRows.push({
          occurrence_id: occId,
          activity_id: activity.id,
          question_index: link.position ?? idx + 1,
          response: resp,
          response_text: serializeResponse(resp),
          status: 'answered',
          is_omitted: false,
          correct: isCorrect,
          score: earnedScore,
          time_seconds: Number(submittedItem.timeSeconds ?? 0),
        });
      }
    } else {
      // Pregunta no remitida por el alumno: omisión automática autoritativa
      omittedCount++;
      answerRows.push({
        occurrence_id: occId,
        activity_id: activity.id,
        question_index: link.position ?? idx + 1,
        response: canonicalOmittedResponse(activity.type),
        response_text: '',
        status: 'omitted',
        is_omitted: true,
        correct: false,
        score: 0,
        time_seconds: 0,
      });
    }
  }

  return {
    success: true,
    totalQuestions,
    maxScore,
    score: totalScore,
    answeredCount,
    omittedCount,
    correctCount,
    answerRows,
  };
}
