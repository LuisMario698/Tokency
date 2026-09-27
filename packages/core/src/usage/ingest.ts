// Ingesta incremental de los JSONL de Claude Code: lee cada archivo desde donde se quedó.

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logger.ts";
import { parseTranscriptLine, type LimitEvent, type UsageEntry } from "./parser.ts";
import type { UsageRepository } from "./repository.ts";

export interface IngestResult {
  entries: number;
  limits: number;
}

const NEWLINE = 0x0a;

/**
 * Lee `file` desde `start` y devuelve las líneas completas y cuántos bytes ocupan. Una línea
 * sin salto final todavía se está escribiendo: queda para la próxima lectura.
 */
export async function readCompleteLines(
  file: string,
  start: number,
  onLine: (line: string) => void,
): Promise<number> {
  let consumed = 0;
  let pending: Buffer[] = [];
  let pendingLength = 0;
  for await (const chunk of createReadStream(file, { start })) {
    const buffer = chunk as Buffer;
    let from = 0;
    for (let index = buffer.indexOf(NEWLINE); index !== -1; index = buffer.indexOf(NEWLINE, from)) {
      const piece = buffer.subarray(from, index);
      const line = pendingLength > 0 ? Buffer.concat([...pending, piece]) : piece;
      consumed += line.length + 1;
      pending = [];
      pendingLength = 0;
      if (line.length > 0) onLine(line.toString("utf8"));
      from = index + 1;
    }
    if (from < buffer.length) {
      pending.push(buffer.subarray(from));
      pendingLength += buffer.length - from;
    }
  }
  return consumed;
}

export class UsageIngestor {
  readonly #repository: UsageRepository;
  readonly #projectsDir: string;
  readonly #logger: Logger;
  /** Evita leer el mismo archivo dos veces en paralelo. */
  readonly #running = new Map<string, Promise<IngestResult>>();

  constructor(options: { repository: UsageRepository; projectsDir: string; logger: Logger }) {
    this.#repository = options.repository;
    this.#projectsDir = options.projectsDir;
    this.#logger = options.logger;
  }

  /** Recorre todos los JSONL, incluidos los de subagentes. */
  async scanAll(): Promise<IngestResult> {
    let names: string[];
    try {
      names = await readdir(this.#projectsDir, { recursive: true });
    } catch {
      return { entries: 0, limits: 0 };
    }
    const total: IngestResult = { entries: 0, limits: 0 };
    for (const name of names.filter((n) => n.endsWith(".jsonl"))) {
      const result = await this.ingestFile(path.join(this.#projectsDir, name));
      total.entries += result.entries;
      total.limits += result.limits;
    }
    return total;
  }

  ingestFile(file: string): Promise<IngestResult> {
    const running = this.#running.get(file);
    if (running !== undefined) return running;
    const task = this.#ingest(file).finally(() => this.#running.delete(file));
    this.#running.set(file, task);
    return task;
  }

  async #ingest(file: string): Promise<IngestResult> {
    let info;
    try {
      info = await stat(file);
    } catch {
      return { entries: 0, limits: 0 };
    }
    const state = this.#repository.fileState(file);
    if (state !== null && state.size === info.size && state.mtimeMs === Math.round(info.mtimeMs)) {
      return { entries: 0, limits: 0 };
    }
    // Un archivo más chico que lo leído fue reescrito: se lee de nuevo y la deduplicación evita
    // contar dos veces.
    const start = state !== null && info.size >= state.offset ? state.offset : 0;
    const entries: UsageEntry[] = [];
    const limits: LimitEvent[] = [];
    let consumed: number;
    try {
      consumed = await readCompleteLines(file, start, (line) => {
        const parsed = parseTranscriptLine(line);
        if (parsed?.type === "usage") entries.push(parsed.entry);
        else if (parsed?.type === "limit") limits.push(parsed.event);
      });
    } catch (error) {
      this.#logger.warn("No se pudo leer un transcript", { file, error });
      return { entries: 0, limits: 0 };
    }
    const added = this.#repository.insertEntries(entries);
    const newLimits = limits.filter((event) =>
      this.#repository.insertLimitEvent(event, "transcript"),
    ).length;
    this.#repository.saveFileState(file, {
      offset: start + consumed,
      size: info.size,
      mtimeMs: Math.round(info.mtimeMs),
    });
    return { entries: added, limits: newLimits };
  }
}
