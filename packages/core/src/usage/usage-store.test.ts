import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/database.ts";
import { silentLogger } from "../logger.ts";
import {
  activeWindow,
  byProject,
  calibrate,
  daily,
  WINDOW_MS,
  windows,
  type UsageWindow,
} from "./aggregate.ts";
import { readCompleteLines, UsageIngestor } from "./ingest.ts";
import type { LimitEvent, UsageEntry } from "./parser.ts";
import { DEFAULT_PRICING } from "./pricing.ts";
import { UsageRepository } from "./repository.ts";
import { UsageService } from "./service.ts";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-08-26T14:11:27Z");

function entry(id: string, at: number, extra: Partial<UsageEntry> = {}): UsageEntry {
  return {
    messageId: id,
    requestId: `req-${id}`,
    sessionId: "sess-a",
    timestamp: at,
    model: "claude-opus-5",
    inputTokens: 0,
    outputTokens: 1_000_000,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    webSearches: 0,
    fast: false,
    cwd: "/Users/demo/proyecto",
    ...extra,
  };
}

function line(e: UsageEntry): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: e.sessionId,
    requestId: e.requestId,
    timestamp: new Date(e.timestamp).toISOString(),
    cwd: e.cwd,
    message: {
      id: e.messageId,
      model: e.model,
      content: [],
      usage: { input_tokens: e.inputTokens, output_tokens: e.outputTokens },
    },
  });
}

const limit = (at: number, resetsAt: number | null): LimitEvent => ({
  timestamp: at,
  sessionId: "sess-a",
  kind: "session",
  resetsAt,
  message: "",
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tokency-usage-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readCompleteLines", () => {
  it("deja fuera la última línea si todavía no termina", async () => {
    const file = path.join(dir, "a.jsonl");
    await writeFile(file, "uno\ndos\ntre");
    const lines: string[] = [];

    const consumed = await readCompleteLines(file, 0, (l) => lines.push(l));

    expect(lines).toEqual(["uno", "dos"]);
    expect(consumed).toBe(8);
  });

  it("maneja líneas que cruzan varios bloques de lectura y texto multibyte", async () => {
    const file = path.join(dir, "b.jsonl");
    const long = "á".repeat(100_000);
    await writeFile(file, `${long}\nfin\n`);
    const lines: string[] = [];

    const consumed = await readCompleteLines(file, 0, (l) => lines.push(l));

    expect(lines).toEqual([long, "fin"]);
    expect(consumed).toBe(Buffer.byteLength(`${long}\nfin\n`));
  });
});

describe("UsageIngestor", () => {
  it("lee solo lo nuevo, deduplica y relee si el archivo se acorta", async () => {
    const projects = path.join(dir, "projects", "-Users-demo-proyecto");
    await mkdir(path.join(projects, "sess-a", "subagents"), { recursive: true });
    const main = path.join(projects, "sess-a.jsonl");
    const sub = path.join(projects, "sess-a", "subagents", "agent-1.jsonl");
    const repository = new UsageRepository(openDatabase(":memory:"));
    const ingestor = new UsageIngestor({
      repository,
      projectsDir: path.join(dir, "projects"),
      logger: silentLogger,
    });

    await writeFile(
      main,
      `${line(entry("m1", T0))}\n${line(entry("m1", T0))}\n${line(entry("m2", T0 + 1000))}`,
    );
    await writeFile(sub, `${line(entry("s1", T0 + 2000))}\n`);
    expect(await ingestor.scanAll()).toEqual({ entries: 2, limits: 0 });

    // Se completa la línea que estaba a medias y llega otra.
    await appendFile(main, `\n${line(entry("m3", T0 + 3000))}\n`);
    expect(await ingestor.ingestFile(main)).toEqual({ entries: 2, limits: 0 });
    expect(await ingestor.ingestFile(main)).toEqual({ entries: 0, limits: 0 });

    // Reescrito más corto: se vuelve a leer desde el principio sin duplicar.
    await writeFile(main, `${line(entry("m1", T0))}\n`);
    expect(await ingestor.ingestFile(main)).toEqual({ entries: 0, limits: 0 });

    expect(repository.entriesBetween(0, Infinity).map((e) => e.messageId)).toEqual([
      "m1",
      "m2",
      "s1",
      "m3",
    ]);
  });
});

describe("ventanas de 5 horas", () => {
  it("empiezan con el primer mensaje y se reinician después de 5 horas", () => {
    const list = windows(
      [
        entry("a", T0),
        entry("b", T0 + 4 * HOUR),
        entry("c", T0 + 5 * HOUR + 1),
        entry("d", T0 + 12 * HOUR),
      ],
      [],
      DEFAULT_PRICING,
    );

    expect(list.map((w) => [w.start - T0, w.entries.length])).toEqual([
      [0, 2],
      [5 * HOUR + 1, 1],
      [12 * HOUR, 1],
    ]);
  });

  it("un aviso con hora de reinicio fija el final de su ventana", () => {
    const resetsAt = Date.parse("2026-08-26T19:10:00Z");
    const list = windows(
      [entry("a", T0), entry("b", T0 + 4 * HOUR)],
      [limit(T0 + 4.8 * HOUR, resetsAt)],
      DEFAULT_PRICING,
    );

    expect(list[0]).toMatchObject({ start: resetsAt - WINDOW_MS, end: resetsAt, anchored: true });
    expect(list[0]?.limitHit?.resetsAt).toBe(resetsAt);
  });
});

