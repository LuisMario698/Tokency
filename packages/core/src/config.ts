import { readFileSync } from "node:fs";

import { z } from "zod";

import type { SessionTimings } from "./sessions/state-machine.ts";

export const DEFAULT_PORT = 7777;

export const configSchema = z.object({
  port: z.number().int().min(1024).max(65_535).default(DEFAULT_PORT),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Precios propios que se combinan con la tabla por defecto (D-016), en USD por millón de tokens.
  pricing: z
    .object({
      models: z
        .record(
          z.string(),
          z.object({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
            cacheWrite5m: z.number().nonnegative().optional(),
            cacheWrite1h: z.number().nonnegative().optional(),
            cacheRead: z.number().nonnegative().optional(),
            fastMultiplier: z.number().positive().optional(),
          }),
        )
        .optional(),
      webSearchPer1k: z.number().nonnegative().optional(),
    })
    .optional(),
  sessions: z
    .object({
      doneToIdleMinutes: z.number().positive().default(15),
      endAfterInactiveMinutes: z.number().positive().default(60),
    })
    .prefault({}),
});

export type TokencyConfig = z.infer<typeof configSchema>;

export interface LoadedConfig {
  config: TokencyConfig;
  /** Problemas encontrados; si hay alguno se usan los valores por defecto. */
  warnings: string[];
}

/** Lee `config.json`. Si falta o es inválido, usa los valores por defecto y lo avisa. */
export function loadConfig(file: string): LoadedConfig {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { config: configSchema.parse({}), warnings: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { config: configSchema.parse({}), warnings: [`${file} no es JSON válido.`] };
  }
  const result = configSchema.safeParse(parsed);
  if (result.success) return { config: result.data, warnings: [] };
  const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { config: configSchema.parse({}), warnings: issues.map((i) => `${file}: ${i}`) };
}

export function sessionTimings(config: TokencyConfig): SessionTimings {
  return {
    doneToIdleMs: config.sessions.doneToIdleMinutes * 60_000,
    endAfterInactiveMs: config.sessions.endAfterInactiveMinutes * 60_000,
    transcriptIdleMs: 15_000,
  };
}
