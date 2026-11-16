import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RC_CONFIG, REPO_ROOT } from './config/rc.config.mjs';
import { runSqlRolloutAndRollbackSuite } from './sql/verify_rollout_and_rollback.mjs';
import { runAuthRlsAndNatSuite } from './seguridad/verify_auth_rls_and_nat.mjs';
import { runUiE2eChromiumSuite, redactSensitiveData } from './e2e/verify_ui_e2e_chromium.mjs';
import { runFaseFgDeepSuite } from './fase_fg/verify_fase_fg_deep.mjs';

const startScript = path.join(REPO_ROOT, 'tests/integracion/env/start_env.sh');
const stopScript = path.join(REPO_ROOT, 'tests/integracion/env/stop_env.sh');

async function main() {
  console.log('================================================================================');
  console.log('LAB-RC-002 / LAB-FG-001 · EJECUCIÓN INTEGRADA REAL EN ENTORNO AISLADO');
  console.log('================================================================================');

  execFileSync('bash', [startScript], { stdio: 'inherit' });

  try {
    console.log('\n[1/4] Ejecutando suite SQL (Rollout, Duplicados Históricos y Ensayo de Reversión No Destructiva)...');
    const sqlResults = await runSqlRolloutAndRollbackSuite();
    for (const r of sqlResults) {
      console.log(`  - ${r.id}: ${r.status} · ${r.title}`);
    }

    console.log('\n[2/4] Ejecutando suite Seguridad, Privilegios SQL/RLS, Admin y NAT Escolar...');
    const secResults = await runAuthRlsAndNatSuite();
    for (const r of secResults) {
      console.log(`  - ${r.id}: ${r.status} · ${r.title}`);
    }

    console.log('\n[3/4] Ejecutando suite E2E Chromium (Docente, Estudiante 13 Tipos, Resiliencia y Cliente)...');
    const e2eResults = await runUiE2eChromiumSuite();
    for (const r of e2eResults) {
      console.log(`  - ${r.id}: ${r.status} · ${r.title}`);
    }

    console.log('\n[4/4] Ejecutando suite Fase FG Deep (Concurrencia Cupos, Pausa/Reactivación, CSV y PDF Carta)...');
    const fgResults = await runFaseFgDeepSuite();
    for (const r of fgResults) {
      console.log(`  - ${r.id}: ${r.status} · ${r.title}`);
    }

    const allResults = [...sqlResults, ...secResults, ...e2eResults, ...fgResults];
    const counts = {
      total: allResults.length,
      PASA: allResults.filter((x) => x.status === 'PASA').length,
      FALLA_PRODUCTO: allResults.filter((x) => x.status === 'FALLA_PRODUCTO').length,
      ERROR_ARNES: allResults.filter((x) => x.status === 'ERROR_ARNES').length,
      BLOQUEADO: allResults.filter((x) => x.status === 'BLOQUEADO').length,
      NO_APLICA_JUSTIFICADO: allResults.filter((x) => x.status === 'NO_APLICA_JUSTIFICADO').length,
    };

    const summary = {
      rcId: RC_CONFIG.rcId,
      executedAt: new Date().toISOString(),
      counts,
      results: allResults,
    };
    const summaryPath = path.join(RC_CONFIG.evidenciasDir, 'rc_master_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(redactSensitiveData(summary), null, 2));
    console.log('\nRESUMEN CONSOLIDADO LAB-RC-002:', JSON.stringify(counts));
  } finally {
    execFileSync('bash', [stopScript], { stdio: 'inherit' });
  }
}

main().catch((err) => {
  console.error('Error en run_rc_suite:', err);
  try {
    execFileSync('bash', [stopScript], { stdio: 'inherit' });
  } catch {
    // ignorar
  }
  process.exit(1);
});
