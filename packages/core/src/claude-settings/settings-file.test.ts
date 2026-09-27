import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commandContains } from "./hooks.ts";
import {
  defaultClaudeSettingsPaths,
  installHooks,
  uninstallHooks,
  type ClaudeSettingsPaths,
} from "./settings-file.ts";
import { InvalidSettingsError, type HooksConfig, type JsonObject } from "./types.ts";

const isOwn = commandContains("/opt/tokency/hook");
const owner = "test";
const hooks: HooksConfig = {
  SessionStart: [{ hooks: [{ type: "command", command: "/opt/tokency/hook start", timeout: 5 }] }],
  Stop: [{ hooks: [{ type: "command", command: "/opt/tokency/hook stop", timeout: 5 }] }],
};

// Formato poco común a propósito: sangría de 4, claves sin orden y sin salto de línea final.
const original = '{\n    "theme": "dark",\n    "model": "opus",\n    "env": { "A": "1" }\n}';

let dir: string;
let paths: ClaudeSettingsPaths;
let clock: number;
const now = () => new Date(clock++);

async function readJson(file: string): Promise<JsonObject> {
  return JSON.parse(await readFile(file, "utf8")) as JsonObject;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tokency-settings-"));
  paths = {
    settingsFile: path.join(dir, "claude", "settings.json"),
    backupDir: path.join(dir, "backups"),
  };
  clock = Date.UTC(2026, 8, 25, 12, 0, 0);
  await mkdir(path.dirname(paths.settingsFile));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("installHooks + uninstallHooks", () => {
  it("instala, respalda y al desinstalar restaura el archivo byte por byte", async () => {
    await writeFile(paths.settingsFile, original);
    await chmod(paths.settingsFile, 0o644);

    const installed = await installHooks({ paths, owner, isOwn, hooks, now });

    expect(installed.status).toBe("installed");
    const written = await readFile(paths.settingsFile, "utf8");
    expect(written).toMatch(/^\{\n {4}"theme"/);
    expect(written.endsWith("}")).toBe(true);
    const settings = await readJson(paths.settingsFile);
    expect(settings.env).toEqual({ A: "1" });
    expect(Object.keys(settings.hooks as JsonObject)).toEqual(["SessionStart", "Stop"]);
    expect((await stat(paths.settingsFile)).mode & 0o777).toBe(0o644);

    expect(installed.backupPath).not.toBeNull();
    const backupPath = installed.backupPath ?? "";
    expect(await readFile(backupPath, "utf8")).toBe(original);
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
    expect(path.basename(backupPath)).toBe(
      "claude-settings.2026-09-25T12-00-00-000Z.test.pre-install.json",
    );

    const uninstalled = await uninstallHooks({ paths, owner, isOwn, now });

    expect(uninstalled.status).toBe("restored");
    expect(await readFile(paths.settingsFile, "utf8")).toBe(original);
    expect((await stat(paths.settingsFile)).mode & 0o777).toBe(0o644);
  });

  it("no deja archivos temporales junto a settings.json", async () => {
    await writeFile(paths.settingsFile, original);

    await installHooks({ paths, owner, isOwn, hooks, now });
    await uninstallHooks({ paths, owner, isOwn, now });

    expect(await readdir(path.dirname(paths.settingsFile))).toEqual(["settings.json"]);
  });

  it("reinstalar sin cambios no escribe ni respalda de nuevo", async () => {
    await writeFile(paths.settingsFile, original);
    await installHooks({ paths, owner, isOwn, hooks, now });
    const after = await readFile(paths.settingsFile, "utf8");

    const again = await installHooks({ paths, owner, isOwn, hooks, now });

    expect(again).toEqual({ status: "unchanged", backupPath: null, userStatusLineKept: false });
    expect(await readFile(paths.settingsFile, "utf8")).toBe(after);
    expect(await readdir(paths.backupDir)).toHaveLength(1);
  });

  it("después de reinstalar con otros hooks, restaura el archivo original", async () => {
    await writeFile(paths.settingsFile, original);
    await installHooks({ paths, owner, isOwn, hooks, now });
    const newer: HooksConfig = {
      Notification: [{ hooks: [{ type: "command", command: "/opt/tokency/hook notify" }] }],
    };
    await installHooks({ paths, owner, isOwn, hooks: newer, now });

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result.status).toBe("restored");
    expect(await readFile(paths.settingsFile, "utf8")).toBe(original);
  });

  it("si el usuario cambió otros ajustes, los conserva y solo quita los hooks propios", async () => {
    await writeFile(paths.settingsFile, original);
    await installHooks({ paths, owner, isOwn, hooks, now });
    const edited = await readJson(paths.settingsFile);
    edited.theme = "light";
    await writeFile(paths.settingsFile, JSON.stringify(edited, null, 2));

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result.status).toBe("removed");
    expect(await readJson(paths.settingsFile)).toStrictEqual({
      theme: "light",
      model: "opus",
      env: { A: "1" },
    });
    // El estado previo a desinstalar también queda respaldado.
    expect(await readFile(result.backupPath ?? "", "utf8")).toBe(JSON.stringify(edited, null, 2));
  });

  it("conserva hooks que el usuario agregó después de instalar", async () => {
    await writeFile(paths.settingsFile, original);
    await installHooks({ paths, owner, isOwn, hooks, now });
    const edited = await readJson(paths.settingsFile);
    const userGroup = { hooks: [{ type: "command", command: "~/bin/mio.sh" }] };
    (edited.hooks as JsonObject).Stop = [...((edited.hooks as JsonObject).Stop as []), userGroup];
    await writeFile(paths.settingsFile, JSON.stringify(edited));

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result.status).toBe("removed");
    expect((await readJson(paths.settingsFile)).hooks).toStrictEqual({ Stop: [userGroup] });
  });

  it("si settings.json no existía, lo crea y al desinstalar lo borra", async () => {
    const installed = await installHooks({ paths, owner, isOwn, hooks, now });

    expect(installed.status).toBe("installed");
    expect(installed.backupPath?.endsWith(".pre-install.absent")).toBe(true);
    expect((await stat(paths.settingsFile)).mode & 0o777).toBe(0o600);

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result.status).toBe("deleted");
    await expect(stat(paths.settingsFile)).rejects.toThrow(/ENOENT/);
  });

  it("escribe en el destino de un enlace simbólico sin reemplazar el enlace", async () => {
    const real = path.join(dir, "dotfiles-settings.json");
    await writeFile(real, original);
    await symlink(real, paths.settingsFile);

    await installHooks({ paths, owner, isOwn, hooks, now });

    expect((await lstat(paths.settingsFile)).isSymbolicLink()).toBe(true);
    expect((await readJson(real)).hooks).toBeDefined();

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result.status).toBe("restored");
    expect((await lstat(paths.settingsFile)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toBe(original);
  });

  it("no toca un settings.json inválido", async () => {
    const broken = '{ "model": "opus", }';
    await writeFile(paths.settingsFile, broken);

    await expect(installHooks({ paths, owner, isOwn, hooks, now })).rejects.toThrow(
      InvalidSettingsError,
    );

    expect(await readFile(paths.settingsFile, "utf8")).toBe(broken);
    await expect(readdir(paths.backupDir)).rejects.toThrow(/ENOENT/);
  });

  it("no toca un settings.json que no es un objeto", async () => {
    await writeFile(paths.settingsFile, "[]");

    await expect(installHooks({ paths, owner, isOwn, hooks, now })).rejects.toThrow(
      InvalidSettingsError,
    );
    expect(await readFile(paths.settingsFile, "utf8")).toBe("[]");
  });

  it("desinstalar sin hooks propios no hace nada", async () => {
    await writeFile(paths.settingsFile, original);

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result).toEqual({ status: "not-installed", backupPath: null });
    expect(await readFile(paths.settingsFile, "utf8")).toBe(original);
    await expect(readdir(paths.backupDir)).rejects.toThrow(/ENOENT/);
  });

  it("restaura el estado previo aunque haya hooks de otro dueño", async () => {
    await writeFile(paths.settingsFile, original);
    const otherIsOwn = commandContains("/opt/otro/hook");
    const otherHooks: HooksConfig = {
      Stop: [{ hooks: [{ type: "command", command: "/opt/otro/hook" }] }],
    };
    await installHooks({ paths, owner: "otro", isOwn: otherIsOwn, hooks: otherHooks, now });
    const withOther = await readFile(paths.settingsFile, "utf8");
    await installHooks({ paths, owner, isOwn, hooks, now });

    const result = await uninstallHooks({ paths, owner, isOwn, now });

    expect(result.status).toBe("restored");
    expect(await readFile(paths.settingsFile, "utf8")).toBe(withOther);
  });

  it("evita colisiones de nombres de respaldo con la misma hora", async () => {
    await writeFile(paths.settingsFile, original);
    const fixed = () => new Date(Date.UTC(2026, 8, 25));

    await installHooks({ paths, owner, isOwn, hooks, now: fixed });
    await uninstallHooks({ paths, owner, isOwn, now: fixed });
    await installHooks({ paths, owner, isOwn, hooks, now: fixed });
    const result = await uninstallHooks({ paths, owner, isOwn, now: fixed });

    expect(result.status).toBe("restored");
    expect(await readdir(paths.backupDir)).toHaveLength(4);
  });
});

