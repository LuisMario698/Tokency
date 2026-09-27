// Agregados de uso: funciones puras sobre las entradas ya deduplicadas (D-015).

import path from "node:path";

import type { ActiveWindow, DailyUsage, ProjectUsage, TokenTotals } from "@tokency/shared";

import type { LimitEvent, UsageEntry } from "./parser.ts";
import { entryCost, type PricingTable } from "./pricing.ts";
import { localDate } from "./reset-time.ts";

export const WINDOW_MS = 5 * 60 * 60_000;

export function emptyTotals(): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    cost: 0,
    unpricedTokens: 0,
    messages: 0,
  };
}

function add(totals: TokenTotals, entry: UsageEntry, pricing: PricingTable): void {
  const writes = entry.cacheWrite5mTokens + entry.cacheWrite1hTokens;
  const all = entry.inputTokens + entry.outputTokens + writes + entry.cacheReadTokens;
  totals.inputTokens += entry.inputTokens;
  totals.outputTokens += entry.outputTokens;
  totals.cacheWriteTokens += writes;
  totals.cacheReadTokens += entry.cacheReadTokens;
  totals.totalTokens += all;
  totals.messages += 1;
  const cost = entryCost(entry, pricing);
  if (cost === null) totals.unpricedTokens += all;
  else totals.cost += cost;
}

export function totalsOf(entries: readonly UsageEntry[], pricing: PricingTable): TokenTotals {
  const totals = emptyTotals();
  for (const entry of entries) add(totals, entry, pricing);
  return totals;
}

function groupTotals(
  entries: readonly UsageEntry[],
  pricing: PricingTable,
  key: (entry: UsageEntry) => string,
): Record<string, TokenTotals> {
  const groups: Record<string, TokenTotals> = {};
  for (const entry of entries) {
    const name = key(entry);
    const totals = groups[name] ?? emptyTotals();
    add(totals, entry, pricing);
    groups[name] = totals;
  }
  return groups;
}

export function byModel(
  entries: readonly UsageEntry[],
  pricing: PricingTable,
): Record<string, TokenTotals> {
  return groupTotals(entries, pricing, (entry) => entry.model);
}

export function bySession(
  entries: readonly UsageEntry[],
  pricing: PricingTable,
): Record<string, TokenTotals> {
  return groupTotals(entries, pricing, (entry) => entry.sessionId);
}

/** Nombre del proyecto a partir del `cwd` (la Fase 3 lo relaciona con los repos). */
export function projectOf(entry: UsageEntry): string {
  return entry.cwd === null ? "(sin proyecto)" : path.basename(entry.cwd) || entry.cwd;
}

/**
 * Una sesión cuenta para el proyecto donde empezó (el `cwd` de su primer mensaje): Claude
 * puede entrar después a subcarpetas como `apps/mac`, que no son proyectos aparte.
 */
function sessionRoots(entries: readonly UsageEntry[]): Map<string, string> {
  const first = new Map<string, UsageEntry>();
  for (const entry of entries) {
    const known = first.get(entry.sessionId);
    if (known === undefined || entry.timestamp < known.timestamp) first.set(entry.sessionId, entry);
  }
  return new Map([...first].map(([sessionId, entry]) => [sessionId, projectOf(entry)]));
}

export function byProject(entries: readonly UsageEntry[], pricing: PricingTable): ProjectUsage[] {
  const roots = sessionRoots(entries);
  const projects = new Map<string, { totals: TokenTotals; sessions: Set<string>; last: number }>();
  for (const entry of entries) {
    const name = roots.get(entry.sessionId) ?? projectOf(entry);
    const project = projects.get(name) ?? { totals: emptyTotals(), sessions: new Set(), last: 0 };
    add(project.totals, entry, pricing);
    project.sessions.add(entry.sessionId);
    project.last = Math.max(project.last, entry.timestamp);
    projects.set(name, project);
  }
  return [...projects.entries()]
    .map(([project, data]) => ({
      project,
      totals: data.totals,
      sessions: data.sessions.size,
      lastActivity: data.last,
    }))
    .sort((a, b) => b.totals.cost - a.totals.cost || b.totals.totalTokens - a.totals.totalTokens);
}

/** Un registro por día local, del más antiguo al de hoy, con ceros en los días sin uso. */
export function daily(
  entries: readonly UsageEntry[],
  pricing: PricingTable,
  options: { days: number; now: number; timeZone: string },
): DailyUsage[] {
  const days = new Map<string, DailyUsage>();
  for (let offset = options.days - 1; offset >= 0; offset--) {
    const date = localDate(options.now - offset * 24 * 60 * 60_000, options.timeZone);
    days.set(date, { date, totals: emptyTotals(), costByModel: {} });
  }
  for (const entry of entries) {
    const day = days.get(localDate(entry.timestamp, options.timeZone));
    if (day === undefined) continue;
    add(day.totals, entry, pricing);
    const cost = entryCost(entry, pricing);
    if (cost !== null) day.costByModel[entry.model] = (day.costByModel[entry.model] ?? 0) + cost;
  }
  return [...days.values()];
}

export interface UsageWindow {
  start: number;
  end: number;
  lastActivity: number;
  totals: TokenTotals;
  /** El inicio salió de un aviso de límite con hora de reinicio, no del primer mensaje. */
  anchored: boolean;
  /** Aviso de límite de sesión dentro de la ventana, si lo hubo. */
  limitHit: LimitEvent | null;
  entries: UsageEntry[];
}

