// Servicio de uso: expone los agregados y avisa cuando entra consumo nuevo.

import type {
  DailyUsage,
  LimitInfo,
  PlanLimit,
  ProjectUsage,
  UsageSummary,
  WindowSummary,
} from "@tokency/shared";

import {
  activeWindow,
  byProject,
  bySession,
  calibrate,
  daily,
  totalsOf,
  WINDOW_MS,
  windows,
  type Calibration,
  type CalibrationSample,
  type UsageWindow,
  type WindowAnchor,
} from "./aggregate.ts";
import type { IngestResult, UsageIngestor } from "./ingest.ts";
import type { LimitEvent } from "./parser.ts";
import type { PlanKind, PlanRepository } from "./plan.ts";
import { priceFor, type PricingTable } from "./pricing.ts";
import { localDate, zonedTimeToUtc } from "./reset-time.ts";
import type { StoredLimitEvent, UsageRepository } from "./repository.ts";

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
/** Con porcentajes menores el costo por punto es demasiado ruidoso para calibrar. */
const MIN_CALIBRATION_PERCENT = 5;

export interface UsageServiceOptions {
  repository: UsageRepository;
  ingestor: UsageIngestor;
  plan?: PlanRepository;
  pricing: PricingTable;
  timeZone?: string;
  now?: () => number;
}

function limitInfo(event: StoredLimitEvent): LimitInfo {
  return { at: event.timestamp, resetsAt: event.resetsAt, kind: event.kind, source: event.source };
}

function summarizeWindow(window: UsageWindow): WindowSummary {
  return {
    start: window.start,
    end: window.end,
    lastActivity: window.lastActivity,
    totals: window.totals,
    anchored: window.anchored,
    limitHit:
      window.limitHit === null
        ? null
        : {
            at: window.limitHit.timestamp,
            resetsAt: window.limitHit.resetsAt,
            kind: window.limitHit.kind,
            source: "transcript",
          },
  };
}

export class UsageService {
  readonly #repository: UsageRepository;
  readonly #ingestor: UsageIngestor;
  readonly #plan: PlanRepository | undefined;
  readonly #pricing: PricingTable;
  readonly #timeZone: string;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();

  constructor(options: UsageServiceOptions) {
    this.#repository = options.repository;
    this.#ingestor = options.ingestor;
    this.#plan = options.plan;
    this.#pricing = options.pricing;
    this.#timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.#now = options.now ?? Date.now;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async scanAll(): Promise<IngestResult> {
    return this.#notifyIf(await this.#ingestor.scanAll());
  }

  async ingestFile(file: string): Promise<IngestResult> {
    return this.#notifyIf(await this.#ingestor.ingestFile(file));
  }

  #notifyIf(result: IngestResult): IngestResult {
    if (result.entries > 0 || result.limits > 0) this.#notify();
    return result;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  /** Avisa a los suscriptores (lo usa el core cuando llega un dato oficial del plan). */
  notifyChanged(): void {
    this.#notify();
  }

  /** Ventanas de 5 horas que el reinicio oficial de la status line fija con certeza. */
  #officialWindows(since: number): WindowAnchor[] {
    const ends = new Set((this.#plan?.history("five_hour", since) ?? []).map((s) => s.resetsAt));
    return [...ends].map((end) => ({ start: end - WINDOW_MS, end }));
  }

  /** Ventanas que abarcan `[from, to)`, calculadas con un margen previo para no cortar ninguna. */
  #windowsBetween(from: number, to: number, limits: readonly LimitEvent[]): UsageWindow[] {
    const start = from - 2 * WINDOW_MS;
    return windows(
      this.#repository.entriesBetween(start, to),
      limits,
      this.#pricing,
      this.#officialWindows(start),
    ).filter((w) => w.end > from);
  }

  #costBetween(from: number, to: number): number {
    return totalsOf(this.#repository.entriesBetween(from, to), this.#pricing).cost;
  }

  /**
   * Una muestra por ventana con dato oficial: su costo hasta ese momento dividido entre el
   * porcentaje que reportó Claude Code. Es mucho más fina que esperar a llegar al límite.
   */
  #planSamples(): CalibrationSample[] {
    const byWindow = new Map<number, { observedAt: number; usedPercentage: number }>();
    for (const snapshot of this.#plan?.history("five_hour", 0) ?? []) {
      if (snapshot.usedPercentage < MIN_CALIBRATION_PERCENT) continue;
      const best = byWindow.get(snapshot.resetsAt);
      if (best === undefined || snapshot.usedPercentage >= best.usedPercentage) {
        byWindow.set(snapshot.resetsAt, snapshot);
      }
    }
    return [...byWindow].flatMap(([resetsAt, snapshot]) => {
      const windowStart = resetsAt - WINDOW_MS;
      const entries = this.#repository.entriesBetween(windowStart, snapshot.observedAt + 1);
      const totals = totalsOf(entries, this.#pricing);
      if (totals.cost <= 0) return [];
      return [
        {
          at: snapshot.observedAt,
          source: "plan" as const,
          windowStart,
          cost: totals.cost / (snapshot.usedPercentage / 100),
          totalTokens: Math.round(totals.totalTokens / (snapshot.usedPercentage / 100)),
        },
      ];
    });
  }

