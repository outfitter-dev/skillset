/**
 * @skillset/core - Core library for skillset
 *
 * Tokenizer, resolver, indexer, cache, config, format, hooks, tree utilities
 */

// Re-export types from @skillset/types
export type {
  CacheSchema,
  ConfigSchema,
  InjectOutcome,
  InvocationToken,
  MappingEntry,
  Mode,
  ResolveResult,
  Skill,
  SkillRef,
  SkillSource,
} from "@skillset/types";
// Cache
export {
  CACHE_PATHS,
  isStructureFresh,
  loadCaches,
  updateCacheSync,
  writeCacheSync,
} from "./cache";
// Config
export {
  CONFIG_PATHS,
  getConfigPath,
  getConfigValue,
  loadConfig,
  modeLabel,
  readConfigByScope,
  setConfigValue,
  writeConfig,
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
  buildNamespaceTree,
  buildDirectoryTreeLines,
  buildPathTree,
  buildSkillTree,
  headingsToTreeObject,
  isNamespaceRef,
  parseMarkdownHeadings,
} from "./tree";
