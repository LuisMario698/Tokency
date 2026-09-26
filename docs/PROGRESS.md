# Progreso de Tokency

Registro vivo del avance por fases. La especificación completa está en [SPEC.md](SPEC.md) y las decisiones en [DECISIONS.md](DECISIONS.md).

| Fase                         | Estado       |
| ---------------------------- | ------------ |
| 0 — Preparación y validación | ✅ Terminada |
| 1 — Sesiones en vivo         | 🟡 En curso  |
| 2 — Uso                      | ⚪ Pendiente |
| 3 — Proyectos y GitHub       | ⚪ Pendiente |
| 4 — Contexto                 | ⚪ Pendiente |
| 5 — Google Drive             | ⚪ Pendiente |
| 6 — Migración de Obsidian    | ⚪ Pendiente |
| 7 — Extras                   | ⚪ Pendiente |
| 8 — iPhone                   | ⚪ Pendiente |

---

## Fase 0 — Preparación y validación

**Objetivo:** dejar listo el monorepo con su tooling y CI, y validar con datos reales cómo llegan los eventos de Claude Code desde cada origen antes de diseñar el core.

### Tareas

- [x] Guardar la especificación como `docs/SPEC.md` (primer commit).
- [x] Monorepo con pnpm workspaces: `packages/shared`, `packages/core`, `packages/cli`, `supabase/migrations/`, `scripts/`.
- [x] Tooling: TypeScript estricto, ESLint (type-checked), Prettier, Vitest.
- [x] `.gitignore` estricto: secretos, `.env*`, llaves, credenciales OAuth, bases locales, artefactos de Xcode.
- [x] CI en GitHub Actions: typecheck, lint, formato y pruebas.
- [x] Módulo de respaldo y fusión de `~/.claude/settings.json` en `packages/core` (con pruebas), reutilizable por `tokency install` en la Fase 1.
- [x] Hook de diagnóstico temporal (`scripts/diagnostics/`) que guarda los payloads fuera del repo.
- [x] 🛑 CHECKPOINT: sesiones de prueba en Terminal.app, la terminal integrada y la extensión de Antigravity, y la pestaña Code de Claude Desktop.
- [x] Análisis de las capturas y hallazgos en `docs/DECISIONS.md` (D-010).
- [x] Inventario de solo lectura del vault de Obsidian y de los comandos `memory-load`, `memory-save` y `supabase-switch`.
- [x] Desinstalar el hook de diagnóstico y verificar que `settings.json` quede como estaba (mismo SHA-1 que antes de instalar).
- [x] Borrar las capturas locales (con permiso del usuario).
- [x] Push y cierre de la fase.

### Archivos principales

- Raíz: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.prettierrc.json`, `.gitignore`, `.editorconfig`, `.nvmrc`.
- `.github/workflows/ci.yml`.
- `packages/core/src/claude-settings/`: fusión y respaldo de `settings.json`.
- `scripts/diagnostics/capture-hook.sh` y `scripts/diagnostics/diag-hooks.ts`.

### Criterios de aceptación

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` y `pnpm test` pasan en local y en CI.
- El hook de diagnóstico se instala y desinstala sin dejar rastro en `~/.claude/settings.json`.
- `docs/DECISIONS.md` documenta, por origen, qué eventos llegan, cómo distinguir el origen y dónde quedan los JSONL.
- Existe el inventario del vault y de los comandos, sin contenido personal.

### Cierre — 2026-09-25

- `pnpm check` pasa en local (44 pruebas). El CI corre por primera vez con el push de cierre.
- El hook de diagnóstico se instaló y desinstaló; `~/.claude/settings.json` quedó con el mismo SHA-1 que antes de instalar. Las capturas se borraron con permiso del usuario.
- Los respaldos de `settings.json` se conservan en `~/Library/Application Support/Tokency/backups/`.
- Decisiones de la fase: D-001 a D-010.

### Pendientes para la Fase 1

- Validar `SessionEnd` al cerrar Claude Desktop y la pestaña de la extensión, `Notification` `permission_prompt`, `SubagentStart` y `PreCompact` (D-010).
- Decidir cómo empaquetar el core y el CLI para que el hook arranque rápido y no dependa del `PATH` (D-004, D-010).
- Revisar la migración a TypeScript 7 cuando `typescript-eslint` la soporte (D-003).

---

## Fase 1 — Sesiones en vivo

**Objetivo:** ver cada sesión de Claude Code como una banda de color en el borde de la pantalla, en tiempo real, y que todo arranque solo al encender la Mac.

