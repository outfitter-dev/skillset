import { readFileSync, readdirSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";

import { lowerTransform, recognizeTransforms } from "@skillset/transforms";

import {
  resolveAdaptiveHookAttachments,
  type ResolvedAdaptiveHookAttachment,
} from "./adaptive-hook-attachments";
import { adaptiveHookUnsupportedRenderReason, type AdaptiveHookRenderSurface } from "./adaptive-hook-render-support";
import {
  isOutputSelected,
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
  stripSourceFrontmatter,
} from "./config";
import { storedClaudeMarketplaceProviderEntry } from "./claude-marketplace";
import {
  pluginDependencies,
  pluginDependencyHashSummaries,
  pluginDependencySummaries,
  renderClaudePluginDependencies,
  renderCodexDependencyNotice,
} from "./dependencies";
import { nativeHookEventName } from "./hook-capabilities";
import { validateHookDefinition } from "./hooks";
import { resolveLicense, type ResolvedLicense } from "./licenses";
import { marketplaceRequestedRefPolicy } from "./marketplace-ref-policy";
import { compareStrings, validateSlug } from "./path";
import { corruptWorkspaceLock } from "./output-safety";
import {
  claudeMarketplacePath,
  isDefaultPluginOutputRoot,
  pluginManifestPath,
  pluginTargetRoot,
  providerSourceForPlugin,
} from "./plugin-output";
import { rewriteResourceLinks } from "./resources";
import { parseRemoteRepositoryReference } from "./remote-repository-reference";
import {
  readAllowedTools,
  readClaudeNativeToolRules,
  readToolsPolicyMetadata,
  readImplicitInvocation,
} from "./skill-policy";
import { toolsMetadataSidecarTargets } from "./tools-realization";
import {
  formatPreprocessDependency,
  preprocessText,
  readPreprocessDependencySync,
} from "./preprocess";
import { renderChangelogProjections, type ChangelogProjection } from "./changelog";
import {
  renderValidatedJson,
  renderValidatedMarkdown,
  renderValidatedToml,
  renderValidatedYaml,
  validateGeneratedStructuredOutput,
} from "./structured-output";
import type {
  AppliedTransform,
  BuildGraph,
  JsonRecord,
  JsonValue,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  RenderedFile,
  SourceIslandFile,
  SourceOrigin,
  SourcePlugin,
  SourcePluginFeature,
  SourceProjectAgent,
  SourceRule,
  SourceResource,
  SourceSkill,
  StandaloneSkill,
  TargetName,
} from "./types";
import { targetNames } from "./targets";
import { pluginVersion, rootVersion, skillVersion, skillVersionLabel } from "./versioning";
import { isJsonRecord, parseMarkdown, parseYamlRecord, stringifyJson } from "./yaml";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const DEFAULT_CODEX_COLOR = "#B06DFF";
const COMPILER_ID = "skillset";
const COMPILER_VERSION = "0.1.0";
const GENERATED_BY = `${COMPILER_ID}@${COMPILER_VERSION}`;
const CLAUDE_RULES_OUTPUT_ROOT = ".claude/rules";
const WORKSPACE_LOCK_ROOT = ".";

interface LockItem {
  readonly feature?: string;
  readonly files: readonly string[];
  readonly dependencies?: readonly string[];
  readonly includedSkills?: readonly string[];
  readonly kind: "changelog" | "island" | "plugin" | "plugin-feature" | "plugin-skill" | "project-agent" | "rule" | "standalone-skill";
  readonly name: string;
  readonly origin?: string;
  readonly outputHash: string;
  readonly outputPath: string;
  readonly plugin?: string;
  readonly preprocessDependencies?: readonly string[];
  readonly renderInputsHash?: string;
  readonly skippedSkills?: readonly string[];
  readonly sourceHash: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly sourcePointer?: string;
  readonly targetState?: string;
  /** Build-time dialect transforms applied to this item, sorted by intent. */
  readonly transforms?: readonly AppliedTransform[];
  readonly validation?: "opaque-copy" | "structured";
  readonly version?: string;
}

interface TranslatedBody {
  readonly text: string;
  readonly transforms: readonly AppliedTransform[];
}

/**
 * Lower a Claude-dialect body into Codex surface forms. Every recognized
 * construct with a faithful Codex lowering (bidirectional or to-codex) is
 * replaced in place; replacements apply last-to-first by index so earlier
 * spans stay valid. `lowering: "none"` constructs pass through untouched —
 * lint owns those. Returns the applied intents with occurrence counts,
 * sorted by intent, for lock provenance.
 */
function translateClaudeDialect(body: string): TranslatedBody {
  const matches = recognizeTransforms(body, "claude");
  const counts = new Map<string, number>();
  let text = body;
  for (const match of [...matches].reverse()) {
    const lowered = lowerTransform(match, "codex");
    if (lowered === undefined) continue;
    text = `${text.slice(0, match.index)}${lowered}${text.slice(match.index + match.text.length)}`;
    counts.set(match.intent, (counts.get(match.intent) ?? 0) + 1);
  }
  const transforms = [...counts.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([intent, count]) => ({ count, intent }));
  return { text, transforms };
}

interface LockRoot {
  readonly items: LockItem[];
  readonly target: TargetName | "workspace";
}

interface RenderedIslandFile {
  readonly file: RenderedFile;
  readonly preprocessDependencies: readonly string[];
  readonly validation: "opaque-copy" | "structured";
}

interface RenderedProjectAgentFile {
  readonly file: RenderedFile;
  readonly preprocessDependencies: readonly string[];
  readonly target: TargetName;
}

interface RenderedRuleMarkdown {
  readonly content: string;
  readonly preprocessDependencies: readonly string[];
  readonly transforms?: readonly AppliedTransform[];
}

export async function renderBuildGraph(graph: BuildGraph): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const lockRoots = new Map<string, LockRoot>();
  rendered.push(...renderRepositoryReadmes(graph));
  rendered.push(...(await renderClaudeMarketplace(graph)));
  rendered.push(...(await renderCursorMarketplace(graph)));

  for (const plugin of graph.plugins) {
    for (const target of targetNames()) {
      rendered.push(...(await renderPluginTarget(graph, plugin, target, lockRoots)));
    }
  }

  for (const skill of graph.standaloneSkills) {
    for (const target of targetNames()) {
      rendered.push(...(await renderStandaloneSkill(graph, skill, target, lockRoots)));
    }
  }

  rendered.push(...(await renderProjectAgents(graph, lockRoots)));
  rendered.push(...(await renderRules(graph, lockRoots)));
  rendered.push(...(await renderProjectIslands(graph, lockRoots)));
  rendered.push(...(await renderChangelogs(graph, lockRoots)));
  if (Object.keys(graph.root.marketplaces).length > 0) {
    lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace");
  }
  rendered.push(...(await renderLockFiles(graph, lockRoots)));
  return [...coalesceRenderedFiles(rendered)]
    .sort((left, right) => compareStrings(left.path, right.path))
    .map((file) => validateRenderedFile(file));
}

function coalesceRenderedFiles(files: readonly RenderedFile[]): readonly RenderedFile[] {
  const byPath = new Map<string, RenderedFile>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (existing === undefined) {
      byPath.set(file.path, file);
      continue;
    }
    if (bytesEqual(existing.content, file.content)) continue;
    throw new Error(
      `skillset: generated output collision at ${file.path} from ` +
        `${existing.sourcePath ?? "generated output"} and ${file.sourcePath ?? "generated output"}`
    );
  }
  return [...byPath.values()];
}

function shouldRenderPlugin(graph: BuildGraph, plugin: SourcePlugin, target: TargetName): boolean {
  return (
    plugin.targets[target].enabled &&
    isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, plugin.id)
  );
}

function shouldRenderStandaloneSkill(
  graph: BuildGraph,
  skill: StandaloneSkill,
  target: TargetName
): boolean {
  return (
    skill.targets[target].enabled &&
    isOutputSelected(graph.root.outputs.targetOutputs[target].skills, skill.id)
  );
}

function renderRepositoryReadmes(graph: BuildGraph): readonly RenderedFile[] {
  const rendered: RenderedFile[] = [];
  const activeTargets = targetNames().filter((target) =>
    graph.plugins.some((plugin) => shouldRenderPlugin(graph, plugin, target))
  );
  const outputRoots = new Set(activeTargets.map((target) => graph.root.outputs.plugins[target]));
  if (outputRoots.size === 1 && activeTargets.length > 0) {
    const [outputRoot] = outputRoots;
    if (outputRoot !== undefined && isDefaultPluginOutputRoot(outputRoot)) {
      const bundleLines = activeTargets.map((target) =>
        `- \`<plugin-id>/${target}/\` contains each ${targetLabel(target)} plugin bundle.`
      );
      rendered.push(
        textFile(
          `${outputRoot}/README.md`,
          [
            "# Skillset Plugins",
            "",
            "Generated Skillset plugin repository.",
            "",
            ...bundleLines,
            "- `skillset.lock` records deterministic generated-state provenance.",
            "",
          ].join("\n")
        )
      );
      return rendered;
    }
  }
  for (const target of activeTargets) {
    const outputRoot = graph.root.outputs.plugins[target];
    rendered.push(
      textFile(
        `${outputRoot}/README.md`,
        [
          isDefaultPluginOutputRoot(outputRoot) ? "# Skillset Plugins" : `# ${targetLabel(target)} Plugins`,
          "",
          isDefaultPluginOutputRoot(outputRoot) ? "Generated Skillset plugin repository." : `Generated ${targetLabel(target)} plugin repository.`,
          "",
          ...marketplaceReadmeLines(outputRoot, target),
          "- `skillset.lock` records deterministic generated-state provenance.",
          "",
        ].join("\n")
      )
    );
  }
  return rendered;
}

function targetLabel(target: TargetName): string {
  if (target === "claude") return "Claude";
  if (target === "codex") return "Codex";
  return "Cursor";
}

function marketplaceReadmeLines(outputRoot: string, target: TargetName): readonly string[] {
  if (target === "claude") {
    return [
      isDefaultPluginOutputRoot(outputRoot) ? "- `../.claude-plugin/marketplace.json` indexes generated Claude plugins." : "- `.claude-plugin/marketplace.json` indexes the generated plugins.",
      isDefaultPluginOutputRoot(outputRoot) ? "- `<plugin-id>/claude/` contains each Claude plugin bundle." : "- `plugins/<plugin-id>/` contains each Claude plugin bundle.",
    ];
  }
  if (target === "cursor") {
    return [
      isDefaultPluginOutputRoot(outputRoot) ? "- `../.cursor-plugin/marketplace.json` indexes generated Cursor plugins." : "- `.cursor-plugin/marketplace.json` indexes the generated plugins.",
      isDefaultPluginOutputRoot(outputRoot) ? "- `<plugin-id>/cursor/` contains each Cursor plugin bundle." : "- `plugins/<plugin-id>/` contains each Cursor plugin bundle.",
    ];
  }
  return [
    isDefaultPluginOutputRoot(outputRoot) ? "- `<plugin-id>/codex/` contains each Codex plugin bundle." : "- `plugins/<plugin-id>/` contains each Codex plugin bundle.",
  ];
}

async function renderClaudeMarketplace(graph: BuildGraph): Promise<readonly RenderedFile[]> {
  const existingState = await readExistingMarketplaceState(graph.rootPath);
  const declaredCatalog = selectClaudeMarketplaceCatalog(graph, existingState);
  if (declaredCatalog !== undefined) {
    const [catalogName, catalog] = declaredCatalog;
    const rootLicense = await resolveRootLicense(graph);
    const plugins: JsonRecord[] = [];
    for (const entry of catalog.plugins) {
      if (!(entry.targets ?? catalog.targets).includes("claude")) continue;
      if (entry.repo !== undefined) {
        const providerEntry = lockedClaudeProviderEntry(existingState.entries, catalogName, entry);
        if (providerEntry !== undefined) plugins.push(providerEntry);
        continue;
      }
      const plugin = graph.plugins.find((candidate) => candidate.id === entry.plugin);
      if (plugin === undefined || !shouldRenderPlugin(graph, plugin, "claude")) continue;
      plugins.push(await renderClaudeMarketplacePlugin(graph, plugin, rootLicense));
    }
    return [textFile(
      claudeMarketplacePath(graph.root.outputs.plugins.claude),
      renderValidatedJson(
        renderClaudeMarketplaceDocument(graph, catalogName, catalog, plugins),
        "Claude marketplace"
      )
    )];
  }

  const rootLicense = await resolveRootLicense(graph);
  const plugins: JsonRecord[] = [];
  for (const plugin of graph.plugins.filter((candidate) => shouldRenderPlugin(graph, candidate, "claude"))) {
    plugins.push(await renderClaudeMarketplacePlugin(graph, plugin, rootLicense));
  }

  if (plugins.length === 0) return [];

  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ?? readRecord(root, "author") ?? {};
  const portableMarketplace = readRecord(root, "marketplace") ?? {};
  const marketplace = mergeRecords(
    {
      name: readString(portableMarketplace, "name") ?? readString(root, "name") ?? readString(root, "id") ?? "skillset",
      owner,
      metadata: {
        description:
          readString(root, "summary") ??
          readString(root, "description") ??
          "Source-first Skillset plugins",
        version: rootVersion(graph),
        pluginRoot: isDefaultPluginOutputRoot(graph.root.outputs.plugins.claude) ? "./plugins" : "./plugins",
        generatedBy: "example content repo skillset compiler",
      },
      plugins,
    },
    readRecord(graph.root.targets.claude.options, "marketplace") ?? {}
  );

  return [
    textFile(
      claudeMarketplacePath(graph.root.outputs.plugins.claude),
      renderValidatedJson(marketplace, "Claude marketplace")
    ),
  ];
}

async function renderClaudeMarketplacePlugin(
  graph: BuildGraph,
  plugin: SourcePlugin,
  rootLicense: ResolvedLicense | undefined
): Promise<JsonRecord> {
  const metadata = plugin.metadata;
  const pluginLicense = await resolvePluginLicense(graph, plugin, rootLicense);
  return mergeRecords(
    {
      name: plugin.id,
      source: providerSourceForPlugin(graph.root.outputs.plugins.claude, "claude", plugin.id),
      description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
      version: pluginVersion(graph, plugin),
      author: metadata.author,
      repository: metadata.repository,
      license: pluginLicense?.manifestValue,
      keywords: metadata.keywords,
      category: metadata.category,
      strict: metadata.strict,
    },
    readRecord(plugin.targets.claude.options, "marketplace") ?? {}
  );
}

export function renderClaudeMarketplaceDocument(
  graph: BuildGraph,
  catalogName: string,
  catalog: MarketplaceCatalogConfig,
  plugins: readonly JsonRecord[]
): JsonRecord {
  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ??
    readRecord(root, "author") ??
    { name: readString(root, "name") ?? catalogName };
  return {
    name: catalogName,
    owner,
    ...(catalog.description === undefined ? {} : { description: catalog.description }),
    metadata: {
      description:
        catalog.description ??
        readString(root, "summary") ??
        readString(root, "description") ??
        "Source-first Skillset plugins",
      generatedBy: GENERATED_BY,
      version: rootVersion(graph),
    },
    plugins: [...plugins].sort((left, right) => compareStrings(String(left.name), String(right.name))),
  };
}

