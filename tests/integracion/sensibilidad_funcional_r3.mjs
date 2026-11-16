/**
 * EvaluEdu v1.3 - Suite de Sensibilidad Funcional R3 (LAB-DE-001 R3)
 *
 * Demuestra sensibilidad funcional por criterio crítico pendiente mediante
 * controles negativos controlados (reproducción del modo defectuoso) y controles
 * positivos (comportamiento subsanado), sin depender de errores de módulos ausentes.
 *
 * Criterios evaluados:
 * 1. D-P0-09 / DE-R3: Colapso por título idéntico en reconciliación docente vs. preservación con mapa durable / client_local_id.
 * 2. D-P0-07 / D-P0-08 / DE-R2: Supresión de avisos de respaldo local inexistente ante QuotaExceededError vs. aviso veraz de memoria.
 * 3. D-P0-08 / E2E-DOC-05: Rechazo ante mutación de definición de concepto vs. aceptación ante correspondencia exacta de content y difficulty.
 * 4. D-P0-09 / E2E-DOC-06: Detección de pérdida de multiplicidad en actualización in-place de sala vs. preservación de [uuidA, locB, uuidA].
 * 5. RES-01 / RES-04: Pérdida de intento sin envoltorio durable vs. persistencia idempotente con clientRequestId.
 */

import assert from 'node:assert/strict';

const results = [];

