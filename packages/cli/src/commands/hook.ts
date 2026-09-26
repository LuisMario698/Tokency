// `tokency hook <evento>`: lo ejecuta Claude Code en cada evento (D-013).
// Reglas: nunca imprime nada, nunca falla y termina rápido aunque el core esté apagado.

import { appendFileSync, readFileSync, statSync, truncateSync } from "node:fs";
import path from "node:path";

import { readSecret, TOKEN_REF } from "@tokency/core/keychain";
import { tokencyPaths } from "@tokency/core/paths";
import { sanitizeHookPayload, type HookEvent } from "@tokency/shared/hook-event";

const DEFAULT_PORT = 7777;
const STDIN_TIMEOUT_MS = 2_000;
const POST_TIMEOUT_MS = 1_500;
const MAX_ERROR_LOG_BYTES = 256 * 1024;

export interface HookDeps {
  readStdin: () => Promise<string>;
  readToken: () => Promise<string | null>;
  readPort: () => number;
  post: (url: string, token: string, body: string) => Promise<void>;
  logError: (message: string) => void;
  env: NodeJS.ProcessEnv;
  ppid: number;
  now: () => number;
}

function envText(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

/** Pid del proceso `claude`: `CLAUDE_PID` si existe; si no, el padre del hook. */
export function claudePid(env: NodeJS.ProcessEnv, ppid: number): number | null {
  const fromEnv = Number(env.CLAUDE_PID);
  if (Number.isInteger(fromEnv) && fromEnv > 1) return fromEnv;
  return ppid > 1 ? ppid : null;
}

export function buildHookEvent(
  eventName: string,
  stdin: string,
  deps: Pick<HookDeps, "env" | "ppid">,
  ts: number,
): HookEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  return sanitizeHookPayload(raw, {
    fallbackEvent: eventName,
    ts,
    pid: claudePid(deps.env, deps.ppid),
    origin: {
      entrypoint: envText(deps.env.CLAUDE_CODE_ENTRYPOINT),
      bundleId: envText(deps.env.__CFBundleIdentifier),
      termProgram: envText(deps.env.TERM_PROGRAM),
    },
  });
}

/** Nunca lanza: cualquier problema se anota en `hook.log` y el hook termina en silencio. */
export async function runHook(eventName: string, deps: HookDeps): Promise<void> {
  const ts = deps.now();
  try {
    const event = buildHookEvent(eventName, await deps.readStdin(), deps, ts);
    if (event === null) return;
    const token = await deps.readToken();
    if (token === null) {
      deps.logError("No hay token de Tokency en el Llavero; ejecuta `tokency install`.");
      return;
    }
    const url = `http://127.0.0.1:${String(deps.readPort())}/v1/hooks`;
    await deps.post(url, token, JSON.stringify(event));
  } catch (error) {
    deps.logError(error instanceof Error ? error.message : String(error));
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    const timer = setTimeout(() => {
      resolve(data);
    }, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Lee solo el puerto de `config.json`, sin Zod, para no retrasar el hook. */
function readPort(configFile: string): number {
  try {
    const parsed = JSON.parse(readFileSync(configFile, "utf8")) as { port?: unknown };
    const port = parsed.port;
    return typeof port === "number" && Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

async function post(url: string, token: string, body: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`El core respondió ${String(response.status)}.`);
}

function errorLogger(file: string): (message: string) => void {
  return (message) => {
    try {
      const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      if (size > MAX_ERROR_LOG_BYTES) {
        truncateSync(file, 0);
      }
      appendFileSync(file, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
    } catch {
      // Sin carpeta de logs no hay dónde anotar; el hook sigue en silencio.
    }
  };
}

export async function hookCommand(args: readonly string[]): Promise<void> {
  const paths = tokencyPaths();
  await runHook(args[0] ?? "", {
    readStdin,
    // TOKENCY_TOKEN solo existe para pruebas locales; el LaunchAgent y los hooks no lo definen.
    readToken: () =>
      Promise.resolve(process.env.TOKENCY_TOKEN ?? null).then((t) => t ?? readSecret(TOKEN_REF)),
    readPort: () => readPort(paths.configFile),
    post,
    logError: errorLogger(path.join(paths.logsDir, "hook.log")),
    env: process.env,
    ppid: process.ppid,
    now: Date.now,
  });
}
