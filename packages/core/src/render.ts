import { readFileSync, readdirSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";

import { lowerTransform, recognizeTransforms } from "@skillset/transforms";

import {
  isOutputSelected,
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
  stripSourceFrontmatter,
} from "./config";
import {
  pluginDependencies,
  pluginDependencyHashSummaries,
  pluginDependencySummaries,
  renderClaudePluginDependencies,
  renderCodexDependencyNotice,
} from "./dependencies";
import { validateHookDefinition } from "./hooks";
import { compareStrings, validateSlug } from "./path";
import { rewriteResourceLinks } from "./resources";
import {
  readAllowedTools,
  readClaudeNativeToolRules,
  readCodexToolMetadata,
  readImplicitInvocation,
} from "./skill-policy";
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
  rendered.push(...renderClaudeMarketplace(graph));

  for (const plugin of graph.plugins) {
    rendered.push(...(await renderPluginTarget(graph, plugin, "claude", lockRoots)));
    rendered.push(...(await renderPluginTarget(graph, plugin, "codex", lockRoots)));
  }

  for (const skill of graph.standaloneSkills) {
    rendered.push(...(await renderStandaloneSkill(graph, skill, "claude", lockRoots)));
    rendered.push(...(await renderStandaloneSkill(graph, skill, "codex", lockRoots)));
  }

  rendered.push(...(await renderProjectAgents(graph, lockRoots)));
  rendered.push(...(await renderRules(graph, lockRoots)));
  rendered.push(...(await renderProjectIslands(graph, lockRoots)));
  rendered.push(...(await renderChangelogs(graph, lockRoots)));
  rendered.push(...renderLockFiles(graph, lockRoots));
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
  if (graph.plugins.some((plugin) => shouldRenderPlugin(graph, plugin, "claude"))) {
    rendered.push(
      textFile(
        `${graph.root.outputs.plugins.claude}/README.md`,
        [
          "# Claude Plugins",
          "",
          "Generated Claude plugin repository.",
          "",
          "- `.claude-plugin/marketplace.json` indexes the generated plugins.",
          "- `plugins/<plugin-id>/` contains each Claude plugin bundle.",
          "- `.skillset.lock` records deterministic generated-state provenance.",
          "",
        ].join("\n")
      )
    );
  }
  if (graph.plugins.some((plugin) => shouldRenderPlugin(graph, plugin, "codex"))) {
    rendered.push(
      textFile(
        `${graph.root.outputs.plugins.codex}/README.md`,
        [
          "# Codex Plugins",
          "",
          "Generated Codex plugin repository.",
          "",
          "- `plugins/<plugin-id>/` contains each Codex plugin bundle.",
          "- `.skillset.lock` records deterministic generated-state provenance.",
          "",
        ].join("\n")
      )
    );
  }
  return rendered;
}

