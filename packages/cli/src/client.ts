// Cliente de la API local para los comandos del CLI.

import { loadConfig, readSecret, TOKEN_REF, type TokencyPaths } from "@tokency/core";

export interface CoreClient {
  port: number;
  get<T>(route: string, timeoutMs?: number): Promise<T>;
}

export class CoreUnavailableError extends Error {
  override name = "CoreUnavailableError";
}

export async function coreClient(paths: TokencyPaths): Promise<CoreClient> {
  const port = loadConfig(paths.configFile).config.port;
  const token = process.env.TOKENCY_TOKEN ?? (await readSecret(TOKEN_REF));
  if (token === null) {
    throw new CoreUnavailableError("No hay token en el Llavero. Ejecuta `tokency install`.");
  }
  return {
    port,
    async get<T>(route: string, timeoutMs = 2_000): Promise<T> {
      let response: Response;
      try {
        response = await fetch(`http://127.0.0.1:${String(port)}${route}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new CoreUnavailableError(
          `El core no responde en el puerto ${String(port)}. Revisa \`tokency doctor\`.`,
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new Error(`El core respondió ${String(response.status)} en ${route}.`);
      }
      return (await response.json()) as T;
    },
  };
}
