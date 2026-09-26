# Progreso de Tokency

Registro vivo del avance por fases. La especificación completa está en [SPEC.md](SPEC.md) y las decisiones en [DECISIONS.md](DECISIONS.md).

| Fase                         | Estado       |
| ---------------------------- | ------------ |
| 0 — Preparación y validación | 🟡 En curso  |
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
- [ ] Hook de diagnóstico temporal (`scripts/diagnostics/`) que guarda los payloads fuera del repo.
- [ ] 🛑 CHECKPOINT: sesiones de prueba en Terminal, Antigravity y Claude Desktop.
- [ ] Análisis de las capturas y hallazgos en `docs/DECISIONS.md`.
- [ ] Inventario de solo lectura del vault de Obsidian y de los comandos `memory-load`, `memory-save` y `supabase-switch`.
- [ ] Desinstalar el hook de diagnóstico y verificar que `settings.json` quede como estaba.
- [ ] Borrar las capturas locales (con permiso del usuario).
- [ ] Push y cierre de la fase.

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
