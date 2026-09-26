# Inventario del sistema de memoria en Obsidian

Inventario de **solo lectura** del sistema que Tokency va a reemplazar, hecho en la Fase 0 (2026-09-25). Sirve de base para el importador de la Fase 6. No se modificó nada del vault y no se abrió el contenido de las notas: solo nombres de carpetas, conteos y las definiciones de los comandos.

> El repositorio es público: aquí no aparecen títulos de notas, nombres de proyectos ni contenido.

## Vault

- Ruta: la que indica el spec (`iCloud~md~obsidian/Documents/mario`), sincronizada con iCloud.
- 101 archivos fuera de `.obsidian/`: 100 Markdown y 1 JSON. No hay adjuntos (imágenes, PDFs).
- **97 de 101 archivos no están descargados en la Mac** (iCloud "Optimizar almacenamiento"). Leerlos obliga a iCloud a descargarlos. 28 archivos pesan 0 bytes.
- Plugins de Obsidian: `obsidian42-brat` y `claude-code-mcp`. Ningún servidor MCP de Obsidian está registrado en Claude Code.

| Carpeta                 | Archivos | Qué contiene                                                                                                                                                                      |
| ----------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raíz                    |        9 | Notas sueltas: inicio, bienvenida, perfil personal, stack tecnológico, notas de materias y de proyectos, y un `CLAUDE.md`.                                                        |
| `Proyectos/`            |       12 | Una nota índice por proyecto (frontmatter: `tipo: proyecto`, `estado`, `stack`, `actualizado`, `tags`).                                                                           |
| `memory/proyectos/<p>/` |       61 | 15 carpetas de proyecto con `contexto.md` (13), `pendientes.md` (13), `decisiones.md` (12), `aprendizajes.md` (12), `supabase.md` (10) y un `MEMORY.md`.                          |
| `memory/`               |        2 | `aprendizajes-globales.md` y `supabase-cuentas.md`.                                                                                                                               |
| `claude-commands/`      |        5 | Definiciones de `memory-load`, `memory-save`, `supabase-switch` y respaldos de las dos primeras.                                                                                  |
| `.claude/`              |       11 | `settings.local.json` (solo permisos) y skills de formato de Obsidian (`obsidian-markdown`, `obsidian-bases`, `obsidian-cli`, `json-canvas`, `defuddle`). `commands/` está vacío. |
| `Universidad/`          |        1 | Notas escolares, fuera del alcance de Tokency.                                                                                                                                    |

Hay 15 carpetas en `memory/proyectos/` y 12 notas en `Proyectos/`: no todas las carpetas tienen nota índice (y los nombres pueden variar, como advierte el propio `memory-save`).

## Comandos

**Hoy ninguno de los tres está activo en Claude Code:** no existe `~/.claude/commands/` y la carpeta `.claude/commands/` del vault está vacía. Solo quedan sus definiciones en `claude-commands/`.

### `memory-load`

1. Carga la skill `/obsidian-markdown` (solo existe si la sesión corre dentro del vault).
2. Detecta el proyecto por la carpeta de trabajo; si hay duda, pregunta.
3. Lee `contexto`, `decisiones`, `aprendizajes`, `pendientes` y `supabase` del proyecto, además de `aprendizajes-globales`, `supabase-cuentas` y la nota índice en `Proyectos/`, y sigue los wikilinks relevantes.
4. Resume: qué es el proyecto, estado actual, decisiones vigentes, pendientes priorizados y punto de retome.

### `memory-save`

1. Carga `/obsidian-markdown` y exige formato nativo de Obsidian (wikilinks, frontmatter, callouts).
2. Detecta el proyecto y reutiliza la carpeta existente aunque el nombre varíe.
3. Anexa, con encabezado de fecha y sin borrar historial: contexto (frontmatter `proyecto`, `tipo: contexto`, `estado`, `actualizado`, `tags`), decisiones (un callout `[!important]` por decisión), aprendizajes (callouts `[!tip]`), pendientes (checkboxes) y `supabase.md` si cambió la configuración.
4. Copia a `aprendizajes-globales.md` lo que aplica a cualquier proyecto y actualiza la nota índice en `Proyectos/`.
5. Lista los archivos tocados y los posibles duplicados de nombre.

### `supabase-switch`

Lee `memory/supabase-cuentas.md` y el `supabase.md` del proyecto y dice qué cuenta y **token** corresponden al proyecto y cómo configurarlo. La ruta del vault que usa es de otra Mac (otro nombre de usuario), así que hoy no funcionaría.

## ⚠️ Datos sensibles

`memory/supabase-cuentas.md` y, probablemente, los `supabase.md` de cada proyecto contienen cuentas y tokens de Supabase. No se abrieron en este inventario. El importador de la Fase 6 debe:

- No copiar nunca esos valores a Supabase, a Drive ni a ningún contexto (spec §4.5 y §7).
- Detectar y omitir cualquier cosa con forma de secreto en las demás notas, y listarla en el reporte del `--dry-run`.
- Ofrecer mover los tokens al Llavero de macOS solo si el usuario lo pide expresamente.

## Cómo se reemplaza cada pieza

| Hoy                                      | En Tokency                                                                                                       | Fase |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| `memory-load`                            | Inyección automática del resumen al iniciar sesión (`SessionStart`) y `/tokency-load` para el contexto completo. | 4    |
| `memory-save`                            | Bitácora automática al cerrar sesión (sin IA) y `/tokency-save` para el resumen con IA.                          | 4    |
| `supabase-switch`                        | La ficha del proyecto dice qué proyecto y cuenta de Supabase usa, sin tokens. Los secretos quedan en el Llavero. | 3    |
| `Proyectos/<nota>.md`                    | Fila en `projects` (estado, stack) + capa **ficha**.                                                             | 6    |
| `contexto.md`                            | Capa **ficha** (objetivo, stack, reglas, comandos).                                                              | 6    |
| `decisiones.md`                          | Entradas `decision` (una por callout, con su fecha).                                                             | 6    |
| `aprendizajes.md`                        | Entradas `note` (una por callout).                                                                               | 6    |
| `pendientes.md`                          | Por decidir en la Fase 4: tipo propio de entrada o nota con checkboxes.                                          | 4/6  |
| `aprendizajes-globales.md`               | Notas sin proyecto (contexto global).                                                                            | 6    |
| `supabase.md` y `supabase-cuentas.md`    | Solo los datos no secretos (URL o referencia del proyecto) pasan a la ficha.                                     | 6    |
| Notas sueltas de la raíz, `Universidad/` | Se quedan en el vault; el reporte del `--dry-run` las lista como no importadas.                                  | 6    |

Como los comandos viejos no están instalados, en la Fase 6 no hay nada que respaldar en `~/.claude/`: sus definiciones siguen en el vault, que nunca se modifica.

## Consideraciones para el importador

- Descargar de iCloud antes de leer, o avisar si un archivo no se puede descargar (sin conexión).
- Normalizar nombres de proyecto (mayúsculas, guiones y guiones bajos) y pedir confirmación en los casos dudosos.
- Convertir los wikilinks a texto o a referencias internas, y los callouts a entradas separadas con su fecha.
- Omitir los archivos vacíos y reportarlos.
