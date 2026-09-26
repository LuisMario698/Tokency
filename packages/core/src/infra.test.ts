import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HookEvent, Session } from "@tokency/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, sessionTimings } from "./config.ts";
import { openDatabase, schemaVersion } from "./db/database.ts";
import { MIGRATIONS } from "./db/migrations.ts";
import { SessionRepository } from "./db/session-repository.ts";
import { addPasswordCommand } from "./keychain.ts";
import { renderLaunchAgentPlist } from "./launch-agent.ts";
import { createFileLogger, silentLogger } from "./logger.ts";
import { LAUNCH_AGENT_LABEL, tokencyPaths } from "./paths.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tokency-core-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("tokencyPaths", () => {
  it("ubica todo en las carpetas estándar de macOS", () => {
    const paths = tokencyPaths("/Users/x", {});

    expect(paths).toMatchObject({
      appDir: "/Users/x/Library/Application Support/Tokency/app",
      dbFile: "/Users/x/Library/Application Support/Tokency/tokency.db",
      logsDir: "/Users/x/Library/Logs/Tokency",
      launchAgentPlist: "/Users/x/Library/LaunchAgents/com.tokency.core.plist",
      claudeProjectsDir: "/Users/x/.claude/projects",
      cliWrapper: "/Users/x/.local/bin/tokency",
    });
    expect(tokencyPaths("/Users/x", { CLAUDE_CONFIG_DIR: "/cc" }).claudeSettingsFile).toBe(
      "/cc/settings.json",
    );
  });
});

describe("loadConfig", () => {
  it("usa los valores por defecto si no hay archivo", () => {
    const { config, warnings } = loadConfig(path.join(dir, "no-existe.json"));

    expect(config).toEqual({
      port: 7777,
      logLevel: "info",
      sessions: { doneToIdleMinutes: 15, endAfterInactiveMinutes: 60 },
    });
    expect(warnings).toEqual([]);
  });

  it("combina lo que el usuario cambió con los valores por defecto", async () => {
    const file = path.join(dir, "config.json");
    await writeFile(file, JSON.stringify({ port: 8123, sessions: { doneToIdleMinutes: 5 } }));

    const { config } = loadConfig(file);

    expect(config.port).toBe(8123);
    expect(sessionTimings(config)).toEqual({
      doneToIdleMs: 300_000,
      endAfterInactiveMs: 3_600_000,
      transcriptIdleMs: 15_000,
    });
  });

  it("avisa y usa los valores por defecto si el archivo es inválido", async () => {
    const file = path.join(dir, "config.json");
    await writeFile(file, JSON.stringify({ port: 80 }));

    const { config, warnings } = loadConfig(file);

    expect(config.port).toBe(7777);
    expect(warnings[0]).toMatch(/port/);
  });
});

describe("createFileLogger", () => {
  it("escribe líneas JSON y rota por tamaño", async () => {
    const file = path.join(dir, "logs", "core.log");
    const logger = createFileLogger({ file, maxBytes: 200, keep: 2, level: "info" });

    logger.debug("no se escribe");
    for (let i = 0; i < 10; i++) logger.info("evento", { i, error: new Error("falla") });

    const names = (await readdir(path.dirname(file))).sort();
    expect(names).toEqual(["core.1.log", "core.2.log", "core.log"]);
    const [line] = (await readFile(file, "utf8")).trim().split("\n");
    expect(JSON.parse(line ?? "")).toMatchObject({
      level: "info",
      message: "evento",
      error: { name: "Error", message: "falla" },
    });
  });
});

function session(id: string, state: Session["state"]): Session {
  return {
    id,
    sessionId: id.split(":")[0] ?? id,
    pid: 1,
    state,
    source: "hooks",
    origin: { kind: "cli", entrypoint: "cli", bundleId: null, termProgram: null },
    cwd: "/repo",
    projectName: "repo",
    transcriptPath: null,
    model: null,
    permissionMode: null,
    lastPrompt: "hola",
    startedAt: 1,
    stateChangedAt: 1,
    lastActivityAt: 1,
    lastEventTs: 1,
    endedAt: state === "ended" ? 2 : null,
    endReason: state === "ended" ? "session-end" : null,
  };
}

