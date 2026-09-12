import { readdir } from "node:fs/promises";
import path from "node:path";

import type { StandardProfileId } from "@skillset/registry";

import { isOutputSelected } from "./config";
import { resolveLicense, type ResolvedLicense } from "./licenses";
import type { LogicalRenderedFile, OutputConsumer } from "./output-plan";
import {
  agentSkillSourceUnit,
  agentSkillStandardDirectory,
  asAgentSkillStandardFile,
  asCodexAgentSkillDeltaFile,
  classifyAgentPluginSkillLayout,
  classifyAgentSkillStandard,
  renderAgentSkillStandardMarkdown,
} from "./render-agent-skills-standard";
import {
  renderCodexSkillAgentFile,
  renderSkillToolsMetadataFile,
} from "./render-codex-skill-sidecars";
import { classifyAgentPluginStandard } from "./render-agent-plugins-standard";
import {
  copyFileFromSource,
  copyPath,
  lockRootsFor,
  textFile,
  type LockItem,
  type LockRoot,
} from "./render-support";
import type {
  AppliedTransform,
  BuildGraph,
  RenderedFile,
  SourcePlugin,
  SourceSkill,
} from "./types";

const AGENT_SKILLS_OUTPUT_ROOT = ".agents/skills";

type SkillStandardProfile = Extract<
  StandardProfileId,
  "agent-plugins-1.0" | "agent-skills"
>;

export interface AgentSkillLockItemArgs {
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
}

export type AgentSkillLockItemFactory = (
  args: AgentSkillLockItemArgs
) => Promise<LockItem>;

export interface RenderedCodexSkillMarkdown {
  readonly content: string;
  readonly preprocessDependencies: readonly string[];
}

export type CodexSkillMarkdownRenderer = (
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  baselineContent: string
) => Promise<RenderedCodexSkillMarkdown>;

interface RenderStandardAgentSkillTreeArgs {
  readonly codexConsumer: boolean;
  readonly createLockItem: AgentSkillLockItemFactory;
  readonly graph: BuildGraph;
  readonly inheritedLicense: ResolvedLicense | undefined;
  readonly lockRoots: Map<string, LockRoot>;
  readonly outputRoot: string;
  readonly plugin?: SourcePlugin;
  readonly renderCodexSkillMarkdown: CodexSkillMarkdownRenderer;
  readonly skill: SourceSkill;
  readonly standardProfile: SkillStandardProfile;
  readonly targetSkillDir: string;
}

/**
 * Render the adopted skill baselines independently from provider bundles.
 * The root profile deliberately flattens standalone and plugin-owned skills;
 * a same-name collision therefore remains visible to the output planner as a
 * conflicting source identity rather than being resolved by insertion order.
 */
export async function renderAgentSkillStandards(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>,
  createLockItem: AgentSkillLockItemFactory,
  renderCodexSkillMarkdown: CodexSkillMarkdownRenderer
): Promise<readonly RenderedFile[]> {
  const renderFlattened =
    graph.root.compile.agents.skills &&
    graph.standardProjections.adopted.includes("agent-skills");
  const renderPackages =
    graph.root.compile.agents.plugins &&
    graph.standardProjections.adopted.includes("agent-plugins-1.0");
  if (!renderFlattened && !renderPackages) return [];

  const rendered: RenderedFile[] = [];
  const rootLicense = await resolveRootLicense(graph);
  if (renderFlattened) {
    rendered.push(
      ...(await renderFlattenedAgentSkills(
        graph,
        lockRoots,
        createLockItem,
        rootLicense,
        renderCodexSkillMarkdown
      ))
    );
  }
  if (renderPackages) {
    rendered.push(
      ...(await renderAgentPluginSkillComponents(
        graph,
        lockRoots,
        createLockItem,
        rootLicense,
        renderCodexSkillMarkdown
      ))
    );
  }
  return rendered;
}

export function shouldCoalesceStandaloneCodexSkill(
  graph: BuildGraph,
  skill: SourceSkill
): boolean {
  return (
    graph.root.compile.agents.skills &&
    graph.standardProjections.adopted.includes("agent-skills") &&
    graph.root.outputs.skills.codex === AGENT_SKILLS_OUTPUT_ROOT &&
    skill.targets.codex.enabled &&
    isOutputSelected(graph.root.outputs.targetOutputs.codex.skills, skill.id) &&
    classifyAgentSkillStandard(graph, undefined, skill).status === "supported"
  );
}

