import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { ReleaseBaselineEntry } from "./adoption";
import { buildSkillset, ISOLATED_OUT_ROOT } from "./build";
import { importSources } from "./import";
import { inspectSkillset } from "./lint";
import { loadBuildGraph } from "./resolver";
import {
  initSkillset,
  type SetupFile,
  type SetupImportCandidate,
  type SurveySkip,
} from "./setup";
import type { LintIssue, SkillsetOptions, TargetName } from "./types";

export interface AdoptOptions extends SkillsetOptions {
  readonly targets?: readonly TargetName[];
  readonly write?: boolean;
}

/** A plugin or skill landed in `.skillset/` by one candidate import. */
export interface AdoptImportedUnit {
  readonly kind: "plugin" | "skill";
  readonly name: string;
  /** Original path relative to the adopted root (`.` for a root plugin). */
  readonly sourcePath: string;
}

export interface AdoptImportResult {
  readonly candidate: SetupImportCandidate;
  /** Instructions destination relative to the root (e.g. `.skillset/instructions/agents.md`). */
  readonly destination?: string;
  readonly detail: string;
  readonly ok: boolean;
  readonly units: readonly AdoptImportedUnit[];
}

export interface AdoptReport {
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
  readonly ok: boolean;
  readonly rootPath: string;
  readonly setupFiles: readonly SetupFile[];
  readonly surveySkips: readonly SurveySkip[];
  readonly write: boolean;
}

/** Where write-mode adoption persists its migration report. */
export const ADOPT_REPORT_DIR = ".skillset/build/adopt";

const INSTRUCTIONS_DIR = ".skillset/instructions";

/**
 * One-action repo adoption: survey via `init`, import every candidate
 * (plugins, skills, and verbatim instruction files), lint without throwing,
 * and build isolated so the generated projection lands under
 * `.skillset/build/out/` instead of the repo's live surfaces. Write mode only
 * ever creates paths under `.skillset/`; plan mode (the default) runs the
 * survey alone and writes nothing.
 */
export async function adoptSkillset(
  rootPath: string,
  options: AdoptOptions = {}
): Promise<AdoptReport> {
  const { targets, write, ...buildOptions } = options;
  const writeMode = write === true;
  const resolvedRoot = resolve(rootPath);
  // Captured before init scaffolds config: an existing .skillset/config.yaml
  // means the repo was already adopted; adopt proceeds (init tolerates a valid
  // pre-existing config) but the report says so honestly.
  const alreadyAdopted = await exists(join(resolvedRoot, ".skillset/config.yaml"));

  const init = await initSkillset({
    cwd: resolvedRoot,
    useGitRoot: false,
    write: writeMode,
    ...(targets === undefined ? {} : { targets }),
  });

  if (!writeMode) {
    return {
      alreadyAdopted,
      baselines: init.baselines,
      builtFiles: 0,
      candidates: init.importCandidates,
      cutover: [],
      imports: [],
      lintIssues: [],
      ok: true,
      rootPath: init.rootPath,
      setupFiles: init.files,
      surveySkips: init.surveySkips,
      write: false,
    };
  }

  const imports: AdoptImportResult[] = [];
  const cutover: string[] = [];
  for (const candidate of init.importCandidates) {
    imports.push(await importCandidate(init.rootPath, candidate, cutover));
  }

  let lintIssues: readonly LintIssue[] = [];
  let buildError: string | undefined;
  try {
    const graph = await loadBuildGraph(init.rootPath, buildOptions);
    lintIssues = (await inspectSkillset(graph)).issues;
  } catch (error) {
    buildError = errorMessage(error);
  }

  let builtFiles = 0;
  if (buildError === undefined) {
    try {
      builtFiles = (await buildSkillset(init.rootPath, { ...buildOptions, isolated: true })).length;
    } catch (error) {
      buildError = errorMessage(error);
    }
  }

  const lintErrors = lintIssues.filter((issue) => issue.severity === "error");
  const report: AdoptReport = {
    alreadyAdopted,
    baselines: init.baselines,
    ...(buildError === undefined ? {} : { buildError }),
    builtFiles,
    candidates: init.importCandidates,
    cutover,
    imports,
    lintIssues,
    ok:
      imports.every((result) => result.ok) &&
      lintErrors.length === 0 &&
      buildError === undefined,
    rootPath: init.rootPath,
    setupFiles: init.files,
    surveySkips: init.surveySkips,
    write: true,
  };

  const reportDir = join(init.rootPath, ADOPT_REPORT_DIR);
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "report.md"),
    renderAdoptReportMarkdown(report, { rootPath: init.rootPath })
  );
  await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  return report;
}

