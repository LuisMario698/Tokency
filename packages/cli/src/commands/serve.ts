// `tokency serve`: arranca el core. Lo ejecuta el LaunchAgent.

import { startCore, tokencyPaths } from "@tokency/core";

import { VERSION } from "../version.ts";

export async function serveCommand(): Promise<number> {
  let core;
  try {
    // TOKENCY_TOKEN solo existe para pruebas locales (ver hook.ts).
    core = await startCore({
      paths: tokencyPaths(),
      version: VERSION,
      token: process.env.TOKENCY_TOKEN,
    });
  } catch (error) {
    // launchd reintenta según ThrottleInterval; stderr queda en core.stderr.log.
    console.error("No se pudo iniciar el core:", error);
    return 1;
  }
  const running = core;
  await new Promise<void>((resolve) => {
    const stop = () => {
      void running.close().finally(resolve);
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
  return 0;
}
