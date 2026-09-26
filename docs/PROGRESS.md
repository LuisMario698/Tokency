# Progreso de Tokency

Registro vivo del avance por fases. La especificación completa está en [SPEC.md](SPEC.md) y las decisiones en [DECISIONS.md](DECISIONS.md).

| Fase                         | Estado       |
| ---------------------------- | ------------ |
| 0 — Preparación y validación | ✅ Terminada |
| 1 — Sesiones en vivo         | ⚪ Pendiente |
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
