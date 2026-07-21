#!/usr/bin/env bun
/**
 * Maintainer harness for external fixture repos: real published repos that
 * `skillset init --adopt all` should migrate cleanly, compile, and round-trip into
 * substantially similar generated output.
 *
 * The committed manifest (fixtures/external/repos.yaml) pins each repo to an
 * exact commit. Clones live gitignored under fixtures/external/repos/ and are
 * never scanned as this repo's own source. Runs are a thin wrapper over the
 * product command: each clone is adopted in place with adoptSkillset (survey,
 * imports, lint, isolated build under the logical .skillset/cache/latest/),
 * then the harness checks purity and round-trips and writes reports under the
 * logical .skillset/cache/fixtures/ path backed by the repo's XDG cache bucket.
 *
 *   bun scripts/fixtures/external.ts sync   [name]   # reset clones pristine at pinned refs
 *   bun scripts/fixtures/external.ts update [name]   # re-pin to upstream HEAD, then sync
 *   bun scripts/fixtures/external.ts run    [name]   # adopt -> purity -> round-trip report
 *
 * Run failures (init/import/lint/build/purity errors) exit non-zero. The
 * purity stage is the hard invariant: after a run, `git status` in the clone
 * may only show root skillset.yaml and paths under .skillset/ — anything else
 * is a toolchain defect.
 * The round-trip comparison is report-only for now; per-repo expectations can
 * harden into assertions once the numbers settle.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { adoptSkillset, type AdoptReport } from "../../apps/skillset/src/adopt";
import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import type { PluginAdoptionDiagnostic } from "../../apps/skillset/src/plugin-adoption";
import type {
  SetupImportCandidate,
  SurveySkip,
} from "../../apps/skillset/src/setup";
import { ISOLATED_OUT_ROOT } from "../../packages/core/src/build";
import { compareNormalizedOutputTrees } from "../../packages/core/src/normalized-output-tree";
import {
  createOperationalPathContext,
  type OperationalPathContext,
  resolveOperationalPath,
} from "../../packages/core/src/operational-cache";
import { compareStrings, validateSlug } from "../../packages/core/src/path";
import { pluginTargetRoot } from "../../packages/core/src/plugin-output";
import { loadBuildGraph } from "../../packages/core/src/resolver";
import { isTargetName, TARGET_LIST_TEXT } from "../../packages/core/src/targets";
import type { TargetName } from "../../packages/core/src/types";
import { parseYamlRecord } from "../../packages/core/src/yaml";

const MANIFEST_PATH = "fixtures/external/repos.yaml";
const CLONES_DIR = "fixtures/external/repos";
const REPORTS_DIR = ".skillset/cache/fixtures";
// .skillset and skillset.yaml are ignored because in-place adoption creates
// them inside the clone; they are harness material, not part of the original
// tree being round-tripped.
const COMPARISON_EXCLUDED_PATHS = [".DS_Store", "skillset.yaml"];
const COMPARISON_EXCLUDED_PREFIXES = [".git/", ".skillset/"];
const REPORT_LIST_CAP = 100;

export interface ExternalRepoEntry {
  readonly name: string;
  readonly notes?: string;
  readonly ref: string;
  readonly repo: string;
  readonly targets: readonly TargetName[];
}

export function parseExternalManifest(
  content: string,
  label: string
): readonly ExternalRepoEntry[] {
  const record = parseYamlRecord(content, label);
  const {repos} = record;
  if (!Array.isArray(repos)) {
    throw new TypeError(`skillset: expected ${label} to have a repos list`);
  }
  const entries: ExternalRepoEntry[] = [];
  const seen = new Set<string>();
  for (const raw of repos) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(
        `skillset: expected each ${label} repos entry to be a mapping`
      );
    }
    const entry = raw as Record<string, unknown>;
    const name = validateSlug(
      readManifestString(entry, "name", label),
      `${label} entry name`
    );
    const repo = readManifestString(entry, "repo", label);
    const ref = readManifestString(entry, "ref", label);
    if (!/^[0-9a-f]{40}$/u.test(ref)) {
      throw new Error(
        `skillset: ${label} entry ${name} must pin ref to a full 40-character commit SHA`
      );
    }
    if (seen.has(name)) {
      throw new Error(`skillset: ${label} has duplicate entry name ${name}`);
    }
    seen.add(name);
    const targets = readManifestTargets(entry, name, label);
    const {notes} = entry;
    if (notes !== undefined && typeof notes !== "string") {
      throw new Error(
        `skillset: ${label} entry ${name} notes must be a string`
      );
    }
    entries.push({
      name,
      ...(notes === undefined ? {} : { notes }),
      ref,
      repo,
      targets,
    });
  }
  return entries;
}

function readManifestString(
  entry: Record<string, unknown>,
  key: string,
  label: string
): string {
  const value = entry[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `skillset: expected each ${label} repos entry to have a non-empty ${key}`
    );
  }
  return value.trim();
}

function readManifestTargets(
  entry: Record<string, unknown>,
  name: string,
  label: string
): readonly TargetName[] {
  const raw = entry.targets;
  if (raw === undefined) {return ["claude"];}
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `skillset: ${label} entry ${name} targets must be a non-empty list`
    );
  }
  const targets: TargetName[] = [];
  for (const target of raw) {
    if (!isTargetName(target)) {
      throw new Error(
        `skillset: ${label} entry ${name} targets must be ${TARGET_LIST_TEXT}`
      );
    }
    targets.push(target);
  }
  return targets;
}

export function renderExternalManifest(
  entries: readonly ExternalRepoEntry[]
): string {
  const lines = [
    "# External fixture repos: real published repos Skillset should adopt cleanly.",
    "# Managed by scripts/fixtures/external.ts; `update` re-pins refs to upstream HEAD.",
    "repos:",
  ];
  for (const entry of entries) {
    lines.push(`  - name: ${entry.name}`);
    lines.push(`    repo: ${JSON.stringify(entry.repo)}`);
    lines.push(`    ref: ${entry.ref}`);
    if (entry.targets.length !== 1 || entry.targets[0] !== "claude") {
      lines.push(`    targets: [${entry.targets.join(", ")}]`);
    }
    if (entry.notes !== undefined) {
      lines.push(`    notes: ${JSON.stringify(entry.notes)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface TreeComparison {
  readonly different: readonly string[];
  readonly generatedOnly: readonly string[];
  readonly identical: readonly string[];
  readonly originalOnly: readonly string[];
}

/**
 * Compare an original tree against a generated tree by relative path and byte
 * equality. This is the report-only round-trip fidelity measure: it does not
 * judge which differences are acceptable, it only makes them visible.
 */