function selectClaudeMarketplaceCatalog(
  graph: BuildGraph,
  existingState: ExistingMarketplaceState
): readonly [string, MarketplaceCatalogConfig] | undefined {
  const catalogs = Object.entries(graph.root.marketplaces)
    .filter(([, catalog]) => catalog.plugins.some((entry) => (entry.targets ?? catalog.targets).includes("claude")))
    .sort(([left], [right]) => compareStrings(left, right));
  const activeCatalog = optionalString(existingState.activeCatalogs.claude);
  if (activeCatalog !== undefined) {
    const selected = catalogs.find(([name]) => name === activeCatalog);
    if (selected !== undefined) return selected;
  }
  const onlyCatalog = catalogs[0];
  if (catalogs.length === 1 && onlyCatalog !== undefined) return onlyCatalog;
  return undefined;
}

function lockedClaudeProviderEntry(
  existingEntries: readonly JsonRecord[],
  catalogName: string,
  entry: MarketplacePluginEntryConfig
): JsonRecord | undefined {
  if (entry.repo === undefined) return undefined;
  const requested = marketplaceRequestedRefPolicy(entry) as unknown as JsonRecord;
  const locked = existingEntries.find((candidate) =>
    candidate.catalog === catalogName &&
    candidate.entryId === entry.id &&
    candidate.plugin === entry.plugin &&
    candidate.repo === entry.repo &&
    candidate.requestedTarget === "claude" &&
    candidate.readiness === "marketplace-ready" &&
    isJsonRecord(candidate.requested) &&
    marketplaceRequestedPoliciesEqual(candidate.requested, requested)
  );
  return locked === undefined ? undefined : storedClaudeMarketplaceProviderEntry(locked);
}

async function renderCursorMarketplace(graph: BuildGraph): Promise<readonly RenderedFile[]> {
  const plugins = [];
  for (const plugin of graph.plugins.filter((candidate) => shouldRenderPlugin(graph, candidate, "cursor"))) {
    const metadata = plugin.metadata;
    plugins.push(
      mergeRecords(
        {
          name: plugin.id,
          source: providerSourceForPlugin(graph.root.outputs.plugins.cursor, "cursor", plugin.id).replace(/^\.\//, ""),
          description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
        },
        readRecord(plugin.targets.cursor.options, "marketplace") ?? {}
      )
    );
  }

  if (plugins.length === 0) return [];

  const root = graph.root.metadata;
  const owner = readRecord(root, "owner") ?? readRecord(root, "author") ?? {};
  const portableMarketplace = readRecord(root, "marketplace") ?? {};
  const marketplace = mergeRecords(
    {
      name: readString(portableMarketplace, "name") ?? readString(root, "name") ?? readString(root, "id") ?? "skillset",
      owner,
      metadata: {
        description:
          readString(root, "summary") ??
          readString(root, "description") ??
          "Source-first Skillset plugins",
      },
      plugins,
    },
    readRecord(graph.root.targets.cursor.options, "marketplace") ?? {}
  );

  return [
    textFile(
      cursorMarketplacePath(graph.root.outputs.plugins.cursor),
      renderValidatedJson(marketplace, "Cursor marketplace")
    ),
  ];
}

function cursorMarketplacePath(outputRoot: string): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? ".cursor-plugin/marketplace.json"
    : join(outputRoot, ".cursor-plugin", "marketplace.json").replaceAll("\\", "/");
}

async function renderPluginTarget(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  if (!shouldRenderPlugin(graph, plugin, target)) return [];
  validateInternalPluginDependenciesForTarget(graph, plugin, target);

  const rendered: RenderedFile[] = [];
  const outputRoot = graph.root.outputs.plugins[target];
  const basePath = pluginTargetRoot(outputRoot, target, plugin.id);
  const enabledSkills = plugin.skills.filter((skill) => skill.targets[target].enabled);
  const dependencySummaries = pluginDependencySummaries(graph, plugin);
  if (target === "codex" && dependencySummaries.length > 0 && enabledSkills.length === 0) {
    throw new Error(
      `skillset: plugin ${plugin.id} declares dependencies but has no enabled Codex skills to carry the dependency notice`
    );
  }
  const rootLicense = await resolveRootLicense(graph);
  const pluginLicense = await resolvePluginLicense(graph, plugin, rootLicense);
  const manifestFile = textFile(
    pluginManifestPath(outputRoot, target, plugin.id),
    renderValidatedJson(
      renderPluginManifest(graph, plugin, target, enabledSkills, pluginLicense),
      `${plugin.id} ${target} plugin manifest`
    ),
    relative(graph.rootPath, plugin.configPath)
  );

  rendered.push(manifestFile);
  const pluginRootFiles = [manifestFile];
  if (pluginLicense !== undefined) {
    const licenseFile = licenseFileFor(join(basePath, "LICENSE.txt"), pluginLicense);
    rendered.push(licenseFile);
    pluginRootFiles.push(licenseFile);
  }
  lockRootsFor(lockRoots, outputRoot, pluginLockTarget(graph, target)).items.push(
    lockItemForPlugin({
      files: pluginRootFiles,
      graph,
      license: pluginLicense,
      outputRoot,
      plugin,
      target,
    })
  );

  for (const skill of enabledSkills) {
    rendered.push(...(await renderPluginSkillFiles(graph, plugin, skill, target, basePath, outputRoot, lockRoots, pluginLicense)));
  }

  rendered.push(...(await renderPluginFeatureFiles(graph, plugin, target, basePath, outputRoot, lockRoots)));
  rendered.push(...(await renderAdaptivePluginHookFiles(graph, plugin, target, basePath)));
  rendered.push(...(await copyPluginCompanionFiles(graph, plugin, target, basePath)));
  rendered.push(...(await renderPluginIslands(graph, plugin, target, basePath, outputRoot, lockRoots)));
  return rendered;
}

function validateInternalPluginDependenciesForTarget(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): void {
  for (const dependency of pluginDependencies(graph, plugin)) {
    if (dependency.kind !== "internal") continue;
    const dependencyPlugin = graph.plugins.find((candidate) => candidate.id === dependency.name);
    if (dependencyPlugin === undefined) continue;
    if (shouldRenderPlugin(graph, dependencyPlugin, target)) continue;
    throw new Error(
      `skillset: plugin ${plugin.id} depends on ${dependency.name}, but ${dependency.name} is not emitted for ${target}`
    );
  }
}

function renderPluginManifest(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  enabledSkills: readonly SourceSkill[],
  license: ResolvedLicense | undefined
): JsonRecord {
  const metadata = plugin.metadata;
  const targetOptions = plugin.targets[target].options;
  const portableManifest = readRecord(metadata, "manifest") ?? {};
  const base: JsonRecord = {
    name: readString(portableManifest, "name") ?? plugin.id,
    version: pluginVersion(graph, plugin),
    description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
    author: metadata.author,
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: license?.manifestValue,
    keywords: metadata.keywords,
  };
  const dependencies = target === "claude" ? renderClaudePluginDependencies(graph, plugin) : undefined;
  const manifestOverrides = readRecord(targetOptions, "manifest") ?? {};
  if (target === "claude" && dependencies !== undefined && manifestOverrides.dependencies !== undefined) {
    throw new Error(
      `skillset: plugin ${plugin.id} declares dependencies, but claude.manifest.dependencies would overwrite generated dependency metadata`
    );
  }

  const targetBase =
    target === "claude"
      ? withOptionalSurfacePaths(graph, mergeRecords(base, dependencies === undefined ? {} : { dependencies }), plugin, enabledSkills, target)
      : target === "codex"
      ? mergeRecords(withOptionalSurfacePaths(graph, base, plugin, enabledSkills, target), {
          interface: renderCodexInterface(graph, plugin),
        })
      : withOptionalSurfacePaths(
          graph,
          mergeRecords(base, renderCursorPluginDisplayFields(metadata, portableManifest)),
          plugin,
          enabledSkills,
          target
        );
  const withOverrides = mergeRecords(targetBase, manifestOverrides);

  return mergeRecords(withOverrides, {
    version: pluginVersion(graph, plugin),
  });
}

function renderCursorPluginDisplayFields(
  metadata: JsonRecord,
  portableManifest: JsonRecord
): JsonRecord {
  const tags = readStringArray(portableManifest, "tags");
  return {
    displayName: readString(portableManifest, "displayName") ?? readString(metadata, "title"),
    category: readString(portableManifest, "category"),
    logo: readString(portableManifest, "logo") ?? readString(metadata, "logo"),
    ...(tags === undefined ? {} : { tags: [...tags] }),
  };
}

function renderCodexInterface(graph: BuildGraph, plugin: SourcePlugin): JsonRecord {
  const metadata = plugin.metadata;
  const presentation = mergeRecords(
    readRecord(metadata, "ui") ?? {},
    readRecord(metadata, "presentation") ?? {}
  );
  const author = readRecord(metadata, "author") ?? readRecord(graph.root.metadata, "owner") ?? {};
  const targetOptions = plugin.targets.codex.options;
  const interfaceOverrides = readRecord(targetOptions, "interface") ?? {};
  const color =
    readString(targetOptions, "color") ??
    readPresentationString(presentation, "color", "brand_color", "brandColor") ??
    DEFAULT_CODEX_COLOR;
  const website =
    readPresentationString(presentation, "website_url", "websiteURL") ??
    readString(metadata, "homepage") ??
    readString(metadata, "repository");
  const capabilities = readStringArray(presentation, "capabilities");
  const defaultPrompt =
    readStringArray(presentation, "default_prompt") ?? readStringArray(presentation, "defaultPrompt");
  const screenshots = readStringArray(presentation, "screenshots");

  const base: JsonRecord = {
    displayName:
      readPresentationString(presentation, "display_name", "displayName") ??
      readString(metadata, "title") ??
      titleize(plugin.id),
    shortDescription:
      readPresentationString(presentation, "summary", "short_description", "shortDescription") ??
      readString(metadata, "summary") ??
      readString(metadata, "description") ??
      plugin.id,
    longDescription:
      readPresentationString(presentation, "description", "long_description", "longDescription") ??
      readString(metadata, "description") ??
      readString(metadata, "summary") ??
      plugin.id,
    developerName:
      readPresentationString(presentation, "developer_name", "developerName") ??
      readString(author, "name") ??
      "Skillset Maintainers",
    category: readString(presentation, "category") ?? readString(metadata, "category") ?? "Productivity",
    capabilities: [...(capabilities ?? ["Interactive", "Write"])],
    websiteURL: website,
    privacyPolicyURL: readPresentationString(presentation, "privacy_policy_url", "privacyPolicyURL"),
    termsOfServiceURL: readPresentationString(presentation, "terms_of_service_url", "termsOfServiceURL"),
    defaultPrompt: defaultPrompt ? [...defaultPrompt] : undefined,
    brandColor: color,
    composerIcon: readPresentationString(presentation, "composer_icon", "composerIcon"),
    logo: readString(presentation, "logo"),
    screenshots: [...(screenshots ?? [])],
  };

  return mergeRecords(base, interfaceOverrides);
}

function readPresentationString(record: JsonRecord, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function withOptionalSurfacePaths(
  graph: BuildGraph,
  manifest: JsonRecord,
  plugin: SourcePlugin,
  enabledSkills: readonly SourceSkill[],
  target: TargetName
): JsonRecord {
  const withPaths: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (value !== undefined) withPaths[key] = value;
  }

  if (enabledSkills.length > 0) withPaths.skills = "./skills/";
  if (target === "claude") {
    if (pluginHasPath(plugin, "commands")) withPaths.commands = "./commands";
    if (pluginHasPath(plugin, "agents")) withPaths.agents = "./agents";
    if (pluginHasPath(plugin, "hooks/hooks.json") || hasAdaptivePluginHookOutput(graph, plugin, target)) withPaths.hooks = "./hooks/hooks.json";
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./.mcp.json";
    if (pluginHasPath(plugin, ".lsp.json")) withPaths.lspServers = "./.lsp.json";
    if (pluginHasPath(plugin, "output-styles")) withPaths.outputStyles = "./output-styles/";
    // Themes and monitors are experimental Claude plugin components; declare them
    // under the documented `experimental` manifest key.
    const experimental: Record<string, JsonValue> = {};
    if (pluginHasPath(plugin, "themes")) experimental.themes = "./themes/";
    if (pluginHasPath(plugin, "monitors/monitors.json")) {
      experimental.monitors = "./monitors/monitors.json";
    }
    if (Object.keys(experimental).length > 0) withPaths.experimental = experimental;
  } else if (target === "codex") {
    if (pluginHasPath(plugin, "hooks/hooks.json") || hasAdaptivePluginHookOutput(graph, plugin, target)) {
      withPaths.hooks = "./hooks/hooks.json";
    }
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./.mcp.json";
    if (pluginHasPath(plugin, ".app.json")) withPaths.apps = "./.app.json";
  } else {
    if (pluginHasPath(plugin, "rules")) withPaths.rules = "./rules/";
    if (pluginHasPath(plugin, "commands")) withPaths.commands = "./commands/";
    if (pluginHasPath(plugin, "agents")) withPaths.agents = "./agents/";
    if (pluginHasPath(plugin, "hooks/hooks.json") || hasAdaptivePluginHookOutput(graph, plugin, target)) {
      withPaths.hooks = "./hooks/hooks.json";
    }
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./mcp.json";
  }

  return withPaths;
}

