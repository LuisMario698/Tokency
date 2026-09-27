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

## D-009 · Inventario de Obsidian — 2026-09-25

- **Contexto:** el spec supone que `memory-load`, `memory-save` y `supabase-switch` viven en `~/.claude/commands/`.
- **Hallazgos:** ese directorio no existe; las definiciones están dentro del vault (`claude-commands/`) y hoy ningún comando está activo. Casi todo el vault está sin descargar de iCloud, y las notas de Supabase contienen tokens. Detalle en [OBSIDIAN.md](OBSIDIAN.md).
- **Decisión:** en la Fase 6 no hay comandos que respaldar en `~/.claude/`. El importador descarga de iCloud antes de leer, nunca copia secretos y los lista en el reporte del `--dry-run`. El destino de `pendientes.md` se decide en la Fase 4.

## D-010 · Eventos de Claude Code por origen — 2026-09-25

- **Contexto:** hook de diagnóstico (D-005) instalado unos 20 minutos, con sesiones de prueba en Terminal.app, en la terminal integrada de Antigravity, en la extensión de Claude Code para Antigravity (2.1.282) y en la pestaña Code de Claude Desktop (2.1.281). El CLI instalado es la 2.1.283.

### Cómo distinguir el origen

Dos variables de entorno que el hook hereda bastan; no hace falta recorrer la cadena de procesos.

| Origen                            | `CLAUDE_CODE_ENTRYPOINT` | `__CFBundleIdentifier`           | Otras señales                                                      |
| --------------------------------- | ------------------------ | -------------------------------- | ------------------------------------------------------------------ |
| Terminal.app                      | `cli`                    | `com.apple.Terminal`             | `TERM_PROGRAM=Apple_Terminal`                                      |
| Terminal integrada de Antigravity | `cli`                    | `com.google.antigravity-ide`     | `TERM_PROGRAM=vscode`                                              |
| Extensión de Antigravity          | `claude-vscode`          | `com.google.antigravity-ide`     | Binario dentro de `~/.antigravity-ide/extensions/`                 |
| Claude Desktop (pestaña Code)     | `claude-desktop`         | `com.anthropic.claudefordesktop` | Binario en `~/Library/Application Support/Claude/claude-code/<v>/` |

- **Decisión:** `origin` sale de `CLAUDE_CODE_ENTRYPOINT` y el bundle id de `__CFBundleIdentifier`, que también sirve para traer la app al frente. El hook reporta además el pid de `claude` (su proceso padre directo) para saber si la sesión sigue viva.
- El modo chat de Claude Desktop no generó ningún evento, como se esperaba (spec §4.2).

### Eventos y campos observados

- En los cuatro orígenes llegan `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` y `Stop`.
- `PermissionRequest` llega en cuanto aparece el diálogo de permiso. Con el modo `auto` (el habitual del usuario) casi nunca hay diálogo, así que tampoco hay evento.
- `Notification` con `notification_type=idle_prompt` llega 60 s después de `Stop` si el usuario no escribe.
- `SessionEnd` solo llegó con `/exit` en el CLI (`reason=prompt_input_exit`). Al cerrar la conversación en la extensión o en Desktop, el proceso `claude` siguió vivo y no llegó `SessionEnd`.
- Nombres reales de los campos: `source` (en `SessionStart`), `reason` (en `SessionEnd`), `prompt` (en `UserPromptSubmit`), `notification_type` y `message` (en `Notification`). Todos los eventos traen `session_id`, `transcript_path`, `cwd` y `scratchpad_dir`; casi todos, `prompt_id` y `permission_mode`.
- `model` solo viene en el `SessionStart` del CLI; la extensión y Desktop no lo mandan. El modelo se tomará del JSONL (Fase 2).
- `Stop` incluye `background_tasks` y `session_crons` (vacíos en las pruebas).

### Hallazgos que cambian el diseño de la Fase 1

1. **Los hooks se aplican a sesiones ya abiertas** alrededor de 1 s después de cambiar `settings.json`, pero esas sesiones nunca mandan `SessionStart`. El core crea la sesión con el primer evento que reciba, sea cual sea.
2. **En la extensión, `SessionStart` llega al abrir el panel**, minutos antes del primer prompt. `SessionStart` deja la sesión en `idle`, no en `working`.
3. **Un mismo `session_id` puede estar vivo en dos procesos a la vez:** la extensión de Antigravity retomó (`source=resume`) una sesión iniciada en Terminal.app mientras esta seguía abierta. El core identifica cada instancia por `session_id` + pid, y el `SessionEnd` de un proceso no cierra la instancia del otro.
4. **Después de `Stop` llega un `SubagentStop` con `agent_type` vacío** y sin `SubagentStart` (un agente interno del CLI y de Desktop). Se ignora para calcular el estado.
5. **`SessionEnd` no es confiable fuera del CLI.** El core vigila el pid de `claude` y marca `ended` cuando el proceso muere. Si el proceso sigue vivo sin actividad, se aplica el umbral de inactividad del spec (§4.2).
6. **El `PATH` cambia según el origen**, y `node` resuelve a Homebrew (26) o a nvm (24) según el orden. El comando del hook usa rutas absolutas fijadas al instalar; esto entra en la decisión de empaquetado pendiente de D-004.
7. **Estados propuestos:** `UserPromptSubmit`, `PreToolUse` y `PostToolUse` → `working`; `PermissionRequest` (y `PreToolUse` de `AskUserQuestion`) → `waiting`; `Stop` → `done`; `Notification` `idle_prompt` → `idle`. Se revisa con datos reales en la Fase 1.

