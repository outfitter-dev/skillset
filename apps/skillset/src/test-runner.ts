import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { buildSkillset, diffSkillset } from "./build";
import { readCompileTargets, readString, resolveTargets, targetNames } from "./config";
import { compareStrings, resolveInside } from "./path";
import { loadBuildGraph } from "./resolver";
import { renderValidatedJson } from "./structured-output";
import type { BuildGraph, JsonRecord, JsonValue, SkillsetOptions, TargetName } from "./types";
import { isJsonRecord, parseYamlRecord } from "./yaml";

const TEST_BUILD_DIR = "build/tests";
const TEST_SCHEMA = 1;

export interface SkillsetTestReport {
  readonly activationPath?: string;
  readonly activationProbes: number;
  readonly assertions: readonly SkillsetTestAssertionResult[];
  readonly generatedFiles: number;
  readonly latestPath: string;
  readonly name: string;
  readonly ok: boolean;
  readonly reportMarkdownPath: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly source: string;
  readonly targets: readonly TargetName[];
  readonly workspacePath: string;
}

export interface SkillsetTestAssertionResult {
  readonly detail?: string;
  readonly kind: "build" | "contains" | "exists" | "noDrift";
  readonly ok: boolean;
  readonly path?: string;
}

interface TestDeclaration {
  readonly activationProbes: readonly ActivationProbe[];
  readonly assertions: readonly TestAssertion[];
  readonly name: string;
  readonly source: string;
  readonly targets: readonly TargetName[];
}

type TestAssertion =
  | { readonly kind: "build" }
  | { readonly kind: "exists"; readonly path: string }
  | { readonly kind: "contains"; readonly path: string; readonly text: string }
  | { readonly kind: "noDrift" };

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
  const graph = await loadBuildGraph(rootPath, options);
  const sourceDir = graph.sourceDir;
  const declaration = await readTestDeclaration(graph.rootConfigPath, name);
  if (declaration.source !== `repo:${sourceDir}`) {
    throw new Error(`skillset: test ${declaration.name} source ${declaration.source} is not supported yet; use repo:${sourceDir}`);
  }
  const buildOptions: SkillsetOptions = {
    buildMode: "all",
    ...(options.distDir === undefined ? {} : { distDir: options.distDir }),
    sourceDir,
    targetFilter: declaration.targets,
  };

  const runId = makeRunId(declaration.name);
  const buildRoot = resolveInside(rootPath, testBuildRoot(sourceDir));
  const runsRoot = join(buildRoot, "runs");
  const runPath = join(runsRoot, runId);
  const workspacePath = join(runPath, "workspace");
  const stagingRoot = await mkdtemp(join(tmpdir(), "skillset-test-"));
  const stagingWorkspacePath = join(stagingRoot, "workspace");
  const workspaceLockPath = resolveInside(rootPath, "skillset.lock");

  try {
    await mkdir(stagingWorkspacePath, { recursive: true });
    await copyTestSource(graph, stagingWorkspacePath);
    // Source-adjacent generated projections need the workspace lock to remain recognized as managed.
    await copyIfExists(workspaceLockPath, join(stagingWorkspacePath, "skillset.lock"));
    await copyWorkspaceManagedFiles(rootPath, stagingWorkspacePath, workspaceLockPath, sourceDir);

    const assertions: SkillsetTestAssertionResult[] = [];
    let generatedFiles = 0;
    try {
      generatedFiles = (await buildSkillset(stagingWorkspacePath, buildOptions)).length;
      assertions.push({ kind: "build", ok: true });
    } catch (error) {
      assertions.push({ detail: messageFor(error), kind: "build", ok: false });
    }

    if (assertions.every((assertion) => assertion.ok)) {
      for (const assertion of declaration.assertions) {
        if (assertion.kind === "build") continue;
        assertions.push(await runAssertion(stagingWorkspacePath, assertion, buildOptions));
      }
    }
    if (assertions.every((assertion) => assertion.ok)) {
      await validateActivationExpectations(stagingWorkspacePath, declaration, buildOptions);
    }

    await mkdir(runPath, { recursive: true });
    await cp(stagingWorkspacePath, workspacePath, { recursive: true });
    const activationPath = await writeActivationProbes(runPath, declaration);

    const ok = assertions.every((assertion) => assertion.ok);
    const reportPath = join(runPath, "report.json");
    const reportMarkdownPath = join(runPath, "report.md");
    const latestPath = join(buildRoot, "latest");
    const activationReport = activationPath === undefined
      ? {}
      : {
        activation: {
          path: relative(rootPath, activationPath),
          probes: declaration.activationProbes.length,
        },
      };
    const report: JsonRecord = {
      assertions: assertions.map(assertionRecord),
      generatedFiles,
      name: declaration.name,
      ok,
      runId,
      schemaVersion: TEST_SCHEMA,
      source: declaration.source,
      targets: [...declaration.targets],
      ...activationReport,
      workspacePath: relative(rootPath, workspacePath),
    };

    await writeFile(reportPath, renderValidatedJson(report, relative(rootPath, reportPath)), "utf8");
    await writeFile(reportMarkdownPath, renderMarkdownReport(report), "utf8");
    await refreshLatest(buildRoot, runPath, latestPath, report, rootPath);

    return {
      assertions,
      ...(activationPath === undefined ? {} : { activationPath: relative(rootPath, activationPath) }),
      activationProbes: declaration.activationProbes.length,
      generatedFiles,
      latestPath: relative(rootPath, latestPath),
      name: declaration.name,
      ok,
      reportMarkdownPath: relative(rootPath, reportMarkdownPath),
      reportPath: relative(rootPath, reportPath),
      runId,
      runPath: relative(rootPath, runPath),
      source: declaration.source,
      targets: declaration.targets,
      workspacePath: relative(rootPath, workspacePath),
    };
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function readTestDeclaration(configPath: string, requestedName: string | undefined): Promise<TestDeclaration> {
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  const defaultTargets = readEffectiveTargets(config, configPath);
  const tests = config.tests;
  if (!isJsonRecord(tests)) {
    throw new Error(`skillset: ${configPath} requires a tests object for skillset test`);
  }

  const names = Object.keys(tests).sort(compareStrings);
  if (names.length === 0) throw new Error(`skillset: ${configPath}.tests must include at least one test`);
  const name = requestedName ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined) {
    throw new Error(`skillset: multiple tests configured (${names.join(", ")}); pass a test name`);
  }
  const raw = tests[name];
  if (!isJsonRecord(raw)) throw new Error(`skillset: expected ${configPath}.tests.${name} to be an object`);

  return readTestObject(raw, `${configPath}.tests.${name}`, name, defaultTargets);
}

