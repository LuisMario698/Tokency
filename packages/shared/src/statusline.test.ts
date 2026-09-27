import { describe, expect, it } from "vitest";

import { statusSnapshotSchema } from "./schemas.ts";
import { sanitizeStatusLine } from "./statusline.ts";

// Forma del ejemplo de https://code.claude.com/docs/en/statusline (valores de prueba).
const documented = {
  session_id: "sess-a",
  session_name: "refactor del parser",
  transcript_path: "/Users/demo/.claude/projects/-demo/sess-a.jsonl",
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  workspace: { current_dir: "/Users/demo/proyecto", project_dir: "/Users/demo/proyecto" },
  cost: {
    total_cost_usd: 3.21,
    total_duration_ms: 45_000,
    total_api_duration_ms: 2_300,
    total_lines_added: 156,
    total_lines_removed: 23,
  },
  context_window: {
    total_input_tokens: 15_234,
    context_window_size: 1_000_000,
    used_percentage: 8,
  },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1_738_425_600 },
    seven_day: { used_percentage: 41.2, resets_at: 1_738_857_600 },
  },
};

describe("sanitizeStatusLine", () => {
  it("copia los límites del plan en milisegundos y las métricas de la sesión", () => {
    const snapshot = sanitizeStatusLine(documented, { ts: 1, pid: 42 });

    expect(snapshot).toEqual({
      ts: 1,
      sessionId: "sess-a",
      pid: 42,
      sessionName: "refactor del parser",
      modelId: "claude-opus-5-5",
      modelName: "Opus 5.5",
      costUsd: 3.21,
      durationMs: 45_000,
      apiDurationMs: 2_300,
      linesAdded: 156,
      linesRemoved: 23,
      contextUsedPercentage: 8,
      contextWindowSize: 1_000_000,
      contextInputTokens: 15_234,
      fiveHour: { usedPercentage: 23.5, resetsAt: 1_738_425_600_000 },
      sevenDay: { usedPercentage: 41.2, resetsAt: 1_738_857_600_000 },
      spendLimit: null,
    });
    expect(statusSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("tolera que falten los límites (antes de la primera respuesta o sin plan de claude.ai)", () => {
    const { rate_limits: _omitido, ...withoutLimits } = documented;

    const snapshot = sanitizeStatusLine(withoutLimits, { ts: 1, pid: null });

    expect(snapshot).toMatchObject({ fiveHour: null, sevenDay: null, costUsd: 3.21 });
  });

  it("ignora ventanas incompletas y datos sin session_id", () => {
    const partial = { ...documented, rate_limits: { five_hour: { used_percentage: 10 } } };

    expect(sanitizeStatusLine(partial, { ts: 1, pid: null })?.fiveHour).toBeNull();
    expect(sanitizeStatusLine({ model: {} }, { ts: 1, pid: null })).toBeNull();
    expect(sanitizeStatusLine("texto", { ts: 1, pid: null })).toBeNull();
  });
});
