import type { HookEvent, LiveEvent, Session } from "@tokency/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { silentLogger } from "../logger.ts";
import { SessionRegistry, type SessionStore } from "../sessions/registry.ts";
import { createApi, startApiServer, tokensMatch } from "./server.ts";

const TOKEN = "a".repeat(64);
const PORT = 7777;

const store: SessionStore = {
  save: () => undefined,
  remove: () => undefined,
  loadActive: () => [],
};

let registry: SessionRegistry;
let recorded: string[];
let app: ReturnType<typeof createApi>;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { host: `127.0.0.1:${String(PORT)}`, authorization: `Bearer ${TOKEN}`, ...extra };
}

function event(extra: Partial<HookEvent> = {}): HookEvent {
  return {
    event: "UserPromptSubmit",
    ts: 1,
    sessionId: "s1",
    pid: 10,
    origin: { entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: null },
    cwd: "/repo",
    transcriptPath: null,
    permissionMode: null,
    model: null,
    source: null,
    reason: null,
    notificationType: null,
    toolName: null,
    agentType: null,
    prompt: "hola",
    backgroundTasks: null,
    ...extra,
  };
}

beforeEach(() => {
  registry = new SessionRegistry({ store, now: () => 1_000 });
  recorded = [];
  app = createApi({
    token: TOKEN,
    port: PORT,
    registry,
    recorder: { recordHookEvent: (id, e) => recorded.push(`${id} ${e.event}`) },
    logger: silentLogger,
    version: "0.0.0-test",
    startedAt: 500,
    now: () => 1_000,
    heartbeatMs: 20,
  });
});

describe("seguridad", () => {
  it.each([
    ["sin token", { authorization: "" }, 401],
    ["con otro token", { authorization: `Bearer ${"b".repeat(64)}` }, 401],
    ["sin el prefijo Bearer", { authorization: TOKEN }, 401],
    ["con un Host ajeno", { host: "evil.example:7777" }, 403],
    ["con otro puerto en el Host", { host: "127.0.0.1:8080" }, 403],
    ["desde un navegador (Origin)", { origin: "http://localhost:3000" }, 403],
  ])("rechaza peticiones %s", async (_name, extra, status) => {
    const response = await app.request("/v1/health", { headers: headers(extra) });

    expect(response.status).toBe(status);
  });

  it("acepta localhost y 127.0.0.1 con el token correcto", async () => {
    for (const host of ["127.0.0.1:7777", "localhost:7777"]) {
      const response = await app.request("/v1/health", { headers: headers({ host }) });
      expect(response.status).toBe(200);
    }
  });

  it("compara tokens sin importar la longitud", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch("corto", TOKEN)).toBe(false);
  });
});

describe("rutas", () => {
  it("GET /v1/health informa versión, tiempo activo y sesiones", async () => {
    const response = await app.request("/v1/health", { headers: headers() });

    expect(await response.json()).toEqual({
      ok: true,
      version: "0.0.0-test",
      startedAt: 500,
      uptimeMs: 500,
      sessions: 0,
    });
  });

  it("POST /v1/hooks aplica y registra el evento", async () => {
    const response = await app.request("/v1/hooks", {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify(event()),
    });

    expect(response.status).toBe(202);
    expect(registry.list().map((s) => [s.id, s.state, s.lastPrompt])).toEqual([
      ["s1:10", "working", "hola"],
    ]);
    expect(recorded).toEqual(["s1:10 UserPromptSubmit"]);
  });

  it("POST /v1/hooks rechaza eventos inválidos o que no son JSON", async () => {
    const invalid = await app.request("/v1/hooks", {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify({ ...event(), event: "Inventado" }),
    });
    const notJson = await app.request("/v1/hooks", {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: "{",
    });

    expect(invalid.status).toBe(400);
    expect(notJson.status).toBe(400);
    expect(registry.list()).toEqual([]);
  });

  it("POST /v1/hooks rechaza cuerpos demasiado grandes", async () => {
    const response = await app.request("/v1/hooks", {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify({ ...event(), cwd: "x".repeat(100_000) }),
    });

    expect(response.status).toBe(413);
  });

  it("GET /v1/sessions lista las sesiones abiertas", async () => {
    registry.applyHook(event());

    const response = await app.request("/v1/sessions", { headers: headers() });
    const body = (await response.json()) as { sessions: Session[] };

    expect(body.sessions.map((s) => s.id)).toEqual(["s1:10"]);
  });
});

describe("GET /v1/events", () => {
  async function readEvents(count: number, action: () => void): Promise<string[]> {
    const response = await app.request("/v1/events", { headers: headers() });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const events: string[] = [];
    let buffer = "";
    let acted = false;
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const name = /^event: (.+)$/m.exec(block)?.[1] ?? "";
        const data = /^data: (.+)$/m.exec(block)?.[1] ?? "";
        if (name !== "ping") events.push(`${name} ${data}`);
      }
      if (!acted && events.length > 0) {
        acted = true;
        action();
      }
    }
    await reader.cancel();
    return events;
  }

  it("manda una foto inicial y después cada cambio", async () => {
    registry.applyHook(event({ sessionId: "s0" }));

    const events = await readEvents(2, () => {
      registry.applyHook(event());
    });

    const [snapshot, update] = events.map(
      (line) => JSON.parse(line.slice(line.indexOf(" ") + 1)) as LiveEvent,
    );
    expect(events[0]?.startsWith("snapshot ")).toBe(true);
    expect(snapshot?.type === "snapshot" && snapshot.sessions.map((s) => s.id)).toEqual(["s0:10"]);
    expect(update?.type === "session.updated" && update.session.id).toBe("s1:10");
  });
});

describe("startApiServer", () => {
  it("solo escucha en 127.0.0.1 y avisa si el puerto está ocupado", async () => {
    const first = await startApiServer(app, 0);
    const address = first.address();
    expect(typeof address === "object" && address?.address).toBe("127.0.0.1");
    const port = typeof address === "object" && address !== null ? address.port : 0;

    await expect(startApiServer(app, port)).rejects.toThrow(/ya está en uso/);
    await new Promise((resolve) => first.close(resolve));
  });
});
