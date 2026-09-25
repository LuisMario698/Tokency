# Decisiones

Registro de decisiones técnicas y de los ajustes a [SPEC.md](SPEC.md). Cada entrada indica fecha, contexto, decisión y consecuencias. Si algo aquí contradice el spec, gana lo que está aquí.

> El repositorio es **público**: este documento no incluye contenido personal (notas, prompts, conversaciones ni rutas de datos privados más allá de las que ya menciona el spec).

---

## D-001 · Ubicación de la especificación — 2026-09-24

- **Contexto:** el spec llegó como `docs/TOKENCY_SPEC.md`, y el propio spec pide guardarlo como `docs/SPEC.md`.
- **Decisión:** se movió textualmente a `docs/SPEC.md` en el primer commit. No hay otra copia.

## D-002 · Versión de Node — 2026-09-24

- **Contexto:** el spec pide Node LTS. La LTS activa es la 24. La Mac tiene Node 26, que pasa a LTS en octubre de 2026.
- **Decisión:** `engines.node >= 24`, el CI corre en Node 24 y `.nvmrc` fija 24. En local se permite Node 26.
- **Consecuencia:** el código no debe usar APIs exclusivas de Node 26.

## D-003 · TypeScript 6.0 en lugar de 7 — 2026-09-24

- **Contexto:** TypeScript 7 (compilador nativo) ya es la versión estable, pero `typescript-eslint` 8.70 exige `typescript >=4.8.4 <6.1.0`.
- **Decisión:** usar TypeScript 6.0.x para tener lint con información de tipos.
- **Consecuencia:** revisar la migración a TS 7 cuando `typescript-eslint` la soporte.

## D-004 · Paquetes internos consumidos como código fuente — 2026-09-24

- **Contexto:** el monorepo tiene paquetes que se importan entre sí (`shared` → `core` → `cli`).
- **Decisión:** los paquetes exportan directamente sus archivos `.ts`, sin paso de compilación. Las importaciones relativas llevan la extensión `.ts` y se exige sintaxis borrable (`erasableSyntaxOnly`). Así Vitest, `tsc` y Node (con su soporte nativo de TypeScript) usan el mismo código.
- **Consecuencia:** en la Fase 1 se decide cómo empaquetar el CLI y el core para producción (el hook de Claude Code debe arrancar muy rápido).

## D-005 · Hook de diagnóstico solo en eventos de observación — 2026-09-24

- **Contexto:** la documentación vigente lista 33 eventos de hooks. Algunos cambian el comportamiento de Claude Code con solo tener un hook registrado (por ejemplo, `WorktreeCreate` reemplaza la creación de worktrees) y otros son recientes y podrían no existir en todas las versiones instaladas (Terminal, extensión de Antigravity y Claude Desktop traen versiones distintas).
- **Decisión:** el diagnóstico se registra solo en eventos de observación con soporte de larga data: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact` y `SessionEnd`.
- **Seguridad:**
  - El script no imprime nada, siempre sale con código 0 y tiene un tiempo límite de 5 s.
  - Las capturas se guardan en `~/Library/Logs/Tokency/diagnostics/`, fuera del repo, con permisos `0600`. Contienen prompts, así que se borran al cerrar la fase.
  - Del entorno solo se guardan los **nombres** de las variables y los valores de una lista cerrada que no incluye secretos.

## D-006 · Respaldos de `settings.json` — 2026-09-24

- **Contexto:** el spec exige respaldo con fecha y fusión antes de tocar `~/.claude/settings.json`. `~/.claude/backups/` pertenece a Claude Code.
- **Decisión:**
  - Los respaldos van a `~/Library/Application Support/Tokency/backups/`.
  - La fusión solo agrega grupos de hooks propios y nunca toca los del usuario.
  - La desinstalación quita solo los hooks propios. Si el resultado equivale al respaldo, restaura el archivo byte por byte. Si el usuario cambió otros ajustes entretanto, los conserva y lo avisa.
  - La escritura es atómica (archivo temporal + renombrado) y respeta los permisos originales.
  - Si el archivo no es JSON válido, no se toca.

## D-007 · Repositorio público — 2026-09-24

- **Contexto:** `LuisMario698/Tokency` es público.
- **Decisión:** la documentación se escribe como si fuera pública: sin contenido de notas, prompts ni datos personales. Se recomendó al usuario hacerlo privado.

## D-008 · Commits directos en `main` — 2026-09-24

- **Contexto:** el spec indica trabajar en la rama `main`.
- **Decisión:** commits pequeños directamente en `main`, con push al cerrar cada fase.