**Listo cuando:** abrir y usar sesiones en la terminal y en Antigravity se refleja en las bandas en tiempo real con el color correcto, y al reiniciar la Mac todo sigue funcionando sin intervención.

### Tareas

1. **Modelo compartido** (`packages/shared`): esquemas Zod del evento de hook saneado, de la sesión y de los eventos en vivo.
2. **Máquina de estados** (`packages/core/src/sessions/`): función pura con pruebas. Aplica las reglas de D-010: estados `working`, `waiting`, `done`, `idle` y `ended`; instancias por `session_id` + pid; eventos desordenados; `SubagentStop` interno ignorado.
3. **Core:**
   - Configuración en `~/Library/Application Support/Tokency/config.json`.
   - Logs rotativos en `~/Library/Logs/Tokency/`.
   - SQLite con `node:sqlite` (D-011) y migraciones versionadas.
   - Registro de sesiones persistente.
4. **API local** (Hono en `127.0.0.1:7777`):
   - Token Bearer guardado en el Llavero; revisión del encabezado `Host` y rechazo de peticiones de navegador.
   - Rutas `GET /v1/health`, `POST /v1/hooks`, `GET /v1/sessions` y `GET /v1/events` (SSE).
5. **Fuentes de respaldo:**
   - Vigilante de `~/.claude/projects/` con eventos del sistema de archivos.
   - Revisión del pid de `claude` para detectar que el proceso murió.
   - Umbrales de inactividad configurables.
6. **CLI `tokency`:**
   - `serve`: arranca el core.
   - `hook <evento>`: lee stdin, sanea el payload y lo reenvía al core; no imprime nada y siempre sale con 0.
   - `install`, `uninstall`, `uninstall-hooks`, `doctor`, `status` y `logs`.
7. **Empaquetado (D-013):** esbuild genera un solo bundle; `install` lo copia a `~/Library/Application Support/Tokency/app/` y deja un LaunchAgent y el comando `~/.local/bin/tokency`.
8. 🛑 **CHECKPOINT:** el usuario ejecuta `tokency install`, porque Claude no puede modificar `~/.claude/settings.json`. Después se verifica con `tokency doctor` y `tokency status`, usando sesiones reales.
9. **App de Mac** (`apps/mac`, SwiftPM, D-012):
   - Barra de menús con sesiones, estado del core y opción para reiniciarlo.
   - Bandas en un `NSPanel` que no roba el foco, visible en todos los Spaces y junto a apps en pantalla completa.
   - Al pasar el mouse la banda se expande; al hacer clic trae al frente la app de origen.
   - Soporta varios monitores y arranca al iniciar sesión (`SMAppService`).
10. **Script del `.app`:** `scripts/mac/build-app.sh` compila, arma el `.app`, lo firma localmente y lo instala en `~/Applications/`.
11. 🛑 **CHECKPOINT:** prueba real con Terminal y Antigravity; después, reinicio de la Mac.
12. Actualizar `docs/PROGRESS.md`, hacer push y cerrar la fase.

### Archivos principales

- `packages/shared/src/`: `hook-event.ts`, `session.ts`, `live-events.ts`.
- `packages/core/src/`:
  - `sessions/` (máquina de estados y registro), `db/` (conexión y migraciones), `api/` (servidor, autenticación y SSE), `watchers/` (transcripts y procesos).
  - `config.ts`, `logger.ts`, `keychain.ts`, `launch-agent.ts`.
- `packages/cli/src/`: `main.ts` y `commands/{serve,hook,install,uninstall,doctor,status,logs}.ts`.
- `scripts/build.ts` (esbuild).
- `apps/mac/Package.swift`, `apps/mac/Sources/TokencyMac/`, `scripts/mac/build-app.sh`.

### Criterios de aceptación

- `pnpm check` pasa en local y en CI; `swift build` compila la app sin errores.
- `tokency hook` tarda menos de 150 ms, nunca imprime nada y sale con 0 aunque el core esté apagado.
- Solo `SessionStart` es síncrono; los demás hooks usan `async: true` (D-013).
- La API rechaza peticiones sin token, con token incorrecto o con un `Host` o un `Origin` ajenos.
- `tokency uninstall` deja `~/.claude/settings.json` byte por byte como estaba y quita el LaunchAgent.
- `tokency doctor` reporta todo en verde y explica cómo arreglar cada problema.
- Las bandas cambian de color en menos de 1 s y desaparecen al cerrar la sesión.
