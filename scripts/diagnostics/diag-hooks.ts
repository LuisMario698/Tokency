// Instala, desinstala y analiza el hook de diagnóstico temporal de la Fase 0 (D-005).
//
//   node scripts/diagnostics/diag-hooks.ts install     respalda settings.json y agrega el hook
//   node scripts/diagnostics/diag-hooks.ts status      dice si está instalado y cuántas capturas hay
//   node scripts/diagnostics/diag-hooks.ts report      resume las capturas sin mostrar contenido
//   node scripts/diagnostics/diag-hooks.ts uninstall   quita el hook y restaura settings.json
//
// Opciones para pruebas: --settings <archivo>, --backups <carpeta>, --captures <carpeta>.

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  commandContains,
  defaultClaudeSettingsPaths,
  hasOwnHooks,
  installHooks,
  isJsonObject,
  uninstallHooks,
  type HooksConfig,
  type JsonObject,
  type JsonValue,
} from "../../packages/core/src/index.ts";
import { parseMeta, summarize, type Capture } from "./report.ts";

/** Solo eventos de observación con soporte de larga data (D-005). */
export const DIAGNOSTIC_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "SessionEnd",
] as const;

/** Reconoce el hook aunque el repo cambie de carpeta. */
export const DIAGNOSTIC_MARKER = "/scripts/diagnostics/capture-hook.sh";
export const DIAGNOSTIC_OWNER = "diagnostics";
const TIMEOUT_SECONDS = 5;

export const isDiagnosticHook = commandContains(DIAGNOSTIC_MARKER);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function diagnosticHooks(scriptPath: string): HooksConfig {
  return Object.fromEntries(
    DIAGNOSTIC_EVENTS.map((event) => [
      event,
      [
        {
          hooks: [
            {
              type: "command",
              command: `/bin/sh ${shellQuote(scriptPath)} ${event}`,
              timeout: TIMEOUT_SECONDS,
            },
          ],
        },
      ],
    ]),
  );
}

export function defaultCapturesDir(home: string = os.homedir()): string {
  return path.join(home, "Library", "Logs", "Tokency", "diagnostics");
}

function parsePayload(raw: string): JsonObject | null {
  try {
    const parsed = JSON.parse(raw) as JsonValue;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadCaptures(dir: string): Promise<Capture[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const captures: Capture[] = [];
  for (const name of names.filter((n) => n.endsWith(".payload.json"))) {
    const base = name.slice(0, -".payload.json".length);
    const payloadFile = path.join(dir, name);
    const payload = parsePayload(await readFile(payloadFile, "utf8"));
    const metaText = await readFile(path.join(dir, `${base}.meta.txt`), "utf8").catch(() => "");
    captures.push({
      name: base,
      capturedAt: (await stat(payloadFile)).mtimeMs,
      meta: parseMeta(metaText),
      payload,
    });
  }
  return captures;
}

async function isInstalled(settingsFile: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(settingsFile, "utf8")) as JsonValue;
    return isJsonObject(parsed) && hasOwnHooks(parsed, isDiagnosticHook);
  } catch {
    return false;
  }
}

const UNINSTALL_MESSAGES = {
  restored: "settings.json quedó exactamente como estaba antes de instalar.",
  deleted: "settings.json no existía antes de instalar; se borró.",
  removed:
    "Se quitó el hook. settings.json tuvo otros cambios después de instalar y se conservaron.",
  "not-installed": "El hook de diagnóstico no estaba instalado; no se tocó nada.",
} as const;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      settings: { type: "string" },
      backups: { type: "string" },
      captures: { type: "string" },
    },
  });
  const defaults = defaultClaudeSettingsPaths();
  const paths = {
    settingsFile: values.settings ?? defaults.settingsFile,
    backupDir: values.backups ?? defaults.backupDir,
  };
  const capturesDir = values.captures ?? defaultCapturesDir();
  const options = { paths, owner: DIAGNOSTIC_OWNER, isOwn: isDiagnosticHook };

  switch (positionals[0]) {
    case "install": {
      const scriptPath = fileURLToPath(new URL("capture-hook.sh", import.meta.url));
      const result = await installHooks({ ...options, hooks: diagnosticHooks(scriptPath) });
      if (result.status === "unchanged") {
        console.log("El hook de diagnóstico ya estaba instalado.");
      } else {
        console.log(`Hook de diagnóstico instalado en ${paths.settingsFile}`);
        console.log(`Respaldo: ${result.backupPath}`);
        console.log(`Las capturas se guardan en ${capturesDir}`);
      }
      return;
    }
    case "uninstall": {
      const result = await uninstallHooks(options);
      console.log(UNINSTALL_MESSAGES[result.status]);
      if (result.backupPath !== null) console.log(`Respaldo previo: ${result.backupPath}`);
      return;
    }
    case "status": {
      const installed = await isInstalled(paths.settingsFile);
      const captures = await loadCaptures(capturesDir);
      console.log(`Instalado: ${installed ? "sí" : "no"}`);
      console.log(`Capturas: ${captures.length} en ${capturesDir}`);
      return;
    }
    case "report": {
      process.stdout.write(summarize(await loadCaptures(capturesDir), existsSync));
      return;
    }
    default:
      console.error("Uso: node scripts/diagnostics/diag-hooks.ts install|uninstall|status|report");
      process.exitCode = 2;
  }
}

if (import.meta.main) await main();