export async function compareTrees(
  originalRoot: string,
  generatedRoot: string
): Promise<TreeComparison> {
  const comparison = await compareNormalizedOutputTrees(originalRoot, generatedRoot, {
    excludePathPrefixes: COMPARISON_EXCLUDED_PREFIXES,
    excludePaths: COMPARISON_EXCLUDED_PATHS,
  });
  return {
    different: comparison.different,
    generatedOnly: comparison.rightOnly,
    identical: comparison.identical,
    originalOnly: comparison.leftOnly,
  };
}

export interface ExternalStageResult {
  readonly detail: string;
  readonly ok: boolean;
  readonly stage: "build" | "import" | "init" | "lint" | "purity";
}

export interface ExternalRoundTrip {
  readonly comparison: TreeComparison;
  readonly generatedRoot: string;
  readonly kind: "plugin" | "skill";
  readonly name: string;
  readonly originalRoot: string;
  readonly target: TargetName;
}

/** What init's whole-repo survey saw: import candidates plus the recognized
 * surfaces it cannot import yet (structured skips with reasons). */
export interface ExternalSurvey {
  readonly candidates: readonly SetupImportCandidate[];
  readonly diagnostics: readonly PluginAdoptionDiagnostic[];
  readonly skips: readonly SurveySkip[];
}

export interface ExternalRunReport {
  readonly name: string;
  readonly ok: boolean;
  readonly roundTrips: readonly ExternalRoundTrip[];
  readonly stages: readonly ExternalStageResult[];
  readonly survey: ExternalSurvey;
}

/** How many dirty paths a failed purity stage lists before truncating. */
const PURITY_DETAIL_CAP = 10;

