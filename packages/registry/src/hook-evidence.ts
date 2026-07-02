import {
  getProviderSchemaSnapshot,
  type ProviderSchemaSetEntry,
  type ProviderSchemaSetSummary,
  type ProviderSchemaTarget,
} from "./schema-snapshots";

export type ProviderHookEvidenceTarget = ProviderSchemaTarget;

export type ProviderHookEvidenceKind =
  | "docs-backed-overlay"
  | "schema-backed"
  | "deferred-explicit"
  | "unsupported";

export type ProviderHookMatcherKind =
  | "agent-type"
  | "compact-trigger"
  | "config-source"
  | "file-name"
  | "ignored"
  | "instructions-load-reason"
  | "mcp-server"
  | "none"
  | "notification-type"
  | "prompt-command"
  | "session-source"
  | "session-end-reason"
  | "setup-trigger"
  | "stop-failure-error"
  | "tool";

export type ProviderHookMatcherEvaluation =
  | "exact-list-or-regex"
  | "exact-values"
  | "file-watch-list"
  | "ignored"
  | "provider-native";

export interface ProviderHookFieldEvidence {
  readonly name: string;
  readonly required: boolean;
}

export interface ProviderHookHandlerEvidence {
  readonly fields: readonly string[];
  readonly skippedFields?: readonly string[];
  readonly type: string;
}

export interface ProviderHookEventEvidence {
  readonly canBlock: boolean;
  readonly evidenceKind: ProviderHookEvidenceKind;
  readonly handlerTypes: readonly string[];
  readonly inputFields: readonly ProviderHookFieldEvidence[];
  readonly matcherEvaluation: ProviderHookMatcherEvaluation;
  readonly matcherKind: ProviderHookMatcherKind;
  readonly matcherValues: readonly string[];
  readonly name: string;
  readonly outputFields: readonly string[];
  readonly providerRef: string;
  readonly rawOutputFields: readonly string[];
  readonly runtimeNotes: readonly string[];
  readonly unsupportedOutputFields: readonly string[];
}

export interface ProviderHookConfigEvidence {
  readonly groupFields: readonly string[];
  readonly handlerCommonFields: readonly string[];
  readonly rootFields: readonly string[];
}

export interface ProviderHookEvidence {
  readonly config: ProviderHookConfigEvidence;
  readonly events: readonly ProviderHookEventEvidence[];
  readonly evidenceKind: ProviderHookEvidenceKind;
  readonly handlerTypes: readonly ProviderHookHandlerEvidence[];
  readonly providerRef: string;
  readonly sources: readonly string[];
  readonly target: ProviderHookEvidenceTarget;
}

const CLAUDE_COMMON_INPUT_FIELDS = ["session_id", "transcript_path", "cwd", "hook_event_name"] as const;
const CLAUDE_STANDARD_OUTPUT_FIELDS = [
  "continue",
  "hookSpecificOutput",
  "stopReason",
  "suppressOutput",
  "systemMessage",
] as const;

const CLAUDE_TOOL_INPUT_FIELDS = ["tool_name", "tool_input"] as const;
const CLAUDE_TOOL_OUTPUT_FIELDS = ["decision", "permissionDecision", "permissionDecisionReason", "reason"] as const;
const CLAUDE_AGENT_INPUT_FIELDS = ["agent_id", "agent_type"] as const;

const CLAUDE_ALL_HANDLER_EVENTS: ReadonlySet<string> = new Set([
  "PermissionDenied",
  "PermissionRequest",
  "PostToolBatch",
  "PostToolUse",
  "PostToolUseFailure",
  "PreToolUse",
  "Stop",
  "SubagentStop",
  "TaskCompleted",
  "TaskCreated",
  "TeammateIdle",
  "UserPromptExpansion",
  "UserPromptSubmit",
]);

