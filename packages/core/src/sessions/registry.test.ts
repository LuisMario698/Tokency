import type { HookEvent, HookEventName, Session } from "@tokency/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { SessionRegistry, type SessionChange, type SessionStore } from "./registry.ts";

class MemoryStore implements SessionStore {
  readonly rows = new Map<string, Session>();
  save(session: Session): void {
    this.rows.set(session.id, session);
  }
  remove(id: string): void {
    this.rows.delete(id);
  }
  loadActive(): Session[] {
    return [...this.rows.values()].filter((s) => s.state !== "ended");
  }
}

let now: number;
let store: MemoryStore;
let registry: SessionRegistry;
let changes: SessionChange[];

function hook(event: HookEventName, extra: Partial<HookEvent> = {}): HookEvent {
  return {
    event,
    ts: now,
    sessionId: "s1",
    pid: 100,
    origin: { entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: null },
    cwd: "/repo",
    transcriptPath: "/p/s1.jsonl",
    permissionMode: null,
    model: null,
    source: null,
    reason: null,
    notificationType: null,
    toolName: null,
    agentType: null,
    prompt: null,
    backgroundTasks: null,
    ...extra,
  };
}

beforeEach(() => {
  now = 1_000;
  store = new MemoryStore();
  registry = new SessionRegistry({ store, now: () => now });
  changes = [];
  registry.subscribe((change) => changes.push(change));
});

describe("SessionRegistry", () => {
  it("crea, actualiza, persiste y avisa los cambios", () => {
    registry.applyHook(hook("SessionStart", { source: "startup" }));
    now += 100;
    registry.applyHook(hook("UserPromptSubmit"));

    expect(registry.list().map((s) => s.state)).toEqual(["working"]);
    expect(store.rows.get("s1:100")?.state).toBe("working");
    expect(changes.map((c) => (c.type === "updated" ? c.session.state : c.type))).toEqual([
      "idle",
      "working",
    ]);
  });

  it("no avisa si un evento no cambia nada", () => {
    registry.applyHook(hook("UserPromptSubmit"));
    registry.applyHook(hook("SessionEnd"));
    changes = [];

    registry.applyHook(hook("SubagentStop", { agentType: "" }));

    expect(changes).toEqual([]);
  });

  it("separa en dos instancias la misma sesión abierta en dos procesos", () => {
    // La extensión de Antigravity retomó una sesión que seguía abierta en Terminal.app (D-010).
    registry.applyHook(hook("UserPromptSubmit"));
    now += 100;
    registry.applyHook(
      hook("SessionStart", {
        pid: 200,
        source: "resume",
        origin: {
          entrypoint: "claude-vscode",
          bundleId: "com.google.antigravity-ide",
          termProgram: null,
        },
      }),
    );
    now += 100;
    registry.applyHook(hook("SessionEnd"));

    expect(registry.list().map((s) => [s.id, s.state, s.origin.kind])).toEqual([
      ["s1:200", "idle", "ide"],
    ]);
  });

  it("recupera las sesiones activas al reiniciar", () => {
    registry.applyHook(hook("UserPromptSubmit"));
    const restarted = new SessionRegistry({ store, now: () => now });

    restarted.load();

    expect(restarted.list().map((s) => s.id)).toEqual(["s1:100"]);
  });

  it("lista los pids que hay que vigilar y termina la sesión si el proceso muere", () => {
    registry.applyHook(hook("UserPromptSubmit"));
    registry.applyHook(hook("UserPromptSubmit", { sessionId: "s2", pid: null }));

    expect(registry.livePids()).toEqual([{ id: "s1:100", pid: 100 }]);

    registry.processExited("s1:100");

    expect(registry.get("s1:100")).toMatchObject({ state: "ended", endReason: "process-exited" });
    expect(registry.list().map((s) => s.id)).toEqual(["s2:hooks"]);
  });

  describe("fuente de respaldo por JSONL", () => {
    const details = { transcriptPath: "/p/s9.jsonl", cwd: "/repo" };

    it("espera un momento antes de crear una sesión solo por su JSONL", () => {
      registry.transcriptActivity("s9", details);
      registry.tick();
      expect(registry.list()).toEqual([]);

      now += 5_000;
      registry.tick();

      expect(registry.list().map((s) => [s.id, s.state, s.source])).toEqual([
        ["s9:transcript", "working", "transcript"],
      ]);
    });

    it("si llega el hook durante la espera, no crea la sesión de respaldo", () => {
      registry.transcriptActivity("s1", details);
      registry.applyHook(hook("UserPromptSubmit"));
      now += 10_000;
      registry.tick();

      expect(registry.list().map((s) => s.id)).toEqual(["s1:100"]);
    });

    it("reemplaza la sesión de respaldo cuando llegan los hooks", () => {
      registry.transcriptActivity("s1", details);
      now += 5_000;
      registry.tick();
      changes = [];

      registry.applyHook(hook("UserPromptSubmit"));

      expect(registry.list().map((s) => s.id)).toEqual(["s1:100"]);
      expect(store.rows.has("s1:transcript")).toBe(false);
      expect(changes[0]).toEqual({ type: "removed", id: "s1:transcript" });
    });

    it("la escritura del JSONL de una sesión recién terminada no la revive", () => {
      registry.applyHook(hook("UserPromptSubmit"));
      registry.applyHook(hook("SessionEnd"));

      registry.transcriptActivity("s1", details);
      now += 10_000;
      registry.tick();

      expect(registry.list()).toEqual([]);
    });

    it("actualiza la última actividad de las sesiones con hooks", () => {
      registry.applyHook(hook("UserPromptSubmit"));
      now += 2_000;

      registry.transcriptActivity("s1", details);

      expect(registry.get("s1:100")?.lastActivityAt).toBe(3_000);
    });
  });

  it("olvida las sesiones terminadas después de un rato", () => {
    registry.applyHook(hook("UserPromptSubmit"));
    registry.applyHook(hook("SessionEnd"));

    now += 10 * 60_000;
    registry.tick();

    expect(registry.get("s1:100")).toBeUndefined();
  });
});