/**
 * The purity invariant: adoption may only ever create root skillset.yaml and
 * paths under .skillset/. Any other path reported by `git status` after a run
 * is a toolchain defect.
 * Older in-repo cache payloads may show up in status for pre-XDG runs; that is
 * fine when they stay under .skillset/.
 */
export async function checkClonePurity(
  clonePath: string
): Promise<{ readonly dirtyPaths: readonly string[]; readonly ok: boolean }> {
  const output = await gitOutput(
    clonePath,
    "status",
    "--porcelain",
    "--untracked-files=all"
  );
  const dirtyPaths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) {continue;}
    // Porcelain v1: two status chars, a space, then the path (renames list
    // `old -> new`; both sides must stay under .skillset/).
    for (const rawPath of line.slice(3).split(" -> ")) {
      const path = rawPath.replaceAll('"', "");
      if (path !== "skillset.yaml" && !path.startsWith(".skillset/")) {dirtyPaths.push(path);}
    }
  }
  return {
    dirtyPaths: dirtyPaths.toSorted(compareStrings),
    ok: dirtyPaths.length === 0,
  };
}

/**
 * Reruns must start clean: import never overwrites, so a prior run's
 * skillset.yaml + .skillset/ adoption would fail the next one. Only untracked
 * leftovers are cleaned; a clone that tracks Skillset source is not ours to
 * delete.
 */
async function cleanSkillsetLeftovers(clonePath: string): Promise<void> {
  const tracked = await gitOutput(clonePath, "ls-files", "--", "skillset.yaml", ".skillset");
  if (tracked.trim().length > 0) {
    throw new Error(
      `skillset: clone ${clonePath} has tracked Skillset source files; refusing to clean`
    );
  }
  await runGit(clonePath, "clean", "-fdx", "-q", "--", "skillset.yaml", ".skillset");
}

/**
 * Adopt one external repo clone in place via the product command
 * (`adoptSkillset`): survey, import every candidate (instructions included),
 * lint, and build with the isolated mirror (reported under the logical
 * .skillset/cache/latest/ path and stored in XDG cache). The harness adds only
 * what the product command does not own: the purity invariant and the
 * round-trip comparison of the original clone against each requested target
 * projection.
 */
