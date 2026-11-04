/**
 * Contrato aislado de la actividad: Matriz de Doble Entrada (gridCheck) — v1.3
 *
 * Propósito pedagógico:
 * Presentar una matriz interactiva bidimensional donde se cruzan conceptos, entidades o
 * casos (filas) frente a criterios, propiedades, características o condiciones (columnas).
 * El estudiante debe marcar con casillas o pastillas táctiles qué propiedades corresponden
 * a cada elemento analizado (por ejemplo: comparar tipos celulares vs orgánulos presentes,
 * fuentes de energía vs impacto ecológico/renovabilidad, o formas de gobierno vs características).
 *
 * Reglas de aislamiento:
 * - No importa React, Supabase ni el DOM.
 * - Separa estrictamente la definición privada (con celdas correctas y explicación)
 *   de la proyección pública para el estudiante (`GridCheckPublic`).
 * - Al evaluar, el estudiante recibe únicamente `studentHint` (la pista orientadora),
 *   sin revelar la solución de la matriz.
 */

export const GRID_CHECK_TYPE = 'gridCheck' as const;

export const GRID_CHECK_LIMITS = {
  context: 1500,
  prompt: 600,
  rowLabel: 120,
  columnLabel: 80,
  minRows: 2,
  maxRows: 6,
  minColumns: 2,
  maxColumns: 5,
  minExpectedCells: 1,
  hint: 400,
  explanation: 1000,
} as const;

export interface GridCheckRow {
  id: string;
  label: string;
}

export interface GridCheckColumn {
  id: string;
  label: string;
}

export interface GridCheckDefinition {
  type: typeof GRID_CHECK_TYPE;
  id: string;
  context?: string;
  prompt: string;
  rows: GridCheckRow[];
  columns: GridCheckColumn[];
  /** Celdas que deben estar marcadas en formato `${rowId}:${columnId}` */
  expectedCells: string[];
  hint: string;
  explanation?: string;
  sourceRef?: string;
}

export interface GridCheckPublic {
  type: typeof GRID_CHECK_TYPE;
  id: string;
  context?: string;
  prompt: string;
  rows: GridCheckRow[];
  columns: GridCheckColumn[];
  hint: string;
}

export interface GridCheckResponse {
  type: typeof GRID_CHECK_TYPE;
  /** Celdas marcadas por el estudiante en formato `${rowId}:${columnId}` */
  values: string[];
}

export interface GridCheckValidationIssue {
  path: string;
  message: string;
}

export type GridCheckAttemptStatus = 'omitted' | 'answered';

export interface GridCheckEvaluation {
  type: typeof GRID_CHECK_TYPE;
  activityId: string;
  status: GridCheckAttemptStatus;
  selectedCells: string[];
  expectedCells: string[];
  correct: boolean | null;
  score: number;
  maxScore: number;
  studentHint: string;
}

export interface GridCheckTeacherReport {
  activityId: string;
  type: typeof GRID_CHECK_TYPE;
  prompt: string;
  context: string;
  matrixSummary: string;
  studentAnswer: string;
  expectedCells: string;
  status: GridCheckAttemptStatus;
  correct: boolean | null;
  score: number;
  maxScore: number;
  hintShownToStudent: string;
  privateExplanation: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeCellKey(cell: string): string {
  return cell.trim().toLowerCase();
}

/**
 * Valida de forma estricta la definición docente de una actividad gridCheck.
 */
export function validateGridCheckActivity(raw: unknown): {
  valid: boolean;
  issues: GridCheckValidationIssue[];
  data?: GridCheckDefinition;
} {
  const issues: GridCheckValidationIssue[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      issues: [{ path: '', message: 'La actividad debe ser un objeto válido.' }],
    };
  }

  const candidate = raw as Partial<GridCheckDefinition>;

  if (candidate.type !== GRID_CHECK_TYPE) {
    issues.push({ path: 'type', message: `El tipo debe ser "${GRID_CHECK_TYPE}".` });
  }

