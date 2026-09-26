// esbuild reemplaza `__TOKENCY_VERSION__` al compilar; desde el código fuente vale "dev".
declare const __TOKENCY_VERSION__: string | undefined;

export const VERSION: string =
  typeof __TOKENCY_VERSION__ === "string" ? __TOKENCY_VERSION__ : "dev";
