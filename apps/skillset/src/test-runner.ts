import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";

import { buildSkillset, diffSkillset } from "./build";
import { readCompileTargets, readRecord, readString, resolveTargets, targetNames } from "./config";
import { compareStrings, resolveInside } from "./path";
import { detectWorkspaceSourceDir, loadBuildGraph } from "./resolver";
import { renderValidatedJson } from "./structured-output";
import type { BuildGraph, JsonRecord, JsonValue, SkillsetOptions, TargetName } from "./types";
import { pluginVersion } from "./versioning";
import { workspaceChangesDir } from "./workspace-state";
import { isJsonRecord, parseYamlRecord } from "./yaml";

const TEST_BUILD_DIR = "cache/tests";
const TEST_SCHEMA = 2;

export interface SkillsetTestReport {
  readonly activationPath?: string;
  readonly activationProbes: number;
  readonly checks: readonly SkillsetTestCheckResult[];
  readonly generatedFiles: number;
  readonly latestPath: string;
  readonly name: string;
  readonly ok: boolean;
  readonly reportMarkdownPath: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly selection: SkillsetTestSelectionReport;
  readonly runPath: string;
  readonly source: string;
  readonly targets: readonly TargetName[];
  readonly workspacePath: string;
}

export interface SkillsetTestCheckResult {
  readonly detail?: string;
  readonly kind: "build" | "contains" | "exists" | "pluginManifests" | "projection";
  readonly ok: boolean;
  readonly path?: string;
}

export interface SkillsetTestSelectionReport extends JsonRecord {
  readonly filterSource: boolean;
  readonly pluginSkills: string[];
  readonly plugins: string[];
  readonly primarySkills: string[];
}

interface TestDeclaration {
  readonly activationProbes: readonly ActivationProbe[];
  readonly checks: readonly TestCheck[];
  readonly name: string;
  readonly selection: TestSelection;
  readonly targets: readonly TargetName[];
}

type TestCheck =
  | { readonly kind: "build" }
  | { readonly kind: "exists"; readonly path: string }
  | { readonly kind: "contains"; readonly path: string; readonly text: string }
  | { readonly kind: "pluginManifests" }
  | { readonly kind: "projection" };

interface PluginSkillSelection {
  readonly pluginId: string;
  readonly skillId: string;
}

interface TestSelection {
  readonly filterSource: boolean;
  readonly pluginSkills: readonly PluginSkillSelection[];
  readonly plugins: readonly string[];
  readonly primarySkills: readonly string[];
}

interface ActivationProbe {
  readonly expect: ActivationExpectation;
  readonly name: string;
  readonly prompt: string;
  readonly targets: readonly TargetName[];
}

interface ActivationExpectation {
  readonly kind: "agent" | "plugin" | "skill";
  readonly name: string;
}

