// LaunchAgent que mantiene el core corriendo (spec §3.2). Ver `man launchd.plist` y `man launchctl`.

import { run } from "./process.ts";

export interface LaunchAgentSpec {
  label: string;
  programArguments: readonly string[];
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  environment?: Readonly<Record<string, string>>;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const string = (value: string) => `<string>${escapeXml(value)}</string>`;

export function renderLaunchAgentPlist(spec: LaunchAgentSpec): string {
  const env = Object.entries(spec.environment ?? {})
    .map(([key, value]) => `\t\t<key>${escapeXml(key)}</key>\n\t\t${string(value)}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t${string(spec.label)}
\t<key>ProgramArguments</key>
\t<array>
${spec.programArguments.map((arg) => `\t\t${string(arg)}`).join("\n")}
\t</array>
\t<key>WorkingDirectory</key>
\t${string(spec.workingDirectory)}
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>StandardOutPath</key>
\t${string(spec.stdoutPath)}
\t<key>StandardErrorPath</key>
\t${string(spec.stderrPath)}
\t<key>EnvironmentVariables</key>
\t<dict>
${env}
\t</dict>
</dict>
</plist>
`;
}

const LAUNCHCTL = "/bin/launchctl";

function guiDomain(): string {
  return `gui/${String(process.getuid?.() ?? 501)}`;
}

type Runner = typeof run;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Error 5 (EIO) de launchctl: el servicio anterior todavía se está descargando. */
const BOOTSTRAP_BUSY = 5;

export async function isAgentLoaded(label: string, runner: Runner = run): Promise<boolean> {
  const result = await runner(LAUNCHCTL, ["print", `${guiDomain()}/${label}`], {
    timeoutMs: 5_000,
  });
  return result.code === 0;
}

/** Carga el agente; si launchd sigue descargando el anterior, reintenta unos segundos. */
export async function bootstrapAgent(
  plistPath: string,
  runner: Runner = run,
  retryDelayMs = 500,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const result = await runner(LAUNCHCTL, ["bootstrap", guiDomain(), plistPath], {
      timeoutMs: 10_000,
    });
    if (result.code === 0) return;
    if (result.code !== BOOTSTRAP_BUSY || attempt >= 10) {
      throw new Error(
        `launchctl bootstrap falló (${String(result.code)}): ${result.stderr.trim()}`,
      );
    }
    await sleep(retryDelayMs);
  }
}

/**
 * Descarga el agente si está cargado y espera a que launchd termine; no falla si no estaba.
 * Sin la espera, un `bootstrap` inmediato falla con el error 5.
 */
export async function bootoutAgent(
  label: string,
  runner: Runner = run,
  pollMs = 200,
): Promise<boolean> {
  if (!(await isAgentLoaded(label, runner))) return false;
  const result = await runner(LAUNCHCTL, ["bootout", `${guiDomain()}/${label}`], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) {
    throw new Error(`launchctl bootout falló (${String(result.code)}): ${result.stderr.trim()}`);
  }
  for (let waited = 0; waited < 10_000 && (await isAgentLoaded(label, runner)); waited += pollMs) {
    await sleep(pollMs);
  }
  return true;
}

/** Reinicia el core (`kickstart -k`). */
export async function restartAgent(label: string): Promise<void> {
  const result = await run(LAUNCHCTL, ["kickstart", "-k", `${guiDomain()}/${label}`], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) {
    throw new Error(`launchctl kickstart falló (${String(result.code)}): ${result.stderr.trim()}`);
  }
}
