#!/usr/bin/env bash
set -euo pipefail

# Script de verificación de base de datos PostgreSQL real aislada para Fase C (LAB-C-001)
# Subsanación Q1/Q4 (Dictamen ATLAS a7bef5ed):
# - Documenta explícitamente limitación de procedencia (el repo carece de 0000_init.sql base)
#   y aplica las migraciones reales existentes: 20261029141500, 20261029143500 y 20261112100000.
# - Prueba RLS de lectura previa en AMBAS tablas: attempts y attempt_answers.
# - Prueba Q1 confidencialidad de almacenamiento en room_participants (activities_snapshot y token hash
#   bloqueados por privilegios de columna para anon y authenticated; lectura segura docente intacta).
# - Prueba Q4 rama de duplicados históricos en BD separada: inserta 2 intentos duplicados reales,
#   aplica migración, verifica NOTICE, preservación intacta (2 filas) e índice regular no único.
# - Mantiene pruebas reales de concurrencia (wait sin || true), idempotencia y rollback.

PG_DIR="/tmp/evaluedu_pg_c"
PG_PORT=54332
PG_SOCK_DIR="/tmp"
DB_NAME="evaluedu_lab_test"
DUP_DB_NAME="evaluedu_lab_dups_test"
LOG_FILE="docs/orchestration/fase-c/evidencias/sql_fase_c_real.log"

mkdir -p "$(dirname "${LOG_FILE}")"
echo "================================================================================" | tee "${LOG_FILE}"
echo "EVALUEDU v1.3 · VERIFICACIÓN SQL REAL AISLADA (SUBSANACIÓN Q1/Q4) · FASE C" | tee -a "${LOG_FILE}"
echo "Fecha: $(date -u +'%Y-%m-%d %H:%M:%SZ')" | tee -a "${LOG_FILE}"
echo "LIMITACIÓN DE PROCEDENCIA: El repositorio contiene migraciones incrementales desde" | tee -a "${LOG_FILE}"
echo "20261021154245 y carece de migración DDL inicial (0000_init.sql). Este arnés crea" | tee -a "${LOG_FILE}"
echo "tablas base y políticas RLS representativas y aplica encima las migraciones reales" | tee -a "${LOG_FILE}"
echo "20261029141500, 20261029143500 y 20261112100000." | tee -a "${LOG_FILE}"
echo "================================================================================" | tee -a "${LOG_FILE}"

rm -rf "${PG_DIR}"
mkdir -p "${PG_DIR}"

echo "[1/9] Inicializando cluster PostgreSQL 15 en ${PG_DIR}..." | tee -a "${LOG_FILE}"
/usr/lib/postgresql/15/bin/initdb -D "${PG_DIR}" --no-sync -A trust -U antigravity >> "${LOG_FILE}" 2>&1

echo "[2/9] Arrancando servidor PostgreSQL en puerto ${PG_PORT}..." | tee -a "${LOG_FILE}"
/usr/lib/postgresql/15/bin/pg_ctl -D "${PG_DIR}" -o "-k ${PG_SOCK_DIR} -p ${PG_PORT}" start >> "${LOG_FILE}" 2>&1
sleep 2

cleanup() {
  echo "Deteniendo servidor PostgreSQL..." | tee -a "${LOG_FILE}"
  /usr/lib/postgresql/15/bin/pg_ctl -D "${PG_DIR}" stop -m fast >> "${LOG_FILE}" 2>&1 || true
  rm -rf "${PG_DIR}" /tmp/evaluedu_conc_a.txt /tmp/evaluedu_conc_b.txt
}
trap cleanup EXIT

PSQL="/usr/lib/postgresql/15/bin/psql -v ON_ERROR_STOP=1 -h ${PG_SOCK_DIR} -p ${PG_PORT} -U antigravity"

echo "[3/9] Creando base de datos ${DB_NAME} y roles de seguridad..." | tee -a "${LOG_FILE}"
${PSQL} -d postgres -c "CREATE DATABASE ${DB_NAME};" >> "${LOG_FILE}" 2>&1
${PSQL} -d "${DB_NAME}" << 'EOF' >> "${LOG_FILE}" 2>&1
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
EOF