/**
 * Ventanas de 5 horas (D-015): cada una empieza con el primer mensaje posterior al fin de la
 * anterior. Si un aviso de límite dice cuándo se reinicia, esa hora fija el final de su ventana.
 */
export interface WindowAnchor {
  start: number;
  end: number;
}

export function windows(
  entries: readonly UsageEntry[],
  limits: readonly LimitEvent[],
  pricing: PricingTable,
  /** Ventanas conocidas con certeza, por ejemplo por el reinicio oficial de la status line. */
  knownWindows: readonly WindowAnchor[] = [],
): UsageWindow[] {
  const anchors = [
    ...knownWindows,
    ...limits
      .filter((event) => event.kind === "session" && event.resetsAt !== null)
      .map((event) => ({ start: (event.resetsAt ?? 0) - WINDOW_MS, end: event.resetsAt ?? 0 })),
  ];
  const result: UsageWindow[] = [];
  let current: UsageWindow | undefined;
  for (const entry of entries) {
    if (current === undefined || entry.timestamp >= current.end) {
      const anchor = anchors.find((a) => entry.timestamp >= a.start && entry.timestamp < a.end);
      current = {
        start: anchor?.start ?? entry.timestamp,
        end: anchor?.end ?? entry.timestamp + WINDOW_MS,
        lastActivity: entry.timestamp,
        totals: emptyTotals(),
        anchored: anchor !== undefined,
        limitHit: null,
        entries: [],
      };
      result.push(current);
    }
    current.entries.push(entry);
    current.lastActivity = entry.timestamp;
    add(current.totals, entry, pricing);
  }
  for (const event of limits) {
    if (event.kind !== "session") continue;
    const window = result.find(
      (w) => event.timestamp >= w.start && event.timestamp < w.end + 60_000,
    );
    if (window?.limitHit === null) window.limitHit = event;
  }
  return result;
}

export interface CalibrationSample {
  at: number;
  /** `plan`: costo de la ventana dividido entre el porcentaje oficial de la status line. */
  source: "transcript" | "manual" | "plan";
  windowStart: number;
  cost: number;
  totalTokens: number;
}

export interface Calibration {
  /** Costo equivalente estimado que aguanta una ventana antes del límite; `null` sin muestras. */
  estimatedCap: number | null;
  samples: CalibrationSample[];
}

/**
 * Cada límite alcanzado es una muestra: lo consumido en su ventana hasta ese momento. El tope
 * estimado es la mediana, que no se deja arrastrar por una muestra rara.
 */
export function calibrate(
  windowList: readonly UsageWindow[],
  manualHits: readonly number[],
  pricing: PricingTable,
  planSamples: readonly CalibrationSample[] = [],
): Calibration {
  const samples: CalibrationSample[] = [...planSamples];
  for (const window of windowList) {
    if (window.limitHit === null) continue;
    const hitAt = window.limitHit.timestamp;
    const totals = totalsOf(
      window.entries.filter((e) => e.timestamp <= hitAt),
      pricing,
    );
    samples.push({
      at: hitAt,
      source: "transcript",
      windowStart: window.start,
      cost: totals.cost,
      totalTokens: totals.totalTokens,
    });
  }
  for (const hitAt of manualHits) {
    const window = windowList.find((w) => hitAt >= w.start && hitAt < w.end);
    // Si Claude Code ya dejó un aviso en esa ventana, la marca manual no suma otra muestra.
    if (window?.limitHit !== null) continue;
    const totals = totalsOf(
      window.entries.filter((e) => e.timestamp <= hitAt),
      pricing,
    );
    samples.push({
      at: hitAt,
      source: "manual",
      windowStart: window.start,
      cost: totals.cost,
      totalTokens: totals.totalTokens,
    });
  }
  samples.sort((a, b) => a.at - b.at);
  const costs = samples
    .map((s) => s.cost)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  if (costs.length === 0) return { estimatedCap: null, samples };
  const middle = Math.floor(costs.length / 2);
  const median =
    costs.length % 2 === 1
      ? (costs[middle] ?? 0)
      : ((costs[middle - 1] ?? 0) + (costs[middle] ?? 0)) / 2;
  return { estimatedCap: median, samples };
}

export function activeWindow(
  windowList: readonly UsageWindow[],
  now: number,
  calibration: Calibration,
  pricing: PricingTable,
): ActiveWindow | null {
  const last = windowList.at(-1);
  if (last === undefined || now >= last.end) return null;
  const elapsedHours = Math.max(
    (Math.max(now, last.lastActivity) - last.start) / 3_600_000,
    1 / 60,
  );
  const burnRatePerHour = last.totals.cost / elapsedHours;
  const remainingHours = (last.end - now) / 3_600_000;
  const costByModel = Object.fromEntries(
    Object.entries(byModel(last.entries, pricing)).map(([model, totals]) => [model, totals.cost]),
  );
  return {
    start: last.start,
    end: last.end,
    resetsInMs: last.end - now,
    totals: last.totals,
    costByModel,
    burnRatePerHour,
    projectedCost: last.totals.cost + burnRatePerHour * remainingHours,
    fractionOfCap:
      calibration.estimatedCap === null ? null : last.totals.cost / calibration.estimatedCap,
    anchored: last.anchored,
  };
}