describe("base local", () => {
  it("aplica las migraciones una sola vez", () => {
    const file = path.join(dir, "data", "tokency.db");
    openDatabase(file).close();
    const db = openDatabase(file);

    expect(schemaVersion(db)).toBe(MIGRATIONS.at(-1)?.version);
    db.close();
  });

  it("guarda, actualiza y recupera las sesiones activas", () => {
    const db = openDatabase(":memory:");
    const repo = new SessionRepository(db, silentLogger);

    repo.save(session("a:1", "working"));
    repo.save(session("b:1", "working"));
    repo.save({ ...session("b:1", "ended") });
    repo.save(session("c:1", "done"));
    repo.remove("c:1");

    expect(repo.loadActive()).toEqual([session("a:1", "working")]);
  });

  it("descarta sesiones guardadas con un formato que ya no encaja", () => {
    const db = openDatabase(":memory:");
    const repo = new SessionRepository(db, silentLogger);
    db.prepare(
      "INSERT INTO sessions (id, session_id, state, started_at, last_activity_at, data) VALUES ('x', 'x', 'working', 1, 1, '{}')",
    ).run();

    expect(repo.loadActive()).toEqual([]);
  });

  it("registra eventos sin el prompt y poda los viejos", () => {
    const db = openDatabase(":memory:");
    const repo = new SessionRepository(db, silentLogger);
    const event = {
      event: "UserPromptSubmit",
      ts: 5,
      sessionId: "a",
      pid: 1,
      origin: { entrypoint: "cli", bundleId: null, termProgram: null },
      prompt: "secreto del prompt",
      toolName: null,
      source: null,
      reason: null,
      notificationType: null,
      agentType: null,
      permissionMode: "auto",
    } as HookEvent;

    repo.recordHookEvent("a:1", event, 100);
    repo.recordHookEvent("a:1", event, 200);

    const rows = db.prepare("SELECT detail FROM hook_events").all();
    expect(JSON.stringify(rows)).not.toContain("secreto");
    expect(repo.lastHookEventAt()).toBe(200);
    expect(repo.pruneHookEvents(150)).toBe(1);
  });
});

describe("addPasswordCommand", () => {
  it("arma el comando para el modo interactivo de security", () => {
    expect(
      addPasswordCommand({ service: "com.tokency.core", account: "api-token" }, "abc123"),
    ).toBe('add-generic-password -a "api-token" -s "com.tokency.core" -w "abc123" -U\n');
  });

  it.each([['con"comilla'], ["con espacio"], ["con\\barra"], ["con\nsalto"], [""]])(
    "rechaza valores que romperían el comando (%j)",
    (value) => {
      expect(() => addPasswordCommand({ service: "s", account: "a" }, value)).toThrow();
    },
  );
});

describe("renderLaunchAgentPlist", () => {
  const plist = renderLaunchAgentPlist({
    label: LAUNCH_AGENT_LABEL,
    programArguments: [
      "/opt/homebrew/opt/node/bin/node",
      "/Users/x/Library/Application Support/Tokency/app/tokency.mjs",
      "serve",
    ],
    workingDirectory: "/Users/x/Library/Application Support/Tokency/app",
    stdoutPath: "/Users/x/Library/Logs/Tokency/core.stdout.log",
    stderrPath: "/Users/x/Library/Logs/Tokency/core.stderr.log",
    environment: { TOKENCY_LAUNCHD: "1", RARO: "a<b&c" },
  });

  it("incluye el arranque automático y escapa el XML", () => {
    expect(plist).toContain("<string>com.tokency.core</string>");
    expect(plist).toContain("<key>KeepAlive</key>\n\t<true/>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>a&lt;b&amp;c</string>");
  });

  it.runIf(process.platform === "darwin")("es un plist válido para plutil", async () => {
    const file = path.join(dir, "agent.plist");
    await writeFile(file, plist);

    const result = spawnSync("/usr/bin/plutil", ["-lint", file], { encoding: "utf8" });

    expect(result.stdout).toContain("OK");
  });
});
