import {
  InvalidSettingsError,
  type CommandHook,
  type HookMatcherGroup,
  type HooksConfig,
  type JsonObject,
  type JsonValue,
  type OwnershipTest,
} from "./types.ts";

export interface RemoveResult {
  settings: JsonObject;
  /** Cantidad de hooks propios que se quitaron. */
  removed: number;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Crea una prueba de pertenencia que busca `marker` dentro del comando del hook. */
export function commandContains(marker: string): OwnershipTest {
  if (marker.length === 0) throw new Error("El marcador de pertenencia no puede estar vacío.");
  return (hook) => typeof hook.command === "string" && hook.command.includes(marker);
}

/**
 * Valida la forma de `settings.hooks` y devuelve sus eventos en orden.
 * Si la forma no es la documentada, no se toca nada.
 */
function hookEvents(settings: JsonObject): [string, JsonValue[]][] | undefined {
  const hooks = settings.hooks;
  if (hooks === undefined) return undefined;
  if (!isJsonObject(hooks)) {
    throw new InvalidSettingsError("`hooks` en settings.json no es un objeto.");
  }
  return Object.entries(hooks).map(([event, groups]) => {
    if (!Array.isArray(groups)) {
      throw new InvalidSettingsError(`\`hooks.${event}\` en settings.json no es una lista.`);
    }
    return [event, groups];
  });
}

/**
 * Quita los hooks propios sin tocar los del usuario. Solo desaparecen los grupos,
 * eventos y el objeto `hooks` que quedaron vacíos por esta eliminación.
 */
export function removeOwnHooks(settings: JsonObject, isOwn: OwnershipTest): RemoveResult {
  const result = structuredClone(settings);
  const events = hookEvents(result);
  if (events === undefined) return { settings: result, removed: 0 };

  let removed = 0;
  const nextHooks: JsonObject = {};
  for (const [event, groups] of events) {
    const kept: JsonValue[] = [];
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const remaining = group.hooks.filter((hook) => !(isJsonObject(hook) && isOwn(hook)));
      const removedHere = group.hooks.length - remaining.length;
      removed += removedHere;
      if (removedHere === 0) {
        kept.push(group);
      } else if (remaining.length > 0) {
        kept.push({ ...group, hooks: remaining });
      }
    }
    const emptiedByUs = kept.length === 0 && groups.length > 0;
    if (!emptiedByUs) nextHooks[event] = kept;
  }

  if (removed === 0) return { settings: result, removed };
  if (Object.keys(nextHooks).length === 0) {
    delete result.hooks;
  } else {
    result.hooks = nextHooks;
  }
  return { settings: result, removed };
}

export function hasOwnHooks(settings: JsonObject, isOwn: OwnershipTest): boolean {
  return removeOwnHooks(settings, isOwn).removed > 0;
}

function commandHookToJson(hook: CommandHook): JsonObject {
  const entry: JsonObject = { type: hook.type, command: hook.command };
  if (hook.timeout !== undefined) entry.timeout = hook.timeout;
  return entry;
}

function groupToJson(group: HookMatcherGroup): JsonObject {
  const entry: JsonObject = {};
  if (group.matcher !== undefined) entry.matcher = group.matcher;
  entry.hooks = group.hooks.map(commandHookToJson);
  return entry;
}

/**
 * Agrega los grupos propios al final de cada evento. Es idempotente: primero quita
 * los hooks propios que ya estuvieran, así reinstalar no duplica nada.
 */
export function mergeOwnHooks(
  settings: JsonObject,
  own: HooksConfig,
  isOwn: OwnershipTest,
): JsonObject {
  for (const [event, groups] of Object.entries(own)) {
    for (const hook of groups.flatMap((group) => group.hooks)) {
      if (!isOwn(commandHookToJson(hook))) {
        throw new Error(
          `El hook de ${event} no pasa la prueba de pertenencia; después no se podría desinstalar.`,
        );
      }
    }
  }

  const { settings: result } = removeOwnHooks(settings, isOwn);
  const hooks: JsonObject = Object.fromEntries(hookEvents(result) ?? []);
  for (const [event, groups] of Object.entries(own)) {
    if (groups.length === 0) continue;
    const existing = hooks[event];
    hooks[event] = [...(Array.isArray(existing) ? existing : []), ...groups.map(groupToJson)];
  }
  if (Object.keys(hooks).length > 0 || result.hooks !== undefined) result.hooks = hooks;
  return result;
}