function renderClaudeMarketplace(graph: BuildGraph): readonly RenderedFile[] {
  const plugins = graph.plugins
    .filter((plugin) => shouldRenderPlugin(graph, plugin, "claude"))
    .map((plugin) => {
      const metadata = plugin.metadata;
      return mergeRecords(
        {
          name: plugin.id,
          source: `./plugins/${plugin.id}`,
          description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
          version: pluginVersion(graph, plugin),
          author: metadata.author,
          repository: metadata.repository,
          license: metadata.license,
          keywords: metadata.keywords,
          category: metadata.category,
          strict: metadata.strict,
        },
        readRecord(plugin.targets.claude.options, "marketplace") ?? {}
      );
    });

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
        pluginRoot: "./plugins",
        generatedBy: "example content repo skillset compiler",
      },
      plugins,
    },
    readRecord(graph.root.targets.claude.options, "marketplace") ?? {}
  );

  return [
    textFile(
      `${graph.root.outputs.plugins.claude}/.claude-plugin/marketplace.json`,
      renderValidatedJson(marketplace, "Claude marketplace")
    ),
  ];
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
  const basePath = `${outputRoot}/plugins/${plugin.id}`;
  const enabledSkills = plugin.skills.filter((skill) => skill.targets[target].enabled);
  const dependencySummaries = pluginDependencySummaries(graph, plugin);
  if (target === "codex" && dependencySummaries.length > 0 && enabledSkills.length === 0) {
    throw new Error(
      `skillset: plugin ${plugin.id} declares dependencies but has no enabled Codex skills to carry the dependency notice`
    );
  }
  const manifestFile = textFile(
    target === "claude"
      ? `${basePath}/.claude-plugin/plugin.json`
      : `${basePath}/.codex-plugin/plugin.json`,
    renderValidatedJson(
      renderPluginManifest(graph, plugin, target, enabledSkills),
      `${plugin.id} ${target} plugin manifest`
    ),
    relative(graph.rootPath, plugin.configPath)
  );

  rendered.push(manifestFile);
  lockRootsFor(lockRoots, outputRoot, target).items.push(
    lockItemForPlugin({
      file: manifestFile,
      graph,
      outputRoot,
      plugin,
      target,
    })
  );

  for (const skill of enabledSkills) {
    rendered.push(...(await renderPluginSkillFiles(graph, plugin, skill, target, basePath, outputRoot, lockRoots)));
  }

  rendered.push(...(await renderPluginFeatureFiles(graph, plugin, target, basePath, outputRoot, lockRoots)));
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
  enabledSkills: readonly SourceSkill[]
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
    license: metadata.license,
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
      ? withOptionalSurfacePaths(mergeRecords(base, dependencies === undefined ? {} : { dependencies }), plugin, enabledSkills, target)
      : mergeRecords(withOptionalSurfacePaths(base, plugin, enabledSkills, target), {
          interface: renderCodexInterface(graph, plugin),
        });
  const withOverrides = mergeRecords(targetBase, manifestOverrides);

  return mergeRecords(withOverrides, {
    version: pluginVersion(graph, plugin),
  });
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
    if (pluginHasPath(plugin, "hooks/hooks.json")) withPaths.hooks = "./hooks/hooks.json";
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
  } else {
    if (pluginHasPath(plugin, "hooks/hooks.json")) {
      withPaths.hooks = "./hooks/hooks.json";
    }
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./.mcp.json";
    if (pluginHasPath(plugin, ".app.json")) withPaths.apps = "./.app.json";
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
  lockRoots: Map<string, LockRoot>
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
  const generatedCodexToolsFile = renderCodexSkillToolsFile(
    graph,
    skill,
    target,
    targetSkillDir
  );
  const generatedCodexRelativeFiles = new Set(
    [generatedCodexAgentFile?.file, generatedCodexToolsFile]
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
  if (generatedCodexToolsFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedCodexToolsFile,
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.tools`
    );
  }

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "SKILL.md") continue;
    if (relativeFile === "CHANGELOG.md") continue;
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

  lockRootsFor(lockRoots, outputRoot, target).items.push(
    await lockItemForSkill({
      files: rendered,
      graph,
      kind: "plugin-skill",
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

async function renderClaudeProjectAgent(
  graph: BuildGraph,
  agent: SourceProjectAgent
): Promise<RenderedProjectAgentFile> {
  const targetOptions = agent.targets.claude.options;
  const initialPrompt = readString(targetOptions, "initialPrompt") ?? readString(agent.frontmatter, "initialPrompt");
  const skills = readStringArray(targetOptions, "skills") ?? readStringArray(agent.frontmatter, "skills");
  const frontmatter = mergeRecords(
    mergeRecords(
      mergeRecords(stripAgentTargetOptions(stripSourceFrontmatter(agent.frontmatter, agent.sourcePath)), {
        name: readString(targetOptions, "name") ?? agent.name,
        description: readString(targetOptions, "description") ?? readString(agent.frontmatter, "description") ?? agent.name,
        ...(skills === undefined ? {} : { skills: [...skills] }),
        ...(initialPrompt === undefined ? {} : { initialPrompt }),
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
    lockRootsFor(lockRoots, outputRoot, target).items.push(
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
  if (frontmatter.claude !== undefined || frontmatter.codex !== undefined || frontmatter.targets !== undefined) {
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
  return target === "claude" ? ".claude" : ".codex";
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
  const generatedCodexToolsFile = renderCodexSkillToolsFile(
    graph,
    skill,
    target,
    targetSkillDir
  );
  const generatedCodexRelativeFiles = new Set(
    [generatedCodexAgentFile?.file, generatedCodexToolsFile]
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
  if (generatedCodexToolsFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedCodexToolsFile,
      targetSkillDir,
      renderedRelativeFiles,
      `${skill.sourcePath}.tools`
    );
  }

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "SKILL.md") continue;
    if (relativeFile === "CHANGELOG.md") continue;
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

  lockRootsFor(lockRoots, outputRoot, target).items.push(
    await lockItemForSkill({
      files: rendered,
      graph,
      kind: "standalone-skill",
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
  const withPortable = graph.root.compile.skillset.metadata
    ? mergeRecords(withClaudePolicy, { metadata: { generated: GENERATED_BY, version } })
    : withClaudePolicy;
  const withTargetFrontmatter = mergeRecords(
    withPortable,
    readRecord(targetOptions, "frontmatter") ?? {}
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
    ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
  });
  const dependencyNotice = target === "codex" && plugin !== undefined
    ? renderCodexDependencyNotice(graph, plugin)
    : undefined;
  const body = dependencyNotice === undefined
    ? preprocessedBody
    : `${dependencyNotice}\n\n${preprocessedBody}`;
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

function renderCodexSkillToolsFile(
  graph: BuildGraph,
  skill: SourceSkill,
  target: TargetName,
  targetSkillDir: string
): RenderedFile | undefined {
  if (target !== "codex") return undefined;

  const label = relative(graph.rootPath, skill.sourcePath);
  const tools = readCodexToolMetadata(skill.frontmatter, skill.targets.codex.options, label);
  if (tools.allow === undefined && tools.deny === undefined) return undefined;

  return textFile(
    join(targetSkillDir, ".skillset.tools.yaml"),
    renderValidatedYaml({
      generated: GENERATED_BY,
      schema_version: 1,
      target: "codex",
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
      : ["README.md", ".app.json", "assets", "scripts", "src"];

  if (target === "codex") {
    const codexHook = await renderCodexHookFile(graph, plugin, basePath);
    if (codexHook !== undefined) rendered.push(codexHook);
  }

  for (const candidate of candidates) {
    const sourcePath = join(plugin.path, candidate);
    if (!(await exists(sourcePath))) continue;

    if (target === "claude" && candidate === "hooks") {
      await validateHookJson(graph, join(sourcePath, "hooks.json"), "claude");
    }

    rendered.push(...(await copyPath(sourcePath, join(basePath, candidate))));
  }

  return rendered.filter((file) => !file.path.endsWith(".gitkeep"));
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
    const files = (await copyPath(feature.sourcePath, join(basePath, feature.targetPath)))
      .filter((file) => !file.path.endsWith(".gitkeep"))
      .map((file) =>
        feature.key === "mcp"
          ? { ...file, sourcePath: relative(graph.rootPath, feature.sourcePath) }
          : file
      );
    rendered.push(...files);
    if (files.length === 0) continue;
    lockRootsFor(lockRoots, outputRoot, target).items.push(
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

function pluginHasFeature(plugin: SourcePlugin, key: SourcePluginFeature["key"]): boolean {
  return plugin.features.some((feature) => feature.key === key);
}

/**
 * Render the Codex plugin hook file at the documented default path
 * `hooks/hooks.json` with a top-level `hooks` object.
 *
 * Source resolution: `hooks/hooks.json` is the canonical hook source for both
 * plugin targets. Flat event maps are normalized into the canonical
 * `{ "hooks": { ... } }` shape.
 */
async function renderCodexHookFile(
  graph: BuildGraph,
  plugin: SourcePlugin,
  basePath: string
): Promise<RenderedFile | undefined> {
  const canonicalSource = join(plugin.path, "hooks", "hooks.json");
  if (!(await exists(canonicalSource))) return undefined;

  await validateHookJson(graph, canonicalSource, "codex");
  const parsed = JSON.parse(await readFile(canonicalSource, "utf8")) as JsonValue;
  const normalized = isJsonRecord(parsed) && isJsonRecord(parsed.hooks) ? parsed : { hooks: parsed };
  return textFile(
    join(basePath, "hooks", "hooks.json"),
    renderValidatedJson(normalized, `${relative(graph.rootPath, canonicalSource)} -> ${join(basePath, "hooks", "hooks.json")}`),
    relative(graph.rootPath, canonicalSource)
  );
}

async function validateHookJson(
  graph: BuildGraph,
  sourcePath: string,
  target: TargetName
): Promise<void> {
  if (!(await exists(sourcePath))) return;

  const label = relative(graph.rootPath, sourcePath);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8")) as JsonValue;
  } catch (error) {
    const targetLabel = target === "claude" ? "Claude" : "Codex";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: ${targetLabel} hook file ${label} is not valid JSON: ${message}`);
  }

  validateHookDefinition(parsed, { sourcePath: label, target });
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

function renderLockFiles(
  graph: BuildGraph,
  lockRoots: ReadonlyMap<string, LockRoot>
): readonly RenderedFile[] {
  const rendered: RenderedFile[] = [];

  for (const [outputRoot, lock] of [...lockRoots.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const value: JsonRecord = {
      buildMode: graph.root.compile.build,
      generatedBy: GENERATED_BY,
      items: lock.items
        .map((item) => stripUndefinedLockItem(item))
        .sort((left, right) => compareStrings(String(left.outputPath), String(right.outputPath))),
      selectedTargets: [...graph.root.compile.targets],
      skillsetMetadata: graph.root.compile.skillset.metadata,
      outputRoot,
      schemaVersion: 1,
      sourceRoot: graph.sourceRoot,
      target: lock.target,
    };
    rendered.push(textFile(join(outputRoot, ".skillset.lock"), renderValidatedJson(value, `${outputRoot}/.skillset.lock`)));
  }

  return rendered;
}

function lockRootsFor(
  lockRoots: Map<string, LockRoot>,
  outputRoot: string,
  target: TargetName | "workspace"
): LockRoot {
  const existing = lockRoots.get(outputRoot);
  if (existing !== undefined) return existing;
  const created: LockRoot = { items: [], target };
  lockRoots.set(outputRoot, created);
  return created;
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
  readonly file: RenderedFile;
  readonly graph: BuildGraph;
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

  return {
    ...(dependencies.length === 0 ? {} : { dependencies }),
    files: [relative(args.outputRoot, args.file.path)],
    includedSkills,
    kind: "plugin",
    name: args.plugin.id,
    outputHash: hashRenderedFiles(args.outputRoot, [args.file]),
    outputPath: relative(args.outputRoot, args.file.path),
    skippedSkills,
    sourceHash: hashPluginSource(args.plugin, args.target, includedSkills, skippedSkills, dependencyHashSummaries),
    ...(args.plugin.sourceOrigin === undefined ? {} : { sourceOrigin: args.plugin.sourceOrigin }),
    sourcePath: relative(args.graph.rootPath, args.plugin.path),
    targetState: skippedSkills.length === 0 ? "sync" : "intentionally-skipped",
    version: pluginVersion(args.graph, args.plugin),
  };
}

async function lockItemForPluginFeature(args: {
  readonly feature: SourcePluginFeature;
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly outputRoot: string;
  readonly plugin: SourcePlugin;
  readonly target: TargetName;
}): Promise<LockItem> {
  return {
    feature: args.feature.key,
    files: args.files.map((file) => relative(args.outputRoot, file.path)).sort(),
    kind: "plugin-feature",
    name: `${args.plugin.id}:${args.feature.key}`,
    origin: args.feature.origin,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: relative(args.outputRoot, join(args.outputRoot, "plugins", args.plugin.id, args.feature.targetPath)),
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
    sourceHash: hashProjectAgentSource(args.agent, args.result.preprocessDependencies, args.graph.rootPath),
    sourcePath: relative(args.graph.rootPath, args.agent.sourcePath),
    validation: "structured",
    version: rootVersion(args.graph),
  };
}

async function lockItemForSkill(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly kind: LockItem["kind"];
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
    sourceHash: await hashSkillSource(args.sourceDir, args.skill.resources, args.preprocessDependencies, args.graph.rootPath),
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
  agent: SourceProjectAgent,
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  const hash = createHash("sha256");
  hash.update("skillset-project-agent-source-v1\0");
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
  plugin: SourcePlugin,
  target: TargetName,
  includedSkills: readonly string[],
  skippedSkills: readonly string[],
  dependencies: readonly string[]
): string {
  const hash = createHash("sha256");
  hash.update("skillset-plugin-source-v1\0");
  hash.update(plugin.id);
  hash.update("\0");
  hash.update(target);
  hash.update("\0");
  hash.update(stringifyJson(plugin.metadata));
  hash.update("\0");
  hash.update(stringifyJson(plugin.targets[target].options));
  hash.update("\0");
  hash.update(includedSkills.join("\n"));
  hash.update("\0");
  hash.update(skippedSkills.join("\n"));
  if (dependencies.length > 0) {
    hash.update("\0dependencies\0");
    hash.update(dependencies.join("\n"));
  }
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
  preprocessDependencies: readonly string[],
  rootPath: string
): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-skill-source-v2\0");

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
  if (file.sourcePath !== undefined || file.path.endsWith(".skillset.lock")) {
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
