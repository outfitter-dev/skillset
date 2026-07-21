import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { buildSkillset, diffSkillset } from "./build";
import { readRecord, readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import {
  pluginManifestPath as pluginManifestOutputPath,
  pluginTargetRoot,
} from "./plugin-output";
import { loadBuildGraph } from "./resolver";
import { targetDescriptor } from "./targets";
import {
  type SkillsetActivationExpectation,
  type SkillsetActivationRuntime,
  type SkillsetClaudeSettingSources,
  type SkillsetTestCheck,
  type SkillsetTestCheckResult,
  type SkillsetTestDeclaration,
  type SkillsetTestSelection,
  slugifySkillsetTestProbeName,
} from "./test-declaration";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SkillsetOptions,
  TargetName,
} from "./types";
import { pluginVersion } from "./versioning";
import { isJsonRecord } from "./yaml";

export type { SkillsetTestCheckResult } from "./test-declaration";
export {
  listEnabledSkillsetTestTargets,
  listSkillsetTestDeclarations,
  loadSkillsetTestDeclaration,
  loadSkillsetTestDeclarations,
  loadSkillsetTestEvaluationContext,
  skillsetTestSelectionRecord,
  slugifySkillsetTestProbeName,
} from "./test-declaration";
export type {
  SkillsetActivationProbe,
  SkillsetClaudeSettingSources,
  SkillsetTestDeclaration,
  SkillsetTestSelection,
  SkillsetTestSelectionReport,
} from "./test-declaration";

export type SkillsetRuntimeState = "failed" | "passed";
export type SkillsetRuntimeProviderFailureClass =
  | "auth"
  | "binary"
  | "render"
  | "runtime"
  | "setup"
  | "timeout";

export interface SkillsetRuntimeProbeRequest {
  readonly claudeSettingSources?: SkillsetClaudeSettingSources;
  readonly name: string;
  readonly prompt: string;
  readonly promptProvenance: string;
  readonly target: TargetName;
  readonly timeoutMs?: number;
  readonly workspacePath: string;
}

export interface SkillsetRuntimeProbeOutcome {
  readonly command: readonly string[];
  readonly detail?: string;
  readonly failureClass?: SkillsetRuntimeProviderFailureClass;
  readonly response?: string;
  readonly state: SkillsetRuntimeState;
}

export interface SkillsetRuntimeProbe {
  readonly run: (
    request: SkillsetRuntimeProbeRequest
  ) => Promise<SkillsetRuntimeProbeOutcome>;
}

export interface SkillsetRuntimeAssertionResult extends JsonRecord {
  readonly actual: boolean;
  readonly expected: string;
  readonly kind: "contains" | "notContains";
  readonly ok: boolean;
}

export interface SkillsetRuntimeTestResult {
  readonly assertions: readonly SkillsetRuntimeAssertionResult[];
  readonly command: readonly string[];
  readonly detail?: string;
  readonly failureClass?: SkillsetRuntimeProviderFailureClass | "assertion";
  readonly name: string;
  readonly ok: boolean;
  readonly promptProvenance: string;
  readonly state: SkillsetRuntimeState;
  readonly target: TargetName;
}

export interface SkillsetTestEvaluation {
  readonly buildError?: string;
  readonly checks: readonly SkillsetTestCheckResult[];
  readonly generatedFiles: number;
  readonly ok: boolean;
}

async function runCheck(
  workspacePath: string,
  graph: BuildGraph,
  declaration: SkillsetTestDeclaration,
  check: SkillsetTestCheck,
  options: SkillsetOptions
): Promise<SkillsetTestCheckResult> {
  if (check.kind === "exists") {
    const targetPath = resolveInside(workspacePath, check.path);
    const exists = await pathExists(targetPath);
    return {
      kind: "exists",
      ok: exists,
      path: check.path,
      ...(exists ? {} : { detail: "path does not exist" }),
    };
  }

  if (check.kind === "contains") {
    const targetPath = resolveInside(workspacePath, check.path);
    try {
      const content = await readFile(targetPath, "utf8");
      const ok = content.includes(check.text);
      return {
        kind: "contains",
        ok,
        path: check.path,
        ...(ok ? {} : { detail: "text was not found" }),
      };
    } catch (error) {
      return {
        detail: messageFor(error),
        kind: "contains",
        ok: false,
        path: check.path,
      };
    }
  }

  if (check.kind === "projection") {
    return driftCheck(workspacePath, options, "projection");
  }

  if (check.kind === "pluginManifests") {
    return pluginManifestCheck(workspacePath, graph, declaration);
  }

  return { kind: "build", ok: true };
}

