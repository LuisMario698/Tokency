import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DIAGNOSTIC_EVENTS, diagnosticHooks, isDiagnosticHook } from "./diag-hooks.ts";

const script = fileURLToPath(new URL("capture-hook.sh", import.meta.url));

describe("diagnosticHooks", () => {
  it("registra un comando con tiempo límite por cada evento de observación", () => {
    const hooks = diagnosticHooks(script);

    expect(Object.keys(hooks)).toEqual([...DIAGNOSTIC_EVENTS]);
    for (const [event, groups] of Object.entries(hooks)) {
      expect(groups).toEqual([
        { hooks: [{ type: "command", command: `/bin/sh '${script}' ${event}`, timeout: 5 }] },
      ]);
    }
  });

  it("reconoce sus propios hooks aunque la ruta tenga espacios o comillas", () => {
    const odd = "/Users/x/Mis Repos/it's/Tokency/scripts/diagnostics/capture-hook.sh";
    const [group] = diagnosticHooks(odd).Stop ?? [];
    const command = group?.hooks[0]?.command ?? "";

    expect(command).toBe(
      `/bin/sh '/Users/x/Mis Repos/it'\\''s/Tokency/scripts/diagnostics/capture-hook.sh' Stop`,
    );
    expect(isDiagnosticHook({ type: "command", command })).toBe(true);
    expect(isDiagnosticHook({ type: "command", command: "/usr/local/bin/otro" })).toBe(false);
  });
});

describe("capture-hook.sh", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "tokency-diag-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  function run(input: string, env: NodeJS.ProcessEnv = { HOME: home }) {
    return spawnSync("/bin/sh", [script, "UserPromptSubmit"], {
      input,
      env: { PATH: "/nonexistent", TERM_PROGRAM: "Apple_Terminal", SECRET_TOKEN: "x1", ...env },
      encoding: "utf8",
      timeout: 5000,
    });
  }

  it("guarda el payload y el origen sin imprimir nada", async () => {
    const payload = '{"session_id":"s1","hook_event_name":"UserPromptSubmit"}';

    const result = run(payload);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const dir = path.join(home, "Library", "Logs", "Tokency", "diagnostics");
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    const payloadFile = files.find((f) => f.endsWith("-UserPromptSubmit.payload.json")) ?? "";
    const metaFile = files.find((f) => f.endsWith("-UserPromptSubmit.meta.txt")) ?? "";
    expect(await readFile(path.join(dir, payloadFile), "utf8")).toBe(payload);
    expect((await stat(path.join(dir, payloadFile))).mode & 0o777).toBe(0o600);

    const meta = await readFile(path.join(dir, metaFile), "utf8");
    expect(meta).toContain("event_arg=UserPromptSubmit\n");
    expect(meta).toContain("env.TERM_PROGRAM=Apple_Terminal\n");
    expect(meta).toMatch(/^parent\.0=\d+ /m);
    // De las variables fuera de la lista solo se guarda el nombre.
    expect(meta).toContain("env_name=SECRET_TOKEN\n");
    expect(meta).not.toContain("x1");
  });

  it("sale con 0 aunque stdin esté vacío", () => {
    expect(run("").status).toBe(0);
  });

  it("sale con 0 y sin salida si no puede escribir", () => {
    const result = run("{}", { HOME: "/dev/null" });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
