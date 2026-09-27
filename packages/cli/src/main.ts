// Punto de entrada del comando `tokency`. Cada subcomando se carga bajo demanda para que
// `tokency hook` no pague el costo de importar el core completo.

import { VERSION } from "./version.ts";

const USAGE = `tokency ${VERSION}

Uso: tokency <comando>

  install [--dry-run]   Instala el core, el LaunchAgent, los hooks y este comando
  uninstall [--purge]   Quita todo lo anterior (con --purge, también los datos)
  uninstall-hooks       Quita solo los hooks de ~/.claude/settings.json
  doctor                Revisa la instalación y explica cómo arreglarla
  status                Muestra las sesiones de Claude abiertas
  usage [-d días]       Muestra el uso de Claude Code y el historial
  logs [-n N] [-f]      Muestra el log del core
  serve                 Arranca el core (lo usa launchd)
  hook <evento>         Reenvía un evento de Claude Code al core (lo usan los hooks)
  statusline            Status line de Claude Code con el uso oficial del plan
`;

async function dispatch(command: string | undefined, args: string[]): Promise<number> {
  switch (command) {
    case "hook": {
      const { hookCommand } = await import("./commands/hook.ts");
      await hookCommand(args);
      return 0;
    }
    case "statusline": {
      const { statuslineCommand } = await import("./commands/statusline.ts");
      await statuslineCommand();
      return 0;
    }
    case "serve":
      return (await import("./commands/serve.ts")).serveCommand();
    case "install":
      return (await import("./commands/install.ts")).installCommand(args);
    case "uninstall":
      return (await import("./commands/uninstall.ts")).uninstallCommand(args);
    case "uninstall-hooks":
      return (await import("./commands/uninstall.ts")).uninstallHooksCommand();
    case "doctor":
      return (await import("./commands/doctor.ts")).doctorCommand();
    case "status":
      return (await import("./commands/status.ts")).statusCommand();
    case "usage":
      return (await import("./commands/usage.ts")).usageCommand(args);
    case "logs":
      return (await import("./commands/logs.ts")).logsCommand(args);
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      console.error(`Comando desconocido: ${command}\n\n${USAGE}`);
      return 2;
  }
}

const [command, ...args] = process.argv.slice(2);
process.exitCode = await dispatch(command, args);
