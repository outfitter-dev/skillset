import { resolve } from "node:path";

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
import type { InteractiveSession } from "./interactive-session";
import type { PromptChoice } from "./prompt-adapter";
import {
  initSkillset,
  type SetupImportCandidate,
  type SetupInclude,
  type SetupReport,
} from "./setup";

export type InteractiveInitMode = "create" | "current" | "import";
type CandidateSelection = "all" | string;

const ADOPTION_SEARCH_THRESHOLD = 8;

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
  readonly candidates: readonly string[];
  readonly destination: string | undefined;
  readonly include: readonly SetupInclude[];
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
  const mode = await resolveMode(request, session);
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
    candidates,
    destination,
    include,
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
  session: InteractiveSession
): Promise<InteractiveInitMode> {
  if (request.initFrom !== undefined) return "import";
  if (request.initAdopt !== undefined && request.destination !== undefined) {
    return "import";
  }
  if (request.destination !== undefined) return "create";
  if (request.rootExplicit || request.initAdopt !== undefined) return "current";
  return session.prompts.select({
    choices: [
      { name: "Set up the current repository", value: "current" },
      { name: "Create a new Skillset workspace", value: "create" },
      { name: "Import an existing repository", value: "import" },
    ],
    default: "current",
    message: "What would you like to initialize?",
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
    message: "Destination directory:",
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
    message: "Local path or Git URL to import:",
    validate: requiredValue("import source"),
  });
  return value.trim();
}

export async function promptForInteractiveCandidates(
  candidates: readonly SetupImportCandidate[],
  session: InteractiveSession
): Promise<readonly string[]> {
  if (candidates.length === 0) return [];
  const choices: readonly PromptChoice<CandidateSelection>[] = [
    {
      checked: true,
      description: "Select every detected source",
      name: "All detected sources (recommended)",
      value: "all",
    },
    ...candidates.map((candidate) => ({
      name: `${candidate.kind} ${candidate.path}`,
      value: adoptCandidateId(candidate),
    })),
  ];
  const prompt = {
    choices,
    message: "Sources to adopt (select none for scaffold only):",
  };
  const selected =
    candidates.length >= ADOPTION_SEARCH_THRESHOLD
      ? await session.prompts.searchCheckbox<CandidateSelection>({
          ...prompt,
          source: filterAdoptionChoices,
        })
      : await session.prompts.checkbox<CandidateSelection>(prompt);
  return selectInteractiveCandidateIds(candidates, selected);
}

function filterAdoptionChoices(
  term: string | undefined,
  choices: readonly PromptChoice<CandidateSelection>[]
): readonly PromptChoice<CandidateSelection>[] {
  const query = term?.trim().toLowerCase() ?? "";
  if (query.length === 0) return choices;
  return choices.filter(
    (choice) =>
      choice.value === "all" ||
      choice.name.toLowerCase().includes(query) ||
      choice.description?.toLowerCase().includes(query)
  );
}

export function selectInteractiveCandidateIds(
  candidates: readonly SetupImportCandidate[],
  selected: readonly CandidateSelection[]
): readonly string[] {
  const individual = selected.filter((candidate) => candidate !== "all");
  if (individual.length === 0 && selected.includes("all")) {
    return candidates.map(adoptCandidateId);
  }
  return [...new Set(individual)];
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
        description: "Add the repository CI workflow",
        name: "Continuous integration",
        value: "ci" as const,
      },
    ],
    message: "Optional integrations:",
  });
}

function requiredValue(label: string): (value: string) => true | string {
  return (value) =>
    value.trim().length > 0 ? true : `skillset: ${label} is required`;
}
