export const CLI_COMMANDS = [
  "init",
  "import",
  "new",
  "check",
  "dev",
  "reconcile",
  "build",
  "update",
  "diff",
  "restore",
  "status",
  "list",
  "explain",
  "lookup",
  "test",
  "change",
  "release",
  "marketplace",
  "distribute",
  "hooks",
] as const;

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

export const CLI_ENVIRONMENT = {
  SKILLSET_HOOK_COMMAND:
    "Override the Skillset executable used by an explicitly installed hook integration.",
  SKILLSET_HOOK_EVENT:
    "Carry the normalized hook event into an explicit hook command.",
  SKILLSET_PROVIDER:
    "Carry the selected provider into an explicit hook command.",
  SKILLSET_SESSION_ID:
    "Carry the provider session id into an explicit hook command.",
  SKILLSET_TEST_CLAUDE_BIN:
    "Override the Claude executable for an explicit ad hoc or declared runtime test.",
  SKILLSET_TEST_CLAUDE_SETTING_SOURCES:
    "Set the default Claude setting-source isolation for an explicit runtime test.",
  SKILLSET_TEST_CODEX_BIN:
    "Override the Codex executable for an explicit ad hoc or declared runtime test.",
  SKILLSET_TEST_CURSOR_BIN:
    "Override the Cursor executable for an explicit ad hoc or declared runtime test.",
} as const;

export const RETIRED_CLI_ENVIRONMENT = [
  "SKILLSET_TRY_CLAUDE_BIN",
  "SKILLSET_TRY_CLAUDE_SETTING_SOURCES",
  "SKILLSET_TRY_CODEX_BIN",
  "SKILLSET_TRY_CURSOR_BIN",
] as const;

type FlagFamily =
  | "context"
  | "input"
  | "mode"
  | "mutation"
  | "output"
  | "selection";

export interface CliFlagContract {
  readonly family: FlagFamily;
  readonly value: "boolean" | "optional-value" | "repeatable-value" | "value";
  readonly meaning: string;
}