echo "[4/9] Creando esquema base representativo con RLS y datos PREVIOS..." | tee -a "${LOG_FILE}"
${PSQL} -d "${DB_NAME}" << 'EOF' >> "${LOG_FILE}" 2>&1
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  role text DEFAULT 'student',
  roles text[] DEFAULT ARRAY['student'],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  instructions text,
  status text DEFAULT 'active',
  question_count integer DEFAULT 5,
  student_limit integer DEFAULT 40,
  time_minutes integer DEFAULT 30,
  score_per_question numeric DEFAULT 10,
  shuffle_questions boolean DEFAULT true,
  allow_back boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE public.room_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES public.rooms(id),
  activity_id uuid NOT NULL,
  position integer NOT NULL
);

CREATE TABLE public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid,
  type text NOT NULL,
  title text NOT NULL,
  topic text,
  difficulty text,
  prompt text NOT NULL,
  options text[],
  feedback text,
  details jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'published',
  answer jsonb
);

CREATE TABLE public.room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES public.rooms(id),
  auth_user_id uuid,
  user_id uuid,
  display_name text NOT NULL,
  name_normalized text NOT NULL,
  guest_token_hash text,
  guest_token_expires_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  status text DEFAULT 'active'
);

CREATE TABLE public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES public.rooms(id),
  participant_id uuid REFERENCES public.room_participants(id),
  started_at timestamptz,
  finished_at timestamptz,
  status text,
  total_questions integer,
  answered_count integer,
  omitted_count integer,
  correct_count integer,
  score numeric,
  max_score numeric,
  events jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE public.attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid REFERENCES public.attempts(id) ON DELETE CASCADE,
  activity_id uuid,
  question_index integer,
  response jsonb,
  response_text text,
  status text,
  correct boolean,
  score numeric,
  time_seconds numeric
);

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY attempts_service_role_all ON public.attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY attempt_answers_service_role_all ON public.attempt_answers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY room_participants_service_role_all ON public.room_participants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY attempts_teacher_select ON public.attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = attempts.room_id AND r.owner_id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    )
  );

CREATE POLICY attempt_answers_teacher_select ON public.attempt_answers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attempts a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.id = attempt_answers.attempt_id AND r.owner_id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    )
  );

CREATE POLICY room_participants_teacher_select ON public.room_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.owner_id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    )
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.attempts, public.attempt_answers, public.rooms, public.room_participants TO anon, authenticated;

INSERT INTO public.rooms (id, owner_id, name, code, status, question_count, score_per_question)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999'::uuid,
  'Sala de Prueba Fase C', 'FASEC1', 'active', 2, 10
);

INSERT INTO public.activities (id, type, title, prompt)
VALUES 
  ('22222222-2222-4222-8222-222222222221', 'trueFalse', 'Pregunta 1', 'El ARN es ácido ribonucleico'),
  ('22222222-2222-4222-8222-222222222222', 'singleChoice', 'Pregunta 2', '¿Organelo de fotosíntesis?');

INSERT INTO public.room_activities (id, room_id, activity_id, position)
VALUES 
  ('33333333-3333-4333-8333-333333333331', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 1),
  ('33333333-3333-4333-8333-333333333332', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 2);

INSERT INTO public.room_participants (id, room_id, display_name, name_normalized, guest_token_hash, status)
VALUES 
  ('44444444-4444-4444-8444-444444444440', '11111111-1111-4111-8111-111111111111', 'Alumno Preexistente', 'alumno preexistente', 'hash-preexistente-secreto', 'completed'),
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', 'Alumno Uno', 'alumno uno', 'hash-uno', 'active'),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', 'Alumno Dos', 'alumno dos', 'hash-dos', 'active'),
  ('44444444-4444-4444-8444-444444444443', '11111111-1111-4111-8111-111111111111', 'Alumno Tres Concurrente', 'alumno tres concurrente', 'hash-tres', 'active');

