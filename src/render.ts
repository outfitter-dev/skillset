import { readdirSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";

import {
  isOutputSelected,
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
  stripSourceFrontmatter,
} from "./config";
import { validateHookDefinition } from "./hooks";
import { compareStrings, validateSlug } from "./path";
import { rewriteResourceLinks } from "./resources";
import {
  readAllowedTools,
  readClaudeNativeToolRules,
  readCodexToolMetadata,
  readImplicitInvocation,
} from "./skill-policy";
import { renderRuleVariables } from "./rule-variables";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  RenderedFile,
  SourcePlugin,
  SourceRule,
  SourceResource,
  SourceSkill,
  StandaloneSkill,
  TargetName,
} from "./types";
import { pluginVersion, rootVersion, skillVersion, skillVersionLabel } from "./versioning";
import { parseYamlRecord, stringifyJson, stringifyMarkdown, stringifyYaml } from "./yaml";

const textEncoder = new TextEncoder();
const DEFAULT_CODEX_COLOR = "#B06DFF";
const COMPILER_ID = "skillset";
const COMPILER_VERSION = "0.1.0";
const GENERATED_BY = `${COMPILER_ID}@${COMPILER_VERSION}`;
const CLAUDE_RULES_OUTPUT_ROOT = ".claude/rules";
const CODEX_RULES_LOCK_ROOT = ".";

interface LockItem {
  readonly files: readonly string[];
  readonly includedSkills?: readonly string[];
  readonly kind: "plugin" | "plugin-skill" | "rule" | "standalone-skill";
  readonly name: string;
  readonly outputHash: string;
  readonly outputPath: string;
  readonly plugin?: string;
  readonly skippedSkills?: readonly string[];
  readonly sourceHash: string;
  readonly sourcePath: string;
  readonly targetState?: string;
  readonly version?: string;
}

interface LockRoot {
  readonly items: LockItem[];
  readonly target: TargetName | "workspace";
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

