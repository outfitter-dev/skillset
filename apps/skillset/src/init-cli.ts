import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { sourceUnitDisplay } from "@skillset/core/internal/source-unit-selector";
import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import { ADOPT_REPORT_DIR, adoptCandidateId, adoptSkillset } from "./adopt";
import type { AdoptReport } from "./adopt";
import { rememberKnownSkillsetWorkspace } from "./cli-known-workspaces";
import { printCliJsonData } from "./cli-output";
import { initSkillset } from "./setup";
import type { SetupInclude, SetupReport } from "./setup";

export interface InitCommandRequest {
  readonly importName: string | undefined;
  readonly destination: string | undefined;
  readonly initAdopt: readonly string[] | undefined;
  readonly initFrom: string | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootExplicit: boolean;
  readonly rootPath: string;
  readonly setupIncludes: readonly SetupInclude[] | undefined;
  readonly setupTargets: readonly TargetName[] | undefined;
  readonly yes: boolean;
}

export async function runInitCommand({
  importName,
  destination,
  initAdopt,
  initFrom,
  jsonOutput,
  options,
  rootExplicit,
  rootPath,
  setupIncludes,
  setupTargets,
  yes,
}: InitCommandRequest): Promise<void> {
  const initCwd = resolve(rootPath);
  const explicitInitRootPath = rootExplicit ? initCwd : undefined;
  const setupRootPath = destination ?? explicitInitRootPath;
  if (initAdopt !== undefined || initFrom !== undefined) {
    const writeMode = initAdopt !== undefined && yes;
    const inferredRoot =
      initFrom === undefined
        ? (
            await initSkillset({
              cwd: initCwd,
              ...(explicitInitRootPath === undefined
                ? {}
                : { rootPath: explicitInitRootPath }),
              useGitRoot: !rootExplicit,
              write: false,
            })
          ).rootPath
        : rootPath;
    const report = await adoptSkillset(initFrom ?? inferredRoot, {
      cwd: initCwd,
      ...(initAdopt === undefined ? {} : { candidates: initAdopt }),
      ...(destination === undefined
        ? {}
        : { destination: resolve(initCwd, destination) }),
      ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
      ...(importName === undefined ? {} : { name: importName }),
      ...(setupTargets === undefined ? {} : { targets: setupTargets }),
      write: writeMode,
    });
    const reason = writeMode
      ? report.write
        ? "written"
        : "blocked before write"
      : "write confirmation required";
    if (jsonOutput && writeMode && report.ok) {
      await rememberKnownSkillsetWorkspace(report.rootPath, options, true);
    }
    if (jsonOutput) {
      printCliJsonData(
        "init.adopt",
        {
          report,
          state: report.writtenPaths.length > 0 ? "written" : "planned",
          writes: report.writtenPaths,
        },
        report.ok ? 0 : 1
      );
    } else {
      printAdoptReport(report, reason);
      if (!writeMode && report.ok && initAdopt !== undefined) {
        console.log(
          "skillset: rerun init with --adopt and --yes to write adopted source"
        );
      }
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
    if (!jsonOutput && writeMode && report.ok) {
      await rememberKnownSkillsetWorkspace(report.rootPath, options);
    }
    return;
  }
  if (!jsonOutput && !yes && process.stdin.isTTY && process.stdout.isTTY) {
    const survey = await initSkillset({
      cwd: initCwd,
      ...(setupRootPath === undefined ? {} : { rootPath: setupRootPath }),
      ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
      ...(setupTargets === undefined ? {} : { targets: setupTargets }),
      useGitRoot: setupRootPath === undefined,
      write: false,
    });
    if (survey.importCandidates.length > 0) {
      printSetupReport(survey, "interactive preview");
      const selection = await promptForInitAdoption(survey.importCandidates);
      if (selection.confirmed && selection.candidates.length > 0) {
        const report = await adoptSkillset(destination ?? survey.rootPath, {
          candidates: selection.candidates,
          cwd: initCwd,
          ...(importName === undefined ? {} : { name: importName }),
          ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
          ...(setupTargets === undefined ? {} : { targets: setupTargets }),
          write: true,
        });
        printAdoptReport(
          report,
          report.write ? "written" : "blocked before write"
        );
        if (!report.ok) {
          process.exitCode = 1;
        } else {
          await rememberKnownSkillsetWorkspace(report.rootPath, options);
        }
        return;
      }
      if (!selection.confirmed) {
        printSetupReport(survey, "write confirmation declined");
        return;
      }
      const setup = await initSkillset({
        cwd: initCwd,
        ...(setupRootPath === undefined ? {} : { rootPath: setupRootPath }),
        ...(importName === undefined ? {} : { name: importName }),
        ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
        ...(setupTargets === undefined ? {} : { targets: setupTargets }),
        useGitRoot: setupRootPath === undefined,
        write: true,
      });
      printSetupReport(setup, "written");
      await rememberKnownSkillsetWorkspace(setup.rootPath, options);
      return;
    }
  }
  const setup = await initSkillset({
    cwd: initCwd,
    ...(setupRootPath === undefined ? {} : { rootPath: setupRootPath }),
    ...(importName === undefined ? {} : { name: importName }),
    ...(setupTargets === undefined ? {} : { targets: setupTargets }),
    ...(setupIncludes === undefined ? {} : { include: setupIncludes }),
    useGitRoot: setupRootPath === undefined,
    write: yes,
  });
  if (jsonOutput && yes) {
    await rememberKnownSkillsetWorkspace(setup.rootPath, options, true);
  }
  if (jsonOutput) {
    const writes = yes
      ? [
          ...setup.files
            .filter((file) => file.status === "create")
            .map((file) => file.path),
          ...(setup.git?.status === "create" ? [setup.git.path] : []),
          ...(setup.baselinePath === undefined ? [] : [setup.baselinePath]),
        ]
      : [];
    printCliJsonData("init", {
      report: setup,
      state: writes.length > 0 ? "written" : "planned",
      writes,
    });
  } else {
    printSetupReport(setup, yes ? "written" : "write confirmation required");
    if (!yes) {
      console.log("skillset: rerun init with --yes to write setup files");
    }
  }
  if (!jsonOutput && yes) {
    await rememberKnownSkillsetWorkspace(setup.rootPath, options);
  }
  return;
}

export function readInitAdoptionSelection(
  answer: string,
  candidates: readonly { readonly kind: string; readonly path: string }[]
): readonly string[] {
  const value = answer.trim();
  if (value === "" || value === "none") {
    return [];
  }
  const available = new Set(
    candidates.map((candidate) => `${candidate.kind}:${candidate.path}`)
  );
  const selected =
    value === "all"
      ? [...available]
      : value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
  for (const id of selected) {
    if (!available.has(id))
      throw new Error(`skillset: unknown adoption candidate ${id}`);
  }
  return [...new Set(selected)];
}

async function promptForInitAdoption(
  candidates: readonly { readonly kind: string; readonly path: string }[]
): Promise<{
  readonly candidates: readonly string[];
  readonly confirmed: boolean;
}> {
  console.log("skillset: detected adoptable sources");
  for (const candidate of candidates) {
    console.log(`  ${adoptCandidateId(candidate)}`);
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      "Adopt all, comma-separated candidate ids, or none [none]: "
    );
    const selected = readInitAdoptionSelection(answer, candidates);
    const confirmation = await prompt.question(
      `Write init plan (${selected.length === 0 ? "scaffold only" : `${selected.length} adoption candidate(s)`})? [y/N]: `
    );
    return {
      candidates: selected,
      confirmed: /^(?:y|yes)$/iu.test(confirmation.trim()),
    };
  } finally {
    prompt.close();
  }
}