export async function runSkillsetTest(
  rootPath: string,
  name: string | undefined,
  options: SkillsetOptions = {}
): Promise<SkillsetTestReport> {
  await rejectRetiredWorkspaceTestConfig(rootPath, options);
  const graph = await loadBuildGraph(rootPath, options);
  const sourceDir = graph.sourceDir;
  const declaration = await readTestDeclaration(graph, name);
  const buildOptions: SkillsetOptions = {
    buildMode: "all",
    ...(options.distDir === undefined ? {} : { distDir: options.distDir }),
    sourceDir,
    targetFilter: declaration.targets,
  };

  const runId = makeRunId(declaration.name);
  const cacheContext = createOperationalPathContext(rootPath, {
    ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
  });
  const logicalBuildRoot = testBuildRoot(sourceDir);
  const buildRoot = resolveOperationalPath(cacheContext, logicalBuildRoot);
  const runsRoot = join(buildRoot, "runs");
  const runPath = join(runsRoot, runId);
  const workspacePath = join(runPath, "workspace");
  const logicalRunPath = join(logicalBuildRoot, "runs", runId).replaceAll("\\", "/");
  const logicalWorkspacePath = join(logicalRunPath, "workspace").replaceAll("\\", "/");
  const stagingRoot = await mkdtemp(join(tmpdir(), "skillset-test-"));
  const stagingWorkspacePath = join(stagingRoot, "workspace");
  const workspaceLockPath = resolveInside(rootPath, "skillset.lock");

  try {
    await mkdir(stagingWorkspacePath, { recursive: true });
    await copyTestSource(graph, stagingWorkspacePath);
    await applySourceSelection(graph, stagingWorkspacePath, declaration.selection);
    // Source-adjacent generated projections need the workspace lock to remain recognized as managed.
    await copyIfExists(workspaceLockPath, join(stagingWorkspacePath, "skillset.lock"));
    await copyWorkspaceManagedFiles(rootPath, stagingWorkspacePath, workspaceLockPath, sourceDir);

    const checks: SkillsetTestCheckResult[] = [];
    let generatedFiles = 0;
    let buildError: string | undefined;
    try {
      generatedFiles = (await buildSkillset(stagingWorkspacePath, buildOptions)).length;
    } catch (error) {
      buildError = messageFor(error);
    }

    if (buildError !== undefined) {
      const buildChecks = declaration.checks.filter((check) => check.kind === "build" || check.kind === "projection");
      if (buildChecks.length === 0) {
        checks.push({ detail: buildError, kind: "build", ok: false });
      } else {
        for (const check of buildChecks) {
          checks.push({ detail: buildError, kind: check.kind, ok: false });
        }
      }
    } else {
      for (const check of declaration.checks) {
        checks.push(await runCheck(stagingWorkspacePath, graph, declaration, check, buildOptions));
      }
    }
    if (checks.every((check) => check.ok)) {
      await validateActivationExpectations(stagingWorkspacePath, declaration, buildOptions);
    }

    await mkdir(runPath, { recursive: true });
    await cp(stagingWorkspacePath, workspacePath, { recursive: true });
    const activationPath = await writeActivationProbes(runPath, declaration);
    const logicalActivationPath = activationPath === undefined
      ? undefined
      : join(logicalRunPath, "activation").replaceAll("\\", "/");

    const ok = checks.every((check) => check.ok);
    const reportPath = join(runPath, "report.json");
    const reportMarkdownPath = join(runPath, "report.md");
    const latestPath = join(buildRoot, "latest");
    const logicalLatestPath = join(logicalBuildRoot, "latest").replaceAll("\\", "/");
    const activationReport = activationPath === undefined
      ? {}
      : {
        activation: {
          path: logicalActivationPath,
          probes: declaration.activationProbes.length,
        },
      };
    const report: JsonRecord = {
      checks: checks.map(checkRecord),
      generatedFiles,
      name: declaration.name,
      ok,
      runId,
      schemaVersion: TEST_SCHEMA,
      selection: selectionRecord(declaration.selection),
      source: `repo:${sourceDir}`,
      targets: [...declaration.targets],
      ...activationReport,
      workspacePath: logicalWorkspacePath,
    };

    await writeFile(reportPath, renderValidatedJson(report, join(logicalRunPath, "report.json")), "utf8");
    await writeFile(reportMarkdownPath, renderMarkdownReport(report), "utf8");
    await refreshLatest(buildRoot, runPath, latestPath, logicalBuildRoot, logicalLatestPath, logicalRunPath, report);

    return {
      ...(logicalActivationPath === undefined ? {} : { activationPath: logicalActivationPath }),
      activationProbes: declaration.activationProbes.length,
      checks,
      generatedFiles,
      latestPath: logicalLatestPath,
      name: declaration.name,
      ok,
      reportMarkdownPath: join(logicalRunPath, "report.md").replaceAll("\\", "/"),
      reportPath: join(logicalRunPath, "report.json").replaceAll("\\", "/"),
      runId,
      selection: selectionRecord(declaration.selection),
      runPath: logicalRunPath,
      source: `repo:${sourceDir}`,
      targets: declaration.targets,
      workspacePath: logicalWorkspacePath,
    };
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function rejectRetiredWorkspaceTestConfig(rootPath: string, options: SkillsetOptions): Promise<void> {
  const sourceDir = await detectWorkspaceSourceDir(rootPath, options);
  const configPaths = sourceDir === "."
    ? ["skillset.yaml"]
    : [join(sourceDir, "skillset.yaml"), join(sourceDir, "config.yaml")];
  for (const configPath of configPaths) {
    const absolutePath = resolveInside(rootPath, configPath);
    if (!(await pathExists(absolutePath))) continue;
    const config = parseYamlRecord(await readFile(absolutePath, "utf8"), absolutePath);
    if (config.tests !== undefined) {
      throw new Error(`skillset: ${absolutePath}.tests is retired; place test declarations in ${testDeclarationRootForSourceDir(sourceDir)}/tests.yaml or ${testDeclarationRootForSourceDir(sourceDir)}/tests/*.yaml`);
    }
    return;
  }
}

async function readTestDeclaration(graph: BuildGraph, requestedName: string | undefined): Promise<TestDeclaration> {
  const configPath = graph.rootConfigPath;
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  if (config.tests !== undefined) {
    throw new Error(`skillset: ${configPath}.tests is retired; place test declarations in ${testDeclarationRoot(graph)}/tests.yaml or ${testDeclarationRoot(graph)}/tests/*.yaml`);
  }
  const defaultTargets = readEffectiveTargets(config, configPath);
  const tests = await readTestDeclarations(graph);

  const names = Object.keys(tests).sort(compareStrings);
  if (names.length === 0) {
    throw new Error(`skillset: ${testDeclarationRoot(graph)} must include tests.yaml or tests/*.yaml for skillset test`);
  }
  const name = requestedName ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined) {
    throw new Error(`skillset: multiple tests configured (${names.join(", ")}); pass a test name`);
  }
  const declaration = tests[name];
  if (declaration === undefined) throw new Error(`skillset: test ${name} is not configured; available tests: ${names.join(", ")}`);

  return readTestObject(graph, declaration.record, declaration.label, name, defaultTargets);
}

interface TestDeclarationRecord {
  readonly label: string;
  readonly record: JsonRecord;
}

async function readTestDeclarations(graph: BuildGraph): Promise<Record<string, TestDeclarationRecord>> {
  const declarations: Record<string, TestDeclarationRecord> = {};
  const aggregatePath = resolveInside(graph.rootPath, join(graph.sourceRoot, "tests.yaml"));
  if (await pathExists(aggregatePath)) {
    const aggregate = parseYamlRecord(await readFile(aggregatePath, "utf8"), aggregatePath);
    for (const name of Object.keys(aggregate).sort(compareStrings)) {
      const value = aggregate[name];
      if (!isJsonRecord(value)) throw new Error(`skillset: expected ${relative(graph.rootPath, aggregatePath)}.${name} to be an object`);
      addTestDeclaration(declarations, name, {
        label: `${relative(graph.rootPath, aggregatePath)}.${name}`,
        record: value,
      });
    }
  }

  const testsDir = resolveInside(graph.rootPath, join(graph.sourceRoot, "tests"));
  if (await pathExists(testsDir)) {
    const entries = (await readdir(testsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && (extname(entry.name) === ".yaml" || extname(entry.name) === ".yml"))
      .map((entry) => entry.name)
      .sort(compareStrings);
    for (const entry of entries) {
      const testPath = join(testsDir, entry);
      const record = parseYamlRecord(await readFile(testPath, "utf8"), testPath);
      addTestDeclaration(declarations, entry.replace(/\.ya?ml$/u, ""), {
        label: relative(graph.rootPath, testPath),
        record,
      });
    }
  }
  return declarations;
}

function addTestDeclaration(
  declarations: Record<string, TestDeclarationRecord>,
  name: string,
  declaration: TestDeclarationRecord
): void {
  const existing = declarations[name];
  if (existing !== undefined) {
    throw new Error(`skillset: duplicate test ${name} in ${existing.label} and ${declaration.label}`);
  }
  declarations[name] = declaration;
}

function testDeclarationRoot(graph: BuildGraph): string {
  return relative(graph.rootPath, graph.sourceRootPath);
}

function testDeclarationRootForSourceDir(sourceDir: string): string {
  return sourceDir === "." ? "skillset" : join(sourceDir, "src");
}

function readTestObject(
  graph: BuildGraph,
  record: JsonRecord,
  label: string,
  name: string,
  defaultTargets: readonly TargetName[]
): TestDeclaration {
  for (const key of Object.keys(record)) {
    if (key === "assertions" || key === "assert") {
      throw new Error(`skillset: ${label}.${key} is retired; use ${label}.checks`);
    }
    if (key === "source") {
      throw new Error(`skillset: ${label}.source is retired; use ${label}.select`);
    }
    if (key !== "activation" && key !== "checks" && key !== "output" && key !== "select" && key !== "targets") {
      throw new Error(`skillset: unsupported test key ${key} in ${label}`);
    }
  }

  const targets = readTargets(record.targets, `${label}.targets`, defaultTargets);
  const selection = readSelection(graph, record.select, `${label}.select`);
  const checks = readChecks(record.checks, `${label}.checks`, selection);
  const activationProbes = readActivationProbes(record.activation, `${label}.activation`, targets);
  validateActivationProbeNames(activationProbes, targets);
  const output = record.output;
  if (output !== undefined) {
    if (!isJsonRecord(output)) throw new Error(`skillset: expected ${label}.output to be an object`);
    for (const key of Object.keys(output)) {
      if (key !== "kind") throw new Error(`skillset: unsupported test output key ${key} in ${label}.output`);
    }
    const kind = readString(output, "kind");
    if (kind !== undefined && kind !== "isolated") {
      throw new Error(`skillset: ${label}.output.kind ${JSON.stringify(kind)} is not supported yet; use isolated`);
    }
  }

  return { activationProbes, checks, name, selection, targets };
}

function readTargets(value: JsonValue | undefined, label: string, defaultTargets: readonly TargetName[]): readonly TargetName[] {
  if (value === undefined) return defaultTargets;
  if (!Array.isArray(value)) throw new Error(`skillset: expected ${label} to be a string array`);
  if (value.length === 0) throw new Error(`skillset: expected ${label} to include at least one target`);
  const enabled = new Set(defaultTargets);
  const seen = new Set<TargetName>();
  for (const target of value) {
    if (target !== "claude" && target !== "codex") {
      throw new Error(`skillset: unsupported target ${JSON.stringify(target)} in ${label}; expected claude or codex`);
    }
    if (seen.has(target)) throw new Error(`skillset: duplicate target ${JSON.stringify(target)} in ${label}`);
    if (!enabled.has(target)) throw new Error(`skillset: test target ${target} in ${label} is not enabled by root target configuration`);
    seen.add(target);
  }
  return [...seen];
}

function readEffectiveTargets(record: JsonRecord, label: string): readonly TargetName[] {
  const targets = resolveTargets(readCompileTargets(record, label), record, label, {
    allowDefaults: true,
    objectInheritsEnabled: true,
  });
  return targetNames().filter((target) => targets[target].enabled);
}

function readSelection(graph: BuildGraph, value: JsonValue | undefined, label: string): TestSelection {
  if (value === undefined) return { filterSource: false, pluginSkills: [], plugins: [], primarySkills: [] };
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "plugins" && key !== "skills") {
      throw new Error(`skillset: unsupported selector key ${key} in ${label}`);
    }
  }

  const pluginIds = new Set<string>();
  const primarySkillIds = new Set<string>();
  const pluginSkillKeys = new Set<string>();
  const pluginSkills: PluginSkillSelection[] = [];

  function addPluginSkill(pluginId: string, skillId: string): void {
    const key = `${pluginId}\0${skillId}`;
    if (pluginSkillKeys.has(key)) return;
    pluginSkillKeys.add(key);
    pluginSkills.push({ pluginId, skillId });
  }

  readPluginSelection(graph, value.plugins, `${label}.plugins`, pluginIds, addPluginSkill);
  readSkillSelection(graph, value.skills, `${label}.skills`, primarySkillIds, addPluginSkill);

  const selection = {
    filterSource: true,
    pluginSkills: pluginSkills.sort((left, right) => compareStrings(`${left.pluginId}/${left.skillId}`, `${right.pluginId}/${right.skillId}`)),
    plugins: [...pluginIds].sort(compareStrings),
    primarySkills: [...primarySkillIds].sort(compareStrings),
  };
  if (selection.plugins.length === 0 && selection.primarySkills.length === 0 && selection.pluginSkills.length === 0) {
    throw new Error(`skillset: ${label} must select at least one source unit`);
  }
  return selection;
}

function readPluginSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  pluginIds: Set<string>,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const plugin of graph.plugins) pluginIds.add(plugin.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const id of readStringArray(value, label)) {
      assertPlugin(graph, id, label);
      pluginIds.add(id);
    }
    return;
  }
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be true, a string array, or an object`);
  for (const key of Object.keys(value)) {
    if (key !== "include" && key !== "skills") throw new Error(`skillset: unsupported selector key ${key} in ${label}`);
  }
  const included = value.include === undefined
    ? graph.plugins.map((plugin) => plugin.id)
    : readSelectorNames(graph.plugins.map((plugin) => plugin.id), value.include, `${label}.include`, "plugin");
  if (value.skills === undefined) {
    for (const id of included) pluginIds.add(id);
  }
  readPluginSkillSelectionForPlugins(graph, included, value.skills, `${label}.skills`, addPluginSkill);
}

function readSkillSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  primarySkillIds: Set<string>,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const skill of graph.standaloneSkills) primarySkillIds.add(skill.id);
    for (const plugin of graph.plugins) for (const skill of plugin.skills) addPluginSkill(plugin.id, skill.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const id of readStringArray(value, label)) {
      assertPrimarySkill(graph, id, label);
      primarySkillIds.add(id);
    }
    return;
  }
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be true, a string array, or an object`);
  for (const key of Object.keys(value)) {
    if (key !== "primary" && key !== "plugin") throw new Error(`skillset: unsupported selector key ${key} in ${label}`);
  }
  const primary = value.primary;
  if (primary === true) {
    for (const skill of graph.standaloneSkills) primarySkillIds.add(skill.id);
  } else if (primary !== undefined) {
    for (const id of readSelectorNames(graph.standaloneSkills.map((skill) => skill.id), primary, `${label}.primary`, "primary skill")) {
      primarySkillIds.add(id);
    }
  }
  readPluginSkillSelection(graph, value.plugin, `${label}.plugin`, addPluginSkill);
}

