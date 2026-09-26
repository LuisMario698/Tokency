// Fuente de respaldo (spec §4.2): vigila los JSONL de `~/.claude/projects/` con eventos del
// sistema de archivos, sin sondeo. Solo lee rutas y el campo `cwd`, nunca el contenido.

import { existsSync, watch, type FSWatcher } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logger.ts";

const SESSION_FILE =
  /^[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Reconoce `<proyecto>/<session_id>.jsonl`; ignora subagentes y otros archivos. */
export function sessionIdFromPath(relative: string): string | null {
  return SESSION_FILE.exec(relative.split(path.sep).join("/"))?.[1] ?? null;
}

/** Busca el `cwd` más reciente en el final del JSONL, sin leer el archivo completo. */
export async function readTranscriptCwd(
  file: string,
  tailBytes = 64 * 1024,
): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n").reverse();
    for (const line of lines) {
      if (!line.includes('"cwd"')) continue;
      try {
        const entry = JSON.parse(line) as { cwd?: unknown };
        if (typeof entry.cwd === "string") return entry.cwd;
      } catch {
        // La primera línea del bloque puede venir cortada.
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export interface TranscriptActivity {
  sessionId: string;
  transcriptPath: string;
  cwd: string | null;
}

export interface TranscriptWatcherOptions {
  projectsDir: string;
  onActivity: (activity: TranscriptActivity) => void;
  logger: Logger;
  /** Como mucho un aviso por sesión en este intervalo. */
  throttleMs?: number;
  /** Si la carpeta no existe o el vigilante falla, se reintenta tras este tiempo. */
  retryMs?: number;
  now?: () => number;
}

export function watchTranscripts(options: TranscriptWatcherOptions): { close(): void } {
  const { projectsDir, onActivity, logger, throttleMs = 2_000, retryMs = 60_000 } = options;
  const now = options.now ?? Date.now;
  const lastEmit = new Map<string, number>();
  const cwdCache = new Map<string, string | null>();
  let watcher: FSWatcher | undefined;
  let retry: NodeJS.Timeout | undefined;
  let closed = false;

  function handle(filename: string): void {
    const sessionId = sessionIdFromPath(filename);
    if (sessionId === null) return;
    const at = now();
    if (at - (lastEmit.get(sessionId) ?? 0) < throttleMs) return;
    lastEmit.set(sessionId, at);
    const transcriptPath = path.join(projectsDir, filename);
    const cached = cwdCache.get(sessionId);
    if (cached !== undefined) {
      onActivity({ sessionId, transcriptPath, cwd: cached });
      return;
    }
    void readTranscriptCwd(transcriptPath).then((cwd) => {
      cwdCache.set(sessionId, cwd);
      if (!closed) onActivity({ sessionId, transcriptPath, cwd });
    });
  }

  function scheduleRetry(): void {
    if (closed) return;
    retry = setTimeout(start, retryMs);
    retry.unref();
  }

  function start(): void {
    if (closed) return;
    if (!existsSync(projectsDir)) {
      logger.info("La carpeta de proyectos de Claude no existe todavía", { projectsDir });
      scheduleRetry();
      return;
    }
    try {
      watcher = watch(projectsDir, { recursive: true, persistent: false }, (_type, filename) => {
        if (typeof filename === "string") handle(filename);
      });
      watcher.on("error", (error) => {
        logger.warn("Falló el vigilante de transcripts; se reintentará", { error });
        watcher?.close();
        scheduleRetry();
      });
      logger.info("Vigilando transcripts", { projectsDir });
    } catch (error) {
      logger.warn("No se pudo vigilar la carpeta de transcripts", { error });
      scheduleRetry();
    }
  }

  start();
  return {
    close() {
      closed = true;
      clearTimeout(retry);
      watcher?.close();
    },
  };
}