function readTestObject(
  record: JsonRecord,
  label: string,
  name: string,
  defaultTargets: readonly TargetName[]
): TestDeclaration {
  for (const key of Object.keys(record)) {
    if (key !== "activation" && key !== "assertions" && key !== "assert" && key !== "output" && key !== "source" && key !== "targets") {
      throw new Error(`skillset: unsupported test key ${key} in ${label}`);
    }
  }
  const source = readString(record, "source");
  if (source === undefined) throw new Error(`skillset: ${label}.source is required`);

  const targets = readTargets(record.targets, `${label}.targets`, defaultTargets);
  const assertions = readAssertions(record.assertions ?? record.assert, `${label}.assertions`);
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

  return { activationProbes, assertions, name, source, targets };
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

function readAssertions(value: JsonValue | undefined, label: string): readonly TestAssertion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`skillset: expected ${label} to be a non-empty array`);
  }
  return value.map((item, index) => readAssertion(item, `${label}[${index}]`));
}

function readAssertion(value: JsonValue, label: string): TestAssertion {
  if (value === "build") return { kind: "build" };
  if (value === "noDrift") return { kind: "noDrift" };
  if (!isJsonRecord(value)) throw new Error(`skillset: expected ${label} to be build, noDrift, exists, or contains`);

  const existsPath = readString(value, "exists");
  if (existsPath !== undefined) return { kind: "exists", path: existsPath };

  const contains = value.contains;
  if (isJsonRecord(contains)) {
    const path = readString(contains, "path");
    const text = readString(contains, "text");
    if (path === undefined || text === undefined) {
      throw new Error(`skillset: ${label}.contains requires path and text`);
    }
    return { kind: "contains", path, text };
  }

  throw new Error(`skillset: expected ${label} to be build, noDrift, exists, or contains`);
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

function assertionRecord(assertion: SkillsetTestAssertionResult): JsonRecord {
  return {
    ...(assertion.detail === undefined ? {} : { detail: assertion.detail }),
    kind: assertion.kind,
    ok: assertion.ok,
    ...(assertion.path === undefined ? {} : { path: assertion.path }),
  };
}

async function runAssertion(
  workspacePath: string,
  assertion: TestAssertion,
  options: SkillsetOptions
): Promise<SkillsetTestAssertionResult> {
  if (assertion.kind === "exists") {
    const targetPath = resolveInside(workspacePath, assertion.path);
    const exists = await pathExists(targetPath);
    return {
      kind: "exists",
      ok: exists,
      path: assertion.path,
      ...(exists ? {} : { detail: "path does not exist" }),
    };
  }

  if (assertion.kind === "contains") {
    const targetPath = resolveInside(workspacePath, assertion.path);
    try {
      const content = await readFile(targetPath, "utf8");
      const ok = content.includes(assertion.text);
      return {
        kind: "contains",
        ok,
        path: assertion.path,
        ...(ok ? {} : { detail: "text was not found" }),
      };
    } catch (error) {
      return { detail: messageFor(error), kind: "contains", ok: false, path: assertion.path };
    }
  }

  if (assertion.kind === "noDrift") {
    const drift = await diffSkillset(workspacePath, options);
    const count = drift.added.length + drift.changed.length + drift.missing.length + drift.removed.length;
    return {
      kind: "noDrift",
      ok: count === 0,
      ...(count === 0 ? {} : { detail: `${drift.added.length} added, ${drift.changed.length} changed, ${drift.missing.length} missing, ${drift.removed.length} removed` }),
    };
  }

  return { kind: "build", ok: true };
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
  report: JsonRecord,
  rootPath: string
): Promise<void> {
  await rm(latestPath, { force: true, recursive: true });
  await cp(runPath, latestPath, { recursive: true });
  const latest = {
    name: report.name,
    ok: report.ok,
    reportPath: relative(rootPath, join(latestPath, "report.json")),
    runId: report.runId,
    runPath: relative(rootPath, runPath),
    schemaVersion: TEST_SCHEMA,
    source: report.source,
    workspacePath: relative(rootPath, join(latestPath, "workspace")),
  };
  await writeFile(join(buildRoot, "latest.json"), renderValidatedJson(latest, relative(rootPath, join(buildRoot, "latest.json"))), "utf8");
}

function renderMarkdownReport(report: JsonRecord): string {
  const assertions = Array.isArray(report.assertions) ? report.assertions : [];
  const lines = [
    `# Skillset Test ${report.name}`,
    "",
    `Status: ${report.ok === true ? "passed" : "failed"}`,
    `Run: ${report.runId}`,
    `Source: ${report.source}`,
    `Generated files: ${report.generatedFiles}`,
    `Activation probes: ${activationProbeCount(report)}`,
    "",
    "## Assertions",
    "",
  ];
  for (const assertion of assertions) {
    if (!isJsonRecord(assertion)) continue;
    const mark = assertion.ok === true ? "pass" : "fail";
    const path = typeof assertion.path === "string" ? ` ${assertion.path}` : "";
    const detail = typeof assertion.detail === "string" ? ` - ${assertion.detail}` : "";
    lines.push(`- ${mark}: ${assertion.kind}${path}${detail}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
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
  const ignoredSourceBuildPath = resolveInside(graph.rootPath, sourceBuildRoot(graph.sourceDir));
  if (graph.sourceDir !== ".") {
    await cp(graph.sourcePath, join(stagingWorkspacePath, graph.sourceDir), {
      filter: (path) => !isSameOrInside(ignoredSourceBuildPath, path),
      recursive: true,
    });
    return;
  }

  await copyIfExists(graph.rootConfigPath, join(stagingWorkspacePath, "skillset.yaml"));
  await copyIfExists(graph.sourceRootPath, join(stagingWorkspacePath, graph.sourceRoot));
  await copyIfExists(resolveInside(graph.rootPath, "changes"), join(stagingWorkspacePath, "changes"));
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
  const ignoredSourceBuildPath = resolveInside(rootPath, sourceBuildRoot(sourceDir));
  for (const item of lock.items) {
    if (!isJsonRecord(item) || !Array.isArray(item.files)) continue;
    for (const file of item.files) {
      if (typeof file !== "string") continue;
      const sourcePath = resolveInside(rootPath, file);
      if (isSameOrInside(ignoredSourceBuildPath, sourcePath)) continue;
      await copyIfExists(sourcePath, join(stagingWorkspacePath, file));
    }
  }
}

function testBuildRoot(sourceDir: string): string {
  return sourceDir === "." ? join(".skillset", TEST_BUILD_DIR) : join(sourceDir, TEST_BUILD_DIR);
}

function sourceBuildRoot(sourceDir: string): string {
  return sourceDir === "." ? ".skillset/build" : join(sourceDir, "build");
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

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
