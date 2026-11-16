#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

bash "${REPO_ROOT}/tests/integracion/env/verify_isolation.sh"
bash "${REPO_ROOT}/tests/integracion/env/stop_env.sh"

WORK_DIR="/tmp/evaluedu_rc_runtime"
PG_DIR="${WORK_DIR}/pg"
BIN_DIR="${WORK_DIR}/bin"
LOG_DIR="${WORK_DIR}/logs"
PID_DIR="${WORK_DIR}/pids"
DIST_DIR="${WORK_DIR}/dist"
EVID_DIR="${EVIDENCIAS_DIR:-${REPO_ROOT}/docs/orchestration/fase-fg/evidencias}"

PG_PORT=54339
GATEWAY_PORT=54340
APP_PORT=54341
PGRST_PORT=54342
DENO_BASE_PORT=54350
DB_NAME="evaluedu_rc_isolated"
REHEARSAL_DB="evaluedu_rc_rehearsal"

rm -rf "${PG_DIR}" "${LOG_DIR}" "${PID_DIR}" "${DIST_DIR}"
mkdir -p "${PG_DIR}" "${BIN_DIR}" "${LOG_DIR}" "${PID_DIR}" "${DIST_DIR}" "${EVID_DIR}"

if [[ ! -x "${BIN_DIR}/postgrest" ]]; then
  echo "[RC-ENV] Descargando PostgREST v12.2.3 en espacio de usuario (${BIN_DIR})..."
  curl -sSL -o "${BIN_DIR}/postgrest.tar.xz" \
    "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz"
  tar -xJf "${BIN_DIR}/postgrest.tar.xz" -C "${BIN_DIR}"
  chmod +x "${BIN_DIR}/postgrest"
fi

echo "[RC-ENV] Inicializando cluster PostgreSQL 15 aislado en ${PG_DIR} (puerto ${PG_PORT})..."
/usr/lib/postgresql/15/bin/initdb -D "${PG_DIR}" --no-sync -A trust -U antigravity > "${LOG_DIR}/initdb.log" 2>&1
/usr/lib/postgresql/15/bin/pg_ctl -D "${PG_DIR}" -l "${LOG_DIR}/postgres.log" -o "-k /tmp -p ${PG_PORT} -h 127.0.0.1" start >/dev/null

PSQL="/usr/lib/postgresql/15/bin/psql -v ON_ERROR_STOP=1 -h /tmp -p ${PG_PORT} -U antigravity"
${PSQL} -d postgres -c "CREATE DATABASE ${DB_NAME};" >/dev/null
${PSQL} -d postgres -c "CREATE DATABASE ${REHEARSAL_DB};" >/dev/null

MIG_LOG="${EVID_DIR}/sql_migrations_isolated.log"
{
  echo "================================================================================"
  echo "LAB-RC-001 · APLICACIÓN DE ESQUEMA REPRESENTATIVO Y 6 MIGRACIONES EN ORDEN"
  echo "Base de datos: ${DB_NAME} (PostgreSQL 15 en puerto ${PG_PORT})"
  echo "ADVERTENCIA: El repositorio carece de 0000_init.sql; se aplica schema_representativo.sql"
  echo "y encima las 6 migraciones reales sin alterar."
  echo "================================================================================"
  echo "--- [0] tests/integracion/env/schema_representativo.sql ---"
  ${PSQL} -d "${DB_NAME}" -f "${REPO_ROOT}/tests/integracion/env/schema_representativo.sql"
  for mig in \
    supabase/migrations/20261021154245_restrict_anonymous_access.sql \
    supabase/migrations/20261029141500_attempt_answers_composite_index.sql \
    supabase/migrations/20261029143500_submit_student_attempt_atomic.sql \
    supabase/migrations/20261029160000_audit_events_immutability.sql \
    supabase/migrations/20261112100000_fase_c_atomic_submission_and_grants.sql \
    supabase/migrations/20261116120000_fase_fg_institutions_and_quotas.sql; do
    echo "--- [MIG] ${mig} ---"
    ${PSQL} -d "${DB_NAME}" -f "${REPO_ROOT}/${mig}"
  done
  echo "MIGRATIONS_OK=true"
} > "${MIG_LOG}" 2>&1

echo "[RC-ENV] Generando claves efímeras en memoria y sembrando usuarios sintéticos..."
node --input-type=module - <<'EOF'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RC_CONFIG } from './tests/integracion/config/rc.config.mjs';
import { PgClient } from './tests/integracion/env/pg_wire.mjs';
import { signJwtHs256 } from './tests/integracion/env/supabase_local_gateway.mjs';

const jwtSecret = `rc_ephemeral_jwt_secret_${crypto.randomBytes(24).toString('hex')}`;
const nowSec = Math.floor(Date.now() / 1000);
const expSec = nowSec + 7200;

const anonKey = signJwtHs256(
  { role: 'anon', iss: 'supabase-rc-local', iat: nowSec, exp: expSec },
  jwtSecret,
);
const serviceRoleKey = signJwtHs256(
  { role: 'service_role', iss: 'supabase-rc-local', iat: nowSec, exp: expSec },
  jwtSecret,
);