async function driftCheck(
  workspacePath: string,
  options: SkillsetOptions,
  kind: "projection"
): Promise<SkillsetTestCheckResult> {
  const drift = await diffSkillset(workspacePath, options);
  const count =
    drift.added.length +
    drift.changed.length +
    drift.missing.length +
    drift.removed.length;
  return {
    kind,
    ok: count === 0,
    ...(count === 0
      ? {}
      : {
          detail: `${drift.added.length} added, ${drift.changed.length} changed, ${drift.missing.length} missing, ${drift.removed.length} removed`,
        }),
  };
}

async function pluginManifestCheck(
  workspacePath: string,
  graph: BuildGraph,
  declaration: SkillsetTestDeclaration
): Promise<SkillsetTestCheckResult> {
  const failures: string[] = [];
  let checked = 0;
  for (const pluginId of declaration.selection.plugins) {
    const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
    if (plugin === undefined) {
      failures.push(`unknown plugin ${pluginId}`);
      continue;
    }
    for (const target of declaration.targets) {
      if (
        !plugin.targets[target].enabled ||
        !outputIncludes(
          graph.root.outputs.targetOutputs[target].plugins,
          plugin.id
        )
      )
        continue;
      const manifestPath = pluginManifestPath(graph, target, plugin.id);
      checked += 1;
      try {
        const manifest = JSON.parse(
          await readFile(resolveInside(workspacePath, manifestPath), "utf8")
        ) as unknown;
        if (!isJsonRecord(manifest)) {
          failures.push(`${manifestPath} is not an object`);
          continue;
        }
        for (const [field, expected] of Object.entries(
          expectedPluginManifestFields(graph, plugin, target)
        )) {
          if (expected === undefined) continue;
          if (!jsonEquals(manifest[field], expected)) {
            failures.push(
              `${manifestPath} ${field} actual ${JSON.stringify(manifest[field])} expected ${JSON.stringify(expected)}`
            );
          }
        }
      } catch (error) {
        failures.push(`${manifestPath}: ${messageFor(error)}`);
      }
    }
  }
  if (checked === 0) failures.push("no selected plugin manifests were emitted");
  return {
    kind: "pluginManifests",
    ok: failures.length === 0,
    ...(failures.length === 0 ? {} : { detail: failures.join("; ") }),
  };
}

function pluginManifestPath(
  graph: BuildGraph,
  target: TargetName,
  pluginId: string
): string {
  return pluginManifestOutputPath(
    graph.root.outputs.plugins[target],
    target,
    pluginId
  );
}

function expectedPluginManifestFields(
  graph: BuildGraph,
  plugin: BuildGraph["plugins"][number],
  target: TargetName
): JsonRecord {
  const metadata = plugin.metadata;
  const portableManifest = readRecord(metadata, "manifest") ?? {};
  const targetManifest =
    readRecord(plugin.targets[target].options, "manifest") ?? {};
  const base = stripUndefinedRecord({
    author: metadata.author,
    description:
      readString(metadata, "summary") ??
      readString(metadata, "description") ??
      plugin.id,
    homepage: metadata.homepage,
    keywords: metadata.keywords,
    license: metadata.license,
    name: readString(portableManifest, "name") ?? plugin.id,
    repository: metadata.repository,
    version: pluginVersion(graph, plugin),
  });
  return stripUndefinedRecord({
    ...base,
    ...targetManifest,
    version: pluginVersion(graph, plugin),
  });
}

function outputIncludes(
  selection: boolean | readonly string[],
  id: string
): boolean {
  return (
    selection === true || (Array.isArray(selection) && selection.includes(id))
  );
}