export const CLI_FLAGS = {
  "--adopt": {
    family: "mode",
    meaning: "Select detected adoption candidates by stable id, or all.",
    value: "repeatable-value",
  },
  "--agent-runtime": {
    family: "mode",
    meaning: "Render provider agent-runtime hook guidance.",
    value: "boolean",
  },
  "--all": {
    family: "selection",
    meaning:
      "Select every configured generated output rather than updated output.",
    value: "boolean",
  },
  "--append": {
    family: "mutation",
    meaning: "Append to an existing pending change reason.",
    value: "boolean",
  },
  "--background": {
    family: "mode",
    meaning: "Queue an ad hoc test and return after recording it.",
    value: "boolean",
  },
  "--bump": {
    family: "input",
    meaning: "Set the release impact of a change entry.",
    value: "value",
  },
  "--ci": {
    family: "mode",
    meaning: "Run check with strict non-interactive CI policy and reporting.",
    value: "boolean",
  },
  "--claude-setting-sources": {
    family: "input",
    meaning:
      "Select Claude-native setting sources for an explicit Claude ad hoc test.",
    value: "value",
  },
  "--compat": {
    family: "selection",
    meaning: "Filter lookup facts by one or more providers.",
    value: "optional-value",
  },
  "--context-fields": {
    family: "selection",
    meaning: "Select normalized hook runtime context fields.",
    value: "value",
  },
  "--event": {
    family: "input",
    meaning: "Select the hook runtime event to normalize.",
    value: "value",
  },
  "--events": {
    family: "selection",
    meaning: "Show lookup event facts.",
    value: "boolean",
  },
  "--examples": {
    family: "selection",
    meaning: "Show lookup examples.",
    value: "boolean",
  },
  "--field": {
    family: "selection",
    meaning: "Select one lookup field path.",
    value: "value",
  },
  "--fields": {
    family: "selection",
    meaning: "Show lookup field facts.",
    value: "boolean",
  },
  "--fix": {
    family: "mutation",
    meaning:
      "With check --ci, repair the ordinary drift allowed by local check --write.",
    value: "boolean",
  },
  "--format": {
    family: "output",
    meaning:
      "Select a protocol command encoding such as hook context env or json.",
    value: "value",
  },
  "--from": {
    family: "input",
    meaning:
      "Identify the external path, Git URL, or provider origin supplying input.",
    value: "value",
  },
  "--frontmatter": {
    family: "selection",
    meaning: "Show lookup frontmatter facts.",
    value: "boolean",
  },
  "--group": {
    family: "selection",
    meaning: "Select or assign a change group.",
    value: "value",
  },
  "--help": {
    family: "output",
    meaning: "Print help for the selected command route.",
    value: "boolean",
  },
  "--id": {
    family: "input",
    meaning: "Set an explicit stable source-unit id.",
    value: "value",
  },
  "--in": {
    family: "selection",
    meaning: "Select the containing plugin for a new source unit.",
    value: "value",
  },
  "--include": {
    family: "selection",
    meaning: "Include an optional init scaffold component.",
    value: "repeatable-value",
  },
  "--isolated": {
    family: "mode",
    meaning:
      "Use the isolated generated-output mirror instead of live output roots.",
    value: "boolean",
  },
  "--kind": {
    family: "selection",
    meaning: "Select the import source kind.",
    value: "value",
  },
  "--lines": {
    family: "selection",
    meaning: "Limit retained test output lines.",
    value: "value",
  },
  "--name": {
    family: "input",
    meaning:
      "Set a route-specific human or stable name where the route permits it.",
    value: "value",
  },
  "--only": {
    family: "selection",
    meaning: "Restrict check to one named readiness component.",
    value: "value",
  },
  "--plugin": {
    family: "selection",
    meaning: "Select plugins for an ad hoc test rendering.",
    value: "repeatable-value",
  },
  "--pre-commit": {
    family: "selection",
    meaning: "Select the pre-commit hook snippet.",
    value: "boolean",
  },
  "--pre-push": {
    family: "selection",
    meaning: "Select the pre-push hook snippet.",
    value: "boolean",
  },
  "--preset": {
    family: "input",
    meaning: "Apply a named new-source preset.",
    value: "repeatable-value",
  },
  "--prompt": {
    family: "input",
    meaning: "Provide an inline ad hoc test prompt.",
    value: "value",
  },
  "--prompt-file": {
    family: "input",
    meaning: "Provide a source-local ad hoc test prompt file.",
    value: "value",
  },
  "--reason": {
    family: "input",
    meaning: "Provide change or release reason text, with '-' meaning stdin.",
    value: "value",
  },
  "--reason-file": {
    family: "input",
    meaning: "Read change or release reason text from a file.",
    value: "value",
  },
  "--ref": {
    family: "selection",
    meaning: "Select a change or release record by reference.",
    value: "value",
  },
  "--report": {
    family: "output",
    meaning:
      "Write an additional command-owned report artifact without changing source truth.",
    value: "value",
  },
  "--root": {
    family: "context",
    meaning:
      "Select the repository root; defaults to cwd or Git root according to the route.",
    value: "value",
  },
  "--runner": {
    family: "selection",
    meaning: "Select the hook runner syntax to print.",
    value: "value",
  },
  "--schema": {
    family: "selection",
    meaning: "Show lookup schema facts.",
    value: "boolean",
  },
  "--scope": {
    family: "selection",
    meaning:
      "Select a route-owned source unit or generated destination scope; never changes workspace roots.",
    value: "repeatable-value",
  },
  "--since": {
    family: "selection",
    meaning: "Select the Git baseline for change-aware checks or ledgers.",
    value: "value",
  },
  "--staged": {
    family: "selection",
    meaning: "Restrict a change check or status read to staged changes.",
    value: "boolean",
  },
  "--target": {
    family: "selection",
    meaning: "Select one provider target for a route.",
    value: "value",
  },
  "--targets": {
    family: "selection",
    meaning: "Select the initial provider set written by init.",
    value: "value",
  },
  "--timeout-ms": {
    family: "mode",
    meaning: "Set the explicit ad hoc provider test timeout in milliseconds.",
    value: "value",
  },
  "--updated": {
    family: "selection",
    meaning:
      "Select only generated output affected by current source, the default build mode.",
    value: "boolean",
  },
  "--use": {
    family: "mode",
    meaning:
      "Select source or output as the authority for a reconciliation plan.",
    value: "value",
  },
  "--values": {
    family: "selection",
    meaning: "Show lookup finite-value facts.",
    value: "boolean",
  },
  "--write": {
    family: "mutation",
    meaning:
      "Enable deterministic ordinary output writes for a route whose default is continuous or comprehensive preview.",
    value: "boolean",
  },
  "--yes": {
    family: "mutation",
    meaning: "Confirm a fully specified plan-first mutation without prompting.",
    value: "boolean",
  },
} as const satisfies Readonly<Record<string, CliFlagContract>>;

