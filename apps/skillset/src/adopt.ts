import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  lowerTransform,
  recognizeTransforms,
  type TransformMatch,
} from "@skillset/transforms";
import {
  createOperationalPathContext,
  resolveOperationalPath,
  type SkillsetRenderResult,
} from "@skillset/core";

import type { ReleaseBaselineEntry } from "./adoption";
import { buildSkillsetResult, ISOLATED_OUT_ROOT } from "@skillset/core";
import { gitSafeEnv } from "./git-env";
import { importSources } from "./import";
import { inspectSkillset } from "@skillset/core";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import { initSkillset, type SetupFile, type SetupImportCandidate, type SetupInclude, type SurveySkip } from "./setup";
import type { PluginAdoptionDiagnostic } from "./plugin-adoption";
import {
  preparePluginAdoptionSource,
  preparedPluginOriginPath,
  removePreparedPluginAdoptionSource,
} from "./plugin-adoption-source";
import type { JsonRecord, LintIssue, SkillsetOptions, SourceOrigin, TargetName } from "@skillset/core/internal/types";
import { isJsonRecord, parseMarkdown, stringifyMarkdown } from "@skillset/core/internal/yaml";

export interface AdoptOptions extends SkillsetOptions {
  readonly candidates?: readonly string[];
  readonly include?: readonly SetupInclude[];
  readonly cwd?: string;
  readonly destination?: string;
  readonly name?: string;
  readonly targets?: readonly TargetName[];
  readonly write?: boolean;
}

export type AdoptAcquisition =
  | {
      readonly input: string;
      readonly kind: "path";
      readonly rootPath: string;
    }
  | {
      readonly input: string;
      readonly kind: "git";
      readonly ref: string;
      readonly repo: string;
      readonly rootPath: string;
    };

/** A plugin or skill landed in `.skillset/` by one candidate import. */
export interface AdoptImportedUnit {
  readonly kind: "plugin" | "skill";
  readonly name: string;
  /** Original path relative to the adopted root (`.` for a root plugin). */
  readonly sourcePath: string;
}

export interface AdoptImportResult {
  readonly candidate: SetupImportCandidate;
  /** Instructions destination relative to the root (e.g. `.skillset/rules/agents.md`). */
  readonly destination?: string;
  readonly detail: string;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly ok: boolean;
  readonly units: readonly AdoptImportedUnit[];
}

/** One recognized construct in an imported markdown file, preview only. */
export interface TransformPreviewMatch {
  /** Codex surface form a future transform slice would write, if faithful. */
  readonly codexForm?: string;
  readonly intent: string;
  readonly lowering: TransformMatch["lowering"];
  /** Why no faithful Codex lowering exists (`lowering: "none"` entries). */
  readonly reason?: string;
  readonly text: string;
}

/** Per-file transform recognition over content the import just landed. */
export interface TransformPreview {
  /**
   * Whether adopt declared `dialect: claude` in the imported file's
   * frontmatter. Set when at least one match has a faithful Codex lowering;
   * files with only no-lowering matches stay unmarked (nothing would
   * translate).
   */
  readonly dialectDeclared: boolean;
  readonly matches: readonly TransformPreviewMatch[];
  /** Repo-relative path of the imported file that was scanned. */
  readonly path: string;
}

export interface AdoptReport {
  readonly acquisition: AdoptAcquisition;
  readonly alreadyAdopted: boolean;
  readonly baselines: readonly ReleaseBaselineEntry[];
  readonly buildError?: string;
  readonly builtFiles: number;
  readonly candidates: readonly SetupImportCandidate[];
  /**
   * Original paths a live (non-isolated) build would own. While they sit in
   * place, live builds refuse to overwrite them as unmanaged files — that
   * protection is the cutover safety net.
   */
  readonly cutover: readonly string[];
  readonly imports: readonly AdoptImportResult[];
  readonly lintIssues: readonly LintIssue[];
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly ok: boolean;
  readonly rootPath: string;
  readonly setupFiles: readonly SetupFile[];
  readonly surveyDiagnostics: readonly PluginAdoptionDiagnostic[];
  readonly surveySkips: readonly SurveySkip[];
  /**
   * Per-file preview of Claude-dialect constructs in imported markdown
   * (skill bodies and instruction files). Bodies are never rewritten; when a
   * file has at least one transformable match, adopt declares
   * `dialect: claude` in its frontmatter so the build translates its Codex
   * projection.
   */
  readonly transformPreviews: readonly TransformPreview[];
  readonly write: boolean;
}