  /** Calibración con los datos oficiales, los límites alcanzados y las marcas manuales. */
  calibration(): Calibration {
    const events = this.#repository.limitEvents();
    const transcript = events.filter((e) => e.source === "transcript");
    const manual = events.filter((e) => e.source === "manual").map((e) => e.timestamp);
    const relevant = events.filter((e) => e.kind === "session");
    const windowList = relevant.flatMap((event) => {
      const found = this.#windowsBetween(
        event.timestamp - WINDOW_MS,
        event.timestamp + 60_000,
        transcript,
      ).find((w) => event.timestamp >= w.start && event.timestamp < w.end + 60_000);
      return found === undefined ? [] : [found];
    });
    const unique = [...new Map(windowList.map((w) => [w.start, w])).values()];
    return calibrate(unique, manual, this.#pricing, this.#planSamples());
  }

  /**
   * Último porcentaje oficial de un límite y su proyección a este momento: si hubo consumo
   * después del dato oficial, se suma a razón del costo por punto de esa misma ventana.
   */
  #planLimit(
    kind: PlanKind,
    windowMs: number,
    now: number,
    fallbackCostPerPoint: number | null,
  ): PlanLimit | null {
    const latest = this.#plan?.latest(kind) ?? null;
    if (latest === null || latest.resetsAt <= now) return null;
    const windowStart = latest.resetsAt - windowMs;
    const costBefore = this.#costBetween(windowStart, latest.observedAt + 1);
    const costAfter = this.#costBetween(latest.observedAt + 1, now + 1);
    const costPerPoint =
      latest.usedPercentage >= MIN_CALIBRATION_PERCENT && costBefore > 0
        ? costBefore / latest.usedPercentage
        : fallbackCostPerPoint;
    const estimated = costAfter > 0 && costPerPoint !== null && costPerPoint > 0;
    return {
      usedPercentage: latest.usedPercentage,
      resetsAt: latest.resetsAt,
      observedAt: latest.observedAt,
      estimatedNow: estimated
        ? latest.usedPercentage + costAfter / costPerPoint
        : latest.usedPercentage,
      estimated,
    };
  }

  summary(): UsageSummary {
    const now = this.#now();
    const limits = this.#repository.limitEvents(now - 30 * DAY_MS);
    const transcriptLimits = limits.filter((e) => e.source === "transcript");
    const calibration = this.calibration();
    const recent = this.#windowsBetween(now - WINDOW_MS, now + 1, transcriptLimits);
    const window = activeWindow(recent, now, calibration, this.#pricing);
    const fiveHour = this.#planLimit(
      "five_hour",
      WINDOW_MS,
      now,
      calibration.estimatedCap === null ? null : calibration.estimatedCap / 100,
    );
    const sevenDay = this.#planLimit("seven_day", WEEK_MS, now, null);

    const today = localDate(now, this.#timeZone);
    const [year = "1970", month = "1", day = "1"] = today.split("-");
    const midnight = zonedTimeToUtc(
      { year: Number(year), month: Number(month), day: Number(day) },
      0,
      0,
      this.#timeZone,
    );
    const lastMonth = this.#repository.entriesBetween(now - 30 * DAY_MS, now + 1);
    const unpriced = new Set(
      lastMonth.filter((e) => priceFor(this.#pricing, e.model) === null).map((e) => e.model),
    );
    const sessions = Object.fromEntries(
      Object.entries(
        bySession(
          lastMonth.filter((e) => e.timestamp >= now - DAY_MS),
          this.#pricing,
        ),
      ).map(([id, totals]) => [id, { totalTokens: totals.totalTokens, cost: totals.cost }]),
    );
    const lastLimit = limits.at(-1);
    return {
      generatedAt: now,
      timeZone: this.#timeZone,
      plan: fiveHour === null && sevenDay === null ? null : { fiveHour, sevenDay },
      window,
      today: totalsOf(
        lastMonth.filter((e) => e.timestamp >= midnight),
        this.#pricing,
      ),
      last7Days: totalsOf(
        lastMonth.filter((e) => e.timestamp >= now - 7 * DAY_MS),
        this.#pricing,
      ),
      calibration: {
        estimatedCap: calibration.estimatedCap,
        samples: calibration.samples.length,
        lastLimit: lastLimit === undefined ? null : limitInfo(lastLimit),
      },
      sessions,
      unpricedModels: [...unpriced].sort(),
      firstEntryAt: this.#repository.firstEntryAt(),
    };
  }

  daily(days: number): DailyUsage[] {
    const now = this.#now();
    const entries = this.#repository.entriesBetween(now - (days + 1) * DAY_MS, now + 1);
    return daily(entries, this.#pricing, { days, now, timeZone: this.#timeZone });
  }

  projects(days: number): ProjectUsage[] {
    const now = this.#now();
    return byProject(this.#repository.entriesBetween(now - days * DAY_MS, now + 1), this.#pricing);
  }

  recentWindows(days: number): WindowSummary[] {
    const now = this.#now();
    const limits = this.#repository
      .limitEvents(now - (days + 1) * DAY_MS)
      .filter((e) => e.source === "transcript");
    return this.#windowsBetween(now - days * DAY_MS, now + 1, limits)
      .map(summarizeWindow)
      .reverse();
  }

  /** Botón "Llegué al límite": una muestra manual de calibración. */
  recordManualLimit(): UsageSummary {
    const now = this.#now();
    this.#repository.insertLimitEvent(
      { timestamp: now, sessionId: null, kind: "session", resetsAt: null, message: "" },
      "manual",
    );
    this.#notify();
    return this.summary();
  }
}
