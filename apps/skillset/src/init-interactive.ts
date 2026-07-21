import { resolve } from "node:path";

import { normalizeKnownSkillsetIdentity } from "@skillset/core";
import {
  defaultTargetNames,
  targetNames,
} from "@skillset/core/internal/config";
import type { TargetName } from "@skillset/core/internal/types";
import { formatList } from "@skillset/schema";

import { adoptCandidateId, adoptSkillset, type AdoptReport } from "./adopt";
import { gitSafeEnv } from "./git-env";
import { confirmProceed } from "./interactive-session";
import type { InteractiveSession } from "./interactive-session";
import {
  initSkillset,
  type SetupImportCandidate,
  type SetupInclude,
  type SetupReport,
} from "./setup";

type InteractiveAdoptionIntent = "all" | "choose" | "none";

export interface InteractiveInitRequest {
  readonly directory: string | undefined;
  readonly initAdopt: readonly string[] | undefined;
  readonly rootExplicit: boolean;
  readonly rootPath: string;
  readonly setupIncludes: readonly SetupInclude[] | undefined;
  readonly setupTargets: readonly TargetName[] | undefined;
}

export interface InteractiveInitContext {
  readonly printPlan: (plan: InteractiveInitPlan) => void;
}

export type InteractiveInitPlan = (
  | { readonly kind: "adopt"; readonly report: AdoptReport }
  | { readonly kind: "setup"; readonly report: SetupReport }
) & {
  readonly adoptionCandidates: readonly SetupImportCandidate[];
  readonly candidates: readonly string[];
  readonly discoveredCandidates: readonly SetupImportCandidate[];
  readonly include: readonly SetupInclude[];
  readonly location: string;
  readonly targets: readonly TargetName[];
};

export type InteractiveInitResult =
  | {
      readonly kind: "adopt";
      readonly reason:
        | "write confirmation declined"
        | "written"
        | "blocked before write";
      readonly report: AdoptReport;
    }
  | {
      readonly kind: "setup";
      readonly reason: "write confirmation declined" | "written";
      readonly report: SetupReport;
    };

/** Collects missing init inputs around the existing setup/adopt reports. */
export async function runInteractiveInit(
  request: InteractiveInitRequest,
  session: InteractiveSession,
  context: InteractiveInitContext
): Promise<InteractiveInitResult> {
  const cwd = resolve(request.rootPath);
  const requestedRoot =
    request.directory === undefined
      ? request.rootExplicit
        ? cwd
        : undefined
      : resolve(cwd, request.directory);
  const initial = await initSkillset({
    cwd,
    ...(requestedRoot === undefined ? {} : { rootPath: requestedRoot }),
    useGitRoot: requestedRoot === undefined,
    write: false,
  });
  const discovered = initial.importCandidates;
  const candidates =
    request.initAdopt ??
    (await promptForInteractiveCandidates(discovered, session));
  const selectedCandidates = selectedInteractiveCandidates(
    discovered,
    candidates
  );
  const targets =
    request.setupTargets ??
    (await promptForTargets(selectedCandidates, session));
  const include =
    request.setupIncludes ?? (await promptForIntegrations(session));
  const plan = await previewInit(
    initial.rootPath,
    candidates,
    include,
    targets
  );
  context.printPlan({
    ...plan,
    adoptionCandidates: selectedCandidates,
    candidates,
    discoveredCandidates: discovered,
    include,
    location: plan.report.rootPath,
    targets,
  });
  const confirmed = await confirmProceed(session);
  if (!confirmed) return { ...plan, reason: "write confirmation declined" };
  return executeInit(initial.rootPath, candidates, include, targets);
}

async function previewInit(
  rootPath: string,
  candidates: readonly string[],
  include: readonly SetupInclude[],
  targets: readonly TargetName[]
): Promise<
  | { readonly kind: "adopt"; readonly report: AdoptReport }
  | { readonly kind: "setup"; readonly report: SetupReport }
> {
  if (candidates.length > 0) {
    return {
      kind: "adopt",
      report: await adoptSkillset(rootPath, {
        candidates,
        cwd: rootPath,
        include,
        targets,
        write: false,
      }),
    };
  }
  return {
    kind: "setup",
    report: await initSkillset({
      cwd: rootPath,
      include,
      rootPath,
      targets,
      useGitRoot: false,
      write: false,
    }),
  };
}

async function executeInit(
  rootPath: string,
  candidates: readonly string[],
  include: readonly SetupInclude[],
  targets: readonly TargetName[]
): Promise<InteractiveInitResult> {
  if (candidates.length > 0) {
    const report = await adoptSkillset(rootPath, {
      candidates,
      cwd: rootPath,
      include,
      targets,
      write: true,
    });
    return {
      kind: "adopt",
      reason: report.write ? "written" : "blocked before write",
      report,
    };
  }
  return {
    kind: "setup",
    reason: "written",
    report: await initSkillset({
      cwd: rootPath,
      include,
      rootPath,
      targets,
      useGitRoot: false,
      write: true,
    }),
  };
}

export async function promptForInteractiveCandidates(
  candidates: readonly SetupImportCandidate[],
  session: InteractiveSession
): Promise<readonly string[]> {
  if (candidates.length === 0) return [];
  session.note(
    formatDiscoveredCandidates(candidates),
    "Found in this repository"
  );
  const intent = await session.prompts.select<InteractiveAdoptionIntent>({
    choices: [
      {
        description: "Import every detected source",
        name: "Import everything found (Recommended)",
        value: "all",
      },
      {
        description: "Review the detected sources",
        name: "Choose what to import",
        value: "choose",
      },
      {
        description: "Create an empty Skillset workspace",
        name: "Start empty",
        value: "none",
      },
    ],
    default: "all",
    message: "How should Skillset start?",
  });
  if (intent === "all") return candidates.map(adoptCandidateId);
  if (intent === "none") return [];
  return session.prompts.groupedCheckbox({
    groups: candidateGroups(candidates),
    message: "Choose what to import:",
    required: true,
  });
}

