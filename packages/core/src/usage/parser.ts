// Parser de las líneas de los transcripts de Claude Code (D-015). El formato no es una API
// oficial: todo lo que depende de él vive aquí, con pruebas basadas en fixtures anonimizados.

import { parseResetTime } from "./reset-time.ts";

export interface UsageEntry {
  messageId: string;
  /** Vacío si la línea no trae `requestId`. */
  requestId: string;
  sessionId: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  /** `speed: "fast"`: modo rápido, con precio mayor. */
  fast: boolean;
  cwd: string | null;
}

export interface LimitEvent {
  timestamp: number;
  sessionId: string | null;
  /** `session`, `weekly`… tal como lo dice el aviso. */
  kind: string;
  resetsAt: number | null;
  message: string;
}

export type ParsedLine =
  { type: "usage"; entry: UsageEntry } | { type: "limit"; event: LimitEvent };

const LIMIT = /hit your ([\w-]+) limit(?:\s*·\s*resets\s+(.+?))?(?:\s*\(([^)]+)\))?\s*$/i;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(content: unknown): string | null {
  if (!Array.isArray(content)) return typeof content === "string" ? content : null;
  for (const block of content) {
    const text = record(block)?.text;
    if (typeof text === "string") return text;
  }
  return null;
}

function parseLimit(line: Record<string, unknown>, timestamp: number): LimitEvent | null {
  const text = firstText(record(line.message)?.content);
  if (text === null) return null;
  const match = LIMIT.exec(text);
  if (match === null) return null;
  const [, kind = "unknown", resetText, timeZone] = match;
  const resetsAt =
    resetText !== undefined && timeZone !== undefined
      ? parseResetTime(resetText, timeZone, timestamp)
      : null;
  return {
    timestamp,
    sessionId: typeof line.sessionId === "string" ? line.sessionId : null,
    kind: kind.toLowerCase(),
    resetsAt,
    message: text.slice(0, 200),
  };
}

function parseUsage(line: Record<string, unknown>, timestamp: number): UsageEntry | null {
  const message = record(line.message);
  const usage = record(message?.usage);
  const model = message?.model;
  const messageId = message?.id;
  const sessionId = line.sessionId;
  if (usage === null || typeof model !== "string" || model === "<synthetic>") return null;
  if (typeof messageId !== "string" || typeof sessionId !== "string") return null;

  const breakdown = record(usage.cache_creation);
  const totalWrites = count(usage.cache_creation_input_tokens);
  const write1h = breakdown === null ? 0 : count(breakdown.ephemeral_1h_input_tokens);
  // Sin desglose por duración, toda la escritura se cuenta como de 5 minutos.
  const write5m = breakdown === null ? totalWrites : count(breakdown.ephemeral_5m_input_tokens);

  return {
    messageId,
    requestId: typeof line.requestId === "string" ? line.requestId : "",
    sessionId,
    timestamp,
    model,
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    cacheReadTokens: count(usage.cache_read_input_tokens),
    webSearches: count(record(usage.server_tool_use)?.web_search_requests),
    fast: usage.speed === "fast",
    cwd: typeof line.cwd === "string" ? line.cwd : null,
  };
}

/** Devuelve el consumo o el aviso de límite de una línea, o `null` si no trae ninguno. */
export function parseTranscriptLine(text: string): ParsedLine | null {
  // Filtro barato antes de JSON.parse: la mayoría de las líneas no traen consumo.
  if (!text.includes('"usage"') && !text.includes("isApiErrorMessage")) return null;
  let line: Record<string, unknown> | null;
  try {
    line = record(JSON.parse(text));
  } catch {
    return null;
  }
  if (line?.type !== "assistant" || typeof line.timestamp !== "string") return null;
  const timestamp = Date.parse(line.timestamp);
  if (Number.isNaN(timestamp)) return null;
  if (line.isApiErrorMessage === true) {
    const event = parseLimit(line, timestamp);
    return event === null ? null : { type: "limit", event };
  }
  const entry = parseUsage(line, timestamp);
  return entry === null ? null : { type: "usage", entry };
}

export function totalTokens(entry: UsageEntry): number {
  return (
    entry.inputTokens +
    entry.outputTokens +
    entry.cacheWrite5mTokens +
    entry.cacheWrite1hTokens +
    entry.cacheReadTokens
  );
}