  if (!isNonEmptyString(candidate.id)) {
    issues.push({ path: 'id', message: 'El identificador de la actividad es obligatorio.' });
  }

  if (candidate.context !== undefined && candidate.context !== null) {
    if (typeof candidate.context !== 'string') {
      issues.push({ path: 'context', message: 'El contexto debe ser una cadena de texto.' });
    } else if (candidate.context.length > GRID_CHECK_LIMITS.context) {
      issues.push({
        path: 'context',
        message: `El contexto excede el límite de ${GRID_CHECK_LIMITS.context} caracteres.`,
      });
    }
  }

  if (!isNonEmptyString(candidate.prompt)) {
    issues.push({ path: 'prompt', message: 'La consigna (prompt) es obligatoria.' });
  } else if (candidate.prompt.length > GRID_CHECK_LIMITS.prompt) {
    issues.push({
      path: 'prompt',
      message: `La consigna excede el límite de ${GRID_CHECK_LIMITS.prompt} caracteres.`,
    });
  }

  // Validación de Filas (rows)
  const rows: GridCheckRow[] = [];
  const rowIds = new Set<string>();

  if (!Array.isArray(candidate.rows)) {
    issues.push({ path: 'rows', message: 'Debe especificarse una lista de filas (rows).' });
  } else {
    if (candidate.rows.length < GRID_CHECK_LIMITS.minRows) {
      issues.push({
        path: 'rows',
        message: `La matriz debe tener al menos ${GRID_CHECK_LIMITS.minRows} filas para ser pedagógicamente significativa.`,
      });
    }
    if (candidate.rows.length > GRID_CHECK_LIMITS.maxRows) {
      issues.push({
        path: 'rows',
        message: `La matriz no debe exceder ${GRID_CHECK_LIMITS.maxRows} filas para garantizar legibilidad en pantalla e impresión.`,
      });
    }

    candidate.rows.forEach((row, index) => {
      const rowPath = `rows[${index}]`;
      if (!row || typeof row !== 'object') {
        issues.push({ path: rowPath, message: 'La fila debe ser un objeto.' });
        return;
      }

      const r = row as Partial<GridCheckRow>;
      const rawId = isNonEmptyString(r.id) ? r.id.trim() : `r${index + 1}`;
      const lowerId = rawId.toLowerCase();

      if (rowIds.has(lowerId)) {
        issues.push({ path: `${rowPath}.id`, message: `Identificador de fila duplicado: "${rawId}".` });
      }
      rowIds.add(lowerId);

      if (!isNonEmptyString(r.label)) {
        issues.push({ path: `${rowPath}.label`, message: 'La etiqueta de la fila no puede estar vacía.' });
      } else if (r.label.length > GRID_CHECK_LIMITS.rowLabel) {
        issues.push({
          path: `${rowPath}.label`,
          message: `La etiqueta de la fila supera el límite de ${GRID_CHECK_LIMITS.rowLabel} caracteres.`,
        });
      }

      rows.push({
        id: rawId,
        label: isNonEmptyString(r.label) ? r.label.trim() : '',
      });
    });
  }

  // Validación de Columnas (columns)
  const columns: GridCheckColumn[] = [];
  const colIds = new Set<string>();

