# Tokency — Especificación completa para Claude Code

> **Instrucción inicial:** si este documento todavía no existe en el repo como `docs/SPEC.md`, guárdalo ahí de forma textual como primer commit. Es la fuente de verdad del proyecto: reléelo al empezar cada fase y cada vez que el contexto se compacte.

## 0. Tu rol y cómo debes trabajar

Eres el ingeniero principal de **Tokency**, un agente personal de escritorio para macOS que complementa el uso de Claude. Vas a construir el proyecto completo, fase por fase, en el repositorio `https://github.com/LuisMario698/Tokency` (rama `main`, actualmente vacío).

Reglas de trabajo:

1. **Trabaja por fases, en orden.** No empieces una fase sin haber cerrado la anterior (código funcionando, pruebas pasando, commit y push hechos, `docs/PROGRESS.md` actualizado).
2. **Al iniciar cada fase**, escribe en `docs/PROGRESS.md` el plan detallado de esa fase (tareas, archivos, criterios de aceptación). Al terminarla, marca lo hecho, anota decisiones tomadas y problemas pendientes.
3. **No asumas APIs de memoria.** Antes de implementar cada integración, consulta la documentación oficial vigente: hooks, comandos personalizados, MCP y ajustes de Claude Code (docs.claude.com / code.claude.com), README del SDK de TypeScript de MCP (`@modelcontextprotocol/sdk`), Supabase, Google Drive API v3, GitHub REST API, y AppKit/SwiftUI. Si algo en este spec contradice la documentación actual, gana la documentación: ajústalo y regístralo en `docs/DECISIONS.md`.
4. **Puntos de control humanos (🛑 CHECKPOINT).** Hay pasos que solo el usuario puede hacer (consentimientos OAuth, crear credenciales, abrir sesiones en otras apps, aprobar migraciones). Cuando llegues a uno: detente, explica en español, paso a paso y con enlaces exactos, qué debe hacer el usuario, y espera su confirmación. Mientras esperas, no inventes valores ni uses datos de ejemplo como si fueran reales.
5. **Commits pequeños y frecuentes** con Conventional Commits en español (`feat(core): vigilante de registros de sesiones`). Push al cerrar cada fase.
6. **Calidad mínima obligatoria:** TypeScript en modo `strict`, ESLint + Prettier, pruebas con Vitest para toda lógica de parseo y cálculo, `xcodebuild` sin errores para las apps Swift. Nada se da por terminado si no compila y pasa pruebas.
7. **Idioma:** interfaz de usuario, documentación, mensajes de commit y README en **español**. Identificadores de código en inglés.
8. **Si algo es ambiguo o riesgoso**, elige la opción más segura y reversible, documéntala en `docs/DECISIONS.md` y sigue; solo detente si la decisión es irreversible o afecta datos del usuario.

## 1. Contexto del usuario

- Dueño: Luis Mario (Mario). Proyecto **personal** (no se distribuye ni se vende).
- Equipo: MacBook Air M1 con macOS reciente; iPhone 15 Plus (fase posterior).
- Herramientas: pnpm, Homebrew, Node LTS, Xcode, Antigravity IDE (fork de VS Code) con la extensión de Claude Code, Claude Code en terminal y en la app de escritorio de Claude.
- Plan de Claude: **Pro** (suscripción, no API).
- Sistema actual de memoria que Tokency va a **reemplazar**: vault de Obsidian en `/Users/mario/Library/Mobile Documents/iCloud~md~obsidian/Documents/mario`, con slash commands de Claude Code `memory-load`, `memory-save` y `supabase-switch` (verifica dónde están definidos, probablemente en `~/.claude/commands/`).
- Ya usa Supabase y Google Drive.

## 2. Qué es Tokency

Un agente personal con cinco capacidades:

1. **Monitor de sesiones de Claude** mostradas como bandas en el borde de la pantalla.
2. **Uso de Claude**: tokens consumidos, ventana de 5 horas, estimación frente al límite del plan Pro.
3. **Base de proyectos** sincronizada con GitHub, con estados activo / en pausa / archivado.
4. **Almacenamiento en Google Drive** de archivos, imágenes y documentos por proyecto.
5. **Contexto vivo por proyecto**: se inyecta al iniciar sesiones de Claude Code, se actualiza automáticamente al terminar (con datos de git) y se resume con IA solo cuando el usuario lo pide.

## 3. Arquitectura