INSERT INTO public.attempts (id, room_id, participant_id, status, total_questions, answered_count, omitted_count, correct_count, score, max_score)
VALUES (
  '55555555-5555-4555-8555-555555555550',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444440',
  'completed', 2, 2, 0, 2, 20, 20
);

INSERT INTO public.attempt_answers (id, attempt_id, activity_id, question_index, correct, score)
VALUES (
  '66666666-6666-4666-8666-666666666660',
  '55555555-5555-4555-8555-555555555550',
  '22222222-2222-4222-8222-222222222221',
  1, true, 10
);
EOF

echo "[5/9] Aplicando cadena real de migraciones SQL del repositorio (20261029141500 -> 20261029143500 -> 20261112100000)..." | tee -a "${LOG_FILE}"
${PSQL} -d "${DB_NAME}" -f supabase/migrations/20261029141500_attempt_answers_composite_index.sql >> "${LOG_FILE}" 2>&1
${PSQL} -d "${DB_NAME}" -f supabase/migrations/20261029143500_submit_student_attempt_atomic.sql >> "${LOG_FILE}" 2>&1
${PSQL} -d "${DB_NAME}" -f supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql >> "${LOG_FILE}" 2>&1

# Seed private secret inside activities_snapshot to test storage confidentiality (Q1)
${PSQL} -d "${DB_NAME}" -c "
SET ROLE service_role;
UPDATE public.room_participants
SET activities_snapshot = '{\"privateActivities\":[{\"id\":\"22222222-2222-4222-8222-222222222221\",\"secret\":\"CLAVE_SECRETA_Q1\"}]}'::jsonb
WHERE id = '44444444-4444-4444-8444-444444444440';
" >> "${LOG_FILE}" 2>&1

echo "[6/9] Verificando re-ejecución idempotente de 20261112100000..." | tee -a "${LOG_FILE}"
${PSQL} -d "${DB_NAME}" -f supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql >> "${LOG_FILE}" 2>&1
echo "✓ PASA: Cadena real de migraciones aplicada y re-ejecutable de forma idempotente." | tee -a "${LOG_FILE}"

echo "[7/9] Ejecutando batería de seguridad RLS, confidencialidad Q1, atomicidad y concurrencia..." | tee -a "${LOG_FILE}"

echo "--- PRUEBA 1: Denegación de llamada RPC para rol anon ---" | tee -a "${LOG_FILE}"
set +e
ANON_ERR=$(${PSQL} -d "${DB_NAME}" -c "
SET ROLE anon;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444441'::uuid,
  now(), now(), 'completed', 2, 2, 0, 2, 20, 20, '[]'::jsonb, '[]'::jsonb
);
" 2>&1)
ANON_RC=$?
set -e
echo "${ANON_ERR}" >> "${LOG_FILE}"
if [[ ${ANON_RC} -ne 0 ]] && echo "${ANON_ERR}" | grep -q "permission denied for function submit_student_attempt_atomic"; then
  echo "✓ PASA: Rol anon fue rechazado con 'permission denied'." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: Rol anon no fue bloqueado como se esperaba (rc=${ANON_RC})." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 2: Denegación de llamada RPC para rol authenticated ---" | tee -a "${LOG_FILE}"
set +e
AUTH_ERR=$(${PSQL} -d "${DB_NAME}" -c "
SET ROLE authenticated;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444441'::uuid,
  now(), now(), 'completed', 2, 2, 0, 2, 20, 20, '[]'::jsonb, '[]'::jsonb
);
" 2>&1)
AUTH_RC=$?
set -e
echo "${AUTH_ERR}" >> "${LOG_FILE}"
if [[ ${AUTH_RC} -ne 0 ]] && echo "${AUTH_ERR}" | grep -q "permission denied for function submit_student_attempt_atomic"; then
  echo "✓ PASA: Rol authenticated fue rechazado con 'permission denied'." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: Rol authenticated no fue bloqueado como se esperaba (rc=${AUTH_RC})." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 3: Aislamiento RLS en attempts Y attempt_answers sobre filas preexistentes ---" | tee -a "${LOG_FILE}"