function printAdoptReport(report: AdoptReport, reason: string): void {
  console.log(`skillset: adopt ${report.rootPath} (${reason})`);
  if (report.acquisition.kind === "git") {
    console.log(
      `  source: git ${report.acquisition.repo} @ ${report.acquisition.ref}`
    );
  }
  if (report.alreadyAdopted) {
    console.log(
      "  note: repo already has a Skillset workspace marker; adopting against existing source"
    );
  }
  for (const file of report.setupFiles) {
    console.log(`  ${file.status === "create" ? "+" : "="} ${file.path}`);
  }
  for (const candidate of report.candidates) {
    const sources =
      candidate.plugin === undefined
        ? ""
        : ` (${candidate.plugin.paths.join(", ")})`;
    console.log(
      `  ? import candidate ${candidate.kind} ${candidate.path}${sources} (id: ${adoptCandidateId(candidate)})`
    );
  }
  for (const diagnostic of report.surveyDiagnostics) {
    const marker = diagnostic.severity === "error" ? "FAIL" : "warning";
    console.log(
      `  ${marker} ${diagnostic.code} ${diagnostic.paths.join(", ")}: ${diagnostic.message}`
    );
    console.log(`    resolution: ${diagnostic.recommendation}`);
  }
  for (const skip of report.surveySkips) {
    console.log(`  ! skipped ${skip.surface} ${skip.path}: ${skip.reason}`);
  }
  if (!report.write) {
    return;
  }

  for (const result of report.imports) {
    const marker = result.ok ? "ok" : "FAIL";
    console.log(
      `  ${marker} import ${result.candidate.kind}:${result.candidate.path}${result.ok ? ` -> ${result.detail}` : `: ${result.detail}`}`
    );
  }
  const lintErrors = report.lintIssues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const lintWarnings = report.lintIssues.length - lintErrors;
  console.log(
    `  ${lintErrors === 0 ? "ok" : "FAIL"} lint: ${lintErrors} error(s), ${lintWarnings} warning(s)`
  );
  console.log(
    report.buildError === undefined
      ? `  ok build: wrote ${report.builtFiles} generated files under logical .skillset/cache/latest/ (XDG-backed)`
      : `  FAIL build: ${report.buildError.split("\n")[0]}`
  );
  if (report.cutover.length > 0) {
    console.log(`  cutover: ${report.cutover.join(", ")} (see report)`);
  }
  console.log(`  report: ${ADOPT_REPORT_DIR}/report.md`);
  console.log(`skillset: adopt ${report.ok ? "passed" : "found problems"}`);
}

