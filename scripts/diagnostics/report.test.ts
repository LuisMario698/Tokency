import { describe, expect, it } from "vitest";

import { parseMeta, summarize, type Capture } from "./report.ts";

const meta = parseMeta(
  [
    "captured_at=2026-09-25T12:00:00Z",
    "event_arg=SessionStart",
    "pid=10",
    "parent.0=9 /bin/sh",
    "parent.1=8 /opt/claude",
    "parent.2=7 /bin/zsh",
    "env.TERM_PROGRAM=Apple_Terminal",
    "env.CLAUDE_CODE_ENTRYPOINT=cli",
    "env.PATH=/usr/bin:/bin",
    "env_name=TERM_PROGRAM",
    "env_name=CLAUDECODE",
    "env_name=HOME",
    "",
  ].join("\n"),
);

function capture(at: number, payload: Capture["payload"]): Capture {
  return { name: `c${at}`, capturedAt: Date.UTC(2026, 8, 25, 12, 0, at), meta, payload };
}

const base = { session_id: "s1", cwd: "/repo", transcript_path: "/t/s1.jsonl" };

describe("parseMeta", () => {
  it("separa procesos padre, valores y nombres de variables", () => {
    expect(meta).toEqual({
      eventArg: "SessionStart",
      parents: ["9 /bin/sh", "8 /opt/claude", "7 /bin/zsh"],
      env: { TERM_PROGRAM: "Apple_Terminal", CLAUDE_CODE_ENTRYPOINT: "cli", PATH: "/usr/bin:/bin" },
      envNames: ["TERM_PROGRAM", "CLAUDECODE", "HOME"],
    });
  });
});

describe("summarize", () => {
  const captures = [
    capture(0, { ...base, hook_event_name: "SessionStart", source: "startup" }),
    capture(1, { ...base, hook_event_name: "UserPromptSubmit", prompt: "mi prompt secreto" }),
    capture(2, {
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "cat .env" },
    }),
    capture(3, { ...base, hook_event_name: "PreToolUse", tool_name: "Bash" }),
    capture(4, { ...base, hook_event_name: "Stop", last_assistant_message: "respuesta privada" }),
    capture(5, null),
  ];

  const report = summarize(captures, (file) => file === "/t/s1.jsonl");

  it("nunca incluye el contenido de prompts, respuestas ni herramientas", () => {
    expect(report).not.toContain("mi prompt secreto");
    expect(report).not.toContain("respuesta privada");
    expect(report).not.toContain("cat .env");
  });

  it("resume la secuencia de eventos con los valores descriptivos", () => {
    expect(report).toContain(
      "- eventos: SessionStart[source=startup] → UserPromptSubmit → PreToolUse[tool_name=Bash] ×2 → Stop",
    );
    expect(report).toContain(
      "  - UserPromptSubmit: session_id, cwd, transcript_path, hook_event_name, prompt",
    );
  });

  it("muestra origen, rutas y si existe el transcript", () => {
    expect(report).toContain("- cwd: /repo");
    expect(report).toContain("- transcript_path: /t/s1.jsonl (existe: sí)");
    expect(report).toContain("- entorno: TERM_PROGRAM=Apple_Terminal · CLAUDE_CODE_ENTRYPOINT=cli");
    expect(report).toContain("- procesos padre: /bin/sh ← /opt/claude ← /bin/zsh");
    expect(report).toContain("(2 de 3): CLAUDECODE, TERM_PROGRAM");
  });

  it("agrupa aparte los payloads que no son JSON", () => {
    expect(report).toContain("6 capturas en 2 sesiones.");
    expect(report).toContain("## Sesión (sin session_id) (1 eventos");
    expect(report).toContain("⚠️ 1 payloads vacíos o que no son JSON");
  });

  it("avisa si no hay capturas", () => {
    expect(summarize([], () => false)).toBe("No hay capturas.\n");
  });
});