RLS_ATT_TOTAL=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempts;" | tail -n 1)
RLS_ATT_ANON=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE anon; SELECT count(*) FROM public.attempts;" | tail -n 1)
RLS_ATT_UNPRIV=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000'; SELECT count(*) FROM public.attempts;" | tail -n 1)
RLS_ATT_TEACHER=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE authenticated; SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999'; SELECT count(*) FROM public.attempts;" | tail -n 1)

RLS_ANS_TOTAL=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempt_answers;" | tail -n 1)
RLS_ANS_ANON=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE anon; SELECT count(*) FROM public.attempt_answers;" | tail -n 1)
RLS_ANS_UNPRIV=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000'; SELECT count(*) FROM public.attempt_answers;" | tail -n 1)
RLS_ANS_TEACHER=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE authenticated; SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999'; SELECT count(*) FROM public.attempt_answers;" | tail -n 1)

echo "attempts -> service_role=${RLS_ATT_TOTAL}, anon=${RLS_ATT_ANON}, unpriv=${RLS_ATT_UNPRIV}, teacher=${RLS_ATT_TEACHER}" | tee -a "${LOG_FILE}"
echo "attempt_answers -> service_role=${RLS_ANS_TOTAL}, anon=${RLS_ANS_ANON}, unpriv=${RLS_ANS_UNPRIV}, teacher=${RLS_ANS_TEACHER}" | tee -a "${LOG_FILE}"

if [[ "${RLS_ATT_TOTAL}" == "1" ]] && [[ "${RLS_ATT_ANON}" == "0" ]] && [[ "${RLS_ATT_UNPRIV}" == "0" ]] && [[ "${RLS_ATT_TEACHER}" == "1" ]] && \
   [[ "${RLS_ANS_TOTAL}" == "1" ]] && [[ "${RLS_ANS_ANON}" == "0" ]] && [[ "${RLS_ANS_UNPRIV}" == "0" ]] && [[ "${RLS_ANS_TEACHER}" == "1" ]]; then
  echo "✓ PASA: RLS aísla filas preexistentes en BOTH attempts y attempt_answers." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: RLS no aisló adecuadamente attempts y/o attempt_answers." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 3B (Q1): Confidencialidad de almacenamiento de activities_snapshot y token hash en room_participants ---" | tee -a "${LOG_FILE}"
