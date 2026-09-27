import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { LimitEvent, UsageEntry } from "./parser.ts";

export type LimitSource = "transcript" | "manual";

export interface StoredLimitEvent extends LimitEvent {
  source: LimitSource;
}

export interface FileState {
  offset: number;
  size: number;
  mtimeMs: number;
}

type Row = Record<string, SQLInputValue>;

const text = (value: SQLInputValue | undefined): string => (typeof value === "string" ? value : "");
const textOrNull = (value: SQLInputValue | undefined): string | null =>
  typeof value === "string" ? value : null;

function toEntry(row: Row): UsageEntry {
  return {
    messageId: text(row.message_id),
    requestId: text(row.request_id),
    sessionId: text(row.session_id),
    timestamp: Number(row.timestamp),
    model: text(row.model),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheWrite5mTokens: Number(row.cache_write_5m_tokens),
    cacheWrite1hTokens: Number(row.cache_write_1h_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    webSearches: Number(row.web_searches),
    fast: Number(row.fast) === 1,
    cwd: textOrNull(row.cwd),
  };
}

export class UsageRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Guarda en una sola transacción; los mensajes repetidos se ignoran. Devuelve cuántos entraron. */
  insertEntries(entries: readonly UsageEntry[]): number {
    if (entries.length === 0) return 0;
    const insert = this.#db.prepare(
      `INSERT OR IGNORE INTO usage_entries (message_id, request_id, session_id, timestamp, model,
         input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens,
         web_searches, fast, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    this.#db.exec("BEGIN");
    try {
      for (const e of entries) {
        const result = insert.run(
          e.messageId,
          e.requestId,
          e.sessionId,
          e.timestamp,
          e.model,
          e.inputTokens,
          e.outputTokens,
          e.cacheWrite5mTokens,
          e.cacheWrite1hTokens,
          e.cacheReadTokens,
          e.webSearches,
          e.fast ? 1 : 0,
          e.cwd,
        );
        added += Number(result.changes);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return added;
  }

  /** Devuelve `true` si el aviso es nuevo. */
  insertLimitEvent(event: LimitEvent, source: LimitSource): boolean {
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO limit_events (source, timestamp, session_id, kind, resets_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(source, event.timestamp, event.sessionId, event.kind, event.resetsAt);
    return Number(result.changes) > 0;
  }

  /** Consumo con `from <= timestamp < to`, en orden cronológico. */
  entriesBetween(from: number, to: number): UsageEntry[] {
    return this.#db
      .prepare(
        "SELECT * FROM usage_entries WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp",
      )
      .all(from, to)
      .map((row) => toEntry(row as Row));
  }

  limitEvents(since = 0): StoredLimitEvent[] {
    return this.#db
      .prepare("SELECT * FROM limit_events WHERE timestamp >= ? ORDER BY timestamp")
      .all(since)
      .map((row) => ({
        source: row.source === "manual" ? "manual" : "transcript",
        timestamp: Number(row.timestamp),
        sessionId: textOrNull(row.session_id),
        kind: text(row.kind),
        resetsAt: row.resets_at === null ? null : Number(row.resets_at),
        message: "",
      }));
  }

  firstEntryAt(): number | null {
    const row = this.#db.prepare("SELECT MIN(timestamp) AS at FROM usage_entries").get();
    return typeof row?.at === "number" ? row.at : null;
  }

  fileState(path: string): FileState | null {
    const row = this.#db.prepare("SELECT * FROM usage_files WHERE path = ?").get(path);
    if (row === undefined) return null;
    return {
      offset: Number(row.read_offset),
      size: Number(row.size),
      mtimeMs: Number(row.mtime_ms),
    };
  }

  saveFileState(path: string, state: FileState): void {
    this.#db
      .prepare(
        `INSERT INTO usage_files (path, read_offset, size, mtime_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET read_offset = excluded.read_offset, size = excluded.size,
           mtime_ms = excluded.mtime_ms`,
      )
      .run(path, state.offset, state.size, state.mtimeMs);
  }
}
