import { describe, it, expect } from 'vitest';
import {
  GRID_CHECK_TYPE,
  GridCheckDefinition,
  validateGridCheckActivity,
  toGridCheckPublic,
  evaluateGridCheckResponse,
  generateGridCheckTeacherReport,
} from './gridCheck';

describe('Capa 1: Actividad gridCheck (Matriz de Doble Entrada) - Contrato Aislado', () => {
  const sampleValidGridCheck: GridCheckDefinition = {
    type: GRID_CHECK_TYPE,
    id: 'gc-bio-01',
    context: 'Estudio comparativo de estructuras y orgánulos celulares en biología.',
    prompt: 'Marca en la matriz las características estructurales que corresponden a cada tipo celular:',
    rows: [
      { id: 'r1', label: 'Célula Vegetal' },
      { id: 'r2', label: 'Célula Animal' },
      { id: 'r3', label: 'Bacteria (Procariota)' },
    ],
    columns: [
      { id: 'c1', label: 'Pared Celular' },
      { id: 'c2', label: 'Núcleo Definido' },
      { id: 'c3', label: 'Cloroplastos' },
    ],
    expectedCells: [
      'r1:c1', // Vegetal tiene pared celular
      'r1:c2', // Vegetal tiene núcleo
      'r1:c3', // Vegetal tiene cloroplastos
      'r2:c2', // Animal tiene núcleo
      'r3:c1', // Bacteria tiene pared celular
    ],
    hint: 'Recuerda que los procariotas carecen de núcleo celular y los animales carecen de pared celular.',
    explanation: 'Las células vegetales tienen pared de celulosa, núcleo y cloroplastos; las animales tienen núcleo pero carecen de pared y cloroplastos; las bacterias tienen pared bacteriana pero no núcleo delimitado por membrana.',
  };

  it('valida exitosamente una definición completa de gridCheck', () => {
    const result = validateGridCheckActivity(sampleValidGridCheck);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.data).toBeDefined();
    expect(result.data?.rows).toHaveLength(3);
    expect(result.data?.columns).toHaveLength(3);
    expect(result.data?.expectedCells).toHaveLength(5);
  });

  it('rechaza una matriz con menos de 2 filas o menos de 2 columnas', () => {
    const invalidRows = {
      ...sampleValidGridCheck,
      rows: [{ id: 'r1', label: 'Única fila' }],
    };
    const resRows = validateGridCheckActivity(invalidRows);
    expect(resRows.valid).toBe(false);
    expect(resRows.issues.some((i) => i.path === 'rows')).toBe(true);

    const invalidCols = {
      ...sampleValidGridCheck,
      columns: [{ id: 'c1', label: 'Única columna' }],
    };
    const resCols = validateGridCheckActivity(invalidCols);
    expect(resCols.valid).toBe(false);
    expect(resCols.issues.some((i) => i.path === 'columns')).toBe(true);
  });

  it('rechaza celdas esperadas que apuntan a filas o columnas inexistentes', () => {
    const invalidCells = {
      ...sampleValidGridCheck,
      expectedCells: ['r1:c1', 'r99:c1', 'r1:c88'],
    };
    const res = validateGridCheckActivity(invalidCells);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.message.includes('r99'))).toBe(true);
    expect(res.issues.some((i) => i.message.includes('c88'))).toBe(true);
  });

  it('rechaza si no hay al menos una celda esperada marcada', () => {
    const emptyCells = {
      ...sampleValidGridCheck,
      expectedCells: [],
    };
    const res = validateGridCheckActivity(emptyCells);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.path === 'expectedCells')).toBe(true);
  });

  it('proyecta públicamente de forma segura ocultando celdas esperadas y explicación', () => {
    const pub = toGridCheckPublic(sampleValidGridCheck);
    expect(pub.type).toBe('gridCheck');
    expect(pub.id).toBe(sampleValidGridCheck.id);
    expect(pub.prompt).toBe(sampleValidGridCheck.prompt);
    expect(pub.rows).toHaveLength(3);
    expect(pub.columns).toHaveLength(3);
    expect(pub.hint).toBe(sampleValidGridCheck.hint);
    // Verificamos que no contiene secretos pedagógicos
    expect((pub as unknown as Record<string, unknown>).expectedCells).toBeUndefined();
    expect((pub as unknown as Record<string, unknown>).explanation).toBeUndefined();
  });

  it('evalúa como omisión cuando el estudiante no marca ninguna casilla', () => {
    const evaluationEmpty = evaluateGridCheckResponse(sampleValidGridCheck, {
      type: GRID_CHECK_TYPE,
      values: [],
    });
    expect(evaluationEmpty.status).toBe('omitted');
    expect(evaluationEmpty.correct).toBeNull();
    expect(evaluationEmpty.score).toBe(0);
    expect(evaluationEmpty.studentHint).toBe(sampleValidGridCheck.hint);

    const evaluationUndefined = evaluateGridCheckResponse(sampleValidGridCheck, undefined);
    expect(evaluationUndefined.status).toBe('omitted');
    expect(evaluationUndefined.correct).toBeNull();
    expect(evaluationUndefined.score).toBe(0);
  });

  it('evalúa como correcto cuando el estudiante marca exactamente las celdas esperadas', () => {
    const evaluation = evaluateGridCheckResponse(
      sampleValidGridCheck,
      {
        type: GRID_CHECK_TYPE,
        values: ['r1:c1', 'r1:c2', 'r1:c3', 'r2:c2', 'r3:c1'],
      },
      5
    );
    expect(evaluation.status).toBe('answered');
    expect(evaluation.correct).toBe(true);
    expect(evaluation.score).toBe(5);
  });

  it('evalúa como incorrecto si falta una celda o si sobra una celda incorrecta', () => {
    // Falta una celda ('r3:c1')
    const evalMissing = evaluateGridCheckResponse(
      sampleValidGridCheck,
      {
        type: GRID_CHECK_TYPE,
        values: ['r1:c1', 'r1:c2', 'r1:c3', 'r2:c2'],
      },
      5
    );
    expect(evalMissing.status).toBe('answered');
    expect(evalMissing.correct).toBe(false);
    expect(evalMissing.score).toBe(0);

    // Sobra una celda ('r2:c1' - Célula animal con pared celular es falso)
    const evalExtra = evaluateGridCheckResponse(
      sampleValidGridCheck,
      {
        type: GRID_CHECK_TYPE,
        values: ['r1:c1', 'r1:c2', 'r1:c3', 'r2:c2', 'r3:c1', 'r2:c1'],
      },
      5
    );
    expect(evalExtra.status).toBe('answered');
    expect(evalExtra.correct).toBe(false);
    expect(evalExtra.score).toBe(0);
  });

  it('genera un reporte docente exhaustivo para auditoría', () => {
    const evaluation = evaluateGridCheckResponse(
      sampleValidGridCheck,
      {
        type: GRID_CHECK_TYPE,
        values: ['r1:c1', 'r1:c2'],
      },
      10
    );
    const report = generateGridCheckTeacherReport(
      sampleValidGridCheck,
      { type: GRID_CHECK_TYPE, values: ['r1:c1', 'r1:c2'] },
      evaluation
    );

    expect(report.activityId).toBe('gc-bio-01');
    expect(report.type).toBe('gridCheck');
    expect(report.correct).toBe(false);
    expect(report.studentAnswer).toContain('r1:c1');
    expect(report.matrixSummary).toContain('Filas (3)');
    expect(report.matrixSummary).toContain('Columnas (3)');
    expect(report.expectedCells).toContain('r1:c1, r1:c2, r1:c3, r2:c2, r3:c1');
    expect(report.privateExplanation).toBe(sampleValidGridCheck.explanation);
  });
});