const claudeHookEvidence = defineProviderHookEvidence({
  config: {
    groupFields: ["matcher", "hooks", "statusMessage"],
    handlerCommonFields: ["type", "timeout", "async", "if"],
    rootFields: ["description", "hooks"],
  },
  events: [
    claudeEvent("ConfigChange", "config-source", ["user_settings", "project_settings", "local_settings", "policy_settings", "skills"], ["config"], true),
    claudeEvent("CwdChanged", "ignored", [], ["cwd"], false),
    claudeEvent("Elicitation", "mcp-server", [], ["server_name", "request"], true),
    claudeEvent("ElicitationResult", "mcp-server", [], ["server_name", "response"], true),
    claudeEvent("FileChanged", "file-name", [], ["file_path"], false, { matcherEvaluation: "file-watch-list" }),
    claudeEvent("InstructionsLoaded", "instructions-load-reason", ["session_start", "nested_traversal", "path_glob_match", "include", "compact"], ["reason", "path"], false),
    claudeEvent("MessageDisplay", "ignored", [], ["message"], false),
    claudeEvent("Notification", "notification-type", ["permission_prompt", "idle_prompt", "auth_success", "elicitation_dialog", "elicitation_complete", "elicitation_response"], ["type", "message"], false),
    claudeEvent("PermissionDenied", "tool", [], [...CLAUDE_TOOL_INPUT_FIELDS, "reason"], false, { outputFields: ["hookSpecificOutput", "retry"] }),
    claudeEvent("PermissionRequest", "tool", [], [...CLAUDE_TOOL_INPUT_FIELDS, "permission"], true, { outputFields: [...CLAUDE_STANDARD_OUTPUT_FIELDS, ...CLAUDE_TOOL_OUTPUT_FIELDS] }),
    claudeEvent("PostCompact", "compact-trigger", ["manual", "auto"], ["trigger"], false),
    claudeEvent("PostToolBatch", "ignored", [], ["tool_results"], true),
    claudeEvent("PostToolUseFailure", "tool", [], [...CLAUDE_TOOL_INPUT_FIELDS, "error"], false, { outputFields: [...CLAUDE_STANDARD_OUTPUT_FIELDS, ...CLAUDE_TOOL_OUTPUT_FIELDS] }),
    claudeEvent("PreToolUse", "tool", [], CLAUDE_TOOL_INPUT_FIELDS, true, { outputFields: [...CLAUDE_STANDARD_OUTPUT_FIELDS, ...CLAUDE_TOOL_OUTPUT_FIELDS] }),
    claudeEvent("PostToolUse", "tool", [], [...CLAUDE_TOOL_INPUT_FIELDS, "tool_response"], false, { outputFields: [...CLAUDE_STANDARD_OUTPUT_FIELDS, ...CLAUDE_TOOL_OUTPUT_FIELDS] }),
    claudeEvent("PreCompact", "compact-trigger", ["manual", "auto"], ["trigger"], true),
    claudeEvent("SessionEnd", "session-end-reason", ["clear", "resume", "logout", "prompt_input_exit", "bypass_permissions_disabled", "other"], ["reason"], false),
    claudeEvent("SessionStart", "session-source", ["startup", "resume", "clear", "compact"], ["source"], false),
    claudeEvent("Setup", "setup-trigger", ["init", "maintenance"], ["trigger"], false),
    claudeEvent("Stop", "ignored", [], ["last_assistant_message", "stop_hook_active"], true),
    claudeEvent("StopFailure", "stop-failure-error", ["rate_limit", "overloaded", "authentication_failed", "oauth_org_not_allowed", "billing_error", "invalid_request", "model_not_found", "server_error", "max_output_tokens", "unknown"], ["error"], false, { outputFields: [], rawOutputFields: CLAUDE_STANDARD_OUTPUT_FIELDS, runtimeNotes: ["output-and-exit-code-ignored"], unsupportedOutputFields: CLAUDE_STANDARD_OUTPUT_FIELDS }),
    claudeEvent("SubagentStart", "agent-type", [], CLAUDE_AGENT_INPUT_FIELDS, false),
    claudeEvent("SubagentStop", "agent-type", [], [...CLAUDE_AGENT_INPUT_FIELDS, "last_assistant_message", "stop_hook_active"], true),
    claudeEvent("TaskCompleted", "ignored", [], ["task_id"], true),
    claudeEvent("TaskCreated", "ignored", [], ["task_id"], true),
    claudeEvent("TeammateIdle", "ignored", [], ["teammate_id"], true),
    claudeEvent("UserPromptExpansion", "prompt-command", [], ["command", "prompt"], true),
    claudeEvent("UserPromptSubmit", "ignored", [], ["prompt"], true),
    claudeEvent("WorktreeCreate", "ignored", [], ["path"], true, { runtimeNotes: ["any-nonzero-exit-blocks"] }),
    claudeEvent("WorktreeRemove", "ignored", [], ["path"], false),
  ],
  evidenceKind: "docs-backed-overlay",
  handlerTypes: [
    { type: "agent", fields: ["type", "agent", "prompt", "timeout", "if"] },
    { type: "command", fields: ["type", "command", "args", "timeout", "async", "if"] },
    { type: "http", fields: ["type", "url", "headers", "timeout", "async", "if"] },
    { type: "mcp_tool", fields: ["type", "name", "input", "timeout", "async", "if"] },
    { type: "prompt", fields: ["type", "prompt", "timeout", "if"] },
  ],
  providerRef: "claude-hooks-overlay",
  sources: ["https://code.claude.com/docs/en/hooks"],
  target: "claude",
});

