#!/usr/bin/env bun
/**
 * Maintainer harness for external fixture repos: real published repos that
 * Skillset should be able to adopt (init + import), compile, and round-trip
 * into substantially similar generated output.
 *
 * The committed manifest (fixtures/external/repos.yaml) pins each repo to an
 * exact commit. Clones live gitignored under fixtures/external/repos/ and are
 * never scanned as this repo's own source. Runs adopt each clone in place and
 * build with the isolated mirror (everything lands under .skillset/build/out/),
 * then write reports under .skillset/build/external/.
 *
 *   bun scripts/fixtures/external.ts sync   [name]   # reset clones pristine at pinned refs
 *   bun scripts/fixtures/external.ts update [name]   # re-pin to upstream HEAD, then sync
 *   bun scripts/fixtures/external.ts run    [name]   # init -> import -> lint -> build -> purity -> round-trip report
 *
 * Run failures (init/import/lint/build/purity errors) exit non-zero. The
 * purity stage is the hard invariant: after a run, `git status` in the clone
 * may only show paths under .skillset/ — anything else is a toolchain defect.
 * The round-trip comparison is report-only for now; per-repo expectations can
 * harden into assertions once the numbers settle.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { buildSkillset, ISOLATED_OUT_ROOT } from "../../apps/skillset/src/build";
import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { importSources } from "../../apps/skillset/src/import";
import { lintSkillset } from "../../apps/skillset/src/lint";
import { compareStrings, validateSlug } from "../../apps/skillset/src/path";
import { initSkillset } from "../../apps/skillset/src/setup";
import type {
  SetupImportCandidate,
  SurveySkip,
} from "../../apps/skillset/src/setup";
import type { TargetName } from "../../apps/skillset/src/types";
import { parseYamlRecord } from "../../apps/skillset/src/yaml";

const MANIFEST_PATH = "fixtures/external/repos.yaml";
const CLONES_DIR = "fixtures/external/repos";
const REPORTS_DIR = ".skillset/build/external";
// .skillset is ignored because in-place adoption creates it inside the clone;
// it is harness material, not part of the original tree being round-tripped.
const COMPARISON_IGNORED = new Set([".git", ".DS_Store", ".skillset"]);
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
    if (target !== "claude" && target !== "codex") {
      throw new Error(
        `skillset: ${label} entry ${name} targets must be claude or codex`
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
  const original = await collectRelativeFiles(originalRoot);
  const generated = await collectRelativeFiles(generatedRoot);
  const different: string[] = [];
  const generatedOnly: string[] = [];
  const identical: string[] = [];
  const originalOnly: string[] = [];

  for (const path of original) {
    if (!generated.has(path)) {
      originalOnly.push(path);
      continue;
    }
    const [left, right] = await Promise.all([
      readFile(join(originalRoot, path)),
      readFile(join(generatedRoot, path)),
    ]);
    if (left.equals(right)) {identical.push(path);}
    else {different.push(path);}
  }
  for (const path of generated) {
    if (!original.has(path)) {generatedOnly.push(path);}
  }

  return {
    different: different.toSorted(compareStrings),
    generatedOnly: generatedOnly.toSorted(compareStrings),
    identical: identical.toSorted(compareStrings),
    originalOnly: originalOnly.toSorted(compareStrings),
  };
}

async function collectRelativeFiles(
  root: string
): Promise<ReadonlySet<string>> {
  const files = new Set<string>();
  if (!(await exists(root))) {return files;}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (COMPARISON_IGNORED.has(entry.name)) {continue;}
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {await walk(path);}
      else if (entry.isFile())
        {files.add(relative(root, path).replaceAll("\\", "/"));}
    }
  };
  await walk(root);
  return files;
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
}

/** What init's whole-repo survey saw: import candidates plus the recognized
 * surfaces it cannot import yet (structured skips with reasons). */
