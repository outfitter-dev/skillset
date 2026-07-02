import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  resolveAdaptiveHookAttachments,
  type ResolvedAdaptiveHookAttachment,
} from "./adaptive-hook-attachments";
import { adaptiveHookUnsupportedRenderReason, type AdaptiveHookRenderSurface } from "./adaptive-hook-render-support";
import { readString, isOutputSelected } from "./config";
import { getSkillsetFeature } from "./feature-registry";
import { hookProviderCapabilities } from "./hook-capabilities";
import {
  defineRenderResult,
  type SkillsetRenderResult,
  type SkillsetRenderResultStatus,
  type SkillsetRenderResultPolicy,
} from "./render-result";
import { compareStrings } from "./path";
import { pluginPathPartsForOutput, pluginTargetForOutputPath } from "./plugin-output";
import { isTargetName, targetNames } from "./targets";
import { readClaudeNativeToolRules } from "./skill-policy";
import {
  selectorForInstruction,
  selectorForPluginConfig,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForStandaloneSkill,
  selectorForTargetNativeIsland,
} from "./source-unit-selector";
import type { AdaptiveHookScope, BuildGraph, BuildScope, JsonRecord, RenderedFile, SourceSkill, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const LOCK_FILE = "skillset.lock";
const TARGETS = targetNames();

type OutputPathMapper = (path: string) => string;

interface CollectRenderResultsOptions {
  readonly includedPaths: ReadonlySet<string>;
  readonly mapOutputPath?: OutputPathMapper;
  readonly scopes?: readonly BuildScope[] | undefined;
}

interface RenderedLock {
  readonly items: readonly RenderedLockItem[];
  readonly outputRoot: string;
  readonly target: TargetName | "workspace";
}

interface RenderedLockItem {
  readonly dependencies?: readonly string[];
  readonly feature?: string;
  readonly files: readonly string[];
  readonly kind: string;
  readonly name: string;
  readonly outputPath: string;
  readonly plugin?: string;
  readonly sourcePath: string;
  readonly targetState?: string;
  readonly transforms?: readonly JsonRecord[];
  readonly validation?: string;
}

export function collectRenderResults(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  options: CollectRenderResultsOptions
): readonly SkillsetRenderResult[] {
  const mapOutputPath = options.mapOutputPath ?? ((path: string) => path);
  const outcomes: SkillsetRenderResult[] = [];
  const assignedOutputPaths = new Set<string>();

  for (const lockFile of rendered.filter((file) => file.path.endsWith(`/${LOCK_FILE}`) || file.path === LOCK_FILE)) {
    const lock = parseRenderedLock(lockFile);
    for (const item of lock.items) {
      const outputPaths = outputPathsForLockItem(lock.outputRoot, item);
      for (const path of outputPaths) assignedOutputPaths.add(path);
      outcomes.push(outcomeForLockItem(graph, lock, item, outputPaths, options.includedPaths, mapOutputPath));
      outcomes.push(...featureOutcomesForLockItem(graph, lock, item, outputPaths, options.includedPaths, mapOutputPath));
    }
  }

  for (const file of rendered) {
    if (assignedOutputPaths.has(file.path) || file.path.endsWith(`/${LOCK_FILE}`) || file.path === LOCK_FILE) {
      continue;
    }
    const outcome = outcomeForCompanionFile(graph, file, options.includedPaths.has(file.path), mapOutputPath);
    if (outcome !== undefined) outcomes.push(outcome);
  }

  outcomes.push(...unsupportedPluginFeatureOutcomes(graph, options.scopes));
  outcomes.push(...unsupportedAdaptiveHookOutcomes(graph, options.scopes));

  return outcomes.sort((left, right) =>
    compareStrings(
      `${left.sourceUnit}\0${left.target ?? ""}\0${left.featureId}\0${left.destination ?? ""}\0${left.status}\0${left.sourcePath ?? ""}`,
      `${right.sourceUnit}\0${right.target ?? ""}\0${right.featureId}\0${right.destination ?? ""}\0${right.status}\0${right.sourcePath ?? ""}`
    )
  );
}

function parseRenderedLock(file: RenderedFile): RenderedLock {
  const parsed = JSON.parse(new TextDecoder().decode(file.content)) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`skillset: generated lock ${file.path} cannot produce render results`);
  }
  const outputRoot = stringField(parsed, "outputRoot");
  const target = stringField(parsed, "target");
  const rawItems = parsed.items;
  if (!Array.isArray(rawItems)) {
    throw new Error(`skillset: generated lock ${file.path} cannot produce render results`);
  }
  return {
    items: rawItems.map((item) => parseRenderedLockItem(file.path, item)),
    outputRoot,
    target: isTargetName(target) ? target : "workspace",
  };
}