set +e
RP_ANON_ERR=$(${PSQL} -d "${DB_NAME}" -c "SET ROLE anon; SELECT id FROM public.room_participants;" 2>&1)
RP_ANON_RC=$?
RP_AUTH_STAR_ERR=$(${PSQL} -d "${DB_NAME}" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999'; SELECT * FROM public.room_participants;" 2>&1)
RP_AUTH_STAR_RC=$?
RP_AUTH_SNAP_ERR=$(${PSQL} -d "${DB_NAME}" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999'; SELECT activities_snapshot FROM public.room_participants;" 2>&1)
RP_AUTH_SNAP_RC=$?
RP_AUTH_HASH_ERR=$(${PSQL} -d "${DB_NAME}" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999'; SELECT guest_token_hash FROM public.room_participants;" 2>&1)
RP_AUTH_HASH_RC=$?
set -e
RP_AUTH_SAFE_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE authenticated; SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999'; SELECT count(*) FROM (SELECT id, room_id, display_name, joined_at, status FROM public.room_participants) safe_q;" | tail -n 1)
RP_AUTH_UNPRIV_SAFE=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000'; SELECT count(*) FROM (SELECT id, room_id, display_name, joined_at, status FROM public.room_participants) safe_q;" | tail -n 1)
RP_SERVICE_SNAP=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT activities_snapshot->'privateActivities'->0->>'secret' FROM public.room_participants WHERE id = '44444444-4444-4444-8444-444444444440';" | tail -n 1)

echo "anon_err=${RP_ANON_ERR} | auth_star=${RP_AUTH_STAR_ERR} | auth_snap=${RP_AUTH_SNAP_ERR} | auth_hash=${RP_AUTH_HASH_ERR}" >> "${LOG_FILE}"
echo "teacher_safe_rows=${RP_AUTH_SAFE_COUNT} | unpriv_safe_rows=${RP_AUTH_UNPRIV_SAFE} | service_secret=${RP_SERVICE_SNAP}" | tee -a "${LOG_FILE}"

if [[ ${RP_ANON_RC} -ne 0 ]] && echo "${RP_ANON_ERR}" | grep -q "permission denied" && \
   [[ ${RP_AUTH_STAR_RC} -ne 0 ]] && echo "${RP_AUTH_STAR_ERR}" | grep -q "permission denied" && \
   [[ ${RP_AUTH_SNAP_RC} -ne 0 ]] && echo "${RP_AUTH_SNAP_ERR}" | grep -q "permission denied" && \
   [[ ${RP_AUTH_HASH_RC} -ne 0 ]] && echo "${RP_AUTH_HASH_ERR}" | grep -q "permission denied" && \
   [[ "${RP_AUTH_SAFE_COUNT}" == "4" ]] && \
   [[ "${RP_AUTH_UNPRIV_SAFE}" == "0" ]] && \
   [[ "${RP_SERVICE_SNAP}" == "CLAVE_SECRETA_Q1" ]]; then
  echo "✓ PASA: activities_snapshot y guest_token_hash son inaccesibles para anon y authenticated; solo service_role los lee." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: Confidencialidad de room_participants comprometida o lectura segura docente rota." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 4: Inserción autorizada atómica con occurrence_id bajo rol service_role ---" | tee -a "${LOG_FILE}"
${PSQL} -d "${DB_NAME}" << 'EOF' >> "${LOG_FILE}" 2>&1
SET ROLE service_role;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444441'::uuid,
  now(), now(), 'completed', 2, 2, 0, 2, 20, 20,
  '[]'::jsonb,
  '[
    {"activity_id": "22222222-2222-4222-8222-222222222221", "occurrence_id": "33333333-3333-4333-8333-333333333331", "question_index": 1, "response": {"type": "trueFalse", "value": "Verdadero"}, "correct": true, "score": 10},
    {"activity_id": "22222222-2222-4222-8222-222222222222", "occurrence_id": "33333333-3333-4333-8333-333333333332", "question_index": 2, "response": {"type": "singleChoice", "value": "Cloroplasto"}, "correct": true, "score": 10}
  ]'::jsonb
);
EOF

ATTEMPTS_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempts WHERE participant_id = '44444444-4444-4444-8444-444444444441';" | tail -n 1)
ANSWERS_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempt_answers WHERE occurrence_id IN ('33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332');" | tail -n 1)
PART_STATUS=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT status FROM public.room_participants WHERE id = '44444444-4444-4444-8444-444444444441';" | tail -n 1)

if [[ "${ATTEMPTS_COUNT}" == "1" ]] && [[ "${ANSWERS_COUNT}" == "2" ]] && [[ "${PART_STATUS}" == "completed" ]]; then
  echo "✓ PASA: Inserción atómica exitosa (1 intento, 2 respuestas con occurrence_id y status completed)." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: Inconsistencia en inserción autorizada de intento." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 5: Concurrencia real bajo condición de carrera (fixture íntegro 2 preguntas, wait sin || true) ---" | tee -a "${LOG_FILE}"
CONC_OUT_A="/tmp/evaluedu_conc_a.txt"
CONC_OUT_B="/tmp/evaluedu_conc_b.txt"

INTEGRAL_FIXTURE='[
  {"activity_id": "22222222-2222-4222-8222-222222222221", "occurrence_id": "33333333-3333-4333-8333-333333333331", "question_index": 1, "score": 10, "correct": true},
  {"activity_id": "22222222-2222-4222-8222-222222222222", "occurrence_id": "33333333-3333-4333-8333-333333333332", "question_index": 2, "score": 10, "correct": true}
]'