export interface ExternalSurvey {
  readonly candidates: readonly SetupImportCandidate[];
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
 * The purity invariant: adoption may only ever create paths under .skillset/.
 * Any other path reported by `git status` after a run is a toolchain defect.
 * (.skillset/build/ is not gitignored in external repos, so it shows up in
 * status — that is fine, it is under .skillset/.)
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
      if (!path.startsWith(".skillset/")) {dirtyPaths.push(path);}
    }
  }
  return {
    dirtyPaths: dirtyPaths.toSorted(compareStrings),
    ok: dirtyPaths.length === 0,
  };
}

/**
 * Reruns must start clean: import never overwrites, so a prior run's
 * .skillset/ adoption would fail the next one. Only untracked leftovers are
 * cleaned; a clone that tracks .skillset/ content is not ours to delete.
 */
async function cleanSkillsetLeftovers(clonePath: string): Promise<void> {
  const tracked = await gitOutput(clonePath, "ls-files", "--", ".skillset");
  if (tracked.trim().length > 0) {
    throw new Error(
      `skillset: clone ${clonePath} has tracked .skillset files; refusing to clean`
    );
  }
  await runGit(clonePath, "clean", "-fdx", "-q", "--", ".skillset");
}

/**
 * Adopt one external repo clone in place: init the source scaffold, import
 * every detected candidate, lint, build with the isolated mirror (the
 * projection lands under .skillset/build/out/), verify the purity invariant,
 * and compare the original clone against the generated Claude projection.
 */
