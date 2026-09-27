// Piezas puras de la instalación: qué se escribe y dónde (D-013).

import path from "node:path";

import {
  commandContains,
  LAUNCH_AGENT_LABEL,
  type HooksConfig,
  type OwnershipTest,
  type StatusLineConfig,
  type TokencyPaths,
} from "@tokency/core";
import { HOOK_EVENTS } from "@tokency/shared";

export const ENTRY_FILE = "tokency.mjs";
export const HOOK_OWNER = "tokency";
/** Marca los hooks de Tokency aunque cambie la ruta de node. */
export const HOOK_MARKER = `/Library/Application Support/Tokency/app/${ENTRY_FILE}`;
export const isTokencyHook: OwnershipTest = commandContains(HOOK_MARKER);

export const MIN_NODE = [24, 15] as const;

export function nodeVersionOk(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/**
 * Homebrew instala node en una ruta con la versión (`Cellar/node/26.3.1`) que desaparece al
 * actualizar; su enlace `opt/<fórmula>` es estable. Otras rutas se usan tal cual.
 */
export function stableNodePath(execPath: string, exists: (file: string) => boolean): string {
  const match = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(execPath);
  if (match === null) return execPath;
  const [, prefix = "", formula = "node"] = match;
  const stable = `${prefix}/opt/${formula}/bin/node`;
  return exists(stable) ? stable : execPath;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function entryPath(paths: TokencyPaths): string {
  return path.join(paths.appDir, ENTRY_FILE);
}

/** Solo SessionStart es síncrono (en la Fase 4 devolverá contexto); el resto no bloquea a Claude. */
export function tokencyHooks(nodePath: string, entry: string): HooksConfig {
  return Object.fromEntries(
    HOOK_EVENTS.map((event) => {
      const command = `${shellQuote(nodePath)} ${shellQuote(entry)} hook ${event}`;
      const hook =
        event === "SessionStart"
          ? { type: "command" as const, command, timeout: 5 }
          : { type: "command" as const, command, timeout: 10, async: true };
      return [event, [{ hooks: [hook] }]];
    }),
  );
}

/** Status line de Tokency: la única fuente oficial del uso del plan (D-017). */
export function tokencyStatusLine(nodePath: string, entry: string): StatusLineConfig {
  return {
    type: "command",
    command: `${shellQuote(nodePath)} ${shellQuote(entry)} statusline`,
    padding: 0,
  };
}

export const WRAPPER_MARKER = "# Generado por `tokency install`.";

export function wrapperScript(nodePath: string, entry: string): string {
  return `#!/bin/sh
${WRAPPER_MARKER} Se reemplaza al reinstalar.
exec ${shellQuote(nodePath)} ${shellQuote(entry)} "$@"
`;
}

export function launchAgentSpec(paths: TokencyPaths, nodePath: string) {
  return {
    label: LAUNCH_AGENT_LABEL,
    programArguments: [nodePath, entryPath(paths), "serve"],
    workingDirectory: paths.appDir,
    stdoutPath: path.join(paths.logsDir, "core.stdout.log"),
    stderrPath: path.join(paths.logsDir, "core.stderr.log"),
    environment: { TOKENCY_LAUNCHD: "1" },
  };
}
