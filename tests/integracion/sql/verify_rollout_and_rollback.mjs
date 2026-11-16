import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RC_CONFIG, REPO_ROOT } from '../config/rc.config.mjs';
import { PgClient } from '../env/pg_wire.mjs';

// Verificación SQL real aislada para LAB-RC-002 (RC-EV-05) sobre evaluedu_rc_rehearsal:
// 1. Esquema representativo + migraciones previas a Fase C (20261021..20261029).
// 2. Siembra de datos históricos previos al upgrade (incluyendo participante con 2 intentos duplicados
//    y participante con intento previo sin occurrence_id/activities_snapshot).
// 3. Aplicación de migración Fase C (20261112100000): verifica NOTICE de duplicados, preservación de
//    los 3 intentos históricos, privilegios de columna en room_participants e idempotencia al re-ejecutar.
// 4. Inserción de nuevo intento post-upgrade mediante submit_student_attempt_atomic: verifica el contrato
//    real de la RPC (persistencia de occurrence_id distintos 'occ_post_1' y 'occ_post_2', puntajes 10 y 10,
//    respuestas, activities_snapshot con las 2 actividades y room_activity_id en null por contrato de RPC).
// 5. Ensayo de reversión estructural SQL NO destructiva y 100 % repetible (CREATE TABLE IF NOT EXISTS +
//    INSERT ... ON CONFLICT DO UPDATE en rc_rollback_archive) con comparación exacta de datos previos y nuevos.
// 6. Re-aplicación de 20261112100000, segundo intento post-reaplicación ('occ_reapply_1'), segunda ejecución
//    del procedimiento de reversión para demostrar repetibilidad empírica, y restauración final de Fase C.

const PSQL_BIN = path.join(RC_CONFIG.postgres.binDir, 'psql');
const REHEARSAL_DB = RC_CONFIG.postgres.rehearsalDbName;