export const CLI_ROUTE_FLAGS = {
  build: ["--all", "--isolated", "--root", "--scope", "--updated", "--yes"],
  "change add": [
    "--bump",
    "--group",
    "--reason",
    "--reason-file",
    "--root",
    "--scope",
    "--since",
  ],
  "change amend": ["--reason", "--reason-file", "--ref", "--root"],
  "change check": ["--ref", "--root", "--since", "--staged"],
  "change history": ["--ref", "--root"],
  "change list": ["--group", "--root"],
  "change migrate": ["--root", "--yes"],
  "change reason": ["--append", "--reason", "--reason-file", "--ref", "--root"],
  "change show": ["--ref", "--root"],
  "change status": ["--root", "--since", "--staged"],
  check: [
    "--ci",
    "--fix",
    "--only",
    "--report",
    "--root",
    "--since",
    "--write",
  ],
  dev: ["--root", "--write"],
  diff: ["--all", "--isolated", "--root", "--scope", "--updated"],
  "distribute plan": ["--root"],
  explain: ["--root", "--scope"],
  "hooks context": ["--context-fields", "--event", "--format", "--root"],
  "hooks print": [
    "--agent-runtime",
    "--pre-commit",
    "--pre-push",
    "--runner",
    "--target",
  ],
  "hooks run": ["--root"],
  import: ["--from", "--kind", "--name", "--root"],
  init: [
    "--adopt",
    "--from",
    "--include",
    "--name",
    "--root",
    "--targets",
    "--yes",
  ],
  list: ["--root", "--scope"],
  lookup: [
    "--compat",
    "--events",
    "--examples",
    "--field",
    "--fields",
    "--frontmatter",
    "--root",
    "--schema",
    "--values",
  ],
  "marketplace check": ["--root"],
  "marketplace update": ["--root", "--yes"],
  new: ["--id", "--in", "--name", "--preset", "--root", "--scope", "--yes"],
  reconcile: ["--root", "--use", "--yes"],
  "release amend": ["--reason", "--reason-file", "--ref", "--root"],
  "release apply": ["--root", "--yes"],
  "release audit": ["--root"],
  "release plan": ["--root"],
  restore: ["--root", "--yes"],
  status: ["--root"],
  test: [
    "--background",
    "--claude-setting-sources",
    "--name",
    "--plugin",
    "--prompt",
    "--prompt-file",
    "--root",
    "--target",
    "--timeout-ms",
  ],
  "test list": ["--root"],
  "test status": ["--root"],
  "test tail": ["--lines", "--root"],
  update: ["--root", "--yes"],
} as const;

export const STRUCTURED_OUTPUT_CANDIDATE_ROUTES = [
  "check",
  "explain",
  "list",
  "lookup",
  "marketplace check",
  "marketplace update",
  "status",
  "test",
  "test list",
  "test status",
  "test tail",
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];
export type CliFlag = keyof typeof CLI_FLAGS;