function readPluginSkillSelection(
  graph: BuildGraph,
  value: JsonValue | undefined,
  label: string,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const plugin of graph.plugins) for (const skill of plugin.skills) addPluginSkill(plugin.id, skill.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const id of readStringArray(value, label)) {
      const matches = graph.plugins.flatMap((plugin) => plugin.skills.some((skill) => skill.id === id) ? [plugin.id] : []);
      if (matches.length === 0) throw new Error(`skillset: unknown plugin skill ${JSON.stringify(id)} in ${label}`);
      if (matches.length > 1) {
        throw new Error(`skillset: plugin skill ${JSON.stringify(id)} in ${label} is ambiguous across plugins ${matches.sort(compareStrings).join(", ")}; use ${label}.<plugin>`);
      }
      addPluginSkill(matches[0]!, id);
    }
    return;
  }
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be true, a string array, or an object`);
  for (const [pluginId, raw] of Object.entries(value).sort(([left], [right]) => compareStrings(left, right))) {
    assertPlugin(graph, pluginId, label);
    readPluginSkillSelectionForPlugins(graph, [pluginId], raw, `${label}.${pluginId}`, addPluginSkill);
  }
}

function readPluginSkillSelectionForPlugins(
  graph: BuildGraph,
  pluginIds: readonly string[],
  value: JsonValue | undefined,
  label: string,
  addPluginSkill: (pluginId: string, skillId: string) => void
): void {
  if (value === undefined) return;
  if (value === true) {
    for (const pluginId of pluginIds) {
      const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
      if (plugin === undefined) continue;
      for (const skill of plugin.skills) addPluginSkill(plugin.id, skill.id);
    }
    return;
  }
  if (Array.isArray(value)) {
    const ids = readStringArray(value, label);
    for (const pluginId of pluginIds) {
      const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
      if (plugin === undefined) continue;
      for (const id of ids) {
        if (!plugin.skills.some((skill) => skill.id === id)) {
          throw new Error(`skillset: unknown plugin skill ${JSON.stringify(id)} for plugin ${pluginId} in ${label}`);
        }
        addPluginSkill(pluginId, id);
      }
    }
    return;
  }
  throw new Error(`skillset: expected ${label} to be true or a string array`);
}

function readSelectorNames(
  known: readonly string[],
  value: JsonValue,
  label: string,
  kind: string
): readonly string[] {
  if (value === true) return [...known].sort(compareStrings);
  if (!Array.isArray(value)) throw new Error(`skillset: expected ${label} to be true or a string array`);
  const names = readStringArray(value, label);
  for (const name of names) {
    if (!known.includes(name)) throw new Error(`skillset: unknown ${kind} ${JSON.stringify(name)} in ${label}`);
  }
  return names;
}

function assertPlugin(graph: BuildGraph, id: string, label: string): void {
  if (graph.plugins.some((plugin) => plugin.id === id)) return;
  throw new Error(`skillset: unknown plugin ${JSON.stringify(id)} in ${label}`);
}

function assertPrimarySkill(graph: BuildGraph, id: string, label: string): void {
  if (graph.standaloneSkills.some((skill) => skill.id === id)) return;
  throw new Error(`skillset: unknown primary skill ${JSON.stringify(id)} in ${label}`);
}

function readStringArray(value: readonly JsonValue[], label: string): readonly string[] {
  if (value.length === 0) throw new Error(`skillset: expected ${label} to include at least one item`);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`skillset: expected ${label}[${index}] to be a non-empty string`);
    }
    if (seen.has(item)) throw new Error(`skillset: duplicate selector ${JSON.stringify(item)} in ${label}`);
    seen.add(item);
    items.push(item);
  }
  return items;
}

function readChecks(value: JsonValue | undefined, label: string, selection: TestSelection): readonly TestCheck[] {
  if (value === undefined) throw new Error(`skillset: ${label} is required`);
  const checks: TestCheck[] = [];
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "files" && key !== "pluginManifests" && key !== "projection") {
      throw new Error(`skillset: unsupported check key ${key} in ${label}`);
    }
  }
  if (readBooleanCheck(value.projection, `${label}.projection`)) checks.push({ kind: "projection" });
  if (readBooleanCheck(value.pluginManifests, `${label}.pluginManifests`)) {
    if (selection.plugins.length === 0) throw new Error(`skillset: ${label}.pluginManifests requires select.plugins`);
    checks.push({ kind: "pluginManifests" });
  }
  const files = value.files;
  if (files !== undefined) {
    if (!Array.isArray(files) || files.length === 0) throw new Error(`skillset: expected ${label}.files to be a non-empty array`);
    for (const [index, item] of files.entries()) checks.push(readFileCheck(item, `${label}.files[${index}]`));
  }
  if (checks.length === 0) throw new Error(`skillset: expected ${label} to include at least one check`);
  return checks;
}

function readBooleanCheck(value: JsonValue | undefined, label: string): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new Error(`skillset: expected ${label} to be true or false`);
}

function readFileCheck(value: JsonValue, label: string): TestCheck {
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be a file check object`);
  for (const key of Object.keys(value)) {
    if (key !== "contains" && key !== "path") throw new Error(`skillset: unsupported file check key ${key} in ${label}`);
  }
  const path = readString(value, "path");
  if (path === undefined) throw new Error(`skillset: ${label}.path is required`);
  const contains = readString(value, "contains");
  if (contains !== undefined) return { kind: "contains", path, text: contains };
  return { kind: "exists", path };
}

