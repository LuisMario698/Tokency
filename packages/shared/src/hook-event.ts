// Evento de hook ya saneado: lo que `tokency hook` envía al core. Este módulo no importa
// Zod para que el hook arranque rápido; el esquema de validación está en `schemas.ts`.

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "SessionEnd",
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

/** Datos del proceso que ejecuta el hook, tomados de su entorno (D-010). */
export interface HookOrigin {
  /** `CLAUDE_CODE_ENTRYPOINT`: `cli`, `claude-vscode`, `claude-desktop`… */
  entrypoint: string | null;
  /** `__CFBundleIdentifier` de la app que lanzó a Claude Code. */
  bundleId: string | null;
  /** `TERM_PROGRAM`, solo en terminales. */
  termProgram: string | null;
}

export interface HookEvent {
  event: HookEventName;
  /** Milisegundos desde epoch en que arrancó el hook; ordena eventos asíncronos. */
  ts: number;
  sessionId: string;
  /** Pid del proceso `claude`. */
  pid: number | null;
  origin: HookOrigin;
  cwd: string | null;
  /** `CLAUDE_PROJECT_DIR`: la carpeta abierta en el IDE; sirve para enfocar su ventana. */
  projectDir: string | null;
  transcriptPath: string | null;
  permissionMode: string | null;
  model: string | null;
  /** `source` de SessionStart (`startup`, `resume`, `clear`, `compact`). */
  source: string | null;
  /** `reason` de SessionEnd. */
  reason: string | null;
  notificationType: string | null;
  toolName: string | null;
  agentType: string | null;
  /** Vista previa del prompt, recortada y sin secretos evidentes. */
  prompt: string | null;
  /** Cantidad de tareas en segundo plano que reporta Stop. */
  backgroundTasks: number | null;
}

export const PROMPT_PREVIEW_LENGTH = 200;
const MAX_FIELD_LENGTH = 4096;

const SECRET_PATTERN =
  /\b(?:sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g;

/** Tapa tokens con formato conocido (Anthropic, GitHub, Slack, AWS, JWT). */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[secreto]");
}

export function promptPreview(prompt: string): string {
  const flat = redactSecrets(prompt).replace(/\s+/g, " ").trim();
  if (flat.length <= PROMPT_PREVIEW_LENGTH) return flat;
  return `${flat.slice(0, PROMPT_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

function isHookEventName(value: unknown): value is HookEventName {
  return typeof value === "string" && (HOOK_EVENTS as readonly string[]).includes(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}

export interface SanitizeContext {
  /** Evento que recibió el comando por argumento, por si el payload no lo trae. */
  fallbackEvent: string;
  ts: number;
  pid: number | null;
  origin: HookOrigin;
  projectDir: string | null;
}

/**
 * Convierte el payload crudo de Claude Code en un evento con una lista cerrada de campos.
 * Nunca copia `tool_input`, `tool_response` ni `last_assistant_message` (D-013).
 * Devuelve `null` si el evento no se reconoce o no trae `session_id`.
 */
export function sanitizeHookPayload(raw: unknown, context: SanitizeContext): HookEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const event =
    typeof payload.hook_event_name === "string" ? payload.hook_event_name : context.fallbackEvent;
  const sessionId = text(payload.session_id);
  if (!isHookEventName(event) || sessionId === null) return null;

  const prompt = event === "UserPromptSubmit" ? text(payload.prompt) : null;
  const tasks = payload.background_tasks;
  return {
    event,
    ts: context.ts,
    sessionId,
    pid: context.pid,
    origin: context.origin,
    cwd: text(payload.cwd),
    projectDir: context.projectDir === null ? null : text(context.projectDir),
    transcriptPath: text(payload.transcript_path),
    permissionMode: text(payload.permission_mode),
    model: text(payload.model),
    source: text(payload.source),
    reason: text(payload.reason),
    notificationType: text(payload.notification_type),
    toolName: text(payload.tool_name),
    // Un `agent_type` vacío identifica al agente interno que sigue a Stop (D-010).
    agentType: typeof payload.agent_type === "string" ? payload.agent_type.slice(0, 200) : null,
    prompt: prompt === null ? null : promptPreview(prompt),
    backgroundTasks: Array.isArray(tasks) ? tasks.length : null,
  };
}
