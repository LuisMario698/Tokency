import type { HookEvent, Session } from "@tokency/shared";

import {
  applyHookEvent,
  applyProcessExit,
  applyTick,
  applyTranscriptActivity,
  createTranscriptSession,
  DEFAULT_TIMINGS,
  instanceId,
  transcriptInstanceId,
  type SessionTimings,
} from "./state-machine.ts";

export type SessionChange = { type: "updated"; session: Session } | { type: "removed"; id: string };

/** Persistencia de sesiones; la implementa el repositorio de SQLite. */
export interface SessionStore {
  save(session: Session): void;
  remove(id: string): void;
  loadActive(): Session[];
}

export interface RegistryOptions {
  store: SessionStore;
  timings?: SessionTimings;
  now?: () => number;
  /** Espera antes de crear una sesión solo por su JSONL, por si su primer hook viene en camino. */
  transcriptGraceMs?: number;
  /** Tiempo que una sesión terminada se recuerda para ignorar eventos rezagados. */
  endedRetentionMs?: number;
}

interface PendingTranscript {
  firstSeen: number;
  lastSeen: number;
  transcriptPath: string;
  cwd: string | null;
}

export class SessionRegistry {
  readonly #sessions = new Map<string, Session>();
  readonly #pending = new Map<string, PendingTranscript>();
  readonly #listeners = new Set<(change: SessionChange) => void>();
  readonly #store: SessionStore;
  readonly #timings: SessionTimings;
  readonly #now: () => number;
  readonly #transcriptGraceMs: number;
  readonly #endedRetentionMs: number;

  constructor(options: RegistryOptions) {
    this.#store = options.store;
    this.#timings = options.timings ?? DEFAULT_TIMINGS;
    this.#now = options.now ?? Date.now;
    this.#transcriptGraceMs = options.transcriptGraceMs ?? 5_000;
    this.#endedRetentionMs = options.endedRetentionMs ?? 10 * 60_000;
  }

  /** Recupera las sesiones que seguían activas cuando el core se detuvo. */
  load(): void {
    for (const session of this.#store.loadActive()) this.#sessions.set(session.id, session);
  }

  subscribe(listener: (change: SessionChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Sesiones abiertas, de la más antigua a la más reciente. */
  list(): Session[] {
    return [...this.#sessions.values()]
      .filter((session) => session.state !== "ended")
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  /** Pids que conviene vigilar para saber si el proceso de Claude sigue vivo. */
  livePids(): { id: string; pid: number }[] {
    return this.list().flatMap((s) => (s.pid === null ? [] : [{ id: s.id, pid: s.pid }]));
  }

  applyHook(event: HookEvent): void {
    const now = this.#now();
    const id = instanceId(event.sessionId, event.pid);
    const next = applyHookEvent(this.#sessions.get(id), event, now);
    if (next === undefined) return;
    this.#pending.delete(event.sessionId);
    this.#removeTranscriptInstance(event.sessionId);
    this.#commit(next);
  }

  transcriptActivity(
    sessionId: string,
    details: { transcriptPath: string; cwd: string | null },
  ): void {
    const now = this.#now();
    const known = [...this.#sessions.values()].filter((s) => s.sessionId === sessionId);
    if (known.length > 0) {
      for (const session of known) this.#commit(applyTranscriptActivity(session, now));
      return;
    }
    const pending = this.#pending.get(sessionId);
    this.#pending.set(sessionId, {
      firstSeen: pending?.firstSeen ?? now,
      lastSeen: now,
      transcriptPath: details.transcriptPath,
      cwd: details.cwd ?? pending?.cwd ?? null,
    });
  }

  /** Anota la terminal del proceso, que el core averigua aparte (ver `service.ts`). */
  setTty(id: string, tty: string): void {
    const session = this.#sessions.get(id);
    if (session !== undefined && session.tty !== tty) this.#commit({ ...session, tty });
  }

  processExited(id: string): void {
    const session = this.#sessions.get(id);
    if (session !== undefined) this.#commit(applyProcessExit(session, this.#now()));
  }

  /** Se llama cada pocos segundos: transiciones por tiempo y limpieza. */
  tick(): void {
    const now = this.#now();
    for (const [sessionId, pending] of this.#pending) {
      if (now - pending.firstSeen < this.#transcriptGraceMs) continue;
      this.#pending.delete(sessionId);
      const created = createTranscriptSession(sessionId, pending, pending.firstSeen);
      this.#commit(applyTranscriptActivity(created, pending.lastSeen));
    }
    for (const session of this.#sessions.values()) {
      if (session.state === "ended") {
        if (now - (session.endedAt ?? now) >= this.#endedRetentionMs) {
          this.#sessions.delete(session.id);
        }
        continue;
      }
      this.#commit(applyTick(session, now, this.#timings));
    }
  }

  #removeTranscriptInstance(sessionId: string): void {
    const id = transcriptInstanceId(sessionId);
    if (!this.#sessions.delete(id)) return;
    this.#store.remove(id);
    this.#emit({ type: "removed", id });
  }

  #commit(next: Session): void {
    if (this.#sessions.get(next.id) === next) return;
    this.#sessions.set(next.id, next);
    this.#store.save(next);
    this.#emit({ type: "updated", session: next });
  }

  #emit(change: SessionChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}
