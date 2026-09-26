import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { hasOwnHooks, isJsonObject, mergeOwnHooks, removeOwnHooks } from "./hooks.ts";
import {
  ConcurrentModificationError,
  InvalidSettingsError,
  type HooksConfig,
  type JsonObject,
  type JsonValue,
  type OwnershipTest,
} from "./types.ts";

export interface ClaudeSettingsPaths {
  settingsFile: string;
  backupDir: string;
}

export interface HookFileOptions {
  paths: ClaudeSettingsPaths;
  /** Nombre corto de quien instala (`tokency`, `diagnostics`); va en el nombre del respaldo. */
  owner: string;
  isOwn: OwnershipTest;
  now?: () => Date;
}

export interface InstallOptions extends HookFileOptions {
  hooks: HooksConfig;
}

export type InstallResult =
  { status: "installed"; backupPath: string } | { status: "unchanged"; backupPath: null };

export type UninstallResult =
  /** El archivo volvió a ser, byte por byte, el de antes de instalar. */
  | { status: "restored"; backupPath: string }
  /** El archivo no existía antes de instalar y se borró. */
  | { status: "deleted"; backupPath: string }
  /** Se quitaron los hooks propios y se conservaron otros cambios hechos después. */
  | { status: "removed"; backupPath: string }
  | { status: "not-installed"; backupPath: null };

const NEW_FILE_MODE = 0o600;

export function defaultClaudeSettingsPaths(
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): ClaudeSettingsPaths {
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude");
  return {
    settingsFile: path.join(claudeDir, "settings.json"),
    backupDir: path.join(home, "Library", "Application Support", "Tokency", "backups"),
  };
}

interface Snapshot {
  /** Archivo real: si `settings.json` es un enlace simbólico, se escribe en su destino. */
  target: string;
  /** `null` si el archivo no existe. */
  raw: string | null;
  settings: JsonObject;
  mode: number;
}

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) return null;
    throw error;
  }
}

function parseSettings(raw: string, file: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(raw) as JsonValue;
  } catch (error) {
    throw new InvalidSettingsError(`${file} no es JSON válido; no se modificó.`, { cause: error });
  }
  if (!isJsonObject(parsed)) {
    throw new InvalidSettingsError(`${file} no contiene un objeto JSON; no se modificó.`);
  }
  return parsed;
}

async function readSnapshot(settingsFile: string): Promise<Snapshot> {
  let target = settingsFile;
  try {
    target = await realpath(settingsFile);
  } catch (error) {
    if (!isErrnoException(error, "ENOENT")) throw error;
  }
  const raw = await readIfExists(target);
  if (raw === null) return { target, raw, settings: {}, mode: NEW_FILE_MODE };
  const { mode } = await stat(target);
  return { target, raw, settings: parseSettings(raw, settingsFile), mode: mode & 0o777 };
}

/** Respeta la sangría y el salto de línea final del archivo original. */
function serialize(settings: JsonObject, previousRaw: string | null): string {
  const indent = /^([ \t]+)\S/m.exec(previousRaw ?? "")?.[1] ?? "  ";
  const trailingNewline = previousRaw === null || previousRaw.endsWith("\n");
  return JSON.stringify(settings, null, indent) + (trailingNewline ? "\n" : "");
}

function backupName(owner: string, reason: string, date: Date, exists: boolean): string {
  const stamp = date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `claude-settings.${stamp}.${owner}.${reason}.${exists ? "json" : "absent"}`;
}

/** Guarda una copia exacta; un respaldo `.absent` indica que el archivo no existía. */
async function writeBackup(
  backupDir: string,
  snapshot: Snapshot,
  owner: string,
  reason: "pre-install" | "pre-uninstall",
  date: Date,
): Promise<string> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; ; attempt++) {
    // Si el nombre ya existe se avanza 1 ms: así el orden alfabético sigue siendo cronológico.
    const stamped = new Date(date.getTime() + attempt);
    const file = path.join(backupDir, backupName(owner, reason, stamped, snapshot.raw !== null));
    try {
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(snapshot.raw ?? "");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return file;
    } catch (error) {
      if (!isErrnoException(error, "EEXIST") || attempt >= 100) throw error;
    }
  }
}

