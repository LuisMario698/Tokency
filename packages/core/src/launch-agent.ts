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

export async function isAgentLoaded(label: string): Promise<boolean> {
  const result = await run(LAUNCHCTL, ["print", `${guiDomain()}/${label}`], { timeoutMs: 5_000 });
  return result.code === 0;
}

export async function bootstrapAgent(plistPath: string): Promise<void> {
  const result = await run(LAUNCHCTL, ["bootstrap", guiDomain(), plistPath], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    throw new Error(`launchctl bootstrap falló (${String(result.code)}): ${result.stderr.trim()}`);
  }
}

/** Descarga el agente si está cargado; no falla si no lo estaba. */
export async function bootoutAgent(label: string): Promise<boolean> {
  if (!(await isAgentLoaded(label))) return false;
  const result = await run(LAUNCHCTL, ["bootout", `${guiDomain()}/${label}`], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) {
    throw new Error(`launchctl bootout falló (${String(result.code)}): ${result.stderr.trim()}`);
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
