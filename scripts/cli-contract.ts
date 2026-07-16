export {
  CLI_COMMANDS,
  CLI_ENVIRONMENT,
  CLI_FLAGS,
  CLI_ROUTE_FLAGS,
  FINITE_JSON_ROUTES,
  HIDDEN_CLI_ROUTES,
  JSONL_ROUTES,
  STRUCTURED_OUTPUT_EXCEPTIONS,
} from "../apps/skillset/src/cli-contract";

export type {
  CliCommand,
  CliFlag,
  CliFlagContract,
} from "../apps/skillset/src/cli-contract";

export const RETIRED_CLI_COMMANDS = [
  "adopt",
  "ci",
  "create",
  "doctor",
  "features",
  "lint",
  "providers",
  "suggest-source",
  "try",
  "verify",
] as const;

export const RETIRED_CLI_FLAGS = [
  "--apply",
  "--claude",
  "--codex",
  "--cursor",
  "--dist",
  "--dry-run",
  "--global",
  "--layout",
  "--source",
  "--watch",
] as const;

export const RETIRED_CLI_ENVIRONMENT = [
  "SKILLSET_TRY_CLAUDE_BIN",
  "SKILLSET_TRY_CLAUDE_SETTING_SOURCES",
  "SKILLSET_TRY_CODEX_BIN",
  "SKILLSET_TRY_CURSOR_BIN",
] as const;
