import { run } from "../process.ts";

/** Convierte la columna `tty` de `ps` en una ruta de dispositivo; `??` significa que no tiene. */
export function ttyPath(psOutput: string): string | null {
  const name = psOutput.trim();
  if (name.length === 0 || name === "??" || name === "-") return null;
  return name.startsWith("/dev/") ? name : `/dev/${name}`;
}

/** Terminal de un proceso, para que la app enfoque la pestaña de esa sesión. */
export async function processTty(pid: number): Promise<string | null> {
  const result = await run("/bin/ps", ["-o", "tty=", "-p", String(pid)], { timeoutMs: 2_000 });
  return result.code === 0 ? ttyPath(result.stdout) : null;
}
