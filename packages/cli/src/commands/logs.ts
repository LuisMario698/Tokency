// `tokency logs [-n líneas] [-f]`: muestra el log del core.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { tokencyPaths } from "@tokency/core";

import { say } from "../output.ts";

export async function logsCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      lines: { type: "string", short: "n", default: "50" },
      follow: { type: "boolean", short: "f", default: false },
    },
  });
  const file = path.join(tokencyPaths().logsDir, "core.log");
  if (!existsSync(file)) {
    say.fail(`Todavía no hay log en ${file}.`);
    return 1;
  }
  const tailArgs = ["-n", values.lines, ...(values.follow ? ["-F"] : []), file];
  const child = spawn("/usr/bin/tail", tailArgs, { stdio: "inherit" });
  return new Promise((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}
