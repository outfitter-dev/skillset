/** Input parser vocabulary from Claude 2.1.269 Im; separate from rendering capabilities. */
export const CLAUDE_INLINE_HOOK_EVENTS = [
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Notification",
  "UserPromptSubmit", "UserPromptExpansion", "SessionStart", "SessionEnd", "Stop",
  "StopFailure", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact",
  "PreModelSwitch", "PostModelSwitch", "PermissionRequest", "PermissionDenied", "Setup",
  "TeammateIdle", "TaskCreated", "TaskCompleted", "Elicitation", "ElicitationResult",
  "ConfigChange", "WorktreeCreate", "WorktreeRemove", "InstructionsLoaded", "CwdChanged",
  "FileChanged", "DirectoryAdded", "MessageDisplay",
] as const;

const common = { if: "string", timeout: "number", statusMessage: "string", once: "boolean" } as const;
/** Rd/PMe uses stripping objects. Unknown fields and command/http cloud catches do not reject input. */
export const CLAUDE_INLINE_HOOK_HANDLERS = {
  command: { required: ["command"], fields: { ...common, command: "string", args: "string-array", shell: "string", async: "boolean", asyncRewake: "boolean", rewakeMessage: "string", rewakeSummary: "string" } },
  prompt: { required: ["prompt"], fields: { ...common, prompt: "string", model: "string", continueOnBlock: "boolean" } },
  agent: { required: ["prompt"], fields: { ...common, prompt: "string", model: "string" } },
  http: { required: ["url"], fields: { ...common, url: "string", headers: "object", allowedEnvVars: "string-array" } },
  mcp_tool: { required: ["server", "tool"], fields: { ...common, server: "string", tool: "string", input: "object" } },
} as const;
