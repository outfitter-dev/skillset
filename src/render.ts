import { existsSync, readdirSync, statSync } from "node:fs";
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
import { validateSlug } from "./path";
import { readAllowedTools, readImplicitInvocation } from "./skill-policy";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  RenderedFile,
  SourcePlugin,
  SourceSkill,
  StandaloneSkill,
  TargetName,
} from "./types";
import { isJsonRecord, parseYamlRecord, stringifyJson, stringifyMarkdown, stringifyYaml } from "./yaml";

const textEncoder = new TextEncoder();
const DEFAULT_CODEX_COLOR = "#B06DFF";
const COMPILER_ID = "skillset";
const COMPILER_VERSION = "0.1.0";
const GENERATED_BY = `${COMPILER_ID}@${COMPILER_VERSION}`;

interface LockItem {
  readonly files: readonly string[];
  readonly kind: "plugin-skill" | "standalone-skill";
  readonly name: string;
  readonly outputHash: string;
  readonly outputPath: string;
  readonly plugin?: string;
  readonly sourceHash: string;
  readonly sourcePath: string;
  readonly version?: string;
}

interface LockRoot {
  readonly items: LockItem[];
  readonly target: TargetName;
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

  rendered.push(...renderLockFiles(graph, lockRoots));
  return rendered.sort((left, right) => left.path.localeCompare(right.path));
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
          version: readString(metadata, "version") ?? "0.1.0",
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
        version: readString(root, "version") ?? "0.1.0",
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

  rendered.push(
    textFile(
      target === "claude"
        ? `${basePath}/.claude-plugin/plugin.json`
        : `${basePath}/.codex-plugin/plugin.json`,
      stringifyJson(renderPluginManifest(graph, plugin, target, enabledSkills))
    )
  );

  for (const skill of enabledSkills) {
    rendered.push(...(await renderPluginSkillFiles(graph, plugin, skill, target, basePath, outputRoot, lockRoots)));
  }

  rendered.push(...(await copyPluginCompanionFiles(plugin, target, basePath)));
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
    version: readString(metadata, "version") ?? "0.1.0",
    description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
    author: metadata.author,
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: metadata.license,
    keywords: metadata.keywords,
  };

  if (target === "claude") {
    return mergeRecords(
      withOptionalSurfacePaths(base, plugin, enabledSkills, target),
      readRecord(targetOptions, "manifest") ?? {}
    );
  }

  return mergeRecords(
    mergeRecords(withOptionalSurfacePaths(base, plugin, enabledSkills, target), {
      interface: renderCodexInterface(graph, plugin),
    }),
    readRecord(targetOptions, "manifest") ?? {}
  );
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
    if (pluginHasPath(plugin, "agents")) withPaths.agents = "./agents/";
    if (pluginHasPath(plugin, "hooks.json") || pluginHasPath(plugin, "hooks/hooks.json")) {
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
  const targetSkillFile = join(basePath, relativeSkillDir, "SKILL.md");
  const generatedCodexAgentFile = await renderCodexSkillAgentFile(
    graph,
    skill,
    target,
    sourceDir,
    join(basePath, relativeSkillDir)
  );
  const rendered: RenderedFile[] = [
    textFile(targetSkillFile, renderSkillMarkdown(graph, plugin, skill, target)),
  ];
  if (generatedCodexAgentFile !== undefined) rendered.push(generatedCodexAgentFile);

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "SKILL.md") continue;
    if (generatedCodexAgentFile !== undefined && relativeFile === "agents/openai.yaml") continue;
    rendered.push({
      path: join(basePath, relativeSkillDir, relativeFile),
      content: await readFile(file),
    });
  }

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
  const targetSkillFile = join(outputRoot, relativeSkillDir, "SKILL.md");
  const generatedCodexAgentFile = await renderCodexSkillAgentFile(
    graph,
    skill,
    target,
    sourceDir,
    join(outputRoot, relativeSkillDir)
  );
  const rendered: RenderedFile[] = [
    textFile(targetSkillFile, renderSkillMarkdown(graph, undefined, skill, target)),
  ];
  if (generatedCodexAgentFile !== undefined) rendered.push(generatedCodexAgentFile);

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (relativeFile === "SKILL.md") continue;
    if (generatedCodexAgentFile !== undefined && relativeFile === "agents/openai.yaml") continue;
    rendered.push({
      path: join(outputRoot, relativeSkillDir, relativeFile),
      content: await readFile(file),
    });
  }

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
    target === "claude" ? mergeRecords(withReferences, renderClaudeSkillPolicy(skill)) : withReferences;
  const withPortable = mergeRecords(withClaudePolicy, { metadata: { generated: GENERATED_BY, version } });
  const frontmatter = mergeRecords(
    withPortable,
    readRecord(targetOptions, "frontmatter") ?? {}
  );

  return stringifyMarkdown(frontmatter, skill.body);
}

