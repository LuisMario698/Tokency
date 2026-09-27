// `tokency usage [--days N]`: uso de Claude Code según el core (D-015, D-016).

import { parseArgs } from "node:util";

import { tokencyPaths } from "@tokency/core";
import {
  OFFICIAL_USAGE_URL,
  type DailyUsage,
  type ProjectUsage,
  type TokenTotals,
  type UsageSummary,
} from "@tokency/shared";

import { coreClient } from "../client.ts";
import { errorMessage, say } from "../output.ts";
import { elapsed } from "./status.ts";

export function money(value: number): string {
  return `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 1234 → "1,2 mil", 3400000 → "3,4 M". */
export function compactTokens(value: number): string {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`;
  if (value >= 1_000)
    return `${(value / 1_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} mil`;
  return String(value);
}

export function bar(fraction: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function clock(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString("es-MX", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function totalsLine(totals: TokenTotals): string {
  return `${money(totals.cost)} · ${compactTokens(totals.totalTokens)} tokens · ${String(totals.messages)} mensajes`;
}

export function summaryLines(summary: UsageSummary): string[] {
  const lines: string[] = [];
  const { window, calibration, timeZone } = summary;
  if (window === null) {
    lines.push("Ventana de 5 horas: ninguna abierta (empieza con tu próximo mensaje).");
  } else {
    lines.push(
      `Ventana de 5 horas: ${clock(window.start, timeZone)} → ${clock(window.end, timeZone)} · se reinicia en ${elapsed(window.resetsInMs)}`,
    );
    const cap =
      window.fractionOfCap === null || calibration.estimatedCap === null
        ? "sin calibrar: usa el botón «Llegué al límite» de la app cuando te pase"
        : `${bar(window.fractionOfCap)} ${String(Math.round(window.fractionOfCap * 100))} % del tope estimado (${money(calibration.estimatedCap)}, ${String(calibration.samples)} muestras)`;
    lines.push(`  ${money(window.totals.cost)} equivalentes · ${cap}`);
    lines.push(
      `  ritmo ${money(window.burnRatePerHour)}/h · proyección al cierre ${money(window.projectedCost)}`,
    );
  }
  lines.push(`Hoy: ${totalsLine(summary.today)}`);
  lines.push(`Últimos 7 días: ${totalsLine(summary.last7Days)}`);
  if (calibration.lastLimit !== null) {
    const reset =
      calibration.lastLimit.resetsAt === null
        ? ""
        : ` (se reinició ${clock(calibration.lastLimit.resetsAt, timeZone)})`;
    lines.push(`Último límite alcanzado: ${clock(calibration.lastLimit.at, timeZone)}${reset}`);
  }
  if (summary.unpricedModels.length > 0) {
    lines.push(`Sin precio en la tabla (no suman costo): ${summary.unpricedModels.join(", ")}`);
  }
  return lines;
}

export function dailyLines(days: readonly DailyUsage[]): string[] {
  const max = Math.max(...days.map((d) => d.totals.cost), 0.01);
  return days.map(
    (d) =>
      `${d.date}  ${bar(d.totals.cost / max, 16)}  ${money(d.totals.cost).padStart(10)}  ${compactTokens(d.totals.totalTokens)}`,
  );
}

export function projectLines(projects: readonly ProjectUsage[]): string[] {
  return projects
    .slice(0, 10)
    .map(
      (p) =>
        `${p.project.padEnd(24)} ${money(p.totals.cost).padStart(10)}  ${String(p.sessions)} ${p.sessions === 1 ? "sesión" : "sesiones"}`,
    );
}

export async function usageCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { days: { type: "string", short: "d", default: "14" } },
  });
  const days = Math.max(1, Math.min(365, Number(values.days) || 14));
  try {
    const client = await coreClient(tokencyPaths());
    const [summary, daily, projects] = await Promise.all([
      client.get<UsageSummary>("/v1/usage/summary"),
      client.get<{ days: DailyUsage[] }>(`/v1/usage/daily?days=${String(days)}`),
      client.get<{ projects: ProjectUsage[] }>(`/v1/usage/projects?days=${String(days)}`),
    ]);
    say.title(
      "Uso de Claude Code (estimación: solo esta Mac; el chat de claude.ai comparte el límite pero no se ve aquí)",
    );
    for (const line of summaryLines(summary)) say.info(line);
    say.title(`Por día (últimos ${String(days)}):`);
    for (const line of dailyLines(daily.days)) say.info(line);
    say.title(`Por proyecto (últimos ${String(days)} días):`);
    for (const line of projectLines(projects.projects)) say.info(line);
    say.title(`Uso oficial de tu cuenta: ${OFFICIAL_USAGE_URL}`);
    return 0;
  } catch (error) {
    say.fail(errorMessage(error));
    return 1;
  }
}
