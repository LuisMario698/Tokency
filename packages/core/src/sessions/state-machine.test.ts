import type { HookEvent, HookEventName, Session } from "@tokency/shared";
import { describe, expect, it } from "vitest";

import {
  applyHookEvent,
  applyProcessExit,
  applyTick,
  applyTranscriptActivity,
  createTranscriptSession,
  DEFAULT_TIMINGS,
} from "./state-machine.ts";

let clock = 1_000;

function hook(event: HookEventName, extra: Partial<HookEvent> = {}): HookEvent {
  clock += 10;
  return {
    event,
    ts: clock,
    sessionId: "s1",
    pid: 100,
    origin: { entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: "Apple_Terminal" },
    cwd: "/Users/x/Developer/Tokency",
    projectDir: "/Users/x/Developer/Tokency",
    transcriptPath: "/Users/x/.claude/projects/-Users-x-Developer-Tokency/s1.jsonl",
    permissionMode: "default",
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

function run(...events: HookEvent[]): Session | undefined {
  return events.reduce<Session | undefined>(
    (session, event) => applyHookEvent(session, event, event.ts),
    undefined,
  );
}

describe("applyHookEvent", () => {
  it("crea la sesión con su origen y proyecto", () => {
    const session = run(hook("SessionStart", { source: "startup", model: "claude-opus-5-5" }));

    expect(session).toMatchObject({
      id: "s1:100",
      sessionId: "s1",
      pid: 100,
      state: "idle",
      source: "hooks",
      origin: { kind: "cli", bundleId: "com.apple.Terminal" },
      projectName: "Tokency",
      model: "claude-opus-5-5",
      endedAt: null,
    });
  });

  it("sigue el ciclo de un turno con permiso", () => {
    const states = [
      hook("SessionStart", { source: "startup" }),
      hook("UserPromptSubmit", { prompt: "crea el archivo" }),
      hook("PreToolUse", { toolName: "Write" }),
      hook("PermissionRequest", { toolName: "Write" }),
      hook("PostToolUse", { toolName: "Write" }),
      hook("Stop"),
      hook("SubagentStop", { agentType: "" }),
      hook("Notification", { notificationType: "idle_prompt" }),
      hook("SessionEnd", { reason: "prompt_input_exit" }),
    ].reduce<{ session: Session | undefined; states: string[] }>(
      ({ session, states: acc }, event) => {
        const next = applyHookEvent(session, event, event.ts);
        return { session: next, states: [...acc, next?.state ?? "-"] };
      },
      { session: undefined, states: [] },
    ).states;

    expect(states).toEqual([
      "idle",
      "working",
      "working",
      "waiting",
      "working",
      "done",
      "done",
      "done",
      "ended",
    ]);
  });

  it("guarda la vista previa del último prompt", () => {
    const session = run(
      hook("UserPromptSubmit", { prompt: "primero" }),
      hook("Stop"),
      hook("UserPromptSubmit", { prompt: "segundo" }),
    );

    expect(session?.lastPrompt).toBe("segundo");
  });

  it.each([
    ["AskUserQuestion", "waiting"],
    ["ExitPlanMode", "waiting"],
    ["Bash", "working"],
  ])("PreToolUse de %s deja la sesión en %s", (toolName, state) => {
    expect(run(hook("UserPromptSubmit"), hook("PreToolUse", { toolName }))?.state).toBe(state);
  });

  it.each([
    ["permission_prompt", "waiting"],
    ["elicitation_dialog", "waiting"],
    ["auth_success", "working"],
  ])("Notification %s deja la sesión en %s", (notificationType, state) => {
    expect(run(hook("UserPromptSubmit"), hook("Notification", { notificationType }))?.state).toBe(
      state,
    );
  });

  it("SessionStart por compactación sigue trabajando", () => {
    expect(run(hook("UserPromptSubmit"), hook("SessionStart", { source: "compact" }))?.state).toBe(
      "working",
    );
  });

  it("crea la sesión aunque el primer evento no sea SessionStart", () => {
    // Sesiones abiertas antes de instalar los hooks (D-010).
    expect(run(hook("PreToolUse", { toolName: "Bash" }))?.state).toBe("working");
  });

  it("ignora el cierre de una sesión desconocida", () => {
    expect(run(hook("SessionEnd"))).toBeUndefined();
  });

  it("un evento atrasado completa datos pero no cambia el estado", () => {
    const prompt = hook("UserPromptSubmit");
    const post = hook("PostToolUse", { toolName: "Bash" });
    const stop = hook("Stop");
    const done = run(prompt, stop);

    const late = applyHookEvent(done, { ...post, model: "claude-opus-5-5" }, stop.ts + 5);

    expect(late?.state).toBe("done");
    expect(late?.model).toBe("claude-opus-5-5");
    expect(late?.lastEventTs).toBe(stop.ts);
  });

  it("después de terminar ignora eventos rezagados", () => {
    const ended = run(hook("UserPromptSubmit"), hook("SessionEnd"));

    expect(applyHookEvent(ended, hook("SubagentStop", { agentType: "" }), clock)).toBe(ended);
  });

  it("un prompt nuevo reabre una sesión terminada", () => {
    const ended = run(hook("UserPromptSubmit"), hook("SessionEnd"));

    const revived = applyHookEvent(ended, hook("UserPromptSubmit"), clock);

    expect(revived).toMatchObject({ state: "working", endedAt: null, endReason: null });
  });

  it("registra el motivo y la hora del cierre", () => {
    const prompt = hook("UserPromptSubmit");
    const end = hook("SessionEnd");

    expect(run(prompt, end)).toMatchObject({
      state: "ended",
      endReason: "session-end",
      endedAt: end.ts,
    });
  });
});

describe("applyTick", () => {
  const timings = DEFAULT_TIMINGS;

  it("pasa de done a idle después del umbral", () => {
    const done = run(hook("UserPromptSubmit"), hook("Stop"));
    if (done === undefined) throw new Error("sin sesión");

    expect(applyTick(done, done.stateChangedAt + timings.doneToIdleMs - 1, timings)).toBe(done);
    expect(applyTick(done, done.stateChangedAt + timings.doneToIdleMs, timings).state).toBe("idle");
  });

  it("termina la sesión tras el tiempo de inactividad", () => {
    const waiting = run(hook("PermissionRequest"));
    if (waiting === undefined) throw new Error("sin sesión");

    const ended = applyTick(waiting, waiting.lastActivityAt + timings.endAfterInactiveMs, timings);

    expect(ended).toMatchObject({ state: "ended", endReason: "inactivity" });
  });

  it("no toca sesiones terminadas ni recién activas", () => {
    const working = run(hook("UserPromptSubmit"));
    const ended = run(hook("UserPromptSubmit"), hook("SessionEnd"));
    if (working === undefined || ended === undefined) throw new Error("sin sesión");

    expect(applyTick(working, working.lastActivityAt + 1_000, timings)).toBe(working);
    expect(applyTick(ended, ended.lastActivityAt + timings.endAfterInactiveMs * 2, timings)).toBe(
      ended,
    );
  });
});

describe("sesiones vistas solo por su JSONL", () => {
  const details = { transcriptPath: "/p/s9.jsonl", cwd: "/Users/x/repo" };

  it("empiezan trabajando y pasan a idle cuando el archivo deja de crecer", () => {
    const session = createTranscriptSession("s9", details, 0);

    expect(session).toMatchObject({
      id: "s9:transcript",
      state: "working",
      source: "transcript",
      projectName: "repo",
    });
    const quiet = applyTick(session, DEFAULT_TIMINGS.transcriptIdleMs, DEFAULT_TIMINGS);
    expect(quiet.state).toBe("idle");
    expect(applyTranscriptActivity(quiet, DEFAULT_TIMINGS.transcriptIdleMs + 1).state).toBe(
      "working",
    );
  });

  it("la actividad del JSONL no cambia el estado de una sesión con hooks", () => {
    const done = run(hook("UserPromptSubmit"), hook("Stop"));
    if (done === undefined) throw new Error("sin sesión");

    const touched = applyTranscriptActivity(done, done.lastActivityAt + 500);

    expect(touched.state).toBe("done");
    expect(touched.lastActivityAt).toBe(done.lastActivityAt + 500);
  });
});

describe("applyProcessExit", () => {
  it("termina la sesión cuando muere el proceso", () => {
    const working = run(hook("UserPromptSubmit"));
    if (working === undefined) throw new Error("sin sesión");

    expect(applyProcessExit(working, 9_999)).toMatchObject({
      state: "ended",
      endReason: "process-exited",
      endedAt: 9_999,
    });
  });
});
