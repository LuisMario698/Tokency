// API local del core (spec §4.1). Solo escucha en 127.0.0.1 y exige el token en cada petición.

import { createHash, timingSafeEqual } from "node:crypto";

import { serve, type ServerType } from "@hono/node-server";
import { hookEventSchema, type HookEvent, type LiveEvent } from "@tokency/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import type { Logger } from "../logger.ts";
import type { SessionChange, SessionRegistry } from "../sessions/registry.ts";
import { instanceId } from "../sessions/state-machine.ts";

export interface HookEventRecorder {
  recordHookEvent(instanceId: string, event: HookEvent, receivedAt: number): void;
}

export interface ApiOptions {
  token: string;
  port: number;
  registry: SessionRegistry;
  recorder?: HookEventRecorder;
  logger: Logger;
  version: string;
  startedAt: number;
  now?: () => number;
  /** Cada cuánto se manda un `ping` por SSE para que los clientes detecten cortes. */
  heartbeatMs?: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compara en tiempo constante; el hash iguala la longitud de ambos valores. */
export function tokensMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function toLiveEvent(change: SessionChange): LiveEvent {
  return change.type === "updated"
    ? { type: "session.updated", session: change.session }
    : { type: "session.removed", id: change.id };
}

function guard(options: ApiOptions): MiddlewareHandler {
  const allowedHosts = new Set([
    `127.0.0.1:${String(options.port)}`,
    `localhost:${String(options.port)}`,
  ]);
  return async (c, next) => {
    // Un Host distinto delata un ataque de DNS rebinding desde el navegador.
    if (!allowedHosts.has(c.req.header("host") ?? "")) {
      return c.json({ error: "Host no permitido." }, 403);
    }
    // Solo los navegadores mandan Origin; ningún cliente de Tokency lo necesita.
    if (c.req.header("origin") !== undefined) {
      return c.json({ error: "Las peticiones desde un navegador no están permitidas." }, 403);
    }
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (given.length === 0 || !tokensMatch(given, options.token)) {
      return c.json({ error: "Token inválido o ausente." }, 401);
    }
    await next();
    return undefined;
  };
}

export function createApi(options: ApiOptions): Hono {
  const { registry, logger, recorder, now = Date.now, heartbeatMs = 15_000 } = options;
  const app = new Hono();

  app.use("*", guard(options));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    logger.error("Error en la API", { path: c.req.path, error });
    return c.json({ error: "Error interno del core." }, 500);
  });

  app.get("/v1/health", (c) =>
    c.json({
      ok: true,
      version: options.version,
      startedAt: options.startedAt,
      uptimeMs: now() - options.startedAt,
      sessions: registry.list().length,
    }),
  );

  app.post("/v1/hooks", bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "El cuerpo no es JSON válido." }, 400);
    }
    const parsed = hookEventSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Evento de hook inválido.", issues: parsed.error.issues }, 400);
    }
    const event = parsed.data;
    registry.applyHook(event);
    try {
      recorder?.recordHookEvent(instanceId(event.sessionId, event.pid), event, now());
    } catch (error) {
      logger.warn("No se pudo registrar el evento", { error });
    }
    logger.debug("Evento de hook", { event: event.event, sessionId: event.sessionId });
    return c.json({ ok: true }, 202);
  });

  app.get("/v1/sessions", (c) => c.json({ sessions: registry.list() }));

  app.get("/v1/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: LiveEvent) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      const unsubscribe = registry.subscribe((change) => {
        send(toLiveEvent(change)).catch(() => undefined);
      });
      stream.onAbort(unsubscribe);
      try {
        await send({ type: "snapshot", sessions: registry.list() });
        for (;;) {
          await stream.sleep(heartbeatMs);
          if (stream.aborted) break;
          await stream.writeSSE({ event: "ping", data: "{}" });
        }
      } finally {
        unsubscribe();
      }
    }),
  );

  return app;
}

/** Arranca el servidor solo en la interfaz local. */
export function startApiServer(app: Hono, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
      resolve(server);
    });
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`El puerto ${String(port)} ya está en uso.`, { cause: error })
          : error,
      );
    });
  });
}