async function renderPluginSkillFiles(
  graph: BuildGraph,
  plugin: SourcePlugin,
  skill: SourceSkill,
  target: TargetName,
  basePath: string,
  outputRoot: string,
  lockRoots: Map<string, LockRoot>,
  inheritedLicense: ResolvedLicense | undefined
): Promise<readonly RenderedFile[]> {
  const sourceDir = dirname(skill.sourcePath);
  const relativeSkillDir = dirname(skill.relativePath);
  const targetSkillDir = join(basePath, relativeSkillDir);
  const targetSkillFile = join(targetSkillDir, "SKILL.md");
  const generatedCodexAgentFile = await renderCodexSkillAgentFile(
    graph,
    plugin,
    skill,
    target,
    sourceDir,
    targetSkillDir
  );
  const generatedToolsMetadataFile = renderSkillToolsMetadataFile(
    graph,
    skill,
    target,
    targetSkillDir
  );
  const generatedCodexRelativeFiles = new Set(
    [generatedCodexAgentFile?.file, generatedToolsMetadataFile]
      .filter((file): file is RenderedFile => file !== undefined)
      .map((file) => relative(targetSkillDir, file.path))
  );
  const rendered: RenderedFile[] = [];
  const renderedRelativeFiles = new Set<string>();
  const skillMarkdown = await renderSkillMarkdown(graph, plugin, skill, target);
  pushSkillRenderedFile(
    rendered,
    textFile(
      targetSkillFile,
      skillMarkdown.content,
      relative(graph.rootPath, skill.sourcePath)
    ),
    targetSkillDir,
    renderedRelativeFiles,
    `${skill.sourcePath}.SKILL.md`
  );
  if (generatedCodexAgentFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedCodexAgentFile.file,
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.agents/openai.yaml`
    );
  }
  if (generatedToolsMetadataFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedToolsMetadataFile,
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.tools`
    );
  }
  const skillLicense = await resolveLicense({
    graph,
    label: relative(graph.rootPath, skill.sourcePath),
    metadata: skill.metadata,
    ...(inheritedLicense === undefined ? {} : { parent: inheritedLicense }),
    scopePath: sourceDir,
    sourcePath: skill.sourcePath,
  });
  if (skillLicense !== undefined) {
    pushSkillRenderedFile(
      rendered,
      licenseFileFor(join(targetSkillDir, "LICENSE.txt"), skillLicense),
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.LICENSE.txt`
    );
  }

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "SKILL.md") continue;
    if (relativeFile === "CHANGELOG.md") continue;
    if (relativeFile === "LICENSE.txt") continue;
    if (generatedCodexRelativeFiles.has(relativeFile)) continue;
    pushSkillRenderedFile(
      rendered,
      {
        path: join(targetSkillDir, relativeFile),
        content: await readFile(file),
      },
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.${relativeFile}`
    );
  }
  rendered.push(...(await renderSkillResources(skill, targetSkillDir, renderedRelativeFiles)));

  lockRootsFor(lockRoots, outputRoot, pluginLockTarget(graph, target)).items.push(
    await lockItemForSkill({
      files: rendered,
      graph,
      kind: "plugin-skill",
      license: skillLicense,
      outputRoot,
      plugin,
      preprocessDependencies: skillPreprocessDependencies(skillMarkdown, generatedCodexAgentFile),
      skill,
      sourceDir,
      transforms: skillMarkdown.transforms,
    })
  );

  return rendered;
}

async function renderProjectAgents(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const agent of graph.projectAgents) {
    const results: RenderedProjectAgentFile[] = [];
    if (agent.targets.claude.enabled) {
      results.push(await renderClaudeProjectAgent(graph, agent));
    }
    if (agent.targets.codex.enabled) {
      results.push(await renderCodexProjectAgent(graph, agent));
    }
    if (agent.targets.cursor.enabled) {
      results.push(await renderCursorProjectAgent(graph, agent));
    }
    if (results.length === 0) continue;
    const files = results.map((result) => result.file);
    rendered.push(...files);
    const lockRoot = lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace");
    for (const result of results) {
      lockRoot.items.push(
        lockItemForProjectAgent({ agent, files: [result.file], graph, outputRoot: WORKSPACE_LOCK_ROOT, result })
      );
    }
  }
  return rendered;
}

async function renderCursorProjectAgent(
  graph: BuildGraph,
  agent: SourceProjectAgent
): Promise<RenderedProjectAgentFile> {
  const targetOptions = agent.targets.cursor.options;
  const initialPrompt = readString(targetOptions, "initialPrompt") ?? readString(agent.frontmatter, "initialPrompt");
  const skills = readStringArray(targetOptions, "skills") ?? readStringArray(agent.frontmatter, "skills");
  const frontmatter = mergeRecords(
    mergeRecords(
      stripAgentTargetOptions(stripSourceFrontmatter(agent.frontmatter, agent.sourcePath)),
      stripAgentTargetOptions(targetOptions)
    ),
    {
      name: readString(targetOptions, "name") ?? agent.name,
      description: readString(targetOptions, "description") ?? readString(agent.frontmatter, "description") ?? agent.name,
      ...(skills === undefined ? {} : { skills: [...skills] }),
      ...(initialPrompt === undefined ? {} : { initialPrompt }),
      ...(graph.root.compile.skillset.metadata
        ? { metadata: { skillset: { generated: GENERATED_BY } } }
        : {}),
    }
  );
  const preprocessDependencies = new Set<string>();
  const body = await preprocessText(agent.body, {
    frontmatter: agent.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: agent.sourcePath,
    sourceRoot: graph.sourceRoot,
  });
  const targetPath = join(targetProjectRoot(graph, "cursor"), "agents", `${agent.outputName}.md`);
  return {
    file: textFile(
      targetPath,
      renderValidatedMarkdown(frontmatter, body, `${relative(graph.rootPath, agent.sourcePath)} -> ${targetPath}`),
      relative(graph.rootPath, agent.sourcePath)
    ),
    preprocessDependencies: projectAgentPreprocessDependencies(graph, preprocessDependencies),
    target: "cursor",
  };
}

async function renderClaudeProjectAgent(
  graph: BuildGraph,
  agent: SourceProjectAgent
): Promise<RenderedProjectAgentFile> {
  const targetOptions = agent.targets.claude.options;
  const initialPrompt = readString(targetOptions, "initialPrompt") ?? readString(agent.frontmatter, "initialPrompt");
  const skills = readStringArray(targetOptions, "skills") ?? readStringArray(agent.frontmatter, "skills");
  const adaptiveHooks = renderAdaptiveFrontmatterHooks(
    graph,
    { agentId: agent.outputName, kind: "agent" },
    "claude",
    relative(graph.rootPath, agent.sourcePath)
  );
  if (adaptiveHooks !== undefined && targetOptions.hooks !== undefined) {
    throw new Error(
      `skillset: ${relative(graph.rootPath, agent.sourcePath)} cannot combine adaptive hook attachments with claude.hooks`
    );
  }
  const frontmatter = mergeRecords(
    mergeRecords(
      mergeRecords(stripAgentTargetOptions(stripSourceFrontmatter(agent.frontmatter, agent.sourcePath)), {
        name: readString(targetOptions, "name") ?? agent.name,
        description: readString(targetOptions, "description") ?? readString(agent.frontmatter, "description") ?? agent.name,
        ...(skills === undefined ? {} : { skills: [...skills] }),
        ...(initialPrompt === undefined ? {} : { initialPrompt }),
        ...(adaptiveHooks === undefined ? {} : { hooks: adaptiveHooks }),
      }),
      stripAgentTargetOptions(targetOptions)
    ),
    graph.root.compile.skillset.metadata
      ? { metadata: { skillset: { generated: GENERATED_BY } } }
      : {}
  );
  const preprocessDependencies = new Set<string>();
  const body = await preprocessText(agent.body, {
    frontmatter: agent.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: agent.sourcePath,
    sourceRoot: graph.sourceRoot,
  });
  const targetPath = join(targetProjectRoot(graph, "claude"), "agents", `${agent.outputName}.md`);
  return {
    file: textFile(
      targetPath,
      renderValidatedMarkdown(frontmatter, body, `${relative(graph.rootPath, agent.sourcePath)} -> ${targetPath}`),
      relative(graph.rootPath, agent.sourcePath)
    ),
    preprocessDependencies: projectAgentPreprocessDependencies(graph, preprocessDependencies),
    target: "claude",
  };
}

async function renderCodexProjectAgent(
  graph: BuildGraph,
  agent: SourceProjectAgent
): Promise<RenderedProjectAgentFile> {
  const targetOptions = agent.targets.codex.options;
  const initialPrompt = readString(targetOptions, "initialPrompt") ?? readString(agent.frontmatter, "initialPrompt");
  if (initialPrompt?.includes("</initial_prompt>")) {
    throw new Error(`skillset: ${relative(graph.rootPath, agent.sourcePath)} initialPrompt must not contain </initial_prompt>`);
  }
  const sharedSkills = readStringArray(agent.frontmatter, "skills");
  const skills = readStringArray(targetOptions, "skills") ?? sharedSkills;
  const preprocessDependencies = new Set<string>();
  const instructions = await renderCodexProjectAgentInstructions(graph, agent, targetOptions, skills, initialPrompt, preprocessDependencies);
  const targetPath = join(targetProjectRoot(graph, "codex"), "agents", `${agent.outputName}.toml`);
  const value = mergeRecords(
    mergeRecords(stripAgentTargetOptions(targetOptions), {
      name: readString(targetOptions, "name") ?? agent.name,
      description: readString(targetOptions, "description") ?? readString(agent.frontmatter, "description") ?? agent.name,
      developer_instructions: instructions,
    }),
    graph.root.compile.skillset.metadata
      ? { metadata: { skillset: { generated: GENERATED_BY } } }
      : {}
  );
  return {
    file: textFile(
      targetPath,
      renderValidatedToml(value, `${relative(graph.rootPath, agent.sourcePath)} -> ${targetPath}`),
      relative(graph.rootPath, agent.sourcePath)
    ),
    preprocessDependencies: projectAgentPreprocessDependencies(graph, preprocessDependencies),
    target: "codex",
  };
}

async function renderCodexProjectAgentInstructions(
  graph: BuildGraph,
  agent: SourceProjectAgent,
  targetOptions: JsonRecord,
  skills: readonly string[] | undefined,
  initialPrompt: string | undefined,
  preprocessDependencies: Set<string>
): Promise<string> {
  const explicitInstructions = readString(targetOptions, "developer_instructions");
  const body = await preprocessText(explicitInstructions ?? agent.body, {
    frontmatter: agent.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: agent.sourcePath,
    sourceRoot: graph.sourceRoot,
  });
  const sections: string[] = [];
  if (skills !== undefined && skills.length > 0) {
    sections.push(renderCodexSkillsPreface(targetOptions, skills));
  }
  sections.push(body.trimEnd());
  if (initialPrompt !== undefined) {
    const renderedPrompt = await preprocessText(initialPrompt, {
      frontmatter: agent.frontmatter,
      preprocessDependencies,
      rootPath: graph.rootPath,
      sourcePath: agent.sourcePath,
      sourceRoot: graph.sourceRoot,
    });
    if (renderedPrompt.includes("</initial_prompt>")) {
      throw new Error(`skillset: ${relative(graph.rootPath, agent.sourcePath)} initialPrompt must not contain </initial_prompt>`);
    }
    sections.push(`<initial_prompt>\n${renderedPrompt.trimEnd()}\n</initial_prompt>`);
  }
  return `${sections.filter((section) => section.trim().length > 0).join("\n\n")}\n`;
}

function projectAgentPreprocessDependencies(
  graph: BuildGraph,
  dependencies: ReadonlySet<string>
): readonly string[] {
  return formattedPreprocessDependencies(graph, dependencies);
}

function renderCodexSkillsPreface(targetOptions: JsonRecord, skills: readonly string[]): string {
  const bullets = skills.map((skill) => `- ${skill}`).join("\n");
  const template = readString(targetOptions, "skillsPrefaceTemplate") ?? "Load the following skills first, if available:\n\n{{skills}}";
  return template.includes("{{skills}}") ? template.replaceAll("{{skills}}", bullets) : `${template.trimEnd()}\n\n${bullets}`;
}

function stripAgentTargetOptions(options: JsonRecord): JsonRecord {
  const stripped: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(options)) {
    if (
      value === undefined ||
      key === "defaults" ||
      key === "developer_instructions" ||
      key === "frontmatter" ||
      key === "initialPrompt" ||
      key === "plugins" ||
      key === "projectRoot" ||
      key === "skills" ||
      key === "skillsPrefaceTemplate" ||
      key === "userRoot"
    ) {
      continue;
    }
    stripped[key] = value;
  }
  return stripped;
}

async function renderProjectIslands(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const island of graph.projectIslands.filter((item) => item.plugin === undefined)) {
    if (!graph.root.targets[island.target].enabled) continue;
    const targetRoot = targetProjectRoot(graph, island.target);
    const targetPath = join(targetRoot, island.relativePath);
    const result = await renderIslandFile(graph, island, targetPath);
    rendered.push(result.file);
    lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace").items.push(
      lockItemForIsland({ graph, island, outputRoot: WORKSPACE_LOCK_ROOT, outputPath: targetPath, result })
    );
  }
  return rendered;
}

async function renderPluginIslands(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string,
  outputRoot: string,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const island of graph.projectIslands.filter((item) => item.plugin === plugin.id && item.target === target)) {
    if (!plugin.targets[target].enabled) continue;
    const targetPath = join(basePath, island.relativePath);
    const result = await renderIslandFile(graph, island, targetPath);
    rendered.push(result.file);
    lockRootsFor(lockRoots, outputRoot, pluginLockTarget(graph, target)).items.push(
      lockItemForIsland({ graph, island, outputRoot, outputPath: targetPath, result })
    );
  }
  return rendered;
}

async function renderIslandFile(
  graph: BuildGraph,
  island: SourceIslandFile,
  targetPath: string
): Promise<RenderedIslandFile> {
  if (isTextIslandFile(island.relativePath)) {
    const preprocessDependencies = new Set<string>();
    const content = await renderTextIslandFile(graph, island, targetPath, preprocessDependencies);
    return {
      file: textFile(targetPath, content, relative(graph.rootPath, island.sourcePath)),
      preprocessDependencies: formattedPreprocessDependencies(graph, preprocessDependencies),
      validation: "structured",
    };
  }
  return {
    file: {
      path: targetPath,
      content: await readFile(island.sourcePath),
    },
    preprocessDependencies: [],
    validation: "opaque-copy",
  };
}

async function renderTextIslandFile(
  graph: BuildGraph,
  island: SourceIslandFile,
  targetPath: string,
  preprocessDependencies: Set<string>
): Promise<string> {
  const source = await readFile(island.sourcePath, "utf8");
  if (island.relativePath.endsWith(".md")) {
    const parsed = parseMarkdown(source, island.sourcePath);
    rejectIslandTargetEscape(parsed.frontmatter, island);
    const body = await preprocessText(parsed.body, {
      frontmatter: parsed.frontmatter,
      preprocessDependencies,
      rootPath: graph.rootPath,
      sourcePath: island.sourcePath,
      sourceRoot: graph.sourceRoot,
    });
    return renderValidatedMarkdown(
      stripSourceFrontmatter(parsed.frontmatter, island.sourcePath),
      body,
      `${relative(graph.rootPath, island.sourcePath)} -> ${targetPath}`
    );
  }

  return preprocessText(source, {
    frontmatter: {},
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: island.sourcePath,
    sourceRoot: graph.sourceRoot,
  });
}

function rejectIslandTargetEscape(frontmatter: JsonRecord, island: SourceIslandFile): void {
  if (frontmatter.claude !== undefined || frontmatter.codex !== undefined || frontmatter.cursor !== undefined || frontmatter.targets !== undefined) {
    throw new Error(
      `skillset: ${island.sourcePath} is already target-native for ${island.target}; remove target override frontmatter`
    );
  }
}

function isTextIslandFile(path: string): boolean {
  return /\.(json|md|rules|toml|txt|ya?ml)$/.test(path);
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  const configured = readString(graph.root.targets[target].options, "projectRoot");
  if (configured !== undefined) return configured;
  if (target === "claude") return ".claude";
  if (target === "codex") return ".codex";
  return ".cursor";
}