describe("status line", () => {
  const statusLine = {
    type: "command" as const,
    command: "/opt/tokency/hook statusline",
    padding: 0,
  };

  it("la instala junto con los hooks y al desinstalar restaura el archivo byte por byte", async () => {
    await writeFile(paths.settingsFile, original);

    const installed = await installHooks({ paths, owner, isOwn, hooks, statusLine, now });

    expect(installed).toMatchObject({ status: "installed", userStatusLineKept: false });
    expect((await readJson(paths.settingsFile)).statusLine).toEqual(statusLine);

    expect((await uninstallHooks({ paths, owner, isOwn, now })).status).toBe("restored");
    expect(await readFile(paths.settingsFile, "utf8")).toBe(original);
  });

  it("nunca reemplaza una status line propia del usuario", async () => {
    const mine = { type: "command", command: "~/.claude/mi-statusline.sh" };
    await writeFile(paths.settingsFile, JSON.stringify({ statusLine: mine }));

    const installed = await installHooks({ paths, owner, isOwn, hooks, statusLine, now });

    expect(installed.userStatusLineKept).toBe(true);
    expect((await readJson(paths.settingsFile)).statusLine).toEqual(mine);
    await uninstallHooks({ paths, owner, isOwn, now });
    expect((await readJson(paths.settingsFile)).statusLine).toEqual(mine);
  });

  it("agregarla a una instalación que ya tenía hooks sigue restaurando el original", async () => {
    await writeFile(paths.settingsFile, original);
    await installHooks({ paths, owner, isOwn, hooks, now });
    await installHooks({ paths, owner, isOwn, hooks, statusLine, now });

    expect((await uninstallHooks({ paths, owner, isOwn, now })).status).toBe("restored");
    expect(await readFile(paths.settingsFile, "utf8")).toBe(original);
  });
});

describe("defaultClaudeSettingsPaths", () => {
  it("usa ~/.claude y la carpeta de soporte de Tokency", () => {
    expect(defaultClaudeSettingsPaths("/Users/x", {})).toEqual({
      settingsFile: "/Users/x/.claude/settings.json",
      backupDir: "/Users/x/Library/Application Support/Tokency/backups",
    });
  });

  it("respeta CLAUDE_CONFIG_DIR", () => {
    expect(
      defaultClaudeSettingsPaths("/Users/x", { CLAUDE_CONFIG_DIR: "/tmp/cc" }).settingsFile,
    ).toBe("/tmp/cc/settings.json");
  });
});
