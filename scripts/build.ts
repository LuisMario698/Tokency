// Compila el CLI y el core en un bundle ESM con división de código (D-013).
//   node scripts/build.ts

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "packages", "cli", "dist");

function version(): string {
  const { version: base } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    version: string;
  };
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    return `${base}+${commit.trim()}`;
  } catch {
    return base;
  }
}

rmSync(outdir, { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { tokency: "packages/cli/src/main.ts" },
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outExtension: { ".js": ".mjs" },
  chunkNames: "chunks/[name]-[hash]",
  define: { __TOKENCY_VERSION__: JSON.stringify(version()) },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

const outputs = Object.entries(result.metafile.outputs)
  .map(([file, info]) => `${path.relative(root, file)} ${(info.bytes / 1024).toFixed(1)} KB`)
  .sort();
console.log(`Bundle ${version()}:\n  ${outputs.join("\n  ")}`);