function readActivationProbes(
  value: JsonValue | undefined,
  label: string,
  defaultTargets: readonly TargetName[]
): readonly ActivationProbe[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`skillset: expected ${label} to be an array`);
  return value.map((item, index) => readActivationProbe(item, `${label}[${index}]`, defaultTargets));
}

function readActivationProbe(
  value: JsonValue,
  label: string,
  defaultTargets: readonly TargetName[]
): ActivationProbe {
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "expect" && key !== "name" && key !== "prompt" && key !== "targets") {
      throw new Error(`skillset: unsupported activation key ${key} in ${label}`);
    }
  }
  const prompt = readString(value, "prompt");
  if (prompt === undefined) throw new Error(`skillset: ${label}.prompt is required`);
  const expect = readActivationExpectation(value.expect, `${label}.expect`);
  const targets = readTargets(value.targets, `${label}.targets`, defaultTargets);
  const configuredName = readString(value, "name");
  return {
    expect,
    name: configuredName ?? activationProbeName(expect),
    prompt,
    targets,
  };
}

function readActivationExpectation(value: JsonValue | undefined, label: string): ActivationExpectation {
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be an object`);
  const entries = (["agent", "plugin", "skill"] as const)
    .map((kind) => ({ kind, name: readString(value, kind) }))
    .filter((entry): entry is ActivationExpectation => entry.name !== undefined);
  if (entries.length !== 1) {
    throw new Error(`skillset: ${label} must name exactly one of agent, plugin, or skill`);
  }
  const [entry] = entries;
  if (entry === undefined) throw new Error(`skillset: ${label} must name exactly one of agent, plugin, or skill`);
  return entry;
}

function activationProbeName(expect: ActivationExpectation): string {
  return `${expect.kind}-${expect.name}`;
}

function validateActivationProbeNames(
  probes: readonly ActivationProbe[],
  targets: readonly TargetName[]
): void {
  for (const target of targets) {
    const names = new Set<string>();
    for (const probe of probes.filter((candidate) => candidate.targets.includes(target))) {
      const name = slugifyProbeName(probe.name);
      if (names.has(name)) {
        throw new Error(`skillset: duplicate activation probe output name ${JSON.stringify(name)} for target ${target}`);
      }
      names.add(name);
    }
  }
}

function checkRecord(check: SkillsetTestCheckResult): JsonRecord {
  return {
    ...(check.detail === undefined ? {} : { detail: check.detail }),
    kind: check.kind,
    ok: check.ok,
    ...(check.path === undefined ? {} : { path: check.path }),
  };
}

async function runCheck(
  workspacePath: string,
  graph: BuildGraph,
  declaration: TestDeclaration,
  check: TestCheck,
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
      return { detail: messageFor(error), kind: "contains", ok: false, path: check.path };
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
  const count = drift.added.length + drift.changed.length + drift.missing.length + drift.removed.length;
  return {
    kind,
    ok: count === 0,
    ...(count === 0 ? {} : { detail: `${drift.added.length} added, ${drift.changed.length} changed, ${drift.missing.length} missing, ${drift.removed.length} removed` }),
  };
}

async function pluginManifestCheck(
  workspacePath: string,
  graph: BuildGraph,
  declaration: TestDeclaration
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
      if (!plugin.targets[target].enabled || !outputIncludes(graph.root.outputs.targetOutputs[target].plugins, plugin.id)) continue;
      const manifestPath = pluginManifestPath(graph, target, plugin.id);
      checked += 1;
      try {
        const manifest = JSON.parse(await readFile(resolveInside(workspacePath, manifestPath), "utf8")) as unknown;
        if (!isJsonRecord(manifest)) {
          failures.push(`${manifestPath} is not an object`);
          continue;
        }
        for (const [field, expected] of Object.entries(expectedPluginManifestFields(graph, plugin, target))) {
          if (expected === undefined) continue;
          if (!jsonEquals(manifest[field], expected)) {
            failures.push(`${manifestPath} ${field} actual ${JSON.stringify(manifest[field])} expected ${JSON.stringify(expected)}`);
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

function pluginManifestPath(graph: BuildGraph, target: TargetName, pluginId: string): string {
  const manifestDirectory = target === "claude" ? ".claude-plugin" : ".codex-plugin";
  return `${graph.root.outputs.plugins[target]}/plugins/${pluginId}/${manifestDirectory}/plugin.json`;
}

function expectedPluginManifestFields(graph: BuildGraph, plugin: BuildGraph["plugins"][number], target: TargetName): JsonRecord {
  const metadata = plugin.metadata;
  const portableManifest = readRecord(metadata, "manifest") ?? {};
  const targetManifest = readRecord(plugin.targets[target].options, "manifest") ?? {};
  const base = stripUndefinedRecord({
    author: metadata.author,
    description: readString(metadata, "summary") ?? readString(metadata, "description") ?? plugin.id,
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

function outputIncludes(selection: boolean | readonly string[], id: string): boolean {
  return selection === true || (Array.isArray(selection) && selection.includes(id));
}

function selectionRecord(selection: TestSelection): SkillsetTestSelectionReport {
  return {
    filterSource: selection.filterSource,
    pluginSkills: selection.pluginSkills.map((skill) => `${skill.pluginId}/${skill.skillId}`),
    plugins: [...selection.plugins],
    primarySkills: [...selection.primarySkills],
  };
}

async function validateActivationExpectations(
  workspacePath: string,
  declaration: TestDeclaration,
  options: SkillsetOptions
): Promise<void> {
  if (declaration.activationProbes.length === 0) return;
  const graph = await loadBuildGraph(workspacePath, options);
  for (const probe of declaration.activationProbes) {
    for (const target of probe.targets) {
      const candidates = activationExpectationCandidatePaths(graph, target, probe.expect);
      const matched = await Promise.all(candidates.map(async (path) => pathExists(resolveInside(workspacePath, path))));
      if (matched.some(Boolean)) continue;
      throw new Error(`skillset: activation expected ${probe.expect.kind} ${probe.expect.name} was not emitted for target ${target}`);
    }
  }
}

function activationExpectationCandidatePaths(
  graph: BuildGraph,
  target: TargetName,
  expect: ActivationExpectation
): readonly string[] {
  if (expect.kind === "plugin") {
    const manifestDirectory = target === "claude" ? ".claude-plugin" : ".codex-plugin";
    return [`${graph.root.outputs.plugins[target]}/plugins/${expect.name}/${manifestDirectory}/plugin.json`];
  }

  if (expect.kind === "agent") {
    const projectRoot = targetProjectRoot(graph, target);
    return graph.projectAgents
      .filter((agent) => agent.name === expect.name || agent.outputName === expect.name)
      .map((agent) => join(projectRoot, "agents", `${agent.outputName}.${target === "claude" ? "md" : "toml"}`));
  }

  return [
    ...graph.standaloneSkills
      .filter((skill) => skill.id === expect.name)
      .map((skill) => join(graph.root.outputs.skills[target], dirname(skill.relativePath), "SKILL.md")),
    ...graph.plugins.flatMap((plugin) =>
      plugin.skills
        .filter((skill) => skill.id === expect.name)
        .map((skill) => join(graph.root.outputs.plugins[target], "plugins", plugin.id, dirname(skill.relativePath), "SKILL.md"))
    ),
  ];
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  return readString(graph.root.targets[target].options, "projectRoot") ?? (target === "claude" ? ".claude" : ".codex");
}

async function writeActivationProbes(
  runPath: string,
  declaration: TestDeclaration
): Promise<string | undefined> {
  if (declaration.activationProbes.length === 0) return undefined;
  const activationRoot = join(runPath, "activation");
  for (const target of declaration.targets) {
    const probes = declaration.activationProbes.filter((probe) => probe.targets.includes(target));
    if (probes.length === 0) continue;
    const targetRoot = join(activationRoot, target);
    await mkdir(targetRoot, { recursive: true });
    const records = probes.map((probe) => activationProbeRecord(probe, target));
    await writeFile(join(targetRoot, "probes.json"), renderValidatedJson({
      probes: records,
      schemaVersion: TEST_SCHEMA,
      target,
    }, `activation ${target} probes`), "utf8");
    for (const record of records) {
      const name = typeof record.name === "string" ? record.name : "probe";
      await writeFile(join(targetRoot, `${name}.md`), renderActivationProbeMarkdown(record), "utf8");
    }
  }
  return activationRoot;
}

function activationProbeRecord(probe: ActivationProbe, target: TargetName): JsonRecord {
  return {
    expect: {
      [probe.expect.kind]: probe.expect.name,
    },
    harness: activationHarness(target),
    name: slugifyProbeName(probe.name),
    prompt: probe.prompt,
    status: target === "claude" ? "manual-native" : "manual-shimmed",
    target,
  };
}

function activationHarness(target: TargetName): string {
  if (target === "claude") {
    return "Manual Claude activation probe. Run against the generated workspace or plugin path and confirm the expected source unit is loaded or invoked.";
  }
  return "Manual Codex activation probe. Use generated Codex output or plugin-eval tooling when available; compatibility shims should be reported explicitly.";
}

function renderActivationProbeMarkdown(record: JsonRecord): string {
  const expect = isJsonRecord(record.expect)
    ? Object.entries(record.expect).map(([kind, name]) => `- ${kind}: ${name}`).join("\n")
    : "- unknown";
  return [
    `# Activation Probe ${record.name}`,
    "",
    `Target: ${record.target}`,
    `Status: ${record.status}`,
    "",
    "## Prompt",
    "",
    String(record.prompt ?? ""),
    "",
    "## Expected Activation",
    "",
    expect,
    "",
    "## Harness",
    "",
    String(record.harness ?? ""),
    "",
  ].join("\n");
}

