// `tokency doctor`: revisa cada pieza y explica cómo arreglar lo que falle (spec §4.10).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isAgentLoaded,
  isJsonObject,
  LAUNCH_AGENT_LABEL,
  readSecret,
  run,
  TOKEN_REF,
  tokencyPaths,
  type JsonValue,
  type TokencyPaths,
} from "@tokency/core";
import { HOOK_EVENTS, type UsageSummary } from "@tokency/shared";

import { coreClient } from "../client.ts";
import { ENTRY_FILE, HOOK_MARKER, nodeVersionOk } from "../install/plan.ts";
import { elapsed } from "./status.ts";
import { errorMessage, say } from "../output.ts";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** Cómo arreglarlo, si no está bien. */
  fix?: string;
}

/** Hooks de Tokency presentes en settings.json, por evento. */
export function installedTokencyHooks(settings: JsonValue): Map<string, string> {
  const found = new Map<string, string>();
  if (!isJsonObject(settings) || !isJsonObject(settings.hooks)) return found;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks) {
        if (
          isJsonObject(hook) &&
          typeof hook.command === "string" &&
          hook.command.includes(HOOK_MARKER)
        ) {
          found.set(event, hook.command);
        }
      }
    }
  }
  return found;
}

/** Saca la ruta de node del comando `'/ruta/node' '/ruta/tokency.mjs' hook X`. */
export function nodeFromCommand(command: string): string | null {
  return /^'([^']+)'/.exec(command)?.[1] ?? null;
}

async function nodeVersion(nodePath: string): Promise<string | null> {
  const result = await run(nodePath, ["--version"], { timeoutMs: 5_000 }).catch(() => null);
  return result?.code === 0 ? result.stdout.trim() : null;
}