```
Fuentes                     Núcleo                         Salidas
─────────────────           ──────────────────────         ─────────────────────────────
Hooks de Claude Code  ───►                          ───►   App de Mac (bandas, menú, mascota)
Registros ~/.claude   ───►   Tokency core            ───►   MCP + CLI (para Claude Code)
GitHub API            ───►   (servicio local Node)   ───►   Supabase (datos y contexto)
Estado de apps macOS  ───►                          ───►   Google Drive (archivos)
                                                           App de iPhone (lee Supabase, fase 8)
```

Principio central: **toda la lógica vive en el core.** La app de Mac, el CLI y el MCP son clientes delgados que solo hablan con el core. No dupliques integraciones en Swift.

### 3.1 Estructura del monorepo (pnpm workspaces)

```
tokency/
├─ apps/
│  ├─ mac/            # App Swift (SwiftUI + AppKit), proyecto generado con XcodeGen (project.yml)
│  └─ ios/            # Fase 8
├─ packages/
│  ├─ core/           # Servicio local en TypeScript
│  ├─ cli/            # Comando `tokency`
│  └─ shared/         # Tipos y esquemas Zod compartidos (API local, eventos, modelos)
├─ supabase/
│  └─ migrations/
├─ scripts/           # Instalación, launchd, utilidades
├─ docs/              # SPEC.md, PROGRESS.md, DECISIONS.md, ARCHITECTURE.md
└─ README.md
```

### 3.2 Tecnologías

| Pieza | Tecnología |
|---|---|
| Core | Node LTS + TypeScript, servidor HTTP ligero (Fastify o Hono), SSE o WebSocket para eventos en vivo |
| BD local | SQLite (better-sqlite3), migraciones versionadas |
| BD en la nube | Supabase (Postgres + Auth + RLS) con `@supabase/supabase-js` |
| GitHub | Octokit |
| Google Drive | `googleapis` (Drive v3), OAuth de escritorio con redirección loopback |
| MCP | `@modelcontextprotocol/sdk` usando solo APIs modernas (`registerTool`, etc.) |
| Secretos | Llavero de macOS mediante el comando `security` (envuelto en un módulo propio) |
| Arranque del core | LaunchAgent (`~/Library/LaunchAgents/com.tokency.core.plist`) |
| App de Mac | Swift, SwiftUI + AppKit, macOS 14+, `LSUIElement = true` (sin icono en el Dock), XcodeGen para que el proyecto sea texto versionable |

## 4. Módulos y comportamiento

### 4.1 Core: API local y seguridad

- Escucha **solo** en `127.0.0.1` en un puerto configurable (por defecto 7777).
- Cada petición exige `Authorization: Bearer <token>`. El token se genera en la instalación y se guarda en el Llavero; el CLI y la app de Mac lo leen de ahí. Esto evita que páginas web abiertas en el navegador llamen al core.
- Endpoints mínimos: estado de salud, eventos de hooks, sesiones activas, uso, proyectos, contexto, archivos, flujo de eventos en vivo (SSE/WS), y el endpoint MCP.
- Registro de logs rotativo en `~/Library/Logs/Tokency/`.
- Si Supabase o internet no están disponibles, el core sigue funcionando con SQLite y encola las escrituras pendientes para sincronizarlas después.

### 4.2 Sesiones de Claude

**Fuente principal: hooks globales de Claude Code** en `~/.claude/settings.json` (nivel usuario), para los eventos de inicio de sesión, envío de prompt, fin de respuesta, notificación/permiso y fin de sesión (usa los nombres exactos de la documentación vigente).

- Los hooks ejecutan `tokency hook <evento>`, que lee el JSON de stdin y lo reenvía al core.
- **Los hooks nunca deben bloquear ni romper Claude Code:** tiempo límite muy corto, y si el core no responde, salir con código 0 sin imprimir nada (excepto en el hook de inicio, ver 4.5).
- **Antes de modificar `~/.claude/settings.json`: haz respaldo con fecha y fusiona**, no sobrescribas. `tokency uninstall-hooks` debe dejarlo exactamente como estaba.
- Intenta identificar el origen de cada sesión (Terminal, Antigravity, app de Claude Desktop) revisando la cadena de procesos padre; guarda `origin` y, si se puede, el bundle id de la app para traerla al frente.

**Fuente de respaldo:** vigilar `~/.claude/projects/` con eventos del sistema de archivos (no sondeo constante). Si una sesión no registra actividad durante un tiempo configurable y no llegó su evento de cierre, márcala como terminada y ejecuta el cierre (4.5).

