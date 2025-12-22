/**
 * @skillset/core - Core library for skillset
 *
 * Tokenizer, resolver, indexer, cache, config, format, hooks, tree utilities
 */

// Re-export types from @skillset/types
export type {
  Mode,
  Skill,
  SkillRef,
  SkillSource,
  CacheSchema,
  MappingEntry,
  ConfigSchema,
  ResolveResult,
  InvocationToken,
  InjectOutcome,
} from "@skillset/types";

// Tokenizer
export { tokenizePrompt } from "./tokenizer";

// Resolver
export { resolveToken, resolveTokens } from "./resolver";

// Indexer
export { indexSkills } from "./indexer";

// Cache
export {
  loadCaches,
  writeCacheSync,
  updateCacheSync,
  isStructureFresh,
  CACHE_PATHS,
} from "./cache";

// Config
export {
  loadConfig,
  writeConfig,
  readConfigByScope,
  getConfigPath,
  getConfigValue,
  setConfigValue,
  modeLabel,
  CONFIG_PATHS,
} from "./config";

// Format
export { formatOutcome, stripFrontmatter } from "./format";

// Hooks
export { runUserPromptSubmitHook } from "./hooks/hook-runner";

// Tree
export {
  buildSkillTree,
  buildNamespaceTree,
  buildPathTree,
  isNamespaceRef,
  parseMarkdownHeadings,
  headingsToTreeObject,
} from "./tree";
