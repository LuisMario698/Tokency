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
  {
    version: 2,
    sql: `
      -- Consumo por mensaje de la API, deduplicado (D-015). Solo números, nunca contenido.
      CREATE TABLE usage_entries (
        message_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_write_5m_tokens INTEGER NOT NULL,
        cache_write_1h_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        web_searches INTEGER NOT NULL,
        fast INTEGER NOT NULL,
        cwd TEXT,
        PRIMARY KEY (message_id, request_id)
      );
      CREATE INDEX usage_entries_timestamp ON usage_entries (timestamp);
      CREATE INDEX usage_entries_session_id ON usage_entries (session_id);

      -- Hasta qué byte se leyó cada JSONL, para procesar solo lo nuevo.
      CREATE TABLE usage_files (
        path TEXT PRIMARY KEY,
        read_offset INTEGER NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL
      );

      -- Avisos de límite: los que escribe Claude Code y los que marca el usuario.
      CREATE TABLE limit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT,
        kind TEXT NOT NULL,
        resets_at INTEGER,
        UNIQUE (source, timestamp, kind)
      );
    `,
  },
];