  rendered.push(...(await renderRules(graph, lockRoots)));
  rendered.push(...renderLockFiles(graph, lockRoots));
  return rendered.sort((left, right) => compareStrings(left.path, right.path));
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
          version: pluginVersion(plugin),
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
      name: readString(portableMarketplace, "name") ?? readString(root, "name") ?? readString(root, "id") ?? "galligan",
      owner,
      metadata: {
        description:
          readString(root, "summary") ??
          readString(root, "description") ??
          "Source-first skillset plugins by @galligan",
        version: rootVersion(graph),
        pluginRoot: "./plugins",
        generatedBy: "galligan/agents skillset compiler",
      },
      plugins,
    },
    readRecord(graph.root.targets.claude.options, "marketplace") ?? {}
  );

  return [
    textFile(
      `${graph.root.outputs.plugins.claude}/.claude-plugin/marketplace.json`,
      stringifyJson(marketplace)
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

  const rendered: RenderedFile[] = [];
  const outputRoot = graph.root.outputs.plugins[target];
  const basePath = `${outputRoot}/plugins/${plugin.id}`;
  const enabledSkills = plugin.skills.filter((skill) => skill.targets[target].enabled);
  const manifestFile = textFile(
    target === "claude"
      ? `${basePath}/.claude-plugin/plugin.json`
      : `${basePath}/.codex-plugin/plugin.json`,
    stringifyJson(renderPluginManifest(graph, plugin, target, enabledSkills))
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

  rendered.push(...(await copyPluginCompanionFiles(graph, plugin, target, basePath)));
  return rendered;
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
    version: pluginVersion(plugin),
    description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
    author: metadata.author,
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: metadata.license,
    keywords: metadata.keywords,
  };

  const targetBase =
    target === "claude"
      ? withOptionalSurfacePaths(base, plugin, enabledSkills, target)
      : mergeRecords(withOptionalSurfacePaths(base, plugin, enabledSkills, target), {
          interface: renderCodexInterface(graph, plugin),
        });
  const withOverrides = mergeRecords(targetBase, readRecord(targetOptions, "manifest") ?? {});

  return mergeRecords(withOverrides, {
    version: pluginVersion(plugin),
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
      "Matt Galligan",
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
    if (pluginHasPath(plugin, ".mcp.json")) withPaths.mcpServers = "./.mcp.json";
  } else {
    if (pluginHasPath(plugin, "hooks.json")) {
      withPaths.hooks = "./hooks.json";
    }
    if (pluginHasPath(plugin, ".mcp.json")) withPaths.mcpServers = "./.mcp.json";
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
    [generatedCodexAgentFile, generatedCodexToolsFile]
      .filter((file): file is RenderedFile => file !== undefined)
      .map((file) => relative(targetSkillDir, file.path))
  );
  const rendered: RenderedFile[] = [];
  const renderedRelativeFiles = new Set<string>();
  pushSkillRenderedFile(
    rendered,
    textFile(targetSkillFile, renderSkillMarkdown(graph, plugin, skill, target)),
    targetSkillDir,
    renderedRelativeFiles,
    `${skill.sourcePath}.SKILL.md`
  );
  if (generatedCodexAgentFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedCodexAgentFile,
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
      skill,
      sourceDir,
    })
  );

  return rendered;
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
    [generatedCodexAgentFile, generatedCodexToolsFile]
      .filter((file): file is RenderedFile => file !== undefined)
      .map((file) => relative(targetSkillDir, file.path))
  );
  const rendered: RenderedFile[] = [];
  const renderedRelativeFiles = new Set<string>();
  pushSkillRenderedFile(
    rendered,
    textFile(targetSkillFile, renderSkillMarkdown(graph, undefined, skill, target)),
    targetSkillDir,
    renderedRelativeFiles,
    `${skill.sourcePath}.SKILL.md`
  );
  if (generatedCodexAgentFile !== undefined) {
    pushSkillRenderedFile(
      rendered,
      generatedCodexAgentFile,
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
      skill,
      sourceDir,
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

function renderSkillMarkdown(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  target: TargetName
): string {
  const metadata = skill.metadata;
  const targetOptions = skill.targets[target].options;
  const base = mergeRecords(stripSourceFrontmatter(skill.frontmatter), {
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
  const withPortable = mergeRecords(withClaudePolicy, { metadata: { generated: GENERATED_BY, version } });
  const withTargetFrontmatter = mergeRecords(
    withPortable,
    readRecord(targetOptions, "frontmatter") ?? {}
  );
  const frontmatter = mergeRecords(withTargetFrontmatter, {
    metadata: {
      ...(readRecord(withTargetFrontmatter, "metadata") ?? {}),
      generated: GENERATED_BY,
      version,
    },
  });

  return stringifyMarkdown(frontmatter, rewriteResourceLinks(skill.body, skill.resources, skill.sourcePath));
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
  skill: SourceSkill,
  target: TargetName,
  sourceDir: string,
  targetSkillDir: string
): Promise<RenderedFile | undefined> {
  if (target !== "codex") return undefined;

  const label = relative(graph.rootPath, skill.sourcePath);
  const generated = renderCodexSkillAgentConfig(skill, label);
  if (Object.keys(generated).length === 0) return undefined;

  const sourceOpenAiPath = join(sourceDir, "agents/openai.yaml");
  const hasSourceOpenAi = await exists(sourceOpenAiPath);
  const source = hasSourceOpenAi
    ? parseYamlRecord(await readFile(sourceOpenAiPath, "utf8"), sourceOpenAiPath)
    : {};
  const merged = mergeRecords(source, generated);
  return textFile(join(targetSkillDir, "agents/openai.yaml"), stringifyYaml(merged));
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
    stringifyYaml({
      generated: GENERATED_BY,
      schema_version: 1,
      target: "codex",
      tools,
    })
  );
}

async function renderRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  rendered.push(...renderClaudeRules(graph, lockRoots));
  rendered.push(...(await renderCodexAgentsFiles(graph, lockRoots)));
  return rendered;
}

function renderClaudeRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): readonly RenderedFile[] {
  const rendered: RenderedFile[] = [];

  for (const rule of graph.rules.filter((sourceRule) => sourceRule.targets.claude.enabled)) {
    const targetFile = join(CLAUDE_RULES_OUTPUT_ROOT, rule.relativePath);
    const file = textFile(targetFile, renderClaudeRuleMarkdown(graph, rule, targetFile));
    rendered.push(file);
    lockRootsFor(lockRoots, CLAUDE_RULES_OUTPUT_ROOT, "claude").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: rule.id,
        outputRoot: CLAUDE_RULES_OUTPUT_ROOT,
        outputPath: targetFile,
        sourceHash: hashTextRule(rule),
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
    const file = textFile(destination, renderCodexAgentsMarkdown(graph, rules, destination));
    rendered.push(file);
    lockRootsFor(lockRoots, CODEX_RULES_LOCK_ROOT, "workspace").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: destination,
        outputRoot: CODEX_RULES_LOCK_ROOT,
        outputPath: destination,
        sourceHash: hashRules(rules),
        sourcePath: `${graph.sourceDir}/${graph.instructionsDir}`,
      })
    );
  }

  return rendered;
}

function renderClaudeRuleMarkdown(graph: BuildGraph, rule: SourceRule, outputPath: string): string {
  const paths = readRulePaths(rule);
  const frontmatter: JsonRecord = paths.length === 0 ? {} : { paths: [...paths] };
  return stringifyOptionalMarkdown(frontmatter, renderRuleBody(graph, rule, outputPath));
}

function renderCodexAgentsMarkdown(
  graph: BuildGraph,
  rules: readonly SourceRule[],
  outputPath: string
): string {
  const body = rules
    .map((rule) => renderRuleBody(graph, rule, outputPath))
    .filter((ruleBody) => ruleBody.length > 0)
    .join("\n\n");
  const sourceList = rules
    .map((rule) => `- ${relative(graph.rootPath, rule.sourcePath)}`)
    .join("\n");
  return [
    `<!-- Generated by ${GENERATED_BY} from ${graph.sourceDir}/${graph.instructionsDir}. Do not edit directly. -->`,
    `<!-- Sources:\n${sourceList}\n-->`,
    "",
    body,
    "",
  ].join("\n");
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
  if (path === graph.sourceDir || path.startsWith(`${graph.sourceDir}/`)) return true;
  return graph.outputRoots.some(
    (outputRoot) => path === outputRoot || path.startsWith(`${outputRoot}/`)
  );
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
  return stringifyMarkdown(frontmatter, normalizedBody);
}