function slugifyProbeName(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "probe";
}

async function refreshLatest(
  buildRoot: string,
  runPath: string,
  latestPath: string,
  logicalBuildRoot: string,
  logicalLatestPath: string,
  logicalRunPath: string,
  report: JsonRecord
): Promise<void> {
  await rm(latestPath, { force: true, recursive: true });
  await cp(runPath, latestPath, { recursive: true });
  const latest = {
    name: report.name,
    ok: report.ok,
    reportPath: join(logicalLatestPath, "report.json").replaceAll("\\", "/"),
    runId: report.runId,
    runPath: logicalRunPath,
    schemaVersion: TEST_SCHEMA,
    selection: report.selection,
    source: report.source,
    workspacePath: join(logicalLatestPath, "workspace").replaceAll("\\", "/"),
  };
  await writeFile(
    join(buildRoot, "latest.json"),
    renderValidatedJson(latest, join(logicalBuildRoot, "latest.json").replaceAll("\\", "/")),
    "utf8"
  );
}

function renderMarkdownReport(report: JsonRecord): string {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const lines = [
    `# Skillset Test ${report.name}`,
    "",
    `Status: ${report.ok === true ? "passed" : "failed"}`,
    `Run: ${report.runId}`,
    `Source: ${report.source}`,
    ...selectionMarkdownLines(report.selection),
    `Generated files: ${report.generatedFiles}`,
    `Activation probes: ${activationProbeCount(report)}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of checks) {
    if (!isJsonRecord(check)) continue;
    const mark = check.ok === true ? "pass" : "fail";
    const path = typeof check.path === "string" ? ` ${check.path}` : "";
    const detail = typeof check.detail === "string" ? ` - ${check.detail}` : "";
    lines.push(`- ${mark}: ${check.kind}${path}${detail}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function selectionMarkdownLines(value: JsonValue | undefined): readonly string[] {
  if (!isJsonRecord(value)) return ["Selection: none"];
  const plugins = readSelectionList(value.plugins);
  const primarySkills = readSelectionList(value.primarySkills);
  const pluginSkills = readSelectionList(value.pluginSkills);
  const parts = [
    plugins.length === 0 ? undefined : `plugins ${plugins.join(", ")}`,
    primarySkills.length === 0 ? undefined : `primary skills ${primarySkills.join(", ")}`,
    pluginSkills.length === 0 ? undefined : `plugin skills ${pluginSkills.join(", ")}`,
  ].filter((item): item is string => item !== undefined);
  return [`Selection: ${parts.length === 0 ? "none" : parts.join("; ")}`];
}

function readSelectionList(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function activationProbeCount(report: JsonRecord): number {
  const activation = report.activation;
  if (!isJsonRecord(activation)) return 0;
  const probes = activation.probes;
  return typeof probes === "number" && Number.isFinite(probes) ? probes : 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) return;
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

async function copyTestSource(graph: BuildGraph, stagingWorkspacePath: string): Promise<void> {
  const ignoredOperationalPaths = ignoredSourceOperationalPaths(graph.rootPath, graph.sourceDir);
  if (graph.sourceDir !== ".") {
    await cp(graph.sourcePath, join(stagingWorkspacePath, graph.sourceDir), {
      filter: (path) => !ignoredOperationalPaths.some((ignoredPath) => isSameOrInside(ignoredPath, path)),
      recursive: true,
    });
    return;
  }

  await copyIfExists(graph.rootConfigPath, join(stagingWorkspacePath, "skillset.yaml"));
  await copyIfExists(graph.sourceRootPath, join(stagingWorkspacePath, graph.sourceRoot));
  const changesDir = workspaceChangesDir(graph.sourceDir);
  await copyIfExists(resolveInside(graph.rootPath, changesDir), join(stagingWorkspacePath, changesDir));
}

async function applySourceSelection(
  graph: BuildGraph,
  stagingWorkspacePath: string,
  selection: TestSelection
): Promise<void> {
  if (!selection.filterSource) return;

  const sourceRootPath = resolveInside(stagingWorkspacePath, graph.sourceRoot);
  await pruneSelectedChildren(join(sourceRootPath, "skills"), selection.primarySkills);

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

  await removeIfExists(join(sourceRootPath, "agents"));
  await removeIfExists(join(sourceRootPath, "rules"));
  await removeIfExists(join(sourceRootPath, "_claude"));
  await removeIfExists(join(sourceRootPath, "_codex"));
}

async function prunePluginToSelectedSkills(pluginPath: string, skillIds: readonly string[]): Promise<void> {
  await pruneSelectedChildren(join(pluginPath, "skills"), skillIds);
  if (!(await pathExists(pluginPath))) return;
  const keep = new Set(["config.yaml", "shared", "skillset.yaml", "skills"]);
  for (const entry of await readdir(pluginPath, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    await rm(join(pluginPath, entry.name), { force: true, recursive: true });
  }
}

async function pruneSelectedChildren(directory: string, keepNames: readonly string[]): Promise<void> {
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
  const ignoredOperationalPaths = ignoredSourceOperationalPaths(rootPath, sourceDir);
  for (const item of lock.items) {
    if (!isJsonRecord(item) || !Array.isArray(item.files)) continue;
    for (const file of item.files) {
      if (typeof file !== "string") continue;
      const sourcePath = resolveInside(rootPath, file);
      if (ignoredOperationalPaths.some((ignoredPath) => isSameOrInside(ignoredPath, sourcePath))) continue;
      await copyIfExists(sourcePath, join(stagingWorkspacePath, file));
    }
  }
}

function testBuildRoot(sourceDir: string): string {
  return join(".skillset", TEST_BUILD_DIR);
}

function ignoredSourceOperationalPaths(rootPath: string, sourceDir: string): readonly string[] {
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

function makeRunId(name: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const digest = createHash("sha256").update(`${name}:${stamp}:${randomBytes(8).toString("hex")}`).digest("hex").slice(0, 8);
  return `${stamp}-${digest}`;
}

function isSameOrInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("../") && relativePath !== "..");
}

function stripUndefinedRecord(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as JsonRecord;
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function normalizeJson(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item) as JsonValue);
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