export async function runExternalRepo(
  name: string,
  clonePath: string,
  targets: readonly TargetName[]
): Promise<ExternalRunReport> {
  const stages: ExternalStageResult[] = [];
  const roundTrips: ExternalRoundTrip[] = [];
  const cloneCacheContext = createOperationalPathContext(clonePath);

  await cleanSkillsetLeftovers(clonePath);

  let survey: ExternalSurvey = { candidates: [], diagnostics: [], skips: [] };
  let adopt: AdoptReport;
  try {
    adopt = await adoptSkillset(clonePath, { targets, write: true });
  } catch (error) {
    stages.push({ detail: errorMessage(error), ok: false, stage: "init" });
    return { name, ok: false, roundTrips, stages, survey };
  }

  const { candidates } = adopt;
  survey = {
    candidates,
    diagnostics: adopt.surveyDiagnostics,
    skips: adopt.surveySkips,
  };
  const blockingDiagnostics = adopt.surveyDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  );
  stages.push({
    detail:
      `${candidates.length} import candidate(s): ${candidates.map((candidate) => `${candidate.kind}:${candidate.path}`).join(", ") || "none"}` +
      (adopt.surveyDiagnostics.length === 0
        ? ""
        : `; ${adopt.surveyDiagnostics.length} plugin candidate diagnostic(s): ${adopt.surveyDiagnostics.map((diagnostic) => diagnostic.code).join(", ")}`),
    ok: candidates.length > 0 && blockingDiagnostics.length === 0,
    stage: "init",
  });
  if (candidates.length === 0 || blockingDiagnostics.length > 0) {
    return { name, ok: false, roundTrips, stages, survey };
  }

  const imported: {
    readonly kind: "plugin" | "skill";
    readonly name: string;
    readonly sourcePath: string;
  }[] = [];
  for (const result of adopt.imports) {
    const label = `${result.candidate.kind}:${result.candidate.path}`;
    stages.push({
      detail: result.ok
        ? `${label} -> ${result.detail}`
        : `${label}: ${result.detail}`,
      ok: result.ok,
      stage: "import",
    });
    imported.push(...result.units);
  }

  const lintErrors = adopt.lintIssues.filter(
    (issue) => issue.severity === "error"
  );
  stages.push({
    detail:
      lintErrors.length === 0
        ? `${adopt.lintIssues.length} lint issue(s), 0 errors`
        : `${lintErrors.length} lint error(s): ${lintErrors
            .slice(0, 3)
            .map((issue) => `${issue.path}: ${issue.code}`)
            .join("; ")}`,
    ok: lintErrors.length === 0,
    stage: "lint",
  });

  stages.push({
    detail:
      adopt.buildError ??
      `wrote ${adopt.builtFiles} generated files under ${ISOLATED_OUT_ROOT}/`,
    ok: adopt.buildError === undefined,
    stage: "build",
  });

  try {
    const purity = await checkClonePurity(clonePath);
    const listed = purity.dirtyPaths.slice(0, PURITY_DETAIL_CAP);
    const overflow = purity.dirtyPaths.length - listed.length;
    stages.push({
      detail: purity.ok
        ? "git status reports nothing outside skillset.yaml and .skillset/"
        : `dirty paths outside skillset.yaml and .skillset/: ${listed.join(", ")}${overflow > 0 ? ` (and ${overflow} more)` : ""}`,
      ok: purity.ok,
      stage: "purity",
    });
  } catch (error) {
    stages.push({ detail: errorMessage(error), ok: false, stage: "purity" });
  }

  // A failed isolated build already records the graph-load error. Retrying the
  // load here would prevent the harness from returning its failed report.
  if (adopt.buildError !== undefined) {
    return { name, ok: false, roundTrips, stages, survey };
  }

  const graph = await loadBuildGraph(clonePath);
  for (const item of imported) {
    for (const target of targets) {
      const generatedRoot = item.kind === "plugin"
        ? join(
            ISOLATED_OUT_ROOT,
            pluginTargetRoot(graph.root.outputs.plugins[target], target, item.name)
          )
        : join(ISOLATED_OUT_ROOT, graph.root.outputs.skills[target], item.name);
      const generatedRootPath = resolveOperationalPath(cloneCacheContext, generatedRoot);
      const originalRoot =
        item.sourcePath === "." ? clonePath : join(clonePath, item.sourcePath);
      roundTrips.push({
        comparison: await compareTrees(
          originalRoot,
          generatedRootPath
        ),
        generatedRoot,
        kind: item.kind,
        name: item.name,
        originalRoot:
          relative(clonePath, originalRoot) === ""
            ? "."
            : relative(clonePath, originalRoot),
        target,
      });
    }
  }

  return {
    name,
    ok: stages.every((stage) => stage.ok),
    roundTrips,
    stages,
    survey,
  };
}