async function renderStandaloneSkill(
  graph: BuildGraph,
  skill: StandaloneSkill,
  target: TargetName,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  if (!shouldRenderStandaloneSkill(graph, skill, target)) return [];

  const outputRoot = graph.root.outputs.skills[target];
  const sourceDir = dirname(skill.sourcePath);
  const relativeSkillDir = dirname(skill.relativePath);
  const targetSkillDir = join(outputRoot, relativeSkillDir);
  const targetSkillFile = join(targetSkillDir, "SKILL.md");
  const generatedCodexAgentFile = await renderCodexSkillAgentFile(
    graph,
    undefined,
    skill,
    target,
    sourceDir,
    targetSkillDir
  );
  const generatedToolsMetadataFile = renderSkillToolsMetadataFile(
    graph,
    skill,
    target,
    targetSkillDir
  );
  const generatedCodexRelativeFiles = new Set(
    [generatedCodexAgentFile?.file, generatedToolsMetadataFile]
      .filter((file): file is RenderedFile => file !== undefined)
      .map((file) => relative(targetSkillDir, file.path))
  );
  const rendered: RenderedFile[] = [];
  const renderedRelativeFiles = new Set<string>();
  const skillMarkdown = await renderSkillMarkdown(graph, undefined, skill, target);
  pushSkillRenderedFile(
    rendered,
    textFile(
      targetSkillFile,
      skillMarkdown.content,
      relative(graph.rootPath, skill.sourcePath)
    ),
    targetSkillDir,
    renderedRelativeFiles,
    `${skill.sourcePath}.SKILL.md`
  );
  if (generatedCodexAgentFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedCodexAgentFile.file,
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.agents/openai.yaml`
    );
  }
  if (generatedToolsMetadataFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedToolsMetadataFile,
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.tools`
    );
  }
  const rootLicense = await resolveRootLicense(graph);
  const skillLicense = await resolveLicense({
    graph,
    label: relative(graph.rootPath, skill.sourcePath),
    metadata: skill.metadata,
    ...(rootLicense === undefined ? {} : { parent: rootLicense }),
    scopePath: sourceDir,
    sourcePath: skill.sourcePath,
  });
  if (skillLicense !== undefined) {
    pushSkillRenderedFile(
      rendered,
      licenseFileFor(join(targetSkillDir, "LICENSE.txt"), skillLicense),
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.LICENSE.txt`
    );
  }

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "SKILL.md") continue;
    if (relativeFile === "CHANGELOG.md") continue;
    if (relativeFile === "LICENSE.txt") continue;
    if (generatedCodexRelativeFiles.has(relativeFile)) continue;
    pushSkillRenderedFile(
      rendered,
      {
        path: join(targetSkillDir, relativeFile),
        content: await readFile(file),
      },
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.${relativeFile}`
    );
  }
  rendered.push(...(await renderSkillResources(skill, targetSkillDir, renderedRelativeFiles)));

  lockRootsFor(lockRoots, outputRoot, pluginLockTarget(graph, target)).items.push(
    await lockItemForSkill({
      files: rendered,
      graph,
      kind: "standalone-skill",
      license: skillLicense,
      outputRoot,
      preprocessDependencies: skillPreprocessDependencies(skillMarkdown, generatedCodexAgentFile),
      skill,
      sourceDir,
      transforms: skillMarkdown.transforms,
    })
  );

  return rendered;
}

async function renderSkillResources(
  skill: SourceSkill,
  targetSkillDir: string,
  renderedRelativeFiles: Set<string>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];

  for (const resource of skill.resources) {
    for (const file of await copyPath(resource.sourcePath, join(targetSkillDir, resource.targetPath))) {
      if (file.path.endsWith(".gitkeep")) continue;
      pushSkillRenderedFile(
        rendered,
        file,
        targetSkillDir,
        renderedRelativeFiles,
        `${skill.sourcePath}.resources.${resource.from}`
      );
    }
  }

  return rendered;
}

function pushSkillRenderedFile(
  rendered: RenderedFile[],
  file: RenderedFile,
  targetSkillDir: string,
  renderedRelativeFiles: Set<string>,
  label: string
): void {
  const relativeFile = normalizeRenderedRelativePath(relative(targetSkillDir, file.path));
  if (relativeFile.length === 0 || relativeFile.startsWith("../")) {
    throw new Error(`skillset: ${label} would write outside generated skill directory`);
  }
  if (renderedRelativeFiles.has(relativeFile)) {
    throw new Error(
      `skillset: ${label} would overwrite generated skill file ${relativeFile}`
    );
  }
  renderedRelativeFiles.add(relativeFile);
  rendered.push(file);
}

function normalizeRenderedRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function formattedPreprocessDependencies(
  graph: BuildGraph,
  dependencies: ReadonlySet<string>
): readonly string[] {
  return [...dependencies]
    .map((dependency) => formatPreprocessDependency(graph.rootPath, dependency))
    .sort(compareStrings);
}

interface RenderedSkillMarkdown {
  readonly content: string;
  readonly preprocessDependencies: readonly string[];
  /** Dialect transforms applied to the body (codex projections only). */
  readonly transforms: readonly AppliedTransform[];
}

interface RenderedSkillAuxiliaryFile {
  readonly file: RenderedFile;
  readonly preprocessDependencies: readonly string[];
}

function skillPreprocessDependencies(
  markdown: RenderedSkillMarkdown,
  auxiliary: RenderedSkillAuxiliaryFile | undefined
): readonly string[] {
  return [...new Set([
    ...markdown.preprocessDependencies,
    ...(auxiliary?.preprocessDependencies ?? []),
  ])].sort(compareStrings);
}

async function renderSkillMarkdown(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  target: TargetName
): Promise<RenderedSkillMarkdown> {
  const metadata = skill.metadata;
  const targetOptions = skill.targets[target].options;
  const base = mergeRecords(stripSourceFrontmatter(skill.frontmatter, skill.sourcePath), {
    name:
      readString(metadata, "name") ??
      readString(metadata, "id") ??
      readString(skill.frontmatter, "name") ??
      skill.id,
    description:
      readString(skill.frontmatter, "description") ??
      readString(metadata, "description") ??
      readString(skill.frontmatter, "summary") ??
      readString(metadata, "summary") ??
      readString(skill.frontmatter, "title") ??
      readString(metadata, "title") ??
      skill.id,
  });
  const references = metadata.references;
  const version = skillVersion(graph, plugin, skill);
  const withReferences = references === undefined ? base : mergeRecords(base, { references });
  const withClaudePolicy =
    target === "claude" ? mergeRecords(withReferences, renderClaudeSkillPolicy(skill, targetOptions)) : withReferences;
  const adaptiveHooks = target === "claude"
    ? renderAdaptiveFrontmatterHooks(graph, skillScope(plugin, skill), target, relative(graph.rootPath, skill.sourcePath))
    : undefined;
  const withAdaptiveHooks = adaptiveHooks === undefined
    ? withClaudePolicy
    : mergeRecords(withClaudePolicy, { hooks: adaptiveHooks });
  const withPortable = graph.root.compile.skillset.metadata
    ? mergeRecords(withAdaptiveHooks, { metadata: { generated: GENERATED_BY, version } })
    : withAdaptiveHooks;
  const targetFrontmatter = readRecord(targetOptions, "frontmatter") ?? {};
  if (adaptiveHooks !== undefined && targetFrontmatter.hooks !== undefined) {
    throw new Error(
      `skillset: ${relative(graph.rootPath, skill.sourcePath)} cannot combine adaptive hook attachments with ${target}.frontmatter.hooks`
    );
  }
  const withTargetFrontmatter = mergeRecords(
    withPortable,
    targetFrontmatter
  );
  const frontmatter = graph.root.compile.skillset.metadata
    ? mergeRecords(withTargetFrontmatter, {
        metadata: {
          ...(readRecord(withTargetFrontmatter, "metadata") ?? {}),
          generated: GENERATED_BY,
          version,
        },
      })
    : withTargetFrontmatter;

  const preprocessDependencies = new Set<string>();
  const preprocessedBody = await preprocessText(skill.body, {
    frontmatter: skill.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: skill.sourcePath,
    sourceRoot: graph.sourceRoot,
    target,
    promptArguments: graph.root.compile.features.promptArguments,
    ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
  });
  const notices = [
    target === "codex" && plugin !== undefined
      ? renderCodexDependencyNotice(graph, plugin)
      : undefined,
    target === "codex" ? renderCodexPromptArgumentsNotice(preprocessedBody) : undefined,
  ].filter((notice): notice is string => notice !== undefined);
  const body = notices.length === 0
    ? preprocessedBody
    : `${notices.join("\n\n")}\n\n${preprocessedBody}`;
  const linkedBody = rewriteResourceLinks(body, skill.resources, skill.sourcePath);
  // Claude-dialect source lowers through the transform engine for the codex
  // projection only; the claude projection stays byte-identical to source.
  const translated =
    target === "codex" && skill.dialect === "claude"
      ? translateClaudeDialect(linkedBody)
      : { text: linkedBody, transforms: [] };
  return {
    content: renderValidatedMarkdown(
      frontmatter,
      translated.text,
      `${relative(graph.rootPath, skill.sourcePath)} -> ${target}`
    ),
    preprocessDependencies: formattedPreprocessDependencies(graph, preprocessDependencies),
    transforms: translated.transforms,
  };
}

function renderCodexPromptArgumentsNotice(body: string): string | undefined {
  if (!/\{\{\$ARGUMENTS(?:\}\}|\[[0-9]+\]\}\}|\.[A-Za-z_][A-Za-z0-9_-]*\}\})/u.test(body)) {
    return undefined;
  }
  return "Before using commands, replace `{{$ARGUMENTS...}}` placeholders with the user's supplied arguments.";
}

function renderClaudeSkillPolicy(skill: SourceSkill, targetOptions: JsonRecord): JsonRecord {
  const label = skill.sourcePath;
  const implicitInvocation = readImplicitInvocation(skill.frontmatter, "claude", label);
  const allowedTools = readAllowedTools(skill.frontmatter, "claude", label);
  const nativeTools = readClaudeNativeToolRules(skill.frontmatter, targetOptions, label);
  const policy: Record<string, JsonValue> = {};

  if (implicitInvocation !== undefined) {
    policy["disable-model-invocation"] = !implicitInvocation;
  }
  const allow = [
    ...(allowedTools !== undefined && allowedTools !== false ? allowedTools : []),
    ...nativeTools.allow,
  ];
  if (allow.length > 0) {
    policy["allowed-tools"] = allow;
  }
  if (nativeTools.deny.length > 0) {
    policy["disallowed-tools"] = [...nativeTools.deny];
  }

  return policy;
}

async function renderCodexSkillAgentFile(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  target: TargetName,
  sourceDir: string,
  targetSkillDir: string
): Promise<RenderedSkillAuxiliaryFile | undefined> {
  if (target !== "codex") return undefined;

  const label = relative(graph.rootPath, skill.sourcePath);
  const generated = renderCodexSkillAgentConfig(skill, label);
  if (Object.keys(generated).length === 0) return undefined;

  const sourceOpenAiPath = join(sourceDir, "agents/openai.yaml");
  const hasSourceOpenAi = await exists(sourceOpenAiPath);
  const preprocessDependencies = new Set<string>();
  const source = hasSourceOpenAi
    ? parseYamlRecord(
        await preprocessText(await readFile(sourceOpenAiPath, "utf8"), {
          frontmatter: skill.frontmatter,
          preprocessDependencies,
          rootPath: graph.rootPath,
          sourcePath: sourceOpenAiPath,
          sourceRoot: graph.sourceRoot,
          target,
          promptArguments: graph.root.compile.features.promptArguments,
          ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
        }),
        sourceOpenAiPath
      )
    : {};
  const merged = mergeRecords(source, generated);
  return {
    file: textFile(
      join(targetSkillDir, "agents/openai.yaml"),
      renderValidatedYaml(merged, `${relative(graph.rootPath, sourceOpenAiPath)} -> ${join(targetSkillDir, "agents/openai.yaml")}`),
      relative(graph.rootPath, sourceOpenAiPath)
    ),
    preprocessDependencies: formattedPreprocessDependencies(graph, preprocessDependencies),
  };
}

function renderCodexSkillAgentConfig(skill: SourceSkill, label: string): JsonRecord {
  const implicitInvocation = readImplicitInvocation(skill.frontmatter, "codex", label);
  const allowedTools = readAllowedTools(skill.frontmatter, "codex", label);
  if (allowedTools !== undefined && allowedTools !== false) {
    throw new Error(
      `skillset: ${label} allowed_tools has no Codex skill-local lowering; ` +
        "set allowed_tools.codex: false or move Codex tool dependencies into agents/openai.yaml"
    );
  }
  if (implicitInvocation === undefined) return {};
  return { policy: { allow_implicit_invocation: implicitInvocation } };
}

function renderSkillToolsMetadataFile(
  graph: BuildGraph,
  skill: SourceSkill,
  target: TargetName,
  targetSkillDir: string
): RenderedFile | undefined {
  if (!toolsMetadataSidecarTargets().includes(target)) return undefined;

  const label = relative(graph.rootPath, skill.sourcePath);
  const tools = readToolsPolicyMetadata(skill.frontmatter, skill.targets[target].options, target, label);
  if (Object.keys(tools).length === 0) return undefined;

  return textFile(
    join(targetSkillDir, ".skillset.tools.yaml"),
    renderValidatedYaml({
      generated: GENERATED_BY,
      schema_version: 1,
      target,
      tools,
    }, `${relative(graph.rootPath, skill.sourcePath)} -> ${join(targetSkillDir, ".skillset.tools.yaml")}`),
    relative(graph.rootPath, skill.sourcePath)
  );
}

async function renderRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  rendered.push(...(await renderClaudeRules(graph, lockRoots)));
  rendered.push(...(await renderCodexAgentsFiles(graph, lockRoots)));
  rendered.push(...(await renderCursorRules(graph, lockRoots)));
  return rendered;
}

async function renderClaudeRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];

  for (const rule of graph.rules.filter((sourceRule) => sourceRule.targets.claude.enabled)) {
    const targetFile = join(CLAUDE_RULES_OUTPUT_ROOT, rule.relativePath);
    const markdown = await renderClaudeRuleMarkdown(graph, rule, targetFile);
    const file = textFile(
      targetFile,
      markdown.content,
      relative(graph.rootPath, rule.sourcePath)
    );
    rendered.push(file);
    lockRootsFor(lockRoots, CLAUDE_RULES_OUTPUT_ROOT, "claude").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: rule.id,
        outputRoot: CLAUDE_RULES_OUTPUT_ROOT,
        outputPath: targetFile,
        preprocessDependencies: markdown.preprocessDependencies,
        sourceHash: hashTextRule(rule, markdown.preprocessDependencies, graph.rootPath),
        ...(rule.sourceOrigin === undefined ? {} : { sourceOrigin: rule.sourceOrigin }),
        sourcePath: relative(graph.rootPath, rule.sourcePath),
      })
    );
  }

  return rendered;
}

