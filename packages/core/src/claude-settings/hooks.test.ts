import { describe, expect, it } from "vitest";

import { commandContains, hasOwnHooks, mergeOwnHooks, removeOwnHooks } from "./hooks.ts";
import { InvalidSettingsError, type HooksConfig, type JsonObject } from "./types.ts";

const isOwn = commandContains("/opt/tokency/hook");

const own: HooksConfig = {
  SessionStart: [{ hooks: [{ type: "command", command: "/opt/tokency/hook start", timeout: 5 }] }],
  PreToolUse: [
    { matcher: "*", hooks: [{ type: "command", command: "/opt/tokency/hook pre", timeout: 5 }] },
  ],
};

const userGroup = { matcher: "Bash", hooks: [{ type: "command", command: "~/bin/audit.sh" }] };

describe("mergeOwnHooks", () => {
  it("agrega `hooks` cuando no existe y conserva los demás ajustes", () => {
    const settings: JsonObject = { model: "opus", theme: "dark" };

    const merged = mergeOwnHooks(settings, own, isOwn);

    expect(merged).toEqual({
      model: "opus",
      theme: "dark",
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "/opt/tokency/hook start", timeout: 5 }] },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "/opt/tokency/hook pre", timeout: 5 }],
          },
        ],
      },
    });
  });

  it("no muta el objeto recibido", () => {
    const settings: JsonObject = { hooks: { PreToolUse: [userGroup] } };
    const before = structuredClone(settings);

    mergeOwnHooks(settings, own, isOwn);

    expect(settings).toEqual(before);
  });

  it("deja los grupos del usuario intactos y agrega los propios al final", () => {
    const settings: JsonObject = { hooks: { PreToolUse: [userGroup] } };

    const merged = mergeOwnHooks(settings, own, isOwn);

    expect((merged.hooks as JsonObject).PreToolUse).toEqual([
      userGroup,
      { matcher: "*", hooks: [{ type: "command", command: "/opt/tokency/hook pre", timeout: 5 }] },
    ]);
  });

  it("es idempotente", () => {
    const settings: JsonObject = { hooks: { PreToolUse: [userGroup] } };

    const once = mergeOwnHooks(settings, own, isOwn);
    const twice = mergeOwnHooks(once, own, isOwn);

    expect(twice).toEqual(once);
  });

  it("reemplaza una versión anterior de los hooks propios", () => {
    const old: HooksConfig = {
      Stop: [{ hooks: [{ type: "command", command: "/opt/tokency/hook stop" }] }],
    };

    const merged = mergeOwnHooks(mergeOwnHooks({}, old, isOwn), own, isOwn);

    expect(Object.keys(merged.hooks as JsonObject)).toEqual(["SessionStart", "PreToolUse"]);
  });

  it("rechaza hooks que después no se podrían reconocer para desinstalarlos", () => {
    const foreign: HooksConfig = {
      Stop: [{ hooks: [{ type: "command", command: "/usr/local/bin/otro" }] }],
    };

    expect(() => mergeOwnHooks({}, foreign, isOwn)).toThrow(/prueba de pertenencia/);
  });

  it("rechaza un `hooks` con forma inesperada", () => {
    expect(() => mergeOwnHooks({ hooks: [] }, own, isOwn)).toThrow(InvalidSettingsError);
    expect(() => mergeOwnHooks({ hooks: { Stop: {} } }, own, isOwn)).toThrow(InvalidSettingsError);
  });
});

describe("removeOwnHooks", () => {
  const originals: [string, JsonObject][] = [
    ["sin hooks", { model: "opus" }],
    ["con hooks del usuario en el mismo evento", { hooks: { PreToolUse: [userGroup] } }],
    ["con hooks del usuario en otro evento", { hooks: { Notification: [userGroup] } }],
    ["con una lista vacía del usuario", { hooks: { Stop: [] } }],
  ];

  it.each(originals)("deshace la fusión exactamente (%s)", (_name, original) => {
    const merged = mergeOwnHooks(original, own, isOwn);

    const { settings, removed } = removeOwnHooks(merged, isOwn);

    expect(removed).toBe(2);
    expect(settings).toStrictEqual(original);
  });

  it("quita un `hooks` que quedó vacío, aunque el usuario ya lo tuviera vacío", () => {
    // No se puede distinguir un `hooks: {}` previo de uno vaciado al desinstalar.
    const merged = mergeOwnHooks({ hooks: {}, model: "opus" }, own, isOwn);

    expect(removeOwnHooks(merged, isOwn).settings).toStrictEqual({ model: "opus" });
  });

  it("conserva un hook del usuario agregado dentro de un grupo propio", () => {
    const merged = mergeOwnHooks({}, own, isOwn);
    const hooks = merged.hooks as JsonObject;
    const [group] = hooks.PreToolUse as JsonObject[];
    (group?.hooks as JsonObject[]).push({ type: "command", command: "~/bin/mio.sh" });

    const { settings } = removeOwnHooks(merged, isOwn);

    expect(settings).toEqual({
      hooks: {
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "~/bin/mio.sh" }] }],
      },
    });
  });

  it("no cambia nada si no hay hooks propios", () => {
    const settings: JsonObject = { hooks: { PreToolUse: [userGroup], Stop: [] } };

    const result = removeOwnHooks(settings, isOwn);

    expect(result.removed).toBe(0);
    expect(result.settings).toStrictEqual(settings);
  });

  it("ignora entradas con forma desconocida sin perderlas", () => {
    const settings: JsonObject = { hooks: { Stop: ["raro", { sinHooks: true }] } };

    const merged = mergeOwnHooks(settings, own, isOwn);

    expect(removeOwnHooks(merged, isOwn).settings).toStrictEqual(settings);
  });
});

describe("hasOwnHooks", () => {
  it("detecta si hay hooks propios instalados", () => {
    expect(hasOwnHooks({ hooks: { PreToolUse: [userGroup] } }, isOwn)).toBe(false);
    expect(hasOwnHooks(mergeOwnHooks({}, own, isOwn), isOwn)).toBe(true);
  });
});

describe("commandContains", () => {
  it("solo reconoce comandos de texto que contienen el marcador", () => {
    expect(isOwn({ type: "command", command: "'/opt/tokency/hook' Stop" })).toBe(true);
    expect(isOwn({ type: "command", command: "/opt/otro" })).toBe(false);
    expect(isOwn({ type: "http", url: "/opt/tokency/hook" })).toBe(false);
  });

  it("no acepta un marcador vacío", () => {
    expect(() => commandContains("")).toThrow();
  });
});