async function renderFlattenedAgentSkills(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>,
  createLockItem: AgentSkillLockItemFactory,
  rootLicense: ResolvedLicense | undefined,
  renderCodexSkillMarkdown: CodexSkillMarkdownRenderer
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const skill of graph.standaloneSkills) {
    rendered.push(
      ...(await renderStandardAgentSkillTree({
        codexConsumer: shouldCoalesceStandaloneCodexSkill(graph, skill),
        createLockItem,
        graph,
        inheritedLicense: rootLicense,
        lockRoots,
        outputRoot: AGENT_SKILLS_OUTPUT_ROOT,
        skill,
        standardProfile: "agent-skills",
        targetSkillDir: agentSkillStandardDirectory(
          AGENT_SKILLS_OUTPUT_ROOT,
          skill
        ),
        renderCodexSkillMarkdown,
      }))
    );
  }
  for (const plugin of graph.plugins) {
    const pluginLicense = await resolvePluginLicense(
      graph,
      plugin,
      rootLicense
    );
    for (const skill of plugin.skills) {
      rendered.push(
        ...(await renderStandardAgentSkillTree({
          codexConsumer: shouldConsumeFlattenedPluginSkill(
            graph,
            plugin,
            skill
          ),
          createLockItem,
          graph,
          inheritedLicense: pluginLicense,
          lockRoots,
          outputRoot: AGENT_SKILLS_OUTPUT_ROOT,
          plugin,
          skill,
          standardProfile: "agent-skills",
          targetSkillDir: agentSkillStandardDirectory(
            AGENT_SKILLS_OUTPUT_ROOT,
            skill
          ),
          renderCodexSkillMarkdown,
        }))
      );
    }
  }
  return rendered;
}

async function renderAgentPluginSkillComponents(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>,
  createLockItem: AgentSkillLockItemFactory,
  rootLicense: ResolvedLicense | undefined,
  renderCodexSkillMarkdown: CodexSkillMarkdownRenderer
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  for (const plugin of graph.plugins) {
    if (classifyAgentPluginStandard(plugin).status !== "supported") continue;
    const pluginLicense = await resolvePluginLicense(
      graph,
      plugin,
      rootLicense
    );
    for (const skill of plugin.skills) {
      if (classifyAgentPluginSkillLayout(graph, plugin, skill) !== undefined) {
        continue;
      }
      rendered.push(
        ...(await renderStandardAgentSkillTree({
          codexConsumer: false,
          createLockItem,
          graph,
          inheritedLicense: pluginLicense,
          lockRoots,
          outputRoot: "plugins",
          plugin,
          skill,
          standardProfile: "agent-plugins-1.0",
          targetSkillDir: agentSkillStandardDirectory(
            `plugins/${plugin.id}/agents/skills`,
            skill
          ),
          renderCodexSkillMarkdown,
        }))
      );
    }
  }
  return rendered;
}