async function renderCodexAgentsFiles(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const destinations = new Map<string, SourceRule[]>();

  for (const rule of graph.rules.filter((sourceRule) => sourceRule.targets.codex.enabled)) {
    for (const destination of await codexRuleDestinations(graph, rule)) {
      const existing = destinations.get(destination) ?? [];
      destinations.set(destination, [...existing, rule]);
    }
  }

  const rendered: RenderedFile[] = [];
  for (const [destination, rules] of [...destinations.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const markdown = await renderCodexAgentsMarkdown(graph, rules, destination);
    const sourcePath = workspaceRelativeSourcePath(graph, graph.instructionsDir);
    const file = textFile(
      destination,
      markdown.content,
      sourcePath
    );
    rendered.push(file);
    lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: destination,
        outputRoot: WORKSPACE_LOCK_ROOT,
        outputPath: destination,
        preprocessDependencies: markdown.preprocessDependencies,
        sourceHash: hashRules(rules, markdown.preprocessDependencies, graph.rootPath),
        sourcePath,
        ...(markdown.transforms === undefined ? {} : { transforms: markdown.transforms }),
      })
    );
  }

  return rendered;
}

async function renderCursorRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const outputRoot = join(targetProjectRoot(graph, "cursor"), "rules");

  for (const rule of graph.rules.filter((sourceRule) => sourceRule.targets.cursor.enabled)) {
    const targetFile = join(outputRoot, cursorRuleRelativePath(rule.relativePath));
    const markdown = await renderCursorRuleMarkdown(graph, rule, targetFile);
    const file = textFile(
      targetFile,
      markdown.content,
      relative(graph.rootPath, rule.sourcePath)
    );
    rendered.push(file);
    lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: rule.id,
        outputRoot: WORKSPACE_LOCK_ROOT,
        outputPath: targetFile,
        preprocessDependencies: markdown.preprocessDependencies,
        sourceHash: hashTextRule(rule, markdown.preprocessDependencies, graph.rootPath),
        ...(rule.sourceOrigin === undefined ? {} : { sourceOrigin: rule.sourceOrigin }),
        sourcePath: relative(graph.rootPath, rule.sourcePath),
      })
    );
  }

  return rendered;
}

function cursorRuleRelativePath(path: string): string {
  return path.replace(/\.md$/u, ".mdc");
}

async function renderClaudeRuleMarkdown(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string
): Promise<RenderedRuleMarkdown> {
  const paths = readRulePaths(rule);
  const frontmatter: JsonRecord = paths.length === 0 ? {} : { paths: [...paths] };
  const preprocessDependencies = new Set<string>();
  const body = await renderRuleBody(graph, rule, outputPath, preprocessDependencies);
  return {
    content: stringifyOptionalMarkdown(frontmatter, body),
    preprocessDependencies: formattedPreprocessDependencies(graph, preprocessDependencies),
  };
}

async function renderCursorRuleMarkdown(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string
): Promise<RenderedRuleMarkdown> {
  const paths = readRulePaths(rule);
  const description =
    readString(rule.frontmatter, "description") ??
    readString(rule.frontmatter, "summary") ??
    readString(rule.frontmatter, "title") ??
    rule.id;
  const frontmatter: JsonRecord = {
    description,
    alwaysApply: paths.length === 0,
    ...(paths.length === 0 ? {} : { globs: [...paths] }),
  };
  const preprocessDependencies = new Set<string>();
  const body = await renderRuleBody(graph, rule, outputPath, preprocessDependencies);
  return {
    content: renderValidatedMarkdown(frontmatter, normalizeRuleBody(body), `${relative(graph.rootPath, rule.sourcePath)} -> ${outputPath}`),
    preprocessDependencies: formattedPreprocessDependencies(graph, preprocessDependencies),
  };
}

async function renderCodexAgentsMarkdown(
  graph: BuildGraph,
  rules: readonly SourceRule[],
  outputPath: string
): Promise<RenderedRuleMarkdown> {
  // Each concatenated source gets a deterministic boundary comment naming its
  // source instruction path. Comments carry the path only — source-only
  // frontmatter never reaches the generated AGENTS.md. Ordering follows the
  // already-sorted rule list, so concatenation is stable. Claude-dialect
  // sources lower through the transform engine for this codex projection;
  // the .claude/rules projection of the same sources stays untouched.
  const counts = new Map<string, number>();
  const preprocessDependencies = new Set<string>();
  const sections = rules.map(async (rule) => {
    const body = await renderRuleBody(graph, rule, outputPath, preprocessDependencies);
    if (rule.dialect !== "claude") return { rule, body };
    const translated = translateClaudeDialect(body);
    for (const transform of translated.transforms) {
      counts.set(transform.intent, (counts.get(transform.intent) ?? 0) + transform.count);
    }
    return { rule, body: translated.text };
  });
  const resolvedSections = await Promise.all(sections);
  const renderedSections = resolvedSections
    .filter((section) => section.body.length > 0)
    .map(
      (section) =>
        `<!-- source: ${relative(graph.rootPath, section.rule.sourcePath)} -->\n${section.body}`
    );
  const content = [
    `<!-- Generated by ${GENERATED_BY} from ${workspaceRelativeSourcePath(graph, graph.instructionsDir)}. Do not edit directly. -->`,
    "",
    renderedSections.join("\n\n"),
    "",
  ].join("\n");
  const transforms = [...counts.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([intent, count]) => ({ count, intent }));
  return {
    content,
    preprocessDependencies: formattedPreprocessDependencies(graph, preprocessDependencies),
    transforms,
  };
}

async function codexRuleDestinations(
  graph: BuildGraph,
  rule: SourceRule
): Promise<readonly string[]> {
  const paths = readRulePaths(rule);
  if (paths.length === 0) return ["AGENTS.md"];

  const destinations = new Set<string>();
  for (const pattern of paths) {
    const base = await codexBaseForPattern(graph, pattern);
    destinations.add(base.length === 0 ? "AGENTS.md" : join(base, "AGENTS.md"));
  }
  return [...destinations].sort();
}

async function codexBaseForPattern(graph: BuildGraph, pattern: string): Promise<string> {
  const normalized = normalizePattern(pattern);
  if (!hasGlobSyntax(normalized)) return dirnameOrRoot(normalized);

  const staticBase = staticGlobBase(normalized);
  if (staticBase.length > 0) return staticBase;

  const matches = await matchingRepoFiles(graph, normalized);
  if (matches.length === 0) return "";
  return commonDirectory(matches.map((match) => dirnameOrRoot(match)));
}

async function matchingRepoFiles(graph: BuildGraph, pattern: string): Promise<readonly string[]> {
  const matches: string[] = [];
  const glob = new Bun.Glob(pattern);
  for await (const match of glob.scan({ cwd: graph.rootPath, onlyFiles: true })) {
    const normalized = normalizePattern(match);
    if (isIgnoredRuleMatch(graph, normalized)) continue;
    matches.push(normalized);
  }
  return matches.sort();
}

function isIgnoredRuleMatch(graph: BuildGraph, path: string): boolean {
  if (path.startsWith(".git/") || path.startsWith("node_modules/")) return true;
  if (
    graph.sourceDir !== "." &&
    (path === graph.sourceDir || path.startsWith(`${graph.sourceDir}/`))
  ) {
    return true;
  }
  if (path === graph.sourceRoot || path.startsWith(`${graph.sourceRoot}/`)) return true;
  return graph.outputRoots.some(
    (outputRoot) => path === outputRoot || path.startsWith(`${outputRoot}/`)
  );
}

function workspaceRelativeSourcePath(graph: BuildGraph, sourcePath: string): string {
  return graph.sourceDir === "." ? sourcePath : join(graph.sourceDir, sourcePath);
}

function readRulePaths(rule: SourceRule): readonly string[] {
  const value = rule.frontmatter.paths;
  if (value === undefined) return [];
  if (typeof value === "string") return [readNonEmptyRuleString(value, `${rule.sourcePath}.paths`)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => readNonEmptyRuleString(item, `${rule.sourcePath}.paths`));
  }
  throw new Error(`skillset: expected ${rule.sourcePath}.paths to be a string or string array`);
}

function readNonEmptyRuleString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`skillset: expected ${label} entries to be non-empty strings`);
  }
  return trimmed;
}

function stringifyOptionalMarkdown(frontmatter: JsonRecord, body: string): string {
  const normalizedBody = normalizeRuleBody(body);
  if (Object.keys(frontmatter).length === 0) return `${normalizedBody}\n`;
  return renderValidatedMarkdown(frontmatter, normalizedBody, "generated instruction markdown");
}

async function renderRuleBody(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string,
  preprocessDependencies: Set<string>
): Promise<string> {
  return preprocessText(normalizeRuleBody(rule.body), {
    frontmatter: rule.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: rule.sourcePath,
    sourceRoot: graph.sourceRoot,
    variables: ruleVariables(graph, rule, outputPath),
  });
}

function ruleVariables(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string
): Readonly<Record<string, string>> {
  const outputDir = outputDirectory(outputPath);
  const sourceRule = relative(graph.rootPath, rule.sourcePath).replaceAll("\\", "/");
  return {
    "skillset.output_dir": outputDir,
    "skillset.repo_root": relativeOutputPath(outputDir, ""),
    "skillset.source_rule": sourceRule,
  };
}

function normalizeRuleBody(body: string): string {
  return body.replaceAll(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();
}

function outputDirectory(outputPath: string): string {
  const directory = normalizeWorkspacePath(dirname(outputPath));
  if (directory.length === 0 || directory === ".") return ".";
  return directory;
}

function relativeOutputPath(from: string, to: string): string {
  const normalizedFrom = from === "." ? "" : from;
  const normalizedTo = to === "." ? "" : to;
  const path = normalizeWorkspacePath(relative(normalizedFrom, normalizedTo));
  return path.length === 0 ? "." : path;
}

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function staticGlobBase(pattern: string): string {
  const segments = pattern.split("/");
  const baseSegments: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (hasGlobSyntax(segment)) break;
    baseSegments.push(segment);
  }
  return baseSegments.join("/");
}

function dirnameOrRoot(path: string): string {
  const normalized = normalizePattern(path);
  if (normalized.length === 0 || normalized === ".") return "";
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
    return normalized.includes(".") ? "" : normalized;
  }
  return normalized.slice(0, slashIndex);
}

function commonDirectory(directories: readonly string[]): string {
  if (directories.length === 0) return "";
  const [first = [], ...rest] = directories.map((directory) =>
    directory.length === 0 ? [] : directory.split("/")
  );
  const common = [...first];

  for (const directory of rest) {
    while (common.length > 0 && directory.slice(0, common.length).join("/") !== common.join("/")) {
      common.pop();
    }
  }

  return common.join("/");
}

async function copyPluginCompanionFiles(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const candidates =
    target === "claude"
      ? [
          "README.md",
          "commands",
          "agents",
          "hooks",
          ".lsp.json",
          "output-styles",
          "themes",
          "monitors",
          "assets",
          "scripts",
          "src",
        ]
      : target === "codex"
      ? ["README.md", ".app.json", "assets", "scripts", "src"]
      : ["README.md", "rules", "commands", "agents", "hooks", "assets", "scripts", "src"];

  if (target === "codex" || target === "cursor") {
    const hook = await renderNormalizedPluginHookFile(graph, plugin, target, basePath);
    if (hook !== undefined) rendered.push(hook);
  }

  for (const candidate of candidates) {
    const sourcePath = join(plugin.path, candidate);
    if (!(await exists(sourcePath))) continue;

    if (target === "claude" && candidate === "hooks") {
      if (hasAdaptivePluginHookSources(plugin)) {
        const nativeHookPath = join(sourcePath, "hooks.json");
        await validateHookJson(graph, nativeHookPath, "claude");
        if (await exists(nativeHookPath)) {
          rendered.push(...(await copyPath(nativeHookPath, join(basePath, "hooks", "hooks.json"))));
        }
        continue;
      }
      await validateHookJson(graph, join(sourcePath, "hooks.json"), "claude");
    }
    if ((target === "codex" || target === "cursor") && candidate === "hooks") continue;

    rendered.push(...(await copyPath(sourcePath, join(basePath, candidate))));
  }

  return rendered.filter((file) => !file.path.endsWith(".gitkeep"));
}

async function renderAdaptivePluginHookFiles(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string
): Promise<readonly RenderedFile[]> {
  const resolved = adaptivePluginHookAttachments(graph, plugin, target);
  if (resolved.length === 0) return [];
  const nativeSource = join(plugin.path, "hooks", "hooks.json");
  if (await exists(nativeSource)) {
    throw new Error(
      `skillset: plugin ${plugin.id} cannot combine adaptive hook attachments with native hooks/hooks.json for ${target}; choose one hook source model`
    );
  }

  const hooks: Record<string, JsonValue[]> = {};
  const scriptFiles = new Map<string, RenderedFile>();
  for (const item of resolved) {
    const event = nativeHookEventName(target, item.event);
    const eventGroups = hooks[event] ?? [];
    eventGroups.push(renderAdaptiveHookGroup(graph, plugin, target, item, basePath, scriptFiles));
    hooks[event] = eventGroups;
  }

  const normalized = { hooks };
  validateHookDefinition(normalized, {
    sourcePath: `${plugin.id} adaptive hooks -> ${join(basePath, "hooks", "hooks.json")}`,
    target,
  });

  return [
    textFile(
      join(basePath, "hooks", "hooks.json"),
      renderValidatedJson(normalized, `${plugin.id} ${target} adaptive hooks`),
      relative(graph.rootPath, plugin.configPath)
    ),
    ...[...scriptFiles.values()].sort((left, right) => compareStrings(left.path, right.path)),
  ];
}

