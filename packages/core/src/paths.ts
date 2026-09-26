import os from "node:os";
import path from "node:path";

export interface TokencyPaths {
  home: string;
  /** `~/Library/Application Support/Tokency` */
  supportDir: string;
  /** Copia instalada del bundle; el LaunchAgent y los hooks la usan (D-013). */
  appDir: string;
  dbFile: string;
  configFile: string;
  backupDir: string;
  logsDir: string;
  launchAgentPlist: string;
  /** `~/.claude` o `CLAUDE_CONFIG_DIR`. */
  claudeDir: string;
  claudeProjectsDir: string;
  claudeSettingsFile: string;
  /** Envoltorio `tokency` en el PATH del usuario. */
  cliWrapper: string;
}

export const LAUNCH_AGENT_LABEL = "com.tokency.core";

export function tokencyPaths(
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): TokencyPaths {
  const supportDir = path.join(home, "Library", "Application Support", "Tokency");
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude");
  return {
    home,
    supportDir,
    appDir: path.join(supportDir, "app"),
    dbFile: path.join(supportDir, "tokency.db"),
    configFile: path.join(supportDir, "config.json"),
    backupDir: path.join(supportDir, "backups"),
    logsDir: path.join(home, "Library", "Logs", "Tokency"),
    launchAgentPlist: path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`),
    claudeDir,
    claudeProjectsDir: path.join(claudeDir, "projects"),
    claudeSettingsFile: path.join(claudeDir, "settings.json"),
    cliWrapper: path.join(home, ".local", "bin", "tokency"),
  };
}