export async function runExternalRepo(
  name: string,
  clonePath: string,
  targets: readonly TargetName[]
): Promise<ExternalRunReport> {
  const stages: ExternalStageResult[] = [];
  const roundTrips: ExternalRoundTrip[] = [];

  await cleanSkillsetLeftovers(clonePath);

  let candidates: readonly SetupImportCandidate[] = [];
  let survey: ExternalSurvey = { candidates: [], skips: [] };
  try {
    const init = await initSkillset({
      cwd: clonePath,
      targets,
      useGitRoot: false,
      write: true,
    });
    candidates = init.importCandidates;
    survey = { candidates, skips: init.surveySkips };
    stages.push({
      detail: `${candidates.length} import candidate(s): ${candidates.map((candidate) => `${candidate.kind}:${candidate.path}`).join(", ") || "none"}`,
      ok: candidates.length > 0,
      stage: "init",
    });
  } catch (error) {
    stages.push({ detail: errorMessage(error), ok: false, stage: "init" });
    return { name, ok: false, roundTrips, stages, survey };
  }

  const imported: {
    readonly kind: "plugin" | "skill";
    readonly name: string;
    readonly sourcePath: string;
  }[] = [];
  for (const candidate of candidates) {
    // Instruction files have no import lowering yet; adopt will lower them to
    // .skillset/instructions/. Deferring keeps the run green and visible.
    if (candidate.kind === "instructions") {
      stages.push({
        detail: `${candidate.kind}:${candidate.path}: instructions candidate deferred to adopt`,
        ok: true,
        stage: "import",
      });
      continue;
    }
    try {
      const batch = await importSources({
        kind: candidate.kind,
        rootPath: clonePath,
        sourcePath: join(clonePath, candidate.path),
      });
      for (const report of batch.imports) {
        const sourcePath = relative(clonePath, report.sourcePath).replaceAll(
          "\\",
          "/"
        );
        imported.push({
          kind: report.kind,
          name: report.name,
          sourcePath: sourcePath.length === 0 ? "." : sourcePath,
        });
      }
      stages.push({
        detail: `${candidate.kind}:${candidate.path} -> ${batch.imports.map((report) => `${report.kind} ${report.name}`).join(", ")} (${batch.files} files)`,
        ok: true,
        stage: "import",
      });
    } catch (error) {
      stages.push({
        detail: `${candidate.kind}:${candidate.path}: ${errorMessage(error)}`,
        ok: false,
        stage: "import",
      });
    }
  }

  if (imported.length === 0) {
    return { name, ok: false, roundTrips, stages, survey };
  }

  // Partial import failures still run lint/build: they validate whatever did
  // import, and the failed import stage already fails the overall run.
  try {
    const lint = await lintSkillset(clonePath);
    stages.push({
      detail: `linted ${lint.checkedSkills} source skills`,
      ok: true,
      stage: "lint",
    });
  } catch (error) {
    stages.push({ detail: errorMessage(error), ok: false, stage: "lint" });
  }

  try {
    const rendered = await buildSkillset(clonePath, { isolated: true });
    stages.push({
      detail: `wrote ${rendered.length} generated files under ${ISOLATED_OUT_ROOT}/`,
      ok: true,
      stage: "build",
    });
  } catch (error) {
    stages.push({ detail: errorMessage(error), ok: false, stage: "build" });
  }

  try {
    const purity = await checkClonePurity(clonePath);
    const listed = purity.dirtyPaths.slice(0, PURITY_DETAIL_CAP);
    const overflow = purity.dirtyPaths.length - listed.length;
    stages.push({
      detail: purity.ok
        ? "git status reports nothing outside .skillset/"
        : `dirty paths outside .skillset/: ${listed.join(", ")}${overflow > 0 ? ` (and ${overflow} more)` : ""}`,
      ok: purity.ok,
      stage: "purity",
    });
  } catch (error) {
    stages.push({ detail: errorMessage(error), ok: false, stage: "purity" });
  }

  for (const item of imported) {
    const generatedRoot =
      item.kind === "plugin"
        ? join(ISOLATED_OUT_ROOT, "plugins-claude", "plugins", item.name)
        : join(ISOLATED_OUT_ROOT, ".claude", "skills", item.name);
    const originalRoot =
      item.sourcePath === "." ? clonePath : join(clonePath, item.sourcePath);
    roundTrips.push({
      comparison: await compareTrees(
        originalRoot,
        join(clonePath, generatedRoot)
      ),
      generatedRoot,
      kind: item.kind,
      name: item.name,
      originalRoot:
        relative(clonePath, originalRoot) === ""
          ? "."
          : relative(clonePath, originalRoot),
    });
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
    "## Stages",
    "",
  ];
  for (const stage of report.stages) {
    lines.push(`- ${stage.ok ? "ok" : "FAIL"} ${stage.stage}: ${stage.detail}`);
  }
  lines.push("", "## Survey", "");
  if (
    report.survey.candidates.length === 0 &&
    report.survey.skips.length === 0
  ) {
    lines.push("No adoptable surfaces recognized.");
  }
  for (const candidate of report.survey.candidates) {
    lines.push(`- candidate ${candidate.kind}: \`${candidate.path}\``);
  }
  for (const skip of report.survey.skips) {
    lines.push(`- skipped ${skip.surface} \`${skip.path}\`: ${skip.reason}`);
  }
  lines.push("", "## Round-trip (Claude projection, report-only)", "");
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
      `### ${roundTrip.kind} ${roundTrip.name} (original \`${roundTrip.originalRoot}\` vs generated \`${roundTrip.generatedRoot}\`)`,
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
  for (const entry of selected) {
    await syncRepo(rootPath, entry);
    const clonePath = join(rootPath, CLONES_DIR, entry.name);
    const report = await runExternalRepo(entry.name, clonePath, entry.targets);
    const reportDir = join(rootPath, REPORTS_DIR, entry.name);
    await mkdir(reportDir, { recursive: true });
    const markdown = renderRunReportMarkdown(report, entry);
    await writeFile(join(reportDir, "report.md"), markdown);
    await writeFile(
      join(reportDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    for (const stage of report.stages) {
      console.log(
        `  ${stage.ok ? "ok" : "FAIL"} ${stage.stage}: ${stage.detail.split("\n")[0]}`
      );
    }
    for (const roundTrip of report.roundTrips) {
      const { comparison } = roundTrip;
      console.log(
        `  round-trip ${roundTrip.kind} ${roundTrip.name}: ${comparison.identical.length} identical, ` +
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

if (import.meta.main) {
  await main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