const CODEX_EVENT_FACTS = [
  codexFact("PreToolUse", "pre-tool-use", "tool", true),
  codexFact("PermissionRequest", "permission-request", "tool", true),
  codexFact("PostToolUse", "post-tool-use", "tool", false),
  codexFact("PreCompact", "pre-compact", "compact-trigger", true, { matcherValues: ["manual", "auto"] }),
  codexFact("PostCompact", "post-compact", "compact-trigger", false, { matcherValues: ["manual", "auto"] }),
  codexFact("SessionStart", "session-start", "session-source", false, { matcherValues: ["startup", "resume", "clear", "compact"] }),
  codexFact("SubagentStart", "subagent-start", "agent-type", false),
  codexFact("SubagentStop", "subagent-stop", "agent-type", true),
  codexFact("UserPromptSubmit", "user-prompt-submit", "ignored", true),
  codexFact("Stop", "stop", "ignored", true),
] as const;

const CODEX_SUPPORTED_OUTPUT_FIELDS_BY_EVENT: Readonly<Record<string, readonly string[]>> = {
  PermissionRequest: ["hookSpecificOutput", "systemMessage"],
  PostCompact: ["continue", "stopReason", "systemMessage"],
  PostToolUse: ["continue", "decision", "hookSpecificOutput", "reason", "stopReason", "systemMessage"],
  PreCompact: ["continue", "stopReason", "systemMessage"],
  PreToolUse: ["decision", "hookSpecificOutput", "reason", "systemMessage"],
  SessionStart: ["continue", "hookSpecificOutput", "stopReason", "systemMessage"],
  Stop: ["continue", "decision", "reason", "stopReason", "systemMessage"],
  SubagentStart: ["hookSpecificOutput", "systemMessage"],
  SubagentStop: ["continue", "decision", "reason", "stopReason", "systemMessage"],
  UserPromptSubmit: ["continue", "decision", "hookSpecificOutput", "reason", "stopReason", "systemMessage"],
} as const;

const CODEX_HOOK_EVENT_SNAPSHOT = getProviderSchemaSnapshot("codex-hook-event-schemas");
const CODEX_HOOK_EVENT_ENTRIES = readProviderSchemaSetEntries(CODEX_HOOK_EVENT_SNAPSHOT?.summary);

