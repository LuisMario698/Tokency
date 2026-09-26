import { describe, expect, it } from "vitest";

import {
  PROMPT_PREVIEW_LENGTH,
  promptPreview,
  redactSecrets,
  sanitizeHookPayload,
  type SanitizeContext,
} from "./hook-event.ts";
import { hookEventSchema, originKind } from "./schemas.ts";

const context: SanitizeContext = {
  fallbackEvent: "Stop",
  ts: 1_000,
  pid: 42,
  origin: { entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: "Apple_Terminal" },
};

const common = {
  session_id: "s1",
  transcript_path: "/Users/x/.claude/projects/-repo/s1.jsonl",
  cwd: "/repo",
  permission_mode: "auto",
};

describe("sanitizeHookPayload", () => {
  it("copia solo los campos permitidos", () => {
    const event = sanitizeHookPayload(
      {
        ...common,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat .env" },
        tool_response: { stdout: "SECRET=1" },
      },
      context,
    );

    expect(event).toEqual({
      event: "PostToolUse",
      ts: 1_000,
      sessionId: "s1",
      pid: 42,
      origin: context.origin,
      cwd: "/repo",
      transcriptPath: "/Users/x/.claude/projects/-repo/s1.jsonl",
      permissionMode: "auto",
      model: null,
      source: null,
      reason: null,
      notificationType: null,
      toolName: "Bash",
      agentType: null,
      prompt: null,
      backgroundTasks: null,
    });
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(JSON.stringify(event)).not.toContain(".env");
    expect(hookEventSchema.parse(event)).toEqual(event);
  });

  it("nunca copia la respuesta de Claude", () => {
    const event = sanitizeHookPayload(
      {
        ...common,
        hook_event_name: "Stop",
        last_assistant_message: "privado",
        background_tasks: [1, 2],
      },
      context,
    );

    expect(JSON.stringify(event)).not.toContain("privado");
    expect(event?.backgroundTasks).toBe(2);
  });

  it("guarda una vista previa del prompt solo en UserPromptSubmit", () => {
    const submit = sanitizeHookPayload(
      { ...common, hook_event_name: "UserPromptSubmit", prompt: "  arregla\n\nel   bug  " },
      context,
    );
    const other = sanitizeHookPayload(
      { ...common, hook_event_name: "Stop", prompt: "no debería copiarse" },
      context,
    );

    expect(submit?.prompt).toBe("arregla el bug");
    expect(other?.prompt).toBeNull();
  });

  it("conserva un agent_type vacío para reconocer al agente interno", () => {
    const event = sanitizeHookPayload(
      { ...common, hook_event_name: "SubagentStop", agent_type: "" },
      context,
    );

    expect(event?.agentType).toBe("");
  });

  it("usa el evento del argumento si el payload no lo trae", () => {
    expect(sanitizeHookPayload(common, context)?.event).toBe("Stop");
  });

  it("descarta payloads sin session_id, eventos desconocidos o que no son objetos", () => {
    expect(sanitizeHookPayload({ hook_event_name: "Stop" }, context)).toBeNull();
    expect(
      sanitizeHookPayload({ ...common, hook_event_name: "WorktreeCreate" }, context),
    ).toBeNull();
    expect(sanitizeHookPayload(common, { ...context, fallbackEvent: "Otro" })).toBeNull();
    expect(sanitizeHookPayload(null, context)).toBeNull();
    expect(sanitizeHookPayload([common], context)).toBeNull();
  });

  it("recorta campos de texto demasiado largos", () => {
    const event = sanitizeHookPayload({ ...common, cwd: "x".repeat(10_000) }, context);

    expect(event?.cwd).toHaveLength(4096);
  });
});

describe("promptPreview", () => {
  it("recorta a la longitud máxima con puntos suspensivos", () => {
    const preview = promptPreview("palabra ".repeat(100));

    expect(preview.length).toBeLessThanOrEqual(PROMPT_PREVIEW_LENGTH);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("redactSecrets", () => {
  it.each([
    ["sk-ant-api03-abcdefghijklmnopqrstuv"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123"],
    ["github_pat_11ABCDEFGHIJKLMNOPQRSTUV"],
    ["xoxb-1234567890-abcdef"],
    ["AKIAABCDEFGHIJKLMNOP"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop"],
  ])("tapa %s", (secret) => {
    expect(redactSecrets(`usa ${secret} por favor`)).toBe("usa [secreto] por favor");
  });

  it("deja el texto normal intacto", () => {
    expect(redactSecrets("revisa skills y ghost_mode")).toBe("revisa skills y ghost_mode");
  });
});

describe("originKind", () => {
  it("clasifica los puntos de entrada conocidos", () => {
    expect(originKind("cli")).toBe("cli");
    expect(originKind("claude-vscode")).toBe("ide");
    expect(originKind("claude-desktop")).toBe("desktop");
    expect(originKind("sdk-ts")).toBe("unknown");
    expect(originKind(null)).toBe("unknown");
  });
});
