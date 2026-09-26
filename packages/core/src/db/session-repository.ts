import type { DatabaseSync } from "node:sqlite";

import { sessionSchema, type HookEvent, type Session } from "@tokency/shared";

import type { Logger } from "../logger.ts";
import type { SessionStore } from "../sessions/registry.ts";

export class SessionRepository implements SessionStore {
  readonly #db: DatabaseSync;
  readonly #logger: Logger;

  constructor(db: DatabaseSync, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  save(session: Session): void {
    this.#db
      .prepare(
        `INSERT INTO sessions (id, session_id, state, started_at, last_activity_at, ended_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           state = excluded.state,
           last_activity_at = excluded.last_activity_at,
           ended_at = excluded.ended_at,
           data = excluded.data`,
      )
      .run(
        session.id,
        session.sessionId,
        session.state,
        session.startedAt,
        session.lastActivityAt,
        session.endedAt,
        JSON.stringify(session),
      );
  }

  remove(id: string): void {
    this.#db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  loadActive(): Session[] {
    const rows = this.#db.prepare("SELECT id, data FROM sessions WHERE state != 'ended'").all();
    return rows.flatMap((row) => {
      const result = sessionSchema.safeParse(JSON.parse(String(row.data)));
      if (result.success) return [result.data];
      // Un registro de una versión anterior que ya no encaja se descarta sin tumbar el core.
      this.#logger.warn("Sesión guardada con formato inválido; se ignora", { id: row.id });
      return [];
    });
  }

  /** Guarda un evento con solo sus campos descriptivos (nunca el prompt). */
  recordHookEvent(instanceId: string, event: HookEvent, receivedAt: number): void {
    const detail = {
      toolName: event.toolName,
      source: event.source,
      reason: event.reason,
      notificationType: event.notificationType,
      agentType: event.agentType,
      permissionMode: event.permissionMode,
      entrypoint: event.origin.entrypoint,
    };
    this.#db
      .prepare(
        "INSERT INTO hook_events (instance_id, session_id, event, ts, received_at, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(instanceId, event.sessionId, event.event, event.ts, receivedAt, JSON.stringify(detail));
  }

  pruneHookEvents(olderThan: number): number {
    const result = this.#db.prepare("DELETE FROM hook_events WHERE received_at < ?").run(olderThan);
    return Number(result.changes);
  }

  lastHookEventAt(): number | null {
    const row = this.#db.prepare("SELECT MAX(received_at) AS at FROM hook_events").get();
    return typeof row?.at === "number" ? row.at : null;
  }
}
