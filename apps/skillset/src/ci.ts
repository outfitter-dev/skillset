import { changeCheck, type ChangeCheckIssue, type ChangeCheckReport } from "./change-entries";
import { join } from "node:path";
import {
  defaultChangesetBaseline,
  evaluateChangesetGuard,
  readChangedFilesFromGit,
  type ChangedFile,
} from "./changeset-awareness";
import {
  buildSkillset,
  createOperationalPathContext,
  diffSkillsetResult,
  ISOLATED_OUT_ROOT,
  logicalOperationalPath,
  resolveOperationalPath,
  type SkillsetDiagnostic,
  type SkillsetDiff,
} from "@skillset/core";
import type { SourceSuggestionReport } from "@skillset/core/internal/authoring";
import { inspectSkillset } from "@skillset/core";
import { readManagedOutputState } from "@skillset/core/internal/output-safety";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { LintIssue, SkillsetOptions } from "@skillset/core/internal/types";
import { runProviderFormatUpdates, type ProviderFormatUpdateReport } from "./provider-format-updates";
import { reconcileManagedPath } from "./reconcile";
import {
  classifyRecoveryGuidance,
  mechanicalFixEligibility,
  type RecoveryGuidance,
  type RecoveryGuidanceInput,
} from "./recovery-guidance";

export interface CiOptions extends SkillsetOptions {
  /** Include branch-aware source and package change gates. */
  readonly ci?: boolean;
  /** Rebuild generated output when drift is the only mechanical problem. */
  readonly fix?: boolean;
  /** Change-entry baseline ref, forwarded to `skillset change check`. */
  readonly since?: string;
}

export interface CiReport {
  /** Graph load or render failure; nothing else could run. */
  readonly buildError?: string;
  /** Change check infrastructure failure (for example no resolvable baseline). */
  readonly changeError?: string;
  readonly changeIssues: readonly ChangeCheckIssue[];
  /** Changesets boundary failure or infrastructure issue. */
  readonly changesetError?: string;
  readonly changesetIssues?: readonly string[];
  readonly changesetFiles?: readonly ChangedFile[];
  readonly packageFiles?: readonly ChangedFile[];
  /** Generated-output drift remaining after any fix. */
  readonly drift: SkillsetDiff;
  /** Generated paths rewritten by a `--fix` rebuild. */
  readonly fixedPaths: readonly string[];
  readonly lintIssues: readonly LintIssue[];
  readonly ok: boolean;
  /** Managed generated paths changed since the last recorded output hash. */
  readonly outputEditedPaths: readonly string[];
  /** Diagnostics produced while deriving and validating generated output. */
  readonly outputDiagnostics: readonly SkillsetDiagnostic[];
  /** Drift owned by explicit provider-format migrations and therefore `update`. */
  readonly providerUpdatePaths: readonly string[];
  /** Provider-format classification failure; recovery must fail closed. */
  readonly providerAnalysisError?: string;
  /** Ordered recovery guidance shared by terminal, Markdown, and JSON output. */
  readonly recovery?: readonly RecoveryGuidance[];
  readonly sourceSuggestions?: readonly SourceSuggestionReport[];
  readonly warnings: readonly string[];
}

const EMPTY_DRIFT: SkillsetDiff = { added: [], changed: [], missing: [], removed: [] };

/**
 * Aggregate the checks a continuous-integration run needs: lint diagnostics,
 * change coverage, and generated-output drift. Source-driven drift is the only
 * mechanical problem: with `fix` enabled, no lint errors, clean change
 * coverage, a resolved baseline, and no target-side edits, the check rebuilds
 * generated output the same way `skillset build --yes` would. Lint errors, missing change entries, and
 * build errors need authored source changes, so they stay report-only; lint
 * warnings are advisory and never fail the run.
 */