function renderRuleBody(graph: BuildGraph, rule: SourceRule, outputPath: string): string {
  return renderRuleVariables(normalizeRuleBody(rule.body), {
    outputPath,
    rootPath: graph.rootPath,
    sourcePath: rule.sourcePath,
  });
}

function normalizeRuleBody(body: string): string {
  return body.replaceAll(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();
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
      ? ["README.md", "commands", "agents", "hooks", ".mcp.json", "assets", "scripts", "src"]
      : ["README.md", "hooks.json", ".mcp.json", ".app.json", "assets", "scripts", "src"];

  for (const candidate of candidates) {
    const sourcePath = join(plugin.path, candidate);
    if (!(await exists(sourcePath))) continue;

    if (target === "claude" && candidate === "hooks") {
      await validateHookJson(graph, join(sourcePath, "hooks.json"), "claude");
    }
    if (candidate === "hooks.json") {
      await validateHookJson(graph, sourcePath, "codex");
      rendered.push(...(await copyPath(sourcePath, join(basePath, "hooks.json"))));
      continue;
    }

    rendered.push(...(await copyPath(sourcePath, join(basePath, candidate))));
  }

  return rendered.filter((file) => !file.path.endsWith(".gitkeep"));
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
      generatedBy: GENERATED_BY,
      items: lock.items
        .map((item) => stripUndefinedLockItem(item))
        .sort((left, right) => compareStrings(String(left.outputPath), String(right.outputPath))),
      outputRoot,
      schemaVersion: 1,
      sourceRoot: graph.sourceDir,
      target: lock.target,
    };
    rendered.push(textFile(join(outputRoot, ".skillset.lock"), stringifyJson(value)));
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

  return {
    files: [relative(args.outputRoot, args.file.path)],
    includedSkills,
    kind: "plugin",
    name: args.plugin.id,
    outputHash: hashRenderedFiles(args.outputRoot, [args.file]),
    outputPath: relative(args.outputRoot, args.file.path),
    skippedSkills,
    sourceHash: hashPluginSource(args.plugin, args.target, includedSkills, skippedSkills),
    sourcePath: relative(args.graph.rootPath, args.plugin.path),
    targetState: skippedSkills.length === 0 ? "sync" : "intentionally-skipped",
    version: pluginVersion(args.plugin),
  };
}

function lockItemForRule(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly name: string;
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly sourceHash: string;
  readonly sourcePath: string;
}): LockItem {
  return {
    files: args.files.map((file) => relative(args.outputRoot, file.path)).sort(),
    kind: "rule",
    name: args.name,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: relative(args.outputRoot, args.outputPath),
    sourceHash: args.sourceHash,
    sourcePath: args.sourcePath,
    version: rootVersion(args.graph),
  };
}

async function lockItemForSkill(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly kind: LockItem["kind"];
  readonly outputRoot: string;
  readonly plugin?: SourcePlugin;
  readonly skill: SourceSkill;
  readonly sourceDir: string;
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
    sourceHash: await hashSkillSource(args.sourceDir, args.skill.resources),
    sourcePath: relative(args.graph.rootPath, args.skill.sourcePath),
    version: skillVersion(args.graph, args.plugin, args.skill),
    ...(args.plugin === undefined ? {} : { plugin: args.plugin.id }),
  };
}

function stripUndefinedLockItem(item: LockItem): JsonRecord {
  const value: Record<string, JsonValue | undefined> = {
    files: [...item.files],
    includedSkills: item.includedSkills === undefined ? undefined : [...item.includedSkills],
    kind: item.kind,
    name: item.name,
    outputHash: item.outputHash,
    outputPath: item.outputPath,
    plugin: item.plugin,
    skippedSkills: item.skippedSkills === undefined ? undefined : [...item.skippedSkills],
    sourceHash: item.sourceHash,
    sourcePath: item.sourcePath,
    targetState: item.targetState,
    version: item.version,
  };
  return value;
}

function hashPluginSource(
  plugin: SourcePlugin,
  target: TargetName,
  includedSkills: readonly string[],
  skippedSkills: readonly string[]
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
  return `sha256:${hash.digest("hex")}`;
}

async function hashSkillSource(
  sourceDir: string,
  resources: readonly SourceResource[]
): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-skill-source-v2\0");

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
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

function hashTextRule(rule: SourceRule): string {
  return hashRules([rule]);
}

function hashRules(rules: readonly SourceRule[]): string {
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

function textFile(path: string, content: string): RenderedFile {
  return { path, content: textEncoder.encode(content) };
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
