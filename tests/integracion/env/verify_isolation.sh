#!/usr/bin/env bash
set -euo pipefail

# Verificación de aislamiento previa a cualquier ejecución de LAB-RC-001.
# Rechaza variables de entorno productivas, enlaces Supabase CLI activos o archivos .env locales reales.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

ERRORS=0

check_absent_env_file() {
  local f="$1"
  if [[ -f "${REPO_ROOT}/${f}" ]]; then
    echo "BLOQUEO_AISLAMIENTO: Existe ${f} en la raíz del repositorio." >&2
    ERRORS=$((ERRORS + 1))
  fi
}

check_absent_env_file ".env"
check_absent_env_file ".env.local"
check_absent_env_file ".env.production"
check_absent_env_file ".env.production.local"

if [[ -f "${REPO_ROOT}/supabase/.temp/project-ref" ]] || [[ -f "${REPO_ROOT}/supabase/.temp/gotrue-version" ]]; then
  echo "BLOQUEO_AISLAMIENTO: Enlace Supabase CLI remoto detectado en supabase/.temp/" >&2
  ERRORS=$((ERRORS + 1))
fi

for var in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL DATABASE_URL; do
  val="${!var:-}"
  if [[ -n "${val}" ]] && [[ "${val}" != *"127.0.0.1"* ]] && [[ "${val}" != *"localhost"* ]] && [[ "${val}" != *"SYNTHETIC_RC_LOCAL"* ]]; then
    echo "BLOQUEO_AISLAMIENTO: Variable ${var} apunta a un destino no local." >&2
    ERRORS=$((ERRORS + 1))
  fi
done

for bin in /usr/lib/postgresql/15/bin/initdb /usr/lib/postgresql/15/bin/pg_ctl /usr/lib/postgresql/15/bin/psql /home/antigravity/.deno/bin/deno /usr/bin/chromium; do
  if [[ ! -x "${bin}" ]]; then
    echo "BLOQUEO_HERRAMIENTA: Binario requerido no encontrado o sin permiso de ejecución: ${bin}" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [[ "${ERRORS}" -gt 0 ]]; then
  echo "VERIFY_ISOLATION: FALLO (${ERRORS} hallazgos)." >&2
  exit 1
fi

echo "VERIFY_ISOLATION: OK"
echo "  postgres=$(/usr/lib/postgresql/15/bin/postgres --version)"
echo "  deno=$(/home/antigravity/.deno/bin/deno --version | head -n 1)"
echo "  node=$(node --version)"
echo "  chromium=$(/usr/bin/chromium --version)"
echo "  git_head=$(git rev-parse HEAD)"