export async function runChecks(paths: TokencyPaths): Promise<Check[]> {
  const checks: Check[] = [];
  const reinstall =
    "Ejecuta `pnpm build && node packages/cli/dist/tokency.mjs install` en el repo.";

  const entry = path.join(paths.appDir, ENTRY_FILE);
  checks.push(
    existsSync(entry)
      ? { name: "Bundle instalado", status: "ok", detail: entry }
      : { name: "Bundle instalado", status: "fail", detail: `Falta ${entry}`, fix: reinstall },
  );

  const token = await readSecret(TOKEN_REF).catch(() => null);
  checks.push(
    token === null
      ? { name: "Token en el Llavero", status: "fail", detail: "No existe", fix: reinstall }
      : { name: "Token en el Llavero", status: "ok", detail: TOKEN_REF.service },
  );

  const loaded = await isAgentLoaded(LAUNCH_AGENT_LABEL).catch(() => false);
  checks.push(
    !existsSync(paths.launchAgentPlist)
      ? { name: "LaunchAgent", status: "fail", detail: "Falta el plist", fix: reinstall }
      : loaded
        ? { name: "LaunchAgent", status: "ok", detail: `${LAUNCH_AGENT_LABEL} cargado` }
        : {
            name: "LaunchAgent",
            status: "fail",
            detail: "El plist existe pero no está cargado",
            fix: `launchctl bootstrap gui/$(id -u) "${paths.launchAgentPlist}"`,
          },
  );

  try {
    const client = await coreClient(paths);
    const health = await client.get<{ version: string; uptimeMs: number; sessions: number }>(
      "/v1/health",
    );
    const minutes = Math.round(health.uptimeMs / 60_000);
    checks.push({
      name: "Core",
      status: "ok",
      detail: `v${health.version}, puerto ${String(client.port)}, ${String(minutes)} min activo, ${String(health.sessions)} sesiones`,
    });
  } catch (error) {
    checks.push({
      name: "Core",
      status: "fail",
      detail: errorMessage(error),
      fix: "Revisa `tokency logs`; para reiniciarlo: launchctl kickstart -k gui/$(id -u)/com.tokency.core",
    });
  }

  let settings: JsonValue = null;
  try {
    settings = JSON.parse(await readFile(paths.claudeSettingsFile, "utf8")) as JsonValue;
  } catch {
    // Se reporta abajo como hooks faltantes.
  }
  const hooks = installedTokencyHooks(settings);
  const missing = HOOK_EVENTS.filter((event) => !hooks.has(event));
  checks.push(
    missing.length === 0
      ? { name: "Hooks de Claude Code", status: "ok", detail: `${String(hooks.size)} eventos` }
      : {
          name: "Hooks de Claude Code",
          status: "fail",
          detail: `Faltan: ${missing.join(", ")}`,
          fix: reinstall,
        },
  );

  const statusLine = isJsonObject(settings) ? settings.statusLine : undefined;
  const ownStatusLine =
    isJsonObject(statusLine) &&
    typeof statusLine.command === "string" &&
    statusLine.command.includes(HOOK_MARKER);
  checks.push(
    ownStatusLine
      ? { name: "Status line", status: "ok", detail: "la de Tokency (uso oficial del plan)" }
      : statusLine === undefined
        ? { name: "Status line", status: "fail", detail: "No está instalada", fix: reinstall }
        : {
            name: "Status line",
            status: "warn",
            detail: "Tienes una propia; el uso del plan se estima en lugar de leerse",
            fix: "Quita tu statusLine de ~/.claude/settings.json y reinstala si quieres el dato oficial.",
          },
  );

  try {
    const client = await coreClient(paths);
    const summary = await client.get<UsageSummary>("/v1/usage/summary");
    const five = summary.plan?.fiveHour;
    checks.push(
      five
        ? {
            name: "Uso oficial del plan",
            status: "ok",
            detail: `sesión ${String(Math.round(five.usedPercentage))} %, dato de hace ${elapsed(summary.generatedAt - five.observedAt)}`,
          }
        : {
            name: "Uso oficial del plan",
            status: "warn",
            detail: "Todavía no llega ningún dato oficial",
            fix: "Abre una sesión de Claude Code en la terminal y manda un mensaje: la status line lo envía.",
          },
    );
  } catch {
    // Si el core no responde ya se reportó arriba.
  }

  const hookNode = [...hooks.values()].map(nodeFromCommand).find((node) => node !== null);
  if (hookNode !== undefined) {
    const version = await nodeVersion(hookNode);
    checks.push(
      version !== null && nodeVersionOk(version)
        ? { name: "Node de los hooks", status: "ok", detail: `${hookNode} (${version})` }
        : {
            name: "Node de los hooks",
            status: "fail",
            detail: `${hookNode} ${version === null ? "no existe" : `es ${version}`}`,
            fix: `Instala Node 24.15+ y ${reinstall.charAt(0).toLowerCase()}${reinstall.slice(1)}`,
          },
    );
  }

  checks.push(
    existsSync(paths.cliWrapper)
      ? { name: "Comando tokency", status: "ok", detail: paths.cliWrapper }
      : { name: "Comando tokency", status: "warn", detail: "No está instalado", fix: reinstall },
  );

  checks.push(
    existsSync(paths.claudeProjectsDir)
      ? { name: "Transcripts de Claude Code", status: "ok", detail: paths.claudeProjectsDir }
      : {
          name: "Transcripts de Claude Code",
          status: "warn",
          detail: `No existe ${paths.claudeProjectsDir}`,
          fix: "Se crea al usar Claude Code por primera vez.",
        },
  );
  return checks;
}

export async function doctorCommand(): Promise<number> {
  say.title("Diagnóstico de Tokency");
  const checks = await runChecks(tokencyPaths());
  for (const check of checks) {
    const line = `${check.name}: ${check.detail}`;
    if (check.status === "ok") say.ok(line);
    else if (check.status === "warn") say.warn(line);
    else say.fail(line);
    if (check.status !== "ok" && check.fix !== undefined) say.info(`→ ${check.fix}`);
  }
  const failed = checks.filter((check) => check.status === "fail").length;
  say.title(failed === 0 ? "Todo en orden." : `${String(failed)} problemas por resolver.`);
  return failed === 0 ? 0 : 1;
}