export function renderRunReportMarkdown(
  report: ExternalRunReport,
  entry: Pick<ExternalRepoEntry, "ref" | "repo">
): string {
  const lines = [
    `# External fixture run: ${report.name}`,
    "",
    `- repo: ${entry.repo}`,
    `- ref: ${entry.ref}`,
    `- result: ${report.ok ? "pass" : "fail"}`,
    "",
    "## Conformance Evidence",
    "",
    "This report is opt-in external adoption conformance evidence. It proves the pinned repo can be acquired, adopted into source, linted, built into the isolated mirror, and checked for live-tree purity without mutating target runtime locations. Reference this report path from adapter conformance coverage or feature-registry evidence when an external repo is the supporting fixture.",
    "",
    "## Stages",
    "",
  ];
  for (const stage of report.stages) {
    lines.push(`- ${stage.ok ? "ok" : "FAIL"} ${stage.stage}: ${stage.detail}`);
  }
  lines.push("", "## Survey", "");
  if (
    report.survey.candidates.length === 0 &&
    report.survey.diagnostics.length === 0 &&
    report.survey.skips.length === 0
  ) {
    lines.push("No adoptable surfaces recognized.");
  }
  for (const candidate of report.survey.candidates) {
    const sources = candidate.plugin === undefined ? "" : ` (sources: ${candidate.plugin.paths.map((path) => `\`${path}\``).join(", ")})`;
    lines.push(`- candidate ${candidate.kind}: \`${candidate.path}\`${sources}`);
  }
  for (const diagnostic of report.survey.diagnostics) {
    lines.push(
      `- ${diagnostic.severity} \`${diagnostic.code}\`: ${diagnostic.message} Resolution: ${diagnostic.recommendation}`
    );
  }
  for (const skip of report.survey.skips) {
    lines.push(`- skipped ${skip.surface} \`${skip.path}\`: ${skip.reason}`);
  }
  lines.push("", "## Round-trip (target projections, report-only)", "");
  if (report.roundTrips.length === 0) {
    lines.push("No imported units to compare.");
  }
  for (const roundTrip of report.roundTrips) {
    const { comparison } = roundTrip;
    const total =
      comparison.identical.length +
      comparison.different.length +
      comparison.originalOnly.length;
    lines.push(
      `### ${roundTrip.kind} ${roundTrip.name} (${roundTrip.target})`,
      "",
      `Original \`${roundTrip.originalRoot}\` vs generated \`${roundTrip.generatedRoot}\`.`,
      "",
      `- identical: ${comparison.identical.length}/${total} original files`,
      `- different: ${comparison.different.length}`,
      `- original-only (not represented in generated output): ${comparison.originalOnly.length}`,
      `- generated-only (added by the compiler): ${comparison.generatedOnly.length}`,
      ""
    );
    appendCappedList(lines, "Different", comparison.different);
    appendCappedList(lines, "Original-only", comparison.originalOnly);
    appendCappedList(lines, "Generated-only", comparison.generatedOnly);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeExternalRunReport(
  reportDir: string,
  report: ExternalRunReport,
  entry: Pick<ExternalRepoEntry, "ref" | "repo">
): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "report.md"), renderRunReportMarkdown(report, entry));
  await writeFile(
    join(reportDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
}

function appendCappedList(
  lines: string[],
  title: string,
  paths: readonly string[]
): void {
  if (paths.length === 0) {return;}
  lines.push(`#### ${title}`, "");
  for (const path of paths.slice(0, REPORT_LIST_CAP))
    {lines.push(`- \`${path}\``);}
  if (paths.length > REPORT_LIST_CAP)
    {lines.push(`- ... and ${paths.length - REPORT_LIST_CAP} more`);}
  lines.push("");
}

async function readManifest(
  rootPath: string
): Promise<readonly ExternalRepoEntry[]> {
  const path = join(rootPath, MANIFEST_PATH);
  return parseExternalManifest(await readFile(path, "utf-8"), MANIFEST_PATH);
}

function selectEntries(
  entries: readonly ExternalRepoEntry[],
  name: string | undefined
): readonly ExternalRepoEntry[] {
  if (name === undefined) {return entries;}
  const selected = entries.filter((entry) => entry.name === name);
  if (selected.length === 0) {
    throw new Error(
      `skillset: no external fixture named ${name} in ${MANIFEST_PATH}`
    );
  }
  return selected;
}

async function syncRepo(
  rootPath: string,
  entry: ExternalRepoEntry
): Promise<void> {
  const clonePath = join(rootPath, CLONES_DIR, entry.name);
  if (!(await exists(join(clonePath, ".git")))) {
    await mkdir(clonePath, { recursive: true });
    await runGit(clonePath, "init", "-q");
    await runGit(clonePath, "remote", "add", "origin", entry.repo);
  }
  const origin = await gitOutput(
    clonePath,
    "remote",
    "get-url",
    "origin"
  ).catch(() => "");
  if (origin.trim() !== entry.repo) {
    await runGit(clonePath, "remote", "set-url", "origin", entry.repo);
  }
  const current = await gitOutput(
    clonePath,
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD"
  ).catch(() => "");
  // Drop prior run artifacts (in-place .skillset/ adoptions included) so every
  // sync leaves a pristine tree, even when the clone is already at the ref.
  if (current.trim().length > 0) {
    await runGit(clonePath, "reset", "--hard", "-q");
  }
  await runGit(clonePath, "clean", "-fdx", "-q");
  if (current.trim() === entry.ref) {
    console.log(`external: ${entry.name} already at ${entry.ref.slice(0, 12)}`);
    return;
  }
  await runGit(clonePath, "fetch", "--depth", "1", "origin", entry.ref);
  await runGit(clonePath, "checkout", "-q", "--detach", "FETCH_HEAD");
  console.log(`external: ${entry.name} synced to ${entry.ref.slice(0, 12)}`);
}

async function updateRepo(
  rootPath: string,
  entry: ExternalRepoEntry
): Promise<ExternalRepoEntry> {
  const output = await gitOutput(rootPath, "ls-remote", entry.repo, "HEAD");
  const ref = output.split(/\s+/u)[0];
  if (ref === undefined || !/^[0-9a-f]{40}$/u.test(ref)) {
    throw new Error(
      `skillset: could not resolve upstream HEAD for ${entry.repo}`
    );
  }
  if (ref === entry.ref) {
    console.log(
      `external: ${entry.name} already pinned to upstream HEAD ${ref.slice(0, 12)}`
    );
    return entry;
  }
  console.log(
    `external: ${entry.name} re-pinned ${entry.ref.slice(0, 12)} -> ${ref.slice(0, 12)}`
  );
  return { ...entry, ref };
}

async function runGit(cwd: string, ...args: readonly string[]): Promise<void> {
  await gitOutput(cwd, ...args);
}

async function gitOutput(
  cwd: string,
  ...args: readonly string[]
): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}\n${stdout}${stderr}`.trim()
    );
  }
  return stdout;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const [verb, name] = process.argv.slice(2);
  if (verb !== "sync" && verb !== "update" && verb !== "run") {
    console.error(
      "usage: bun scripts/fixtures/external.ts <sync|update|run> [name]"
    );
    process.exit(1);
  }
  const rootPath = resolve(import.meta.dir, "../..");
  const entries = await readManifest(rootPath);
  const selected = selectEntries(entries, name);

  if (verb === "update") {
    const updated = new Map<string, ExternalRepoEntry>();
    for (const entry of selected)
      {updated.set(entry.name, await updateRepo(rootPath, entry));}
    const next = entries.map((entry) => updated.get(entry.name) ?? entry);
    await writeFile(
      join(rootPath, MANIFEST_PATH),
      renderExternalManifest(next)
    );
    for (const entry of next.filter((candidate) =>
      updated.has(candidate.name)
    )) {
      await syncRepo(rootPath, entry);
    }
    return;
  }

  if (verb === "sync") {
    for (const entry of selected) {await syncRepo(rootPath, entry);}
    return;
  }

  let failed = false;
  const reportCacheContext = await operationalContextForRoot(rootPath);
  for (const entry of selected) {
    await syncRepo(rootPath, entry);
    const clonePath = join(rootPath, CLONES_DIR, entry.name);
    const report = await runExternalRepo(entry.name, clonePath, entry.targets);
    const reportDir = resolveOperationalPath(
      reportCacheContext,
      join(REPORTS_DIR, entry.name)
    );
    await writeExternalRunReport(reportDir, report, entry);
    for (const stage of report.stages) {
      console.log(
        `  ${stage.ok ? "ok" : "FAIL"} ${stage.stage}: ${stage.detail.split("\n")[0]}`
      );
    }
    for (const roundTrip of report.roundTrips) {
      const { comparison } = roundTrip;
      console.log(
        `  round-trip ${roundTrip.kind} ${roundTrip.name} (${roundTrip.target}): ${comparison.identical.length} identical, ` +
          `${comparison.different.length} different, ${comparison.originalOnly.length} original-only, ` +
          `${comparison.generatedOnly.length} generated-only`
      );
    }
    console.log(
      `external: ${entry.name} ${report.ok ? "passed" : "failed"} (${join(REPORTS_DIR, entry.name, "report.md")})`
    );
    if (!report.ok) {failed = true;}
  }
  if (failed) {process.exitCode = 1;}
}

async function operationalContextForRoot(rootPath: string): Promise<OperationalPathContext> {
  try {
    const graph = await loadBuildGraph(rootPath);
    return createOperationalPathContext(rootPath, {
      ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
    });
  } catch {
    return createOperationalPathContext(rootPath);
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