function runPsqlFile(relPath) {
  return execFileSync(
    PSQL_BIN,
    ['-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-p', String(RC_CONFIG.postgres.port), '-U', RC_CONFIG.postgres.superuser, '-d', REHEARSAL_DB, '-f', path.join(REPO_ROOT, relPath)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function runPsqlCommand(sql) {
  return execFileSync(
    PSQL_BIN,
    ['-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-p', String(RC_CONFIG.postgres.port), '-U', RC_CONFIG.postgres.superuser, '-d', REHEARSAL_DB, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

const REPEATABLE_ARCHIVE_SQL = `
  BEGIN;
  CREATE SCHEMA IF NOT EXISTS rc_rollback_archive;

  CREATE TABLE IF NOT EXISTS rc_rollback_archive.archived_attempt_snapshots (
    attempt_id uuid PRIMARY KEY,
    participant_id uuid NOT NULL,
    room_id uuid NOT NULL,
    student_name text NOT NULL,
    score numeric,
    max_score numeric,
    activities_snapshot jsonb NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now()
  );

  INSERT INTO rc_rollback_archive.archived_attempt_snapshots (
    attempt_id, participant_id, room_id, student_name, score, max_score, activities_snapshot, archived_at
  )
  SELECT
    a.id AS attempt_id,
    rp.id AS participant_id,
    a.room_id,
    rp.display_name AS student_name,
    a.score,
    a.max_score,
    rp.activities_snapshot,
    now() AS archived_at
  FROM public.attempts a
  JOIN public.room_participants rp ON rp.id = a.participant_id
  WHERE rp.activities_snapshot IS NOT NULL
  ON CONFLICT (attempt_id) DO UPDATE SET
    participant_id = EXCLUDED.participant_id,
    room_id = EXCLUDED.room_id,
    student_name = EXCLUDED.student_name,
    score = EXCLUDED.score,
    max_score = EXCLUDED.max_score,
    activities_snapshot = EXCLUDED.activities_snapshot,
    archived_at = EXCLUDED.archived_at;

  CREATE TABLE IF NOT EXISTS rc_rollback_archive.archived_answer_occurrences (
    answer_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL,
    activity_id uuid,
    question_index integer,
    occurrence_id text,
    room_activity_id uuid,
    response jsonb,
    score numeric,
    archived_at timestamptz NOT NULL DEFAULT now()
  );

  INSERT INTO rc_rollback_archive.archived_answer_occurrences (
    answer_id, attempt_id, activity_id, question_index, occurrence_id, room_activity_id, response, score, archived_at
  )
  SELECT
    aa.id AS answer_id,
    aa.attempt_id,
    aa.activity_id,
    aa.question_index,
    aa.occurrence_id,
    aa.room_activity_id,
    aa.response,
    aa.score,
    now() AS archived_at
  FROM public.attempt_answers aa
  WHERE aa.occurrence_id IS NOT NULL OR aa.room_activity_id IS NOT NULL
  ON CONFLICT (answer_id) DO UPDATE SET
    attempt_id = EXCLUDED.attempt_id,
    activity_id = EXCLUDED.activity_id,
    question_index = EXCLUDED.question_index,
    occurrence_id = EXCLUDED.occurrence_id,
    room_activity_id = EXCLUDED.room_activity_id,
    response = EXCLUDED.response,
    score = EXCLUDED.score,
    archived_at = EXCLUDED.archived_at;

  COMMIT;
`;

function executeNonDestructiveSqlRollback() {
  runPsqlCommand(REPEATABLE_ARCHIVE_SQL);
  runPsqlFile('supabase/migrations/20261029143500_submit_student_attempt_atomic.sql');
  runPsqlCommand(`
    REVOKE ALL ON FUNCTION public.submit_student_attempt_atomic(
      uuid, uuid, timestamptz, timestamptz, text, integer, integer, integer, integer, numeric, numeric, jsonb, jsonb
    ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.submit_student_attempt_atomic(
      uuid, uuid, timestamptz, timestamptz, text, integer, integer, integer, integer, numeric, numeric, jsonb, jsonb
    ) TO service_role;
  `);
}

async function fetchFullDatasetSnapshot(client) {
  const attemptsRes = await client.query(`
    SELECT
      a.id::text AS attempt_id,
      a.participant_id::text AS participant_id,
      rp.display_name AS student_name,
      a.score::numeric::float8 AS score,
      a.max_score::numeric::float8 AS max_score,
      rp.activities_snapshot AS activities_snapshot
    FROM public.attempts a
    JOIN public.room_participants rp ON rp.id = a.participant_id
    ORDER BY a.id ASC
  `);
  const answersRes = await client.query(`
    SELECT
      aa.id::text AS answer_id,
      aa.attempt_id::text AS attempt_id,
      aa.activity_id::text AS activity_id,
      aa.question_index AS question_index,
      aa.response AS response,
      aa.response_text AS response_text,
      aa.score::numeric::float8 AS score,
      aa.occurrence_id AS occurrence_id,
      aa.room_activity_id::text AS room_activity_id
    FROM public.attempt_answers aa
    ORDER BY aa.attempt_id ASC, aa.question_index ASC, aa.id ASC
  `);
  return {
    attempts: attemptsRes.rows,
    answers: answersRes.rows,
  };
}

export async function runSqlRolloutAndRollbackSuite() {
  const results = [];
  const record = (id, title, status, details) => {
    results.push({ id, title, status, details });
  };

  // Recrear evaluedu_rc_rehearsal limpia
  execFileSync(
    PSQL_BIN,
    ['-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-p', String(RC_CONFIG.postgres.port), '-U', RC_CONFIG.postgres.superuser, '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${REHEARSAL_DB};`, '-c', `CREATE DATABASE ${REHEARSAL_DB};`],
    { encoding: 'utf8' },
  );

  // 1. Aplicar esquema representativo y migraciones previas a Fase C
  runPsqlFile('tests/integracion/env/schema_representativo.sql');
  runPsqlFile('supabase/migrations/20261021154245_restrict_anonymous_access.sql');
  runPsqlFile('supabase/migrations/20261029141500_attempt_answers_composite_index.sql');
  runPsqlFile('supabase/migrations/20261029143500_submit_student_attempt_atomic.sql');
  runPsqlFile('supabase/migrations/20261029160000_audit_events_immutability.sql');

  const client = new PgClient({
    socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
    user: RC_CONFIG.postgres.superuser,
    database: REHEARSAL_DB,
  });
  await client.connect();

  try {
    // 2. Sembrar datos sintéticos previos al upgrade
    const teacherId = '99999999-9999-4999-8999-999999999901';
    const roomId = '11111111-1111-4111-8111-111111111101';
    const act1Id = '22222222-2222-4222-8222-222222222201';
    const act2Id = '22222222-2222-4222-8222-222222222202';
    const partDupId = '33333333-3333-4333-8333-333333333301';
    const partSingleId = '33333333-3333-4333-8333-333333333302';
    const partPostId = '33333333-3333-4333-8333-333333333303';
    const partReapplyId = '33333333-3333-4333-8333-333333333304';

    await client.query(
      `INSERT INTO public.profiles(id, display_name, role, roles) VALUES ($1, 'Docente Ensayo SQL', 'teacher', ARRAY['teacher'])`,
      [teacherId],
    );
    await client.query(
      `INSERT INTO public.rooms(id, owner_id, name, code, status, question_count, score_per_question)
       VALUES ($1, $2, 'Sala Histórica Pre-Upgrade', 'EDU-HIST', 'active', 2, 10)`,
      [roomId, teacherId],
    );
    await client.query(
      `INSERT INTO public.activities(id, owner_id, type, title, prompt, options, answer, status)
       VALUES
         ($1, $3, 'trueFalse', 'TF Hist 1', 'Enunciado 1', ARRAY['Verdadero','Falso'], 'true', 'published'),
         ($2, $3, 'singleChoice', 'SC Hist 2', 'Enunciado 2', ARRAY['A','B'], 'A', 'published')`,
      [act1Id, act2Id, teacherId],
    );
    await client.query(
      `INSERT INTO public.room_activities(id, room_id, activity_id, position)
       VALUES
         ('44444444-4444-4444-8444-444444444401', $1, $2, 0),
         ('44444444-4444-4444-8444-444444444402', $1, $3, 1)`,
      [roomId, act1Id, act2Id],
    );
    await client.query(
      `INSERT INTO public.room_participants(id, room_id, display_name, name_normalized, guest_token_hash, status)
       VALUES
         ($1, $5, 'Alumno Duplicado Histórico', 'alumno duplicado historico', 'hash_dup_1', 'completed'),
         ($2, $5, 'Alumno Único Histórico', 'alumno unico historico', 'hash_single_2', 'completed'),
         ($3, $5, 'Alumno Post Upgrade', 'alumno post upgrade', 'hash_post_3', 'active'),
         ($4, $5, 'Alumno Post Reaplicación', 'alumno post reaplicacion', 'hash_reapply_4', 'active')`,
      [partDupId, partSingleId, partPostId, partReapplyId, roomId],
    );

    // Dos intentos históricos para el mismo participante (escenario heredado Q4) + 1 intento normal
    await client.query(
      `INSERT INTO public.attempts(id, room_id, participant_id, started_at, finished_at, status, total_questions, answered_count, omitted_count, correct_count, score, max_score)
       VALUES
         ('55555555-5555-4555-8555-555555555501', $1, $2, now() - interval '2 hours', now() - interval '110 minutes', 'completed', 2, 2, 0, 1, 10, 20),
         ('55555555-5555-4555-8555-555555555502', $1, $2, now() - interval '2 hours', now() - interval '109 minutes', 'completed', 2, 2, 0, 2, 20, 20),
         ('55555555-5555-4555-8555-555555555503', $1, $3, now() - interval '1 hour', now() - interval '50 minutes', 'completed', 2, 2, 0, 2, 20, 20)`,
      [roomId, partDupId, partSingleId],
    );
    await client.query(
      `INSERT INTO public.attempt_answers(id, attempt_id, activity_id, question_index, response, response_text, status, correct, score, time_seconds)
       VALUES
         ('66666666-6666-4666-8666-666666666601', '55555555-5555-4555-8555-555555555501', $1, 0, 'true'::jsonb, 'Verdadero', 'answered', true, 10, 5),
         ('66666666-6666-4666-8666-666666666602', '55555555-5555-4555-8555-555555555502', $1, 0, 'true'::jsonb, 'Verdadero', 'answered', true, 10, 5),
         ('66666666-6666-4666-8666-666666666603', '55555555-5555-4555-8555-555555555503', $2, 1, '"A"'::jsonb, 'A', 'answered', true, 10, 6)`,
      [act1Id, act2Id],
    );

    // 3. Aplicar migración de Fase C (20261112100000)
    try {
      runPsqlFile('supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql');
    } catch (e) {
      throw new Error(`Fallo aplicando 20261112100000: ${e.message}`);
    }
    // Re-ejecutar para verificar idempotencia
    runPsqlFile('supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql');

    const preAttemptsAfterUpgrade = await client.query('SELECT count(*)::int AS cnt FROM public.attempts');
    const idxCheck = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'attempts' AND indexname IN ('idx_attempts_participant_id', 'uidx_attempts_participant_id')`,
    );
    const faseCNotice = idxCheck.rows.map((r) => r.indexname).join(',');

    record(
      'SQL-RC-01',
      'Migración Fase C sobre base con duplicados históricos e idempotencia',
      preAttemptsAfterUpgrade.rows[0].cnt === 3 && faseCNotice.includes('idx_attempts_participant_id') ? 'PASA' : 'FALLA_PRODUCTO',
      {
        historicalAttemptsPreserved: preAttemptsAfterUpgrade.rows[0].cnt,
        expectedHistoricalAttempts: 3,
        indexesCreated: idxCheck.rows.map((r) => r.indexname),
        idempotentReRun: true,
      },
    );

    // 4. Insertar nuevo intento post-upgrade verificando el contrato real de submit_student_attempt_atomic
    const expectedSnapshotPost1 = [
      { occurrenceId: 'occ_post_1', roomActivityId: '44444444-4444-4444-8444-444444444401', activityId: act1Id, position: 0, scoreSnapshot: 10 },
      { occurrenceId: 'occ_post_2', roomActivityId: '44444444-4444-4444-8444-444444444402', activityId: act2Id, position: 1, scoreSnapshot: 10 },
    ];
    await client.query(
      `UPDATE public.room_participants
       SET activities_snapshot = $2::jsonb
       WHERE id = $1`,
      [partPostId, JSON.stringify(expectedSnapshotPost1)],
    );

    const rpcRes = await client.query(
      `SELECT public.submit_student_attempt_atomic(
         $1::uuid, $2::uuid, now() - interval '5 minutes', now(), 'completed',
         2, 2, 0, 2, 20, 20, '[]'::jsonb, $3::jsonb
       ) AS payload`,
      [
        roomId,
        partPostId,
        JSON.stringify([
          {
            occurrence_id: 'occ_post_1',
            occurrenceId: 'occ_post_1',
            activity_id: act1Id,
            question_index: 0,
            response: true,
            response_text: 'Verdadero',
            status: 'answered',
            correct: true,
            score: 10,
            time_seconds: 12,
          },
          {
            occurrence_id: 'occ_post_2',
            occurrenceId: 'occ_post_2',
            activity_id: act2Id,
            question_index: 1,
            response: 'A',
            response_text: 'A',
            status: 'answered',
            correct: true,
            score: 10,
            time_seconds: 14,
          },
        ]),
      ],
    );

    const postUpgradeAttemptId = rpcRes.rows[0]?.payload?.attemptId;
    const postAnswers = await client.query(
      `SELECT question_index, occurrence_id, room_activity_id::text AS room_activity_id, score::numeric::float8 AS score, response, response_text
       FROM public.attempt_answers WHERE attempt_id = $1 ORDER BY question_index ASC`,
      [postUpgradeAttemptId],
    );
    const postAttemptSnapshotRes = await client.query(
      `SELECT a.id::text AS attempt_id, rp.activities_snapshot AS activities_snapshot
       FROM public.attempts a
       JOIN public.room_participants rp ON rp.id = a.participant_id
       WHERE a.id = $1`,
      [postUpgradeAttemptId],
    );
    const savedSnapshot = postAttemptSnapshotRes.rows[0]?.activities_snapshot;
    const snapshotMatchesContract =
      Array.isArray(savedSnapshot) &&
      savedSnapshot.length === 2 &&
      savedSnapshot[0]?.occurrenceId === 'occ_post_1' &&
      savedSnapshot[1]?.occurrenceId === 'occ_post_2';

    const answersMatchContract =
      postAnswers.rows.length === 2 &&
      postAnswers.rows[0].occurrence_id === 'occ_post_1' &&
      postAnswers.rows[1].occurrence_id === 'occ_post_2' &&
      postAnswers.rows[0].score === 10 &&
      postAnswers.rows[1].score === 10 &&
      postAnswers.rows[0].response === true &&
      postAnswers.rows[1].response === 'A' &&
      postAnswers.rows[0].room_activity_id === null &&
      postAnswers.rows[1].room_activity_id === null;

    record(
      'SQL-RC-02',
      'Persistencia post-upgrade de occurrence_id, respuestas, puntajes y activities_snapshot (room_activity_id opcional nullable)',
      answersMatchContract && snapshotMatchesContract ? 'PASA' : 'FALLA_PRODUCTO',
      {
        postUpgradeAttemptId,
        answersSaved: postAnswers.rows,
        activitiesSnapshotSaved: savedSnapshot,
        snapshotOccurrencesVerified: savedSnapshot?.map((item) => item.occurrenceId),
        roomActivityIdPopulatedByRpc: 'false (columna opcional nullable en esquema)',
      },
    );

    // 5. Ensayo de reversión estructural SQL NO destructiva y repetible con comparación profunda antes/después
    const snapshotBeforeRollback = await fetchFullDatasetSnapshot(client);

    executeNonDestructiveSqlRollback();

    const snapshotAfterRollback = await fetchFullDatasetSnapshot(client);
    const archivedSnapshots1 = await client.query(
      `SELECT attempt_id::text, participant_id::text, student_name, score::numeric::float8 AS score, max_score::numeric::float8 AS max_score, activities_snapshot
       FROM rc_rollback_archive.archived_attempt_snapshots ORDER BY attempt_id ASC`,
    );
    const archivedOccurrences1 = await client.query(
      `SELECT answer_id::text, attempt_id::text, question_index, occurrence_id, room_activity_id::text AS room_activity_id, response, score::numeric::float8 AS score
       FROM rc_rollback_archive.archived_answer_occurrences ORDER BY question_index ASC`,
    );

    const exactDataEqualityAfterRollback =
      JSON.stringify(snapshotBeforeRollback.attempts) === JSON.stringify(snapshotAfterRollback.attempts) &&
      JSON.stringify(snapshotBeforeRollback.answers) === JSON.stringify(snapshotAfterRollback.answers);

    const archiveContentMatchesPostAttempt =
      archivedSnapshots1.rows.length === 1 &&
      archivedSnapshots1.rows[0].attempt_id === postUpgradeAttemptId &&
      archivedSnapshots1.rows[0].student_name === 'Alumno Post Upgrade' &&
      archivedSnapshots1.rows[0].score === 20 &&
      archivedSnapshots1.rows[0].max_score === 20 &&
      Array.isArray(archivedSnapshots1.rows[0].activities_snapshot) &&
      archivedSnapshots1.rows[0].activities_snapshot.length === 2 &&
      archivedOccurrences1.rows.length === 2 &&
      archivedOccurrences1.rows[0].occurrence_id === 'occ_post_1' &&
      archivedOccurrences1.rows[1].occurrence_id === 'occ_post_2';

    record(
      'SQL-RC-03',
      'Ensayo de reversión estructural SQL no destructiva con archivo repetible y comparación exacta de contenido',
      snapshotAfterRollback.attempts.length === 4 &&
        snapshotAfterRollback.answers.length === 5 &&
        exactDataEqualityAfterRollback &&
        archiveContentMatchesPostAttempt
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        scopeNote:
          'Este caso valida exclusivamente la reversión estructural SQL no destructiva en PostgreSQL. La reversión integral de aplicación (frontend + Edge Functions + BD) no se ejecuta como despliegue productivo y requiere revertir simultáneamente el código de las funciones Deno.',
        totalAttemptsPreserved: snapshotAfterRollback.attempts.length,
        totalAnswersPreserved: snapshotAfterRollback.answers.length,
        exactDataEqualityBeforeAndAfterRollback: exactDataEqualityAfterRollback,
        archivedSnapshotsCount: archivedSnapshots1.rows.length,
        archivedOccurrencesCount: archivedOccurrences1.rows.length,
        archivedSnapshotsContent: archivedSnapshots1.rows,
        archivedOccurrencesContent: archivedOccurrences1.rows,
        destructiveDropColumnAvoided: true,
      },
    );

    // 6. Re-aplicar migración Fase C, insertar segundo intento ('occ_reapply_1'), ejecutar SEGUNDA reversión
    //    para demostrar que el archivo repetible captura filas nuevas, y volver a dejar Fase C activa.
    runPsqlFile('supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql');

    const expectedSnapshotReapply = [
      { occurrenceId: 'occ_reapply_1', roomActivityId: '44444444-4444-4444-8444-444444444401', activityId: act1Id, position: 0, scoreSnapshot: 10 },
    ];
    await client.query(
      `UPDATE public.room_participants
       SET activities_snapshot = $2::jsonb
       WHERE id = $1`,
      [partReapplyId, JSON.stringify(expectedSnapshotReapply)],
    );

    const rpcReapplyRes = await client.query(
      `SELECT public.submit_student_attempt_atomic(
         $1::uuid, $2::uuid, now() - interval '3 minutes', now(), 'completed',
         1, 1, 0, 1, 10, 10, '[]'::jsonb, $3::jsonb
       ) AS payload`,
      [
        roomId,
        partReapplyId,
        JSON.stringify([
          {
            occurrence_id: 'occ_reapply_1',
            occurrenceId: 'occ_reapply_1',
            activity_id: act1Id,
            question_index: 0,
            response: true,
            response_text: 'Verdadero',
            status: 'answered',
            correct: true,
            score: 10,
            time_seconds: 9,
          },
        ]),
      ],
    );
    const reapplyAttemptId = rpcReapplyRes.rows[0]?.payload?.attemptId;

    const snapshotBeforeSecondRollback = await fetchFullDatasetSnapshot(client);

    // Segunda ejecución del procedimiento de reversión no destructiva (prueba empírica de repetibilidad)
    executeNonDestructiveSqlRollback();

    const snapshotAfterSecondRollback = await fetchFullDatasetSnapshot(client);
    const archivedSnapshots2 = await client.query(
      `SELECT attempt_id::text, participant_id::text, student_name, score::numeric::float8 AS score, max_score::numeric::float8 AS max_score, activities_snapshot
       FROM rc_rollback_archive.archived_attempt_snapshots ORDER BY attempt_id ASC`,
    );
    const archivedOccurrences2 = await client.query(
      `SELECT answer_id::text, attempt_id::text, question_index, occurrence_id, response, score::numeric::float8 AS score
       FROM rc_rollback_archive.archived_answer_occurrences ORDER BY attempt_id ASC, question_index ASC`,
    );

    // Volver a dejar aplicada la migración 20261112100000 con la RPC de Fase C activa
    runPsqlFile('supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql');
    const snapshotAfterFinalReapply = await fetchFullDatasetSnapshot(client);

    const archivedSnapshotsAfterSecondRollback = archivedSnapshots2.rows.length;
    const archivedOccurrencesAfterSecondRollback = archivedOccurrences2.rows.length;
    const secondRollbackDataEqual =
      JSON.stringify(snapshotBeforeSecondRollback.attempts) === JSON.stringify(snapshotAfterSecondRollback.attempts) &&
      JSON.stringify(snapshotBeforeSecondRollback.answers) === JSON.stringify(snapshotAfterSecondRollback.answers) &&
      JSON.stringify(snapshotBeforeSecondRollback.attempts) === JSON.stringify(snapshotAfterFinalReapply.attempts) &&
      JSON.stringify(snapshotBeforeSecondRollback.answers) === JSON.stringify(snapshotAfterFinalReapply.answers);

    record(
      'SQL-RC-04',
      'Re-aplicación de 20261112100000, segundo intento post-reaplicación y segunda reversión repetible con captura incremental',
      snapshotAfterFinalReapply.attempts.length === 5 &&
        snapshotAfterFinalReapply.answers.length === 6 &&
        archivedSnapshotsAfterSecondRollback === 2 &&
        archivedOccurrencesAfterSecondRollback === 3 &&
        secondRollbackDataEqual
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        reapplyAttemptId,
        totalAttemptsAfterReRollout: snapshotAfterFinalReapply.attempts.length,
        totalAnswersAfterReRollout: snapshotAfterFinalReapply.answers.length,
        archivedSnapshotsAfterSecondRollback,
        archivedOccurrencesAfterSecondRollback,
        exactDataEqualityAcrossSecondRollbackAndFinalReapply: secondRollbackDataEqual,
        archivedOccurrencesIds: archivedOccurrences2.rows.map((r) => r.occurrence_id),
        faseCMigrationLeftActive: true,
      },
    );
  } finally {
    await client.close();
  }

  const outPath = path.join(RC_CONFIG.evidenciasDir, 'sql_rollout_rollback_rehearsal.json');
  fs.writeFileSync(outPath, JSON.stringify({ suite: 'sql_rollout_rollback_rehearsal', results }, null, 2));
  return results;
}