async function validateSkillsetActivationExpectations(
  workspacePath: string,
  declaration: SkillsetTestDeclaration,
  options: SkillsetOptions
): Promise<void> {
  if (declaration.activationProbes.length === 0) return;
  const graph = await loadBuildGraph(workspacePath, options);
  for (const probe of declaration.activationProbes) {
    if (probe.runtime !== undefined) continue;
    for (const target of probe.targets) {
      const candidates = activationExpectationCandidatePaths(
        graph,
        target,
        probe.expect
      );
      const matched = await Promise.all(
        candidates.map(async (path) =>
          pathExists(resolveInside(workspacePath, path))
        )
      );
      if (matched.some(Boolean)) continue;
      throw new Error(
        `skillset: activation expected ${probe.expect.kind} ${probe.expect.name} was not emitted for target ${target}`
      );
    }
  }
}
function activationExpectationCandidatePaths(
  graph: BuildGraph,
  target: TargetName,
  expect: SkillsetActivationExpectation
): readonly string[] {
  if (expect.kind === "plugin") {
    return [
      pluginManifestOutputPath(
        graph.root.outputs.plugins[target],
        target,
        expect.name
      ),
    ];
  }

  if (expect.kind === "agent") {
    const projectRoot = targetProjectRoot(graph, target);
    return graph.projectAgents
      .filter(
        (agent) =>
          agent.name === expect.name || agent.outputName === expect.name
      )
      .map((agent) =>
        join(
          projectRoot,
          "agents",
          `${agent.outputName}.${targetDescriptor(target).projectAgentExtension}`
        )
      );
  }

  return [
    ...graph.standaloneSkills
      .filter((skill) => skill.id === expect.name)
      .map((skill) =>
        join(
          graph.root.outputs.skills[target],
          dirname(skill.relativePath),
          "SKILL.md"
        )
      ),
    ...graph.plugins.flatMap((plugin) =>
      plugin.skills
        .filter((skill) => skill.id === expect.name)
        .map((skill) =>
          join(
            pluginTargetRoot(
              graph.root.outputs.plugins[target],
              target,
              plugin.id
            ),
            dirname(skill.relativePath),
            "SKILL.md"
          )
        )
    ),
  ];
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  return (
    readString(graph.root.targets[target].options, "projectRoot") ??
    targetDescriptor(target).projectRoot
  );
}
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  if (!(await pathExists(sourcePath))) return;
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

async function copyTestSource(
  graph: BuildGraph,
  stagingWorkspacePath: string
): Promise<void> {
  const ignoredOperationalPaths = ignoredSourceOperationalPaths(
    graph.rootPath,
    graph.sourceDir
  );
  await copyIfExists(
    graph.rootConfigPath,
    join(stagingWorkspacePath, "skillset.yaml")
  );
  await cp(graph.sourcePath, join(stagingWorkspacePath, graph.sourceDir), {
    filter: (path) =>
      !ignoredOperationalPaths.some((ignoredPath) =>
        isSameOrInside(ignoredPath, path)
      ),
    recursive: true,
  });
}

async function applySourceSelection(
  graph: BuildGraph,
  stagingWorkspacePath: string,
  selection: SkillsetTestSelection
): Promise<void> {
  if (!selection.filterSource) return;

  const sourceRootPath = resolveInside(stagingWorkspacePath, graph.sourceRoot);
  await pruneSelectedChildren(
    join(sourceRootPath, "agents"),
    selection.agents.map((agent) => agent.filename)
  );
  await pruneSelectedChildren(
    join(sourceRootPath, "skills"),
    selection.primarySkills
  );

  const selectedPluginIds = new Set([
    ...selection.plugins,
    ...selection.pluginSkills.map((skill) => skill.pluginId),
  ]);
  const pluginSkillsByPlugin = new Map<string, string[]>();
  for (const skill of selection.pluginSkills) {
    const skills = pluginSkillsByPlugin.get(skill.pluginId) ?? [];
    skills.push(skill.skillId);
    pluginSkillsByPlugin.set(skill.pluginId, skills);
  }

  const pluginsPath = join(sourceRootPath, "plugins");
  await pruneSelectedChildren(pluginsPath, [...selectedPluginIds]);
  for (const [pluginId, skillIds] of pluginSkillsByPlugin) {
    if (selection.plugins.includes(pluginId)) continue;
    await prunePluginToSelectedSkills(join(pluginsPath, pluginId), skillIds);
  }

  await removeIfExists(join(sourceRootPath, "rules"));
  await removeIfExists(join(sourceRootPath, "_claude"));
  await removeIfExists(join(sourceRootPath, "_codex"));
}

