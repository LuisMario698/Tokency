// Reglas de estado de las sesiones (D-010, D-014). Funciones puras: reciben la sesión anterior
// y devuelven la nueva, o la misma referencia si nada cambió.

import path from "node:path";

import {
  originKind,
  type EndReason,
  type HookEvent,
  type Session,
  type SessionState,
} from "@tokency/shared";

export interface SessionTimings {
  /** Tiempo en `done` antes de pasar a `idle`. */
  doneToIdleMs: number;
  /** Sin actividad durante este tiempo, la sesión se da por terminada. */
  endAfterInactiveMs: number;
  /** Una sesión vista solo por su JSONL pasa a `idle` tras este tiempo sin escrituras. */
  transcriptIdleMs: number;
}

export const DEFAULT_TIMINGS: SessionTimings = {
  doneToIdleMs: 15 * 60_000,
  endAfterInactiveMs: 60 * 60_000,
  transcriptIdleMs: 15_000,
};

/** Herramientas que detienen a Claude hasta que el usuario responde. */
const WAITING_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const WAITING_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog"]);
/** Eventos que reabren una sesión que se había dado por terminada. */
const REVIVING_EVENTS = new Set<HookEvent["event"]>(["SessionStart", "UserPromptSubmit"]);

export function instanceId(sessionId: string, pid: number | null): string {
  return `${sessionId}:${pid === null ? "hooks" : String(pid)}`;
}

export function transcriptInstanceId(sessionId: string): string {
  return `${sessionId}:transcript`;
}

function nextState(current: SessionState, event: HookEvent): SessionState {
  switch (event.event) {
    case "SessionStart":
      // En la extensión llega al abrir el panel, antes de cualquier prompt (D-010).
      return event.source === "compact" ? "working" : "idle";
    case "UserPromptSubmit":
    case "PostToolUse":
    case "PreCompact":
      return "working";
    case "PreToolUse":
      return event.toolName !== null && WAITING_TOOLS.has(event.toolName) ? "waiting" : "working";
    case "PermissionRequest":
      return "waiting";
    case "Notification":
      // `idle_prompt` no cambia nada: `done` se mantiene para que se note que terminó.
      return event.notificationType !== null && WAITING_NOTIFICATIONS.has(event.notificationType)
        ? "waiting"
        : current;
    case "Stop":
      return "done";
    case "SessionEnd":
      return "ended";
    case "SubagentStart":
    case "SubagentStop":
      return current;
  }
}

function projectNameOf(cwd: string | null): string | null {
  return cwd === null ? null : path.basename(cwd) || cwd;
}

function newSession(event: HookEvent, at: number): Session {
  return {
    id: instanceId(event.sessionId, event.pid),
    sessionId: event.sessionId,
    pid: event.pid,
    state: "idle",
    source: "hooks",
    origin: { kind: originKind(event.origin.entrypoint), ...event.origin },
    cwd: event.cwd,
    projectName: projectNameOf(event.cwd),
    projectDir: event.projectDir,
    tty: null,
    transcriptPath: event.transcriptPath,
    model: event.model,
    permissionMode: event.permissionMode,
    lastPrompt: null,
    startedAt: at,
    stateChangedAt: at,
    lastActivityAt: at,
    lastEventTs: 0,
    endedAt: null,
    endReason: null,
  };
}

/** Completa datos que faltaban sin tocar el estado. */
function mergeDetails(session: Session, event: HookEvent, at: number): Session {
  return {
    ...session,
    origin: {
      kind:
        session.origin.kind === "unknown"
          ? originKind(event.origin.entrypoint)
          : session.origin.kind,
      entrypoint: session.origin.entrypoint ?? event.origin.entrypoint,
      bundleId: session.origin.bundleId ?? event.origin.bundleId,
      termProgram: session.origin.termProgram ?? event.origin.termProgram,
    },
    cwd: event.cwd ?? session.cwd,
    projectName: session.projectName ?? projectNameOf(event.cwd),
    projectDir: session.projectDir ?? event.projectDir,
    transcriptPath: event.transcriptPath ?? session.transcriptPath,
    model: event.model ?? session.model,
    permissionMode: event.permissionMode ?? session.permissionMode,
    lastActivityAt: Math.max(session.lastActivityAt, at),
  };
}

function withState(session: Session, state: SessionState, at: number, reason?: EndReason): Session {
  if (state === session.state) return session;
  return {
    ...session,
    state,
    stateChangedAt: at,
    endedAt: state === "ended" ? at : null,
    endReason: state === "ended" ? (reason ?? null) : null,
  };
}

/**
 * Aplica un evento de hook. Devuelve `undefined` si no hay nada que mostrar (un cierre de una
 * sesión desconocida) y la misma referencia si el evento no cambia nada.
 */
export function applyHookEvent(
  previous: Session | undefined,
  event: HookEvent,
  at: number,
): Session | undefined {
  if (previous === undefined) {
    if (event.event === "SessionEnd") return undefined;
    const created = mergeDetails(newSession(event, at), event, at);
    return applyFresh(created, event, at);
  }
  if (previous.state === "ended" && !REVIVING_EVENTS.has(event.event)) return previous;
  // Los hooks asíncronos pueden llegar desordenados: uno más viejo solo completa datos.
  if (event.ts < previous.lastEventTs) return mergeDetails(previous, event, at);
  return applyFresh(mergeDetails(previous, event, at), event, at);
}

function applyFresh(session: Session, event: HookEvent, at: number): Session {
  const updated = withState(session, nextState(session.state, event), at, "session-end");
  return {
    ...updated,
    source: "hooks",
    lastEventTs: event.ts,
    lastPrompt: event.prompt ?? updated.lastPrompt,
  };
}

/** Sesión vista solo por su JSONL, sin hooks (fuente de respaldo, spec §4.2). */
export function createTranscriptSession(
  sessionId: string,
  details: { transcriptPath: string; cwd: string | null },
  at: number,
): Session {
  return {
    id: transcriptInstanceId(sessionId),
    sessionId,
    pid: null,
    state: "working",
    source: "transcript",
    origin: { kind: "unknown", entrypoint: null, bundleId: null, termProgram: null },
    cwd: details.cwd,
    projectName: projectNameOf(details.cwd),
    projectDir: null,
    tty: null,
    transcriptPath: details.transcriptPath,
    model: null,
    permissionMode: null,
    lastPrompt: null,
    startedAt: at,
    stateChangedAt: at,
    lastActivityAt: at,
    lastEventTs: 0,
    endedAt: null,
    endReason: null,
  };
}

export function applyTranscriptActivity(session: Session, at: number): Session {
  if (session.state === "ended" || at <= session.lastActivityAt) return session;
  const touched = { ...session, lastActivityAt: at };
  return session.source === "transcript" ? withState(touched, "working", at) : touched;
}

export function applyProcessExit(session: Session, at: number): Session {
  return session.state === "ended" ? session : withState(session, "ended", at, "process-exited");
}

/** Transiciones por tiempo: inactividad, `done` → `idle` y transcripts sin escrituras. */
export function applyTick(session: Session, now: number, timings: SessionTimings): Session {
  if (session.state === "ended") return session;
  const quiet = now - session.lastActivityAt;
  if (quiet >= timings.endAfterInactiveMs) return withState(session, "ended", now, "inactivity");
  if (
    session.source === "transcript" &&
    session.state === "working" &&
    quiet >= timings.transcriptIdleMs
  ) {
    return withState(session, "idle", now);
  }
  if (session.state === "done" && now - session.stateChangedAt >= timings.doneToIdleMs) {
    return withState(session, "idle", now);
  }
  return session;
}
