import { mergeOwnHooks, removeOwnHooks } from "@tokency/core";
import type { Session } from "@tokency/shared";
import { describe, expect, it, vi } from "vitest";

import { installedTokencyHooks, nodeFromCommand } from "./commands/doctor.ts";
import { buildHookEvent, claudePid, runHook, type HookDeps } from "./commands/hook.ts";
import { elapsed, formatSession } from "./commands/status.ts";
import { bar, compactTokens, money, summaryLines } from "./commands/usage.ts";
import {
  isTokencyHook,
  nodeVersionOk,
  stableNodePath,
  tokencyHooks,
  wrapperScript,
} from "./install/plan.ts";

const ENTRY = "/Users/x/Library/Application Support/Tokency/app/tokency.mjs";
const NODE = "/opt/homebrew/opt/node/bin/node";

describe("plan de instalación", () => {
  it("usa el enlace estable de Homebrew en lugar de la ruta versionada", () => {
    const exists = (file: string) => file === NODE;

    expect(stableNodePath("/opt/homebrew/Cellar/node/26.3.1/bin/node", exists)).toBe(NODE);
    expect(stableNodePath("/opt/homebrew/Cellar/node@24/24.17.0/bin/node", () => true)).toBe(
      "/opt/homebrew/opt/node@24/bin/node",
    );
    expect(stableNodePath("/opt/homebrew/Cellar/node/26.3.1/bin/node", () => false)).toBe(
      "/opt/homebrew/Cellar/node/26.3.1/bin/node",
    );
    const nvm = "/Users/x/.nvm/versions/node/v24.17.0/bin/node";
    expect(stableNodePath(nvm, () => true)).toBe(nvm);
  });

  it.each([
    ["24.15.0", true],
    ["v24.17.0", true],
    ["26.3.1", true],
    ["24.14.9", false],
    ["22.20.0", false],
  ])("Node %s cumple el mínimo: %s", (version, ok) => {
    expect(nodeVersionOk(version)).toBe(ok);
  });

  it("solo SessionStart es síncrono; el resto corre en segundo plano", () => {
    const hooks = tokencyHooks(NODE, ENTRY);

    expect(hooks.SessionStart).toEqual([
      {
        hooks: [{ type: "command", command: `'${NODE}' '${ENTRY}' hook SessionStart`, timeout: 5 }],
      },
    ]);
    expect(hooks.Stop).toEqual([
      {
        hooks: [
          { type: "command", command: `'${NODE}' '${ENTRY}' hook Stop`, timeout: 10, async: true },
        ],
      },
    ]);
    expect(Object.keys(hooks)).toHaveLength(11);
  });

  it("sus hooks se reconocen para desinstalarlos sin tocar los del usuario", () => {
    const user = { hooks: { Stop: [{ hooks: [{ type: "command", command: "~/bin/mio.sh" }] }] } };

    const merged = mergeOwnHooks(user, tokencyHooks(NODE, ENTRY), isTokencyHook);

    expect(removeOwnHooks(merged, isTokencyHook)).toEqual({ settings: user, removed: 11 });
  });

  it("el envoltorio ejecuta el bundle instalado con el node elegido", () => {
    expect(wrapperScript(NODE, ENTRY)).toBe(
      `#!/bin/sh\n# Generado por \`tokency install\`. Se reemplaza al reinstalar.\nexec '${NODE}' '${ENTRY}' "$@"\n`,
    );
  });
});

function deps(
  overrides: Partial<HookDeps> = {},
): HookDeps & { posted: string[]; errors: string[] } {
  const posted: string[] = [];
  const errors: string[] = [];
  return {
    posted,
    errors,
    readStdin: () =>
      Promise.resolve(
        JSON.stringify({ session_id: "s1", hook_event_name: "Stop", last_assistant_message: "x" }),
      ),
    readToken: () => Promise.resolve("token"),
    readPort: () => 7777,
    post: (url, token, body) => {
      posted.push(`${url} ${token} ${body}`);
      return Promise.resolve();
    },
    logError: (message) => errors.push(message),
    env: {
      CLAUDE_PID: "321",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      __CFBundleIdentifier: "com.apple.Terminal",
      CLAUDE_PROJECT_DIR: "/Users/x/Developer/Tokency",
    },
    ppid: 99,
    now: () => 1_234,
    ...overrides,
  };
}

