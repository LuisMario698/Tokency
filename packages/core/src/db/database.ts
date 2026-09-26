import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "./migrations.ts";

/** Abre (o crea) la base local y aplica las migraciones pendientes. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 2000");
  migrate(db);
  return db;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
  return typeof row?.version === "number" ? row.version : 0;
}

function migrate(db: DatabaseSync): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const current = schemaVersion(db);
  const record = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      record.run(migration.version, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Falló la migración ${migration.version} de la base local.`, {
        cause: error,
      });
    }
  }
}
