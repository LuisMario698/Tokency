// Contrato de las rutas `/v1/usage/*` y del evento `usage.updated` (D-015, D-016).
// Todo costo es el equivalente en la API con la tabla de precios editable, no lo que cobra el plan.

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  /** Costo equivalente en API de las entradas con precio conocido (USD). */
  cost: number;
  /** Tokens de modelos sin precio en la tabla: no entran en `cost`. */
  unpricedTokens: number;
  messages: number;
}

export interface ActiveWindow {
  start: number;
  end: number;
  resetsInMs: number;
  totals: TokenTotals;
  costByModel: Record<string, number>;
  /** Dólares equivalentes por hora desde el inicio de la ventana. */
  burnRatePerHour: number;
  /** Lo que se habrá consumido al final de la ventana si se sigue al mismo ritmo. */
  projectedCost: number;
  /** Fracción del tope estimado; `null` sin calibración. */
  fractionOfCap: number | null;
  /** El inicio salió de un aviso de límite con hora de reinicio. */
  anchored: boolean;
}

export interface LimitInfo {
  at: number;
  resetsAt: number | null;
  kind: string;
  source: "transcript" | "manual";
}

/** Porcentaje oficial de un límite del plan y su proyección hasta ahora (D-017). */
export interface PlanLimit {
  /** Último porcentaje oficial que reportó Claude Code (0–100). */
  usedPercentage: number;
  resetsAt: number;
  /** Cuándo se recibió ese dato oficial. */
  observedAt: number;
  /** Porcentaje proyectado a este momento con el consumo local posterior al dato oficial. */
  estimatedNow: number;
  /** `true` si hubo consumo después del dato oficial y `estimatedNow` es una proyección. */
  estimated: boolean;
}

export interface PlanUsage {
  fiveHour: PlanLimit | null;
  sevenDay: PlanLimit | null;
}

export interface UsageSummary {
  generatedAt: number;
  timeZone: string;
  /** Uso oficial del plan según la status line de Claude Code; `null` si nunca llegó. */
  plan: PlanUsage | null;
  /** Ventana de 5 horas vigente; `null` si no hay una abierta. */
  window: ActiveWindow | null;
  today: TokenTotals;
  last7Days: TokenTotals;
  calibration: {
    /** Costo equivalente que aguanta una ventana antes del límite, estimado. */
    estimatedCap: number | null;
    samples: number;
    lastLimit: LimitInfo | null;
  };
  /** Consumo de las últimas 24 h por `session_id`, para mostrarlo en las bandas. */
  sessions: Record<string, { totalTokens: number; cost: number }>;
  /** Modelos usados en los últimos 30 días que no tienen precio en la tabla. */
  unpricedModels: string[];
  firstEntryAt: number | null;
}

export interface DailyUsage {
  /** Día local `YYYY-MM-DD`. */
  date: string;
  totals: TokenTotals;
  costByModel: Record<string, number>;
}

export interface ProjectUsage {
  project: string;
  totals: TokenTotals;
  sessions: number;
  lastActivity: number;
}

export interface WindowSummary {
  start: number;
  end: number;
  lastActivity: number;
  totals: TokenTotals;
  anchored: boolean;
  limitHit: LimitInfo | null;
}

export const OFFICIAL_USAGE_URL = "https://claude.ai/settings/usage";
