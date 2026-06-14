import { changeCheck, type ChangeCheckIssue } from "./change-entries";
import { buildSkillset, diffSkillset, type SkillsetDiff } from "./build";
import { inspectSkillset } from "./lint";
import { loadBuildGraph } from "./resolver";
import type { LintIssue, SkillsetOptions } from "./types";

export interface CiOptions extends SkillsetOptions {
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
  /** Generated-output drift remaining after any fix. */
  readonly drift: SkillsetDiff;
  /** Generated paths rewritten by a `--fix` rebuild. */
  readonly fixedPaths: readonly string[];
  readonly lintIssues: readonly LintIssue[];
  readonly ok: boolean;
  readonly warnings: readonly string[];
}

const EMPTY_DRIFT: SkillsetDiff = { added: [], changed: [], missing: [], removed: [] };

/**
 * Aggregate the checks a continuous-integration run needs: lint diagnostics,
 * change-entry coverage, and generated-output drift. Drift is the only
 * mechanical problem: with `fix` enabled, no lint errors, clean change
 * coverage, and a resolved baseline, `ci` rebuilds generated output the same
 * way `skillset build --yes` would. Lint errors, missing change entries, and
 * build errors need authored source changes, so they stay report-only; lint
 * warnings are advisory and never fail the run.
 */
export async function ciSkillset(rootPath: string, options: CiOptions = {}): Promise<CiReport> {
  const { fix, since, ...buildOptions } = options;

  let lintIssues: readonly LintIssue[] = [];
  let warnings: readonly string[] = [];
  let buildError: string | undefined;
  try {
    const graph = await loadBuildGraph(rootPath, buildOptions);
    lintIssues = (await inspectSkillset(graph)).issues;
    warnings = graph.warnings;
  } catch (error) {
    buildError = errorMessage(error);
  }

  let changeIssues: readonly ChangeCheckIssue[] = [];
  let changeError: string | undefined;
  try {
    changeIssues = (await changeCheck(rootPath, {
      ...buildOptions,
      ...(since === undefined ? {} : { since }),
    })).issues;
  } catch (error) {
    changeError = errorMessage(error);
  }

  let drift: SkillsetDiff = EMPTY_DRIFT;
  if (buildError === undefined) {
    try {
      drift = await diffSkillset(rootPath, buildOptions);
    } catch (error) {
      buildError = errorMessage(error);
    }
  }

  const changeErrors = changeIssues.filter((issue) => issue.severity === "error");
  const lintErrors = lintIssues.filter((issue) => issue.severity === "error");

  // Rebuild only when drift is the sole problem: lint errors, change-entry
  // errors, or a build error mean the source is not trustworthy, and an
  // unresolvable change baseline means the CI setup itself needs fixing before
  // pushing rebuild commits. Lint warnings are advisory and do not block.
  let fixedPaths: readonly string[] = [];
  if (
    fix === true &&
    hasDrift(drift) &&
    buildError === undefined &&
    changeError === undefined &&
    changeErrors.length === 0 &&
    lintErrors.length === 0
  ) {
    const staleBefore = [...drift.added, ...drift.changed, ...drift.missing, ...drift.removed];
    try {
      await buildSkillset(rootPath, buildOptions);
      drift = await diffSkillset(rootPath, buildOptions);
      const remaining = new Set([...drift.added, ...drift.changed, ...drift.missing, ...drift.removed]);
      fixedPaths = staleBefore.filter((path) => !remaining.has(path));
    } catch (error) {
      buildError = errorMessage(error);
    }
  }

  return {
    ...(buildError === undefined ? {} : { buildError }),
    ...(changeError === undefined ? {} : { changeError }),
    changeIssues,
    drift,
    fixedPaths,
    lintIssues,
    ok:
      buildError === undefined &&
      changeError === undefined &&
      lintErrors.length === 0 &&
      changeErrors.length === 0 &&
      !hasDrift(drift),
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

  if (report.ok && report.fixedPaths.length === 0 && lintWarnings.length === 0) {
    lines.push("All checks passed: source lint, change entries, and generated output are current.", "");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  if (report.ok) {
    lines.push(
      report.fixedPaths.length > 0
        ? "Generated output was stale and has been rebuilt mechanically. No source changes are needed."
        : "All checks passed; the lint warnings below are advisory and do not fail CI.",
      ""
    );
  } else {
    lines.push("Skillset CI found problems; the sections below explain each one.", "");
  }

  if (report.fixedPaths.length > 0) {
    lines.push("### Rebuilt generated output", "");
    for (const path of report.fixedPaths) lines.push(`- \`${path}\``);
    lines.push("", "These files were regenerated from source the same way `skillset build --yes` would. Commit the rebuilt output if it is not committed for you.", "");
  }

  if (hasDrift(report.drift)) {
    lines.push("### Stale generated output", "");
    for (const path of report.drift.added) lines.push(`- added: \`${path}\``);
    for (const path of report.drift.changed) lines.push(`- changed: \`${path}\``);
    for (const path of report.drift.missing) lines.push(`- missing: \`${path}\``);
    for (const path of report.drift.removed) lines.push(`- removed: \`${path}\``);
    lines.push("", "Run `skillset build --yes`, review the generated diff, and commit it.", "");
  }

  if (lintErrors.length > 0) {
    lines.push("### Lint issues", "");
    for (const issue of lintErrors) {
      lines.push(`- \`${issue.path}\`: ${issue.code}: ${issue.message}`);
    }
    lines.push("", "Fix the source issues, then run `skillset lint` locally.", "");
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
    lines.push(
      "",
      "Add or fix pending change entries with `skillset change add --scope <source-unit> --bump <bump> --reason \"...\"`.",
      ""
    );
  }

  if (report.buildError !== undefined) {
    lines.push("### Build error", "", codeBlock(report.buildError), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function codeBlock(content: string): string {
  return ["```", content.trimEnd(), "```"].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const CI_WORKFLOW_PATH = ".github/workflows/skillset-ci.yml";

/**
 * GitHub Actions workflow scaffolded by `skillset init --include ci` and
 * `skillset create --include ci`. Mechanical drift is rebuilt and pushed back to
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
    "      - name: Run skillset ci",
    "        id: skillset",
    "        run: >-",
    "          bunx skillset ci",
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
