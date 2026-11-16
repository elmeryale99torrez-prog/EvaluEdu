import fs from 'node:fs';
import path from 'node:path';
import { RC_CONFIG } from '../config/rc.config.mjs';
import { PgClient } from '../env/pg_wire.mjs';

// Suite de seguridad, privilegios SQL/RLS, concurrencia de entregas, funciones administrativas
// y simulación de NAT escolar (30 estudiantes desde una misma IP) sobre el entorno aislado LAB-RC-001.

async function callGatewayJson(urlPath, { method = 'POST', token = '', anonKey = '', body = null, headers = {} } = {}) {
  const reqHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${token || anonKey}`,
    ...headers,
  };
  if (body !== null) reqHeaders['Content-Type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${RC_CONFIG.ports.gateway}${urlPath}`, {
    method,
    headers: reqHeaders,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    json,
  };
}

async function signInUser(email, password, anonKey) {
  const res = await callGatewayJson('/auth/v1/token?grant_type=password', {
    method: 'POST',
    anonKey,
    body: { email, password },
  });
  if (res.status !== 200 || !res.json?.access_token) {
    throw new Error(`Fallo signIn para ${email}: status=${res.status}`);
  }
  return res.json.access_token;
}

export async function runAuthRlsAndNatSuite() {
  const runtimeState = JSON.parse(fs.readFileSync(path.join(RC_CONFIG.workDir, 'runtime_state.json'), 'utf8'));
  const { anonKey, serviceRoleKey, users } = runtimeState;

  const client = new PgClient({
    socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
    user: RC_CONFIG.postgres.superuser,
    database: RC_CONFIG.postgres.dbName,
  });
  await client.connect();

  const results = [];
  const record = (id, title, status, details) => {
    results.push({ id, title, status, details });
  };

  try {
    const ownerJwt = await signInUser(users.teacherOwner.email, users.teacherOwner.password, anonKey);
    const otherJwt = await signInUser(users.teacherOther.email, users.teacherOther.password, anonKey);
    const adminJwt = await signInUser(users.adminDirector.email, users.adminDirector.password, anonKey);
    const dualJwt = await signInUser(users.teacherDual.email, users.teacherDual.password, anonKey);

    // Sembrar una sala dedicada para pruebas de seguridad, concurrencia, edición en vivo y ocurrencias repetidas
    const secRoomId = '66666666-6666-4666-8666-666666666601';
    const otherRoomId = '66666666-6666-4666-8666-666666666602';
    const natRoomId = '66666666-6666-4666-8666-666666666603';
    const actTfId = '77777777-7777-4777-8777-777777777701';
    const actScId = '77777777-7777-4777-8777-777777777702';

    await client.query(
      `INSERT INTO public.activities(id, owner_id, type, title, prompt, options, answer, feedback, details, status)
       VALUES
         ($1, $3, 'trueFalse', 'TF Seguridad', 'El ADN es bicatenario.', ARRAY['Verdadero','Falso'], 'true'::jsonb, 'Pista ADN', '{"trueFalse":{"statement":"El ADN es bicatenario.","correct":true,"hint":"Pista ADN"}}'::jsonb, 'published'),
         ($2, $3, 'singleChoice', 'SC Seguridad', 'Capital celular energética:', ARRAY['ATP','ADP'], '"ATP"'::jsonb, 'Pista ATP', '{"singleChoice":{"options":[{"id":"o1","label":"ATP","correct":true},{"id":"o2","label":"ADP","correct":false}],"hint":"Pista ATP"}}'::jsonb, 'published')
       ON CONFLICT (id) DO NOTHING`,
      [actTfId, actScId, users.teacherOwner.id],
    );

    // Sala secRoomId incluye la MISMA actividad actTfId repetida en dos posiciones (0 y 1) + actScId en pos 2
    await client.query(
      `INSERT INTO public.rooms(id, owner_id, name, code, status, question_count, student_limit, time_minutes, score_per_question, shuffle_questions)
       VALUES
         ($1, $4, 'Sala Seguridad y Ocurrencias', 'EDU-SEC1', 'active', 3, 60, 30, 10, false),
         ($2, $5, 'Sala Docente Ajeno', 'EDU-OTHR', 'active', 1, 40, 30, 10, false),
         ($3, $4, 'Sala NAT Escolar 30', 'EDU-NAT3', 'active', 2, 60, 30, 10, true)
       ON CONFLICT (id) DO NOTHING`,
      [secRoomId, otherRoomId, natRoomId, users.teacherOwner.id, users.teacherOther.id],
    );

    await client.query(
      `INSERT INTO public.room_activities(id, room_id, activity_id, position)
       VALUES
         ('88888888-8888-4888-8888-888888888801', $1, $3, 0),
         ('88888888-8888-4888-8888-888888888802', $1, $3, 1),
         ('88888888-8888-4888-8888-888888888803', $1, $4, 2),
         ('88888888-8888-4888-8888-888888888804', $2, $3, 0),
         ('88888888-8888-4888-8888-888888888805', $5, $3, 0),
         ('88888888-8888-4888-8888-888888888806', $5, $4, 1)
       ON CONFLICT (id) DO NOTHING`,
      [secRoomId, otherRoomId, actTfId, actScId, natRoomId],
    );

    // 1. Llamada directa a RPC submit_student_attempt_atomic con firma completa de 13 parámetros + verificación SQL ACL y SET LOCAL ROLE
    const rpcTestParticipantId = '99999999-9999-4999-8999-999999999901';
    await client.query(
      `INSERT INTO public.room_participants(id, room_id, display_name, name_normalized, status)
       VALUES ($1, $2, 'Participante Control RPC', 'participante control rpc', 'in_progress')
       ON CONFLICT (id) DO NOTHING`,
      [rpcTestParticipantId, secRoomId],
    );

    const validRpcPayload = {
      p_room_id: secRoomId,
      p_participant_id: rpcTestParticipantId,
      p_started_at: '2026-11-12T10:00:00.000Z',
      p_finished_at: '2026-11-12T10:05:00.000Z',
      p_status: 'submitted',
      p_total_questions: 3,
      p_answered_count: 1,
      p_omitted_count: 2,
      p_correct_count: 1,
      p_score: 10,
      p_max_score: 30,
      p_events: [],
      p_answers: [
        {
          activity_id: actTfId,
          occurrence_id: '88888888-8888-4888-8888-888888888801',
          response: true,
          is_correct: true,
          score: 10,
        },
      ],
    };

    const rpcAnon = await callGatewayJson('/rest/v1/rpc/submit_student_attempt_atomic', {
      method: 'POST',
      anonKey,
      body: validRpcPayload,
    });
    const rpcAuth = await callGatewayJson('/rest/v1/rpc/submit_student_attempt_atomic', {
      method: 'POST',
      token: ownerJwt,
      anonKey,
      body: validRpcPayload,
    });
    const rpcServiceRole = await callGatewayJson('/rest/v1/rpc/submit_student_attempt_atomic', {
      method: 'POST',
      token: serviceRoleKey,
      anonKey,
      body: validRpcPayload,
    });

    const aclQuery = await client.query(`
      SELECT
        p.proname,
        pg_get_function_identity_arguments(p.oid) AS identity_args,
        p.prosecdef AS security_definer,
        p.proacl::text AS raw_acl,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
        EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        pg_has_role('anon', 'service_role', 'MEMBER') AS anon_member_of_service_role,
        pg_has_role('authenticated', 'service_role', 'MEMBER') AS auth_member_of_service_role
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'submit_student_attempt_atomic'
    `);
    const aclRow = aclQuery.rows[0] || null;

    let sqlAnonError = null;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE anon');
      await client.query(
        `SELECT public.submit_student_attempt_atomic(
          $1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, $5::text,
          $6::integer, $7::integer, $8::integer, $9::integer,
          $10::numeric, $11::numeric, $12::jsonb, $13::jsonb
        )`,
        [
          validRpcPayload.p_room_id,
          validRpcPayload.p_participant_id,
          validRpcPayload.p_started_at,
          validRpcPayload.p_finished_at,
          validRpcPayload.p_status,
          validRpcPayload.p_total_questions,
          validRpcPayload.p_answered_count,
          validRpcPayload.p_omitted_count,
          validRpcPayload.p_correct_count,
          validRpcPayload.p_score,
          validRpcPayload.p_max_score,
          JSON.stringify(validRpcPayload.p_events),
          JSON.stringify(validRpcPayload.p_answers),
        ],
      );
      await client.query('ROLLBACK');
    } catch (err) {
      sqlAnonError = { code: err.sqlstate || err.code || null, message: err.message };
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback cleanup
      }
    }

    let sqlAuthError = null;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      await client.query(
        `SELECT public.submit_student_attempt_atomic(
          $1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, $5::text,
          $6::integer, $7::integer, $8::integer, $9::integer,
          $10::numeric, $11::numeric, $12::jsonb, $13::jsonb
        )`,
        [
          validRpcPayload.p_room_id,
          validRpcPayload.p_participant_id,
          validRpcPayload.p_started_at,
          validRpcPayload.p_finished_at,
          validRpcPayload.p_status,
          validRpcPayload.p_total_questions,
          validRpcPayload.p_answered_count,
          validRpcPayload.p_omitted_count,
          validRpcPayload.p_correct_count,
          validRpcPayload.p_score,
          validRpcPayload.p_max_score,
          JSON.stringify(validRpcPayload.p_events),
          JSON.stringify(validRpcPayload.p_answers),
        ],
      );
      await client.query('ROLLBACK');
    } catch (err) {
      sqlAuthError = { code: err.sqlstate || err.code || null, message: err.message };
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback cleanup
      }
    }

    // Limpiar el intento y participante del control positivo service_role para no alterar conteos posteriores
    await client.query(`DELETE FROM public.attempts WHERE participant_id = $1`, [rpcTestParticipantId]);
    await client.query(`DELETE FROM public.room_participants WHERE id = $1`, [rpcTestParticipantId]);

    const httpDeniedForClients =
      (rpcAnon.status === 401 || rpcAnon.status === 403 || rpcAnon.status === 404) &&
      (rpcAuth.status === 401 || rpcAuth.status === 403 || rpcAuth.status === 404);
    const httpAllowedForServiceRole =
      rpcServiceRole.status === 200 &&
      Boolean(rpcServiceRole.json?.attemptId || rpcServiceRole.json?.attempt_id);
    const catalogGrantsVerified =
      Boolean(aclRow) &&
      aclRow.security_definer === true &&
      aclRow.anon_can_execute === false &&
      aclRow.authenticated_can_execute === false &&
      aclRow.public_can_execute === false &&
      aclRow.service_role_can_execute === true &&
      aclRow.anon_member_of_service_role === false &&
      aclRow.auth_member_of_service_role === false;
    const directSqlDenied =
      sqlAnonError !== null &&
      /permission denied for function submit_student_attempt_atomic/i.test(sqlAnonError.message) &&
      sqlAuthError !== null &&
      /permission denied for function submit_student_attempt_atomic/i.test(sqlAuthError.message);

    record(
      'SEC-RC-01',
      'Bloqueo de ejecución directa de RPC submit_student_attempt_atomic (13 parámetros reales, ACL en pg_proc y SET LOCAL ROLE)',
      httpDeniedForClients && httpAllowedForServiceRole && catalogGrantsVerified && directSqlDenied
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        payloadParamsSent: Object.keys(validRpcPayload),
        httpPostgrest: {
          anonStatus: rpcAnon.status,
          anonCode: rpcAnon.json?.code || null,
          anonError: rpcAnon.json?.message || null,
          authenticatedStatus: rpcAuth.status,
          authenticatedCode: rpcAuth.json?.code || null,
          authenticatedError: rpcAuth.json?.message || null,
          serviceRolePositiveControlStatus: rpcServiceRole.status,
          serviceRoleResult: rpcServiceRole.json || null,
        },
        pgCatalogAcl: aclRow,
        directSqlExecution: {
          anonRoleError: sqlAnonError,
          authenticatedRoleError: sqlAuthError,
        },
      },
    );

    // 2. Join legítimo en EDU-SEC1 (con actividad repetida en 2 posiciones) + suplantación de nombre (409)
    const joinLegit = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: { action: 'join', code: 'EDU-SEC1', displayName: 'Valeria Seguridad' },
    });
    const participantId = joinLegit.json?.participant?.id;
    const guestToken = joinLegit.json?.guestToken;
    const joinActivities = joinLegit.json?.activities || [];

    // Intento de suplantación con mismo nombre sin guestToken
    const joinSpoof = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: { action: 'join', code: 'EDU-SEC1', displayName: '  valeria seguridad ' },
    });
    // Intento con token falso en status
    const statusFakeToken = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: { action: 'status', code: 'EDU-SEC1', participantId, guestToken: 'token_invalido_falso_000' },
    });
    // Intento con participante de otra sala
    const statusForeignRoom = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: { action: 'status', code: 'EDU-OTHR', participantId, guestToken },
    });
    // Recuperación legítima con mismo nombre + guestToken válido
    const joinRecover = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: { action: 'join', code: 'EDU-SEC1', displayName: 'Valeria Seguridad', participantId, guestToken },
    });

    record(
      'SEC-RC-02',
      'Rechazo de suplantación (409), token falso (401), participante ajeno (401/404) y recuperación legítima (200)',
      (joinLegit.status === 200 || joinLegit.status === 201) &&
        joinSpoof.status === 409 &&
        !joinSpoof.json?.guestToken &&
        statusFakeToken.status === 401 &&
        (statusForeignRoom.status === 401 || statusForeignRoom.status === 404) &&
        joinRecover.status === 200 &&
        joinRecover.json?.participant?.id === participantId
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        joinLegitStatus: joinLegit.status,
        joinSpoofStatus: joinSpoof.status,
        joinSpoofLeakedToken: Boolean(joinSpoof.json?.guestToken),
        statusFakeTokenStatus: statusFakeToken.status,
        statusForeignRoomStatus: statusForeignRoom.status,
        joinRecoverStatus: joinRecover.status,
      },
    );

    // 3. Verificar expiración de token de invitado
    const joinExp = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: { action: 'join', code: 'EDU-SEC1', displayName: 'Alumno Expirado' },
    });
    await client.query(
      `UPDATE public.room_participants SET guest_token_expires_at = now() - interval '10 minutes' WHERE id = $1`,
      [joinExp.json.participant.id],
    );
    const statusExpired = await callGatewayJson('/functions/v1/student-room-guest', {
      anonKey,
      body: {
        action: 'status',
        code: 'EDU-SEC1',
        participantId: joinExp.json.participant.id,
        guestToken: joinExp.json.guestToken,
      },
    });
    record(
      'SEC-RC-03',
      'Rechazo de token de sesión de estudiante expirado (401)',
      statusExpired.status === 401 ? 'PASA' : 'FALLA_PRODUCTO',
      {
        expiredStatus: statusExpired.status,
        expiredError: statusExpired.json?.error,
      },
    );

    // 4. Edición docente en vivo (cambio de respuesta y de score_per_question después del join)
    await client.query(`UPDATE public.rooms SET score_per_question = 25 WHERE id = $1`, [secRoomId]);
    await client.query(
      `UPDATE public.activities
       SET answer = 'false'::jsonb,
           details = '{"trueFalse":{"statement":"El ADN es bicatenario.","correct":false,"hint":"Pista ADN"}}'::jsonb
       WHERE id = $1`,
      [actTfId],
    );

    // Enviar intento concurrente doble (Promise.all) para Valeria Seguridad sobre las 3 ocurrencias (2 repetidas de actTfId + 1 de actScId)
    const submitBody = {
      action: 'submit_attempt',
      roomId: secRoomId,
      code: 'EDU-SEC1',
      participantId,
      guestToken,
      attempt: {
        startedAt: new Date(Date.now() - 60000).toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'completed',
        events: [],
      },
      responses: [
        {
          occurrenceId: joinActivities[0].occurrenceId,
          roomActivityId: joinActivities[0].roomActivityId,
          activityId: joinActivities[0].id,
          questionIndex: 0,
          response: { type: 'trueFalse', value: 'Verdadero' },
          status: 'answered',
          timeSeconds: 5,
        },
        {
          occurrenceId: joinActivities[1].occurrenceId,
          roomActivityId: joinActivities[1].roomActivityId,
          activityId: joinActivities[1].id,
          questionIndex: 1,
          response: { type: 'trueFalse', value: 'Falso' },
          status: 'answered',
          timeSeconds: 6,
        },
        {
          occurrenceId: joinActivities[2].occurrenceId,
          roomActivityId: joinActivities[2].roomActivityId,
          activityId: joinActivities[2].id,
          questionIndex: 2,
          response: { type: 'singleChoice', value: 'o1' },
          status: 'answered',
          timeSeconds: 7,
        },
      ],
    };

    const [subA, subB] = await Promise.all([
      callGatewayJson('/functions/v1/student-room-guest', { anonKey, body: submitBody }),
      callGatewayJson('/functions/v1/student-room-guest', { anonKey, body: submitBody }),
    ]);
    // Reintento posterior (ACK perdido)
    const subRetry = await callGatewayJson('/functions/v1/student-room-guest', { anonKey, body: submitBody });

    // Restaurar actTfId y score_per_question=10
    await client.query(`UPDATE public.rooms SET score_per_question = 10 WHERE id = $1`, [secRoomId]);
    await client.query(
      `UPDATE public.activities
       SET answer = 'true'::jsonb,
           details = '{"trueFalse":{"statement":"El ADN es bicatenario.","correct":true,"hint":"Pista ADN"}}'::jsonb
       WHERE id = $1`,
      [actTfId],
    );

    const dbAttempts = await client.query(
      `SELECT id, score::float AS score, max_score::float AS max_score, correct_count, answered_count, omitted_count
       FROM public.attempts WHERE participant_id = $1`,
      [participantId],
    );
    const dbAnswers = await client.query(
      `SELECT question_index, occurrence_id, room_activity_id::text AS room_activity_id, correct, score::float AS score
       FROM public.attempt_answers WHERE attempt_id = $1 ORDER BY question_index ASC`,
      [dbAttempts.rows[0]?.id],
    );

    record(
      'SEC-RC-04',
      'Concurrencia real (2 envíos simultáneos), reintento tras ACK perdido, ocurrencias repetidas y snapshot inmutable ante edición en vivo',
      (subA.status === 200 || subA.status === 201) &&
        (subB.status === 200 || subB.status === 201) &&
        subRetry.status === 200 &&
        subRetry.json?.alreadySaved === true &&
        dbAttempts.rows.length === 1 &&
        dbAttempts.rows[0].score === 20 &&
        dbAttempts.rows[0].max_score === 30 &&
        dbAnswers.rows.length === 3 &&
        dbAnswers.rows[0].occurrence_id !== dbAnswers.rows[1].occurrence_id
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        concurrentStatuses: [subA.status, subB.status],
        retryAlreadySaved: subRetry.json?.alreadySaved,
        attemptsRowCount: dbAttempts.rows.length,
        attemptSummary: dbAttempts.rows[0],
        answerRows: dbAnswers.rows,
      },
    );

    // 5. Privilegios de columna en room_participants y aislamiento RLS en attempts/attempt_answers
    const rpSafeOwner = await callGatewayJson(
      `/rest/v1/room_participants?room_id=eq.${secRoomId}&select=id,display_name,status`,
      { method: 'GET', token: ownerJwt, anonKey },
    );
    const rpSnapOwner = await callGatewayJson(
      `/rest/v1/room_participants?room_id=eq.${secRoomId}&select=id,activities_snapshot`,
      { method: 'GET', token: ownerJwt, anonKey },
    );
    const rpHashOwner = await callGatewayJson(
      `/rest/v1/room_participants?room_id=eq.${secRoomId}&select=id,guest_token_hash`,
      { method: 'GET', token: ownerJwt, anonKey },
    );
    const attAnon = await callGatewayJson(`/rest/v1/attempts?room_id=eq.${secRoomId}&select=*`, {
      method: 'GET',
      anonKey,
    });
    const attOtherTeacher = await callGatewayJson(`/rest/v1/attempts?room_id=eq.${secRoomId}&select=*`, {
      method: 'GET',
      token: otherJwt,
      anonKey,
    });
    const attOwnerTeacher = await callGatewayJson(`/rest/v1/attempts?room_id=eq.${secRoomId}&select=id,score`, {
      method: 'GET',
      token: ownerJwt,
      anonKey,
    });
    const ansOtherTeacher = await callGatewayJson(`/rest/v1/attempt_answers?select=*`, {
      method: 'GET',
      token: otherJwt,
      anonKey,
    });

    record(
      'SEC-RC-05',
      'Confidencialidad de columnas en room_participants (Q1) y RLS entre docentes y anon en attempts/attempt_answers',
      rpSafeOwner.status === 200 &&
        Array.isArray(rpSafeOwner.json) &&
        rpSafeOwner.json.length >= 1 &&
        rpSnapOwner.status >= 400 &&
        rpHashOwner.status >= 400 &&
        (attAnon.status >= 400 || (Array.isArray(attAnon.json) && attAnon.json.length === 0)) &&
        Array.isArray(attOtherTeacher.json) &&
        attOtherTeacher.json.length === 0 &&
        Array.isArray(ansOtherTeacher.json) &&
        ansOtherTeacher.json.length === 0 &&
        Array.isArray(attOwnerTeacher.json) &&
        attOwnerTeacher.json.length === 1
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        safeColumnsOwnerStatus: rpSafeOwner.status,
        snapshotColumnOwnerStatus: rpSnapOwner.status,
        tokenHashColumnOwnerStatus: rpHashOwner.status,
        anonAttemptsRows: Array.isArray(attAnon.json) ? attAnon.json.length : attAnon.status,
        otherTeacherAttemptsRows: attOtherTeacher.json?.length,
        otherTeacherAnswersRows: ansOtherTeacher.json?.length,
        ownerTeacherAttemptsRows: attOwnerTeacher.json?.length,
      },
    );

    // 6. Funciones administrativas y disparador de inmutabilidad en audit_events
    const platTeacher = await callGatewayJson('/functions/v1/admin-platform-data', {
      token: ownerJwt,
      anonKey,
      body: {},
    });
    const platAdmin = await callGatewayJson('/functions/v1/admin-platform-data', {
      token: adminJwt,
      anonKey,
      body: {},
    });
    const platDual = await callGatewayJson('/functions/v1/admin-platform-data', {
      token: dualJwt,
      anonKey,
      body: {},
    });

    const pilotCreate1 = await callGatewayJson('/functions/v1/admin-create-pilot-teacher', {
      token: adminJwt,
      anonKey,
      body: {
        email: 'piloto.rc1@synthetic.evaluedu.local',
        displayName: 'Docente Piloto RC 1',
        password: `${RC_CONFIG.syntheticPasswordPrefix}pilot1`,
      },
    });
    const pilotCreateDup = await callGatewayJson('/functions/v1/admin-create-pilot-teacher', {
      token: adminJwt,
      anonKey,
      body: {
        email: 'piloto.rc1@synthetic.evaluedu.local',
        displayName: 'Docente Piloto RC 1 Dup',
        password: `${RC_CONFIG.syntheticPasswordPrefix}pilot1`,
      },
    });

    const inviteAdmin = await callGatewayJson('/functions/v1/admin-invite-teacher', {
      token: adminJwt,
      anonKey,
      body: {
        email: 'invitado.rc1@synthetic.evaluedu.local',
        displayName: 'Docente Invitado RC 1',
      },
    });
    const inviteTeacherNeg = await callGatewayJson('/functions/v1/admin-invite-teacher', {
      token: ownerJwt,
      anonKey,
      body: {
        email: 'invitado.neg@synthetic.evaluedu.local',
        displayName: 'Docente Invitado Negativo',
      },
    });
    // Verificar inconsistencia residual CIV-RES-01 en admin-invite-teacher con perfil dual (role='teacher', roles=['teacher','admin'])
    const inviteDual = await callGatewayJson('/functions/v1/admin-invite-teacher', {
      token: dualJwt,
      anonKey,
      body: {
        email: 'invitado.dual@synthetic.evaluedu.local',
        displayName: 'Docente Invitado Dual',
      },
    });

    const resendAdmin = await callGatewayJson('/functions/v1/admin-resend-access', {
      token: adminJwt,
      anonKey,
      body: { email: 'piloto.rc1@synthetic.evaluedu.local' },
    });
    const resendTeacherNeg = await callGatewayJson('/functions/v1/admin-resend-access', {
      token: ownerJwt,
      anonKey,
      body: { email: 'piloto.rc1@synthetic.evaluedu.local' },
    });
    // Verificar inconsistencia residual CIV-RES-01 en admin-resend-access con perfil dual (role='teacher', roles=['teacher','admin'])
    const resendDual = await callGatewayJson('/functions/v1/admin-resend-access', {
      token: dualJwt,
      anonKey,
      body: { email: 'piloto.rc1@synthetic.evaluedu.local' },
    });

    const pilotUserId = pilotCreate1.json?.userId || pilotCreate1.json?.user?.id;
    const suspendPilot = await callGatewayJson('/functions/v1/admin-remove-user', {
      token: adminJwt,
      anonKey,
      body: { userId: pilotUserId, action: 'disable' },
    });
    const enablePilot = await callGatewayJson('/functions/v1/admin-remove-user', {
      token: adminJwt,
      anonKey,
      body: { userId: pilotUserId, action: 'enable' },
    });
    const removeAdminProtected = await callGatewayJson('/functions/v1/admin-remove-user', {
      token: adminJwt,
      anonKey,
      body: { userId: users.adminDirector.id, action: 'disable' },
    });
    const removeDualProtected = await callGatewayJson('/functions/v1/admin-remove-user', {
      token: adminJwt,
      anonKey,
      body: { userId: users.teacherDual.id, action: 'disable' },
    });

    const auditRows = await client.query(
      `SELECT event_type, entity_id, metadata->>'teacherName' AS teacher_name
       FROM public.audit_events ORDER BY created_at ASC`,
    );

    let auditUpdateBlocked = false;
    let auditDeleteBlocked = false;
    try {
      await client.query(`UPDATE public.audit_events SET event_type = 'tampered'`);
    } catch {
      auditUpdateBlocked = true;
    }
    try {
      await client.query(`DELETE FROM public.audit_events`);
    } catch {
      auditDeleteBlocked = true;
    }

    record(
      'SEC-RC-06',
      'Funciones administrativas (RC-FIX-01/02), privacidad cero-espionaje y auditoría inmutable (trg_prevent_audit_events_mutation)',
      platTeacher.status === 403 &&
        platAdmin.status === 200 &&
        Array.isArray(platAdmin.json?.attempts) &&
        platAdmin.json.attempts.length === 0 &&
        Array.isArray(platAdmin.json?.rooms) &&
        platAdmin.json.rooms.length === 0 &&
        platDual.status === 200 &&
        (pilotCreate1.status === 200 || pilotCreate1.status === 201) &&
        pilotCreateDup.status === 409 &&
        (inviteAdmin.status === 200 || inviteAdmin.status === 201) &&
        resendAdmin.status === 200 &&
        suspendPilot.status === 200 &&
        enablePilot.status === 200 &&
        removeAdminProtected.status === 400 &&
        removeDualProtected.status === 400 &&
        auditRows.rows.length >= 5 &&
        auditUpdateBlocked &&
        auditDeleteBlocked
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        platTeacherStatus: platTeacher.status,
        platAdminStatus: platAdmin.status,
        platAdminAttemptsExposed: platAdmin.json?.attempts?.length ?? -1,
        platAdminRoomsExposed: platAdmin.json?.rooms?.length ?? -1,
        platDualStatus: platDual.status,
        pilotCreateStatus: pilotCreate1.status,
        pilotDuplicateStatus: pilotCreateDup.status,
        inviteAdminStatus: inviteAdmin.status,
        resendAdminStatus: resendAdmin.status,
        suspendPilotStatus: suspendPilot.status,
        enablePilotStatus: enablePilot.status,
        removeAdminProtectedStatus: removeAdminProtected.status,
        removeDualProtectedStatus: removeDualProtected.status,
        auditEventsRecorded: auditRows.rows,
        auditUpdateBlocked,
        auditDeleteBlocked,
      },
    );

    record(
      'SEC-RC-07A',
      'Consistencia de autorización de perfil dual (roles: [teacher, admin]) en admin-invite-teacher',
      (inviteAdmin.status === 200 || inviteAdmin.status === 201) &&
        inviteTeacherNeg.status === 403 &&
        (inviteDual.status === 200 || inviteDual.status === 201)
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'CIV-RES-01',
        endpoint: '/functions/v1/admin-invite-teacher',
        positiveControlAdminStatus: inviteAdmin.status,
        negativeControlTeacherStatus: inviteTeacherNeg.status,
        negativeControlTeacherError: inviteTeacherNeg.json?.error || null,
        dualProfileStatus: inviteDual.status,
        dualProfileError: inviteDual.json?.error || null,
        cause:
          'supabase/functions/admin-invite-teacher/index.ts:81 verifica únicamente callerProfile.role !== "admin" e ignora callerProfile.roles.includes("admin").',
      },
    );

    record(
      'SEC-RC-07B',
      'Consistencia de autorización de perfil dual (roles: [teacher, admin]) en admin-resend-access',
      resendAdmin.status === 200 &&
        resendTeacherNeg.status === 403 &&
        resendDual.status === 200
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'CIV-RES-01',
        endpoint: '/functions/v1/admin-resend-access',
        positiveControlAdminStatus: resendAdmin.status,
        negativeControlTeacherStatus: resendTeacherNeg.status,
        negativeControlTeacherError: resendTeacherNeg.json?.error || null,
        dualProfileStatus: resendDual.status,
        dualProfileError: resendDual.json?.error || null,
        cause:
          'supabase/functions/admin-resend-access/index.ts:81 verifica únicamente callerProfile.role !== "admin" e ignora callerProfile.roles.includes("admin").',
      },
    );

    // 7. Simulación de NAT Escolar: 30 estudiantes concurrentes desde una misma IP pública (203.0.113.50)
    const natIp = '203.0.113.50';
    const natHeaders = { 'x-forwarded-for': natIp };

    // 30 joins concurrentes
    const natJoins = await Promise.all(
      Array.from({ length: 30 }, (_, idx) =>
        callGatewayJson('/functions/v1/student-room-guest', {
          anonKey,
          headers: natHeaders,
          body: {
            action: 'join',
            code: 'EDU-NAT3',
            displayName: `Estudiante NAT ${String(idx + 1).padStart(2, '0')}`,
          },
        }),
      ),
    );
    const natJoinOkCount = natJoins.filter((r) => (r.status === 200 || r.status === 201) && r.json?.guestToken).length;

    // 24 consultas status por cada uno de los 30 estudiantes (720 solicitudes desde la misma IP)
    let natStatusOkCount = 0;
    let natStatus429Count = 0;
    for (let round = 0; round < 24; round += 1) {
      const batch = await Promise.all(
        natJoins.map((j) =>
          callGatewayJson('/functions/v1/student-room-guest', {
            anonKey,
            headers: natHeaders,
            body: {
              action: 'status',
              code: 'EDU-NAT3',
              participantId: j.json.participant.id,
              guestToken: j.json.guestToken,
            },
          }),
        ),
      );
      for (const r of batch) {
        if (r.status === 200) natStatusOkCount += 1;
        if (r.status === 429) natStatus429Count += 1;
      }
    }

    // 30 envíos finales concurrentes desde la misma IP
    const natSubmits = await Promise.all(
      natJoins.map((j) => {
        const acts = j.json.activities || [];
        return callGatewayJson('/functions/v1/student-room-guest', {
          anonKey,
          headers: natHeaders,
          body: {
            action: 'submit_attempt',
            roomId: natRoomId,
            code: 'EDU-NAT3',
            participantId: j.json.participant.id,
            guestToken: j.json.guestToken,
            attempt: {
              startedAt: new Date(Date.now() - 45000).toISOString(),
              finishedAt: new Date().toISOString(),
              status: 'completed',
              events: [],
            },
            responses: acts.map((a, idx) => ({
              occurrenceId: a.occurrenceId,
              roomActivityId: a.roomActivityId,
              activityId: a.id,
              questionIndex: idx,
              response: a.type === 'trueFalse' ? { type: 'trueFalse', value: 'Verdadero' } : { type: 'singleChoice', value: 'o1' },
              status: 'answered',
              timeSeconds: 8,
            })),
          },
        });
      }),
    );
    const natSubmitOkCount = natSubmits.filter((r) => r.status === 200 || r.status === 201).length;
    const natAttemptsInDb = await client.query(
      `SELECT count(*)::int AS cnt FROM public.attempts WHERE room_id = $1`,
      [natRoomId],
    );

    // Ráfaga abusiva con un mismo token en submit_attempt (>10/min/token) -> debe devolver 429 + Retry-After
    const abuseTarget = natJoins[0];
    let abuse429Status = null;
    let abuseRetryAfter = null;
    for (let i = 0; i < 12; i += 1) {
      const r = await callGatewayJson('/functions/v1/student-room-guest', {
        anonKey,
        headers: { 'x-forwarded-for': '203.0.113.99' },
        body: {
          action: 'submit_attempt',
          roomId: natRoomId,
          code: 'EDU-NAT3',
          participantId: abuseTarget.json.participant.id,
          guestToken: abuseTarget.json.guestToken,
          responses: [],
        },
      });
      if (r.status === 429) {
        abuse429Status = r.status;
        abuseRetryAfter = r.headers['retry-after'] || null;
        break;
      }
    }

    record(
      'SEC-RC-08',
      'NAT escolar (30 alumnos misma IP: 30 joins, 720 status, 30 submits concurrentes) y corte 429 ante abuso por token',
      natJoinOkCount === 30 &&
        natStatusOkCount === 720 &&
        natStatus429Count === 0 &&
        natSubmitOkCount === 30 &&
        natAttemptsInDb.rows[0].cnt === 30 &&
        abuse429Status === 429 &&
        Boolean(abuseRetryAfter)
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        sharedIp: natIp,
        natJoinOkCount,
        natStatusOkCount,
        natStatus429Count,
        natSubmitOkCount,
        natAttemptsPersistedInDb: natAttemptsInDb.rows[0].cnt,
        abuseBurstStatus: abuse429Status,
        abuseRetryAfterHeader: abuseRetryAfter,
        note: 'El limitador opera en memoria por instancia Deno (Map local); no coordina estado distribuido entre múltiples instancias.',
      },
    );
  } finally {
    await client.close();
  }

  const outPath = path.join(RC_CONFIG.evidenciasDir, 'auth_rls_and_nat_results.json');
  fs.writeFileSync(outPath, JSON.stringify({ suite: 'auth_rls_and_nat', results }, null, 2));
  return results;
}
