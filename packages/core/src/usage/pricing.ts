// Costo equivalente en API con una tabla editable (D-016). No es lo que paga el plan Pro:
// sirve para comparar y calibrar.

import type { UsageEntry } from "./parser.ts";

/** Dólares por millón de tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  /** Multiplicador del modo rápido (`speed: "fast"`), si el modelo lo tiene. */
  fastMultiplier?: number;
}

export interface PricingTable {
  models: Record<string, ModelPrice>;
  /** Dólares por cada 1000 búsquedas web. */
  webSearchPer1k: number;
}

export interface PricingOverrides {
  models?: Record<string, Partial<ModelPrice>>;
  webSearchPer1k?: number;
}

/** Referencia oficial de precios de la API, consultada el 2026-09-26 (D-016). */
export const DEFAULT_PRICING: PricingTable = {
  models: {
    "claude-fable-5-1": {
      input: 10,
      output: 50,
      cacheWrite5m: 12.5,
      cacheWrite1h: 20,
      cacheRead: 0.25,
    },
    "claude-fable-5": { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1 },
    "claude-opus-5-5": {
      input: 4,
      output: 20,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
      cacheRead: 0.2,
      fastMultiplier: 2,
    },
    "claude-opus-5": {
      input: 5,
      output: 25,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
      cacheRead: 0.5,
      fastMultiplier: 2,
    },
    "claude-sonnet-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
    "claude-haiku-4-5": {
      input: 1,
      output: 5,
      cacheWrite5m: 1.25,
      cacheWrite1h: 2,
      cacheRead: 0.1,
    },
  },
  webSearchPer1k: 10,
};

/** Combina la tabla por defecto con lo que el usuario cambió, modelo por modelo. */
export function mergePricing(overrides: PricingOverrides | undefined): PricingTable {
  const models: Record<string, ModelPrice> = { ...DEFAULT_PRICING.models };
  for (const [model, price] of Object.entries(overrides?.models ?? {})) {
    const base = models[model];
    const merged = { ...base, ...price };
    const complete =
      typeof merged.input === "number" &&
      typeof merged.output === "number" &&
      typeof merged.cacheWrite5m === "number" &&
      typeof merged.cacheWrite1h === "number" &&
      typeof merged.cacheRead === "number";
    if (complete) models[model] = merged as ModelPrice;
  }
  return { models, webSearchPer1k: overrides?.webSearchPer1k ?? DEFAULT_PRICING.webSearchPer1k };
}

/** Precio de un modelo; acepta IDs con sufijo de fecha (`claude-x-20260101`). */
export function priceFor(table: PricingTable, model: string): ModelPrice | null {
  return table.models[model] ?? table.models[model.replace(/-\d{8}$/, "")] ?? null;
}

/** Costo en dólares, o `null` si el modelo no tiene precio en la tabla. */
export function entryCost(entry: UsageEntry, table: PricingTable): number | null {
  const price = priceFor(table, entry.model);
  if (price === null) return null;
  const tokens =
    entry.inputTokens * price.input +
    entry.outputTokens * price.output +
    entry.cacheWrite5mTokens * price.cacheWrite5m +
    entry.cacheWrite1hTokens * price.cacheWrite1h +
    entry.cacheReadTokens * price.cacheRead;
  const multiplier = entry.fast ? (price.fastMultiplier ?? 1) : 1;
  return (tokens / 1_000_000) * multiplier + (entry.webSearches * table.webSearchPer1k) / 1000;
}
