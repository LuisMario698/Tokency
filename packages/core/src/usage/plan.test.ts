import type { StatusSnapshot } from "@tokency/shared";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/database.ts";
import { silentLogger } from "../logger.ts";
import { SessionRegistry, type SessionStore } from "../sessions/registry.ts";
import { WINDOW_MS } from "./aggregate.ts";
import { UsageIngestor } from "./ingest.ts";
import type { UsageEntry } from "./parser.ts";
import { PlanRepository } from "./plan.ts";
import { DEFAULT_PRICING } from "./pricing.ts";
import { UsageRepository } from "./repository.ts";
import { UsageService } from "./service.ts";

const HOUR = 3_600_000;
const RESET = Date.parse("2026-09-27T01:00:00Z");
const START = RESET - WINDOW_MS;

function snapshot(
  ts: number,
  fiveHour: number | null,
  extra: Partial<StatusSnapshot> = {},
): StatusSnapshot {
  return {
    ts,
    sessionId: "sess-a",
    pid: 100,
    sessionName: null,
    modelId: "claude-opus-5-5",
    modelName: "Opus 5.5",
    costUsd: 1.5,
    durationMs: null,
    apiDurationMs: null,
    linesAdded: null,
    linesRemoved: null,
    contextUsedPercentage: 12,
    contextWindowSize: 1_000_000,
    contextInputTokens: 120_000,
    fiveHour: fiveHour === null ? null : { usedPercentage: fiveHour, resetsAt: RESET },
    sevenDay: null,
    spendLimit: null,
    ...extra,
  };
}

/** 40.000 tokens de salida de Opus 5 = 1 dólar. */
function dollars(id: string, at: number, amount: number): UsageEntry {
  return {
    messageId: id,
    requestId: id,
    sessionId: "sess-a",
    timestamp: at,
    model: "claude-opus-5",
    inputTokens: 0,
    outputTokens: amount * 40_000,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    webSearches: 0,
    fast: false,
    cwd: "/x/proyecto",
  };
}

function setup(now: number) {
  const db = openDatabase(":memory:");
  const repository = new UsageRepository(db);
  const plan = new PlanRepository(db);
  const service = new UsageService({
    repository,
    plan,
    ingestor: new UsageIngestor({ repository, projectsDir: "/no-existe", logger: silentLogger }),
    pricing: DEFAULT_PRICING,
    timeZone: "UTC",
    now: () => now,
  });
  return { repository, plan, service };
}

describe("PlanRepository", () => {
  it("guarda un registro por cambio de valor y refresca la hora si se repite", () => {
    const { plan } = setup(0);

    expect(plan.record(snapshot(START + HOUR, 20))).toBe(true);
    expect(plan.record(snapshot(START + 2 * HOUR, 20))).toBe(false);
    expect(plan.record(snapshot(START + 3 * HOUR, 35))).toBe(true);

    expect(
      plan
        .history("five_hour", 0)
        .map((s) => [s.usedPercentage, s.firstObservedAt - START, s.observedAt - START]),
    ).toEqual([
      [20, HOUR, 2 * HOUR],
      [35, 3 * HOUR, 3 * HOUR],
    ]);
  });

  it("un dato atrasado no reemplaza a uno más nuevo", () => {
    const { plan } = setup(0);
    plan.record(snapshot(START + 2 * HOUR, 30));

    expect(plan.record(snapshot(START + HOUR, 10))).toBe(false);
    expect(plan.latest("five_hour")?.usedPercentage).toBe(30);
  });

  it("ignora snapshots sin límites", () => {
    const { plan } = setup(0);

    expect(plan.record(snapshot(START, null))).toBe(false);
    expect(plan.latest("five_hour")).toBeNull();
  });
});

describe("uso oficial del plan en el resumen", () => {
  it("muestra el porcentaje oficial y, si hubo consumo después, lo proyecta con el costo por punto", () => {
    const now = START + 3 * HOUR;
    const { repository, plan, service } = setup(now);
    // $10 hasta el dato oficial del 20 % → $0,50 por punto; después se gastan $5 más.
    repository.insertEntries([
      dollars("a", START + 10 * 60_000, 10),
      dollars("b", START + 2.5 * HOUR, 5),
    ]);
    plan.record(snapshot(START + 2 * HOUR, 20));

    const five = service.summary().plan?.fiveHour;

    expect(five).toMatchObject({
      usedPercentage: 20,
      resetsAt: RESET,
      observedAt: START + 2 * HOUR,
      estimated: true,
    });
    expect(five?.estimatedNow).toBeCloseTo(30);
  });

  it("sin consumo posterior, el porcentaje es el oficial tal cual", () => {
    const now = START + 3 * HOUR;
    const { repository, plan, service } = setup(now);
    repository.insertEntries([dollars("a", START + 10 * 60_000, 10)]);
    plan.record(snapshot(START + 2 * HOUR, 20));

    expect(service.summary().plan?.fiveHour).toMatchObject({ estimatedNow: 20, estimated: false });
  });

  it("después del reinicio oficial ya no hay dato vigente", () => {
    const { plan, service } = setup(RESET + 1);
    plan.record(snapshot(START + HOUR, 90));

    expect(service.summary().plan).toBeNull();
  });

  it("el reinicio oficial fija la ventana aunque el primer mensaje llegue después", () => {
    const now = START + 3 * HOUR;
    const { repository, plan, service } = setup(now);
    repository.insertEntries([dollars("a", START + 40 * 60_000, 10)]);
    plan.record(snapshot(START + HOUR, 20));

    expect(service.summary().window).toMatchObject({ start: START, end: RESET, anchored: true });
  });

  it("cada ventana con dato oficial calibra el tope: costo ÷ porcentaje", () => {
    const now = START + 3 * HOUR;
    const { repository, plan, service } = setup(now);
    repository.insertEntries([dollars("a", START + 10 * 60_000, 10)]);
    plan.record(snapshot(START + 2 * HOUR, 20));

    const calibration = service.calibration();

    expect(calibration.samples).toMatchObject([{ source: "plan" }]);
    expect(calibration.estimatedCap).toBeCloseTo(50);
  });
});

describe("SessionRegistry.applyStatus", () => {
  const store: SessionStore = {
    save: () => undefined,
    remove: () => undefined,
    loadActive: () => [],
  };

  it("anota el costo y el contexto oficiales en la instancia del mismo proceso", () => {
    const registry = new SessionRegistry({ store, now: () => 1_000 });
    for (const pid of [100, 200]) {
      registry.applyHook({
        event: "UserPromptSubmit",
        ts: 1,
        sessionId: "sess-a",
        pid,
        origin: { entrypoint: "cli", bundleId: null, termProgram: null },
        cwd: "/x",
        projectDir: null,
        transcriptPath: null,
        permissionMode: null,
        model: null,
        source: null,
        reason: null,
        notificationType: null,
        toolName: null,
        agentType: null,
        prompt: null,
        backgroundTasks: null,
      });
    }

    registry.applyStatus(snapshot(2_000, 20, { pid: 200, costUsd: 3.21, sessionName: "parser" }));
    registry.applyStatus(snapshot(1_500, 20, { pid: 200, costUsd: 1 }));

    expect(registry.get("sess-a:200")?.metrics).toMatchObject({
      costUsd: 3.21,
      contextUsedPercentage: 12,
      sessionName: "parser",
    });
    expect(registry.get("sess-a:200")?.model).toBe("claude-opus-5-5");
    expect(registry.get("sess-a:100")?.metrics).toBeNull();
  });
});