async function renderStandardAgentSkillTree(
  args: RenderStandardAgentSkillTreeArgs
): Promise<readonly LogicalRenderedFile[]> {
  const sourceDir = path.dirname(args.skill.sourcePath);
  const skillLicense = await resolveLicense({
    graph: args.graph,
    label: path.relative(args.graph.rootPath, args.skill.sourcePath),
    metadata: args.skill.metadata,
    ...(args.inheritedLicense === undefined
      ? {}
      : { parent: args.inheritedLicense }),
    scopePath: sourceDir,
    sourcePath: args.skill.sourcePath,
  });
  const markdown = await renderAgentSkillStandardMarkdown(
    args.graph,
    args.plugin,
    args.skill,
    args.targetSkillDir,
    skillLicense?.manifestValue ??
      (skillLicense === undefined ? undefined : "LICENSE.txt"),
    args.standardProfile
  );
  if (!("file" in markdown)) return [];

  const sourceUnit = agentSkillSourceUnit(args.plugin, args.skill);
  const codexMarkdown = args.codexConsumer
    ? await args.renderCodexSkillMarkdown(
        args.plugin,
        args.skill,
        markdown.content
      )
    : undefined;
  const baseline = await renderBaselineFiles(
    args,
    sourceDir,
    sourceUnit,
    markdown.file,
    skillLicense
  );
  const baselineConsumer: OutputConsumer = {
    phase: "baseline",
    standardProfile: args.standardProfile,
  };
  const codexConsumer: OutputConsumer = { phase: "delta", target: "codex" };
  const baselineLock = await args.createLockItem({
    files: baseline,
    graph: args.graph,
    kind: args.plugin === undefined ? "standalone-skill" : "plugin-skill",
    license: skillLicense,
    outputRoot: args.outputRoot,
    ...(args.plugin === undefined ? {} : { plugin: args.plugin }),
    preprocessDependencies: [
      ...new Set([
        ...markdown.preprocessDependencies,
        ...(codexMarkdown?.preprocessDependencies ?? []),
      ]),
    ].sort(),
    skill: args.skill,
    sourceDir,
    transforms: [],
  });
  lockRootsFor(args.lockRoots, args.outputRoot, "workspace").items.push({
    ...baselineLock,
    consumers: args.codexConsumer
      ? [baselineConsumer, codexConsumer]
      : [baselineConsumer],
    owner: { standardProfile: args.standardProfile },
  });
  if (!args.codexConsumer) return baseline;

  const codexBaseline = baseline.map((file) => {
    const candidate =
      file.path === markdown.file.path && codexMarkdown !== undefined
        ? textFile(file.path, codexMarkdown.content, file.sourcePath)
        : file;
    return asCodexAgentSkillDeltaFile(candidate, sourceUnit);
  });
  const auxiliary = await renderCodexAgentSkillAuxiliaryFiles(
    args.graph,
    args.plugin,
    args.skill,
    sourceDir,
    args.targetSkillDir
  );
  if (auxiliary.files.length > 0) {
    const deltaLock = await args.createLockItem({
      files: auxiliary.files,
      graph: args.graph,
      kind: args.plugin === undefined ? "standalone-skill" : "plugin-skill",
      license: skillLicense,
      outputRoot: args.outputRoot,
      ...(args.plugin === undefined ? {} : { plugin: args.plugin }),
      preprocessDependencies: auxiliary.preprocessDependencies,
      skill: args.skill,
      sourceDir,
      transforms: [],
    });
    lockRootsFor(args.lockRoots, args.outputRoot, "workspace").items.push({
      ...deltaLock,
      consumers: [codexConsumer],
      owner: { target: "codex" },
    });
  }
  return [...baseline, ...codexBaseline, ...auxiliary.files];
}

async function renderBaselineFiles(
  args: RenderStandardAgentSkillTreeArgs,
  sourceDir: string,
  sourceUnit: string,
  markdown: LogicalRenderedFile,
  skillLicense: ResolvedLicense | undefined
): Promise<readonly LogicalRenderedFile[]> {
  const baseline: LogicalRenderedFile[] = [];
  const relativeFiles = new Set<string>();
  pushSkillRenderedFile(
    baseline,
    markdown,
    args.targetSkillDir,
    relativeFiles,
    `${args.skill.sourcePath}.SKILL.md`
  );
  if (skillLicense !== undefined) {
    pushSkillRenderedFile(
      baseline,
      asAgentSkillStandardFile(
        textFile(
          path.join(args.targetSkillDir, "LICENSE.txt"),
          skillLicense.content,
          skillLicense.sourcePath
        ),
        sourceUnit,
        args.standardProfile
      ),
      args.targetSkillDir,
      relativeFiles,
      `${args.skill.sourcePath}.LICENSE.txt`
    );
  }
  await pushSourceFiles(args, sourceDir, sourceUnit, baseline, relativeFiles);
  await pushDeclaredResources(args, sourceUnit, baseline, relativeFiles);
  return baseline;
}