function renderAdaptiveHookGroup(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  item: ResolvedAdaptiveHookAttachment,
  basePath: string,
  scriptFiles: Map<string, RenderedFile>
): JsonRecord {
  validateSupportedAdaptiveHookRenderFields(item, target);
  const matcher = item.attachment.match ?? item.definition.frontmatter.match;
  const statusMessage = item.attachment.status ?? readString(item.definition.frontmatter, "status");
  const group: JsonRecord = {
    ...(matcher === undefined ? {} : { matcher }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
    hooks: [{
      command: adaptiveHookCommand(graph, plugin, target, item, basePath, scriptFiles),
      type: "command",
    }],
  };
  return group;
}

function validateSupportedAdaptiveHookRenderFields(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): void {
  const reason = adaptiveHookUnsupportedRenderReason(item, target, "plugin");
  if (reason !== undefined) {
    throw new Error(`skillset: ${reason}`);
  }
}

function adaptiveHookCommand(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  item: ResolvedAdaptiveHookAttachment,
  basePath: string,
  scriptFiles: Map<string, RenderedFile>
): string {
  const run = readRecord(item.definition.frontmatter, "run") ?? {};
  const command = readString(run, "command");
  if (command !== undefined) return withAdaptiveHookContextCommand(withAdaptiveHookRunEnv(command, item), item, target);

  const script = readString(run, "script");
  if (script === undefined) {
    throw new Error(`skillset: adaptive hook ${item.definition.name} must define run.command or run.script`);
  }
  const reference = item.definition.scriptReferences.find((candidate) => candidate.reference === script);
  if (reference === undefined) {
    throw new Error(`skillset: adaptive hook ${item.definition.name} has unresolved run.script ${script}`);
  }
  const relativeScriptPath = relative(plugin.path, reference.sourcePath).replaceAll("\\", "/");
  if (relativeScriptPath.startsWith("../") || relativeScriptPath === "..") {
    throw new Error(`skillset: adaptive hook ${item.definition.name} script must stay inside plugin ${plugin.id}`);
  }
  const outputPath = join(basePath, relativeScriptPath);
  if (!scriptFiles.has(outputPath)) {
    scriptFiles.set(outputPath, {
      content: readFileSync(reference.sourcePath),
      path: outputPath,
      sourcePath: relative(graph.rootPath, reference.sourcePath),
    });
  }
  const pluginRoot = target === "claude" ? "$CLAUDE_PLUGIN_ROOT" : "$PLUGIN_ROOT";
  return withAdaptiveHookContextCommand(withAdaptiveHookRunEnv(`${pluginRoot}/${relativeScriptPath}`, item), item, target);
}

function hasAdaptivePluginHookOutput(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): boolean {
  return adaptivePluginHookAttachments(graph, plugin, target).length > 0;
}

function adaptivePluginHookAttachments(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): readonly ResolvedAdaptiveHookAttachment[] {
  return resolveAdaptiveHookAttachments(graph.adaptiveHooks, graph.hookAttachments).resolved.filter((item) =>
    item.attachment.scope.kind === "plugin" &&
    item.attachment.scope.pluginId === plugin.id &&
    supportsAdaptiveHookTarget(item, target, "plugin")
  );
}

function supportsAdaptiveHookTarget(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): boolean {
  return providerListAllows(item.definition.providers, target) &&
    providerListAllows(item.attachment.providers, target) &&
    adaptiveHookUnsupportedRenderReason(item, target, surface) === undefined;
}

function providerListAllows(providers: readonly TargetName[] | undefined, target: TargetName): boolean {
  return providers === undefined || providers.includes(target);
}

function hasAdaptivePluginHookSources(plugin: SourcePlugin): boolean {
  return plugin.adaptiveHooks.length > 0 || plugin.hookAttachments.length > 0;
}

function renderAdaptiveFrontmatterHooks(
  graph: BuildGraph,
  scope: ResolvedAdaptiveHookAttachment["attachment"]["scope"],
  target: TargetName,
  sourceLabel: string
): JsonRecord | undefined {
  const resolved = adaptiveHookAttachmentsForScope(graph, scope, target);
  if (resolved.length === 0) return undefined;

  const hooks: Record<string, JsonValue[]> = {};
  for (const item of resolved) {
    const event = nativeHookEventName(target, item.event);
    const eventGroups = hooks[event] ?? [];
    eventGroups.push(renderAdaptiveFrontmatterHookGroup(item, target));
    hooks[event] = eventGroups;
  }

  validateHookDefinition({ hooks }, { sourcePath: `${sourceLabel} adaptive hooks`, target });
  return hooks;
}

function renderAdaptiveFrontmatterHookGroup(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): JsonRecord {
  validateSupportedAdaptiveFrontmatterHookFields(item, target);
  const matcher = item.attachment.match ?? item.definition.frontmatter.match;
  const statusMessage = item.attachment.status ?? readString(item.definition.frontmatter, "status");
  return {
    ...(matcher === undefined ? {} : { matcher }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
    hooks: [{
      command: adaptiveFrontmatterHookCommand(item),
      type: "command",
    }],
  };
}

function validateSupportedAdaptiveFrontmatterHookFields(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): void {
  const reason = adaptiveHookUnsupportedRenderReason(item, target, "frontmatter");
  if (reason !== undefined) {
    throw new Error(`skillset: ${reason}`);
  }
}

function adaptiveFrontmatterHookCommand(item: ResolvedAdaptiveHookAttachment): string {
  const run = readRecord(item.definition.frontmatter, "run") ?? {};
  const command = readString(run, "command");
  if (command === undefined) {
    throw new Error(`skillset: adaptive hook ${item.definition.name} must define run.command for frontmatter hook rendering`);
  }
  return withAdaptiveHookContextCommand(command, item, "claude");
}

function withAdaptiveHookRunEnv(command: string, item: ResolvedAdaptiveHookAttachment): string {
  const run = readRecord(item.definition.frontmatter, "run") ?? {};
  const env = readRecord(run, "env");
  if (env === undefined) return command;
  const assignments = Object.entries(env)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`skillset: adaptive hook ${item.definition.name} run.env key ${key} is not a valid shell environment variable name`);
      }
      if (typeof value !== "string") {
        throw new Error(`skillset: adaptive hook ${item.definition.name} run.env key ${key} must be a string`);
      }
      return `${key}=${shellLiteral(value)}`;
    });
  if (assignments.length === 0) return command;
  return `env ${assignments.join(" ")} sh -c ${shellLiteral(command)}`;
}