**Estados:** `working` (azul), `waiting` (ámbar: espera respuesta o permiso), `done` (verde: terminó de responder), `idle` (gris), `ended`.

**Claude Desktop en modo chat:** no hay forma oficial de leer sus conversaciones; solo detecta con `NSWorkspace` (desde la app de Mac, reportándolo al core) si la app está abierta o en primer plano y muéstralo como banda discreta sin contenido.

**Sesiones en la nube:** detecta actividad reciente en GitHub en ramas creadas por Claude (verifica el prefijo real que usan) y muéstrala como "actividad en la nube" del proyecto.

### 4.3 Uso de Claude (plan Pro)

- Parsea los registros JSONL locales de Claude Code: tokens de entrada, salida, creación de caché y lectura de caché, modelo y marca de tiempo. **Deduplica** entradas repetidas del mismo mensaje. Estudia cómo lo resuelve la herramienta de código abierto `ccusage` antes de escribir el parser.
- El parser vive aislado en un módulo con pruebas basadas en fixtures **anonimizados** (sin contenido real de conversaciones), porque el formato no es una API oficial y puede cambiar.
- Agregados: por sesión, proyecto, día y modelo; acumulado en la **ventana de 5 horas** vigente y tiempo para su reinicio; acumulado semanal.
- **Calibración:** botón "llegué al límite" que registra el consumo en ese momento; con varios registros, estima el tope y muestra una barra de cercanía. Mostrar siempre que es una estimación y que solo cubre Claude Code (los chats de claude.ai comparten el límite pero no se ven localmente).
- Costo equivalente en API con una tabla de precios editable por el usuario (no la codifiques como verdad fija).
- Acceso directo a la página oficial de uso de la cuenta.

### 4.4 Proyectos y GitHub

- Autenticación: token de GitHub de solo lectura (fine-grained: metadatos, contenidos y pull requests en modo lectura), o el de `gh auth token` si el usuario ya usa `gh`. Guardado en el Llavero.
- Sincronización periódica (cada varios minutos, configurable): repos, último push, rama principal, commits recientes, PRs abiertos.
- Descubrimiento de rutas locales escaneando carpetas configurables en busca de repos git y relacionándolos por su remoto.
- Estados de proyecto: `active`, `paused`, `archived`. Sugerir como activos los que tuvieron commits o sesiones de Claude en los últimos 14 días (configurable); el usuario confirma.
- Se permiten proyectos sin repo.

### 4.5 Contexto de proyectos (módulo central)

Capas por proyecto:

| Capa | Contenido | Actualización |
|---|---|---|
| Ficha | Objetivo, stack, reglas, convenciones, comandos | Manual |
| Estado vivo | Rama, últimos commits, archivos tocados, PRs | Automática (git/GitHub) |
| Bitácora | Una entrada por sesión: fecha, duración, tokens, commits, archivos cambiados, resumen opcional | Automática al cerrar sesión |
| Decisiones y notas | Lo que antes guardaba `memory-save` | Manual o vía `/tokency-save` |
| Archivos | Índice de Drive | Automática |

**Al iniciar sesión:** guarda el `HEAD` actual del repo ligado a esa sesión. El hook de inicio devuelve a Claude Code un **resumen corto** del proyecto (ficha + estado vivo + últimas decisiones), usando el mecanismo oficial para inyectar contexto desde ese hook. Presupuesto aproximado: 1,500 tokens como máximo. Si el core no responde, no imprimir nada.

**Al cerrar sesión (sin IA, sin gastar límite):** calcula commits desde el `HEAD` guardado, archivos cambiados y cambios sin commitear **solo como estadísticas** (`--stat`, `status`), nunca contenido de diffs. Agrega la entrada a la bitácora y actualiza el estado vivo.

**Resumen con IA solo a petición:**
- Comando global `/tokency-save` (en `~/.claude/commands/`): pide a Claude resumir la sesión actual (qué se hizo, decisiones, pendientes) y guardarlo llamando a la herramienta MCP correspondiente.
- Comando global `/tokency-load`: trae el contexto completo del proyecto actual vía MCP.

**Para pegar en otros chats:** desde la barra de menús y con un atajo global configurable, copiar al portapapeles el contexto del proyecto activo en versión corta o completa, en Markdown.

**Exclusiones de seguridad:** nunca incluir `.env*`, llaves, tokens ni contenido de diffs en ningún contexto.

