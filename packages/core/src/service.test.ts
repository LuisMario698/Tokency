import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import type { HookEvent, Session } from "@tokency/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { silentLogger } from "./logger.ts";
import { tokencyPaths, type TokencyPaths } from "./paths.ts";
import { startCore, type RunningCore } from "./service.ts";
import { isProcessAlive } from "./watchers/processes.ts";
import { readTranscriptCwd, sessionIdFromPath, watchTranscripts } from "./watchers/transcripts.ts";

const UUID = "4ad59146-8d64-4d16-917f-77093d0431a0";
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tokency-service-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sessionIdFromPath", () => {
  it("reconoce solo `<proyecto>/<uuid>.jsonl`", () => {
    expect(sessionIdFromPath(`-Users-x-repo/${UUID}.jsonl`)).toBe(UUID);
    expect(sessionIdFromPath(`-Users-x-repo/${UUID}/subagents/agent-a1.jsonl`)).toBeNull();
    expect(sessionIdFromPath(`${UUID}.jsonl`)).toBeNull();
    expect(sessionIdFromPath("-Users-x-repo/notas.jsonl")).toBeNull();
    expect(sessionIdFromPath(`-Users-x-repo/${UUID}.json`)).toBeNull();
  });
});

describe("readTranscriptCwd", () => {
  it("toma el cwd más reciente del final del archivo", async () => {
    const file = path.join(dir, "t.jsonl");
    const lines = [
      { type: "queue-operation" },
      { type: "user", cwd: "/Users/x/viejo" },
      { type: "assistant", cwd: "/Users/x/nuevo" },
      { type: "summary" },
    ];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    expect(await readTranscriptCwd(file)).toBe("/Users/x/nuevo");
    expect(await readTranscriptCwd(path.join(dir, "no-existe.jsonl"))).toBeNull();
  });
});

describe("isProcessAlive", () => {
  it("distingue procesos vivos de terminados", async () => {
    const child = spawn(process.execPath, ["-e", ""]);
    await new Promise((resolve) => child.on("exit", resolve));

    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(child.pid ?? 0)).toBe(false);
  });
});

describe("watchTranscripts", () => {
  it("avisa cuando crece el JSONL de una sesión, con su cwd", async () => {
    const projects = path.join(dir, "projects");
    const project = path.join(projects, "-Users-x-repo");
    await mkdir(project, { recursive: true });
    const seen: string[] = [];
    const watcher = watchTranscripts({
      projectsDir: projects,
      logger: silentLogger,
      throttleMs: 0,
      onActivity: ({ sessionId, cwd }) => seen.push(`${sessionId} ${String(cwd)}`),
    });

    const transcript = path.join(project, `${UUID}.jsonl`);
    await writeFile(path.join(project, "otro.txt"), "x");

    // FSEvents tarda un momento en activarse: se sigue escribiendo, como hace Claude Code.
    await vi.waitFor(
      async () => {
        await appendFile(transcript, `${JSON.stringify({ cwd: "/Users/x/repo" })}\n`);
        expect(seen).toContain(`${UUID} /Users/x/repo`);
      },
      { timeout: 5_000, interval: 100 },
    );
    expect(seen.every((line) => line.startsWith(UUID))).toBe(true);
    watcher.close();
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return typeof address === "object" && address !== null ? address.port : 0;
}

describe("startCore", () => {
  let core: RunningCore | undefined;
  let paths: TokencyPaths;
  const token = "t".repeat(64);

  beforeEach(() => {
    paths = { ...tokencyPaths(dir, {}), claudeProjectsDir: path.join(dir, "projects") };
  });

  afterEach(async () => {
    await core?.close();
    core = undefined;
  });

  it("recibe hooks por HTTP, persiste y sobrevive a un reinicio", async () => {
    const port = await freePort();
    const alive = new Set([4242]);
    const options = {
      paths,
      version: "test",
      token,
      port,
      logger: silentLogger,
      isAlive: (pid: number) => alive.has(pid),
    };
    core = await startCore(options);
    const headers = {
      host: `127.0.0.1:${String(port)}`,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const event: HookEvent = {
      event: "UserPromptSubmit",
      ts: Date.now(),
      sessionId: UUID,
      pid: 4242,
      origin: { entrypoint: "cli", bundleId: "com.apple.Terminal", termProgram: "Apple_Terminal" },
      cwd: "/Users/x/repo",
      transcriptPath: null,
      permissionMode: "default",
      model: null,
      source: null,
      reason: null,
      notificationType: null,
      toolName: null,
      agentType: null,
      prompt: "hola",
      backgroundTasks: null,
    };

    const posted = await fetch(`http://127.0.0.1:${String(port)}/v1/hooks`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    expect(posted.status).toBe(202);

    await core.close();
    core = await startCore(options);
    const listed = await fetch(`http://127.0.0.1:${String(port)}/v1/sessions`, { headers });
    const { sessions } = (await listed.json()) as { sessions: Session[] };
    expect(sessions.map((s) => [s.id, s.state, s.projectName])).toEqual([
      [`${UUID}:4242`, "working", "repo"],
    ]);
  });

  it("vigila los JSONL de la carpeta de proyectos", async () => {
    const project = path.join(paths.claudeProjectsDir, "-Users-x-repo");
    await mkdir(project, { recursive: true });
    core = await startCore({
      paths,
      version: "test",
      token,
      port: await freePort(),
      logger: silentLogger,
    });

    // La sesión de respaldo aparece tras el periodo de gracia, en el mantenimiento periódico.
    await vi.waitFor(
      async () => {
        await appendFile(path.join(project, `${UUID}.jsonl`), "{}\n");
        expect(core?.registry.list().map((s) => s.source)).toEqual(["transcript"]);
      },
      { timeout: 15_000, interval: 250 },
    );
  }, 20_000);
});
