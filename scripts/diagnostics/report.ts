// Resumen de las capturas del hook de diagnóstico. Nunca muestra el texto de prompts,
// respuestas ni entradas de herramientas: de cada payload solo salen los nombres de sus
// campos y los valores de una lista cerrada de campos descriptivos.

import type { JsonObject } from "../../packages/core/src/index.ts";

export interface CaptureMeta {
  eventArg: string;
  /** Procesos padre, del más cercano al más lejano, como `pid ejecutable`. */
  parents: string[];
  env: Record<string, string>;
  envNames: string[];
}

export interface Capture {
  name: string;
  /** Milisegundos; se usa la fecha de modificación del payload porque tiene más precisión. */
  capturedAt: number;
  meta: CaptureMeta;
  /** `null` si stdin llegó vacío o no era JSON. */
  payload: JsonObject | null;
}

/** Campos cuyo valor es descriptivo (enumeraciones, nombres de herramienta) y no contenido. */
const SAFE_VALUE_KEYS = [
  "source",
  "reason",
  "trigger",
  "notification_type",
  "permission_mode",
  "tool_name",
  "agent_type",
  "subagent_type",
  "stop_hook_active",
] as const;

/** Variables de entorno cuyos nombres ayudan a distinguir el origen. */
const RELEVANT_ENV_NAME = /^(CLAUDE|ANTHROPIC|VSCODE|TERM|__CF|ELECTRON|XPC|ANTIGRAVITY|MCP)/;

export function parseMeta(text: string): CaptureMeta {
  const meta: CaptureMeta = { eventArg: "", parents: [], env: {}, envNames: [] };
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "event_arg") meta.eventArg = value;
    else if (key.startsWith("parent.")) meta.parents.push(value);
    else if (key.startsWith("env.")) meta.env[key.slice(4)] = value;
    else if (key === "env_name" && value.length > 0) meta.envNames.push(value);
  }
  return meta;
}

function stringField(payload: JsonObject | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

function eventName(capture: Capture): string {
  return stringField(capture.payload, "hook_event_name") ?? capture.meta.eventArg;
}

function eventLabel(capture: Capture): string {
  const details = SAFE_VALUE_KEYS.filter((key) => key !== "permission_mode").flatMap((key) => {
    const value = capture.payload?.[key];
    return typeof value === "string" || typeof value === "boolean" ? [`${key}=${value}`] : [];
  });
  const name = eventName(capture);
  return details.length > 0 ? `${name}[${details.join(", ")}]` : name;
}

/** Junta etiquetas consecutivas iguales: `PreToolUse[tool_name=Bash] ×3`. */
function compress(labels: string[]): string[] {
  const result: string[] = [];
  let previous: string | undefined;
  let count = 0;
  for (const label of [...labels, undefined]) {
    if (label === previous) {
      count++;
      continue;
    }
    if (previous !== undefined) result.push(count > 1 ? `${previous} ×${count}` : previous);
    previous = label;
    count = 1;
  }
  return result;
}

function time(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

function executable(parent: string): string {
  return parent.replace(/^\d+ /, "");
}

export function summarize(
  captures: readonly Capture[],
  fileExists: (file: string) => boolean,
): string {
  if (captures.length === 0) return "No hay capturas.\n";

  const sessions = new Map<string, Capture[]>();
  for (const capture of [...captures].sort((a, b) => a.capturedAt - b.capturedAt)) {
    const id = stringField(capture.payload, "session_id") ?? "(sin session_id)";
    sessions.set(id, [...(sessions.get(id) ?? []), capture]);
  }

  const lines: string[] = [`${captures.length} capturas en ${sessions.size} sesiones.`, ""];
  for (const [id, list] of sessions) {
    const first = list[0];
    const last = list.at(-1);
    if (first === undefined || last === undefined) continue;
    const range = `${time(first.capturedAt)} → ${time(last.capturedAt)} UTC`;
    lines.push(`## Sesión ${id} (${list.length} eventos, ${range})`);

    const withPayload = list.find((capture) => capture.payload !== null)?.payload ?? null;
    const cwd = stringField(withPayload, "cwd");
    const transcript = stringField(withPayload, "transcript_path");
    if (cwd !== undefined) lines.push(`- cwd: ${cwd}`);
    if (transcript !== undefined) {
      lines.push(
        `- transcript_path: ${transcript} (existe: ${fileExists(transcript) ? "sí" : "no"})`,
      );
    }
    const modes = [...new Set(list.map((c) => stringField(c.payload, "permission_mode")))];
    const knownModes = modes.filter((mode) => mode !== undefined);
    if (knownModes.length > 0) lines.push(`- permission_mode: ${knownModes.join(", ")}`);

    const env = Object.entries(first.meta.env)
      .filter(([name]) => name !== "PATH" && name !== "PWD")
      .map(([name, value]) => `${name}=${value}`);
    lines.push(`- entorno: ${env.join(" · ") || "(ninguna variable de la lista)"}`);
    const path = first.meta.env.PATH;
    if (path !== undefined) lines.push(`- PATH: ${path}`);
    lines.push(`- procesos padre: ${first.meta.parents.map(executable).join(" ← ")}`);
    const relevantNames = first.meta.envNames.filter((name) => RELEVANT_ENV_NAME.test(name));
    lines.push(
      `- nombres de variables relevantes (${relevantNames.length} de ${first.meta.envNames.length}): ${relevantNames.sort().join(", ")}`,
    );

    const origins = new Set(list.map((capture) => capture.meta.parents.slice(1).join(" ")));
    if (origins.size > 1) lines.push(`- ⚠️ la cadena de procesos cambia entre eventos`);

    lines.push(`- eventos: ${compress(list.map(eventLabel)).join(" → ")}`);

    const invalid = list.filter((capture) => capture.payload === null).length;
    if (invalid > 0) lines.push(`- ⚠️ ${invalid} payloads vacíos o que no son JSON`);

    lines.push("- campos por evento:");
    const fields = new Map<string, Set<string>>();
    for (const capture of list) {
      const keys = fields.get(eventName(capture)) ?? new Set<string>();
      for (const key of Object.keys(capture.payload ?? {})) keys.add(key);
      fields.set(eventName(capture), keys);
    }
    for (const [event, keys] of fields) lines.push(`  - ${event}: ${[...keys].join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
