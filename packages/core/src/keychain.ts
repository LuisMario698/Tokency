// Secretos en el Llavero de macOS mediante `/usr/bin/security` (spec §3.2, D-013).

import { randomBytes } from "node:crypto";

import { run } from "./process.ts";

const SECURITY = "/usr/bin/security";
/** Código de salida de `security` cuando el elemento no existe. */
const NOT_FOUND = 44;

export const TOKEN_SERVICE = "com.tokency.core";
export const TOKEN_ACCOUNT = "api-token";

export interface SecretRef {
  service: string;
  account: string;
}

const SAFE = /^[\x21-\x7e]+$/;

function assertSafe(label: string, value: string): void {
  if (!SAFE.test(value) || value.includes('"') || value.includes("\\")) {
    throw new Error(`${label} contiene caracteres no permitidos para el Llavero.`);
  }
}

/**
 * Comando para el modo interactivo de `security`, que lee de stdin: así el secreto nunca
 * aparece en los argumentos del proceso.
 */
export function addPasswordCommand(ref: SecretRef, secret: string): string {
  assertSafe("El servicio", ref.service);
  assertSafe("La cuenta", ref.account);
  assertSafe("El secreto", secret);
  return `add-generic-password -a "${ref.account}" -s "${ref.service}" -w "${secret}" -U\n`;
}

export async function readSecret(ref: SecretRef): Promise<string | null> {
  const result = await run(
    SECURITY,
    ["find-generic-password", "-a", ref.account, "-s", ref.service, "-w"],
    {
      timeoutMs: 5_000,
    },
  );
  if (result.code === NOT_FOUND) return null;
  if (result.code !== 0) {
    throw new Error(`No se pudo leer ${ref.service} del Llavero: ${result.stderr.trim()}`);
  }
  return result.stdout.replace(/\n$/, "");
}

export async function writeSecret(ref: SecretRef, secret: string): Promise<void> {
  const result = await run(SECURITY, ["-i"], {
    input: addPasswordCommand(ref, secret),
    timeoutMs: 5_000,
  });
  if (result.code !== 0 || result.stderr.trim().length > 0) {
    throw new Error(`No se pudo guardar ${ref.service} en el Llavero: ${result.stderr.trim()}`);
  }
}

export async function deleteSecret(ref: SecretRef): Promise<boolean> {
  const result = await run(
    SECURITY,
    ["delete-generic-password", "-a", ref.account, "-s", ref.service],
    {
      timeoutMs: 5_000,
    },
  );
  if (result.code === NOT_FOUND) return false;
  if (result.code !== 0) {
    throw new Error(`No se pudo borrar ${ref.service} del Llavero: ${result.stderr.trim()}`);
  }
  return true;
}

export const TOKEN_REF: SecretRef = { service: TOKEN_SERVICE, account: TOKEN_ACCOUNT };

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Devuelve el token de la API local; lo crea si no existe. */
export async function ensureApiToken(): Promise<{ token: string; created: boolean }> {
  const existing = await readSecret(TOKEN_REF);
  if (existing !== null && existing.length > 0) return { token: existing, created: false };
  const token = generateToken();
  await writeSecret(TOKEN_REF, token);
  return { token, created: true };
}
