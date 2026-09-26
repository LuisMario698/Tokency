import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Texto que se escribe en stdin; así los secretos no aparecen en la lista de procesos. */
  input?: string;
  timeoutMs?: number;
}

/** Ejecuta un binario sin shell y devuelve su salida. Nunca lanza por un código de salida. */
export function run(
  file: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}
