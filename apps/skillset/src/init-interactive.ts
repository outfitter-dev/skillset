import { resolve } from "node:path";

import { normalizeKnownSkillsetIdentity } from "@skillset/core";
import {
  defaultTargetNames,
  targetNames,
} from "@skillset/core/internal/config";
import type { TargetName } from "@skillset/core/internal/types";

import {
  adoptAcquiredSkillset,
  adoptCandidateId,
  adoptSkillset,
  type AdoptAcquisition,
  type AdoptOptions,
  type AdoptReport,
} from "./adopt";
import { gitSafeEnv } from "./git-env";
import type { InteractiveSession } from "./interactive-session";
import {
  initSkillset,
  type SetupImportCandidate,
  type SetupInclude,
  type SetupReport,
} from "./setup";

export type InteractiveInitMode = "create" | "current" | "import";
type InteractiveAdoptionIntent = "all" | "choose" | "none";

export interface InteractiveInitRequest {
  readonly destination: string | undefined;
  readonly importName: string | undefined;
  readonly initAdopt: readonly string[] | undefined;
  readonly initFrom: string | undefined;
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
  readonly destination: string | undefined;
  readonly discoveredCandidates: readonly SetupImportCandidate[];
  readonly include: readonly SetupInclude[];
  readonly location: string;
  readonly mode: InteractiveInitMode;
  readonly source: string | undefined;
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

/**
 * Collects missing init inputs around the existing setup/adopt reports. The
 * reports remain the source of truth for discoveries and the final plan; this
 * layer only chooses among what they expose.
 */
export async function runInteractiveInit(
  request: InteractiveInitRequest,
  session: InteractiveSession,
  context: InteractiveInitContext
): Promise<InteractiveInitResult> {
  const cwd = resolve(request.rootPath);
  const repositoryDisplay = await interactiveRepositoryDisplay(cwd);
  const mode = await resolveMode(request, session, repositoryDisplay);
  const destination = await resolveDestination(request, mode, session);
  const source = await resolveSource(request, mode, session);
  const presetCurrentRoot =
    request.initAdopt !== undefined && source === undefined
      ? (
          await initSkillset({
            cwd,
            ...(request.rootExplicit ? { rootPath: cwd } : {}),
            useGitRoot: !request.rootExplicit,
            write: false,
          })
        ).rootPath
      : undefined;
  const initial = await preview({
    candidates: request.initAdopt,
    ...(presetCurrentRoot === undefined
      ? {}
      : { currentRoot: presetCurrentRoot }),
    cwd,
    destination,
    include: request.setupIncludes,
    mode,
    name: request.importName,
    rootExplicit: request.rootExplicit,
    source,
    targets: request.setupTargets,
  });
  const discovered =
    initial.kind === "adopt"
      ? initial.report.candidates
      : initial.report.importCandidates;
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
  const currentRoot =
    presetCurrentRoot ??
    (mode === "current" ? initial.report.rootPath : undefined);
  const acquisition =
    initial.kind === "adopt" ? initial.report.acquisition : undefined;
  const plan = await preview({
    ...(acquisition === undefined ? {} : { acquisition }),
    candidates,
    ...(currentRoot === undefined ? {} : { currentRoot }),
    cwd,
    destination,
    include,
    mode,
    name: request.importName,
    rootExplicit: request.rootExplicit,
    source,
    targets,
  });
  context.printPlan({
    ...plan,
    adoptionCandidates: selectedCandidates,
    candidates,
    destination,
    discoveredCandidates: discovered,
    include,
    location:
      mode === "current"
        ? repositoryDisplay
        : (destination ?? plan.report.rootPath),
    mode,
    source,
    targets,
  });
  const confirmed = await session.prompts.confirm({
    default: false,
    message: "Proceed?",
  });
  if (!confirmed) {
    return { ...plan, reason: "write confirmation declined" };
  }
  return execute({
    ...(acquisition === undefined ? {} : { acquisition }),
    candidates,
    ...(currentRoot === undefined ? {} : { currentRoot }),
    cwd,
    destination,
    include,
    mode,
    name: request.importName,
    rootExplicit: request.rootExplicit,
    source,
    targets,
  });
}

interface ResolvedInteractiveInit {
  readonly acquisition?: AdoptAcquisition;
  readonly candidates: readonly string[] | undefined;
  readonly currentRoot?: string;
  readonly cwd: string;
  readonly destination: string | undefined;
  readonly include: readonly SetupInclude[] | undefined;
  readonly mode: InteractiveInitMode;
  readonly name: string | undefined;
  readonly rootExplicit: boolean;
  readonly source: string | undefined;
  readonly targets: readonly TargetName[] | undefined;
}

async function preview(
  input: ResolvedInteractiveInit
): Promise<
  | { readonly kind: "adopt"; readonly report: AdoptReport }
  | { readonly kind: "setup"; readonly report: SetupReport }
> {
  const setupRoot = setupRootPath(input);
  if (input.mode === "import" || (input.candidates?.length ?? 0) > 0) {
    const report = await runAdopt(input, setupRoot, false);
    return { kind: "adopt", report };
  }
  const report = await initSkillset({
    cwd: input.cwd,
    ...(setupRoot === undefined ? {} : { rootPath: setupRoot }),
    ...(input.include === undefined ? {} : { include: input.include }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.targets === undefined ? {} : { targets: input.targets }),
    useGitRoot: setupRoot === undefined,
    write: false,
  });
  return { kind: "setup", report };
}

async function execute(
  input: ResolvedInteractiveInit
): Promise<InteractiveInitResult> {
  const setupRoot = setupRootPath(input);
  if (input.mode === "import" || (input.candidates?.length ?? 0) > 0) {
    const report = await runAdopt(input, setupRoot, true);
    return {
      kind: "adopt",
      reason: report.write ? "written" : "blocked before write",
      report,
    };
  }
  const report = await initSkillset({
    cwd: input.cwd,
    ...(setupRoot === undefined ? {} : { rootPath: setupRoot }),
    ...(input.include === undefined ? {} : { include: input.include }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.targets === undefined ? {} : { targets: input.targets }),
    useGitRoot: setupRoot === undefined,
    write: true,
  });
  return { kind: "setup", reason: "written", report };
}

function runAdopt(
  input: ResolvedInteractiveInit,
  setupRoot: string | undefined,
  write: boolean
): Promise<AdoptReport> {
  const options: AdoptOptions = {
    ...(input.candidates === undefined ? {} : { candidates: input.candidates }),
    cwd: input.cwd,
    ...(input.mode === "import" && input.destination !== undefined
      ? { destination: input.destination }
      : {}),
    ...(input.include === undefined ? {} : { include: input.include }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.targets === undefined ? {} : { targets: input.targets }),
    write,
  };
  if (input.acquisition !== undefined) {
    return adoptAcquiredSkillset(input.acquisition, options);
  }
  return adoptSkillset(
    input.source ?? input.currentRoot ?? setupRoot ?? input.cwd,
    options
  );
}

function setupRootPath(input: ResolvedInteractiveInit): string | undefined {
  if (input.mode === "create") return input.destination;
  if (input.mode === "current") {
    return input.currentRoot ?? (input.rootExplicit ? input.cwd : undefined);
  }
  return undefined;
}

async function resolveMode(
  request: InteractiveInitRequest,
  session: InteractiveSession,
  repositoryDisplay: string
): Promise<InteractiveInitMode> {
  if (request.initFrom !== undefined) return "import";
  if (request.initAdopt !== undefined && request.destination !== undefined) {
    return "import";
  }
  if (request.destination !== undefined) return "create";
  if (request.rootExplicit || request.initAdopt !== undefined) return "current";
  return session.prompts.select({
    choices: [
      {
        name: `In this repository (${repositoryDisplay})`,
        value: "current",
      },
      { name: "In a new workspace elsewhere", value: "create" },
      { name: "Import from elsewhere", value: "import" },
    ],
    default: "current",
    message: "Set up a skillset:",
  });
}

async function resolveDestination(
  request: InteractiveInitRequest,
  mode: InteractiveInitMode,
  session: InteractiveSession
): Promise<string | undefined> {
  if (mode === "current") return undefined;
  if (request.destination !== undefined) {
    return resolve(request.rootPath, request.destination);
  }
  const value = await session.prompts.input({
    message: "Create at:",
    validate: requiredValue("destination directory"),
  });
  return resolve(request.rootPath, value.trim());
}

async function resolveSource(
  request: InteractiveInitRequest,
  mode: InteractiveInitMode,
  session: InteractiveSession
): Promise<string | undefined> {
  if (mode !== "import") return undefined;
  if (request.initFrom !== undefined) return request.initFrom;
  if (request.initAdopt !== undefined) return undefined;
  const value = await session.prompts.input({
    message: "Import from:",
    validate: requiredValue("import source"),
  });
  return value.trim();
}

export async function promptForInteractiveCandidates(
  candidates: readonly SetupImportCandidate[],
  session: InteractiveSession
): Promise<readonly string[]> {
  if (candidates.length === 0) return [];
  session.note(formatDiscoveredMaterial(candidates), "Found existing material");
  const intent = await session.prompts.select<InteractiveAdoptionIntent>({
    choices: [
      {
        description: "Adopt every detected source",
        name: "Everything found (Recommended)",
        value: "all",
      },
      {
        description: "Review the detected sources",
        name: "Choose what to adopt",
        value: "choose",
      },
      {
        description: "You can import it later with skillset import",
        name: "Nothing for now",
        value: "none",
      },
    ],
    default: "all",
    message: "Adopt into your skillset:",
  });
  if (intent === "all") return candidates.map(adoptCandidateId);
  if (intent === "none") return [];
  return session.prompts.checkbox({
    choices: candidates.map((candidate) => ({
      checked: true,
      name: interactiveCandidateLabel(candidate),
      value: adoptCandidateId(candidate),
    })),
    message: "Choose what to adopt:",
    required: true,
  });
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
      name: target[0]?.toUpperCase() + target.slice(1),
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
  const lines = [
    `Set up a skillset in ${plan.location}`,
    ...(plan.source === undefined ? [] : [`Import from ${plan.source}`]),
    ...(plan.adoptionCandidates.length === 0
      ? plan.discoveredCandidates.length === 0
        ? []
        : ["Leave the existing material unchanged"]
      : [`Adopt ${formatCandidateCounts(plan.adoptionCandidates)}`]),
    `Generate for ${formatHumanList(plan.targets.map(displayTarget))}`,
    ...(plan.include.includes("ci") ? ["Add the Skillset GitHub Action"] : []),
    ...(plan.adoptionCandidates.length > 0
      ? ["Preserve the existing source files"]
      : []),
    "",
    ...(plan.discoveredCandidates.length > 0 &&
    plan.adoptionCandidates.length === 0
      ? ["You can import it later with skillset import.", ""]
      : []),
  ];
  return lines.join("\n");
}

function formatDiscoveredMaterial(
  candidates: readonly SetupImportCandidate[]
): string {
  return [...candidateCountLabels(candidates)].join("\n");
}

function formatCandidateCounts(
  candidates: readonly SetupImportCandidate[]
): string {
  return formatHumanList(candidateCountLabels(candidates));
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
    return `plugin: ${candidate.plugin.identity}${coverage}`;
  }
  return candidate.kind === "plugin"
    ? `plugin: ${candidate.path}`
    : candidate.path;
}

function displayTarget(target: TargetName): string {
  return `${target[0]?.toUpperCase() ?? ""}${target.slice(1)}`;
}

function formatHumanList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return values.join(" and ");
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
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

function requiredValue(label: string): (value: string) => true | string {
  return (value) =>
    value.trim().length > 0 ? true : `skillset: ${label} is required`;
}
