export interface Migration {
  version: number;
  sql: string;
}

/** Migraciones de la base local. Nunca se editan una vez publicadas: se agrega una nueva. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        ended_at INTEGER,
        data TEXT NOT NULL
      );
      CREATE INDEX sessions_state ON sessions (state);
      CREATE INDEX sessions_session_id ON sessions (session_id);

      -- Registro de eventos para diagnóstico: solo campos descriptivos, nunca contenido.
      CREATE TABLE hook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event TEXT NOT NULL,
        ts INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE INDEX hook_events_received_at ON hook_events (received_at);
    `,
  },
];