const codexHookEvidence = defineProviderHookEvidence({
  config: {
    groupFields: ["matcher", "hooks", "statusMessage"],
    handlerCommonFields: ["type", "command", "timeout", "async"],
    rootFields: ["hooks"],
  },
  events: CODEX_EVENT_FACTS.map(codexEvent),
  evidenceKind: "schema-backed",
  handlerTypes: [
    { type: "command", fields: ["type", "command", "timeout", "async"], skippedFields: ["async"] },
  ],
  providerRef: "codex-hooks-schema",
  sources: [
    "https://developers.openai.com/codex/hooks",
    "https://json.schemastore.org/codex-hooks.json",
    "https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/",
  ],
  target: "codex",
});

const providerHookEvidence = {
  claude: claudeHookEvidence,
  codex: codexHookEvidence,
} as const satisfies Readonly<Record<ProviderHookEvidenceTarget, ProviderHookEvidence>>;

export function listProviderHookEvidence(): readonly ProviderHookEvidence[] {
  return [providerHookEvidence.claude, providerHookEvidence.codex];
}

export function getProviderHookEvidence(target: ProviderHookEvidenceTarget): ProviderHookEvidence {
  return providerHookEvidence[target];
}

function defineProviderHookEvidence(evidence: ProviderHookEvidence): ProviderHookEvidence {
  return {
    ...evidence,
    events: [...evidence.events].sort((left, right) => left.name.localeCompare(right.name)),
    handlerTypes: [...evidence.handlerTypes].sort((left, right) => left.type.localeCompare(right.type)),
  };
}

function claudeEvent(
  name: string,
  matcherKind: ProviderHookMatcherKind,
  matcherValues: readonly string[],
  inputFields: readonly string[],
  canBlock: boolean,
  options: {
    readonly matcherEvaluation?: ProviderHookMatcherEvaluation;
    readonly outputFields?: readonly string[];
    readonly rawOutputFields?: readonly string[];
    readonly runtimeNotes?: readonly string[];
    readonly unsupportedOutputFields?: readonly string[];
  } = {}
): ProviderHookEventEvidence {
  const matcherEvaluation = options.matcherEvaluation ?? (matcherKind === "ignored" ? "ignored" : matcherValues.length > 0 ? "exact-values" : "exact-list-or-regex");
  const outputFields = uniqueSorted(options.outputFields ?? CLAUDE_STANDARD_OUTPUT_FIELDS);
  const rawOutputFields = uniqueSorted(options.rawOutputFields ?? outputFields);
  const unsupportedOutputFields = uniqueSorted(options.unsupportedOutputFields ?? []);
  return {
    canBlock,
    evidenceKind: "docs-backed-overlay",
    handlerTypes: claudeHandlerTypesForEvent(name),
    inputFields: fields([...CLAUDE_COMMON_INPUT_FIELDS, ...inputFields], CLAUDE_COMMON_INPUT_FIELDS),
    matcherEvaluation,
    matcherKind,
    matcherValues,
    name,
    outputFields,
    providerRef: "claude-hooks-overlay",
    rawOutputFields,
    runtimeNotes: options.runtimeNotes ?? [],
    unsupportedOutputFields,
  };
}

function claudeHandlerTypesForEvent(event: string): readonly string[] {
  if (CLAUDE_ALL_HANDLER_EVENTS.has(event)) return ["agent", "command", "http", "mcp_tool", "prompt"];
  if (event === "SessionStart" || event === "Setup") return ["command", "mcp_tool"];
  return ["command", "http", "mcp_tool"];
}

