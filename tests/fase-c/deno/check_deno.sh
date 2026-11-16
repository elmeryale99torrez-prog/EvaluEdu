#!/usr/bin/env bash
set -uo pipefail

# Verificación portable de tipos Deno para Edge Functions de EvaluEdu v1.3 (Q4)
# Uso:
#   DENO_BIN=/ruta/al/deno bash tests/fase-c/deno/check_deno.sh
# O con deno disponible en PATH o ~/.deno/bin/deno.
# No requiere conexión a producción. Si Deno no está instalado, registra BLOQUEADO explícito y sale con código 2.

LOG_FILE="docs/orchestration/fase-c/evidencias/deno_check.log"
EXIT_FILE="docs/orchestration/fase-c/evidencias/deno_check_exit_code.txt"

mkdir -p "$(dirname "${LOG_FILE}")"

RESOLVED_DENO=""
if [[ -n "${DENO_BIN:-}" ]] && [[ -x "${DENO_BIN}" ]]; then
  RESOLVED_DENO="${DENO_BIN}"
elif command -v deno >/dev/null 2>&1; then
  RESOLVED_DENO="$(command -v deno)"
elif [[ -x "${HOME}/.deno/bin/deno" ]]; then
  RESOLVED_DENO="${HOME}/.deno/bin/deno"
fi

if [[ -z "${RESOLVED_DENO}" ]]; then
  {
    echo "================================================================================"
    echo "EVALUEDU v1.3 · VERIFICACIÓN DENO PORTABLE · ESTADO: BLOQUEADO"
    echo "Fecha: $(date -u +'%Y-%m-%d %H:%M:%SZ')"
    echo "Causa: No se encontró ejecutable 'deno' en DENO_BIN, PATH ni ${HOME}/.deno/bin/deno."
    echo "Exit code: 2"
    echo "================================================================================"
  } | tee "${LOG_FILE}"
  echo "2" > "${EXIT_FILE}"
  exit 2
fi

TARGETS=(
  "supabase/functions/student-room-guest/index.ts"
  "supabase/functions/student-room-sync/index.ts"
  "supabase/functions/_shared/activityEvaluator.ts"
  "supabase/functions/_shared/rateLimiter.ts"
)

DENO_VERSION="$("${RESOLVED_DENO}" --version 2>&1)"
CMD_STR="${RESOLVED_DENO} check ${TARGETS[*]}"

{
  echo "================================================================================"
  echo "EVALUEDU v1.3 · VERIFICACIÓN DENO PORTABLE (Q4)"
  echo "Fecha: $(date -u +'%Y-%m-%d %H:%M:%SZ')"
  echo "Binario resuelto: ${RESOLVED_DENO}"
  echo "Versión:"
  echo "${DENO_VERSION}"
  echo "Comando ejecutado: ${CMD_STR}"
  echo "--------------------------------------------------------------------------------"
} > "${LOG_FILE}"

"${RESOLVED_DENO}" check "${TARGETS[@]}" >> "${LOG_FILE}" 2>&1
RC=$?

{
  echo "--------------------------------------------------------------------------------"
  echo "Exit code: ${RC}"
  echo "================================================================================"
} >> "${LOG_FILE}"

echo "${RC}" > "${EXIT_FILE}"
cat "${LOG_FILE}"
exit "${RC}"