  if (!Array.isArray(candidate.columns)) {
    issues.push({ path: 'columns', message: 'Debe especificarse una lista de columnas (columns).' });
  } else {
    if (candidate.columns.length < GRID_CHECK_LIMITS.minColumns) {
      issues.push({
        path: 'columns',
        message: `La matriz debe tener al menos ${GRID_CHECK_LIMITS.minColumns} columnas para contrastar propiedades.`,
      });
    }
    if (candidate.columns.length > GRID_CHECK_LIMITS.maxColumns) {
      issues.push({
        path: 'columns',
        message: `La matriz no debe exceder ${GRID_CHECK_LIMITS.maxColumns} columnas para evitar desbordamiento horizontal.`,
      });
    }

    candidate.columns.forEach((col, index) => {
      const colPath = `columns[${index}]`;
      if (!col || typeof col !== 'object') {
        issues.push({ path: colPath, message: 'La columna debe ser un objeto.' });
        return;
      }

      const c = col as Partial<GridCheckColumn>;
      const rawId = isNonEmptyString(c.id) ? c.id.trim() : `c${index + 1}`;
      const lowerId = rawId.toLowerCase();

      if (colIds.has(lowerId)) {
        issues.push({ path: `${colPath}.id`, message: `Identificador de columna duplicado: "${rawId}".` });
      }
      colIds.add(lowerId);

      if (!isNonEmptyString(c.label)) {
        issues.push({ path: `${colPath}.label`, message: 'La etiqueta de la columna no puede estar vacía.' });
      } else if (c.label.length > GRID_CHECK_LIMITS.columnLabel) {
        issues.push({
          path: `${colPath}.label`,
          message: `La etiqueta de la columna supera el límite de ${GRID_CHECK_LIMITS.columnLabel} caracteres.`,
        });
      }

      columns.push({
        id: rawId,
        label: isNonEmptyString(c.label) ? c.label.trim() : '',
      });
    });
  }

  // Validación de Celdas Esperadas (expectedCells)
  const expectedCellsClean: string[] = [];
  const expectedSet = new Set<string>();

  if (!Array.isArray(candidate.expectedCells)) {
    issues.push({ path: 'expectedCells', message: 'Las celdas esperadas deben ser un arreglo de cadenas.' });
  } else {
    candidate.expectedCells.forEach((cell, index) => {
      if (typeof cell !== 'string' || !cell.includes(':')) {
        issues.push({
          path: `expectedCells[${index}]`,
          message: `La celda "${String(cell)}" debe tener el formato "filaId:columnaId".`,
        });
        return;
      }

      const [rId, cId] = cell.split(':').map((s) => s.trim());
      const lowerRow = rId.toLowerCase();
      const lowerCol = cId.toLowerCase();

      if (!rowIds.has(lowerRow)) {
        issues.push({
          path: `expectedCells[${index}]`,
          message: `La celda hace referencia a una fila inexistente: "${rId}".`,
        });
      }
      if (!colIds.has(lowerCol)) {
        issues.push({
          path: `expectedCells[${index}]`,
          message: `La celda hace referencia a una columna inexistente: "${cId}".`,
        });
      }

      const normalized = `${rId}:${cId}`;
      const key = normalizeCellKey(normalized);
      if (!expectedSet.has(key)) {
        expectedSet.add(key);
        expectedCellsClean.push(normalized);
      }
    });

    if (expectedCellsClean.length < GRID_CHECK_LIMITS.minExpectedCells) {
      issues.push({
        path: 'expectedCells',
        message: `Debe haber al menos ${GRID_CHECK_LIMITS.minExpectedCells} casilla correcta marcada en la matriz.`,
      });
    }
  }

  if (!isNonEmptyString(candidate.hint)) {
    issues.push({ path: 'hint', message: 'La pista formativa (hint) es obligatoria.' });
  } else if (candidate.hint.length > GRID_CHECK_LIMITS.hint) {
    issues.push({
      path: 'hint',
      message: `La pista supera el límite de ${GRID_CHECK_LIMITS.hint} caracteres.`,
    });
  }