/**
 * Import one survey candidate. Failures are recorded on the result, never
 * thrown: a single bad candidate must not abort the rest of the migration.
 */
async function importCandidate(
  rootPath: string,
  candidate: SetupImportCandidate,
  cutover: string[]
): Promise<AdoptImportResult> {
  if (candidate.kind === "instructions") {
    try {
      const destination = await importInstructionFile(rootPath, candidate.path);
      // The original instruction file stays in place; a live build would
      // regenerate it from the imported source and hit the unmanaged-overwrite
      // protection, so it belongs on the cutover list.
      cutover.push(candidate.path);
      return { candidate, destination, detail: destination, ok: true, units: [] };
    } catch (error) {
      return { candidate, detail: errorMessage(error), ok: false, units: [] };
    }
  }

  try {
    const batch = await importSources({
      kind: candidate.kind,
      rootPath,
      sourcePath: join(rootPath, candidate.path),
    });
    const units = batch.imports.map((report) => {
      const sourcePath = relative(rootPath, report.sourcePath).replaceAll("\\", "/");
      return {
        kind: report.kind,
        name: report.name,
        sourcePath: sourcePath.length === 0 ? "." : sourcePath,
      };
    });
    return {
      candidate,
      detail: `${units.map((unit) => `${unit.kind} ${unit.name}`).join(", ")} (${batch.files} files)`,
      ok: true,
      units,
    };
  } catch (error) {
    return { candidate, detail: errorMessage(error), ok: false, units: [] };
  }
}

/**
 * Minimal verbatim instructions import: copy the root instruction file into
 * `.skillset/instructions/` under its lowercased name (`AGENTS.md` ->
 * `agents.md`). The ADR's transform-on-adopt is a later slice; content copies
 * byte-for-byte and never overwrites an existing destination.
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

export function renderAdoptReportMarkdown(
  report: AdoptReport,
  opts: { readonly rootPath: string }
): string {
  const lintErrors = report.lintIssues.filter((issue) => issue.severity === "error");
  const lintWarnings = report.lintIssues.filter((issue) => issue.severity === "warn");
  const succeeded = report.imports.filter((result) => result.ok);
  const failed = report.imports.filter((result) => !result.ok);

  const lines: string[] = ["# Skillset adoption report", ""];

  lines.push("## Summary", "");
  lines.push(`- root: \`${opts.rootPath}\``);
  lines.push(`- result: ${report.ok ? "pass" : "fail"}`);
  if (report.alreadyAdopted) {
    lines.push("- note: the repo already had `.skillset/config.yaml`; adoption proceeded against the existing source tree");
  }
  lines.push(
    `- imports: ${succeeded.length} succeeded, ${failed.length} failed`,
    `- lint: ${lintErrors.length} error(s), ${lintWarnings.length} warning(s)`,
    report.buildError === undefined
      ? `- build (isolated): ${report.builtFiles} generated files`
      : "- build (isolated): failed",
    ""
  );

  lines.push("## Setup", "");
  for (const file of report.setupFiles) {
    lines.push(`- ${file.status === "create" ? "created" : "already present"}: \`${file.path}\``);
  }
  for (const baseline of report.baselines) {
    if (baseline.status !== "create") continue;
    lines.push(`- baseline: ${baseline.scope} ${baseline.version}`);
  }
  lines.push("");

  lines.push("## Imported", "");
  if (succeeded.length === 0) {
    lines.push("Nothing imported.", "");
  } else {
    for (const result of succeeded) {
      if (result.destination !== undefined) {
        lines.push(`- ${result.candidate.kind}: \`${result.candidate.path}\` -> \`${result.destination}\` (verbatim copy)`);
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

  lines.push("## Build (isolated)", "");
  if (report.buildError === undefined) {
    lines.push(
      `Wrote ${report.builtFiles} generated files into the mirror under \`${ISOLATED_OUT_ROOT}/\`, laid out as the repo root would be. The live tree is untouched.`,
      ""
    );
  } else {
    lines.push("```", report.buildError.trimEnd(), "```", "");
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
    "- `skillset check --isolated`",
    "- `skillset ci`",
    ""
  );

  return `${lines.join("\n").trimEnd()}\n`;
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
