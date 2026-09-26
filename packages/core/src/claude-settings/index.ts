export {
  commandContains,
  hasOwnHooks,
  isJsonObject,
  mergeOwnHooks,
  removeOwnHooks,
} from "./hooks.ts";
export {
  defaultClaudeSettingsPaths,
  installHooks,
  uninstallHooks,
  type ClaudeSettingsPaths,
  type HookFileOptions,
  type InstallOptions,
  type InstallResult,
  type UninstallResult,
} from "./settings-file.ts";
export {
  ConcurrentModificationError,
  InvalidSettingsError,
  type CommandHook,
  type HookMatcherGroup,
  type HooksConfig,
  type JsonObject,
  type JsonValue,
  type OwnershipTest,
} from "./types.ts";
