export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

// Interfaz (y no `Record`) porque el tipo es recursivo.
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Hook de tipo comando tal como lo documenta Claude Code (`timeout` en segundos). */
export interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
  /** Corre en segundo plano sin bloquear a Claude (D-013). */
  async?: boolean;
}

export interface HookMatcherGroup {
  /** Se omite en eventos sin matcher o para coincidir con todo. */
  matcher?: string;
  hooks: readonly CommandHook[];
}

/** Hooks por nombre de evento (`SessionStart`, `Stop`, …). */
export type HooksConfig = Readonly<Record<string, readonly HookMatcherGroup[]>>;

/** Decide si un hook ya presente en `settings.json` pertenece a quien instala. */
export type OwnershipTest = (hook: JsonObject) => boolean;

export class InvalidSettingsError extends Error {
  override name = "InvalidSettingsError";
}

export class ConcurrentModificationError extends Error {
  override name = "ConcurrentModificationError";
}