describe("calibración y ventana activa", () => {
  const window = (cost: number, hitAt: number | null): UsageWindow => {
    const entries = [entry(`w${String(cost)}`, T0, { outputTokens: cost * 40_000 })];
    const [w] = windows(entries, hitAt === null ? [] : [limit(hitAt, null)], DEFAULT_PRICING);
    if (w === undefined) throw new Error("sin ventana");
    return w;
  };

  it("el tope estimado es la mediana de los límites alcanzados", () => {
    // 40.000 tokens de salida de Opus 5 = 1 dólar.
    const list = [
      window(10, T0 + HOUR),
      window(30, T0 + HOUR),
      window(20, T0 + HOUR),
      window(99, null),
    ];

    const calibration = calibrate(list, [], DEFAULT_PRICING);

    expect(calibration.samples).toHaveLength(3);
    expect(calibration.estimatedCap).toBeCloseTo(20);
  });

  it("una marca manual suma una muestra solo si no hubo aviso automático", () => {
    const list = [window(10, T0 + HOUR)];
    const manualOnly = [window(12, null)];

    expect(calibrate(list, [T0 + 2 * HOUR], DEFAULT_PRICING).samples).toHaveLength(1);
    expect(calibrate(manualOnly, [T0 + 2 * HOUR], DEFAULT_PRICING).samples).toMatchObject([
      { source: "manual" },
    ]);
  });

  it("calcula reinicio, ritmo, proyección y cercanía al tope", () => {
    const list = windows([entry("a", T0, { outputTokens: 400_000 })], [], DEFAULT_PRICING);
    const now = T0 + 2 * HOUR;

    const active = activeWindow(list, now, { estimatedCap: 40, samples: [] }, DEFAULT_PRICING);

    expect(active).toMatchObject({
      resetsInMs: 3 * HOUR,
      burnRatePerHour: 5,
      projectedCost: 25,
      fractionOfCap: 0.25,
    });
    expect(
      activeWindow(list, T0 + 6 * HOUR, { estimatedCap: null, samples: [] }, DEFAULT_PRICING),
    ).toBeNull();
  });
});

describe("historial", () => {
  it("agrupa por día local, con ceros en los días sin uso", () => {
    // 03:12Z del 27 es todavía el 26 en Hermosillo (UTC-7).
    const entries = [
      entry("a", Date.parse("2026-09-27T03:12:00Z")),
      entry("b", Date.parse("2026-09-27T08:00:00Z")),
    ];

    const days = daily(entries, DEFAULT_PRICING, {
      days: 3,
      now: Date.parse("2026-09-27T20:00:00Z"),
      timeZone: "America/Hermosillo",
    });

    expect(days.map((d) => [d.date, d.totals.messages])).toEqual([
      ["2026-09-25", 0],
      ["2026-09-26", 1],
      ["2026-09-27", 1],
    ]);
    expect(days[1]?.costByModel["claude-opus-5"]).toBeCloseTo(25);
  });

  it("ordena los proyectos por costo y cuenta sus sesiones", () => {
    const projects = byProject(
      [
        entry("a", T0, { cwd: "/x/barato", outputTokens: 10 }),
        entry("b", T0, { cwd: "/x/caro", sessionId: "s1" }),
        entry("c", T0, { cwd: "/x/caro", sessionId: "s2" }),
      ],
      DEFAULT_PRICING,
    );

    expect(projects.map((p) => [p.project, p.sessions])).toEqual([
      ["caro", 2],
      ["barato", 1],
    ]);
  });
});

describe("UsageService", () => {
  it("resume la ventana vigente, hoy, la calibración y las sesiones", () => {
    const repository = new UsageRepository(openDatabase(":memory:"));
    const ingestor = new UsageIngestor({
      repository,
      projectsDir: path.join(dir, "nada"),
      logger: silentLogger,
    });
    const now = T0 + 2 * HOUR;
    const service = new UsageService({
      repository,
      ingestor,
      pricing: DEFAULT_PRICING,
      timeZone: "America/Hermosillo",
      now: () => now,
    });
    repository.insertEntries([
      entry("old", T0 - 30 * HOUR),
      entry("hit", T0 - 26 * HOUR),
      entry("a", T0),
    ]);
    repository.insertLimitEvent(limit(T0 - 26 * HOUR + 1000, null), "transcript");
    let notified = 0;
    service.subscribe(() => (notified += 1));

    const summary = service.summary();

    expect(summary.window).toMatchObject({ start: T0, end: T0 + WINDOW_MS });
    expect(summary.window?.totals.cost).toBeCloseTo(25);
    expect(summary.calibration).toMatchObject({ samples: 1, estimatedCap: 50 });
    expect(summary.window?.fractionOfCap).toBeCloseTo(0.5);
    expect(summary.sessions["sess-a"]?.totalTokens).toBe(1_000_000);
    expect(summary.today.messages).toBe(1);
    expect(summary.last7Days.messages).toBe(3);

    const afterManual = service.recordManualLimit();
    expect(notified).toBe(1);
    expect(afterManual.calibration.samples).toBe(2);
    expect(afterManual.calibration.lastLimit).toMatchObject({ source: "manual", at: now });
    // Los mensajes de -30 h y -26 h caen en la misma ventana de 5 horas.
    expect(service.recentWindows(3).map((w) => w.start)).toEqual([T0, T0 - 30 * HOUR]);
  });
});