function printSetupReport(result: SetupReport, reason: string): void {
  for (const file of result.files) {
    const marker = file.status === "create" ? "+" : "=";
    console.log(`  ${marker} ${file.path}`);
  }
  if (result.git !== undefined) {
    const marker = result.git.status === "create" ? "+" : "=";
    console.log(`  ${marker} ${result.git.path}`);
  }
  for (const baseline of result.baselines) {
    const marker = baseline.status === "create" ? "+" : "=";
    console.log(
      `  ${marker} baseline ${sourceUnitDisplay(baseline.scope)} ${baseline.version}`
    );
  }
  for (const candidate of result.importCandidates) {
    console.log(
      `  ? import candidate ${candidate.kind} ${candidate.path} (id: ${adoptCandidateId(candidate)})`
    );
  }
  for (const diagnostic of result.surveyDiagnostics) {
    const marker = diagnostic.severity === "error" ? "FAIL" : "warning";
    console.log(
      `  ${marker} ${diagnostic.code} ${diagnostic.paths.join(", ")}: ${diagnostic.message}`
    );
    console.log(`    resolution: ${diagnostic.recommendation}`);
  }
  for (const skip of result.surveySkips) {
    console.log(`  ! skipped ${skip.surface} ${skip.path}: ${skip.reason}`);
  }
  const created = result.files.filter(
    (file) => file.status === "create"
  ).length;
  const existing = result.files.length - created;
  const gitCreated = result.git?.status === "create" ? 1 : 0;
  const gitExisting = result.git?.status === "exists" ? 1 : 0;
  const baselines = result.baselines.filter(
    (baseline) => baseline.status === "create"
  ).length;
  const candidates = result.importCandidates.length;
  const details = [
    `${created + gitCreated} to create`,
    `${existing + gitExisting} already present`,
    ...(baselines === 0
      ? []
      : [`${baselines} baseline${baselines === 1 ? "" : "s"} to adopt`]),
    ...(candidates === 0
      ? []
      : [`${candidates} import candidate${candidates === 1 ? "" : "s"}`]),
  ];
  console.log(`skillset: ${result.kind} ${details.join(", ")} (${reason})`);
  console.log(`  root: ${result.rootPath}`);
}
