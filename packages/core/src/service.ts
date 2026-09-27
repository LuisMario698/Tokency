// Arma el core: configuración, base local, registro de sesiones, API y vigilantes.

import path from "node:path";

import { createApi, startApiServer } from "./api/server.ts";
import { loadConfig, sessionTimings } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { SessionRepository } from "./db/session-repository.ts";
import { ensureApiToken } from "./keychain.ts";
import { createFileLogger, type Logger } from "./logger.ts";
import type { TokencyPaths } from "./paths.ts";
import { SessionRegistry } from "./sessions/registry.ts";
import { isProcessAlive } from "./watchers/processes.ts";
import { watchTranscripts } from "./watchers/transcripts.ts";
import { processTty } from "./watchers/tty.ts";

const MAINTENANCE_INTERVAL_MS = 5_000;
const HOOK_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export interface CoreOptions {
  paths: TokencyPaths;
  version: string;
  /** Para pruebas: evita leer el Llavero y el puerto de la configuración. */
  token?: string;
  port?: number;
  logger?: Logger;
  isAlive?: (pid: number) => boolean;
  resolveTty?: (pid: number) => Promise<string | null>;
  /** Para pruebas: tiempos más cortos que los de producción. */
  timing?: { maintenanceMs?: number; transcriptGraceMs?: number; transcriptThrottleMs?: number };
}

export interface RunningCore {
  port: number;
  registry: SessionRegistry;
  close(): Promise<void>;
}

export async function startCore(options: CoreOptions): Promise<RunningCore> {
  const { paths, version, isAlive = isProcessAlive, resolveTty = processTty } = options;
  const { config, warnings } = loadConfig(paths.configFile);
  const logger =
    options.logger ??
    createFileLogger({ file: path.join(paths.logsDir, "core.log"), level: config.logLevel });
  for (const warning of warnings)
    logger.warn("Configuración inválida; se usan los valores por defecto", { warning });

  const token = options.token ?? (await ensureApiToken()).token;
  const db = openDatabase(paths.dbFile);
  const repository = new SessionRepository(db, logger);
  const registry = new SessionRegistry({
    store: repository,
    timings: sessionTimings(config),
    transcriptGraceMs: options.timing?.transcriptGraceMs,
  });
  registry.load();
  repository.pruneHookEvents(Date.now() - HOOK_EVENT_RETENTION_MS);

  // La terminal de cada sesión de terminal se averigua una vez, fuera del hook para no frenarlo.
  const ttyRequested = new Set<string>();
  const unsubscribeTty = registry.subscribe((change) => {
    if (change.type !== "updated") return;
    const { id, pid, tty, origin, state } = change.session;
    if (pid === null || tty !== null || origin.kind !== "cli" || state === "ended") return;
    if (ttyRequested.has(id)) return;
    ttyRequested.add(id);
    resolveTty(pid)
      .then((found) => {
        if (found !== null) registry.setTty(id, found);
      })
      .catch((error: unknown) => {
        logger.warn("No se pudo averiguar la terminal de la sesión", { id, error });
      });
  });

  const startedAt = Date.now();
  const app = createApi({
    token,
    port: options.port ?? config.port,
    registry,
    recorder: repository,
    logger,
    version,
    startedAt,
  });
  let server;
  try {
    server = await startApiServer(app, options.port ?? config.port);
  } catch (error) {
    db.close();
    throw error;
  }
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  const transcripts = watchTranscripts({
    throttleMs: options.timing?.transcriptThrottleMs,
    projectsDir: paths.claudeProjectsDir,
    logger,
    onActivity: ({ sessionId, transcriptPath, cwd }) => {
      registry.transcriptActivity(sessionId, { transcriptPath, cwd });
    },
  });

  let lastPrune = Date.now();
  const maintenance = setInterval(() => {
    try {
      for (const { id, pid } of registry.livePids()) {
        if (!isAlive(pid)) registry.processExited(id);
      }
      registry.tick();
      if (Date.now() - lastPrune > 24 * 60 * 60_000) {
        lastPrune = Date.now();
        repository.pruneHookEvents(lastPrune - HOOK_EVENT_RETENTION_MS);
      }
    } catch (error) {
      logger.error("Falló el mantenimiento periódico", { error });
    }
  }, options.timing?.maintenanceMs ?? MAINTENANCE_INTERVAL_MS);

  logger.info("Core iniciado", { version, port, sessions: registry.list().length });

  return {
    port,
    registry,
    async close() {
      clearInterval(maintenance);
      unsubscribeTty();
      transcripts.close();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        // Cierra también las conexiones SSE abiertas.
        if ("closeAllConnections" in server) server.closeAllConnections();
      });
      db.close();
      logger.info("Core detenido");
    },
  };
}