function withAdaptiveHookContextCommand(
  command: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string {
  const context = readRecord(item.definition.frontmatter, "context");
  if (context === undefined) return command;
  const strategy = readString(context, "strategy") ?? "none";
  if (strategy === "none") return command;
  if (strategy === "toolkit") {
    return withAdaptiveHookToolkitContextCommand(command, item, target, readStringArray(context, "env") ?? []);
  }
  if (strategy !== "inline") {
    throw new Error(`skillset: adaptive hook ${item.definition.name} context.strategy ${strategy} is not supported for rendering yet`);
  }
  const fields = readStringArray(context, "env") ?? [];
  if (fields.length === 0) {
    throw new Error(`skillset: adaptive hook ${item.definition.name} context.env must list fields for inline context rendering`);
  }
  const assignments = fields.map((field) => adaptiveHookContextAssignment(field, item, target));
  return `${assignments.join(" ")} ${command}`;
}

function withAdaptiveHookToolkitContextCommand(
  command: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  fields: readonly string[]
): string {
  const event = shellLiteral(item.event);
  const provider = `SKILLSET_PROVIDER=${target}`;
  const hookEvent = `SKILLSET_HOOK_EVENT=${event}`;
  const fieldArgs = fields.length === 0 ? "" : ` --fields ${shellLiteral(fields.join(","))}`;
  const helper = `${provider} ${hookEvent} skillset-toolkit runtime context --event ${event} --format env${fieldArgs}`;
  return `eval "$(${helper})" && ${command}`;
}

function adaptiveHookContextAssignment(
  field: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string {
  switch (field) {
    case "provider":
      return `SKILLSET_PROVIDER=${target}`;
    case "hook.event":
      return `SKILLSET_HOOK_EVENT=${shellLiteral(item.event)}`;
    case "session.id":
      return `SKILLSET_SESSION_ID="${targetSessionIdExpression(target)}"`;
    default:
      throw new Error(`skillset: adaptive hook ${item.definition.name} context.env field ${field} is not supported`);
  }
}

function targetSessionIdExpression(target: TargetName): string {
  if (target === "claude") return "${CLAUDE_SESSION_ID:-}";
  if (target === "codex") return "${CODEX_SESSION_ID:-}";
  return "${CURSOR_SESSION_ID:-}";
}

function shellLiteral(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function adaptiveHookAttachmentsForScope(
  graph: BuildGraph,
  scope: ResolvedAdaptiveHookAttachment["attachment"]["scope"],
  target: TargetName
): readonly ResolvedAdaptiveHookAttachment[] {
  return resolveAdaptiveHookAttachments(graph.adaptiveHooks, graph.hookAttachments).resolved.filter((item) =>
    sameAdaptiveHookScope(item.attachment.scope, scope) &&
    supportsAdaptiveHookTarget(item, target, "frontmatter")
  );
}

function sameAdaptiveHookScope(
  left: ResolvedAdaptiveHookAttachment["attachment"]["scope"],
  right: ResolvedAdaptiveHookAttachment["attachment"]["scope"]
): boolean {
  return left.kind === right.kind &&
    left.pluginId === right.pluginId &&
    left.skillId === right.skillId &&
    left.agentId === right.agentId;
}

function skillScope(
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): ResolvedAdaptiveHookAttachment["attachment"]["scope"] {
  return {
    kind: "skill",
    ...(plugin === undefined ? {} : { pluginId: plugin.id }),
    skillId: skill.id,
  };
}

async function renderPluginFeatureFiles(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string,
  outputRoot: string,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const feature of plugin.features) {
    if (!pluginFeatureSupportsTarget(feature, target)) continue;
    const targetPath = pluginFeatureTargetPath(feature, target);
    const files = (await copyPath(feature.sourcePath, join(basePath, targetPath)))
      .filter((file) => !file.path.endsWith(".gitkeep"))
      .map((file) =>
        feature.key === "mcp"
          ? { ...file, sourcePath: relative(graph.rootPath, feature.sourcePath) }
          : file
      );
    rendered.push(...files);
    if (files.length === 0) continue;
    lockRootsFor(lockRoots, outputRoot, pluginLockTarget(graph, target)).items.push(
      await lockItemForPluginFeature({
        feature,
        files,
        graph,
        outputRoot,
        plugin,
        target,
      })
    );
  }
  return rendered;
}

function pluginFeatureSupportsTarget(feature: SourcePluginFeature, target: TargetName): boolean {
  if (feature.key === "bin") return target === "claude";
  return true;
}

function pluginFeatureTargetPath(feature: SourcePluginFeature, target: TargetName): string {
  if (feature.key === "mcp" && target === "cursor") return "mcp.json";
  return feature.targetPath;
}

function pluginHasFeature(plugin: SourcePlugin, key: SourcePluginFeature["key"]): boolean {
  return plugin.features.some((feature) => feature.key === key);
}

/**
 * Render Codex and Cursor plugin hook files at the documented default path
 * `hooks/hooks.json` with a top-level `hooks` object.
 *
 * Source resolution: `hooks/hooks.json` is the canonical hook source for both
 * plugin targets. Flat event maps are normalized into the canonical
 * `{ "hooks": { ... } }` shape.
 */
async function renderNormalizedPluginHookFile(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string
): Promise<RenderedFile | undefined> {
  const canonicalSource = join(plugin.path, "hooks", "hooks.json");
  if (!(await exists(canonicalSource))) return undefined;

  await validateHookJson(graph, canonicalSource, target);
  const parsed = JSON.parse(await readFile(canonicalSource, "utf8")) as JsonValue;
  const normalized = isJsonRecord(parsed) && isJsonRecord(parsed.hooks) ? parsed : { hooks: parsed };
  const providerNative = normalizePluginHookEventNames(normalized, target, relative(graph.rootPath, canonicalSource));
  return textFile(
    join(basePath, "hooks", "hooks.json"),
    renderValidatedJson(providerNative, `${relative(graph.rootPath, canonicalSource)} -> ${join(basePath, "hooks", "hooks.json")}`),
    relative(graph.rootPath, canonicalSource)
  );
}

function normalizePluginHookEventNames(
  normalized: JsonRecord,
  target: TargetName,
  sourceLabel: string
): JsonRecord {
  if (target !== "cursor" || !isJsonRecord(normalized.hooks)) return normalized;

  const hooks: Record<string, JsonValue> = {};
  for (const [event, groups] of Object.entries(normalized.hooks)) {
    if (groups === undefined) continue;
    const nativeEvent = nativeHookEventName(target, event);
    if (Object.hasOwn(hooks, nativeEvent)) {
      throw new Error(
        `skillset: Cursor hook file ${sourceLabel} maps multiple events to ${nativeEvent}; keep only one canonical or native spelling.`
      );
    }
    hooks[nativeEvent] = groups;
  }

  return { ...normalized, hooks };
}

async function validateHookJson(
  graph: BuildGraph,
  sourcePath: string,
  target: TargetName
): Promise<void> {
  if (!(await exists(sourcePath))) return;

  const sourceLabel = relative(graph.rootPath, sourcePath);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8")) as JsonValue;
  } catch (error) {
    const provider = targetLabel(target);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: ${provider} hook file ${sourceLabel} is not valid JSON: ${message}`);
  }

  validateHookDefinition(parsed, { sourcePath: sourceLabel, target });
}

async function copyPath(sourcePath: string, targetPath: string): Promise<readonly RenderedFile[]> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    return [{ path: targetPath, content: await readFile(sourcePath) }];
  }

  const files: RenderedFile[] = [];
  for (const file of await collectFiles(sourcePath)) {
    files.push({
      path: join(targetPath, relative(sourcePath, file)),
      content: await readFile(file),
    });
  }
  return files;
}

async function renderLockFiles(
  graph: BuildGraph,
  lockRoots: ReadonlyMap<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const existingMarketplaceState = await readExistingMarketplaceState(graph.rootPath);

  for (const [outputRoot, lock] of [...lockRoots.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const value: JsonRecord = {
      buildMode: graph.root.compile.build,
      features: {
        promptArguments: graph.root.compile.features.promptArguments,
      },
      generatedBy: GENERATED_BY,
      items: lock.items
        .map((item) => stripUndefinedLockItem(item))
        .sort((left, right) => compareStrings(String(left.outputPath), String(right.outputPath))),
      ...(outputRoot === WORKSPACE_LOCK_ROOT
        ? marketplaceLockProvenance(graph, lockRoots, existingMarketplaceState)
        : {}),
      selectedTargets: [...graph.root.compile.targets],
      skillsetMetadata: graph.root.compile.skillset.metadata,
      outputRoot,
      schemaVersion: 1,
      sourceRoot: graph.sourceRoot,
      target: lock.target,
    };
    rendered.push(textFile(join(outputRoot, "skillset.lock"), renderValidatedJson(value, `${outputRoot}/skillset.lock`)));
  }

  return rendered;
}

function marketplaceLockProvenance(
  graph: BuildGraph,
  lockRoots: ReadonlyMap<string, LockRoot>,
  existingState: ExistingMarketplaceState
): JsonRecord {
  const entries: JsonRecord[] = [];
  for (const [catalogName, catalog] of Object.entries(graph.root.marketplaces).sort(([left], [right]) => compareStrings(left, right))) {
    for (const entry of catalog.plugins) {
      const requested = marketplaceRequestedRefPolicy(entry) as unknown as JsonRecord;
      const plugin = entry.repo === undefined
        ? graph.plugins.find((candidate) => candidate.id === entry.plugin)
        : undefined;
      for (const target of entry.targets ?? catalog.targets) {
        if (entry.repo !== undefined) {
          const preserved = preserveExternalMarketplaceEntry(
            existingState.entries,
            catalogName,
            entry.id,
            entry.plugin,
            entry.repo,
            requested,
            target
          );
          if (preserved !== undefined) {
            entries.push(preserved);
            continue;
          }
        }
        const generatedPath = plugin === undefined ? undefined : marketplacePluginManifestPath(graph, plugin, target);
        const renderable = plugin !== undefined && plugin.targets[target].enabled && isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, plugin.id);
        const generatedPaths = renderable ? marketplaceGeneratedPaths(lockRoots, graph.root.outputs.plugins[target], target, entry.plugin) : [];
        const provider = generatedPath === undefined ? "" : marketplaceProviderSource(generatedPath);
        entries.push(stripUndefinedJsonRecord({
          catalog: catalogName,
          entryId: entry.id,
          generatedPath,
          generatedPaths: [...generatedPaths],
          plugin: entry.plugin,
          providerSource: provider,
          readiness: renderable ? "marketplace-ready" : "not-ready",
          repo: entry.repo,
          requested,
          requestedTarget: target,
          resolved: stripUndefinedJsonRecord({
            generatedPath,
            generatedPaths: [...generatedPaths],
            pluginVersion: plugin === undefined ? undefined : pluginVersion(graph, plugin),
            providerSource: provider,
            repository: entry.repo === undefined
              ? undefined
              : parseRemoteRepositoryReference(entry.repo).canonical,
            sourceKind: entry.repo === undefined ? "current" : "unresolved",
          }),
        }));
      }
    }
  }
  return entries.length === 0 ? {} : {
    marketplaces: {
      activeCatalogs: activeMarketplaceCatalogs(graph, existingState.activeCatalogs),
      entries: entries.sort((left, right) => compareStrings(`${left.catalog}\0${left.entryId}\0${left.requestedTarget}`, `${right.catalog}\0${right.entryId}\0${right.requestedTarget}`)),
    },
  };
}

interface ExistingMarketplaceState {
  readonly activeCatalogs: JsonRecord;
  readonly entries: readonly JsonRecord[];
}

const EMPTY_MARKETPLACE_STATE: ExistingMarketplaceState = { activeCatalogs: {}, entries: [] };

async function readExistingMarketplaceState(rootPath: string): Promise<ExistingMarketplaceState> {
  let raw: string;
  try {
    raw = await readFile(join(rootPath, "skillset.lock"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return EMPTY_MARKETPLACE_STATE;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corruptWorkspaceLock("skillset.lock", `it is not valid JSON: ${message}`);
  }
  if (!isJsonRecord(parsed)) {
    throw corruptWorkspaceLock("skillset.lock", "it is missing a string generatedBy field");
  }
  const marketplaces = parsed.marketplaces;
  if (!isJsonRecord(marketplaces)) return EMPTY_MARKETPLACE_STATE;
  return {
    activeCatalogs: isJsonRecord(marketplaces.activeCatalogs) ? marketplaces.activeCatalogs : {},
    entries: Array.isArray(marketplaces.entries) ? marketplaces.entries.filter(isJsonRecord) : [],
  };
}

function activeMarketplaceCatalogs(graph: BuildGraph, existing: JsonRecord): JsonRecord {
  const active: Record<string, JsonValue> = {};
  for (const target of targetNames()) {
    const catalogs = Object.entries(graph.root.marketplaces)
      .filter(([, catalog]) => catalog.plugins.some((entry) => (entry.targets ?? catalog.targets).includes(target)))
      .sort(([left], [right]) => compareStrings(left, right));
    const requested = optionalString(existing[target]);
    const selected = requested === undefined ? undefined : catalogs.find(([name]) => name === requested);
    if (selected !== undefined) {
      active[target] = selected[0];
      continue;
    }
    const onlyCatalog = catalogs[0];
    if (catalogs.length === 1 && onlyCatalog !== undefined) active[target] = onlyCatalog[0];
  }
  return active;
}

function preserveExternalMarketplaceEntry(
  existingEntries: readonly JsonRecord[],
  catalog: string,
  entryId: string,
  plugin: string,
  repo: string,
  requested: JsonRecord,
  target: TargetName
): JsonRecord | undefined {
  const existing = existingEntries.find((candidate) =>
    candidate.catalog === catalog &&
    candidate.entryId === entryId &&
    candidate.plugin === plugin &&
    candidate.repo === repo &&
    candidate.requestedTarget === target &&
    isJsonRecord(candidate.requested) &&
    marketplaceRequestedPoliciesEqual(candidate.requested, requested)
  );
  if (existing === undefined || existing.readiness !== "marketplace-ready" || !isJsonRecord(existing.resolved)) {
    return undefined;
  }
  const resolved = existing.resolved;
  if (!isStringArray(existing.generatedPaths) || !isStringArray(resolved.generatedPaths)) return undefined;
  const providerEntry = target === "claude" ? storedClaudeMarketplaceProviderEntry(existing) : undefined;
  if (target === "claude" && providerEntry === undefined) return undefined;
  if (typeof existing.providerSource !== "string" || typeof resolved.providerSource !== "string") return undefined;
  if (typeof resolved.sha !== "string" || !/^[0-9a-f]{40}$/u.test(resolved.sha)) return undefined;
  const generatedPath = optionalString(existing.generatedPath);
  const resolvedGeneratedPath = optionalString(resolved.generatedPath);
  if (generatedPath !== undefined && !isPortableMarketplacePath(generatedPath)) return undefined;
  if (resolvedGeneratedPath !== undefined && !isPortableMarketplacePath(resolvedGeneratedPath)) return undefined;
  if (!existing.generatedPaths.every(isPortableMarketplacePath)) return undefined;
  if (!resolved.generatedPaths.every(isPortableMarketplacePath)) return undefined;
  if (!isPortableMarketplacePath(existing.providerSource) || !isPortableMarketplacePath(resolved.providerSource)) {
    return undefined;
  }

  return stripUndefinedJsonRecord({
    catalog,
    entryId,
    generatedPath,
    generatedPaths: [...existing.generatedPaths],
    plugin,
    ...(providerEntry === undefined ? {} : { providerEntry }),
    providerSource: existing.providerSource,
    readiness: "marketplace-ready",
    repo,
    requested,
    requestedTarget: target,
    resolved: stripUndefinedJsonRecord({
      generatedPath: resolvedGeneratedPath,
      generatedPaths: [...resolved.generatedPaths],
      pluginVersion: optionalString(resolved.pluginVersion),
      providerSource: resolved.providerSource,
      ref: optionalString(resolved.ref),
      repository: parseRemoteRepositoryReference(repo).canonical,
      sha: resolved.sha,
      sourceKind: "external",
    }),
  });
}

function marketplaceRequestedPoliciesEqual(left: JsonRecord, right: JsonRecord): boolean {
  return left.kind === right.kind &&
    left.channel === right.channel &&
    left.ref === right.ref &&
    left.sha === right.sha &&
    left.version === right.version;
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPortableMarketplacePath(value: string): boolean {
  return !value.startsWith("/") &&
    !value.startsWith("~") &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]+/u).includes("..");
}

function marketplaceGeneratedPaths(
  lockRoots: ReadonlyMap<string, LockRoot>,
  outputRoot: string,
  target: TargetName,
  pluginId: string
): readonly string[] {
  const lock = lockRoots.get(outputRoot);
  if (lock === undefined) return [];
  const paths = new Set<string>();
  for (const item of lock.items) {
    if (item.plugin !== pluginId && !(item.kind === "plugin" && item.name === pluginId)) continue;
    for (const file of item.files) {
      if (isDefaultPluginOutputRoot(outputRoot) && !file.startsWith(`${pluginId}/${target}/`)) continue;
      paths.add(join(outputRoot, file).replaceAll("\\", "/"));
    }
  }
  return [...paths].sort(compareStrings);
}

function marketplacePluginManifestPath(graph: BuildGraph, plugin: SourcePlugin, target: TargetName): string {
  return pluginManifestPath(graph.root.outputs.plugins[target], target, plugin.id);
}

function marketplaceProviderSource(path: string): string {
  const defaultMatch = path.match(/^plugins\/([^/]+)\/(claude|codex|cursor)\//);
  if (defaultMatch !== null) return `./plugins/${defaultMatch[1]}/${defaultMatch[2]}`;
  const overrideMatch = path.match(/^(.*)\/plugins\/([^/]+)/);
  if (overrideMatch === null) return path;
  const pluginId = overrideMatch[2];
  return pluginId === undefined ? path : `./plugins/${pluginId}`;
}

function stripUndefinedJsonRecord(record: Record<string, JsonValue | undefined>): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as JsonRecord;
}

function lockRootsFor(
  lockRoots: Map<string, LockRoot>,
  outputRoot: string,
  target: TargetName | "workspace"
): LockRoot {
  const existing = lockRoots.get(outputRoot);
  if (existing !== undefined) {
    if (existing.target === target) return existing;
    const merged: LockRoot = { items: [...existing.items], target: "workspace" };
    lockRoots.set(outputRoot, merged);
    return merged;
  }
  const created: LockRoot = { items: [], target };
  lockRoots.set(outputRoot, created);
  return created;
}

function pluginLockTarget(graph: BuildGraph, target: TargetName): TargetName | "workspace" {
  return targetNames().some((candidate) =>
    candidate !== target && graph.root.outputs.plugins[candidate] === graph.root.outputs.plugins[target]
  )
    ? "workspace"
    : target;
}

async function renderChangelogs(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const projections = await renderChangelogProjections(graph);
  if (projections.length === 0) return [];
  const rendered = projections.map((projection) => projection.file);
  const lockRoot = lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace");
  for (const projection of projections) {
    lockRoot.items.push(lockItemForChangelog(projection));
  }
  return rendered;
}

function lockItemForChangelog(projection: ChangelogProjection): LockItem {
  return {
    feature: projection.entityKind,
    files: [projection.outputPath],
    kind: "changelog",
    name: projection.entityId,
    outputHash: hashRenderedFiles(WORKSPACE_LOCK_ROOT, [projection.file]),
    outputPath: projection.outputPath,
    sourceHash: projection.sourceHash,
    sourcePath: projection.sourcePath,
    targetState: "generated",
    validation: "structured",
  };
}

function lockItemForPlugin(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly license: ResolvedLicense | undefined;
  readonly outputRoot: string;
  readonly plugin: SourcePlugin;
  readonly target: TargetName;
}): LockItem {
  const includedSkills = args.plugin.skills
    .filter((skill) => skill.targets[args.target].enabled)
    .map((skill) => skillVersionLabel(args.graph, args.plugin, skill))
    .sort();
  const skippedSkills = args.plugin.skills
    .filter((skill) => !skill.targets[args.target].enabled)
    .map((skill) => skillVersionLabel(args.graph, args.plugin, skill))
    .sort();
  const dependencies = pluginDependencySummaries(args.graph, args.plugin);
  const dependencyHashSummaries = pluginDependencyHashSummaries(args.graph, args.plugin, args.target);
  const files = args.files
    .map((file) => relative(args.outputRoot, file.path))
    .sort();

  return {
    ...(dependencies.length === 0 ? {} : { dependencies }),
    files,
    includedSkills,
    kind: "plugin",
    name: args.plugin.id,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: files.find((file) => file.endsWith("/plugin.json")) ?? files[0] ?? "",
    skippedSkills,
    renderInputsHash: hashPluginRenderInputs(args.graph, args.plugin, args.license),
    sourceHash: hashPluginSource(
      args.graph,
      args.plugin,
      args.target,
      includedSkills,
      skippedSkills,
      dependencyHashSummaries,
      args.license
    ),
    ...(args.plugin.sourceOrigin === undefined ? {} : { sourceOrigin: args.plugin.sourceOrigin }),
    sourcePath: relative(args.graph.rootPath, args.plugin.path),
    targetState: skippedSkills.length === 0 ? "sync" : "intentionally-skipped",
    version: pluginVersion(args.graph, args.plugin),
  };
}

function licenseFileFor(path: string, license: ResolvedLicense): RenderedFile {
  return textFile(path, license.content, license.sourcePath);
}

function resolveRootLicense(graph: BuildGraph): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: relative(graph.rootPath, graph.rootManifestPath),
    metadata: graph.root.metadata,
    scopePath: graph.sourceRootPath,
    sourcePath: graph.rootManifestPath,
  });
}

function resolvePluginLicense(
  graph: BuildGraph,
  plugin: SourcePlugin,
  rootLicense: ResolvedLicense | undefined
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: relative(graph.rootPath, plugin.configPath),
    metadata: plugin.metadata,
    ...(rootLicense === undefined ? {} : { parent: rootLicense }),
    scopePath: plugin.path,
    sourcePath: plugin.configPath,
  });
}

async function lockItemForPluginFeature(args: {
  readonly feature: SourcePluginFeature;
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly outputRoot: string;
  readonly plugin: SourcePlugin;
  readonly target: TargetName;
}): Promise<LockItem> {
  const targetPath = pluginFeatureTargetPath(args.feature, args.target);
  return {
    feature: args.feature.key,
    files: args.files.map((file) => relative(args.outputRoot, file.path)).sort(),
    kind: "plugin-feature",
    name: `${args.plugin.id}:${args.feature.key}`,
    origin: args.feature.origin,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: relative(args.outputRoot, join(pluginTargetRoot(args.outputRoot, args.target, args.plugin.id), targetPath)),
    plugin: args.plugin.id,
    sourceHash: await hashPluginFeatureSource(args.feature),
    sourcePath: relative(args.graph.rootPath, args.feature.sourcePath),
    ...(args.feature.sourcePointer === undefined ? {} : { sourcePointer: args.feature.sourcePointer }),
    targetState: args.feature.key === "bin" && args.target === "claude" ? "target-native" : "sync",
    validation: args.feature.key === "mcp" ? "structured" : "opaque-copy",
    version: pluginVersion(args.graph, args.plugin),
  };
}

function lockItemForRule(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly name: string;
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly preprocessDependencies: readonly string[];
  readonly sourceHash: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly transforms?: readonly AppliedTransform[];
}): LockItem {
  return {
    files: args.files.map((file) => relative(args.outputRoot, file.path)).sort(),
    kind: "rule",
    name: args.name,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: relative(args.outputRoot, args.outputPath),
    ...(args.preprocessDependencies.length === 0
      ? {}
      : { preprocessDependencies: args.preprocessDependencies }),
    sourceHash: args.sourceHash,
    ...(args.sourceOrigin === undefined ? {} : { sourceOrigin: args.sourceOrigin }),
    sourcePath: args.sourcePath,
    ...(args.transforms === undefined || args.transforms.length === 0
      ? {}
      : { transforms: args.transforms }),
    version: rootVersion(args.graph),
  };
}

function lockItemForIsland(args: {
  readonly graph: BuildGraph;
  readonly island: SourceIslandFile;
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly result: RenderedIslandFile;
}): LockItem {
  return {
    files: [relative(args.outputRoot, args.result.file.path)],
    kind: "island",
    name: `${args.island.target}:${args.island.plugin ?? "project"}:${args.island.relativePath}`,
    outputHash: hashRenderedFiles(args.outputRoot, [args.result.file]),
    outputPath: relative(args.outputRoot, args.outputPath),
    preprocessDependencies: args.result.preprocessDependencies,
    sourceHash: hashIslandSource(args.island, args.result.preprocessDependencies, args.graph.rootPath),
    sourcePath: relative(args.graph.rootPath, args.island.sourcePath),
    validation: args.result.validation,
    version: rootVersion(args.graph),
    ...(args.island.plugin === undefined ? {} : { plugin: args.island.plugin }),
  };
}

function lockItemForProjectAgent(args: {
  readonly agent: SourceProjectAgent;
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly outputRoot: string;
  readonly result: RenderedProjectAgentFile;
}): LockItem {
  const files = args.files
    .map((file) => relative(args.outputRoot, file.path))
    .sort();

  return {
    files,
    kind: "project-agent",
    name: args.agent.outputName,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: files[0] ?? "",
    preprocessDependencies: args.result.preprocessDependencies,
    sourceHash: hashProjectAgentSource(
      args.graph,
      args.agent,
      args.result.target,
      args.graph.root.compile.skillset.metadata,
      args.result.preprocessDependencies,
      args.graph.rootPath
    ),
    sourcePath: relative(args.graph.rootPath, args.agent.sourcePath),
    validation: "structured",
    version: rootVersion(args.graph),
  };
}

async function lockItemForSkill(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly kind: LockItem["kind"];
  readonly license: ResolvedLicense | undefined;
  readonly outputRoot: string;
  readonly plugin?: SourcePlugin;
  readonly preprocessDependencies: readonly string[];
  readonly skill: SourceSkill;
  readonly sourceDir: string;
  readonly transforms: readonly AppliedTransform[];
}): Promise<LockItem> {
  const files = args.files
    .map((file) => relative(args.outputRoot, file.path))
    .sort();

  return {
    files,
    kind: args.kind,
    name: args.skill.id,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: files.find((file) => file.endsWith("/SKILL.md")) ?? files[0] ?? "",
    ...(args.preprocessDependencies.length === 0 ? {} : { preprocessDependencies: args.preprocessDependencies }),
    sourceHash: await hashSkillSource(
      args.sourceDir,
      args.skill.resources,
      args.skill.targets,
      renderAdaptiveFrontmatterHooks(
        args.graph,
        skillScope(args.plugin, args.skill),
        "claude",
        relative(args.graph.rootPath, args.skill.sourcePath)
      ),
      args.license,
      args.graph.root.compile.skillset.metadata,
      args.preprocessDependencies,
      args.graph.rootPath
    ),
    ...(args.skill.sourceOrigin === undefined ? {} : { sourceOrigin: args.skill.sourceOrigin }),
    sourcePath: relative(args.graph.rootPath, args.skill.sourcePath),
    ...(args.transforms.length === 0 ? {} : { transforms: args.transforms }),
    version: skillVersion(args.graph, args.plugin, args.skill),
    ...(args.plugin === undefined ? {} : { plugin: args.plugin.id }),
  };
}

function hashIslandSource(
  island: SourceIslandFile,
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  const hash = createHash("sha256");
  hash.update("skillset-island-source-v1\0");
  hash.update(island.target);
  hash.update("\0");
  hash.update(island.plugin ?? "");
  hash.update("\0");
  hash.update(island.relativePath);
  hash.update("\0");
  hash.update(readFileSyncBytes(island.sourcePath));
  hash.update("\0");
  for (const dependency of preprocessDependencies) {
    hash.update("dependency\0");
    hash.update(dependency);
    hash.update("\0");
    hash.update(readPreprocessDependencySync(rootPath, dependency));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function hashProjectAgentSource(
  graph: BuildGraph,
  agent: SourceProjectAgent,
  target: TargetName,
  skillsetMetadata: boolean,
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  const hash = createHash("sha256");
  hash.update("skillset-project-agent-source-v3\0");
  hash.update(agent.relativePath);
  hash.update("\0");
  hash.update(agent.name);
  hash.update("\0");
  hash.update(agent.outputName);
  hash.update("\0");
  hash.update(stringifyJson(agent.frontmatter));
  hash.update("\0");
  hash.update(agent.body);
  hash.update("\0");
  hash.update("resolved-target\0");
  hash.update(target);
  hash.update("\0");
  hash.update(stringifyJson({
    enabled: agent.targets[target].enabled,
    options: agent.targets[target].options,
  }));
  hash.update("\0skillset-metadata\0");
  hash.update(String(skillsetMetadata));
  hash.update("\0");
  const adaptiveHooks = target === "claude"
    ? renderAdaptiveFrontmatterHooks(
      graph,
      { agentId: agent.outputName, kind: "agent" },
      target,
      relative(graph.rootPath, agent.sourcePath)
    )
    : undefined;
  hash.update("resolved-adaptive-hooks\0");
  hash.update(stringifyJson(adaptiveHooks ?? {}));
  hash.update("\0");
  for (const dependency of preprocessDependencies) {
    hash.update("dependency\0");
    hash.update(dependency);
    hash.update("\0");
    hash.update(readPreprocessDependencySync(rootPath, dependency));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function stripUndefinedLockItem(item: LockItem): JsonRecord {
  const value: Record<string, JsonValue | undefined> = {
    feature: item.feature,
    files: [...item.files],
    dependencies: item.dependencies === undefined ? undefined : [...item.dependencies],
    includedSkills: item.includedSkills === undefined ? undefined : [...item.includedSkills],
    kind: item.kind,
    name: item.name,
    origin: item.origin,
    outputHash: item.outputHash,
    outputPath: item.outputPath,
    plugin: item.plugin,
    preprocessDependencies: item.preprocessDependencies === undefined ? undefined : [...item.preprocessDependencies],
    renderInputsHash: item.renderInputsHash,
    skippedSkills: item.skippedSkills === undefined ? undefined : [...item.skippedSkills],
    sourceHash: item.sourceHash,
    sourceOrigin: item.sourceOrigin === undefined ? undefined : sourceOriginRecord(item.sourceOrigin),
    sourcePath: item.sourcePath,
    sourcePointer: item.sourcePointer,
    targetState: item.targetState,
    transforms:
      item.transforms === undefined
        ? undefined
        : item.transforms.map(({ count, intent }) => ({ count, intent })),
    validation: item.validation,
    version: item.version,
  };
  return value;
}

function sourceOriginRecord(origin: SourceOrigin): JsonRecord {
  return {
    path: origin.path,
    ...(origin.ref === undefined ? {} : { ref: origin.ref }),
    ...(origin.repo === undefined ? {} : { repo: origin.repo }),
  };
}

function hashPluginSource(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  includedSkills: readonly string[],
  skippedSkills: readonly string[],
  dependencies: readonly string[],
  license: ResolvedLicense | undefined
): string {
  const hash = createHash("sha256");
  hash.update("skillset-plugin-source-v4\0");
  hash.update(plugin.id);
  hash.update("\0");
  hash.update(target);
  hash.update("\0");
  hash.update(stringifyJson(plugin.metadata));
  hash.update("\0");
  hash.update(stringifyJson(readRecord(graph.root.metadata, "owner") ?? {}));
  hash.update("\0");
  hash.update(stringifyJson(plugin.targets[target].options));
  hash.update("\0plugin-surfaces\0");
  const manifestSurfacePaths = withOptionalSurfacePaths(graph, {}, plugin, [], target);
  hash.update(stringifyJson(JSON.parse(JSON.stringify({
    adaptiveHooks: plugin.adaptiveHooks.map((hook) => ({
      events: hook.events,
      frontmatter: hook.frontmatter,
      name: hook.name,
      providers: hook.providers,
      scope: hook.scope,
      scriptReferences: hook.scriptReferences.map((reference) => ({
        kind: reference.kind,
        reference: reference.reference,
        runtimePath: reference.runtimePath,
      })),
    })),
    features: plugin.features.map((feature) => ({
      key: feature.key,
      origin: feature.origin,
      sourcePointer: feature.sourcePointer,
      targetPath: feature.targetPath,
    })),
    hookAttachments: plugin.hookAttachments.map((attachment) => ({
      event: attachment.event,
      hook: attachment.hook,
      match: attachment.match,
      providers: attachment.providers,
      scope: attachment.scope,
      status: attachment.status,
    })),
    ...(Object.keys(manifestSurfacePaths).length === 0 ? {} : { manifestSurfacePaths }),
    islands: graph.projectIslands
      .filter((island) => island.plugin === plugin.id && island.target === target)
      .map((island) => ({ relativePath: island.relativePath, target: island.target }))
      .sort((left, right) => compareStrings(left.relativePath, right.relativePath)),
  })) as JsonRecord));
  if (target === "codex") {
    hash.update("\0root-derived-interface\0");
    hash.update(stringifyJson({ developerName: renderCodexInterface(graph, plugin).developerName }));
  }
  hash.update("\0");
  hash.update(includedSkills.join("\n"));
  hash.update("\0");
  hash.update(skippedSkills.join("\n"));
  hash.update("\0resolved-license\0");
  hash.update(stringifyJson(
    license === undefined
      ? {}
      : {
          content: license.content,
          manifestValue: license.manifestValue,
        }
  ));
  if (dependencies.length > 0) {
    hash.update("\0dependencies\0");
    hash.update(dependencies.join("\n"));
  }
  return `sha256:${hash.digest("hex")}`;
}

function hashPluginRenderInputs(
  graph: BuildGraph,
  plugin: SourcePlugin,
  license: ResolvedLicense | undefined
): string {
  const hash = createHash("sha256");
  hash.update("skillset-plugin-render-inputs-v1\0");
  hash.update(stringifyJson(readRecord(graph.root.metadata, "owner") ?? {}));
  hash.update("\0");
  hash.update(pluginVersion(graph, plugin));
  hash.update("\0");
  hash.update(
    stringifyJson(
      license === undefined
        ? {}
        : {
            content: license.content,
            manifestValue: license.manifestValue,
          }
    )
  );
  return `sha256:${hash.digest("hex")}`;
}

async function hashPluginFeatureSource(feature: SourcePluginFeature): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-plugin-feature-source-v1\0");
  hash.update(feature.key);
  hash.update("\0");
  hash.update(feature.origin);
  hash.update("\0");
  hash.update(feature.sourcePointer ?? "");
  hash.update("\0");
  hash.update(feature.targetPath);
  hash.update("\0");
  const stats = await stat(feature.sourcePath);
  if (stats.isFile()) {
    hash.update("file\0");
    hash.update(await readFile(feature.sourcePath));
    hash.update("\0");
  } else {
    hash.update("dir\0");
    for (const file of await collectFiles(feature.sourcePath)) {
      hash.update(relative(feature.sourcePath, file));
      hash.update("\0");
      hash.update(await readFile(file));
      hash.update("\0");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

async function hashSkillSource(
  sourceDir: string,
  resources: readonly SourceResource[],
  targets: SourceSkill["targets"],
  adaptiveHooks: JsonRecord | undefined,
  license: ResolvedLicense | undefined,
  skillsetMetadata: boolean,
  preprocessDependencies: readonly string[],
  rootPath: string
): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-skill-source-v5\0");

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "CHANGELOG.md") continue;
    hash.update("skill\0");
    hash.update(relativeFile);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  for (const resource of [...resources].sort((left, right) =>
    compareStrings(left.targetPath, right.targetPath)
  )) {
    hash.update("resource\0");
    hash.update(resource.from);
    hash.update("\0");
    hash.update(resource.targetPath);
    hash.update("\0");
    await hashResourceSource(hash, resource);
  }

  hash.update("resolved-targets\0");
  hash.update(stringifyJson(Object.fromEntries(
    targetNames().map((target) => [target, {
      enabled: targets[target].enabled,
      options: targets[target].options,
    }])
  )));
  hash.update("\0");

  hash.update("resolved-adaptive-hooks\0");
  hash.update(stringifyJson(adaptiveHooks ?? {}));
  hash.update("\0");

  hash.update("skillset-metadata\0");
  hash.update(String(skillsetMetadata));
  hash.update("\0");

  hash.update("resolved-license\0");
  hash.update(stringifyJson(
    license === undefined
      ? {}
      : {
          content: license.content,
          manifestValue: license.manifestValue,
        }
  ));
  hash.update("\0");

  for (const dependency of preprocessDependencies) {
    hash.update("preprocess-dependency\0");
    hash.update(dependency);
    hash.update("\0");
    hash.update(readPreprocessDependencySync(rootPath, dependency));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

async function hashResourceSource(
  hash: ReturnType<typeof createHash>,
  resource: SourceResource
): Promise<void> {
  const stats = await stat(resource.sourcePath);
  if (stats.isFile()) {
    hash.update("file\0");
    hash.update(await readFile(resource.sourcePath));
    hash.update("\0");
    return;
  }

  hash.update("dir\0");
  for (const file of await collectFiles(resource.sourcePath)) {
    hash.update(relative(resource.sourcePath, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
}

function hashTextRule(
  rule: SourceRule,
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  return hashRules([rule], preprocessDependencies, rootPath);
}

function hashRules(
  rules: readonly SourceRule[],
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  const hash = createHash("sha256");
  hash.update("skillset-rule-source-v1\0");
  for (const rule of [...rules].sort((left, right) => compareStrings(left.sourcePath, right.sourcePath))) {
    hash.update(rule.relativePath);
    hash.update("\0");
    hash.update(stringifyJson(rule.frontmatter));
    hash.update("\0");
    hash.update(rule.body);
    hash.update("\0");
  }
  for (const dependency of preprocessDependencies) {
    hash.update("preprocess-dependency\0");
    hash.update(dependency);
    hash.update("\0");
    hash.update(readPreprocessDependencySync(rootPath, dependency));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function hashRenderedFiles(outputRoot: string, files: readonly RenderedFile[]): string {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");

  for (const file of [...files].sort((left, right) => compareStrings(left.path, right.path))) {
    hash.update(relative(outputRoot, file.path));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile() && !entry.name.endsWith(".DS_Store")) {
      files.push(path);
    }
  }

  return files;
}

function pluginHasPath(plugin: SourcePlugin, path: string): boolean {
  try {
    validateSlug(plugin.id, "plugin id");
  } catch {
    return false;
  }
  // Real file-system errors (EACCES, ELOOP, ...) must surface instead of being
  // read as "path absent"; only a missing path counts as no surface.
  return hasRenderableContent(join(plugin.path, path));
}

function hasRenderableContent(path: string): boolean {
  // A missing path means "no surface"; any other FS error (EACCES, ELOOP, ...)
  // must surface instead of being read as absent.
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (stats.isFile()) return !isIgnoredCompanionFile(path);
  if (!stats.isDirectory()) return false;

  for (const entry of readdirSync(path)) {
    if (hasRenderableContent(join(path, entry))) return true;
  }

  return false;
}

function isIgnoredCompanionFile(path: string): boolean {
  const name = basename(path);
  return name === ".DS_Store" || name === ".gitkeep";
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function validateRenderedFile(file: RenderedFile): RenderedFile {
  if (file.sourcePath !== undefined || file.path.endsWith("skillset.lock")) {
    validateGeneratedStructuredOutput({
      content: textDecoder.decode(file.content),
      targetPath: file.path,
      ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }),
    });
  }
  return file;
}

function textFile(path: string, content: string, sourcePath?: string): RenderedFile {
  return sourcePath === undefined
    ? { path, content: textEncoder.encode(content) }
    : { path, content: textEncoder.encode(content), sourcePath };
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function readFileSyncBytes(path: string): Uint8Array {
  return readFileSync(path);
}