describe("tokency hook", () => {
  it("reenvía el evento saneado al core", async () => {
    const d = deps();

    await runHook("Stop", d);

    expect(d.posted).toHaveLength(1);
    const [url, token, body] = (d.posted[0] ?? "").split(" ");
    expect(url).toBe("http://127.0.0.1:7777/v1/hooks");
    expect(token).toBe("token");
    expect(JSON.parse(body ?? "")).toMatchObject({
      event: "Stop",
      ts: 1_234,
      sessionId: "s1",
      pid: 321,
      projectDir: "/Users/x/Developer/Tokency",
      origin: { entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: null },
    });
    expect(body).not.toContain("last_assistant_message");
  });

  it("nunca lanza ni escribe en stdout, aunque todo falle", async () => {
    const write = vi.spyOn(process.stdout, "write");
    const failures: Partial<HookDeps>[] = [
      { readStdin: () => Promise.reject(new Error("stdin roto")) },
      { readToken: () => Promise.reject(new Error("Llavero bloqueado")) },
      { readToken: () => Promise.resolve(null) },
      { post: () => Promise.reject(new Error("ECONNREFUSED")) },
      { readStdin: () => Promise.resolve("no es json") },
    ];

    for (const failure of failures) {
      const d = deps(failure);
      await expect(runHook("Stop", d)).resolves.toBeUndefined();
    }

    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("anota los errores para poder diagnosticarlos", async () => {
    const d = deps({ post: () => Promise.reject(new Error("ECONNREFUSED")) });

    await runHook("Stop", d);

    expect(d.errors).toEqual(["ECONNREFUSED"]);
  });

  it("no envía nada si el payload no sirve", async () => {
    const d = deps({ readStdin: () => Promise.resolve("{}") });

    await runHook("Stop", d);

    expect(d.posted).toEqual([]);
    expect(d.errors).toEqual([]);
  });

  it("toma el pid de claude de CLAUDE_PID o, si falta, del proceso padre", () => {
    expect(claudePid({ CLAUDE_PID: "500" }, 99)).toBe(500);
    expect(claudePid({ CLAUDE_PID: "x" }, 99)).toBe(99);
    expect(claudePid({}, 1)).toBeNull();
    expect(buildHookEvent("Stop", '{"session_id":"s"}', { env: {}, ppid: 7 }, 0)?.pid).toBe(7);
  });
});

describe("tokency doctor", () => {
  it("encuentra los hooks de Tokency y el node que usan", () => {
    const settings = mergeOwnHooks({}, tokencyHooks(NODE, ENTRY), isTokencyHook);

    const found = installedTokencyHooks(settings);

    expect(found.size).toBe(11);
    expect(nodeFromCommand(found.get("Stop") ?? "")).toBe(NODE);
    expect(installedTokencyHooks(null).size).toBe(0);
    expect(installedTokencyHooks({ hooks: { Stop: "raro" } }).size).toBe(0);
  });
});

describe("tokency status", () => {
  it("muestra el tiempo transcurrido de forma legible", () => {
    expect(elapsed(30_000)).toBe("<1 min");
    expect(elapsed(5 * 60_000)).toBe("5 min");
    expect(elapsed(125 * 60_000)).toBe("2 h 5 min");
  });

  it("resume una sesión en una línea", () => {
    const session = {
      state: "waiting",
      projectName: "Tokency",
      origin: { kind: "cli", entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: null },
      startedAt: 0,
      lastPrompt: "crea el archivo",
    } as Session;

    expect(formatSession(session, 10 * 60_000)).toBe(
      "🟠 esperando  Tokency · com.apple.Terminal · 10 min · «crea el archivo»",
    );
  });
});

describe("tokency usage", () => {
  it("formatea montos, tokens y barras", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(compactTokens(950)).toBe("950");
    expect(compactTokens(12_300)).toBe("12.3 mil");
    expect(compactTokens(3_400_000)).toBe("3.4 M");
    expect(bar(0.5, 10)).toBe("█████░░░░░");
    expect(bar(2, 4)).toBe("████");
  });

  it("explica la ventana vigente, la cercanía al tope y el último límite", () => {
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 2_000_000,
      cost: 25,
      unpricedTokens: 0,
      messages: 10,
    };
    const lines = summaryLines({
      generatedAt: 0,
      timeZone: "UTC",
      window: {
        start: Date.UTC(2026, 8, 26, 10),
        end: Date.UTC(2026, 8, 26, 15),
        resetsInMs: 90 * 60_000,
        totals,
        costByModel: {},
        burnRatePerHour: 12.5,
        projectedCost: 43.75,
        fractionOfCap: 0.5,
        anchored: false,
      },
      today: totals,
      last7Days: totals,
      calibration: {
        estimatedCap: 50,
        samples: 2,
        lastLimit: {
          at: Date.UTC(2026, 8, 25, 6),
          resetsAt: Date.UTC(2026, 8, 25, 9),
          kind: "session",
          source: "transcript",
        },
      },
      sessions: {},
      unpricedModels: ["modelo-x"],
      firstEntryAt: 0,
    });

    expect(lines[0]).toContain("se reinicia en 1 h 30 min");
    expect(lines[1]).toContain("50 % del tope estimado ($50.00, 2 muestras)");
    expect(lines[2]).toBe("  ritmo $12.50/h · proyección al cierre $43.75");
    expect(lines.some((l) => l.startsWith("Último límite alcanzado"))).toBe(true);
    expect(lines.at(-1)).toContain("modelo-x");
  });
});
