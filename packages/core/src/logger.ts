import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogData = Record<string, unknown>;

export interface Logger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface FileLoggerOptions {
  file: string;
  level?: LogLevel;
  /** Tamaño a partir del cual se rota el archivo. */
  maxBytes?: number;
  /** Archivos rotados que se conservan (`core.1.log`, `core.2.log`…). */
  keep?: number;
  now?: () => Date;
}

function currentSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function rotatedName(file: string, index: number): string {
  const ext = path.extname(file);
  return `${file.slice(0, -ext.length || undefined)}.${index}${ext}`;
}

function serializeError(value: unknown): unknown {
  return value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : value;
}

/**
 * Logger de líneas JSON con rotación por tamaño. Escribe de forma síncrona: el volumen es bajo y
 * así no se pierden líneas si el proceso muere. Nunca lanza errores.
 */
export function createFileLogger(options: FileLoggerOptions): Logger {
  const {
    file,
    level = "info",
    maxBytes = 5 * 1024 * 1024,
    keep = 3,
    now = () => new Date(),
  } = options;
  const minimum = LOG_LEVELS.indexOf(level);
  let size = currentSize(file);

  function rotate(): void {
    for (let index = keep - 1; index >= 1; index--) {
      try {
        renameSync(rotatedName(file, index), rotatedName(file, index + 1));
      } catch {
        // No existe ese archivo rotado todavía.
      }
    }
    try {
      renameSync(file, rotatedName(file, 1));
    } catch {
      // Nada que rotar.
    }
    size = 0;
  }

  function write(entryLevel: LogLevel, message: string, data?: LogData): void {
    if (LOG_LEVELS.indexOf(entryLevel) < minimum) return;
    try {
      const fields = Object.fromEntries(
        Object.entries(data ?? {}).map(([key, value]) => [key, serializeError(value)]),
      );
      const line = `${JSON.stringify({ time: now().toISOString(), level: entryLevel, message, ...fields })}\n`;
      const bytes = Buffer.byteLength(line);
      if (size + bytes > maxBytes) rotate();
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      appendFileSync(file, line, { mode: 0o600 });
      size += bytes;
    } catch {
      // Un log que falla no debe tumbar el core.
    }
  }

  return {
    debug: (message, data) => {
      write("debug", message, data);
    },
    info: (message, data) => {
      write("info", message, data);
    },
    warn: (message, data) => {
      write("warn", message, data);
    },
    error: (message, data) => {
      write("error", message, data);
    },
  };
}