async function prunePluginToSelectedSkills(
  pluginPath: string,
  skillIds: readonly string[]
): Promise<void> {
  await pruneSelectedChildren(join(pluginPath, "skills"), skillIds);
  if (!(await pathExists(pluginPath))) return;
  const keep = new Set(["config.yaml", "shared", "skillset.yaml", "skills"]);
  for (const entry of await readdir(pluginPath, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    await rm(join(pluginPath, entry.name), { force: true, recursive: true });
  }
}

async function pruneSelectedChildren(
  directory: string,
  keepNames: readonly string[]
): Promise<void> {
  if (!(await pathExists(directory))) return;
  const keep = new Set(keepNames);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    await rm(join(directory, entry.name), { force: true, recursive: true });
  }
}

async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function copyWorkspaceManagedFiles(
  rootPath: string,
  stagingWorkspacePath: string,
  workspaceLockPath: string,
  sourceDir: string
): Promise<void> {
  if (!(await pathExists(workspaceLockPath))) return;
  let lock: unknown;
  try {
    lock = JSON.parse(await readFile(workspaceLockPath, "utf8")) as unknown;
  } catch {
    return;
  }
  if (!isJsonRecord(lock) || !Array.isArray(lock.items)) return;
  const ignoredOperationalPaths = ignoredSourceOperationalPaths(
    rootPath,
    sourceDir
  );
  for (const item of lock.items) {
    if (!isJsonRecord(item) || !Array.isArray(item.files)) continue;
    for (const file of item.files) {
      if (typeof file !== "string") continue;
      const sourcePath = resolveInside(rootPath, file);
      if (
        ignoredOperationalPaths.some((ignoredPath) =>
          isSameOrInside(ignoredPath, sourcePath)
        )
      )
        continue;
      await copyIfExists(sourcePath, join(stagingWorkspacePath, file));
    }
  }
}

function ignoredSourceOperationalPaths(
  rootPath: string,
  sourceDir: string
): readonly string[] {
  return [
    resolveInside(rootPath, sourceCacheRoot(sourceDir)),
    resolveInside(rootPath, sourceSnapshotsRoot(sourceDir)),
  ];
}

function sourceCacheRoot(_sourceDir: string): string {
  return ".skillset/cache";
}

function sourceSnapshotsRoot(_sourceDir: string): string {
  return ".skillset/snapshots";
}

function isSameOrInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") &&
      !relativePath.startsWith("../") &&
      relativePath !== "..")
  );
}

function stripUndefinedRecord(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as JsonRecord;
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  return (
    JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right))
  );
}

function normalizeJson(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value))
    return value.map((item) => normalizeJson(item) as JsonValue);
  if (isJsonRecord(value)) {
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort(compareStrings)) {
      const normalizedValue = normalizeJson(value[key]);
      if (normalizedValue !== undefined) normalized[key] = normalizedValue;
    }
    return normalized;
  }
  return value;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function stageSkillsetTestWorkspace(
  rootPath: string,
  graph: BuildGraph,
  declaration: SkillsetTestDeclaration,
  stagingWorkspacePath: string
): Promise<void> {
  const workspaceLockPath = resolveInside(rootPath, "skillset.lock");
  await copyTestSource(graph, stagingWorkspacePath);
  await applySourceSelection(
    graph,
    stagingWorkspacePath,
    declaration.selection
  );
  await copyIfExists(
    workspaceLockPath,
    join(stagingWorkspacePath, "skillset.lock")
  );
  await copyWorkspaceManagedFiles(
    rootPath,
    stagingWorkspacePath,
    workspaceLockPath,
    graph.sourceDir
  );
}