async function assertUnchanged(snapshot: Snapshot): Promise<void> {
  if ((await readIfExists(snapshot.target)) !== snapshot.raw) {
    throw new ConcurrentModificationError(
      `${snapshot.target} cambió mientras se modificaba; no se escribió nada. Vuelve a intentarlo.`,
    );
  }
}

/** Escribe en un temporal del mismo directorio y lo renombra encima del original. */
async function writeAtomic(snapshot: Snapshot, content: string): Promise<void> {
  await mkdir(path.dirname(snapshot.target), { recursive: true });
  const temp = `${snapshot.target}.tokency-${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await open(temp, "wx", snapshot.mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // `open` aplica la umask; esto deja exactamente los permisos originales.
    await chmod(temp, snapshot.mode);
    await assertUnchanged(snapshot);
    await rename(temp, snapshot.target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

type OriginalBackup = { kind: "absent" } | { kind: "file"; raw: string; settings: JsonObject };

/**
 * Busca el respaldo previo a instalar más reciente que no tenga hooks propios:
 * ese es el estado original, aunque se haya reinstalado varias veces.
 */
async function findOriginalBackup(
  backupDir: string,
  owner: string,
  isOwn: OwnershipTest,
): Promise<OriginalBackup | undefined> {
  let names: string[];
  try {
    names = await readdir(backupDir);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) return undefined;
    throw error;
  }
  const suffix = `.${owner}.pre-install.`;
  const candidates = names
    .filter((name) => name.startsWith("claude-settings.") && name.includes(suffix))
    .sort()
    .reverse();
  for (const name of candidates) {
    if (name.endsWith(".absent")) return { kind: "absent" };
    const raw = await readFile(path.join(backupDir, name), "utf8");
    let settings: JsonObject;
    try {
      settings = parseSettings(raw, name);
    } catch {
      continue;
    }
    if (!hasOwnHooks(settings, isOwn)) return { kind: "file", raw, settings };
  }
  return undefined;
}

/** Respalda `settings.json` y le agrega los hooks propios sin tocar los del usuario. */
export async function installHooks(options: InstallOptions): Promise<InstallResult> {
  const { paths, owner, isOwn, hooks, now = () => new Date() } = options;
  const snapshot = await readSnapshot(paths.settingsFile);
  const next = mergeOwnHooks(snapshot.settings, hooks, isOwn);
  if (snapshot.raw !== null && isDeepStrictEqual(next, snapshot.settings)) {
    return { status: "unchanged", backupPath: null };
  }
  const backupPath = await writeBackup(paths.backupDir, snapshot, owner, "pre-install", now());
  await writeAtomic(snapshot, serialize(next, snapshot.raw));
  return { status: "installed", backupPath };
}

/**
 * Quita solo los hooks propios. Si lo que queda equivale al respaldo original,
 * restaura ese respaldo byte por byte; si no, conserva los demás cambios.
 */
export async function uninstallHooks(options: HookFileOptions): Promise<UninstallResult> {
  const { paths, owner, isOwn, now = () => new Date() } = options;
  const snapshot = await readSnapshot(paths.settingsFile);
  if (snapshot.raw === null) return { status: "not-installed", backupPath: null };
  const { settings: next, removed } = removeOwnHooks(snapshot.settings, isOwn);
  if (removed === 0) return { status: "not-installed", backupPath: null };

  const backupPath = await writeBackup(paths.backupDir, snapshot, owner, "pre-uninstall", now());
  const original = await findOriginalBackup(paths.backupDir, owner, isOwn);

  if (original?.kind === "absent" && isDeepStrictEqual(next, {})) {
    await assertUnchanged(snapshot);
    await unlink(snapshot.target);
    return { status: "deleted", backupPath };
  }
  if (original?.kind === "file" && isDeepStrictEqual(next, original.settings)) {
    await writeAtomic(snapshot, original.raw);
    return { status: "restored", backupPath };
  }
  await writeAtomic(snapshot, serialize(next, snapshot.raw));
  return { status: "removed", backupPath };
}