async function pushSourceFiles(
  args: RenderStandardAgentSkillTreeArgs,
  sourceDir: string,
  sourceUnit: string,
  baseline: LogicalRenderedFile[],
  relativeFiles: Set<string>
): Promise<void> {
  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = normalizePath(path.relative(sourceDir, file));
    if (
      relativeFile === "SKILL.md" ||
      relativeFile === "CHANGELOG.md" ||
      relativeFile === "LICENSE.txt" ||
      relativeFile === ".skillset.tools.yaml" ||
      relativeFile === "agents/openai.yaml"
    ) {
      continue;
    }
    pushSkillRenderedFile(
      baseline,
      asAgentSkillStandardFile(
        await copyFileFromSource(
          file,
          path.join(args.targetSkillDir, relativeFile)
        ),
        sourceUnit,
        args.standardProfile
      ),
      args.targetSkillDir,
      relativeFiles,
      `${args.skill.sourcePath}.${relativeFile}`
    );
  }
}

async function pushDeclaredResources(
  args: RenderStandardAgentSkillTreeArgs,
  sourceUnit: string,
  baseline: LogicalRenderedFile[],
  relativeFiles: Set<string>
): Promise<void> {
  for (const resource of args.skill.resources) {
    const files = await copyPath(
      resource.sourcePath,
      path.join(args.targetSkillDir, resource.targetPath)
    );
    for (const file of files) {
      if (file.path.endsWith(".gitkeep")) continue;
      pushSkillRenderedFile(
        baseline,
        asAgentSkillStandardFile(file, sourceUnit, args.standardProfile),
        args.targetSkillDir,
        relativeFiles,
        `${args.skill.sourcePath}.resources.${resource.from}`
      );
    }
  }
}

async function renderCodexAgentSkillAuxiliaryFiles(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  sourceDir: string,
  targetSkillDir: string
): Promise<{
  readonly files: readonly LogicalRenderedFile[];
  readonly preprocessDependencies: readonly string[];
}> {
  const sourceUnit = agentSkillSourceUnit(plugin, skill);
  const openAi = await renderCodexSkillAgentFile(
    graph,
    plugin,
    skill,
    "codex",
    sourceDir,
    targetSkillDir
  );
  const tools = renderSkillToolsMetadataFile(
    graph,
    skill,
    "codex",
    targetSkillDir
  );
  return {
    files: [openAi?.file, tools]
      .filter((file): file is RenderedFile => file !== undefined)
      .map((file) => asCodexAgentSkillDeltaFile(file, sourceUnit)),
    preprocessDependencies: openAi?.preprocessDependencies ?? [],
  };
}

function shouldConsumeFlattenedPluginSkill(
  graph: BuildGraph,
  plugin: SourcePlugin,
  skill: SourceSkill
): boolean {
  return (
    plugin.targets.codex.enabled &&
    skill.targets.codex.enabled &&
    isOutputSelected(graph.root.outputs.targetOutputs.codex.plugins, plugin.id)
  );
}

function pushSkillRenderedFile(
  rendered: LogicalRenderedFile[],
  file: LogicalRenderedFile,
  targetSkillDir: string,
  renderedRelativeFiles: Set<string>,
  label: string
): void {
  const relativeFile = normalizePath(path.relative(targetSkillDir, file.path));
  if (relativeFile.length === 0 || relativeFile.startsWith("../")) {
    throw new Error(
      `skillset: ${label} would write outside generated skill directory`
    );
  }
  if (renderedRelativeFiles.has(relativeFile)) {
    throw new Error(
      `skillset: ${label} would overwrite generated skill file ${relativeFile}`
    );
  }
  renderedRelativeFiles.add(relativeFile);
  rendered.push(file);
}

async function resolveRootLicense(
  graph: BuildGraph
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: path.relative(graph.rootPath, graph.rootManifestPath),
    metadata: graph.root.metadata,
    scopePath: graph.sourceRootPath,
    sourcePath: graph.rootManifestPath,
  });
}

async function resolvePluginLicense(
  graph: BuildGraph,
  plugin: SourcePlugin,
  rootLicense: ResolvedLicense | undefined
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: path.relative(graph.rootPath, plugin.configPath),
    metadata: plugin.metadata,
    ...(rootLicense === undefined ? {} : { parent: rootLicense }),
    scopePath: plugin.path,
    sourcePath: plugin.configPath,
  });
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(filePath)));
    } else if (entry.isFile() && !entry.name.endsWith(".DS_Store")) {
      files.push(filePath);
    }
  }
  return files;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}
