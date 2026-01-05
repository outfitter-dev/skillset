/**
 * @skillset/core - Core library for skillset
 *
 * Tokenizer, resolver, indexer, cache, config, format, hooks, tree utilities
 */

// Re-export types from @skillset/types
export type {
  CacheSchema,
  ConfigSchema,
  GeneratedSettingsSchema,
  InjectOutcome,
  InvocationToken,
  ProjectIdStrategy,
  ProjectSettings,
  ResolveResult,
  RuleSeverity,
  Scope,
  SetDefinition,
  Skill,
  SkillEntry,
  SkillRef,
  SkillSet,
  SkillSource,
  Tool,
} from "@skillset/types";

// Cache
export {
  CACHE_PATHS,
  isStructureFresh,
  loadCaches,
  updateCache,
  writeCache,
} from "./cache";
// Config
export {
  CONFIG_DEFAULTS,
  CONFIG_PATHS,
  cleanupGeneratedConfig,
  deleteConfigValue,
  ensureConfigFiles,
  getConfigPath,
  getConfigValue,
  loadConfig,
  loadGeneratedSettings,
  loadYamlConfigByScope,
  resetGeneratedConfigValue,
  setConfigValue,
  setGeneratedConfigValue,
  writeGeneratedSettings,
  writeYamlConfig,
} from "./config";
// Format
export { formatOutcome, stripFrontmatter } from "./format";
// Hooks
export { runUserPromptSubmitHook } from "./hooks/hook-runner";
// Indexer
export { indexSkills } from "./indexer";
// Normalize
export { normalizeTokenRef, normalizeTokenSegment } from "./normalize";
// Resolver
export { resolveToken, resolveTokens } from "./resolver";
// Tokenizer
export { tokenizePrompt } from "./tokenizer";

// Tree
export {
  buildDirectoryTreeLines,
  buildNamespaceTree,
  buildPathTree,
  buildSkillTree,
  headingsToTreeObject,
  isNamespaceRef,
  parseMarkdownHeadings,
} from "./tree";
