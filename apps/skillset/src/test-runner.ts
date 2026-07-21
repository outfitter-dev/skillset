import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderValidatedJson } from "@skillset/core/internal/structured-output";
import {
  evaluateSkillsetTestRuntime,
  evaluateSkillsetTestWorkspace,
  listEnabledSkillsetTestTargets,
  listSkillsetTestDeclarations,
  loadSkillsetTestDeclaration,
  loadSkillsetTestEvaluationContext,
  runtimeRenderFailures,
  skillsetTestSelectionRecord,
  slugifySkillsetTestProbeName,
  stageSkillsetTestWorkspace,
  type SkillsetActivationProbe,
  type SkillsetRuntimeProbeRequest,
  type SkillsetRuntimeTestResult as CoreSkillsetRuntimeTestResult,
  type SkillsetTestCheckResult as CoreSkillsetTestCheckResult,
  type SkillsetTestDeclaration,
  type SkillsetTestSelectionReport as CoreSkillsetTestSelectionReport,
} from "@skillset/core/internal/test-evaluation";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";
import { isJsonRecord } from "@skillset/core/internal/yaml";

import {
  makeRetainedRunId,
  retainedRunPaths,
  writeRetainedRunLatest,
  type RetainedRunPaths,
} from "./retained-runs";
import {
  readTryEvidence,
  readTryStatus,
  startTryRun,
  type TryState,
} from "./try";

const TEST_BUILD_DIR = "cache/tests";
const TEST_SCHEMA = 3;

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
  readonly runtimeTests: readonly SkillsetRuntimeTestResult[];
  readonly source: string;
  readonly targets: readonly TargetName[];
  readonly workspacePath: string;
}

export interface SkillsetTestOptions extends SkillsetOptions {
  readonly runtimeEnv?: Record<string, string | undefined>;
}

export interface SkillsetTestSummary {
  readonly name: string;
  readonly targets: readonly TargetName[];
}

export interface SkillsetTestSuiteReport {
  readonly ok: boolean;
  readonly reports: readonly SkillsetTestReport[];
}

export type SkillsetRuntimeAssertionResult =
  CoreSkillsetRuntimeTestResult["assertions"][number];
export type SkillsetRuntimeFailureClass =
  CoreSkillsetRuntimeTestResult["failureClass"];
export type SkillsetTestCheckResult = CoreSkillsetTestCheckResult;
export type SkillsetTestSelectionReport = CoreSkillsetTestSelectionReport;

export interface SkillsetRuntimeTestResult extends JsonRecord {
  readonly assertions: SkillsetRuntimeAssertionResult[];
  readonly command: string[];
  readonly detail?: string;
  readonly failureClass?: SkillsetRuntimeFailureClass;
  readonly name: string;
  readonly ok: boolean;
  readonly outputPath?: string;
  readonly promptPath?: string;
  readonly promptProvenance: string;
  readonly reportPath?: string;
  readonly runId?: string;
  readonly runPath?: string;
  readonly state: TryState;
  readonly target: TargetName;
}

function testBuildRoot(_sourceDir: string): string {
  return join(".skillset", TEST_BUILD_DIR);
}

export async function runSkillsetTest(
  rootPath: string,
  name: string | undefined,
  options: SkillsetTestOptions = {}
): Promise<SkillsetTestReport> {
  const { declaration, graph } = await loadSkillsetTestDeclaration(
    rootPath,
    name,
    options
  );
  return runLoadedSkillsetTest(rootPath, graph, declaration, options);
}

export async function runAllSkillsetTests(
  rootPath: string,
  options: SkillsetTestOptions = {}
): Promise<SkillsetTestSuiteReport> {
  const { declarations, graph } = await loadSkillsetTestEvaluationContext(
    rootPath,
    options
  );
  if (declarations.length === 0) {
    throw new Error(
      `skillset: ${graph.sourceRoot} must include tests.yaml or tests/*.yaml for skillset test`
    );
  }
  const reports: SkillsetTestReport[] = [];
  for (const declaration of declarations) {
    reports.push(
      await runLoadedSkillsetTest(rootPath, graph, declaration, options)
    );
  }
  return { ok: reports.every((report) => report.ok), reports };
}

