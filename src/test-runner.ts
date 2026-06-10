import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { buildSkillset, diffSkillset } from "./build";
import { readCompileTargets, readString, resolveTargets, targetNames } from "./config";
import { compareStrings, resolveInside } from "./path";
import { renderValidatedJson } from "./structured-output";
import type { JsonRecord, JsonValue, SkillsetOptions, TargetName } from "./types";
import { isJsonRecord, parseYamlRecord } from "./yaml";

const DEFAULT_SOURCE_DIR = ".skillset";
const TEST_BUILD_DIR = "build/tests";
const TEST_SCHEMA = 1;

export interface SkillsetTestReport {
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

export async function runSkillsetTest(
  rootPath: string,
  name: string | undefined,
  options: SkillsetOptions = {}
): Promise<SkillsetTestReport> {
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const declaration = await readTestDeclaration(rootPath, sourceDir, name);
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
  const buildRoot = resolveInside(rootPath, join(sourceDir, TEST_BUILD_DIR));
  const runsRoot = join(buildRoot, "runs");
  const runPath = join(runsRoot, runId);
  const workspacePath = join(runPath, "workspace");
  const stagingRoot = await mkdtemp(join(tmpdir(), "skillset-test-"));
  const stagingWorkspacePath = join(stagingRoot, "workspace");
  const stagingSourcePath = join(stagingWorkspacePath, sourceDir);
  const sourcePath = resolveInside(rootPath, sourceDir);
  const workspaceLockPath = resolveInside(rootPath, ".skillset.lock");
  const ignoredSourceBuildPath = resolveInside(rootPath, join(sourceDir, "build"));

  try {
    await mkdir(stagingWorkspacePath, { recursive: true });
    await cp(sourcePath, stagingSourcePath, {
      filter: (path) => !isSameOrInside(ignoredSourceBuildPath, path),
      recursive: true,
    });
    // Source-adjacent generated projections need the workspace lock to remain recognized as managed.
    await copyIfExists(workspaceLockPath, join(stagingWorkspacePath, ".skillset.lock"));
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

    await mkdir(runPath, { recursive: true });
    await cp(stagingWorkspacePath, workspacePath, { recursive: true });

    const ok = assertions.every((assertion) => assertion.ok);
    const reportPath = join(runPath, "report.json");
    const reportMarkdownPath = join(runPath, "report.md");
    const latestPath = join(buildRoot, "latest");
    const report: JsonRecord = {
      assertions: assertions.map(assertionRecord),
      generatedFiles,
      name: declaration.name,
      ok,
      runId,
      schemaVersion: TEST_SCHEMA,
      source: declaration.source,
      targets: [...declaration.targets],
      workspacePath: relative(rootPath, workspacePath),
    };

    await writeFile(reportPath, renderValidatedJson(report, relative(rootPath, reportPath)), "utf8");
    await writeFile(reportMarkdownPath, renderMarkdownReport(report), "utf8");
    await refreshLatest(buildRoot, runPath, latestPath, report, rootPath);

    return {
      assertions,
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

async function readTestDeclaration(rootPath: string, sourceDir: string, requestedName: string | undefined): Promise<TestDeclaration> {
  const configPath = resolveInside(rootPath, join(sourceDir, "config.yaml"));
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
    if (key !== "assertions" && key !== "assert" && key !== "output" && key !== "source" && key !== "targets") {
      throw new Error(`skillset: unsupported test key ${key} in ${label}`);
    }
  }
  const source = readString(record, "source");
  if (source === undefined) throw new Error(`skillset: ${label}.source is required`);

  const targets = readTargets(record.targets, `${label}.targets`, defaultTargets);
  const assertions = readAssertions(record.assertions ?? record.assert, `${label}.assertions`);
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

  return { assertions, name, source, targets };
}

function readTargets(value: JsonValue | undefined, label: string, defaultTargets: readonly TargetName[]): readonly TargetName[] {
  if (value === undefined) return defaultTargets;
  if (!Array.isArray(value)) throw new Error(`skillset: expected ${label} to be a string array`);
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
  await cp(sourcePath, targetPath);
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
  const ignoredSourceBuildPath = resolveInside(rootPath, join(sourceDir, "build"));
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
