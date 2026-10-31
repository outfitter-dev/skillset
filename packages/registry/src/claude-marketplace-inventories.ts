/**
 * Current offline inventories, shared by Core consumers. The evidence ledger
 * qualifies their provenance; these constants do not assert runtime authority.
 */
/**
 * Claude plugin manifest field types, shared by `plugin.json` and marketplace
 * plugin entries: a marketplace entry may carry any manifest field, so the
 * same content must validate the same way in either file. The evidence ledger records which
 * constraints are schema-backed and which still need external qualification.
 */
export const CLAUDE_PLUGIN_FIELD_TYPES = {
  $schema: "string",
  agents: "string-or-string-array",
  author: "object",
  category: "string",
  channels: "array",
  commands: "string-object-or-array",
  defaultEnabled: "boolean",
  dependencies: "array",
  description: "string",
  displayName: "string",
  experimental: "object",
  homepage: "string",
  hooks: "string-object-or-array",
  keywords: "string-array",
  license: "string",
  lspServers: "string-object-or-array",
  mcpServers: "string-object-or-array",
  metadata: "object",
  monitors: "string-or-array",
  outputStyles: "string-or-string-array",
  relevance: "object",
  repository: "string",
  settings: "object",
  skills: "string-or-string-array",
  strict: "boolean",
  tags: "string-array",
  themes: "string-or-string-array",
  userConfig: "object",
  version: "string",
  workflows: "string-or-string-array",
} as const;

/**
 * Existing offline extensions absent from the pinned schema. Their runtime
 * authority remains unresolved in the evidence ledger.
 */
export const CLAUDE_UNPINNED_PLUGIN_FIELDS = ["experimental", "workflows"] as const;

export const CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS = {
  archive: ["url"],
  command: ["command"],
  github: ["repo"],
  "git-subdir": ["url", "path"],
  npm: ["package"],
  url: ["url"],
} as const;

export const CLAUDE_MARKETPLACE_SOURCE_FIELD_TYPES = {
  archive: { sha256: "string", url: "string" },
  command: { command: "string", mode: "string", timeout: "number" },
  github: { ref: "string", repo: "string", sha: "string" },
  "git-subdir": { path: "string", ref: "string", sha: "string", url: "string" },
  npm: { package: "string", registry: "string", version: "string" },
  url: { ref: "string", sha: "string", url: "string" },
} as const;