async function runLoadedSkillsetTest(
  rootPath: string,
  graph: BuildGraph,
  declaration: SkillsetTestDeclaration,
  options: SkillsetTestOptions
): Promise<SkillsetTestReport> {
  const sourceDir = graph.sourceDir;
  const buildOptions: SkillsetOptions = {
    buildMode: "all",
    ...(options.distDir === undefined ? {} : { distDir: options.distDir }),
    sourceDir,
    targetFilter: declaration.targets,
  };

  const runId = makeRetainedRunId(declaration.name);
  const logicalBuildRoot = testBuildRoot(sourceDir);
  const paths = retainedRunPaths(
    rootPath,
    graph,
    logicalBuildRoot,
    runId,
    options.xdg
  );
  const buildRoot = paths.absolute.rootPath;
  const runPath = paths.absolute.runPath;
  const workspacePath = join(runPath, "workspace");
  const logicalRunPath = paths.logical.runPath;
  const logicalWorkspacePath = join(logicalRunPath, "workspace").replaceAll(
    "\\",
    "/"
  );
  const stagingRoot = await mkdtemp(join(tmpdir(), "skillset-test-"));
  const stagingWorkspacePath = join(stagingRoot, "workspace");

  try {
    await mkdir(stagingWorkspacePath, { recursive: true });
    await stageSkillsetTestWorkspace(
      rootPath,
      graph,
      declaration,
      stagingWorkspacePath
    );
    const evaluation = await evaluateSkillsetTestWorkspace(
      stagingWorkspacePath,
      graph,
      declaration,
      buildOptions
    );

    await mkdir(runPath, { recursive: true });
    await cp(stagingWorkspacePath, workspacePath, { recursive: true });
    const activationPath = await writeActivationProbes(runPath, declaration);
    const logicalActivationPath =
      activationPath === undefined
        ? undefined
        : join(logicalRunPath, "activation").replaceAll("\\", "/");

    const runtimeTests =
      evaluation.buildError !== undefined
        ? runtimeRenderFailures(declaration, evaluation.buildError).map(
            (result) => toSkillsetRuntimeTestResult(result)
          )
        : evaluation.ok
          ? await runDeclaredRuntimeTests(
              rootPath,
              workspacePath,
              declaration,
              options
            )
          : [];
    const checks = evaluation.checks;
    const ok = evaluation.ok && runtimeTests.every((result) => result.ok);
    const reportPath = join(runPath, "report.json");
    const reportMarkdownPath = join(runPath, "report.md");
    const latestPath = join(buildRoot, "latest");
    const logicalLatestPath = join(logicalBuildRoot, "latest").replaceAll(
      "\\",
      "/"
    );
    const activationReport =
      activationPath === undefined
        ? {}
        : {
            activation: {
              path: logicalActivationPath,
              probes: declaration.activationProbes.length,
            },
          };
    const report: JsonRecord = {
      checks: checks.map(checkRecord),
      generatedFiles: evaluation.generatedFiles,
      name: declaration.name,
      ok,
      runId,
      schemaVersion: TEST_SCHEMA,
      selection: skillsetTestSelectionRecord(declaration.selection),
      source: `repo:${sourceDir}`,
      targets: [...declaration.targets],
      ...activationReport,
      runtimeTests: [...runtimeTests],
      workspacePath: logicalWorkspacePath,
    };

    await writeFile(
      reportPath,
      renderValidatedJson(report, join(logicalRunPath, "report.json")),
      "utf8"
    );
    await writeFile(reportMarkdownPath, renderMarkdownReport(report), "utf8");
    await refreshLatest(paths, latestPath, logicalLatestPath, report);

    return {
      ...(logicalActivationPath === undefined
        ? {}
        : { activationPath: logicalActivationPath }),
      activationProbes: declaration.activationProbes.length,
      checks,
      generatedFiles: evaluation.generatedFiles,
      latestPath: logicalLatestPath,
      name: declaration.name,
      ok,
      reportMarkdownPath: join(logicalRunPath, "report.md").replaceAll(
        "\\",
        "/"
      ),
      reportPath: join(logicalRunPath, "report.json").replaceAll("\\", "/"),
      runId,
      selection: skillsetTestSelectionRecord(declaration.selection),
      runPath: logicalRunPath,
      runtimeTests,
      source: `repo:${sourceDir}`,
      targets: declaration.targets,
      workspacePath: logicalWorkspacePath,
    };
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

export async function listSkillsetTests(
  rootPath: string,
  options: SkillsetTestOptions = {}
): Promise<readonly SkillsetTestSummary[]> {
  return listSkillsetTestDeclarations(rootPath, options);
}

export async function listAdHocTestTargets(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly TargetName[]> {
  return listEnabledSkillsetTestTargets(rootPath, options);
}

function checkRecord(check: SkillsetTestCheckResult): JsonRecord {
  return {
    ...(check.detail === undefined ? {} : { detail: check.detail }),
    kind: check.kind,
    ok: check.ok,
    ...(check.path === undefined ? {} : { path: check.path }),
  };
}

async function runDeclaredRuntimeTests(
  rootPath: string,
  workspacePath: string,
  declaration: SkillsetTestDeclaration,
  options: SkillsetTestOptions
): Promise<readonly SkillsetRuntimeTestResult[]> {
  const evidenceByProbe = new Map<
    string,
    {
      readonly outputPath: string;
      readonly promptPath: string;
      readonly reportPath: string;
      readonly runId: string;
      readonly runPath: string;
      readonly state: TryState;
    }
  >();
  const keyFor = (
    request: Pick<SkillsetRuntimeProbeRequest, "name" | "target">
  ): string => `${request.name}\0${request.target}`;

  const runtimeTests = await evaluateSkillsetTestRuntime(
    workspacePath,
    declaration,
    options,
    {
      run: async (request) => {
        const run = await startTryRun(workspacePath, {
          cacheRootPath: rootPath,
          ...(request.claudeSettingSources === undefined
            ? {}
            : { claudeSettingSources: request.claudeSettingSources }),
          ...(options.runtimeEnv === undefined
            ? {}
            : { env: options.runtimeEnv }),
          name: request.name,
          prompt: request.prompt,
          target: request.target,
          ...(request.timeoutMs === undefined
            ? {}
            : { timeoutMs: request.timeoutMs }),
          ...(options.xdg === undefined ? {} : { xdg: options.xdg }),
        });
        const status = await readTryStatus(rootPath, run.runId, options);
        const evidence = await readTryEvidence(rootPath, run.runId, options);
        evidenceByProbe.set(keyFor(request), {
          outputPath: evidence.outputPath,
          promptPath: status.promptPath,
          reportPath: evidence.reportPath,
          runId: run.runId,
          runPath: run.runPath,
          state: status.state,
        });
        return {
          command: status.command ?? [],
          ...(status.error === undefined ? {} : { detail: status.error }),
          ...(status.failureClass === undefined
            ? {}
            : { failureClass: status.failureClass }),
          response: evidence.response,
          state: status.state === "passed" ? "passed" : "failed",
        };
      },
    }
  );

  return runtimeTests.map((result) => {
    const evidence = evidenceByProbe.get(
      `${declaration.name}-${slugifySkillsetTestProbeName(result.name)}-${result.target}\0${result.target}`
    );
    return toSkillsetRuntimeTestResult(result, evidence);
  });
}

function toSkillsetRuntimeTestResult(
  result: CoreSkillsetRuntimeTestResult,
  evidence?: {
    readonly outputPath: string;
    readonly promptPath: string;
    readonly reportPath: string;
    readonly runId: string;
    readonly runPath: string;
    readonly state: TryState;
  }
): SkillsetRuntimeTestResult {
  return {
    assertions: [...result.assertions],
    command: [...result.command],
    ...(result.detail === undefined ? {} : { detail: result.detail }),
    ...(result.failureClass === undefined
      ? {}
      : { failureClass: result.failureClass }),
    name: result.name,
    ok: result.ok,
    ...(evidence === undefined
      ? {}
      : {
          outputPath: evidence.outputPath,
          promptPath: evidence.promptPath,
          reportPath: evidence.reportPath,
          runId: evidence.runId,
          runPath: evidence.runPath,
        }),
    promptProvenance: result.promptProvenance,
    state: evidence?.state ?? (result.state === "passed" ? "passed" : "failed"),
    target: result.target,
  };
}

async function writeActivationProbes(
  runPath: string,
  declaration: SkillsetTestDeclaration
): Promise<string | undefined> {
  if (declaration.activationProbes.length === 0) return undefined;
  const activationRoot = join(runPath, "activation");
  for (const target of declaration.targets) {
    const probes = declaration.activationProbes.filter((probe) =>
      probe.targets.includes(target)
    );
    if (probes.length === 0) continue;
    const targetRoot = join(activationRoot, target);
    await mkdir(targetRoot, { recursive: true });
    const records = probes.map((probe) => activationProbeRecord(probe, target));
    await writeFile(
      join(targetRoot, "probes.json"),
      renderValidatedJson(
        {
          probes: records,
          schemaVersion: TEST_SCHEMA,
          target,
        },
        `activation ${target} probes`
      ),
      "utf8"
    );
    for (const record of records) {
      const name = typeof record.name === "string" ? record.name : "probe";
      await writeFile(
        join(targetRoot, `${name}.md`),
        renderActivationProbeMarkdown(record),
        "utf8"
      );
    }
  }
  return activationRoot;
}

const ACTIVATION_HARNESSES = {
  claude:
    "Manual Claude activation probe. Run against the generated workspace or plugin path and confirm the expected source unit is loaded or invoked.",
  codex:
    "Manual Codex activation probe. Use generated Codex output or plugin-eval tooling when available; compatibility shims should be reported explicitly.",
  cursor:
    "Manual Cursor activation probe. Run against the generated workspace or plugin path and confirm the expected source unit is loaded or invoked.",
} satisfies Readonly<Record<TargetName, string>>;

const ACTIVATION_STATUSES = {
  claude: "manual-native",
  codex: "manual-shimmed",
  cursor: "manual-native",
} satisfies Readonly<Record<TargetName, "manual-native" | "manual-shimmed">>;

function activationProbeRecord(
  probe: SkillsetActivationProbe,
  target: TargetName
): JsonRecord {
  return {
    execution: probe.runtime === undefined ? "manual" : "live",
    expect: {
      [probe.expect.kind]: probe.expect.name,
    },
    harness: activationHarness(target),
    name: slugifySkillsetTestProbeName(probe.name),
    prompt: probe.prompt,
    promptProvenance: probe.promptProvenance,
    status: ACTIVATION_STATUSES[target],
    target,
  };
}

function activationHarness(target: TargetName): string {
  return ACTIVATION_HARNESSES[target];
}

function renderActivationProbeMarkdown(record: JsonRecord): string {
  const expect = isJsonRecord(record.expect)
    ? Object.entries(record.expect)
        .map(([kind, name]) => `- ${kind}: ${name}`)
        .join("\n")
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

async function refreshLatest(
  paths: RetainedRunPaths,
  latestPath: string,
  logicalLatestPath: string,
  report: JsonRecord
): Promise<void> {
  await rm(latestPath, { force: true, recursive: true });
  await cp(paths.absolute.runPath, latestPath, { recursive: true });
  const latest = {
    name: report.name,
    ok: report.ok,
    reportPath: join(logicalLatestPath, "report.json").replaceAll("\\", "/"),
    runId: report.runId,
    runPath: paths.logical.runPath,
    schemaVersion: TEST_SCHEMA,
    selection: report.selection,
    source: report.source,
    workspacePath: join(logicalLatestPath, "workspace").replaceAll("\\", "/"),
  };
  await writeRetainedRunLatest(paths, latest);
}

function renderMarkdownReport(report: JsonRecord): string {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const runtimeTests = Array.isArray(report.runtimeTests)
    ? report.runtimeTests
    : [];
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
  if (runtimeTests.length > 0) {
    lines.push("", "## Runtime Tests", "");
    for (const runtimeTest of runtimeTests) {
      if (!isJsonRecord(runtimeTest)) continue;
      const mark = runtimeTest.ok === true ? "pass" : "fail";
      const failureClass =
        typeof runtimeTest.failureClass === "string"
          ? ` (${runtimeTest.failureClass})`
          : "";
      const detail =
        typeof runtimeTest.detail === "string"
          ? ` - ${runtimeTest.detail}`
          : "";
      lines.push(
        `- ${mark}: ${runtimeTest.name} [${runtimeTest.target}]${failureClass}${detail}`
      );
      if (typeof runtimeTest.outputPath === "string")
        lines.push(`  - output: ${runtimeTest.outputPath}`);
      if (typeof runtimeTest.reportPath === "string")
        lines.push(`  - report: ${runtimeTest.reportPath}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function selectionMarkdownLines(
  value: JsonValue | undefined
): readonly string[] {
  if (!isJsonRecord(value)) return ["Selection: none"];
  const agents = readSelectionList(value.agents);
  const plugins = readSelectionList(value.plugins);
  const primarySkills = readSelectionList(value.primarySkills);
  const pluginSkills = readSelectionList(value.pluginSkills);
  const parts = [
    agents.length === 0 ? undefined : `agents ${agents.join(", ")}`,
    plugins.length === 0 ? undefined : `plugins ${plugins.join(", ")}`,
    primarySkills.length === 0
      ? undefined
      : `primary skills ${primarySkills.join(", ")}`,
    pluginSkills.length === 0
      ? undefined
      : `plugin skills ${pluginSkills.join(", ")}`,
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
