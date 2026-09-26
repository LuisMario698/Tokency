// `tokency install`: core + LaunchAgent + hooks + comando `tokency` (spec §4.10, D-013).

import { existsSync, realpathSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  bootoutAgent,
  bootstrapAgent,
  DEFAULT_PORT,
  defaultClaudeSettingsPaths,
  ensureApiToken,
  installHooks,
  LAUNCH_AGENT_LABEL,
  renderLaunchAgentPlist,
  tokencyPaths,
  type TokencyPaths,
} from "@tokency/core";

import { coreClient } from "../client.ts";
import {
  ENTRY_FILE,
  entryPath,
  HOOK_OWNER,
  isTokencyHook,
  launchAgentSpec,
  MIN_NODE,
  nodeVersionOk,
  stableNodePath,
  tokencyHooks,
  WRAPPER_MARKER,
  wrapperScript,
} from "../install/plan.ts";
import { errorMessage, say } from "../output.ts";

/** Carpeta del bundle que se está ejecutando (`.../dist/tokency.mjs`). */
function runningBundleDir(): string | null {
  const script = process.argv[1];
  if (script === undefined) return null;
  const real = realpathSync(script);
  return path.basename(real) === ENTRY_FILE ? path.dirname(real) : null;
}

/** Copia el bundle a una carpeta temporal y la cambia por la instalada de una sola vez. */
async function copyBundle(source: string, target: string): Promise<void> {
  const staging = `${target}.nuevo`;
  const previous = `${target}.anterior`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await cp(source, staging, { recursive: true });
  await rm(previous, { recursive: true, force: true });
  if (existsSync(target)) await rename(target, previous);
  await rename(staging, target);
  await rm(previous, { recursive: true, force: true });
}

async function waitForCore(paths: TokencyPaths, timeoutMs: number): Promise<boolean> {
  const client = await coreClient(paths);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.get("/v1/health", 1_000);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return false;
}

async function writeWrapper(paths: TokencyPaths, nodePath: string): Promise<void> {
  const existing = await readFile(paths.cliWrapper, "utf8").catch(() => null);
  if (existing !== null && !existing.includes(WRAPPER_MARKER)) {
    say.warn(`${paths.cliWrapper} ya existe y no es de Tokency; no se tocó.`);
    return;
  }
  await mkdir(path.dirname(paths.cliWrapper), { recursive: true });
  await writeFile(paths.cliWrapper, wrapperScript(nodePath, entryPath(paths)));
  await chmod(paths.cliWrapper, 0o755);
  say.ok(`Comando instalado en ${paths.cliWrapper}`);
  const onPath = (process.env.PATH ?? "").split(":").includes(path.dirname(paths.cliWrapper));
  if (!onPath) {
    say.warn(`${path.dirname(paths.cliWrapper)} no está en tu PATH; agrégalo en ~/.zshrc.`);
  }
}

export async function installCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { "dry-run": { type: "boolean", default: false } },
  });
  const dryRun = values["dry-run"];

  if (process.platform !== "darwin") {
    say.fail("Tokency solo funciona en macOS.");
    return 1;
  }
  if (!nodeVersionOk(process.versions.node)) {
    say.fail(
      `Se necesita Node ${MIN_NODE.join(".")} o posterior (tienes ${process.versions.node}).`,
    );
    return 1;
  }
  const bundleDir = runningBundleDir();
  if (bundleDir === null) {
    say.fail("Ejecuta la instalación desde el bundle compilado:");
    say.info("pnpm build && node packages/cli/dist/tokency.mjs install");
    return 1;
  }

  const paths = tokencyPaths();
  const nodePath = stableNodePath(process.execPath, existsSync);
  const entry = entryPath(paths);
  const hooks = tokencyHooks(nodePath, entry);
  const settings = { ...defaultClaudeSettingsPaths(), backupDir: paths.backupDir };

  say.title(dryRun ? "Plan de instalación (no se cambia nada):" : "Instalando Tokency…");
  say.info(`node: ${nodePath}`);
  say.info(`bundle: ${bundleDir} → ${paths.appDir}`);
  say.info(`LaunchAgent: ${paths.launchAgentPlist}`);
  say.info(`hooks en ${settings.settingsFile}: ${Object.keys(hooks).join(", ")}`);
  say.info(`comando: ${paths.cliWrapper}`);
  if (dryRun) return 0;

  try {
    if (bundleDir !== paths.appDir) await copyBundle(bundleDir, paths.appDir);
    say.ok("Bundle copiado");

    const { created } = await ensureApiToken();
    say.ok(created ? "Token nuevo guardado en el Llavero" : "Token existente en el Llavero");

    if (!existsSync(paths.configFile)) {
      await mkdir(paths.supportDir, { recursive: true, mode: 0o700 });
      await writeFile(paths.configFile, `${JSON.stringify({ port: DEFAULT_PORT }, null, 2)}\n`, {
        mode: 0o600,
      });
      say.ok(`Configuración creada en ${paths.configFile}`);
    }

    await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
    await mkdir(path.dirname(paths.launchAgentPlist), { recursive: true });
    await writeFile(
      paths.launchAgentPlist,
      renderLaunchAgentPlist(launchAgentSpec(paths, nodePath)),
    );
    await bootoutAgent(LAUNCH_AGENT_LABEL);
    await bootstrapAgent(paths.launchAgentPlist);
    if (await waitForCore(paths, 10_000)) {
      say.ok("Core corriendo con launchd");
    } else {
      say.fail("El core no respondió; revisa `tokency logs`.");
      return 1;
    }

    const result = await installHooks({
      paths: settings,
      owner: HOOK_OWNER,
      isOwn: isTokencyHook,
      hooks,
    });
    if (result.status === "installed") {
      say.ok("Hooks agregados a settings.json");
      say.info(`Respaldo: ${result.backupPath}`);
    } else {
      say.ok("Los hooks ya estaban instalados");
    }

    await writeWrapper(paths, nodePath);
  } catch (error) {
    say.fail(errorMessage(error));
    return 1;
  }

  say.title("Listo. Revisa todo con `tokency doctor`.");
  return 0;
}
