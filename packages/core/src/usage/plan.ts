// Uso oficial del plan, tal como lo reporta Claude Code en la status line (D-017).

import type { DatabaseSync } from "node:sqlite";

import type { RateLimitWindow, StatusSnapshot } from "@tokency/shared";

export const PLAN_KINDS = ["five_hour", "seven_day", "spend_limit"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export interface PlanSnapshot {
  kind: PlanKind;
  /** Primera vez que se vio este valor. */
  firstObservedAt: number;
  /** Última vez que Claude Code lo confirmó. */
  observedAt: number;
  usedPercentage: number;
  resetsAt: number;
  sessionId: string | null;
}

function windowOf(snapshot: StatusSnapshot, kind: PlanKind): RateLimitWindow | null {
  switch (kind) {
    case "five_hour":
      return snapshot.fiveHour;
    case "seven_day":
      return snapshot.sevenDay;
    case "spend_limit":
      return snapshot.spendLimit;
  }
}

function toSnapshot(row: Record<string, unknown>): PlanSnapshot {
  return {
    kind: row.kind as PlanKind,
    firstObservedAt: Number(row.first_observed_at),
    observedAt: Number(row.observed_at),
    usedPercentage: Number(row.used_percentage),
    resetsAt: Number(row.resets_at),
    sessionId: typeof row.session_id === "string" ? row.session_id : null,
  };
}

export class PlanRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Guarda los límites del snapshot; devuelve `true` si alguno cambió de valor. */
  record(snapshot: StatusSnapshot): boolean {
    let changed = false;
    for (const kind of PLAN_KINDS) {
      const window = windowOf(snapshot, kind);
      if (window === null) continue;
      const latest = this.latest(kind);
      const same =
        latest !== null &&
        latest.usedPercentage === window.usedPercentage &&
        latest.resetsAt === window.resetsAt;
      if (same) {
        this.#db
          .prepare(
            "UPDATE plan_snapshots SET observed_at = MAX(observed_at, ?) WHERE kind = ? AND observed_at = ?",
          )
          .run(snapshot.ts, kind, latest.observedAt);
        continue;
      }
      // Un snapshot atrasado (de un proceso que tardó) no reemplaza a uno más nuevo.
      if (latest !== null && snapshot.ts < latest.observedAt) continue;
      this.#db
        .prepare(
          `INSERT INTO plan_snapshots (kind, first_observed_at, observed_at, used_percentage, resets_at, session_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          kind,
          snapshot.ts,
          snapshot.ts,
          window.usedPercentage,
          window.resetsAt,
          snapshot.sessionId,
        );
      changed = true;
    }
    return changed;
  }

  latest(kind: PlanKind): PlanSnapshot | null {
    const row = this.#db
      .prepare(
        "SELECT * FROM plan_snapshots WHERE kind = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
      )
      .get(kind);
    return row === undefined ? null : toSnapshot(row);
  }

  history(kind: PlanKind, since: number): PlanSnapshot[] {
    return this.#db
      .prepare(
        "SELECT * FROM plan_snapshots WHERE kind = ? AND observed_at >= ? ORDER BY observed_at",
      )
      .all(kind, since)
      .map(toSnapshot);
  }
}