/** Where write-mode adoption persists its migration report. */
export const ADOPT_REPORT_DIR = ".skillset/cache/adopt";

const INSTRUCTIONS_DIR = ".skillset/rules";

export function adoptCandidateId(candidate: { readonly kind: string; readonly path: string }): string {
  return `${candidate.kind}:${candidate.path}`;
}

function selectAdoptCandidates(
  candidates: readonly SetupImportCandidate[],
  selection: readonly string[] | undefined
): readonly SetupImportCandidate[] {
  if (selection === undefined || selection.includes("all")) return candidates;
  const available = new Map(candidates.map((candidate) => [adoptCandidateId(candidate), candidate]));
  return selection.map((id) => {
    const candidate = available.get(id);
    if (candidate === undefined) {
      throw new Error(`skillset: unknown adoption candidate ${id}; expected all or ${[...available.keys()].join(", ")}`);
    }
    return candidate;
  });
}

/**
 * One-action repo adoption: survey via `init`, import every candidate
 * (plugins, skills, and verbatim instruction files), lint without throwing,
 * and build isolated so the generated projection reports under the logical
 * `.skillset/cache/latest/` mirror backed by XDG cache instead of the repo's
 * live surfaces. Write mode only ever creates source paths under `.skillset/`;
 * plan mode (the default) runs the survey alone and writes nothing.
 */
export async function adoptSkillset(
  source: string,
  options: AdoptOptions = {}
): Promise<AdoptReport> {
  const { cwd, destination, targets, write, ...buildOptions } = options;
  const acquired = await acquireAdoptSource(source, cwd ?? process.cwd());
  if (destination !== undefined && write === true) {
    const preflight = await adoptResolvedRoot(acquired, {
      ...buildOptions,
      ...(targets === undefined ? {} : { targets }),
      write: false,
    });
    if (!preflight.ok) return preflight;
  }
  const acquisition = destination === undefined || write !== true
    ? acquired
    : await copyAdoptAcquisition(acquired, destination);
  return adoptResolvedRoot(acquisition, {
    ...buildOptions,
    ...(targets === undefined ? {} : { targets }),
    ...(write === undefined ? {} : { write }),
  });
}