${PSQL} -d "${DB_NAME}" -t -A -c "
SET ROLE service_role;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444443'::uuid,
  now(), now(), 'completed', 2, 2, 0, 2, 20, 20,
  '[]'::jsonb,
  '${INTEGRAL_FIXTURE}'::jsonb
);
" > "${CONC_OUT_A}" 2>&1 &
PID_A=$!

${PSQL} -d "${DB_NAME}" -t -A -c "
SET ROLE service_role;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444443'::uuid,
  now(), now(), 'completed', 2, 2, 0, 2, 20, 20,
  '[]'::jsonb,
  '${INTEGRAL_FIXTURE}'::jsonb
);
" > "${CONC_OUT_B}" 2>&1 &
PID_B=$!

wait ${PID_A}
STATUS_A=$?
wait ${PID_B}
STATUS_B=$?

if [ ${STATUS_A} -ne 0 ] || [ ${STATUS_B} -ne 0 ]; then
  echo "✗ FALLA: Uno o ambos procesos concurrentes fallaron con código no cero (A=${STATUS_A}, B=${STATUS_B})." | tee -a "${LOG_FILE}"
  exit 1
fi

RES_A=$(cat "${CONC_OUT_A}")
RES_B=$(cat "${CONC_OUT_B}")
echo "Resultado Proceso Concurrente A: ${RES_A}" >> "${LOG_FILE}"
echo "Resultado Proceso Concurrente B: ${RES_B}" >> "${LOG_FILE}"

ID_A=$(echo "${RES_A}" | grep -o '"attemptId": "[^"]*"' | cut -d'"' -f4 || echo "")
ID_B=$(echo "${RES_B}" | grep -o '"attemptId": "[^"]*"' | cut -d'"' -f4 || echo "")
SAVED_A=$(echo "${RES_A}" | grep -o '"alreadySaved": [^,}]*' | sed -E 's/.*"alreadySaved": ([^,} ]+).*/\1/')
SAVED_B=$(echo "${RES_B}" | grep -o '"alreadySaved": [^,}]*' | sed -E 's/.*"alreadySaved": ([^,} ]+).*/\1/')

CONC_ATTEMPT_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempts WHERE participant_id = '44444444-4444-4444-8444-444444444443';" | tail -n 1)
CONC_ANSWERS_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempt_answers a JOIN public.attempts att ON att.id = a.attempt_id WHERE att.participant_id = '44444444-4444-4444-8444-444444444443';" | tail -n 1)
CONC_PERSISTED_SCORE=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT score FROM public.attempts WHERE participant_id = '44444444-4444-4444-8444-444444444443';" | tail -n 1)

if [[ "${CONC_ATTEMPT_COUNT}" == "1" ]] && \
   [[ "${CONC_ANSWERS_COUNT}" == "2" ]] && \
   [[ "${CONC_PERSISTED_SCORE}" == "20" ]] && \
   [[ "${ID_A}" == "${ID_B}" ]] && \
   [[ -n "${ID_A}" ]] && \
   { { [[ "${SAVED_A}" == "false" ]] && [[ "${SAVED_B}" == "true" ]]; } || { [[ "${SAVED_A}" == "true" ]] && [[ "${SAVED_B}" == "false" ]]; }; }; then
  echo "✓ PASA: Concurrencia serializada estrictamente: ambos exit 0, mismo attemptId (${ID_A}), 1 registro inicial, 1 acuse idempotente, 2 respuestas y nota 20." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: Inconsistencia concurrente (attempts=${CONC_ATTEMPT_COUNT}, answers=${CONC_ANSWERS_COUNT}, score=${CONC_PERSISTED_SCORE}, savedA=${SAVED_A}, savedB=${SAVED_B})." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 6: Idempotencia y re-envío con nota alterada bajo rol service_role ---" | tee -a "${LOG_FILE}"
