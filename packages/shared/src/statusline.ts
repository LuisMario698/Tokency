// Datos que Claude Code entrega a la status line (https://code.claude.com/docs/en/statusline),
// saneados. Son la única fuente oficial del uso del plan: `rate_limits` trae el mismo porcentaje
// de la sesión de 5 horas y de la semana que muestra Claude (D-017). Sin Zod: lo usa el CLI.

export interface RateLimitWindow {
  /** 0–100 (el de gasto puede pasar de 100). */
  usedPercentage: number;
  /** Milisegundos desde epoch. */
  resetsAt: number;
}

export interface StatusSnapshot {
  /** Cuándo lo recibió el comando `tokency statusline`. */
  ts: number;
  sessionId: string;
  pid: number | null;
  sessionName: string | null;
  modelId: string | null;
  modelName: string | null;
  /** Costo de la sesión según Claude Code, a precio de lista. */
  costUsd: number | null;
  durationMs: number | null;
  apiDurationMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  contextUsedPercentage: number | null;
  contextWindowSize: number | null;
  contextInputTokens: number | null;
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
  spendLimit: RateLimitWindow | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown, max = 300): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

function rateWindow(value: unknown): RateLimitWindow | null {
  const window = record(value);
  const used = number(window?.used_percentage);
  const resets = number(window?.resets_at);
  if (used === null || resets === null) return null;
  // La documentación da `resets_at` en segundos Unix.
  return { usedPercentage: used, resetsAt: Math.round(resets * 1000) };
}

/** Convierte el JSON de la status line en una lista cerrada de campos; `null` si no sirve. */
export function sanitizeStatusLine(
  raw: unknown,
  context: { ts: number; pid: number | null },
): StatusSnapshot | null {
  const data = record(raw);
  const sessionId = text(data?.session_id, 200);
  if (data === null || sessionId === null) return null;
  const model = record(data.model);
  const cost = record(data.cost);
  const contextWindow = record(data.context_window);
  const rates = record(data.rate_limits);
  return {
    ts: context.ts,
    sessionId,
    pid: context.pid,
    sessionName: text(data.session_name, 200),
    modelId: text(model?.id, 200),
    modelName: text(model?.display_name, 200),
    costUsd: number(cost?.total_cost_usd),
    durationMs: number(cost?.total_duration_ms),
    apiDurationMs: number(cost?.total_api_duration_ms),
    linesAdded: number(cost?.total_lines_added),
    linesRemoved: number(cost?.total_lines_removed),
    contextUsedPercentage: number(contextWindow?.used_percentage),
    contextWindowSize: number(contextWindow?.context_window_size),
    contextInputTokens: number(contextWindow?.total_input_tokens),
    fiveHour: rateWindow(rates?.five_hour),
    sevenDay: rateWindow(rates?.seven_day),
    spendLimit: rateWindow(rates?.spend_limit),
  };
}