const client = new PgClient({
  socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
  user: RC_CONFIG.postgres.superuser,
  database: RC_CONFIG.postgres.dbName,
});
await client.connect();

const usersOut = {};
for (const [key, u] of Object.entries(RC_CONFIG.syntheticUsers)) {
  const password = `${RC_CONFIG.syntheticPasswordPrefix}${key}_${crypto.randomBytes(4).toString('hex')}`;
  usersOut[key] = { ...u, password };
  await client.query(
    `INSERT INTO auth.users(id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
     VALUES ($1, $2, crypt($3, gen_salt('bf')), now(), $4::jsonb, '{"provider":"email","providers":["email"]}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [u.id, u.email, password, JSON.stringify({ display_name: u.displayName, role: u.role, password_initialized: true })],
  );
  await client.query(
    `INSERT INTO public.profiles(id, display_name, role, roles)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, roles = EXCLUDED.roles`,
    [u.id, u.displayName, u.role, u.roles],
  );
}
await client.close();

const state = {
  jwtSecret,
  anonKey,
  serviceRoleKey,
  postgrestPort: 54342,
  gatewayUrl: `http://127.0.0.1:${RC_CONFIG.ports.gateway}`,
  appUrl: `http://127.0.0.1:${RC_CONFIG.ports.gateway}`,
  users: usersOut,
};
fs.writeFileSync(path.join(RC_CONFIG.workDir, 'runtime_state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
EOF

JWT_SECRET="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${WORK_DIR}/runtime_state.json','utf8')).jwtSecret)")"
ANON_KEY="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${WORK_DIR}/runtime_state.json','utf8')).anonKey)")"
SERVICE_KEY="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${WORK_DIR}/runtime_state.json','utf8')).serviceRoleKey)")"

cat > "${WORK_DIR}/postgrest.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:${PG_PORT}/${DB_NAME}"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public"
jwt-secret = "${JWT_SECRET}"
server-host = "127.0.0.1"
server-port = ${PGRST_PORT}
EOF

echo "[RC-ENV] Arrancando PostgREST v12.2.3 en 127.0.0.1:${PGRST_PORT}..."
setsid "${BIN_DIR}/postgrest" "${WORK_DIR}/postgrest.conf" > "${LOG_DIR}/postgrest.log" 2>&1 &
echo $! > "${PID_DIR}/postgrest.pid"

FUNCTIONS=(
  "student-room-guest"
  "student-room-sync"
  "admin-platform-data"
  "admin-create-pilot-teacher"
  "admin-invite-teacher"
  "admin-remove-user"
  "admin-resend-access"
)

for idx in "${!FUNCTIONS[@]}"; do
  fn="${FUNCTIONS[$idx]}"
  port=$((DENO_BASE_PORT + idx))
  echo "[RC-ENV] Arrancando Edge Function ${fn} en 127.0.0.1:${port}..."
  SUPABASE_URL="http://127.0.0.1:${GATEWAY_PORT}" \
  SUPABASE_PUBLISHABLE_KEY="${ANON_KEY}" \
  SUPABASE_ANON_KEY="${ANON_KEY}" \
  SUPABASE_SERVICE_ROLE_KEY="${SERVICE_KEY}" \
  APP_URL="http://127.0.0.1:${APP_PORT}" \
  setsid env NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" /home/antigravity/.deno/bin/deno run --allow-net --allow-env --allow-read \
    "${REPO_ROOT}/tests/integracion/env/run_edge_function.ts" \
    "${port}" "${REPO_ROOT}/supabase/functions/${fn}/index.ts" \
    > "${LOG_DIR}/fn_${fn}.log" 2>&1 &
  echo $! > "${PID_DIR}/fn_${fn}.pid"
done

echo "[RC-ENV] Compilando frontend en ${DIST_DIR} contra pasarela local..."
VITE_SUPABASE_URL="http://127.0.0.1:${GATEWAY_PORT}" \
VITE_SUPABASE_PUBLISHABLE_KEY="${ANON_KEY}" \
VITE_SUPABASE_ANON_KEY="${ANON_KEY}" \
npx vite build --outDir "${DIST_DIR}" --emptyOutDir > "${LOG_DIR}/vite_build_rc.log" 2>&1

echo "[RC-ENV] Arrancando pasarela HTTP (${GATEWAY_PORT}) y servidor de aplicación (${APP_PORT})..."
setsid node "${REPO_ROOT}/tests/integracion/env/supabase_local_gateway.mjs" > "${LOG_DIR}/gateway.log" 2>&1 &
echo $! > "${PID_DIR}/gateway.pid"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/__rc_control/health" >/dev/null 2>&1 && \
     curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done

curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/__rc_control/health" >/dev/null
curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null
echo "START_ENV: OK (gateway=127.0.0.1:${GATEWAY_PORT}, app=127.0.0.1:${APP_PORT}, pg=127.0.0.1:${PG_PORT})"