SECOND_CALL_RES=$(${PSQL} -d "${DB_NAME}" -t -A -c "
SET ROLE service_role;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444441'::uuid,
  now(), now(), 'completed', 2, 0, 2, 0, 0, 20,
  '[]'::jsonb, '[]'::jsonb
);
")
echo "Resultado de reenvío: ${SECOND_CALL_RES}" >> "${LOG_FILE}"

IS_ALREADY_SAVED=$(echo "${SECOND_CALL_RES}" | grep -o '"alreadySaved": [^,}]*' | sed -E 's/.*"alreadySaved": ([^,} ]+).*/\1/')
RETURNED_SCORE=$(echo "${SECOND_CALL_RES}" | grep -o '"score": [^,}]*' | sed -E 's/.*"score": ([^,} ]+).*/\1/')
PERSISTED_SCORE=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT score FROM public.attempts WHERE participant_id = '44444444-4444-4444-8444-444444444441';" | tail -n 1)

if [[ "${IS_ALREADY_SAVED}" == "true" ]] && [[ "${RETURNED_SCORE}" == "20" ]] && [[ "${PERSISTED_SCORE}" == "20" ]]; then
  echo "✓ PASA: Idempotencia verificada; el re-envío alterado preservó la nota original (20)." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: La nota persistida fue alterada (score=${RETURNED_SCORE}, persistido=${PERSISTED_SCORE}, alreadySaved=${IS_ALREADY_SAVED})." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "--- PRUEBA 7: Rollback transaccional íntegro ante error inducido en payload ---" | tee -a "${LOG_FILE}"
set +e
ROLLBACK_ERR=$(${PSQL} -d "${DB_NAME}" -c "
SET ROLE service_role;
SELECT public.submit_student_attempt_atomic(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '44444444-4444-4444-8444-444444444442'::uuid,
  now(), now(), 'completed', 2, 1, 0, 1, 10, 20,
  '[]'::jsonb,
  '[{\"activity_id\": \"not-a-valid-uuid\", \"occurrence_id\": \"occ-fail\"}]'::jsonb
);
" 2>&1)
ROLLBACK_RC=$?
set -e
echo "${ROLLBACK_ERR}" >> "${LOG_FILE}"

ATTEMPTS_FAIL_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempts WHERE participant_id = '44444444-4444-4444-8444-444444444442';" | tail -n 1)
ANSWERS_FAIL_COUNT=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT count(*) FROM public.attempt_answers WHERE occurrence_id = 'occ-fail';" | tail -n 1)
PART2_STATUS=$(${PSQL} -d "${DB_NAME}" -t -A -c "SET ROLE service_role; SELECT status FROM public.room_participants WHERE id = '44444444-4444-4444-8444-444444444442';" | tail -n 1)

if [[ ${ROLLBACK_RC} -ne 0 ]] && echo "${ROLLBACK_ERR}" | grep -q "invalid input syntax for type uuid" && \
   [[ "${ATTEMPTS_FAIL_COUNT}" == "0" ]] && \
   [[ "${ANSWERS_FAIL_COUNT}" == "0" ]] && \
   [[ "${PART2_STATUS}" == "active" ]]; then
  echo "✓ PASA: Rollback verificado; error de UUID canceló la transacción sin dejar huérfanos." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: El fallo de escritura no ejecutó rollback completo (rc=${ROLLBACK_RC})." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "[8/9] --- PRUEBA 8 (Q4): Rama de migración con duplicados históricos en BD separada (${DUP_DB_NAME}) ---" | tee -a "${LOG_FILE}"
${PSQL} -d postgres -c "CREATE DATABASE ${DUP_DB_NAME};" >> "${LOG_FILE}" 2>&1
${PSQL} -d "${DUP_DB_NAME}" << 'EOF' >> "${LOG_FILE}" 2>&1
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE public.rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, name text, code text UNIQUE, status text DEFAULT 'active');
CREATE TABLE public.room_participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid REFERENCES public.rooms(id), display_name text, name_normalized text, guest_token_hash text, guest_token_expires_at timestamptz, status text DEFAULT 'active');
CREATE TABLE public.attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid REFERENCES public.rooms(id), participant_id uuid REFERENCES public.room_participants(id), started_at timestamptz, finished_at timestamptz, status text, total_questions integer, answered_count integer, omitted_count integer, correct_count integer, score numeric, max_score numeric, events jsonb DEFAULT '[]'::jsonb);
CREATE TABLE public.attempt_answers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid REFERENCES public.attempts(id) ON DELETE CASCADE, activity_id uuid, question_index integer, response jsonb, response_text text, status text, correct boolean, score numeric, time_seconds numeric);

