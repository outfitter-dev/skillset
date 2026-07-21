import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";

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
  renderCodexDependencyNotice,
} from "./dependencies";
import { resolveLicense, type ResolvedLicense } from "./licenses";
import { compareStrings } from "./path";
import {
  isDefaultPluginOutputRoot,
  pluginManifestPath,
  pluginTargetRoot,
} from "./plugin-output";
import { rewriteResourceLinks } from "./resources";
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
  RenderedFile,
  SourceIslandFile,
  SourceOrigin,
  SourcePlugin,
  SourcePluginFeature,
  SourceProjectAgent,
  SourceResource,
  SourceSkill,
  StandaloneSkill,
  TargetName,
} from "./types";
import { targetDescriptor, targetNames } from "./targets";
import { pluginVersion, rootVersion, skillVersion, skillVersionLabel } from "./versioning";
import { parseMarkdown, parseYamlRecord, stringifyJson } from "./yaml";
import {
  copyPath,
  exists,
  GENERATED_BY,
  lockRootsFor,
  textFile,
  WORKSPACE_LOCK_ROOT,
  type LockItem,
  type LockRoot,
} from "./render-support";
import {
  renderCodexInterface,
  renderPluginManifest,
  withOptionalSurfacePaths,
} from "./render-plugin-manifest";
import { renderRules } from "./render-rules";
import {
  hasAdaptivePluginHookSources,
  renderAdaptiveFrontmatterHooks,
  renderAdaptivePluginHookFiles,
  renderNormalizedPluginHookFile,
  skillScope,
  validateHookJson,
} from "./render-hooks";
import {
  marketplaceLockProvenance,
  readExistingMarketplaceState,
  renderClaudeMarketplace,
  renderCursorMarketplace,
} from "./render-marketplaces";

const textDecoder = new TextDecoder();

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
  return targetDescriptor(target).displayLabel;
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
  if (isMarkdownIslandFile(island.relativePath)) {
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
  return /\.(json|mdc?|rules|toml|txt|ya?ml)$/.test(path);
}

function isMarkdownIslandFile(path: string): boolean {
  return /\.mdc?$/.test(path);
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  const configured = readString(graph.root.targets[target].options, "projectRoot");
  if (configured !== undefined) return configured;
  return targetDescriptor(target).projectRoot;
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
  const rootOwner = readRecord(graph.root.metadata, "owner");
  if (rootOwner !== undefined) {
    hash.update(stringifyJson(rootOwner));
    hash.update("\0");
  }
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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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

function readFileSyncBytes(path: string): Uint8Array {
  return readFileSync(path);
}