Tokency **no** reemplaza el `CLAUDE.md` de cada repo; no lo modifiques.

### 4.6 MCP

Servidor MCP expuesto por el core en `http://127.0.0.1:<puerto>/mcp` con el token Bearer, y además un puente stdio (`tokency mcp`) por compatibilidad. Registro a nivel usuario en Claude Code (`claude mcp add` con el alcance de usuario; verifica la sintaxis vigente).

Herramientas mínimas (nombres con prefijo `tokency_`, descripciones claras en español, entradas validadas con Zod, errores accionables):
- `tokency_list_projects`, `tokency_get_context` (corto/completo), `tokency_save_note`, `tokency_save_session_summary`, `tokency_update_card` (ficha)
- `tokency_list_files`, `tokency_read_file` (Google Docs como texto, PDFs extraídos, **imágenes devueltas como contenido de imagen**), `tokency_upload_file`
- `tokency_get_usage`, `tokency_active_sessions`

Anota correctamente las herramientas de solo lectura y las que modifican datos.

### 4.7 Google Drive

- OAuth de escritorio con redirección loopback. Alcances: lectura de Drive + escritura en archivos propios (el alcance `drive.file` por sí solo **no** ve archivos subidos a mano, y el usuario quiere agregarlos desde cualquier dispositivo).
- Estructura: `Tokency/<Proyecto>/{archivos,imagenes,contexto}`.
- Detección de cambios con la API de cambios de Drive; índice en Supabase (`archivos_drive`).
- Respaldo periódico del contexto de cada proyecto como Markdown en `Tokency/<Proyecto>/contexto/`.
- Las imágenes solo se envían a Claude cuando se piden explícitamente.

### 4.8 Supabase

- Tablas (ajusta nombres y columnas según convenga, documentando): `projects`, `repos`, `context_entries` (con tipo: card, decision, note, session_summary; y versión), `session_log`, `drive_files`, `usage_daily`, `settings`.
- **RLS activado en todas las tablas desde el inicio**, ligado al usuario autenticado. El core inicia sesión como el usuario (no uses la service role key en el core); guarda la sesión en el Llavero.
- Migraciones en `supabase/migrations/`, aplicadas con la CLI de Supabase.
- **Nunca** se suben conversaciones completas: solo resúmenes, estadísticas y totales.

### 4.9 App de Mac

- App de barra de menús (`LSUIElement`), arranca al iniciar sesión (SMAppService).
- Menú: sesiones activas, uso (ventana actual, barra estimada, gráfica simple por día), proyectos activos con acción "copiar contexto", ajustes.
- **Bandas:** `NSPanel` sin bordes, no activante, nivel por encima de ventanas normales, visible en todos los Spaces y junto a apps en pantalla completa; borde derecho por defecto (configurable); una banda por sesión con color por estado; al pasar el mouse se expande con proyecto, tiempo, tokens y último prompt; al hacer clic trae al frente la app de origen. Solo captura el mouse sobre la banda; el resto de la ventana deja pasar clics.
- Soporte para varios monitores y cambios de resolución.
- Recibe eventos del core por SSE/WS; si el core no está corriendo, muéstralo en el menú con opción de reiniciarlo.
- Ventana de ajustes: puerto, carpetas de proyectos, umbral de proyectos activos, borde de las bandas, atajo global, tabla de precios, cuentas conectadas (GitHub, Google, Supabase) con estado.

### 4.10 CLI `tokency`

`install` (core + LaunchAgent + hooks + comandos + MCP), `uninstall`, `doctor` (verifica todo y explica cómo arreglar cada problema), `status`, `hook <evento>`, `context [proyecto] [--full]`, `copy`, `sync`, `auth github|google|supabase`, `mcp`, `import-obsidian [--dry-run]`, `logs`.

### 4.11 Mascota (fase 7)

Perro en pixel art (el usuario tiene un mestizo de pastor alemán con husky) que camina sobre el Dock en una ventana transparente, con estados caminar / sentarse / dormir / ladrar, reaccionando a los mismos eventos de las bandas (por ejemplo, ladra cuando una sesión pasa a `waiting`). Usa sprites de marcador de posición bien organizados para que el usuario los reemplace después. Se puede desactivar desde ajustes.

## 5. Fases

