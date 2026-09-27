// `tokency statusline`: status line de Claude Code (D-017). Muestra el uso oficial del plan en
// colores neón y lo reenvía al core. Igual que el hook: carga poco, nunca falla y es rápido.

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { readSecret, TOKEN_REF } from "@tokency/core/keychain";
import { tokencyPaths } from "@tokency/core/paths";
import { sanitizeStatusLine, type StatusSnapshot } from "@tokency/shared/statusline";

const DEFAULT_PORT = 7777;
const STDIN_TIMEOUT_MS = 1_000;
const POST_TIMEOUT_MS = 800;

/** Paleta neón en color verdadero (24 bits). */
export const NEON = {
  magenta: [255, 43, 214],
  cyan: [0, 240, 255],
  green: [57, 255, 20],
  amber: [255, 176, 0],
  pink: [255, 46, 99],
  violet: [178, 102, 255],
  dim: [110, 110, 140],
} as const;

type Rgb = readonly [number, number, number];

export function paint(text: string, [r, g, b]: Rgb, bold = false): string {
  return `\x1b[${bold ? "1;" : ""}38;2;${String(r)};${String(g)};${String(b)}m${text}\x1b[0m`;
}

/** Cian hasta 70 %, ámbar hasta 90 %, rosa neón desde ahí. */
export function levelColor(percentage: number): Rgb {
  return percentage >= 90 ? NEON.pink : percentage >= 70 ? NEON.amber : NEON.cyan;
}

export function meter(percentage: number, width = 8): string {
  const filled = Math.max(0, Math.min(width, Math.round((percentage / 100) * width)));
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)}`;
}

function clock(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleTimeString("es-MX", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayAndClock(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleString("es-MX", {
    timeZone,
    weekday: "short",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Una línea compacta; con menos de 90 columnas se omiten los detalles. */
export function renderStatusLine(
  snapshot: StatusSnapshot,
  options: { columns?: number; timeZone?: string } = {},
): string {
  const wide = (options.columns ?? 120) >= 90;
  const separator = paint(" │ ", NEON.dim);
  const parts = [paint("◆ Tokency", NEON.magenta, true)];
  if (snapshot.fiveHour !== null) {
    const { usedPercentage, resetsAt } = snapshot.fiveHour;
    const color = levelColor(usedPercentage);
    const bar = wide ? `${paint(meter(usedPercentage), color)} ` : "";
    parts.push(
      `${paint("5h", NEON.dim)} ${bar}${paint(`${String(Math.round(usedPercentage))}%`, color, true)} ${paint(`⟳ ${clock(resetsAt, options.timeZone)}`, NEON.dim)}`,
    );
  }
  if (snapshot.sevenDay !== null) {
    const { usedPercentage, resetsAt } = snapshot.sevenDay;
    const reset = wide ? ` ${paint(`⟳ ${dayAndClock(resetsAt, options.timeZone)}`, NEON.dim)}` : "";
    parts.push(
      `${paint("7d", NEON.dim)} ${paint(`${String(Math.round(usedPercentage))}%`, usedPercentage >= 70 ? levelColor(usedPercentage) : NEON.violet, true)}${reset}`,
    );
  }
  if (snapshot.costUsd !== null) {
    parts.push(
      `${paint("sesión", NEON.dim)} ${paint(`$${snapshot.costUsd.toFixed(2)}`, NEON.green, true)}`,
    );
  }
  if (snapshot.contextUsedPercentage !== null && wide) {
    parts.push(
      `${paint("ctx", NEON.dim)} ${paint(`${String(Math.round(snapshot.contextUsedPercentage))}%`, NEON.cyan)}`,
    );
  }
  if (snapshot.modelName !== null && wide) parts.push(paint(snapshot.modelName, NEON.violet));
  return parts.join(separator);
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

function readPort(configFile: string): number {
  try {
    const port = (JSON.parse(readFileSync(configFile, "utf8")) as { port?: unknown }).port;
    return typeof port === "number" && Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

async function readSnapshot(): Promise<StatusSnapshot | null> {
  try {
    const pid = Number(process.env.CLAUDE_PID);
    return sanitizeStatusLine(JSON.parse(await readStdin()), {
      ts: Date.now(),
      pid: Number.isInteger(pid) && pid > 1 ? pid : process.ppid > 1 ? process.ppid : null,
    });
  } catch {
    return null;
  }
}

export async function statuslineCommand(): Promise<void> {
  const paths = tokencyPaths();
  const logError = (message: string) => {
    try {
      appendFileSync(
        path.join(paths.logsDir, "hook.log"),
        `${new Date().toISOString()} statusline: ${message}\n`,
        {
          mode: 0o600,
        },
      );
    } catch {
      // Sin carpeta de logs no hay dónde anotar.
    }
  };
  const snapshot = await readSnapshot();
  if (snapshot === null) {
    console.log(paint("◆ Tokency", NEON.magenta, true));
    return;
  }
  // Primero la línea: Claude Code cancela el comando si llega otra actualización.
  console.log(renderStatusLine(snapshot, { columns: Number(process.env.COLUMNS) || undefined }));
  try {
    const token = process.env.TOKENCY_TOKEN ?? (await readSecret(TOKEN_REF));
    if (token === null) return;
    const response = await fetch(
      `http://127.0.0.1:${String(readPort(paths.configFile))}/v1/statusline`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      },
    );
    if (!response.ok) logError(`el core respondió ${String(response.status)}`);
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
  }
}