export async function evaluateSkillsetTestWorkspace(
  workspacePath: string,
  graph: BuildGraph,
  declaration: SkillsetTestDeclaration,
  options: SkillsetOptions
): Promise<SkillsetTestEvaluation> {
  const checks: SkillsetTestCheckResult[] = [];
  let generatedFiles = 0;
  let buildError: string | undefined;
  try {
    generatedFiles = (await buildSkillset(workspacePath, options)).length;
  } catch (error) {
    buildError = messageFor(error);
  }

  if (buildError !== undefined) {
    const buildChecks = declaration.checks.filter(
      (check) => check.kind === "build" || check.kind === "projection"
    );
    if (buildChecks.length === 0) {
      checks.push({ detail: buildError, kind: "build", ok: false });
    } else {
      for (const check of buildChecks)
        checks.push({ detail: buildError, kind: check.kind, ok: false });
    }
  } else {
    for (const check of declaration.checks) {
      checks.push(
        await runCheck(workspacePath, graph, declaration, check, options)
      );
    }
  }
  if (checks.every((check) => check.ok)) {
    await validateSkillsetActivationExpectations(
      workspacePath,
      declaration,
      options
    );
  }
  return {
    ...(buildError === undefined ? {} : { buildError }),
    checks,
    generatedFiles,
    ok: checks.every((check) => check.ok),
  };
}

export async function evaluateSkillsetTestRuntime(
  workspacePath: string,
  declaration: SkillsetTestDeclaration,
  options: SkillsetOptions,
  runtimeProbe: SkillsetRuntimeProbe
): Promise<readonly SkillsetRuntimeTestResult[]> {
  const graph = await loadBuildGraph(workspacePath, options);
  const results: SkillsetRuntimeTestResult[] = [];
  for (const probe of declaration.activationProbes) {
    if (probe.runtime === undefined) continue;
    for (const target of probe.targets) {
      const candidates = activationExpectationCandidatePaths(
        graph,
        target,
        probe.expect
      );
      const rendered = await Promise.all(
        candidates.map(async (path) =>
          pathExists(resolveInside(workspacePath, path))
        )
      );
      if (!rendered.some(Boolean)) {
        results.push({
          assertions: [],
          command: [],
          detail: `expected ${probe.expect.kind} ${probe.expect.name} was not rendered for ${target}`,
          failureClass: "render",
          name: probe.name,
          ok: false,
          promptProvenance: probe.promptProvenance,
          state: "failed",
          target,
        });
        continue;
      }
      const outcome = await runtimeProbe.run({
        ...(probe.runtime.claudeSettingSources === undefined
          ? {}
          : { claudeSettingSources: probe.runtime.claudeSettingSources }),
        name: `${declaration.name}-${slugifySkillsetTestProbeName(probe.name)}-${target}`,
        prompt: probe.prompt,
        promptProvenance: probe.promptProvenance,
        target,
        ...(probe.runtime.timeoutMs === undefined
          ? {}
          : { timeoutMs: probe.runtime.timeoutMs }),
        workspacePath,
      });
      const assertions =
        outcome.state === "passed" && outcome.response !== undefined
          ? runtimeAssertions(outcome.response, probe.runtime)
          : [];
      const ok =
        outcome.state === "passed" &&
        assertions.every((assertion) => assertion.ok);
      results.push({
        assertions,
        command: [...outcome.command],
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        ...(ok
          ? {}
          : {
              failureClass:
                outcome.failureClass ??
                (outcome.state === "passed" ? "assertion" : "runtime"),
            }),
        name: probe.name,
        ok,
        promptProvenance: probe.promptProvenance,
        state: outcome.state,
        target,
      });
    }
  }
  return results;
}

export function runtimeRenderFailures(
  declaration: SkillsetTestDeclaration,
  detail: string
): readonly SkillsetRuntimeTestResult[] {
  return declaration.activationProbes.flatMap((probe) =>
    probe.runtime === undefined
      ? []
      : probe.targets.map((target) => ({
          assertions: [],
          command: [],
          detail,
          failureClass: "render",
          name: probe.name,
          ok: false,
          promptProvenance: probe.promptProvenance,
          state: "failed" as const,
          target,
        }))
  );
}

function runtimeAssertions(
  response: string,
  runtime: SkillsetActivationRuntime
): readonly SkillsetRuntimeAssertionResult[] {
  const assertions: SkillsetRuntimeAssertionResult[] = [];
  if (runtime.contains !== undefined) {
    const actual = response.includes(runtime.contains);
    assertions.push({
      actual,
      expected: runtime.contains,
      kind: "contains",
      ok: actual,
    });
  }
  if (runtime.notContains !== undefined) {
    const actual = !response.includes(runtime.notContains);
    assertions.push({
      actual,
      expected: runtime.notContains,
      kind: "notContains",
      ok: actual,
    });
  }
  return assertions;
}