  if (candidate.explanation !== undefined && candidate.explanation !== null) {
    if (typeof candidate.explanation !== 'string') {
      issues.push({ path: 'explanation', message: 'La explicación debe ser una cadena de texto.' });
    } else if (candidate.explanation.length > GRID_CHECK_LIMITS.explanation) {
      issues.push({
        path: 'explanation',
        message: `La explicación supera el límite de ${GRID_CHECK_LIMITS.explanation} caracteres.`,
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  const data: GridCheckDefinition = {
    type: GRID_CHECK_TYPE,
    id: candidate.id!.trim(),
    context: candidate.context ? candidate.context.trim() : undefined,
    prompt: candidate.prompt!.trim(),
    rows,
    columns,
    expectedCells: expectedCellsClean,
    hint: candidate.hint!.trim(),
    explanation: candidate.explanation ? candidate.explanation.trim() : undefined,
    sourceRef: candidate.sourceRef ? candidate.sourceRef.trim() : undefined,
  };

  return { valid: true, issues: [], data };
}

/**
 * Proyecta la definición privada a la versión pública segura para el estudiante.
 * Garantiza que `expectedCells` y `explanation` nunca salgan al cliente.
 */
export function toGridCheckPublic(def: GridCheckDefinition): GridCheckPublic {
  return {
    type: GRID_CHECK_TYPE,
    id: def.id,
    context: def.context,
    prompt: def.prompt,
    rows: def.rows.map((r) => ({ id: r.id, label: r.label })),
    columns: def.columns.map((c) => ({ id: c.id, label: c.label })),
    hint: def.hint,
  };
}

/**
 * Evalúa la respuesta de un estudiante frente a la definición docente.
 * Aplica el principio de omisión cuando no se marca ninguna celda (`values` vacío).
 */
export function evaluateGridCheckResponse(
  def: GridCheckDefinition,
  response: GridCheckResponse | undefined,
  maxScore = 1
): GridCheckEvaluation {
  const safeValues = response?.values ?? [];
  const normalizedSelected = safeValues
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);

  // Omisión: el estudiante no marcó ninguna casilla
  if (normalizedSelected.length === 0) {
    return {
      type: GRID_CHECK_TYPE,
      activityId: def.id,
      status: 'omitted',
      selectedCells: [],
      expectedCells: [...def.expectedCells],
      correct: null,
      score: 0,
      maxScore,
      studentHint: def.hint,
    };
  }

  const expectedSet = new Set(def.expectedCells.map(normalizeCellKey));
  const selectedSet = new Set(normalizedSelected.map(normalizeCellKey));

  const hasAllExpected = Array.from(expectedSet).every((cell) => selectedSet.has(cell));
  const hasNoExtras = Array.from(selectedSet).every((cell) => expectedSet.has(cell));
  const isCorrect = hasAllExpected && hasNoExtras && expectedSet.size === selectedSet.size;

  return {
    type: GRID_CHECK_TYPE,
    activityId: def.id,
    status: 'answered',
    selectedCells: normalizedSelected,
    expectedCells: [...def.expectedCells],
    correct: isCorrect,
    score: isCorrect ? maxScore : 0,
    maxScore,
    studentHint: def.hint,
  };
}

/**
 * Genera el reporte exhaustivo para el docente y la auditoría.
 */
export function generateGridCheckTeacherReport(
  def: GridCheckDefinition,
  response: GridCheckResponse | undefined,
  evaluation: GridCheckEvaluation
): GridCheckTeacherReport {
  const matrixSummary = `Filas (${def.rows.length}): [${def.rows.map((r) => r.label).join(' | ')}] × Columnas (${def.columns.length}): [${def.columns.map((c) => c.label).join(' | ')}]`;

  let studentAnswer = 'Omitida (ninguna celda seleccionada)';
  if (evaluation.status === 'answered') {
    studentAnswer = evaluation.selectedCells.length > 0
      ? evaluation.selectedCells.join(', ')
      : 'Sin celdas seleccionadas';
  }

  return {
    activityId: def.id,
    type: GRID_CHECK_TYPE,
    prompt: def.prompt,
    context: def.context ?? 'Sin contexto adicional',
    matrixSummary,
    studentAnswer,
    expectedCells: def.expectedCells.join(', '),
    status: evaluation.status,
    correct: evaluation.correct,
    score: evaluation.score,
    maxScore: evaluation.maxScore,
    hintShownToStudent: evaluation.studentHint,
    privateExplanation: def.explanation ?? 'Sin explicación pedagógica privada registrada.',
  };
}