### Fase 0 — Preparación y validación
- Monorepo, tooling, CI básico en GitHub Actions (typecheck, lint, tests del core), `.gitignore` estricto (secretos, `.env*`, datos locales).
- Script de diagnóstico temporal: hook que solo guarda en un archivo local los payloads de todos los eventos.
- 🛑 **CHECKPOINT:** pedir al usuario que abra una sesión de Claude Code en **terminal**, otra en **Antigravity** y otra en la **app de Claude Desktop**, envíe un prompt y cierre cada una. Analiza los payloads capturados: confirma qué eventos llegan desde cada origen, cómo distinguir el origen y dónde quedan los registros JSONL. Documenta hallazgos en `docs/DECISIONS.md` y ajusta el plan si algo no funciona como se espera.
- Inventario de solo lectura del vault de Obsidian y de los comandos `memory-load`, `memory-save` y `supabase-switch`; documenta qué hace cada uno y cómo se reemplazará.
- Quita el hook de diagnóstico al terminar.

### Fase 1 — Sesiones en vivo
Core con API local segura, SQLite, LaunchAgent, CLI `hook`/`install`/`doctor`, vigilante de registros, detección de estados, app de Mac con barra de menús y bandas.
**Listo cuando:** abrir y usar sesiones en terminal y Antigravity se refleja en las bandas en tiempo real con el color correcto, y reiniciar la Mac deja todo funcionando solo.

### Fase 2 — Uso
Parser con fixtures y pruebas, agregados, ventana de 5 horas, calibración, vista de uso en el menú.

### Fase 3 — Proyectos y GitHub
🛑 **CHECKPOINT:** creación del proyecto de Supabase y del usuario (o uso de uno existente), y del token de GitHub. Guía paso a paso.
Migraciones con RLS, autenticación del core, sincronización de GitHub, rutas locales, estados, sugerencia de activos.

### Fase 4 — Contexto
Capas, bitácora automática al cerrar, inyección al iniciar, MCP (HTTP + stdio), `/tokency-save`, `/tokency-load`, copiar al portapapeles y atajo global.
**Listo cuando:** una sesión nueva en un proyecto activo arranca con su resumen, y al cerrarla aparece la entrada en la bitácora sin haber usado IA.

### Fase 5 — Google Drive
🛑 **CHECKPOINT:** crear proyecto en Google Cloud, habilitar Drive API, pantalla de consentimiento **en producción** (si queda en modo prueba, el token caduca cada 7 días), credenciales de escritorio y primer consentimiento.
Estructura de carpetas, índice por cambios, herramientas MCP de archivos, respaldo de contexto en Markdown.

### Fase 6 — Migración de Obsidian
Importador con `--dry-run` que genera un reporte (qué nota va a qué proyecto y capa, qué adjuntos van a Drive).
🛑 **CHECKPOINT:** el usuario revisa y aprueba el reporte.
Importación real, verificación, reemplazo de los slash commands viejos (respaldándolos, no borrándolos). **El vault nunca se modifica**: queda como respaldo de solo lectura.

### Fase 7 — Extras
Señales de Claude Desktop y de la nube, mascota, pulido de UI, notificaciones del sistema opcionales, accesibilidad básica.

### Fase 8 — iPhone
🛑 **CHECKPOINT:** confirmar con el usuario si usará cuenta gratuita de Apple (las apps instaladas desde Xcode dejan de abrir a los 7 días) o el Apple Developer Program. Si prefiere no pagar, ofrece como alternativa una versión web ligera sobre Supabase.
App SwiftUI que lee Supabase: proyectos, contexto, bitácora, uso diario; widget de proyectos activos.

## 6. Entregables finales

- `README.md` en español: qué es, requisitos, instalación desde cero (`pnpm install`, `tokency install`, conexión de cuentas), uso diario, desinstalación, solución de problemas.
- `docs/ARCHITECTURE.md` con diagrama y flujo de datos, `docs/DECISIONS.md`, `docs/PROGRESS.md` completo.
- `tokency doctor` reportando todo en verde.

## 7. Lo que nunca debes hacer

- Subir secretos, tokens, conversaciones completas o contenido de diffs a git, Supabase o Drive.
- Sobrescribir `~/.claude/settings.json` sin respaldo y fusión.
- Modificar o borrar el vault de Obsidian o los `CLAUDE.md` de otros repos.
- Usar la service role key de Supabase en código que corre en la Mac.
- Hacer que un fallo de Tokency bloquee o ralentice Claude Code.
- Inventar valores de credenciales o dar por hecho un checkpoint humano.