async function copyAdoptAcquisition(acquisition: AdoptAcquisition, destination: string): Promise<AdoptAcquisition> {
  const rootPath = resolve(destination);
  try {
    if ((await readdir(rootPath)).length > 0) throw new Error(`skillset: init acquisition destination must be empty: ${rootPath}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const destinationFromSource = relative(acquisition.rootPath, rootPath);
  const destinationIsNested = destinationFromSource !== "" &&
    !isAbsolute(destinationFromSource) &&
    !/^\.\.(?:[\\/]|$)/u.test(destinationFromSource);
  let copyRoot = acquisition.rootPath;
  let stagedRoot: string | undefined;
  try {
    if (destinationIsNested) {
      stagedRoot = await mkdtemp(join(tmpdir(), "skillset-adopt-copy-"));
      await cp(acquisition.rootPath, stagedRoot, {
        ...(acquisition.kind === "path"
          ? { filter: (source: string) => relative(acquisition.rootPath, source).split(/[\\/]/u)[0] !== ".git" }
          : {}),
        recursive: true,
      });
      copyRoot = stagedRoot;
    }
    await mkdir(rootPath, { recursive: true });
    await cp(copyRoot, rootPath, {
      ...(!destinationIsNested && acquisition.kind === "path"
        ? { filter: (source: string) => relative(acquisition.rootPath, source).split(/[\\/]/u)[0] !== ".git" }
        : {}),
      recursive: true,
    });
  } finally {
    if (stagedRoot !== undefined) await rm(stagedRoot, { force: true, recursive: true });
  }
  if (acquisition.kind === "path") await initializeAdoptGit(rootPath);
  return { ...acquisition, rootPath };
}

async function initializeAdoptGit(rootPath: string): Promise<void> {
  const proc = Bun.spawn(["git", "init", "-q"], {
    cwd: rootPath,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (exitCode !== 0) throw new Error(`skillset: failed to initialize Git repository at ${rootPath}: ${stderr.trim()}`);
}

async function adoptResolvedRoot(
  acquisition: AdoptAcquisition,
  options: AdoptOptions = {}
): Promise<AdoptReport> {
  const { candidates: selectedCandidates, include, name, targets, write, ...buildOptions } = options;
  const writeMode = write === true;
  const resolvedRoot = acquisition.rootPath;
  // Captured before init scaffolds source: an existing workspace marker means
  // the repo was already adopted. Init tolerates valid existing workspaces, but
  // the report should still say so honestly.
  const alreadyAdopted = await adoptedWorkspaceExists(resolvedRoot);

  const survey = await initSkillset({
    cwd: resolvedRoot,
    useGitRoot: false,
    write: false,
    ...(include === undefined ? {} : { include }),
    ...(name === undefined ? {} : { name }),
    ...(targets === undefined ? {} : { targets }),
  });
  const candidates = selectAdoptCandidates(survey.importCandidates, selectedCandidates);

  if (!writeMode) {
    return {
      acquisition,
      alreadyAdopted,
      baselines: survey.baselines,
      builtFiles: 0,
      candidates,
      cutover: [],
      imports: [],
      lintIssues: [],
      renderResults: surveySkipRenderResults(survey.surveySkips),
      ok: !hasBlockingSurveyDiagnostic(survey.surveyDiagnostics),
      rootPath: survey.rootPath,
      setupFiles: survey.files,
      surveyDiagnostics: survey.surveyDiagnostics,
      surveySkips: survey.surveySkips,
      transformPreviews: [],
      write: false,
    };
  }

  if (hasBlockingSurveyDiagnostic(survey.surveyDiagnostics)) {
    const report: AdoptReport = {
      acquisition,
      alreadyAdopted,
      baselines: survey.baselines,
      builtFiles: 0,
      candidates,
      cutover: [],
      imports: [],
      lintIssues: [],
      renderResults: surveySkipRenderResults(survey.surveySkips),
      ok: false,
      rootPath: survey.rootPath,
      setupFiles: survey.files,
      surveyDiagnostics: survey.surveyDiagnostics,
      surveySkips: survey.surveySkips,
      transformPreviews: [],
      write: false,
    };
    await persistAdoptReport(report);
    return report;
  }

  const init = await initSkillset({
    cwd: resolvedRoot,
    useGitRoot: false,
    write: true,
    ...(include === undefined ? {} : { include }),
    ...(name === undefined ? {} : { name }),
    ...(targets === undefined ? {} : { targets }),
  });

  const imports: AdoptImportResult[] = [];
  const cutover: string[] = [];
  const previewSources: string[] = [];
  for (const candidate of candidates) {
    imports.push(
      await importCandidate(
        init.rootPath,
        acquisition,
        candidate,
        candidates,
        cutover,
        previewSources
      )
    );
  }
  // Dialect declaration must land before the graph loads: the isolated build
  // below is what translates the Codex projection of the marked files.
  const transformPreviews = await buildTransformPreviews(init.rootPath, previewSources);

  let lintIssues: readonly LintIssue[] = [];
  let buildError: string | undefined;
  let workspaceCacheKey: string | undefined;
  try {
    const graph = await loadBuildGraph(init.rootPath, buildOptions);
    workspaceCacheKey = graph.root.workspace.cacheKey;
    lintIssues = (await inspectSkillset(graph)).issues;
  } catch (error) {
    buildError = errorMessage(error);
  }

  let builtFiles = 0;
  let renderResults: readonly SkillsetRenderResult[] = [
    ...surveySkipRenderResults(survey.surveySkips),
    ...imports.flatMap((result) => result.renderResults),
  ];
  if (buildError === undefined) {
    try {
      const build = await buildSkillsetResult(init.rootPath, { ...buildOptions, isolated: true });
      builtFiles = build.data.length;
      renderResults = [
        ...renderResults,
        ...build.renderResults,
      ];
    } catch (error) {
      buildError = errorMessage(error);
    }
  }

  const lintErrors = lintIssues.filter((issue) => issue.severity === "error");
  const report: AdoptReport = {
    acquisition,
    alreadyAdopted,
    baselines: init.baselines,
    ...(buildError === undefined ? {} : { buildError }),
    builtFiles,
    candidates,
    cutover,
    imports,
    lintIssues,
    renderResults,
    ok:
      imports.every((result) => result.ok) &&
      lintErrors.length === 0 &&
      buildError === undefined,
    rootPath: init.rootPath,
    setupFiles: init.files,
    surveyDiagnostics: survey.surveyDiagnostics,
    surveySkips: survey.surveySkips,
    transformPreviews,
    write: true,
  };

  await persistAdoptReport(report, workspaceCacheKey);

  return report;
}

function hasBlockingSurveyDiagnostic(
  diagnostics: readonly PluginAdoptionDiagnostic[]
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

async function persistAdoptReport(
  report: AdoptReport,
  workspaceCacheKey?: string
): Promise<void> {
  const reportDir = resolveOperationalPath(
    createOperationalPathContext(report.rootPath, {
      ...(workspaceCacheKey === undefined ? {} : { workspaceCacheKey }),
    }),
    ADOPT_REPORT_DIR
  );
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "report.md"),
    renderAdoptReportMarkdown(report, { rootPath: report.rootPath })
  );
  await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

async function adoptedWorkspaceExists(rootPath: string): Promise<boolean> {
  const currentOrdinary = await exists(join(rootPath, "skillset.yaml"));
  const legacyOrdinary = await exists(join(rootPath, "skillset.yaml"));
  const dedicated =
    (await exists(join(rootPath, "skillset.yaml"))) && (await exists(join(rootPath, "skillset")));
  return currentOrdinary || legacyOrdinary || dedicated;
}

function surveySkipRenderResults(
  skips: readonly SurveySkip[]
): readonly SkillsetRenderResult[] {
  return skips.flatMap((skip) => skip.renderResult === undefined ? [] : [skip.renderResult]);
}

async function acquireAdoptSource(source: string, cwd: string): Promise<AdoptAcquisition> {
  const localPath = resolve(cwd, source);
  if (await exists(localPath)) {
    return { input: source, kind: "path", rootPath: localPath };
  }

  const clonePath = await mkdtemp(join(tmpdir(), "skillset-adopt-remote-"));
  try {
    await runGit(["clone", "--depth", "1", source, clonePath], cwd);
    const ref = (await runGit(["-C", clonePath, "rev-parse", "HEAD"], cwd)).trim();
    return { input: source, kind: "git", ref, repo: source, rootPath: clonePath };
  } catch (error) {
    await rm(clonePath, { force: true, recursive: true });
    throw error;
  }
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
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
    const detail = `${stdout}${stderr}`.trim();
    throw new Error(
      `skillset: git ${args[0] ?? "command"} failed${detail.length === 0 ? "" : `\n${detail}`}`
    );
  }
  return stdout;
}

/**
 * Import one survey candidate. Failures are recorded on the result, never
 * thrown: a single bad candidate must not abort the rest of the migration.
 */
async function importCandidate(
  rootPath: string,
  acquisition: AdoptAcquisition,
  candidate: SetupImportCandidate,
  allCandidates: readonly SetupImportCandidate[],
  cutover: string[],
  previewSources: string[]
): Promise<AdoptImportResult> {
  if (candidate.kind === "instructions") {
    try {
      const destination = await importInstructionFile(rootPath, candidate.path);
      await writeMarkdownSourceOrigin(
        join(rootPath, destination),
        sourceOriginFor(acquisition, candidate.path)
      );
      await normalizeImportedPromptArguments(join(rootPath, destination));
      // The original instruction file stays in place; a live build would
      // regenerate it from the imported source and hit the unmanaged-overwrite
      // protection, so it belongs on the cutover list.
      cutover.push(candidate.path);
      previewSources.push(destination);
      return { candidate, destination, detail: destination, renderResults: [], ok: true, units: [] };
    } catch (error) {
      return { candidate, detail: errorMessage(error), renderResults: [], ok: false, units: [] };
    }
  }

  try {
    const batch = await importCandidateSources(rootPath, acquisition, candidate, allCandidates);
    const units = batch.imports.map((report) => {
      const sourcePath = candidate.kind === "plugin"
        ? candidate.path
        : relative(rootPath, report.sourcePath).replaceAll("\\", "/");
      return {
        kind: report.kind,
        name: report.name,
        sourcePath: sourcePath.length === 0 ? "." : sourcePath,
      };
    });
    for (const report of batch.imports) {
      for (const file of report.copiedFiles) {
        if (basename(file) !== "SKILL.md") continue;
        await normalizeImportedPromptArguments(join(report.targetPath, file));
        previewSources.push(
          relative(rootPath, join(report.targetPath, file)).replaceAll("\\", "/")
        );
      }
    }
    return {
      candidate,
      detail: `${units.map((unit) => `${unit.kind} ${unit.name}`).join(", ")} (${batch.files} files)`,
      renderResults: batch.renderResults,
      ok: true,
      units,
    };
  } catch (error) {
    return { candidate, detail: errorMessage(error), renderResults: [], ok: false, units: [] };
  }
}

async function importCandidateSources(
  rootPath: string,
  acquisition: AdoptAcquisition,
  candidate: SetupImportCandidate,
  allCandidates: readonly SetupImportCandidate[]
) {
  if (candidate.kind === "instructions") {
    throw new Error("skillset: instruction candidates use the dedicated instruction importer");
  }
  const prepared = await preparePluginAdoptionSource(rootPath, candidate, allCandidates);
  if (candidate.kind === "plugin" && prepared !== undefined) {
    try {
      return await importSources({
        kind: "plugin",
        ...(candidate.plugin?.relation === "equivalent" ? { name: candidate.plugin.identity } : {}),
        rootPath,
        sourceOrigin: (_sourcePath, copiedFile) =>
          sourceOriginFor(
            acquisition,
            preparedPluginOriginPath(prepared, candidate, copiedFile)
          ),
        sourcePath: prepared.sourcePath,
      });
    } finally {
      await removePreparedPluginAdoptionSource(prepared);
    }
  }

  return importSources({
    kind: candidate.kind,
    rootPath,
    sourceOrigin: (sourcePath, copiedFile) =>
      sourceOriginFor(acquisition, relativeOriginPath(rootPath, sourcePath, copiedFile)),
    sourcePath: join(rootPath, candidate.path),
  });
}

/**
 * Minimal instructions import: copy the root instruction body into
 * `.skillset/rules/` under its lowercased name (`AGENTS.md` ->
 * `agents.md`), adding source-only provenance metadata. The ADR's
 * transform-on-adopt is a later slice; adopt never overwrites an existing
 * destination.
 */
async function importInstructionFile(rootPath: string, sourceName: string): Promise<string> {
  const destinationRelative = `${INSTRUCTIONS_DIR}/${sourceName.toLowerCase()}`;
  const destination = join(rootPath, destinationRelative);
  if (await exists(destination)) {
    throw new Error(
      `skillset: instructions import target already exists: ${destinationRelative}. ` +
        "Adopt never overwrites; remove the existing file or merge by hand."
    );
  }
  const content = await readFile(join(rootPath, sourceName));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
  return destinationRelative;
}

function sourceOriginFor(acquisition: AdoptAcquisition, path: string): SourceOrigin {
  return acquisition.kind === "git"
    ? { path, ref: acquisition.ref, repo: acquisition.repo }
    : { path };
}

function relativeOriginPath(rootPath: string, sourcePath: string, copiedFile?: string): string {
  const sourceFile = copiedFile === undefined
    ? sourcePath
    : basename(sourcePath) === copiedFile
      ? sourcePath
      : join(sourcePath, copiedFile);
  const path = relative(rootPath, sourceFile).replaceAll("\\", "/");
  return path.length === 0 ? "." : path;
}

async function writeMarkdownSourceOrigin(path: string, origin: SourceOrigin): Promise<void> {
  const parts = parseMarkdown(await readFile(path, "utf8"), path);
  await writeFile(path, stringifyMarkdown(withSkillsetOrigin(parts.frontmatter, origin), parts.body));
}

function withSkillsetOrigin(record: JsonRecord, origin: SourceOrigin): JsonRecord {
  const existing = isJsonRecord(record.skillset) ? record.skillset : {};
  return {
    ...record,
    skillset: {
      ...existing,
      origin: sourceOriginRecord(origin),
    },
  };
}

function sourceOriginRecord(origin: SourceOrigin): JsonRecord {
  return {
    path: origin.path,
    ...(origin.ref === undefined ? {} : { ref: origin.ref }),
    ...(origin.repo === undefined ? {} : { repo: origin.repo }),
  };
}

async function normalizeImportedPromptArguments(path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  let updated: string;
  try {
    const parts = parseMarkdown(raw, path);
    const body = rewriteClaudePromptArguments(parts.body);
    updated = body === parts.body ? raw : stringifyMarkdown(parts.frontmatter, body);
  } catch {
    updated = rewriteClaudePromptArguments(raw);
  }
  if (updated !== raw) await writeFile(path, updated);
}

function rewriteClaudePromptArguments(content: string): string {
  const pattern = /\$ARGUMENTS(?:\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_-]*|\b(?![\[.]))/gu;
  let rewritten = "";
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const token = match[0];
    const index = match.index;
    if (isAlreadySkillsetPromptArgument(content, index, index + token.length)) continue;
    rewritten += content.slice(cursor, index);
    rewritten += `{{${token}}}`;
    cursor = index + token.length;
  }

  return `${rewritten}${content.slice(cursor)}`;
}

function isAlreadySkillsetPromptArgument(content: string, start: number, end: number): boolean {
  const before = content.slice(Math.max(0, start - 4), start);
  const after = content.slice(end, Math.min(content.length, end + 4));
  return /\{\{\s*$/u.test(before) && /^\s*\}\}/u.test(after);
}

/**
 * Transform preview over the markdown the imports just landed: skill bodies
 * (frontmatter stripped) and verbatim instruction files. Raw Claude
 * `$ARGUMENTS` forms are normalized to Skillset prompt argument placeholders
 * before preview; otherwise bodies are not rewritten. When a file has at least
 * one transformable match, adopt
 * declares `dialect: claude` in its frontmatter so the build's Codex
 * projection lowers it through the transform engine. Files with only
 * no-lowering matches stay unmarked — nothing would translate.
 */
async function buildTransformPreviews(
  rootPath: string,
  paths: readonly string[]
): Promise<readonly TransformPreview[]> {
  const previews: TransformPreview[] = [];
  for (const path of paths) {
    const raw = await readFile(join(rootPath, path), "utf8");
    const body = basename(path) === "SKILL.md" ? markdownBody(raw, path) : raw;
    const matches = recognizeTransforms(maskSkillsetPromptArguments(body), "claude");
    if (matches.length === 0) continue;
    const transformable = matches.some((match) => match.lowering !== "none");
    const dialectDeclared = transformable
      ? await declareClaudeDialect(join(rootPath, path))
      : false;
    previews.push({
      dialectDeclared,
      matches: matches.map((match) => {
        const codexForm = lowerTransform(match, "codex");
        return {
          ...(codexForm === undefined ? {} : { codexForm }),
          intent: match.intent,
          lowering: match.lowering,
          ...(match.reason === undefined ? {} : { reason: match.reason }),
          text: match.text,
        };
      }),
      path,
    });
  }
  return previews;
}

function maskSkillsetPromptArguments(body: string): string {
  return body.replaceAll(
    /\{\{\s*\$ARGUMENTS(?:\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_-]*|\b)\s*\}\}/gu,
    ""
  );
}

/**
 * Declare `dialect: claude` in an imported file's frontmatter. Skills carry
 * frontmatter already (the key slots in after the opening `---`);
 * instruction files imported verbatim usually have none, so a minimal block
 * is prepended. Unparseable frontmatter is left alone — adopt must not
 * compound an import problem — and an existing `dialect` key is respected.
 */
async function declareClaudeDialect(path: string): Promise<boolean> {
  const raw = await readFile(path, "utf8");
  try {
    if (parseMarkdown(raw, path).frontmatter.dialect !== undefined) return true;
  } catch {
    return false;
  }
  const updated = /^---\r?\n/.test(raw)
    ? raw.replace(/^---\r?\n/, (open) => `${open}dialect: claude\n`)
    : `---\ndialect: claude\n---\n\n${raw}`;
  await writeFile(path, updated);
  return true;
}

function markdownBody(raw: string, label: string): string {
  try {
    return parseMarkdown(raw, label).body;
  } catch {
    // Unparseable frontmatter still deserves a preview; scan the raw text.
    return raw;
  }
}

export function renderAdoptReportMarkdown(
  report: AdoptReport,
  opts: { readonly rootPath: string }
): string {
  const lintErrors = report.lintIssues.filter((issue) => issue.severity === "error");
  const lintWarnings = report.lintIssues.filter((issue) => issue.severity === "warn");
  const succeeded = report.imports.filter((result) => result.ok);
  const failed = report.imports.filter((result) => !result.ok);
  const blockedBeforeWrite = !report.write && hasBlockingSurveyDiagnostic(report.surveyDiagnostics);

  const lines: string[] = ["# Skillset adoption report", ""];

  lines.push("## Summary", "");
  lines.push(`- root: \`${opts.rootPath}\``);
  lines.push(`- result: ${report.ok ? "pass" : "fail"}`);
  if (report.alreadyAdopted) {
    lines.push("- note: the repo already had a Skillset workspace marker; adoption proceeded against the existing source tree");
  }
  lines.push(
    `- imports: ${succeeded.length} succeeded, ${failed.length} failed`,
    `- plugin candidate diagnostics: ${report.surveyDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length} error(s), ${report.surveyDiagnostics.filter((diagnostic) => diagnostic.severity === "warning").length} warning(s)`,
    `- lint: ${lintErrors.length} error(s), ${lintWarnings.length} warning(s)`,
    blockedBeforeWrite
      ? "- build (isolated): not run; adoption blocked before source writes"
      : report.buildError === undefined
      ? `- build (isolated): ${report.builtFiles} generated files`
      : "- build (isolated): failed",
    `- render results: ${report.renderResults.length}`,
    ""
  );

  lines.push("## Acquisition", "");
  if (report.acquisition.kind === "git") {
    lines.push(
      "- source: git remote",
      `- repo: \`${report.acquisition.repo}\``,
      `- ref: \`${report.acquisition.ref}\``,
      `- clone: \`${report.acquisition.rootPath}\``,
      ""
    );
  } else {
    lines.push(
      "- source: local path",
      `- input: \`${report.acquisition.input}\``,
      ""
    );
  }

  lines.push("## Setup", "");
  for (const file of report.setupFiles) {
    const status = file.status === "create"
      ? report.write ? "created" : "planned"
      : "already present";
    lines.push(`- ${status}: \`${file.path}\``);
  }
  for (const baseline of report.baselines) {
    if (baseline.status !== "create") continue;
    lines.push(`- baseline: ${baseline.scope} ${baseline.version}`);
  }
  lines.push("");

  if (report.surveyDiagnostics.length > 0) {
    lines.push("## Plugin candidate diagnostics", "");
    for (const diagnostic of report.surveyDiagnostics) {
      lines.push(
        `- ${diagnostic.severity} \`${diagnostic.code}\` (${diagnostic.providers.join(", ")}): ${diagnostic.message}`,
        `  Resolution: ${diagnostic.recommendation}`,
        `  Evidence: ${diagnostic.evidence.join("; ")}`
      );
    }
    lines.push("");
  }

  lines.push("## Imported", "");
  if (succeeded.length === 0) {
    lines.push("Nothing imported.", "");
  } else {
    for (const result of succeeded) {
      if (result.destination !== undefined) {
        lines.push(`- ${result.candidate.kind}: \`${result.candidate.path}\` -> \`${result.destination}\` (body copy with provenance metadata)`);
        continue;
      }
      lines.push(`- ${result.candidate.kind}: \`${result.candidate.path}\` -> ${result.detail}`);
    }
    lines.push("");
  }

  if (report.surveySkips.length > 0) {
    lines.push("## Skipped surfaces", "");
    for (const skip of report.surveySkips) {
      lines.push(`- ${skip.surface} \`${skip.path}\`: ${skip.reason}`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("## Failed imports", "");
    for (const result of failed) {
      lines.push(`- ${result.candidate.kind} \`${result.candidate.path}\`: ${result.detail}`);
    }
    lines.push("");
  }

  lines.push("## Lint", "");
  if (report.lintIssues.length === 0) {
    lines.push("No lint issues.", "");
  } else {
    for (const issue of lintErrors) {
      lines.push(`- error \`${issue.path}\`: ${issue.code}: ${issue.message}`);
    }
    for (const issue of lintWarnings) {
      lines.push(`- warning \`${issue.path}\`: ${issue.code}: ${issue.message}`);
    }
    lines.push(
      "",
      "Lint errors fail adoption and need source fixes; warnings are advisory.",
      ""
    );
  }

  if (report.transformPreviews.length > 0) {
    lines.push("## Transforms (preview)", "");
    lines.push(
      "Claude `$ARGUMENTS` forms are normalized to Skillset prompt argument placeholders. Other bodies are untouched. Files with transformable constructs were marked `dialect: claude`; the build lowers their Codex projection through these forms.",
      ""
    );
    for (const preview of report.transformPreviews) {
      lines.push(`### \`${preview.path}\``, "");
      if (preview.dialectDeclared) {
        lines.push("`dialect: claude` declared.", "");
      }
      const transformable = aggregatePreviewMatches(
        preview.matches.filter((match) => match.lowering !== "none")
      );
      const blocked = aggregatePreviewMatches(
        preview.matches.filter((match) => match.lowering === "none")
      );
      if (transformable.length > 0) {
        lines.push("Transformable to Codex:", "");
        for (const item of transformable) {
          const target = item.codexForm === undefined ? "(no Codex form)" : inlineCode(item.codexForm);
          lines.push(`- ${inlineCode(item.text)} -> ${target} (${item.intent}${countSuffix(item.count)})`);
        }
        lines.push("");
      }
      if (blocked.length > 0) {
        lines.push("No faithful Codex lowering:", "");
        for (const item of blocked) {
          lines.push(
            `- ${inlineCode(item.text)} (${item.intent}${countSuffix(item.count)}): ${item.reason ?? "no reason recorded"}`
          );
        }
        lines.push("");
      }
    }
  }

  lines.push("## Build (isolated)", "");
  if (blockedBeforeWrite) {
    lines.push("Not run. Adoption stopped before source writes because plugin candidate diagnostics must be resolved.", "");
  } else if (report.buildError === undefined) {
    lines.push(
      `Wrote ${report.builtFiles} generated files into the mirror under \`${ISOLATED_OUT_ROOT}/\`, laid out as the repo root would be. The live tree is untouched.`,
      ""
    );
  } else {
    lines.push("```", report.buildError.trimEnd(), "```", "");
  }
  lines.push("### Render results", "");
  if (report.renderResults.length === 0) {
    lines.push("No render results recorded.", "");
  } else {
    for (const summary of summarizeRenderResults(report.renderResults)) {
      lines.push(`- ${summary}`);
    }
    lines.push("");
    lines.push(
      "Full structured render results are in `report.json` and in the isolated `skillset.lock` files when the isolated build completes.",
      ""
    );
  }

  lines.push("## Cutover", "");
  lines.push(
    `1. Review the generated mirror under \`${ISOLATED_OUT_ROOT}/\` against the originals.`
  );
  if (report.cutover.length > 0) {
    lines.push("2. Remove or relocate these originals — a live build owns their paths:");
    for (const path of report.cutover) {
      lines.push(`   - \`${path}\``);
    }
  } else {
    lines.push("2. No original paths need to move before a live build.");
  }
  lines.push(
    "3. Run `skillset build --yes` to write live output.",
    "",
    "Until the originals move, live builds refuse to overwrite them as unmanaged files — that protection is the safety net; nothing is lost by building too early.",
    ""
  );

  lines.push(
    "## Next steps",
    "",
    "- `skillset lint`",
    "- `skillset verify --isolated`",
    "- `skillset ci`",
    ""
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

interface AggregatedPreviewMatch extends TransformPreviewMatch {
  readonly count: number;
}

function summarizeRenderResults(
  outcomes: readonly SkillsetRenderResult[]
): readonly string[] {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    const key = `${outcome.target ?? "workspace"} ${outcome.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}: ${count}`);
}

/** Collapse repeated (intent, text, codexForm) hits into one counted line. */
function aggregatePreviewMatches(
  matches: readonly TransformPreviewMatch[]
): readonly AggregatedPreviewMatch[] {
  const aggregated = new Map<string, AggregatedPreviewMatch>();
  for (const match of matches) {
    const key = JSON.stringify([match.intent, match.text, match.codexForm ?? ""]);
    const existing = aggregated.get(key);
    aggregated.set(
      key,
      existing === undefined ? { ...match, count: 1 } : { ...existing, count: existing.count + 1 }
    );
  }
  return [...aggregated.values()];
}

function countSuffix(count: number): string {
  return count === 1 ? "" : `, x${count}`;
}

/** Inline code that survives constructs containing backticks (!`cmd`). */
function inlineCode(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