function candidateGroups(candidates: readonly SetupImportCandidate[]) {
  const groups = new Map<string, SetupImportCandidate[]>();
  for (const candidate of candidates) {
    const name = candidateGroupName(candidate.kind);
    groups.set(name, [...(groups.get(name) ?? []), candidate]);
  }
  return [...groups].map(([name, entries]) => ({
    choices: entries.map((candidate) => ({
      checked: true,
      name: interactiveCandidateLabel(candidate),
      value: adoptCandidateId(candidate),
    })),
    name,
  }));
}

function candidateGroupName(kind: SetupImportCandidate["kind"]): string {
  switch (kind) {
    case "instructions":
      return "Instruction files";
    case "plugin":
    case "plugins":
      return "Plugins";
    case "skills":
      return "Skills";
  }
}

export function selectedInteractiveCandidates(
  candidates: readonly SetupImportCandidate[],
  selected: readonly string[]
): readonly SetupImportCandidate[] {
  if (selected.includes("all")) return candidates;
  const selectedIds = new Set(selected);
  return candidates.filter((candidate) =>
    selectedIds.has(adoptCandidateId(candidate))
  );
}

async function promptForTargets(
  candidates: readonly SetupImportCandidate[],
  session: InteractiveSession
): Promise<readonly TargetName[]> {
  const defaults = new Set(interactiveTargetDefaults(candidates));
  return session.prompts.checkbox({
    choices: targetNames().map((target) => ({
      checked: defaults.has(target),
      name: displayTarget(target),
      value: target,
    })),
    message: "Generate for:",
    required: true,
  });
}

export function interactiveTargetDefaults(
  candidates: readonly SetupImportCandidate[]
): readonly TargetName[] {
  const detected = new Set(
    candidates.flatMap((candidate) => candidate.plugin?.providers ?? [])
  );
  return detected.size > 0 ? [...detected] : defaultTargetNames();
}

async function promptForIntegrations(
  session: InteractiveSession
): Promise<readonly SetupInclude[]> {
  return session.prompts.checkbox({
    choices: [
      {
        checked: true,
        description: "Run Skillset checks on pull requests",
        name: "Skillset GitHub Action",
        value: "ci" as const,
      },
    ],
    message: "Include automation:",
  });
}

export async function interactiveRepositoryDisplay(
  rootPath: string
): Promise<string> {
  const remote = await gitOutput(rootPath, "remote", "get-url", "origin");
  if (remote !== undefined) {
    const identity = normalizeKnownSkillsetIdentity(remote);
    if (identity?.startsWith("github:") === true) {
      return identity.slice("github:".length);
    }
  }
  return (
    (await gitOutput(rootPath, "rev-parse", "--show-toplevel")) ??
    resolve(rootPath)
  );
}

export function formatInteractiveInitPlan(plan: InteractiveInitPlan): string {
  return [
    `Initialize Skillset in ${plan.location}`,
    ...(plan.adoptionCandidates.length === 0
      ? plan.discoveredCandidates.length === 0
        ? []
        : ["Keep the detected files unchanged"]
      : [`Import ${formatCandidateCounts(plan.adoptionCandidates)}`]),
    `Generate for ${formatList(plan.targets.map(displayTarget), "and")}`,
    ...(plan.include.includes("ci") ? ["Add the Skillset GitHub Action"] : []),
    ...(plan.adoptionCandidates.length > 0
      ? ["Preserve the existing source files"]
      : []),
    "",
  ].join("\n");
}

function formatDiscoveredCandidates(
  candidates: readonly SetupImportCandidate[]
): string {
  return candidateCountLabels(candidates).join("\n");
}

function formatCandidateCounts(
  candidates: readonly SetupImportCandidate[]
): string {
  return formatList(candidateCountLabels(candidates), "and");
}

function candidateCountLabels(
  candidates: readonly SetupImportCandidate[]
): string[] {
  const counts = new Map<SetupImportCandidate["kind"], number>();
  for (const candidate of candidates) {
    counts.set(candidate.kind, (counts.get(candidate.kind) ?? 0) + 1);
  }
  const label = (
    kind: SetupImportCandidate["kind"],
    singular: string,
    plural: string
  ): string[] => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [`${count} ${count === 1 ? singular : plural}`];
  };
  return [
    ...label("plugin", "plugin", "plugins"),
    ...label("plugins", "plugin collection", "plugin collections"),
    ...label("skills", "skill collection", "skill collections"),
    ...label("instructions", "instruction file", "instruction files"),
  ];
}

function interactiveCandidateLabel(candidate: SetupImportCandidate): string {
  if (candidate.plugin !== undefined) {
    const providers = candidate.plugin.providers.map(displayTarget);
    const coverage = providers.length > 1 ? ` (${providers.join(", ")})` : "";
    return `${candidate.plugin.identity}${coverage}`;
  }
  return candidate.path;
}

function displayTarget(target: TargetName): string {
  return `${target[0]?.toUpperCase() ?? ""}${target.slice(1)}`;
}

async function gitOutput(
  rootPath: string,
  ...args: readonly string[]
): Promise<string | undefined> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return undefined;
  const output = stdout.trim();
  return output.length === 0 ? undefined : output;
}