INSERT INTO public.rooms (id, owner_id, name, code) VALUES ('77777777-7777-4777-8777-777777777770', '99999999-9999-4999-8999-999999999999', 'Sala Dups', 'DUPS01');
INSERT INTO public.room_participants (id, room_id, display_name, name_normalized) VALUES ('77777777-7777-4777-8777-777777777771', '77777777-7777-4777-8777-777777777770', 'Alumno Duplicado Histórico', 'alumno duplicado historico');

-- Insertar DOS intentos históricos duplicados para el mismo participant_id antes de aplicar la migración
INSERT INTO public.attempts (id, room_id, participant_id, status, total_questions, score, max_score)
VALUES
  ('88888888-8888-4888-8888-888888888881', '77777777-7777-4777-8777-777777777770', '77777777-7777-4777-8777-777777777771', 'completed', 2, 10, 20),
  ('88888888-8888-4888-8888-888888888882', '77777777-7777-4777-8777-777777777770', '77777777-7777-4777-8777-777777777771', 'completed', 2, 20, 20);
EOF

DUP_MIGRATION_OUT=$(${PSQL} -d "${DUP_DB_NAME}" -f supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql 2>&1)
echo "${DUP_MIGRATION_OUT}" >> "${LOG_FILE}"

DUP_ROW_COUNT=$(${PSQL} -d "${DUP_DB_NAME}" -t -A -c "SELECT count(*) FROM public.attempts WHERE participant_id = '77777777-7777-4777-8777-777777777771';" | tail -n 1)
REGULAR_IDX=$(${PSQL} -d "${DUP_DB_NAME}" -t -A -c "SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'idx_attempts_participant_id';" | tail -n 1)
UNIQUE_IDX_EXISTS=$(${PSQL} -d "${DUP_DB_NAME}" -t -A -c "SELECT count(*) FROM pg_class WHERE relname = 'uidx_attempts_participant_id';" | tail -n 1)

if echo "${DUP_MIGRATION_OUT}" | grep -q "Existen 1 participantes con intentos duplicados históricos; se crea índice regular preservando los registros." && \
   [[ "${DUP_ROW_COUNT}" == "2" ]] && \
   [[ "${REGULAR_IDX}" == "f" ]] && \
   [[ "${UNIQUE_IDX_EXISTS}" == "0" ]]; then
  echo "✓ PASA: Rama de duplicados históricos ejecutada: NOTICE emitido, 2 registros preservados sin borrado, índice regular (indisunique=f) creado y uidx ausente." | tee -a "${LOG_FILE}"
else
  echo "✗ FALLA: Comportamiento incorrecto en rama de duplicados históricos (rows=${DUP_ROW_COUNT}, regular_unique=${REGULAR_IDX}, uidx=${UNIQUE_IDX_EXISTS})." | tee -a "${LOG_FILE}"
  exit 1
fi

echo "[9/9] Resumen final de verificación SQL..." | tee -a "${LOG_FILE}"
echo "================================================================================" | tee -a "${LOG_FILE}"
echo "TODAS LAS PRUEBAS DE POSTGRESQL REAL AISLADO FUERON SUPERADAS AL 100% (9/9 PASAN)" | tee -a "${LOG_FILE}"
echo "================================================================================" | tee -a "${LOG_FILE}"