function renderClaudeSkillPolicy(skill: SourceSkill): JsonRecord {
  const label = skill.sourcePath;
  const implicitInvocation = readImplicitInvocation(skill.frontmatter, "claude", label);
  const allowedTools = readAllowedTools(skill.frontmatter, "claude", label);
  const policy: Record<string, JsonValue> = {};

  if (implicitInvocation !== undefined) {
    policy["disable-model-invocation"] = !implicitInvocation;
  }
  if (allowedTools !== undefined && allowedTools !== false) {
    policy["allowed-tools"] = [...allowedTools];
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

async function copyPluginCompanionFiles(
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const candidates =
    target === "claude"
      ? ["README.md", "commands", "agents", "hooks", ".mcp.json", "assets", "src"]
      : ["README.md", "agents", "hooks.json", ".mcp.json", ".app.json", "assets", "src"];

  for (const candidate of candidates) {
    const sourcePath = join(plugin.path, candidate);
    if (!(await exists(sourcePath))) continue;

    if (candidate === "hooks.json") {
      rendered.push(...(await copyPath(sourcePath, join(basePath, "hooks.json"))));
      continue;
    }

    rendered.push(...(await copyPath(sourcePath, join(basePath, candidate))));
  }

  if (target === "codex" && !pluginHasPath(plugin, "hooks.json") && pluginHasPath(plugin, "hooks/hooks.json")) {
    rendered.push(...(await copyPath(join(plugin.path, "hooks/hooks.json"), join(basePath, "hooks.json"))));
  }

  return rendered.filter((file) => !file.path.endsWith(".gitkeep"));
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

  for (const [outputRoot, lock] of [...lockRoots.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const value: JsonRecord = {
      generatedBy: GENERATED_BY,
      items: lock.items
        .map((item) => stripUndefinedLockItem(item))
        .sort((left, right) => String(left.outputPath).localeCompare(String(right.outputPath))),
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
  target: TargetName
): LockRoot {
  const existing = lockRoots.get(outputRoot);
  if (existing !== undefined) return existing;
  const created: LockRoot = { items: [], target };
  lockRoots.set(outputRoot, created);
  return created;
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
    sourceHash: await hashSourceDir(args.sourceDir),
    sourcePath: relative(args.graph.rootPath, args.skill.sourcePath),
    version: skillVersion(args.graph, args.plugin, args.skill),
    ...(args.plugin === undefined ? {} : { plugin: args.plugin.id }),
  };
}

function skillVersion(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): string {
  return (
    readString(skill.frontmatter, "version") ??
    readString(skill.metadata, "version") ??
    (plugin === undefined ? undefined : readString(plugin.metadata, "version")) ??
    readString(graph.root.metadata, "version") ??
    "0.1.0"
  );
}

function stripUndefinedLockItem(item: LockItem): JsonRecord {
  const value: Record<string, JsonValue | undefined> = {
    files: [...item.files],
    kind: item.kind,
    name: item.name,
    outputHash: item.outputHash,
    outputPath: item.outputPath,
    plugin: item.plugin,
    sourceHash: item.sourceHash,
    sourcePath: item.sourcePath,
    version: item.version,
  };
  return value;
}

async function hashSourceDir(sourceDir: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-source-v1\0");

  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    hash.update(relativeFile);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

function hashRenderedFiles(outputRoot: string, files: readonly RenderedFile[]): string {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
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

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
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
    const maybePath = join(plugin.path, path);
    return hasRenderableContent(maybePath);
  } catch {
    return false;
  }
}

function hasRenderableContent(path: string): boolean {
  if (!existsSync(path)) return false;
  const stats = statSync(path);
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