function parseRenderedLockItem(lockPath: string, raw: unknown): RenderedLockItem {
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: generated lock ${lockPath} has an invalid item`);
  }
  const dependencies = optionalStringArrayField(raw, "dependencies");
  const feature = optionalStringField(raw, "feature");
  const plugin = optionalStringField(raw, "plugin");
  const targetState = optionalStringField(raw, "targetState");
  const transforms = jsonRecordArrayField(raw, "transforms");
  const validation = optionalStringField(raw, "validation");
  return {
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(feature === undefined ? {} : { feature }),
    files: stringArrayField(raw, "files"),
    kind: stringField(raw, "kind"),
    name: stringField(raw, "name"),
    outputPath: stringField(raw, "outputPath"),
    ...(plugin === undefined ? {} : { plugin }),
    sourcePath: stringField(raw, "sourcePath"),
    ...(targetState === undefined ? {} : { targetState }),
    ...(transforms === undefined ? {} : { transforms }),
    ...(validation === undefined ? {} : { validation }),
  };
}

function outcomeForLockItem(
  graph: BuildGraph,
  lock: RenderedLock,
  item: RenderedLockItem,
  outputPaths: readonly string[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper
): SkillsetRenderResult {
  const target = targetForLockItem(graph, lock, item, outputPaths);
  const featureId = featureIdForLockItem(item);
  const baseStatus = statusForLockItem(item, target);
  const isIncluded = outputPaths.some((path) => includedPaths.has(path));
  const status: SkillsetRenderResultStatus = isIncluded ? baseStatus : "intentionally_skipped";
  const policy: SkillsetRenderResultPolicy | undefined = isIncluded ? undefined : "scope:excluded";
  const reason = isIncluded ? reasonForStatus(featureId, target, status) : "excluded by build scope";
  const evidence = evidenceFor(featureId, target);

  return defineRenderResult({
    destination: destinationForLockItem(item),
    ...(evidence === undefined ? {} : { evidence }),
    featureId,
    ...(isIncluded ? { outputs: outputPaths.map((path) => ({ kind: item.kind, path: mapOutputPath(path) })) } : {}),
    ...(policy === undefined ? {} : { policy }),
    ...(reason === undefined ? {} : { reason }),
    sourcePath: item.sourcePath,
    sourceUnit: sourceUnitForLockItem(item, target),
    status,
    ...(target === undefined ? {} : { target }),
  });
}

function outcomeForCompanionFile(
  graph: BuildGraph,
  file: RenderedFile,
  isIncluded: boolean,
  mapOutputPath: OutputPathMapper
): SkillsetRenderResult | undefined {
  const companion = companionForPath(graph, file.path);
  if (companion === undefined) return undefined;
  const plugin = graph.plugins.find((candidate) => candidate.id === companion.pluginId);
  const sourcePath = plugin === undefined
    ? undefined
    : normalizePath(relative(graph.rootPath, join(plugin.path, companion.sourceRelativePath)));
  const evidence = evidenceFor(companion.featureId, companion.target);
  return defineRenderResult({
    destination: companion.featureKey,
    ...(evidence === undefined ? {} : { evidence }),
    featureId: companion.featureId,
    ...(isIncluded ? { outputs: [{ kind: "companion", path: mapOutputPath(file.path) }] } : {}),
    ...(isIncluded ? {} : { policy: "scope:excluded" as const, reason: "excluded by build scope" }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    sourceUnit: selectorForPluginFeature(companion.pluginId, companion.featureKey),
    status: isIncluded ? "target_native" : "intentionally_skipped",
    target: companion.target,
  });
}

function featureOutcomesForLockItem(
  graph: BuildGraph,
  lock: RenderedLock,
  item: RenderedLockItem,
  outputPaths: readonly string[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper
): readonly SkillsetRenderResult[] {
  const target = targetForLockItem(graph, lock, item, outputPaths);
  const outcomes: SkillsetRenderResult[] = [];

  if (item.kind === "plugin" && item.dependencies !== undefined && item.dependencies.length > 0) {
    outcomes.push(
      featureOutcome({
        destination: "plugin-manifest",
        featureId: "dependencies",
        isIncluded: outputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind: item.kind,
        outputPaths,
        sourcePath: item.sourcePath,
        sourceUnit: selectorForPluginFeature(item.name, "dependencies"),
        status: target === "codex" ? "degraded" : "rendered",
        target,
      })
    );
  }

  const claudeToolIntentOutputPaths =
    target === "claude" && skillHasClaudeToolIntent(graph, item)
      ? outputPaths.filter((path) => path.endsWith("/SKILL.md") || path === "SKILL.md")
      : [];
  if (claudeToolIntentOutputPaths.length > 0) {
    outcomes.push(
      featureOutcome({
        destination: "skill-frontmatter",
        featureId: "tools-policy",
        isIncluded: claudeToolIntentOutputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind: "metadata",
        outputPaths: claudeToolIntentOutputPaths,
        sourcePath: item.sourcePath,
        sourceUnit: sourceUnitForLockItem(item, target),
        status: "transformed",
        target,
      })
    );
  }

  const toolIntentOutputPaths = outputPaths.filter((path) => path.endsWith("/.skillset.tools.yaml"));
  if (toolIntentOutputPaths.length > 0) {
    outcomes.push(
      featureOutcome({
        destination: "skill-tools",
        featureId: "tools-policy",
        isIncluded: toolIntentOutputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind: "metadata",
        outputPaths: toolIntentOutputPaths,
        sourcePath: item.sourcePath,
        sourceUnit: sourceUnitForLockItem(item, target),
        status: "metadata_only",
        target,
      })
    );
  }

  return outcomes;
}

function skillHasClaudeToolIntent(graph: BuildGraph, item: RenderedLockItem): boolean {
  const skill = sourceSkillForLockItem(graph, item);
  if (skill === undefined) return false;
  const rules = readClaudeNativeToolRules(skill.frontmatter, skill.targets.claude.options, item.sourcePath);
  return rules.allow.length > 0 || rules.deny.length > 0;
}

function sourceSkillForLockItem(graph: BuildGraph, item: RenderedLockItem): SourceSkill | undefined {
  if (item.kind === "standalone-skill") {
    return graph.standaloneSkills.find((skill) => skill.id === item.name);
  }
  if (item.kind !== "plugin-skill" || item.plugin === undefined) return undefined;
  return graph.plugins
    .find((plugin) => plugin.id === item.plugin)
    ?.skills.find((skill) => skill.id === item.name);
}

function unsupportedAdaptiveHookOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  if (scopes !== undefined && !scopes.includes("plugins") && !scopes.includes("project") && !scopes.includes("user")) {
    return [];
  }

  const featureId = "adaptive-hooks";
  const outcomes: SkillsetRenderResult[] = [];
  for (const item of resolveAdaptiveHookAttachments(graph.adaptiveHooks, graph.hookAttachments).resolved) {
    for (const target of TARGETS) {
      if (!providerListAllows(item.definition.providers, target) || !providerListAllows(item.attachment.providers, target)) {
        continue;
      }
      if (!isAdaptiveHookScopeRenderedForTarget(graph, item.attachment.scope, target, scopes)) continue;
      const destination = unsupportedAdaptiveHookDestination(item.attachment.scope);
      if (destination === undefined) continue;
      const reason = unsupportedAdaptiveHookReason(item, target);
      if (reason === undefined) continue;

      const sourceUnit = sourceUnitForAdaptiveHookScope(item.attachment.scope);
      if (sourceUnit === undefined) continue;
      const sourcePath = normalizeSourcePath(graph, item.attachment.sourcePath);
      const evidence = evidenceFor(featureId, target);
      outcomes.push(
        defineRenderResult({
          destination,
          ...(evidence === undefined ? {} : { evidence }),
          featureId,
          policy: "unsupported:error",
          reason,
          sourcePath,
          sourceUnit,
          status: "unsupported",
          target,
          diagnostics: [{ code: "adaptive-hook-destination-unsupported", message: reason, path: sourcePath }],
        })
      );
    }
  }
  return outcomes;
}

function unsupportedAdaptiveHookDestination(scope: AdaptiveHookScope): string | undefined {
  if (scope.kind === "skill") return "skill-frontmatter";
  if (scope.kind === "agent") return "agent-frontmatter";
  if (scope.kind === "plugin") return "hooks";
  return undefined;
}

function unsupportedAdaptiveHookReason(item: ResolvedAdaptiveHookAttachment, target: TargetName): string | undefined {
  const scope = item.attachment.scope;
  const support = scope.kind === "skill"
    ? hookProviderCapabilities[target].scopeSupport.skill
    : scope.kind === "agent"
    ? hookProviderCapabilities[target].scopeSupport.agent
    : scope.kind === "plugin"
    ? hookProviderCapabilities[target].scopeSupport.plugin
    : undefined;
  if (support === "unsupported") {
    const destination = scope.kind === "skill"
      ? "skill-local"
      : scope.kind === "agent"
      ? "project-agent"
      : "plugin";
    return `${targetLabel(target)} has no faithful ${destination} hook destination for adaptive hook attachments.`;
  }
  const surface = adaptiveHookRenderSurfaceForScope(scope);
  if (surface !== undefined) return adaptiveHookUnsupportedRenderReason(item, target, surface);
  return undefined;
}

function adaptiveHookRenderSurfaceForScope(scope: AdaptiveHookScope): AdaptiveHookRenderSurface | undefined {
  if (scope.kind === "plugin") return "plugin";
  if (scope.kind === "skill" || scope.kind === "agent") return "frontmatter";
  return undefined;
}

function isAdaptiveHookScopeRenderedForTarget(
  graph: BuildGraph,
  scope: AdaptiveHookScope,
  target: TargetName,
  scopes: readonly BuildScope[] | undefined
): boolean {
  if (scope.kind === "skill") {
    if (scope.pluginId !== undefined) {
      if (scopes !== undefined && !scopes.includes("plugins")) return false;
      const plugin = graph.plugins.find((candidate) => candidate.id === scope.pluginId);
      const skill = plugin?.skills.find((candidate) => candidate.id === scope.skillId);
      return plugin !== undefined &&
        skill !== undefined &&
        pluginTargetSelected(graph, plugin.id, target) &&
        skill.targets[target].enabled;
    }

    if (scopes !== undefined && !scopes.includes("user")) return false;
    const skill = graph.standaloneSkills.find((candidate) => candidate.id === scope.skillId);
    return skill !== undefined &&
      skill.targets[target].enabled &&
      isOutputSelected(graph.root.outputs.targetOutputs[target].skills, skill.id);
  }

  if (scope.kind === "agent") {
    if (scopes !== undefined && !scopes.includes("project")) return false;
    const agent = graph.projectAgents.find((candidate) => candidate.outputName === scope.agentId);
    return agent !== undefined && agent.targets[target].enabled;
  }

  if (scope.kind === "plugin") {
    if (scopes !== undefined && !scopes.includes("plugins")) return false;
    return scope.pluginId !== undefined && pluginTargetSelected(graph, scope.pluginId, target);
  }

  return false;
}

function sourceUnitForAdaptiveHookScope(scope: AdaptiveHookScope): string | undefined {
  if (scope.kind === "skill") {
    if (scope.skillId === undefined) return undefined;
    return scope.pluginId === undefined
      ? selectorForStandaloneSkill(scope.skillId)
      : selectorForPluginSkill(scope.pluginId, scope.skillId);
  }
  if (scope.kind === "agent" && scope.agentId !== undefined) return selectorForProjectAgent(scope.agentId);
  if (scope.kind === "plugin" && scope.pluginId !== undefined) return selectorForPluginFeature(scope.pluginId, "hooks");
  return undefined;
}

function featureOutcome(args: {
  readonly destination: string;
  readonly featureId: string;
  readonly isIncluded: boolean;
  readonly mapOutputPath: OutputPathMapper;
  readonly outputKind: string;
  readonly outputPaths: readonly string[];
  readonly sourcePath: string;
  readonly sourceUnit: string;
  readonly status: SkillsetRenderResultStatus;
  readonly target: TargetName | undefined;
}): SkillsetRenderResult {
  const status: SkillsetRenderResultStatus = args.isIncluded ? args.status : "intentionally_skipped";
  const evidence = evidenceFor(args.featureId, args.target);
  const reason = args.isIncluded ? reasonForStatus(args.featureId, args.target, status) : "excluded by build scope";

  return defineRenderResult({
    destination: args.destination,
    ...(evidence === undefined ? {} : { evidence }),
    featureId: args.featureId,
    ...(args.isIncluded
      ? { outputs: args.outputPaths.map((path) => ({ kind: args.outputKind, path: args.mapOutputPath(path) })) }
      : {}),
    ...(args.isIncluded ? {} : { policy: "scope:excluded" as const }),
    ...(reason === undefined ? {} : { reason }),
    sourcePath: args.sourcePath,
    sourceUnit: args.sourceUnit,
    status,
    ...(args.target === undefined ? {} : { target: args.target }),
  });
}

function unsupportedPluginFeatureOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  if (scopes !== undefined && !scopes.includes("plugins")) return [];
  const outcomes: SkillsetRenderResult[] = [];
  for (const plugin of graph.plugins) {
    const pluginPath = normalizePath(relative(graph.rootPath, plugin.path));

    for (const target of TARGETS.filter((candidate) => candidate !== "claude")) {
      if (!pluginTargetSelected(graph, plugin.id, target)) continue;
      for (const feature of plugin.features) {
        if (feature.key !== "bin") continue;
        const featureId = "plugin-bin";
        const evidence = evidenceFor(featureId, target);
        outcomes.push(
          defineRenderResult({
            destination: "bin",
            ...(evidence === undefined ? {} : { evidence }),
            featureId,
            policy: "unsupported:error",
            reason: requiredReasonForStatus(featureId, target, "unsupported"),
            sourcePath: normalizePath(relative(graph.rootPath, feature.sourcePath)),
            sourceUnit: selectorForPluginFeature(plugin.id, feature.key),
            status: "unsupported",
            target,
          })
        );
      }
    }

    if (!pluginTargetSelected(graph, plugin.id, "codex")) continue;
    const agentsPath = join(plugin.path, "agents");
    if (!hasMeaningfulFiles(agentsPath)) continue;
    const featureId = "plugin-agents";
    const evidence = evidenceFor(featureId, "codex");
    outcomes.push(
      defineRenderResult({
        destination: "agents",
        ...(evidence === undefined ? {} : { evidence }),
        featureId,
        policy: "unsupported:error",
        reason: requiredReasonForStatus(featureId, "codex", "unsupported"),
        sourcePath: `${pluginPath}/agents`,
        sourceUnit: selectorForPluginFeature(plugin.id, "agents"),
        status: "unsupported",
        target: "codex",
      })
    );
  }
  return outcomes;
}

function hasMeaningfulFiles(path: string): boolean {
  if (!existsSync(path)) return false;
  const stats = statSync(path);
  if (stats.isFile()) return !isPlaceholderFile(path);
  if (!stats.isDirectory()) return false;
  for (const entry of readdirSync(path)) {
    if (isPlaceholderFile(entry)) continue;
    if (hasMeaningfulFiles(join(path, entry))) return true;
  }
  return false;
}

function isPlaceholderFile(path: string): boolean {
  const name = path.split("/").pop();
  return name === ".gitkeep" || name === ".keep" || name === ".DS_Store";
}

function outputPathsForLockItem(outputRoot: string, item: RenderedLockItem): readonly string[] {
  const files = item.files.length > 0 ? item.files : [item.outputPath];
  return files.map((file) => joinOutputPath(outputRoot, file)).sort(compareStrings);
}

function joinOutputPath(outputRoot: string, path: string): string {
  return normalizePath(outputRoot === "." ? path : join(outputRoot, path));
}

function featureIdForLockItem(item: RenderedLockItem): string {
  if (item.kind === "standalone-skill") return "standalone-skills";
  if (item.kind === "plugin-skill") return "plugin-skills";
  if (item.kind === "plugin") return "plugin-manifests";
  if (item.kind === "rule") return "project-instructions";
  if (item.kind === "project-agent") return "project-agents";
  if (item.kind === "island") return "target-native-islands";
  if (item.kind === "changelog") return "releases";
  if (item.kind === "plugin-feature" && item.feature === "mcp") return "plugin-mcp";
  if (item.kind === "plugin-feature" && item.feature === "bin") return "plugin-bin";
  return item.feature ?? item.kind;
}

/**
 * Concrete output artifact/scope (the `destination`) a lock item renders to,
 * under its provider `target`. Collapses the skill features into the single
 * `skill` artifact and names manifests/instructions/agents/provider source explicitly,
 * so `destination` describes where output lands rather than which capability
 * produced it (`featureId`).
 */
function destinationForLockItem(item: RenderedLockItem): string {
  if (item.kind === "standalone-skill" || item.kind === "plugin-skill") return "skill";
  if (item.kind === "plugin") return "plugin-manifest";
  if (item.kind === "rule") return "instruction";
  if (item.kind === "project-agent") return "agent";
  if (item.kind === "island") return "target-native-island";
  if (item.kind === "changelog") return "changelog";
  // Plugin feature artifacts use the bare scope name (e.g. `mcp`, `bin`), the
  // same convention companion files use via their featureKey, so a given
  // destination is named identically across producers and never just mirrors
  // the `plugin-`-prefixed featureId.
  if (item.kind === "plugin-feature" && item.feature !== undefined) return item.feature;
  return item.feature ?? item.kind;
}

function sourceUnitForLockItem(item: RenderedLockItem, target: TargetName | undefined): string {
  if (item.kind === "standalone-skill") return selectorForStandaloneSkill(item.name);
  if (item.kind === "plugin-skill" && item.plugin !== undefined) {
    return selectorForPluginSkill(item.plugin, item.name);
  }
  if (item.kind === "plugin") return selectorForPluginConfig(item.name);
  if (item.kind === "plugin-feature" && item.plugin !== undefined && item.feature !== undefined) {
    return selectorForPluginFeature(item.plugin, item.feature);
  }
  if (item.kind === "rule") return selectorForInstruction(item.name);
  if (item.kind === "project-agent") return selectorForProjectAgent(item.name);
  if (item.kind === "island") return sourceUnitForIsland(item, target);
  return item.sourcePath;
}

function sourceUnitForIsland(item: RenderedLockItem, target: TargetName | undefined): string {
  const [nameTarget, owner, ...relativeParts] = item.name.split(":");
  const islandTarget = target ?? (isTargetName(nameTarget) ? nameTarget : undefined);
  if (islandTarget === undefined) return item.sourcePath;
  const relativePath = relativeParts.join(":") || item.outputPath;
  if (owner !== undefined && owner !== "project") {
    return selectorForTargetNativeIsland(islandTarget, `plugin:${owner}`, relativePath);
  }
  return selectorForTargetNativeIsland(islandTarget, "project", relativePath);
}

function statusForLockItem(item: RenderedLockItem, target: TargetName | undefined): SkillsetRenderResultStatus {
  if (item.kind === "changelog") return "metadata_only";
  if (item.kind === "island" || item.kind === "plugin-feature") return "target_native";
  if (item.kind === "rule") return "transformed";
  if (item.kind === "project-agent" && target === "codex") return "transformed";
  if (item.transforms !== undefined && item.transforms.length > 0) return "transformed";
  if (item.validation === "opaque-copy") return "target_native";
  return "rendered";
}

function targetForLockItem(
  graph: BuildGraph,
  lock: RenderedLock,
  item: RenderedLockItem,
  outputPaths: readonly string[]
): TargetName | undefined {
  if (lock.target !== "workspace") return lock.target;
  if (item.kind === "rule" && outputPaths.some((path) => path === "AGENTS.md" || path.endsWith("/AGENTS.md"))) {
    return "codex";
  }
  for (const path of outputPaths) {
    const target = targetForOutputPath(graph, path);
    if (target !== undefined) return target;
  }
  return undefined;
}

function targetForOutputPath(graph: BuildGraph, path: string): TargetName | undefined {
  const pluginTarget = pluginTargetForOutputPath(graph, path);
  if (pluginTarget !== undefined) return pluginTarget;
  for (const target of TARGETS) {
    if (isInsideOutputRoot(path, graph.root.outputs.skills[target])) return target;
    if (isInsideOutputRoot(path, targetProjectRoot(graph, target))) return target;
  }
  return undefined;
}

function companionForPath(
  graph: BuildGraph,
  path: string
):
  | {
      readonly featureId: string;
      readonly featureKey: string;
      readonly pluginId: string;
      readonly sourceRelativePath: string;
      readonly target: TargetName;
    }
  | undefined {
  for (const target of TARGETS) {
    const outputRoot = graph.root.outputs.plugins[target];
    const parts = pluginPathPartsForOutput(outputRoot, target, path);
    if (parts === undefined) continue;
    const { pluginId, pluginPath } = parts;
    if (pluginPath === "README.md") {
      return { featureId: "plugin-readme", featureKey: "readme", pluginId, sourceRelativePath: "README.md", target };
    }
    if (pluginPath === ".app.json") {
      return { featureId: "plugin-apps", featureKey: "app", pluginId, sourceRelativePath: ".app.json", target };
    }
    if (target === "claude" && pluginPath === ".lsp.json") {
      return { featureId: "plugin-lsp-servers", featureKey: "lsp-servers", pluginId, sourceRelativePath: ".lsp.json", target };
    }
    if ((target === "claude" || target === "cursor") && isCompanionPath(pluginPath, "commands")) {
      return { featureId: "plugin-commands", featureKey: "commands", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (pluginPath === "hooks/hooks.json" || pluginPath.startsWith("hooks/")) {
      return { featureId: "plugin-hooks", featureKey: "hooks", pluginId, sourceRelativePath: pluginPath, target };
    }
    if ((target === "claude" || target === "cursor") && isCompanionPath(pluginPath, "agents")) {
      return { featureId: "plugin-agents", featureKey: "agents", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "cursor" && isCompanionPath(pluginPath, "rules")) {
      return { featureId: "plugin-rules", featureKey: "rules", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "claude" && isCompanionPath(pluginPath, "output-styles")) {
      return { featureId: "plugin-output-styles", featureKey: "output-styles", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "claude" && isCompanionPath(pluginPath, "themes")) {
      return { featureId: "plugin-themes", featureKey: "themes", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "claude" && isCompanionPath(pluginPath, "monitors")) {
      return { featureId: "plugin-monitors", featureKey: "monitors", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (isCompanionPath(pluginPath, "assets")) {
      return { featureId: "plugin-assets", featureKey: "assets", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (isCompanionPath(pluginPath, "scripts")) {
      return { featureId: "plugin-scripts", featureKey: "scripts", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (isCompanionPath(pluginPath, "src")) {
      return { featureId: "plugin-src", featureKey: "src", pluginId, sourceRelativePath: pluginPath, target };
    }
  }
  return undefined;
}

function isCompanionPath(path: string, topLevelPath: string): boolean {
  return path === topLevelPath || path.startsWith(`${topLevelPath}/`);
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  return readString(graph.root.targets[target].options, "projectRoot") ??
    (target === "claude" ? ".claude" : target === "codex" ? ".codex" : ".cursor");
}

function targetLabel(target: TargetName): string {
  if (target === "claude") return "Claude";
  if (target === "codex") return "Codex";
  return "Cursor";
}

function pluginTargetSelected(graph: BuildGraph, pluginId: string, target: TargetName): boolean {
  const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
  return plugin !== undefined && plugin.targets[target].enabled && isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, pluginId);
}

function providerListAllows(providers: readonly TargetName[] | undefined, target: TargetName): boolean {
  return providers === undefined || providers.includes(target);
}

function evidenceFor(featureId: string, target: TargetName | undefined) {
  const feature = getSkillsetFeature(featureId);
  if (feature === undefined) return undefined;
  if (target === undefined) return feature.evidence.length === 0 ? undefined : feature.evidence;
  return feature.targetSupport[target].evidence ?? (feature.evidence.length === 0 ? undefined : feature.evidence);
}

function reasonForStatus(
  featureId: string,
  target: TargetName | undefined,
  status: SkillsetRenderResultStatus
): string | undefined {
  if (status !== "degraded" && status !== "lossy" && status !== "unsupported" && status !== "failed") {
    return undefined;
  }
  if (target === undefined) return undefined;
  return getSkillsetFeature(featureId)?.targetSupport[target].reason;
}

function requiredReasonForStatus(
  featureId: string,
  target: TargetName,
  status: SkillsetRenderResultStatus
): string {
  const reason = reasonForStatus(featureId, target, status);
  if (reason === undefined) {
    throw new Error(`skillset: feature registry ${featureId} ${target} ${status} support requires a reason`);
  }
  return reason;
}

function isInsideOutputRoot(path: string, outputRoot: string): boolean {
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeSourcePath(graph: BuildGraph, path: string): string {
  return normalizePath(path.startsWith(graph.rootPath) ? relative(graph.rootPath, path) : path);
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`skillset: expected generated lock ${key} to be a string`);
  return value;
}

function optionalStringField(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`skillset: expected generated lock ${key} to be a string`);
  return value;
}

function stringArrayField(record: JsonRecord, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`skillset: expected generated lock ${key} to be a string array`);
  }
  return [...value];
}

function optionalStringArrayField(record: JsonRecord, key: string): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`skillset: expected generated lock ${key} to be a string array`);
  }
  return [...value];
}

function jsonRecordArrayField(record: JsonRecord, key: string): readonly JsonRecord[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isJsonRecord)) {
    throw new Error(`skillset: expected generated lock ${key} to be an object array`);
  }
  return [...value];
}