function codexFact(
  name: string,
  schemaPrefix: string,
  matcherKind: ProviderHookMatcherKind,
  canBlock: boolean,
  options: {
    readonly matcherValues?: readonly string[];
    readonly runtimeNotes?: readonly string[];
  } = {}
): {
  readonly canBlock: boolean;
  readonly matcherKind: ProviderHookMatcherKind;
  readonly matcherValues: readonly string[];
  readonly name: string;
  readonly runtimeNotes: readonly string[];
  readonly schemaPrefix: string;
} {
  return {
    canBlock,
    matcherKind,
    matcherValues: options.matcherValues ?? [],
    name,
    runtimeNotes: options.runtimeNotes ?? [],
    schemaPrefix,
  };
}

function codexEvent(fact: (typeof CODEX_EVENT_FACTS)[number]): ProviderHookEventEvidence {
  const input = codexSchemaEntry(`${fact.schemaPrefix}.command.input`);
  const output = codexSchemaEntry(`${fact.schemaPrefix}.command.output`);
  const rawOutputFields = uniqueSorted(output?.properties ?? []);
  const outputFields = supportedCodexOutputFields(fact.name, rawOutputFields);
  const unsupportedOutputFields = rawOutputFields.filter((field) => !outputFields.includes(field));
  const matcherEvaluation = fact.matcherKind === "ignored" ? "ignored" : fact.matcherValues.length > 0 ? "exact-values" : "provider-native";
  const runtimeNotes = [
    ...fact.runtimeNotes,
    ...(matcherEvaluation === "provider-native" ? ["matcher-values-provider-native"] : []),
    ...(fact.name === "PermissionRequest" ? ["command-event-schema-only"] : []),
  ];
  return {
    canBlock: fact.canBlock,
    evidenceKind: "schema-backed",
    handlerTypes: ["command"],
    inputFields: input === undefined ? [] : fields(input.properties, input.required),
    matcherEvaluation,
    matcherKind: fact.matcherKind,
    matcherValues: fact.matcherValues,
    name: fact.name,
    outputFields,
    providerRef: "codex-hook-event-schemas",
    rawOutputFields,
    runtimeNotes,
    unsupportedOutputFields,
  };
}

function supportedCodexOutputFields(event: string, rawOutputFields: readonly string[]): readonly string[] {
  const supported = CODEX_SUPPORTED_OUTPUT_FIELDS_BY_EVENT[event] ?? [];
  return uniqueSorted(supported.filter((field) => rawOutputFields.includes(field)));
}

function codexSchemaEntry(title: string): ProviderSchemaSetEntry | undefined {
  return CODEX_HOOK_EVENT_ENTRIES.find((entry) => entry.title === title);
}

function fields(names: readonly string[], required: readonly string[]): readonly ProviderHookFieldEvidence[] {
  const requiredSet = new Set(required);
  return uniqueSorted(names).map((name) => ({ name, required: requiredSet.has(name) }));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function readProviderSchemaSetEntries(value: unknown): readonly ProviderSchemaSetEntry[] {
  if (!isSchemaSetSummary(value)) return [];
  const entries = Array.isArray(value.entries) ? value.entries : [];
  return entries.filter(isProviderSchemaSetEntry).map((entry) => ({
    contentHash: entry.contentHash,
    name: entry.name,
    properties: [...entry.properties],
    required: [...entry.required],
    title: entry.title,
    url: entry.url,
  }));
}

function isSchemaSetSummary(value: unknown): value is ProviderSchemaSetSummary {
  return value !== null && typeof value === "object" && "schemaCount" in value && "entries" in value;
}

function isProviderSchemaSetEntry(value: unknown): value is ProviderSchemaSetEntry {
  return value !== null &&
    typeof value === "object" &&
    "contentHash" in value &&
    typeof value.contentHash === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "properties" in value &&
    Array.isArray(value.properties) &&
    value.properties.every((item) => typeof item === "string") &&
    "required" in value &&
    Array.isArray(value.required) &&
    value.required.every((item) => typeof item === "string") &&
    "title" in value &&
    typeof value.title === "string" &&
    "url" in value &&
    typeof value.url === "string";
}
