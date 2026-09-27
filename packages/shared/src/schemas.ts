import { z } from "zod";

import { HOOK_EVENTS, PROMPT_PREVIEW_LENGTH, type HookEvent } from "./hook-event.ts";

const shortText = z.string().max(200).nullable();
const longText = z.string().max(4096).nullable();

export const hookEventSchema = z.object({
  event: z.enum(HOOK_EVENTS),
  ts: z.number().int().nonnegative(),
  sessionId: z.string().min(1).max(200),
  pid: z.number().int().positive().nullable(),
  origin: z.object({ entrypoint: shortText, bundleId: shortText, termProgram: shortText }),
  cwd: longText,
  // Opcional para aceptar eventos de hooks instalados con una versión anterior.
  projectDir: longText.default(null),
  transcriptPath: longText,
  permissionMode: shortText,
  model: shortText,
  source: shortText,
  reason: shortText,
  notificationType: shortText,
  toolName: shortText,
  agentType: shortText,
  prompt: z.string().max(PROMPT_PREVIEW_LENGTH).nullable(),
  backgroundTasks: z.number().int().nonnegative().nullable(),
}) satisfies z.ZodType<HookEvent>;

/**
 * - `working`: Claude está trabajando (azul).
 * - `waiting`: espera un permiso o una respuesta del usuario (ámbar).
 * - `done`: terminó de responder (verde).
 * - `idle`: abierta sin actividad (gris).
 * - `ended`: cerrada.
 */
export const SESSION_STATES = ["working", "waiting", "done", "idle", "ended"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** `cli` en una terminal, `ide` en una extensión, `desktop` en Claude Desktop. */
export const ORIGIN_KINDS = ["cli", "ide", "desktop", "unknown"] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export const END_REASONS = ["session-end", "process-exited", "inactivity"] as const;
export type EndReason = (typeof END_REASONS)[number];

export function originKind(entrypoint: string | null): OriginKind {
  switch (entrypoint) {
    case "cli":
      return "cli";
    case "claude-vscode":
      return "ide";
    case "claude-desktop":
      return "desktop";
    default:
      return "unknown";
  }
}

export const sessionSchema = z.object({
  /** Una instancia por `sessionId` + pid: la misma sesión puede estar abierta en dos apps (D-010). */
  id: z.string(),
  sessionId: z.string(),
  pid: z.number().int().nullable(),
  state: z.enum(SESSION_STATES),
  /** `hooks` si la sesión llegó por hooks; `transcript` si solo se vio su JSONL. */
  source: z.enum(["hooks", "transcript"]),
  origin: z.object({
    kind: z.enum(ORIGIN_KINDS),
    entrypoint: shortText,
    bundleId: shortText,
    termProgram: shortText,
  }),
  cwd: longText,
  projectName: longText,
  /** Carpeta abierta en el IDE, para enfocar su ventana al hacer clic. */
  projectDir: longText.default(null),
  /** Terminal del proceso `claude` (`/dev/ttys003`), para enfocar su pestaña. */
  tty: shortText.default(null),
  transcriptPath: longText,
  model: shortText,
  permissionMode: shortText,
  lastPrompt: z.string().max(PROMPT_PREVIEW_LENGTH).nullable(),
  startedAt: z.number(),
  stateChangedAt: z.number(),
  lastActivityAt: z.number(),
  /** `ts` del último evento de hook aplicado al estado. */
  lastEventTs: z.number(),
  endedAt: z.number().nullable(),
  endReason: z.enum(END_REASONS).nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

export const liveEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), sessions: z.array(sessionSchema) }),
  z.object({ type: z.literal("session.updated"), session: sessionSchema }),
  z.object({ type: z.literal("session.removed"), id: z.string() }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