export async function ciSkillset(rootPath: string, options: CiOptions = {}): Promise<CiReport> {
  const { ci, fix, since, ...buildOptions } = options;

  let lintIssues: readonly LintIssue[] = [];
  let warnings: readonly string[] = [];
  let outputEditedPaths: readonly string[] = [];
  let managedOutputPaths: ReadonlySet<string> = new Set();
  let buildError: string | undefined;
  try {
    const graph = await loadBuildGraph(rootPath, buildOptions);
    lintIssues = (await inspectSkillset(graph)).issues;
    warnings = graph.warnings;
    const outPath = buildOptions.isolated === true
      ? (path: string) => join(ISOLATED_OUT_ROOT, path)
      : (path: string) => path;
    const pathContext = createOperationalPathContext(rootPath, {
      ...(graph.root.workspace.cacheKey === undefined ? {} : { workspaceCacheKey: graph.root.workspace.cacheKey }),
      ...(buildOptions.xdg?.env === undefined ? {} : { env: buildOptions.xdg.env }),
      ...(buildOptions.xdg?.homeDir === undefined ? {} : { homeDir: buildOptions.xdg.homeDir }),
    });
    const managed = await readManagedOutputState(
      rootPath,
      graph.outputRoots,
      true,
      outPath,
      (path) => resolveOperationalPath(pathContext, path),
      (path) => logicalOperationalPath(pathContext, path)
    );
    managedOutputPaths = managed.paths;
    outputEditedPaths = [...managed.editedPaths].sort();
  } catch (error) {
    buildError = errorMessage(error);
  }

  let changeIssues: readonly ChangeCheckIssue[] = [];
  let changeReport: ChangeCheckReport | undefined;
  let changeError: string | undefined;
  if (ci === true || since !== undefined) {
    try {
      changeReport = await changeCheck(rootPath, {
        ...buildOptions,
        ...(since === undefined ? {} : { since }),
      });
      changeIssues = changeReport.issues;
    } catch (error) {
      changeError = errorMessage(error);
    }
  }

  let changesetIssues: readonly string[] = [];
  let changesetError: string | undefined;
  let changesetFiles: readonly ChangedFile[] = [];
  let packageFiles: readonly ChangedFile[] = [];
  if (ci === true || since !== undefined) {
    try {
      const base = since ?? await defaultChangesetBaseline(rootPath);
      const guard = evaluateChangesetGuard(await readChangedFilesFromGit(rootPath, base));
      changesetIssues = guard.diagnostics;
      changesetFiles = guard.changesetFiles;
      packageFiles = guard.packageFiles;
    } catch (error) {
      changesetError = errorMessage(error);
    }
  }

  let drift: SkillsetDiff = EMPTY_DRIFT;
  let outputDiagnostics: readonly SkillsetDiagnostic[] = [];
  if (buildError === undefined) {
    try {
      const result = await diffSkillsetResult(rootPath, buildOptions);
      drift = result.data;
      outputDiagnostics = result.diagnostics;
    } catch (error) {
      buildError = errorMessage(error);
    }
  }
  const driftPaths = new Set([...drift.added, ...drift.changed, ...drift.missing, ...drift.removed]);
  outputEditedPaths = outputEditedPaths.filter((path) => driftPaths.has(path));

  const changeErrors = changeIssues.filter((issue) => issue.severity === "error");
  const lintErrors = lintIssues.filter((issue) => issue.severity === "error");
  const sourceSuggestions = buildError === undefined && hasDrift(drift)
    ? await sourceSuggestionsForDrift(rootPath, drift, buildOptions)
    : [];
  let providerUpdatePaths: readonly string[] = [];
  let providerReport: ProviderFormatUpdateReport | undefined;
  let providerAnalysisError: string | undefined;
  let providerSourceDriftPaths: ReadonlySet<string> = new Set();
  if (buildError === undefined && hasDrift(drift)) {
    try {
      providerReport = await runProviderFormatUpdates(rootPath, "check", buildOptions);
      const sourceDriftPaths = new Set(providerReport.sourceDriftPaths);
      providerSourceDriftPaths = sourceDriftPaths;
      const legacyLockOutputPaths = new Set(providerReport.legacyLockOutputPaths);
      const plannedProviderPaths = [...providerReport.safeUpdates, ...providerReport.manualReviews]
        .flatMap((action) => action.affectedPaths);
      const legacyMigrationPaths = new Set(
        plannedProviderPaths.filter((path) => legacyLockOutputPaths.has(path))
      );
      const preserveLegacyMigrationBoundary = legacyMigrationPaths.size > 0;
      providerUpdatePaths = [...new Set(
        [
          ...plannedProviderPaths,
          ...providerReport.unplannedDriftPaths,
        ]
          .filter((path) =>
            legacyMigrationPaths.has(path) ||
            (!sourceDriftPaths.has(path) &&
              !(
                sourceDriftPaths.size > 0 &&
                !preserveLegacyMigrationBoundary &&
                (path === "skillset.lock" || path.endsWith("/skillset.lock"))
              ))
          )
      )].sort();
    } catch (error) {
      providerAnalysisError = errorMessage(error);
    }
  }
  const hasUnmanagedOutputCollisions = outputDiagnostics.some(
    (diagnostic) => {
      if (diagnostic.code !== "unmanaged-output-collision" || diagnostic.outputPath === undefined) {
        return false;
      }
      if (managedOutputPaths.has(diagnostic.outputPath)) return false;

      // Provider marketplace indexes predate per-file lock ownership. Preserve
      // source-driven refreshes for established generated workspaces while
      // still refusing a first-build collision at the same path.
      const isEstablishedMarketplaceIndex =
        managedOutputPaths.size > 0 &&
        providerSourceDriftPaths.has(diagnostic.outputPath) &&
        (diagnostic.outputPath.endsWith("/.claude-plugin/marketplace.json") ||
          diagnostic.outputPath.endsWith("/.cursor-plugin/marketplace.json") ||
          diagnostic.outputPath === ".claude-plugin/marketplace.json" ||
          diagnostic.outputPath === ".cursor-plugin/marketplace.json");
      return !isEstablishedMarketplaceIndex;
    }
  );
  const recoveryInput = (): RecoveryGuidanceInput => ({
    ...(buildError === undefined ? {} : { buildError }),
    ...(changeError === undefined ? {} : { changeError }),
    ...(changeReport === undefined ? {} : { changeReport }),
    ...(changesetError === undefined ? {} : { changesetError }),
    changesetIssues,
    drift,
    lintIssues,
    mode: ci === true ? "ci" : "local",
    outputDiagnostics,
    outputEditedPaths,
    ...(providerAnalysisError === undefined ? {} : { providerAnalysisError }),
    ...(providerReport === undefined ? {} : { providerReport }),
    providerUpdatePaths,
    sourceSuggestions,
    unmanagedOutputCollisions: hasUnmanagedOutputCollisions,
  });

  // Rebuild only when generated drift is the sole remaining blocker. This
  // predicate is also the public recovery contract, so guidance cannot claim
  // that --fix will write when the operation itself would refuse.
  let fixedPaths: readonly string[] = [];
  if (fix === true && mechanicalFixEligibility(recoveryInput()).eligible) {
    const staleBefore = [...drift.added, ...drift.changed, ...drift.missing, ...drift.removed];
    try {
      await buildSkillset(rootPath, buildOptions);
      const result = await diffSkillsetResult(rootPath, buildOptions);
      drift = result.data;
      outputDiagnostics = result.diagnostics;
      const remaining = new Set([...drift.added, ...drift.changed, ...drift.missing, ...drift.removed]);
      fixedPaths = staleBefore.filter((path) => !remaining.has(path));
    } catch (error) {
      buildError = errorMessage(error);
    }
  }

  const recovery = classifyRecoveryGuidance(recoveryInput());

  return {
    ...(buildError === undefined ? {} : { buildError }),
    ...(changeError === undefined ? {} : { changeError }),
    changeIssues,
    ...(changesetError === undefined ? {} : { changesetError }),
    ...(changesetFiles.length === 0 ? {} : { changesetFiles }),
    ...(changesetIssues.length === 0 ? {} : { changesetIssues }),
    drift,
    fixedPaths,
    lintIssues,
    ok:
      buildError === undefined &&
      changeError === undefined &&
      changesetError === undefined &&
      providerAnalysisError === undefined &&
      lintErrors.length === 0 &&
      changeErrors.length === 0 &&
      changesetIssues.length === 0 &&
      !outputDiagnostics.some((diagnostic) => diagnostic.severity === "error") &&
      !hasDrift(drift),
    outputEditedPaths,
    outputDiagnostics,
    ...(providerAnalysisError === undefined ? {} : { providerAnalysisError }),
    providerUpdatePaths,
    recovery,
    ...(packageFiles.length === 0 ? {} : { packageFiles }),
    ...(sourceSuggestions.length === 0 ? {} : { sourceSuggestions }),
    warnings,
  };
}

