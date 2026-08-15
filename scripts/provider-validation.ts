import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  listProviderValidationLanes,
  type ProviderValidationLaneId,
} from "../packages/registry/src/provider-validation";
import {
  assertContained,
  assertPathHasNoSymlinks,
  enumerateProviderArtifacts,
  type ProviderArtifactInventory,
} from "./provider-validation-artifacts";
import {
  acquireTools,
  stageValidationInputs,
  type ToolPaths,
} from "./provider-validation-hosted";

export { enumerateProviderArtifacts } from "./provider-validation-artifacts";
export type { ProviderArtifactInventory } from "./provider-validation-artifacts";

export interface ValidationCommand {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly expect: "failure" | "success";
  readonly lane: ProviderValidationLaneId;
  readonly subject: string;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ProviderValidationReportRow {
  readonly count: number;
  readonly lane: ProviderValidationLaneId;
  readonly result: "failed" | "not-run" | "passed";
  readonly surface: string;
  readonly targets: string;
}

export interface ProviderValidationReport {
  readonly failures: readonly {
    readonly diagnostic: string;
    readonly lane: ProviderValidationLaneId | "all";
    readonly stage: "acquisition" | "inventory" | "staging" | "validation";
  }[];
  readonly limitations: readonly {
    readonly lane: ProviderValidationLaneId;
    readonly text: string;
  }[];
  readonly ok: boolean;
  readonly rows: readonly ProviderValidationReportRow[];
}

type CommandRunner = (command: ValidationCommand) => Promise<CommandResult>;

export function buildValidationCommands(
  inventory: ProviderArtifactInventory,
  tools: ToolPaths,
  staged: {
    readonly agentCanary: string;
    readonly claudeCanary: string;
    readonly cursorCanary: string;
    readonly cursorRoots: readonly string[];
    readonly codexCanary: string;
    readonly environment?: Readonly<Record<string, string>>;
  }
): readonly ValidationCommand[] {
  const offlineEnv = {
    ...staged.environment,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    npm_config_offline: "true",
    PIP_NO_INDEX: "1",
    UV_OFFLINE: "1",
  };
  return [
    ...inventory.claudePlugins.map((path) =>
      command(
        "claude-product",
        ["node", tools.claude, "plugin", "validate", path, "--strict"],
        path,
        offlineEnv,
        "success",
        path
      )
    ),
    ...inventory.claudeMarketplaces.map((path) =>
      command(
        "claude-product",
        ["node", tools.claude, "plugin", "validate", path, "--strict"],
        path,
        offlineEnv,
        "success",
        dirname(path)
      )
    ),
    command(
      "claude-product",
      [
        "node",
        tools.claude,
        "plugin",
        "validate",
        staged.claudeCanary,
        "--strict",
      ],
      "negative canary",
      offlineEnv,
      "failure",
      staged.claudeCanary
    ),
    ...inventory.codexPlugins.map((path) =>
      command(
        "codex-authoring",
        [tools.codexPython, tools.codexValidator, path],
        path,
        offlineEnv,
        "success",
        path
      )
    ),
    command(
      "codex-authoring",
      [tools.codexPython, tools.codexValidator, staged.codexCanary],
      "negative canary",
      offlineEnv,
      "failure",
      staged.codexCanary
    ),
    ...staged.cursorRoots.map((path) =>
      command(
        "cursor-authoring",
        ["node", join(path, "scripts/validate-plugins.mjs")],
        path,
        offlineEnv,
        "success",
        path
      )
    ),
    command(
      "cursor-authoring",
      ["node", join(staged.cursorCanary, "scripts/validate-plugins.mjs")],
      "negative canary",
      offlineEnv,
      "failure",
      staged.cursorCanary
    ),
    ...inventory.skills.map((path) =>
      command(
        "agent-skills-reference",
        [
          "uv",
          "run",
          "--offline",
          "--frozen",
          "--no-sync",
          "--project",
          tools.agentSkills,
          "skills-ref",
          "validate",
          dirname(path),
        ],
        path,
        offlineEnv,
        "success",
        dirname(path)
      )
    ),
    command(
      "agent-skills-reference",
      [
        "uv",
        "run",
        "--offline",
        "--frozen",
        "--no-sync",
        "--project",
        tools.agentSkills,
        "skills-ref",
        "validate",
        staged.agentCanary,
      ],
      "negative canary",
      offlineEnv,
      "failure",
      staged.agentCanary
    ),
  ];
}

export async function executeValidationCommands(
  commands: readonly ValidationCommand[],
  runner: CommandRunner
): Promise<ProviderValidationReport> {
  const failures: string[] = [];
  const status = new Map<ProviderValidationLaneId, boolean>();
  for (const lane of listProviderValidationLanes()) status.set(lane.id, true);
  for (const item of commands) {
    let result: CommandResult;
    try {
      result = await runner(item);
    } catch (error) {
      status.set(item.lane, false);
      failures.push(`${item.lane} ${item.subject}: ${message(error)}`);
      continue;
    }
    const passed =
      item.expect === "success" ? result.exitCode === 0 : result.exitCode !== 0;
    if (!passed) {
      status.set(item.lane, false);
      failures.push(
        `${item.lane} ${item.subject}: expected ${item.expect}, exit ${result.exitCode}; ${result.stderr.trim() || result.stdout.trim()}`
      );
    }
  }
  const counts = countCommands(commands);
  const rows = listProviderValidationLanes().map((lane) => ({
    count: counts.get(lane.id) ?? 0,
    lane: lane.id,
    result:
      status.get(lane.id) === true ? ("passed" as const) : ("failed" as const),
    surface: lane.coveredSurfaces.join(", "),
    targets: lane.targets.join(", "),
  }));
  const boundedFailures = failures.map(boundedDiagnostic);
  const report = {
    failures: boundedFailures.map((diagnostic) => ({
      diagnostic,
      lane: diagnostic.split(" ", 1)[0] as ProviderValidationLaneId,
      stage: "validation" as const,
    })),
    limitations: listProviderValidationLanes().flatMap((lane) =>
      [
        ...lane.limitations,
        `Internal conformance fallback: ${lane.fallback.surfaces.join(", ")} (${lane.fallback.refs.join(", ")}).`,
      ].map((text) => ({ lane: lane.id, text }))
    ),
    ok: failures.length === 0,
    rows,
  } satisfies ProviderValidationReport;
  if (failures.length > 0) {
    throw new ProviderValidationFailure(report, boundedFailures);
  }
  return report;
}

export class ProviderValidationFailure extends Error {
  constructor(
    readonly report: ProviderValidationReport,
    readonly failures: readonly string[]
  ) {
    super(
      [
        "skillset: hosted provider validation failed",
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n")
    );
  }
}

export function renderProviderValidationReport(
  report: ProviderValidationReport
): string {
  return [
    "# Hosted provider validation",
    "",
    "| Lane | Targets | Covered surface | Count | Result |",
    "| --- | --- | --- | ---: | --- |",
    ...report.rows.map(
      (row) =>
        `| ${row.lane} | ${row.targets} | ${row.surface} | ${row.count} | ${row.result} |`
    ),
    ...(report.failures.length === 0
      ? []
      : [
          "",
          "## Failure evidence",
          "",
          ...report.failures.map(
            (item) => `- **${item.stage} / ${item.lane}:** ${item.diagnostic}`
          ),
        ]),
    "",
    "## Limitations and internal fallback",
    "",
    ...report.limitations.map((item) => `- **${item.lane}:** ${item.text}`),
    "",
  ].join("\n");
}

export async function runHostedProviderValidation(
  root: string,
  reportPath: string
): Promise<ProviderValidationReport> {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error(
      "skillset: provider validation is hosted-only and requires GITHUB_ACTIONS=true"
    );
  }
  const runnerTemp = process.env.RUNNER_TEMP;
  if (runnerTemp === undefined)
    throw new Error("skillset: provider validation requires RUNNER_TEMP");
  const canonicalRunnerTemp = await realpath(runnerTemp);
  const canonicalReportParent = await realpath(dirname(resolve(reportPath)));
  await assertContained(canonicalRunnerTemp, canonicalReportParent);
  await assertPathHasNoSymlinks(canonicalRunnerTemp, canonicalReportParent);
  await rejectExistingReportSymlink(reportPath);
  let temp: string | undefined;
  let report: ProviderValidationReport | undefined;
  let failure: unknown;
  let stage: ProviderValidationReport["failures"][number]["stage"] =
    "inventory";
  try {
    temp = await mkdtemp(
      join(canonicalRunnerTemp, "skillset-provider-validation-")
    );
    const inventory = await enumerateProviderArtifacts(root);
    stage = "acquisition";
    const tools = await acquireTools(temp);
    stage = "staging";
    const staged = await stageValidationInputs(root, temp, inventory, tools);
    stage = "validation";
    try {
      report = await executeValidationCommands(
        buildValidationCommands(staged.inventory, tools, staged),
        spawnCommand
      );
    } catch (error) {
      if (error instanceof ProviderValidationFailure) report = error.report;
      throw error;
    }
  } catch (error) {
    failure = error;
    report ??= createFailedReport(stage, message(error));
  } finally {
    try {
      if (report !== undefined) {
        report = normalizeProviderValidationReport(report, [
          [canonicalRunnerTemp, "$RUNNER_TEMP"],
          [resolve(root), "$CHECKOUT"],
          ...(temp === undefined
            ? []
            : ([[temp, "$VALIDATION_TEMP"]] as const)),
        ]);
        await writeReportAtomic(
          reportPath,
          renderProviderValidationReport(report)
        );
      }
    } finally {
      if (temp !== undefined) await rm(temp, { force: true, recursive: true });
    }
  }
  if (failure !== undefined) {
    if (failure instanceof Error) throw failure;
    throw new Error(message(failure));
  }
  if (report === undefined)
    throw new Error("skillset: provider validation produced no report");
  return report;
}

async function spawnCommand(item: ValidationCommand): Promise<CommandResult> {
  const child = Bun.spawn(
    [...buildNetworkIsolatedArgv(item, process.getuid?.(), process.getgid?.())],
    {
      cwd: item.cwd,
      env: { PATH: "/usr/bin:/bin" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
}

export function buildNetworkIsolatedArgv(
  item: ValidationCommand,
  uid: number | undefined,
  gid: number | undefined
): readonly [string, ...string[]] {
  if (uid === undefined || gid === undefined)
    throw new Error(
      "skillset: hosted provider validation requires POSIX user identifiers"
    );
  const environment = {
    CI: "1",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    ...item.env,
  };
  return [
    "/usr/bin/sudo",
    "--non-interactive",
    "/usr/bin/unshare",
    "--net",
    `--setuid=${uid}`,
    `--setgid=${gid}`,
    "--",
    "/usr/bin/env",
    "-i",
    ...Object.entries(environment)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
    ...item.argv,
  ];
}

async function rejectExistingReportSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(
        `skillset: provider validation rejects symlink report target ${path}`
      );
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

async function writeReportAtomic(
  path: string,
  contents: string
): Promise<void> {
  await rejectExistingReportSymlink(path);
  const temporaryDirectory = await mkdtemp(
    join(dirname(path), ".skillset-provider-report-")
  );
  const temporary = join(temporaryDirectory, "report.md");
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rejectExistingReportSymlink(path);
    await rename(temporary, path);
  } catch (error) {
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export function normalizeProviderValidationReport(
  report: ProviderValidationReport,
  replacements: readonly (readonly [string, string])[]
): ProviderValidationReport {
  const orderedReplacements = [...replacements].toSorted(
    ([left], [right]) => right.length - left.length
  );
  return {
    ...report,
    failures: report.failures.map((failure) => ({
      ...failure,
      diagnostic: orderedReplacements.reduce(
        (value, [source, replacement]) => value.replaceAll(source, replacement),
        failure.diagnostic
      ),
    })),
  };
}

function command(
  lane: ProviderValidationLaneId,
  argv: readonly [string, ...string[]],
  subject: string,
  env: Readonly<Record<string, string>>,
  expect: ValidationCommand["expect"],
  cwd: string
): ValidationCommand {
  return {
    argv,
    cwd,
    env,
    expect,
    lane,
    subject,
  };
}

function countCommands(
  commands: readonly ValidationCommand[]
): Map<ProviderValidationLaneId, number> {
  const counts = new Map<ProviderValidationLaneId, number>();
  for (const item of commands) {
    if (item.expect === "failure") continue;
    counts.set(item.lane, (counts.get(item.lane) ?? 0) + 1);
  }
  return counts;
}

function createFailedReport(
  stage: ProviderValidationReport["failures"][number]["stage"],
  diagnostic: string
): ProviderValidationReport {
  return {
    failures: [
      {
        diagnostic: boundedDiagnostic(diagnostic),
        lane: "all",
        stage,
      },
    ],
    limitations: listProviderValidationLanes().flatMap((lane) =>
      [
        ...lane.limitations,
        `Internal conformance fallback: ${lane.fallback.surfaces.join(", ")} (${lane.fallback.refs.join(", ")}).`,
      ].map((text) => ({ lane: lane.id, text }))
    ),
    ok: false,
    rows: listProviderValidationLanes().map((lane) => ({
      count: 0,
      lane: lane.id,
      result: "not-run",
      surface: lane.coveredSurfaces.join(", "),
      targets: lane.targets.join(", "),
    })),
  };
}

function boundedDiagnostic(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 3 || args[0] !== "run" || args[1] !== "--report") {
    throw new Error(
      "skillset: expected provider-validation run --report <path>"
    );
  }
  const report = await runHostedProviderValidation(
    process.cwd(),
    resolve(args[2]!)
  );
  process.stdout.write(renderProviderValidationReport(report));
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(message(error));
    process.exitCode = 1;
  });
}
