/** Strict tut field types from the pinned Claude 2.1.269 shared LSP schema. */
export const CLAUDE_LSP_FIELD_TYPES = {
  args: "string-array", command: "string", diagnostics: "boolean", env: "object",
  extensionToLanguage: "object", maxRestarts: "number", restartOnCrash: "boolean",
  shutdownTimeout: "number", startupTimeout: "number", transport: "string",
  workspaceFolder: "string",
} as const;