export function hasDrift(drift: SkillsetDiff): boolean {
  return (
    drift.added.length > 0 ||
    drift.changed.length > 0 ||
    drift.missing.length > 0 ||
    drift.removed.length > 0
  );
}

/** Marker that lets CI workflows find and update an existing report comment. */
export const CI_REPORT_MARKER = "<!-- skillset-ci-report -->";

/**
 * Render a CI report as Markdown suitable for a pull-request comment or a
 * GitHub Actions job summary.
 */
export function renderCiReportMarkdown(report: CiReport): string {
  const lines: string[] = [CI_REPORT_MARKER, "## Skillset CI", ""];
  const lintErrors = report.lintIssues.filter((issue) => issue.severity === "error");
  const lintWarnings = report.lintIssues.filter((issue) => issue.severity === "warn");
  const outputWarnings = report.outputDiagnostics.filter((diagnostic) => diagnostic.severity !== "error");

  if (
    report.ok &&
    report.fixedPaths.length === 0 &&
    lintWarnings.length === 0 &&
    outputWarnings.length === 0 &&
    report.changeIssues.length === 0 &&
    (report.recovery?.length ?? 0) === 0
  ) {
    lines.push("All checks passed: source lint, change entries, and generated output are current.", "");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  if (report.ok) {
    lines.push(
      hasGeneratedChangelogPath(report.fixedPaths)
        ? "Generated output was stale and has been rebuilt mechanically. Review rebuilt generated changelogs below in case the edit should be recovered through source-side change history."
        : report.fixedPaths.length > 0
        ? "Generated output was stale and has been rebuilt mechanically. No source changes are needed."
        : "All checks passed; the warnings and recovery guidance below are advisory and do not fail CI.",
      ""
    );
  } else {
    lines.push("Skillset CI found problems; the sections below explain each one.", "");
  }

  if (report.fixedPaths.length > 0) {
    lines.push("### Rebuilt generated output", "");
    for (const path of report.fixedPaths) lines.push(`- \`${path}\``);
    if (hasGeneratedChangelogPath(report.fixedPaths)) {
      lines.push(
        "",
        "Generated `CHANGELOG.md` files are managed projections. Edit pending wording with `skillset change reason <@ref>` before release; use `skillset change amend <@ref>` for applied-history wording after release or `skillset release amend <@ref>` for release-event metadata instead of hand-editing generated changelogs."
      );
    }
    lines.push("", "These files were regenerated from source the same way `skillset build --yes` would. Commit the rebuilt output if it is not committed for you.", "");
  }

  if (report.outputDiagnostics.length > 0) {
    lines.push("### Generated-output diagnostics", "");
    for (const diagnostic of report.outputDiagnostics) {
      const path = diagnostic.path ?? diagnostic.outputPath;
      lines.push(`- ${diagnostic.severity}: ${path === undefined ? "" : `\`${path}\`: `}${diagnostic.code}: ${diagnostic.message}`);
    }
    lines.push("");
  }

  if (hasDrift(report.drift)) {
    lines.push("### Stale generated output", "");
    for (const path of report.drift.added) lines.push(`- added: \`${path}\``);
    for (const path of report.drift.changed) lines.push(`- changed: \`${path}\``);
    for (const path of report.drift.missing) lines.push(`- missing: \`${path}\``);
    for (const path of report.drift.removed) lines.push(`- removed: \`${path}\``);
    if (hasGeneratedChangelogDrift(report.drift)) {
      lines.push(
        "",
        "Generated `CHANGELOG.md` files are managed projections. Edit pending wording with `skillset change reason <@ref>` before release; use `skillset change amend <@ref>` for applied-history wording after release or `skillset release amend <@ref>` for release-event metadata instead of hand-editing generated changelogs."
      );
    }
    lines.push("");
  }

  if (report.outputEditedPaths.length > 0) {
    lines.push("### Target-side generated edits", "");
    for (const path of report.outputEditedPaths) lines.push(`- \`${path}\``);
    lines.push(
      "",
      "Target-side edits are intentionally not overwritten by a mechanical rebuild; the recovery plan below keeps source/output authority explicit.",
      ""
    );
  }

  if (report.providerUpdatePaths.length > 0) {
    lines.push("### Provider-format updates", "");
    for (const path of report.providerUpdatePaths) lines.push(`- \`${path}\``);
    lines.push("");
  }

  if (report.sourceSuggestions !== undefined && report.sourceSuggestions.length > 0) {
    lines.push("### Reconciliation", "");
    for (const suggestion of report.sourceSuggestions) {
      const source = suggestion.sourcePath === undefined ? "" : ` source \`${suggestion.sourcePath}\``;
      lines.push(`- ${suggestion.status}: \`${suggestion.generatedPath}\`${source}: ${suggestion.message}`);
    }
    lines.push("");
  }

  if (lintErrors.length > 0) {
    lines.push("### Lint issues", "");
    for (const issue of lintErrors) {
      lines.push(`- \`${issue.path}\`: ${issue.code}: ${issue.message}`);
    }
    lines.push("", "Fix the source issues, then rerun `skillset check`.", "");
  }

  if (lintWarnings.length > 0) {
    lines.push("### Lint warnings", "");
    for (const issue of lintWarnings) {
      lines.push(`- \`${issue.path}\`: ${issue.code}: ${issue.message}`);
    }
    lines.push("", "Warnings do not fail CI, but cleaning them up keeps skills portable.", "");
  }

  if (report.changeError !== undefined) {
    lines.push("### Change check could not run", "", codeBlock(report.changeError), "");
  } else if (report.changeIssues.length > 0) {
    lines.push("### Change entries", "");
    for (const issue of report.changeIssues) {
      const path = issue.path === undefined ? "" : `\`${issue.path}\`: `;
      lines.push(`- ${issue.severity}: ${path}${issue.code}: ${issue.message}`);
    }
    lines.push("");
  }

  if (report.changesetError !== undefined) {
    lines.push("### Package Changesets", "", codeBlock(report.changesetError), "");
  } else if (report.changesetIssues !== undefined && report.changesetIssues.length > 0) {
    lines.push("### Package Changesets", "");
    for (const issue of report.changesetIssues) lines.push(`- ${issue}`);
    if (report.packageFiles !== undefined && report.packageFiles.length > 0) {
      lines.push("", "Package-facing paths in this branch:");
      for (const file of report.packageFiles) lines.push(`- \`${file.path}\``);
    }
    lines.push(
      "",
      "Use `.changeset/*.md` for published compiler package changes. Use `.skillset/changes/` for Skillset source-unit/loadout history.",
      ""
    );
  }

  if (report.buildError !== undefined) {
    lines.push("### Build error", "", codeBlock(report.buildError), "");
  }

  if (report.providerAnalysisError !== undefined) {
    lines.push("### Provider-format analysis error", "", codeBlock(report.providerAnalysisError), "");
  }

  if ((report.recovery?.length ?? 0) > 0) {
    lines.push("### Recovery guidance", "");
    for (const item of report.recovery ?? []) {
      const location = item.path === undefined ? "" : ` ${markdownCode(item.path)}`;
      const ref = item.ref === undefined ? "" : ` ${item.ref}`;
      const scope = item.scope === undefined ? "" : ` (${item.scope})`;
      lines.push(`- ${item.blocked === true ? "blocked " : ""}${item.action}${location}${ref}${scope}: ${item.reason}`);
      for (const command of item.commands) lines.push(`  - ${markdownCode(command)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function markdownCode(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  if (longestRun === 0) return `\`${value}\``;
  const fence = "`".repeat(longestRun + 1);
  return `${fence} ${value} ${fence}`;
}

function codeBlock(content: string): string {
  return ["```", content.trimEnd(), "```"].join("\n");
}

function hasGeneratedChangelogDrift(diff: SkillsetDiff): boolean {
  return hasGeneratedChangelogPath([...diff.added, ...diff.changed, ...diff.missing, ...diff.removed]);
}

function hasGeneratedChangelogPath(paths: readonly string[]): boolean {
  return paths.some((path) => path.endsWith("/CHANGELOG.md") || path === "CHANGELOG.md");
}

async function sourceSuggestionsForDrift(
  rootPath: string,
  drift: SkillsetDiff,
  options: SkillsetOptions
): Promise<readonly SourceSuggestionReport[]> {
  const paths = [...new Set([...drift.added, ...drift.changed])];
  const reports: SourceSuggestionReport[] = [];
  for (const path of paths) {
    try {
      const preview = await reconcileManagedPath(rootPath, path, options);
      reports.push({ ...preview.outputResolution, nextSteps: [] });
    } catch (error) {
      reports.push({
        entries: [],
        generatedPath: path,
        message: errorMessage(error),
        nextSteps: [],
        status: "refused",
        wouldWrite: false,
        wrote: false,
      });
    }
  }
  return reports;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const CI_WORKFLOW_PATH = ".github/workflows/skillset-ci.yml";

/**
 * GitHub Actions workflow scaffolded by `skillset init --include ci` and
 * `skillset init --include ci`. Mechanical drift is rebuilt and pushed back to
 * same-repo pull-request branches; non-mechanical problems become an updated
 * PR comment and a failing check. Fork PRs run read-only because they cannot
 * receive pushes or comments with the default token, so they only get the
 * failing check and job summary.
 */
export function renderCiWorkflow(): string {
  return [
    "# Scaffolded by skillset init --include ci. Skillset does not manage this file; edit freely.",
    "# Consider pinning skillset to an exact version for reproducible CI runs.",
    "# Notes:",
    "# - Mechanical fixes pushed with GITHUB_TOKEN do not retrigger workflows; if your",
    "#   branch protection requires checks on the fixed commit, push with a PAT instead.",
    "# - The comment step prefers gh >= 2.68 (--create-if-none) and falls back to a new comment.",
    "name: Skillset CI",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  skillset-ci:",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: write",
    "      pull-requests: write",
    "    steps:",
    "      - name: Checkout same-repo pull request",
    "        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "          ref: ${{ github.event.pull_request.head.ref }}",
    "      - name: Checkout fork pull request",
    "        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - name: Checkout push",
    "        if: github.event_name != 'pull_request'",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: oven-sh/setup-bun@v2",
    "      - name: Run skillset check",
    "        id: skillset",
    "        run: >-",
    "          bunx skillset check --ci",
    "          ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && '--fix' || '' }}",
    '          --report "$RUNNER_TEMP/skillset-ci-report.md"',
    "        continue-on-error: true",
    "      - name: Add report to job summary",
    "        if: always()",
    "        run: |",
    '          if [ -f "$RUNNER_TEMP/skillset-ci-report.md" ]; then',
    '            cat "$RUNNER_TEMP/skillset-ci-report.md" >> "$GITHUB_STEP_SUMMARY"',
    "          fi",
    "      - name: Push mechanical fixes",
    "        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
    "        env:",
    "          HEAD_REF: ${{ github.event.pull_request.head.ref }}",
    "        run: |",
    '          if [ -z "$(git status --porcelain)" ]; then',
    "            exit 0",
    "          fi",
    '          git config user.name "github-actions[bot]"',
    '          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
    "          git add -A",
    '          git commit -m "chore(skillset): rebuild generated output"',
    '          git push origin "HEAD:$HEAD_REF"',
    "      - name: Comment report on PR",
    "        if: steps.skillset.outcome == 'failure' && github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "          GH_REPO: ${{ github.repository }}",
    "          PR_NUMBER: ${{ github.event.pull_request.number }}",
    "        run: |",
    '          gh pr comment "$PR_NUMBER" --repo "$GH_REPO" \\',
    "            --edit-last --create-if-none \\",
    '            --body-file "$RUNNER_TEMP/skillset-ci-report.md" \\',
    '          || gh pr comment "$PR_NUMBER" --repo "$GH_REPO" \\',
    '            --body-file "$RUNNER_TEMP/skillset-ci-report.md"',
    "      - name: Fail when problems remain",
    "        if: steps.skillset.outcome == 'failure'",
    "        run: exit 1",
    "",
  ].join("\n");
}
