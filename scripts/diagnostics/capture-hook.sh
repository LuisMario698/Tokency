#!/bin/sh
# Hook de diagnóstico temporal de la Fase 0 (docs/DECISIONS.md, D-005).
#
# Guarda el payload de cada evento de Claude Code fuera del repo, en
# ~/Library/Logs/Tokency/diagnostics/, con permisos 0600. Nunca imprime nada
# (en SessionStart y UserPromptSubmit la salida se inyectaría como contexto) y
# siempre sale con 0 para no bloquear ni romper Claude Code.
#
# Solo usa rutas absolutas del sistema: el PATH de cada origen puede ser distinto.

umask 077
event="${1:-unknown}"
dir="${HOME}/Library/Logs/Tokency/diagnostics"
/bin/mkdir -p "$dir" 2>/dev/null || exit 0
base="$dir/$(/bin/date -u +%Y%m%dT%H%M%SZ)-$$-${event}"

# El payload tal cual llega por stdin.
/bin/cat >"$base.payload.json" 2>/dev/null

{
  printf 'captured_at=%s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'event_arg=%s\n' "$event"
  printf 'pid=%s\n' "$$"

  # Cadena de procesos padre con una sola llamada a ps: solo el ejecutable, nunca los argumentos.
  /bin/ps -Ao pid=,ppid=,comm= 2>/dev/null | /usr/bin/awk -v start="$PPID" '
    { id = $1; parent[id] = $2; $1 = ""; $2 = ""; sub(/^ +/, ""); comm[id] = $0 }
    END {
      p = start
      for (d = 0; d < 25 && p > 1 && (p in parent); d++) {
        printf "parent.%d=%s %s\n", d, p, comm[p]
        p = parent[p]
      }
    }'

  # Valores de una lista cerrada de variables que no contienen secretos.
  for name in __CFBundleIdentifier XPC_SERVICE_NAME TERM_PROGRAM TERM_PROGRAM_VERSION TERM \
    CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SSE_PORT ENABLE_IDE_INTEGRATION \
    CLAUDE_PROJECT_DIR CLAUDE_CODE_REMOTE CLAUDE_EFFORT CLAUDE_AGENT_SDK_VERSION \
    CLAUDE_CONFIG_DIR VSCODE_PID SHELL PWD PATH; do
    eval "isset=\${$name+x}"
    if [ -n "$isset" ]; then
      eval "value=\${$name}"
      printf 'env.%s=%s\n' "$name" "$value"
    fi
  done

  # Del resto del entorno, solo los nombres.
  /usr/bin/env -0 2>/dev/null | /usr/bin/tr '\n\0' ' \n' | /usr/bin/sed -e 's/=.*//' -e 's/^/env_name=/'
} >"$base.meta.txt" 2>/dev/null

exit 0