### Registros JSONL

- Todos los orígenes, incluido Desktop, escriben en `~/.claude/projects/<cwd codificado>/<session_id>.jsonl`. Los subagentes escriben en `<session_id>/subagents/agent-<agent_id>.jsonl`.
- La codificación cambia `/` y `_` por `-`, así que no se puede revertir. La ruta real sale del `cwd` del payload o del JSONL.

### Sin validar (se revisa en la Fase 1)

- `SessionEnd` al cerrar Claude Desktop con ⌘Q y al cerrar la pestaña de la extensión.
- `Notification` con `notification_type=permission_prompt`: el permiso se aprobó a los 3 s y no llegó.
- `SubagentStart` y `PreCompact`: no ocurrieron durante las pruebas.

## D-011 · `node:sqlite` en lugar de better-sqlite3 — 2026-09-25

- **Contexto:** el spec pide better-sqlite3. Es un módulo nativo que se compila para una versión concreta de Node y se rompe cuando Homebrew o nvm la actualizan. `node:sqlite` viene con Node, es candidato a estable desde Node 24.15 (Stability 1.2) y trae SQLite 3.53.
- **Decisión:** usar `node:sqlite` (`DatabaseSync`) y subir `engines.node` a `>=24.15`.
- **Consecuencia:** sin dependencias nativas, así que el core se empaqueta en un solo archivo. Si la API cambiara antes de ser estable, el acceso a la base está aislado en `packages/core/src/db/`.

## D-012 · App de Mac con Swift Package Manager en lugar de Xcode — 2026-09-25

- **Contexto:** la Mac no tiene Xcode, solo las Command Line Tools. Se comprobó que SwiftPM compila SwiftUI, AppKit y ServiceManagement con ellas.
- **Decisión (del usuario):** la app se define en `apps/mac/Package.swift` (texto versionable, que era el objetivo de XcodeGen) y se compila con `swift build`. Un script arma el `.app` (`LSUIElement`) y lo firma localmente.
- **Consecuencia:** no hay catálogos de assets ni vistas previas de Xcode. La Fase 8 (iPhone) sí necesitará Xcode.
- **Pruebas:** sin Xcode tampoco hay XCTest ni Swift Testing (falta su plugin de macros). La lógica pura vive en `TokencyKit` y se verifica con el ejecutable `TokencyKitChecks` (`swift run --package-path apps/mac TokencyKitChecks`), que también corre en un job de macOS del CI. Por la misma razón la app no usa macros: en el SDK de macOS 27 hasta `@State` es una macro, así que el estado de las vistas vive en objetos `ObservableObject` con `@Published`, y tampoco se usan `@Observable` ni `#Preview`.

## D-013 · Empaquetado, hooks asíncronos y token — 2026-09-25

- **Empaquetado:** esbuild genera un bundle ESM con división de código. Así `tokency hook` carga poco y `serve` importa el core bajo demanda. `tokency install` copia el bundle a `~/Library/Application Support/Tokency/app/`, de modo que recompilar el repo no afecta a los hooks ni al core en uso hasta reinstalar.
- **Node:** el LaunchAgent y los hooks usan una ruta absoluta de `node`, resuelta al instalar sin depender del `PATH` (D-010). Si es de Homebrew, se usa el enlace estable `/opt/homebrew/opt/node/bin/node` en lugar de la ruta versionada de `Cellar`.
- **Hooks:**
  - Todos usan `async: true`, que según la documentación vigente corre en segundo plano sin bloquear a Claude. La excepción es `SessionStart`, que en la Fase 4 devolverá contexto.
  - Se usa la forma de shell con rutas entre comillas, probada en los cuatro orígenes.
  - Como los hooks asíncronos pueden llegar desordenados, cada uno manda la hora en que arrancó y el core ignora, para calcular el estado, los eventos más viejos que el último aplicado.
- **Payload:** el hook lo sanea antes de enviarlo. Nunca manda `tool_input`, `tool_response` ni `last_assistant_message`. Del prompt solo guarda los primeros 200 caracteres, en SQLite local, para mostrarlo en la banda (spec §4.9).
- **Token:** 32 bytes aleatorios en el Llavero (servicio `com.tokency.core`). Se escribe con `security -i` por stdin para que no aparezca en la lista de procesos. La app de Mac lo lee con `/usr/bin/security` y no con el framework Security, para evitar diálogos de acceso después de cada recompilación con firma local.

