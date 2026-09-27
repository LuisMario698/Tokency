// `tokency status`: sesiones abiertas según el core.

import { tokencyPaths } from "@tokency/core";
import type { Session, SessionState } from "@tokency/shared";

import { coreClient } from "../client.ts";
import { errorMessage, say } from "../output.ts";

const STATE_LABELS: Record<SessionState, string> = {
  working: "🔵 trabajando",
  waiting: "🟠 esperando",
  done: "🟢 terminó",
  idle: "⚪ inactiva",
  ended: "⚫ cerrada",
};

const ORIGIN_LABELS: Record<Session["origin"]["kind"], string> = {
  cli: "terminal",
  ide: "IDE",
  desktop: "Claude Desktop",
  unknown: "desconocido",
};

export function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ${String(minutes % 60)} min`;
  return `${String(Math.floor(hours / 24))} d ${String(hours % 24)} h`;
}

export function formatSession(session: Session, now: number): string {
  const origin = session.origin.bundleId ?? ORIGIN_LABELS[session.origin.kind];
  const prompt = session.lastPrompt === null ? "" : ` · «${session.lastPrompt.slice(0, 60)}»`;
  return `${STATE_LABELS[session.state]}  ${session.projectName ?? "(sin proyecto)"} · ${origin} · ${elapsed(now - session.startedAt)}${prompt}`;
}

export async function statusCommand(): Promise<number> {
  try {
    const client = await coreClient(tokencyPaths());
    const { sessions } = await client.get<{ sessions: Session[] }>("/v1/sessions");
    if (sessions.length === 0) {
      say.title("No hay sesiones de Claude abiertas.");
      return 0;
    }
    say.title(`${String(sessions.length)} sesiones abiertas:`);
    const now = Date.now();
    for (const session of sessions) say.info(formatSession(session, now));
    return 0;
  } catch (error) {
    say.fail(errorMessage(error));
    return 1;
  }
}