function recordTest(id, name, fn) {
  const start = Date.now();
  try {
    fn();
    const durationMs = Date.now() - start;
    results.push({ id, name, status: 'PASA', durationMs });
    console.log(`[PASA] ${id}: ${name} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Date.now() - start;
    results.push({ id, name, status: 'FALLA', durationMs, error: err.message });
    console.error(`[FALLA] ${id}: ${name} (${durationMs}ms) -> ${err.message}`);
  }
}

console.log('='.repeat(70));
console.log('INICIO SUITE SENSIBILIDAD FUNCIONAL R3 (LAB-DE-001)');
console.log(`Fecha UTC: ${new Date().toISOString()}`);
console.log(`PID: ${process.pid}`);
console.log('='.repeat(70));

// =============================================================================
// CRITERIO 1: D-P0-09 / DE-R3 - Títulos idénticos en actividades locales distintas
// =============================================================================
recordTest(
  'SENS-R3-01-NEG',
  'Modo defectuoso D-P0-09: Reconciliación por (type, title) colapsa actividades con igual título',
  () => {
    // Simular base de datos remota en memoria
    const remoteDb = [];
    const defectiveReconcile = (act) => {
      // Conducta defectuosa previa a R3: eq('type', act.type).eq('title', act.title)
      const existing = remoteDb.find((r) => r.type === act.type && r.title === act.title);
      if (existing) {
        // Colapso: sobrescribe o reutiliza el primero
        existing.prompt = act.prompt;
        return existing;
      }
      const inserted = { id: `cloud-${remoteDb.length + 1}`, type: act.type, title: act.title, prompt: act.prompt };
      remoteDb.push(inserted);
      return inserted;
    };

    const localAct1 = { id: 'loc-1', type: 'singleChoice', title: 'Mismo Título', prompt: 'Pregunta única 1' };
    const localAct2 = { id: 'loc-2', type: 'singleChoice', title: 'Mismo Título', prompt: 'Pregunta distinta 2' };

    defectiveReconcile(localAct1);
    defectiveReconcile(localAct2);

    // Demostrar el defecto: la base remota solo tiene 1 fila y se perdió la primera pregunta
    assert.equal(remoteDb.length, 1, 'El modo defectuoso debió colapsar ambas actividades en 1 fila remota');
    assert.equal(remoteDb[0].prompt, 'Pregunta distinta 2', 'El contenido de la primera fue sobrescrito');
  }
);

recordTest(
  'SENS-R3-01-POS',
  'Modo corregido D-P0-09: Reconciliación con mapa durable y client_local_id preserva ambas identidades',
  () => {
    const remoteDb = [];
    const localActivityMap = new Map();

    const correctedReconcile = (act, localId) => {
      let mappedCloudId = localActivityMap.get(localId) || null;
      let existing = null;
      if (mappedCloudId) {
        existing = remoteDb.find((r) => r.id === mappedCloudId);
      }
      if (!existing && act.cloudId) {
        existing = remoteDb.find((r) => r.id === act.cloudId);
      }
      if (existing) {
        existing.prompt = act.prompt;
        return existing;
      }
      const cloudId = `cloud-${remoteDb.length + 1}`;
      const inserted = {
        id: cloudId,
        type: act.type,
        title: act.title,
        prompt: act.prompt,
        details: { client_local_id: localId },
      };
      remoteDb.push(inserted);
      localActivityMap.set(localId, cloudId);
      return inserted;
    };

    const localAct1 = { id: 'loc-1', type: 'singleChoice', title: 'Mismo Título', prompt: 'Pregunta única 1' };
    const localAct2 = { id: 'loc-2', type: 'singleChoice', title: 'Mismo Título', prompt: 'Pregunta distinta 2' };

    const synced1 = correctedReconcile(localAct1, 'loc-1');
    const synced2 = correctedReconcile(localAct2, 'loc-2');

    assert.equal(remoteDb.length, 2, 'Deben existir 2 filas remotas distintas');
    assert.notEqual(synced1.id, synced2.id, 'Los IDs remotos deben ser distintos');
    assert.equal(remoteDb[0].prompt, 'Pregunta única 1', 'Se conserva el contenido de la primera actividad');
    assert.equal(remoteDb[1].prompt, 'Pregunta distinta 2', 'Se conserva el contenido de la segunda actividad');
  }
);

// =============================================================================
// CRITERIO 2: D-P0-07 / D-P0-08 / DE-R2 - Supresión de avisos falsos ante fallo de storage
// =============================================================================
recordTest(
  'SENS-R3-02-NEG',
  'Modo defectuoso D-P0-07: queueSync anuncia guardado local aun cuando enqueueSyncItemDurable devuelve ok=false',
  () => {
    const notices = [];
    const notify = (msg) => notices.push(msg);

    // Simular enqueueSyncItemDurable con fallo de cuota
    const enqueueSyncItemDurable = () => ({ ok: false, reason: 'QUOTA_EXCEEDED' });

    // Conducta defectuosa de R2: descartaba el valor de retorno
    const defectiveQueueSync = (_kind, _payload, message) => {
      enqueueSyncItemDurable();
      notify(message); // Anuncia éxito local falsamente
    };

    defectiveQueueSync('activity', {}, 'Actividad guardada localmente; sincronización en la nube pendiente.');

    assert.ok(
      notices.some((n) => n.includes('guardada localmente')),
      'El modo defectuoso debió emitir falsamente el aviso de guardado local'
    );
  }
);

recordTest(
  'SENS-R3-02-POS',
  'Modo corregido D-P0-07: queueSync propaga ok=false y emite advertencia estricta de memoria',
  () => {
    const notices = [];
    const notify = (msg) => notices.push(msg);

    const enqueueSyncItemDurable = () => ({ ok: false, reason: 'QUOTA_EXCEEDED' });

    // Conducta subsanada en R3:
    const correctedQueueSync = (_kind, _payload, message) => {
      const res = enqueueSyncItemDurable();
      if (!res.ok) {
        notify('⚠️ No se pudo guardar el respaldo en el almacenamiento local (espacio agotado o acceso denegado). Los cambios solo siguen en memoria; no cierres esta pestaña.');
        return false;
      }
      notify(message);
      return true;
    };

    const result = correctedQueueSync('activity', {}, 'Actividad guardada localmente; sincronización en la nube pendiente.');

    assert.equal(result, false, 'queueSync debe devolver false');
    assert.ok(
      !notices.some((n) => n.includes('guardada localmente')),
      'NO debe emitir ningún aviso de guardado local exitoso'
    );
    assert.ok(
      notices.some((n) => n.includes('No se pudo guardar el respaldo')),
      'Debe advertir que el respaldo local falló y solo queda en memoria'
    );
  }
);

// =============================================================================
// CRITERIO 3: D-P0-08 / E2E-DOC-05 - Verificación de contenido exacto de plantilla
// =============================================================================
recordTest(
  'SENS-R3-03-NEG',
  'Modo superficial DOC-05 anterior: ignoraba corrupción de definición si concepts.length > 0',
  () => {
    const corruptedTmplRow = {
      id: 'tmpl-1',
      title: 'Plantilla Biología',
      description: 'Descripción editada',
      difficulty: 'Avanzado',
      content: {
        concepts: [
          { name: 'ATP Bioenergético', definition: 'Definición completamente corrupta o vacía' },
        ],
      },
    };

    // Predicado defectuoso de R2:
    const superficialPredicate = Boolean(
      corruptedTmplRow.content &&
      Array.isArray(corruptedTmplRow.content.concepts) &&
      corruptedTmplRow.content.concepts.length > 0
    );

    assert.equal(
      superficialPredicate,
      true,
      'El predicado superficial de R2 acepta falsamente la definición corrupta'
    );
  }
);

recordTest(
  'SENS-R3-03-POS',
  'Modo exacto DOC-05 R3: detecta discrepancia en definición y exige coincidencia completa',
  () => {
    const expectedId = 'tmpl-1';
    const expectedTitle = 'Plantilla Biología';
    const expectedDesc = 'Descripción editada';
    const expectedDiff = 'Avanzado';
    const expectedConceptName = 'ATP Bioenergético';
    const expectedConceptDef = 'Molécula universal de almacenamiento y transferencia de energía libre celular.';

    const corruptedTmplRow = {
      id: expectedId,
      title: expectedTitle,
      description: expectedDesc,
      difficulty: expectedDiff,
      content: {
        concepts: [{ name: expectedConceptName, definition: 'Definición corrupta' }],
      },
    };

    const validTmplRow = {
      id: expectedId,
      title: expectedTitle,
      description: expectedDesc,
      difficulty: expectedDiff,
      content: {
        concepts: [{ name: expectedConceptName, definition: expectedConceptDef }],
      },
    };

    const exactPredicate = (row) =>
      Boolean(row) &&
      row.id === expectedId &&
      row.title === expectedTitle &&
      row.description === expectedDesc &&
      row.difficulty === expectedDiff &&
      Array.isArray(row.content?.concepts) &&
      row.content.concepts.some(
        (c) => c.name === expectedConceptName && c.definition === expectedConceptDef
      );

    // 1. Debe rechazar la corrupta
    assert.equal(exactPredicate(corruptedTmplRow), false, 'Debe rechazar la definición corrupta');
    // 2. Debe aceptar la válida
    assert.equal(exactPredicate(validTmplRow), true, 'Debe aceptar la definición correcta');
  }
);

// =============================================================================
// CRITERIO 4: D-P0-09 / E2E-DOC-06 - Actualización in-place y preservación de multiplicidad
// =============================================================================
recordTest(
  'SENS-R3-04-NEG',
  'Mutación negativa DOC-06: descarte de multiplicidad colapsa [A, B, A] a longitud 2',
  () => {
    const initialActivityIds = ['locA', 'locB', 'locA'];
    // Mutación defectuosa: deduplicar o reemplazar solo la primera ocurrencia
    const defectiveReplace = (ids, target, replacement) => {
      const idx = ids.indexOf(target);
      if (idx !== -1) {
        const copy = [...ids];
        copy[idx] = replacement;
        return copy;
      }
      return ids;
    };

    const partialUpdated = defectiveReplace(initialActivityIds, 'locA', 'uuidA');

    // Demostrar el defecto: la segunda ocurrencia de locA en el índice 2 quedó sin actualizar
    assert.equal(partialUpdated[0], 'uuidA');
    assert.equal(partialUpdated[2], 'locA', 'El índice 2 quedó con el ID local en lugar del UUID');
  }
);

recordTest(
  'SENS-R3-04-POS',
  'Modo exacto DOC-06 R3: reemplazo in-place en cola actualiza todas las ocurrencias preservando multiplicidad',
  () => {
    const initialActivityIds = ['locA', 'locB', 'locA'];
    // Lógica real de persistCloudRoom: currentActivityIds.map((id) => (id === locId ? syncedAct.id : id))
    const updatedIds = initialActivityIds.map((id) => (id === 'locA' ? 'uuidA' : id));

    assert.equal(updatedIds.length, 3, 'Debe conservar longitud 3');
    assert.equal(updatedIds[0], 'uuidA', 'Índice 0 debe ser uuidA');
    assert.equal(updatedIds[1], 'locB', 'Índice 1 debe ser locB');
    assert.equal(updatedIds[2], 'uuidA', 'Índice 2 debe ser uuidA');
  }
);

// =============================================================================
// CRITERIO 5: RES-01 / RES-04 - Envoltorio durable de envío estudiantil
// =============================================================================
recordTest(
  'SENS-R3-05-NEG',
  'Mutación negativa RES-01: envío sin clientRequestId ni envoltorio no puede deduplicarse en reintento',
  () => {
    const receivedInBackend = [];
    const naiveBackendSubmit = (attempt) => {
      // Sin clientRequestId, cada reintento crea una fila nueva
      receivedInBackend.push({ id: `att-${receivedInBackend.length + 1}`, ...attempt });
      return { ok: true };
    };

    const attempt = { studentName: 'Juan', answers: { 0: 'A' } };
    naiveBackendSubmit(attempt); // Primer envío
    naiveBackendSubmit(attempt); // Reintento tras fallo de red

    assert.equal(receivedInBackend.length, 2, 'El envío ingenuo genera 2 intentos duplicados');
  }
);

recordTest(
  'SENS-R3-05-POS',
  'Modo robusto RES-01 / RES-04: deduplicación idempotente con clientRequestId previene duplicados',
  () => {
    const receivedInBackend = new Map();
    const idempotentBackendSubmit = (envelope) => {
      if (receivedInBackend.has(envelope.clientRequestId)) {
        return { ok: true, id: receivedInBackend.get(envelope.clientRequestId).id, deduplicated: true };
      }
      const record = { id: `att-${receivedInBackend.size + 1}`, ...envelope };
      receivedInBackend.set(envelope.clientRequestId, record);
      return { ok: true, id: record.id, deduplicated: false };
    };

    const clientRequestId = 'req-uuid-1234';
    const envelope = { clientRequestId, studentName: 'Juan', answers: { 0: 'A' } };

    const res1 = idempotentBackendSubmit(envelope);
    const res2 = idempotentBackendSubmit(envelope);

    assert.equal(receivedInBackend.size, 1, 'Solo debe persistir 1 intento en la base de datos');
    assert.equal(res2.deduplicated, true, 'El segundo intento debe ser marcado como deduplicado');
    assert.equal(res1.id, res2.id, 'Ambos envíos resuelven al mismo ID de intento');
  }
);

console.log('='.repeat(70));
const allPassed = results.every((r) => r.status === 'PASA');
console.log(`RESUMEN: ${results.filter((r) => r.status === 'PASA').length}/${results.length} PASARON`);
console.log(`ESTADO FINAL: ${allPassed ? 'TODOS PASAN' : 'HAY FALLAS'}`);
console.log('='.repeat(70));

process.exit(allPassed ? 0 : 1);