## D-014 · Reglas de estado de las sesiones — 2026-09-25

- **Contexto:** D-010 propuso un mapeo de eventos a estados para revisarlo en la Fase 1. El implementado está en `packages/core/src/sessions/state-machine.ts`.
- **Decisión:**
  - `SessionStart` → `idle`; si `source=compact`, → `working`.
  - `UserPromptSubmit`, `PostToolUse` y `PreCompact` → `working`. `PreToolUse` también, salvo con `AskUserQuestion` o `ExitPlanMode`, que dejan la sesión en `waiting`.
  - `PermissionRequest` y `Notification` con `permission_prompt` o `elicitation_dialog` → `waiting`.
  - `Stop` → `done`. `SessionEnd` → `ended`.
  - `SubagentStart`, `SubagentStop` y los demás `Notification` no cambian el estado.
  - **Cambio respecto a D-010:** `idle_prompt` no pasa la sesión a `idle`. `done` (verde) se mantiene 15 min (configurable) para que no se escape que una sesión terminó; después pasa a `idle`.
  - Sin actividad durante 60 min (configurable), la sesión termina con motivo `inactivity`. Si el proceso de `claude` muere, termina con `process-exited`.
  - Una sesión terminada solo se reabre con `SessionStart` o `UserPromptSubmit`; los demás eventos rezagados se ignoran.
  - Un evento con `ts` menor al último aplicado solo completa datos (modelo, cwd), sin cambiar el estado.
  - Una sesión vista solo por su JSONL se crea tras 5 s de gracia, por si su primer hook viene en camino, y se reemplaza en cuanto llegan los hooks.

## D-015 · Cómo se mide el uso — 2026-09-26

- **Duplicados:** Claude Code escribe una línea por bloque de contenido y repite el mismo `usage` con el mismo `message.id` y `requestId`. Se cuenta una sola vez por ese par, como hace `ccusage`. Las entradas del modelo `<synthetic>` (errores y avisos locales) no consumen y se ignoran.
- **Ventana de 5 horas:** `ccusage` redondea el inicio a la hora, pero los avisos de límite reales del usuario muestran otra cosa. El 26 de agosto el primer mensaje fue a las 14:11Z y el reinicio a las 19:10Z; el 25 de septiembre, a las 04:20Z y a las 09:20Z. **Decisión:** la ventana empieza con el primer mensaje posterior al fin de la anterior y dura 5 horas. Cuando hay un aviso de límite con hora de reinicio, esa hora fija el final de su ventana.
- **Avisos de límite:** son líneas con `isApiErrorMessage: true` y el texto `You've hit your <tipo> limit · resets <hora> (<zona horaria>)`. Cada aviso de tipo `session` es una muestra de calibración automática.
- **Calibración:** la métrica es el costo equivalente en API de la ventana hasta el aviso, porque pondera modelos y tipos de token mejor que sumar tokens. Si se cambia la tabla de precios, las muestras se recalculan.
- **Limitaciones:** es una estimación. Solo cubre Claude Code en esta Mac; el chat de claude.ai y otros equipos comparten el límite pero no se ven aquí, así que una ventana puede haber empezado antes de lo que se ve localmente.

## D-016 · Tabla de precios editable — 2026-09-26

- **Contexto:** el spec pide el costo equivalente en API con una tabla editable, no fija. Los valores por defecto salen de la referencia oficial de la API (precios por millón de tokens, consultados el 2026-09-26).
- **Tabla por defecto (USD por millón de tokens):**

  | Modelo           | Entrada | Salida | Caché 5 min | Caché 1 h | Lectura de caché |
  | ---------------- | ------: | -----: | ----------: | --------: | ---------------: |
  | claude-fable-5-1 |      10 |     50 |       12,50 |        20 |             0,25 |
  | claude-fable-5   |      10 |     50 |       12,50 |        20 |             1,00 |
  | claude-opus-5-5  |       4 |     20 |           5 |         8 |             0,20 |
  | claude-opus-5    |       5 |     25 |        6,25 |        10 |             0,50 |
  | claude-sonnet-5  |       2 |     10 |        2,50 |         4 |             0,20 |
  | claude-haiku-4-5 |       1 |      5 |        1,25 |         2 |             0,10 |

- **Recargos:** el modo rápido (`speed: "fast"`) multiplica por 2 en Opus 5 y Opus 5.5; las búsquedas web cuestan $10 por cada 1000. Las escrituras en caché de Opus 5.5 son derivadas (1,25× y 2×) y la referencia pide confirmarlas tras su lanzamiento.
- **Edición:** `config.json` acepta `pricing`, que se combina con la tabla por defecto modelo por modelo. Si un modelo no tiene precio, su costo queda sin calcular y la app lo avisa.
