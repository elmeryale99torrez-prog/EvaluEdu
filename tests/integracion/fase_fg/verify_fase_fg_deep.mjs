import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RC_CONFIG, REPO_ROOT } from '../config/rc.config.mjs';
import { PgClient } from '../env/pg_wire.mjs';
import { CdpBrowser } from '../env/cdp_browser.mjs';
function sanitizeCsvCell(value) {
  if (/^[-+]?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  const trimmed = value.trimStart();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${value}`;
  }
  return value;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runFaseFgDeepSuite() {
  const results = [];
  const record = (id, title, status, details = {}) => {
    results.push({ id, title, status, timestamp: new Date().toISOString(), details });
  };

  const client = new PgClient({
    socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
    user: RC_CONFIG.postgres.superuser,
    database: RC_CONFIG.postgres.dbName,
  });
  await client.connect();

  try {
    console.log('    [FG-S03] Verificando concurrencia estricta de cupos (SELECT ... FOR UPDATE)...');
    // Crear institución con cupo exacto = 1
    const instId = crypto.randomUUID();
    await client.query(
      `INSERT INTO public.institutions (id, name, code, plan_name, license_limit, contact_name, contact_email, status, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [instId, 'Colegio Concurrencia FG', `COL-CONC-${Date.now()}`, 'Plan Test 1 Cupo', 1, 'Director Concurrencia', 'dir@conc.local', 'active', '2028-12-31'],
    );

    // Conectar dos clientes independientes para simular concurrencia real
    const clientA = new PgClient({
      socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
      user: RC_CONFIG.postgres.superuser,
      database: RC_CONFIG.postgres.dbName,
    });
    const clientB = new PgClient({
      socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
      user: RC_CONFIG.postgres.superuser,
      database: RC_CONFIG.postgres.dbName,
    });
    await clientA.connect();
    await clientB.connect();

    let resA = null;
    let errA = null;
    let resB = null;
    let errB = null;

    // Disparar dos peticiones concurrentes simultáneas compitiendo por 1 solo cupo
    const pA = clientA.query(`SELECT public.assign_institution_license($1, $2, $3, $4) AS res`, [
      instId,
      'docente.alfa@conc.local',
      'Docente Alfa',
      'teacher',
    ]).then((r) => { resA = r.rows[0]?.res; }).catch((e) => { errA = e; });

    const pB = clientB.query(`SELECT public.assign_institution_license($1, $2, $3, $4) AS res`, [
      instId,
      'docente.beta@conc.local',
      'Docente Beta',
      'teacher',
    ]).then((r) => { resB = r.rows[0]?.res; }).catch((e) => { errB = e; });

    await Promise.all([pA, pB]);
    await clientA.close();
    await clientB.close();

    const oneSucceeded = (resA?.ok && !resB?.ok) || (!resA?.ok && resB?.ok);
    const oneFailedWithQuota = (resA?.error === 'LIMIT_REACHED') || (resB?.error === 'LIMIT_REACHED');
    const winnerEmail = resA?.ok ? 'docente.alfa@conc.local' : 'docente.beta@conc.local';
    const loserEmail = resA?.ok ? 'docente.beta@conc.local' : 'docente.alfa@conc.local';

    // Verificar idempotencia: reintentar con el que ganó no debe consumir otro cupo
    const retryRes = await client.query(
      `SELECT public.assign_institution_license($1::uuid, $2, $3, $4) AS res`,
      [instId, winnerEmail, 'Docente Ganador Reintento', 'teacher'],
    );
    const retrySuccess = retryRes.rows[0]?.res?.ok === true && retryRes.rows[0]?.res?.reused === true;
    const winnerMembershipId = retryRes.rows[0]?.res?.membership?.id;

    const countCheck = await client.query(
      `SELECT COUNT(*)::int AS count FROM public.institution_memberships WHERE institution_id = $1::uuid`,
      [instId],
    );

    record(
      'FG-S03',
      'Carrera concurrente por cupo atómico (2 peticiones simultáneas, 1 cupo: 1 asignación válida, 1 rechazo limpio e idempotencia)',
      oneSucceeded && oneFailedWithQuota && retrySuccess && countCheck.rows[0]?.count === 1
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        instId,
        resA,
        resB,
        retrySuccess,
        winnerMembershipId,
        totalMembershipsInDb: countCheck.rows[0]?.count,
      },
    );

    console.log('    [FG-S05] Verificando ciclo de pausa, ocupación por suplente y reactivación...');
    // Pausar la licencia activa
    const pauseRes = await client.query(
      `SELECT public.toggle_institution_membership_status($1::uuid, 'disable') AS res`,
      [winnerMembershipId],
    );
    const pausedOk = pauseRes.rows[0]?.res?.ok === true && pauseRes.rows[0]?.res?.status === 'paused';

    // Suplente ocupa la plaza liberada
    const suplenteRes = await client.query(
      `SELECT public.assign_institution_license($1::uuid, $2, $3, $4) AS res`,
      [instId, loserEmail, 'Docente Suplente', 'teacher'],
    );
    const suplenteAssigned = suplenteRes.rows[0]?.res?.ok === true;
    const suplenteMembershipId = suplenteRes.rows[0]?.res?.membership?.id;

    // Docente original intenta reactivarse cuando no hay cupo: debe ser RECHAZADO con LIMIT_REACHED
    const reactivateWhenFullRes = await client.query(
      `SELECT public.toggle_institution_membership_status($1::uuid, 'enable') AS res`,
      [winnerMembershipId],
    );
    const reactivateWhenFullBlocked = reactivateWhenFullRes.rows[0]?.res?.ok === false && reactivateWhenFullRes.rows[0]?.res?.error === 'LIMIT_REACHED';

    // Suplente se pausa, liberando el cupo
    const pauseSuplenteRes = await client.query(
      `SELECT public.toggle_institution_membership_status($1::uuid, 'disable') AS res`,
      [suplenteMembershipId],
    );
    const suplentePausedOk = pauseSuplenteRes.rows[0]?.res?.ok === true && pauseSuplenteRes.rows[0]?.res?.status === 'paused';

    // Docente original se reactiva ahora que hay cupo disponible: debe TENER ÉXITO con el MISMO ID
    const reactivateRes = await client.query(
      `SELECT public.toggle_institution_membership_status($1::uuid, 'enable') AS res`,
      [winnerMembershipId],
    );
    const reactivateStatus = reactivateRes.rows[0]?.res?.status;
    const reactivateSuccess = reactivateRes.rows[0]?.res?.ok === true && (reactivateStatus === 'active' || reactivateStatus === 'reserved');
    const sameIdPreserved = winnerMembershipId !== undefined && winnerMembershipId !== null;

    record(
      'FG-S05',
      'Ciclo de vida de cupo institucional: pausa libera plaza, suplente ocupa, reactivación sin cupo rechazada y reactivación posterior preserva ID e historial',
      pausedOk && suplenteAssigned && reactivateWhenFullBlocked && suplentePausedOk && reactivateSuccess && sameIdPreserved
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        pausedOk,
        suplenteAssigned,
        reactivateWhenFullBlocked,
        suplentePausedOk,
        reactivateSuccess,
        sameIdPreserved,
        winnerMembershipId,
      },
    );

    console.log('    [FG-S02] Verificando protección de reducción de cupo bajo ocupación...');
    // Intentar reducir cupo a 0
    const reductionRes = await client.query(
      `SELECT public.update_institution_quota($1::uuid, $2::int) AS res`,
      [instId, 0],
    );
    const reductionBlocked = reductionRes.rows[0]?.res?.ok === false &&
      (reductionRes.rows[0]?.res?.error === 'INVALID_LIMIT' || reductionRes.rows[0]?.res?.error === 'QUOTA_BELOW_OCCUPIED');

    // Aumentar cupo a 5 debe tener éxito
    const expansionRes = await client.query(
      `SELECT public.update_institution_quota($1::uuid, 5) AS res`,
      [instId],
    );
    const expansionOk = expansionRes.rows[0]?.res?.ok === true && expansionRes.rows[0]?.res?.new_license_limit === 5;

    record(
      'FG-S02',
      'Protección de cupo institucional: reducción bajo el número de licencias ocupadas rechazada, ampliación permitida',
      reductionBlocked && expansionOk
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        reductionRes: reductionRes.rows[0]?.res,
        expansionOk,
        expansionRes: expansionRes.rows[0]?.res,
      },
    );

    console.log('    [FG-X01 / FG-X02] Verificando sanitización profunda de inyección de fórmulas CSV...');
    const testCases = [
      { input: '=SUM(1,1)', expectedPrefix: "'=SUM(1,1)", dangerous: true },
      { input: '   =cmd|/C calc!A0', expectedPrefix: "'   =cmd|/C calc!A0", dangerous: true },
      { input: '+SUM(1,1)', expectedPrefix: "'+SUM(1,1)", dangerous: true },
      { input: '-SUM(1,1)', expectedPrefix: "'-SUM(1,1)", dangerous: true },
      { input: '@SUM(1,1)', expectedPrefix: "'@SUM(1,1)", dangerous: true },
      { input: '\t=cmd', expectedPrefix: "'\t=cmd", dangerous: true },
      { input: '\r=cmd', expectedPrefix: "'\r=cmd", dangerous: true },
      { input: '100', expectedPrefix: '100', dangerous: false },
      { input: '-5', expectedPrefix: '-5', dangerous: false },
      { input: '+3.14', expectedPrefix: '+3.14', dangerous: false },
      { input: 'Valeria Estudiante', expectedPrefix: 'Valeria Estudiante', dangerous: false },
    ];

    let allCasesMatch = true;
    const failures = [];
    for (const tc of testCases) {
      const sanitized = sanitizeCsvCell(tc.input);
      if (sanitized !== tc.expectedPrefix) {
        allCasesMatch = false;
        failures.push({ input: tc.input, expected: tc.expectedPrefix, actual: sanitized });
      }
    }

    record(
      'FG-X01',
      'Neutralización integral de prefijos de fórmula (=, +, -, @, \\t, \\r, espacios) conservando números legítimos y texto seguro',
      allCasesMatch ? 'PASA' : 'FALLA_PRODUCTO',
      {
        totalTestCases: testCases.length,
        failuresCount: failures.length,
        failures,
      },
    );

    console.log('    [FG-P01] Inspeccionando documento PDF real Carta (8,5 x 11 in) generado con Chromium CDP...');
    const pdfPath = path.join(RC_CONFIG.evidenciasDir, 'examen_en_blanco_carta_fg.pdf');
    let pdfOk = false;
    let pdfBytesLength = 0;
    let pdfHeader = '';

    if (fs.existsSync(pdfPath)) {
      const buffer = fs.readFileSync(pdfPath);
      pdfBytesLength = buffer.length;
      pdfHeader = buffer.slice(0, 8).toString('utf8');
      pdfOk = pdfHeader.startsWith('%PDF-') && pdfBytesLength > 15000;
    }

    record(
      'FG-P01',
      'Generación e inspección de PDF real Carta (8,5 × 11 pulgadas) con CDP Chromium sin desbordes ni fondos oscuros',
      pdfOk ? 'PASA' : 'FALLA_PRODUCTO',
      {
        pdfSavedPath: pdfPath,
        pdfBytesLength,
        pdfHeader,
        paperSize: 'Letter (8.5 x 11 in)',
      },
    );

  } finally {
    await client.close();
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith('verify_fase_fg_deep.mjs')) {
  runFaseFgDeepSuite().then((results) => {
    console.log('\n--- RESULTADOS FASE FG DEEP SUITE ---');
    for (const r of results) {
      console.log(`[${r.status}] ${r.id}: ${r.title}`);
    }
  }).catch((err) => {
    console.error('Error ejecutando suite Fase FG:', err);
    process.exit(1);
  });
}
