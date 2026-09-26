// `tokency uninstall` y `tokency uninstall-hooks` (spec §4.2 y §4.10).

import { readFile, rm } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  bootoutAgent,
  defaultClaudeSettingsPaths,
  deleteSecret,
  LAUNCH_AGENT_LABEL,
  TOKEN_REF,
  tokencyPaths,
  uninstallHooks,
  type TokencyPaths,
} from "@tokency/core";

import { HOOK_OWNER, isTokencyHook, WRAPPER_MARKER } from "../install/plan.ts";
import { errorMessage, say } from "../output.ts";

const HOOK_MESSAGES = {
  restored: "settings.json quedó exactamente como estaba antes de instalar.",
  deleted: "settings.json no existía antes de instalar; se borró.",
  removed: "Se quitaron los hooks de Tokency y se conservaron tus otros cambios.",
  "not-installed": "Los hooks de Tokency no estaban instalados.",
} as const;

async function removeHooks(paths: TokencyPaths): Promise<void> {
  const settings = { ...defaultClaudeSettingsPaths(), backupDir: paths.backupDir };
  const result = await uninstallHooks({ paths: settings, owner: HOOK_OWNER, isOwn: isTokencyHook });
  say.ok(HOOK_MESSAGES[result.status]);
  if (result.backupPath !== null) say.info(`Respaldo previo: ${result.backupPath}`);
}

export async function uninstallHooksCommand(): Promise<number> {
  try {
    await removeHooks(tokencyPaths());
    return 0;
  } catch (error) {
    say.fail(errorMessage(error));
    return 1;
  }
}

export async function uninstallCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { purge: { type: "boolean", default: false } },
  });
  const paths = tokencyPaths();
  say.title("Desinstalando Tokency…");
  try {
    await removeHooks(paths);

    if (await bootoutAgent(LAUNCH_AGENT_LABEL)) say.ok("Core detenido");
    await rm(paths.launchAgentPlist, { force: true });
    say.ok("LaunchAgent eliminado");

    const wrapper = await readFile(paths.cliWrapper, "utf8").catch(() => null);
    if (wrapper?.includes(WRAPPER_MARKER)) {
      await rm(paths.cliWrapper, { force: true });
      say.ok(`Comando eliminado de ${paths.cliWrapper}`);
    }

    await rm(paths.appDir, { recursive: true, force: true });
    say.ok("Bundle eliminado");

    if (values.purge) {
      await deleteSecret(TOKEN_REF);
      for (const file of [
        paths.dbFile,
        `${paths.dbFile}-wal`,
        `${paths.dbFile}-shm`,
        paths.configFile,
      ]) {
        await rm(file, { force: true });
      }
      say.ok("Token, base local y configuración eliminados");
    } else {
      say.info(`Se conservan tus datos en ${paths.supportDir} (usa --purge para borrarlos).`);
    }
    say.info(`Los respaldos de settings.json siguen en ${paths.backupDir}.`);
    return 0;
  } catch (error) {
    say.fail(errorMessage(error));
    return 1;
  }
}
