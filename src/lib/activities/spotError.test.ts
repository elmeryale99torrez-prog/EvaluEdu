import { describe, expect, it } from 'vitest';
import {
  SPOT_ERROR_TYPE,
  SpotErrorDefinition,
  evaluateSpotError,
  formatSpotErrorReport,
  toSpotErrorPublic,
  validateSpotErrorDefinition,
  validateSpotErrorResponse,
} from './spotError';

const validDefinition: SpotErrorDefinition = {
  type: SPOT_ERROR_TYPE,
  id: 'se-demo-1',
  context: 'Protocolo de actuación comunitaria ante emergencias sanitarias.',
  prompt: 'Identifica cuál de los siguientes enunciados del protocolo contiene un error procedimental:',
  segments: [
    { id: 'seg-1', text: '1. Verificar las fuentes oficiales antes de difundir alertas.', hasError: false },
    { id: 'seg-2', text: '2. Suspender la comunicación con el equipo técnico durante la emergencia.', hasError: true },
    { id: 'seg-3', text: '3. Registrar las acciones tomadas en la bitácora comunitaria.', hasError: false },
  ],
  correction: 'Nunca se debe suspender la comunicación con el equipo técnico; por el contrario, debe mantenerse coordinación permanente.',
  hint: 'Revisa cuál de los pasos contradice el principio de coordinación y trazabilidad durante una emergencia.',
  explanation: 'El paso 2 introduce un error crítico porque aislar al equipo técnico impide tomar decisiones informadas.',
};

describe('Contrato aislado: spotError (Identificación del Error)', () => {
  it('acepta una definición válida con 3 a 6 fragmentos y exactamente un error marcado', () => {
    const issues = validateSpotErrorDefinition(validDefinition);
    expect(issues).toEqual([]);
  });

  it('rechaza definiciones con menos de 3 fragmentos o más de 6 fragmentos', () => {
    const tooFew = validateSpotErrorDefinition({
      ...validDefinition,
      segments: validDefinition.segments.slice(0, 2),
    });
    expect(tooFew.some((i) => i.path === 'segments')).toBe(true);

    const tooMany = validateSpotErrorDefinition({
      ...validDefinition,
      segments: [
        ...validDefinition.segments,
        { id: 'seg-4', text: '4. Paso cuatro válido.', hasError: false },
        { id: 'seg-5', text: '5. Paso cinco válido.', hasError: false },
        { id: 'seg-6', text: '6. Paso seis válido.', hasError: false },
        { id: 'seg-7', text: '7. Paso siete excedente.', hasError: false },
      ],
    });
    expect(tooMany.some((i) => i.path === 'segments')).toBe(true);
  });

  it('rechaza definiciones con 0 errores o con más de 1 fragmento marcado con error', () => {
    const noError = validateSpotErrorDefinition({
      ...validDefinition,
      segments: validDefinition.segments.map((s) => ({ ...s, hasError: false })),
    });
    expect(noError.some((i) => i.path === 'hasError')).toBe(true);

    const twoErrors = validateSpotErrorDefinition({
      ...validDefinition,
      segments: validDefinition.segments.map((s, idx) => ({ ...s, hasError: idx < 2 })),
    });
    expect(twoErrors.some((i) => i.path === 'hasError')).toBe(true);
  });

  it('rechaza fragmentos con textos duplicados o vacíos', () => {
    const duplicate = validateSpotErrorDefinition({
      ...validDefinition,
      segments: [
        { id: 'seg-1', text: 'Texto repetido', hasError: true },
        { id: 'seg-2', text: '  texto   repetido ', hasError: false },
        { id: 'seg-3', text: 'Texto distinto', hasError: false },
      ],
    });
    expect(duplicate.some((i) => i.path === 'segments[1].text')).toBe(true);
  });

  it('oculta hasError, correction y explanation en la proyección pública para el estudiante', () => {
    const pub = toSpotErrorPublic(validDefinition);
    expect(pub.id).toBe(validDefinition.id);
    expect(pub.segments).toHaveLength(3);
    for (const seg of pub.segments) {
      expect('hasError' in seg).toBe(false);
    }
    expect('correction' in pub).toBe(false);
    expect('explanation' in pub).toBe(false);
  });

  it('valida respuestas del estudiante y rechaza fragmentos inexistentes', () => {
    expect(
      validateSpotErrorResponse(validDefinition, { type: 'spotError', selectedSegmentId: 'seg-2' }),
    ).toEqual([]);
    expect(
      validateSpotErrorResponse(validDefinition, { type: 'spotError', selectedSegmentId: null }),
    ).toEqual([]);

    const invalidSeg = validateSpotErrorResponse(validDefinition, {
      type: 'spotError',
      selectedSegmentId: 'seg-inexistente',
    });
    expect(invalidSeg.some((i) => i.path === 'selectedSegmentId')).toBe(true);
  });

  it('califica correctamente respuestas acertadas, erróneas y omitidas sin filtrar la solución', () => {
    const omitted = evaluateSpotError(validDefinition, { type: 'spotError', selectedSegmentId: null }, 10);
    expect(omitted.status).toBe('omitted');
    expect(omitted.correct).toBeNull();
    expect(omitted.score).toBe(0);
    expect(omitted.studentHint).toBe(validDefinition.hint);

    const correctById = evaluateSpotError(
      validDefinition,
      { type: 'spotError', selectedSegmentId: 'seg-2' },
      10,
    );
    expect(correctById.status).toBe('answered');
    expect(correctById.correct).toBe(true);
    expect(correctById.score).toBe(10);

    const correctByText = evaluateSpotError(
      validDefinition,
      { type: 'spotError', selectedSegmentId: validDefinition.segments[1].text },
      10,
    );
    expect(correctByText.correct).toBe(true);
    expect(correctByText.score).toBe(10);

    const wrong = evaluateSpotError(
      validDefinition,
      { type: 'spotError', selectedSegmentId: 'seg-1' },
      10,
    );
    expect(wrong.status).toBe('answered');
    expect(wrong.correct).toBe(false);
    expect(wrong.score).toBe(0);
    expect(wrong.studentHint).toBe(validDefinition.hint);
  });

  it('genera el reporte docente completo con el fragmento erróneo esperado y su corrección', () => {
    const evaluation = evaluateSpotError(
      validDefinition,
      { type: 'spotError', selectedSegmentId: 'seg-2' },
      10,
    );
    const report = formatSpotErrorReport(validDefinition, evaluation);
    expect(report.studentAnswer).toContain('Suspender la comunicación');
    expect(report.expectedErrorSegment).toContain('Suspender la comunicación');
    expect(report.correction).toContain('Nunca se debe suspender');
    expect(report.privateExplanation).toContain('error crítico');
  });
});
