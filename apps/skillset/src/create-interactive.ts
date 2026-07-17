import { resolve } from "node:path";

import { targetNames } from "@skillset/core/internal/config";
import { validateSlug } from "@skillset/core/internal/path";
import type { TargetName } from "@skillset/core/internal/types";

import type { InteractiveSession } from "./interactive-session";
import {
  createSkillset,
  type SetupInclude,
  type SetupReport,
} from "./setup";

export interface InteractiveCreateRequest {
  readonly name: string | undefined;
  readonly parentExplicit: boolean;
  readonly parentPath: string;
  readonly setupIncludes: readonly SetupInclude[] | undefined;
  readonly setupTargets: readonly TargetName[] | undefined;
}

export interface InteractiveCreatePlan {
  readonly include: readonly SetupInclude[];
  readonly name: string;
  readonly parentPath: string;
  readonly report: SetupReport;
  readonly targets: readonly TargetName[];
}

export interface InteractiveCreateContext {
  readonly printPlan: (plan: InteractiveCreatePlan) => void;
}

export interface InteractiveCreateResult {
  readonly reason: "write confirmation declined" | "written";
  readonly report: SetupReport;
}

export async function runInteractiveCreate(
  request: InteractiveCreateRequest,
  session: InteractiveSession,
  context: InteractiveCreateContext
): Promise<InteractiveCreateResult> {
  const name = request.name === undefined
    ? normalizeCreateName(await session.prompts.input({
        message: "What should this Skillset be called?",
        validate: (value) => validateCreateName(value),
      }))
    : normalizeCreateName(request.name);
  const parentPath = request.parentExplicit
    ? resolve(request.parentPath)
    : resolve(await session.prompts.input({
        default: resolve(request.parentPath),
        message: "Where should it be created?",
        validate: (value) => value.trim().length > 0
          ? true
          : "skillset: parent directory is required",
      }));
  const targets = request.setupTargets ?? await promptForCreateTargets(session);
  const include = request.setupIncludes ?? await promptForIntegrations(session);
  const report = await createSkillset({
    cwd: parentPath,
    include,
    name,
    rootPath: resolve(parentPath, name),
    targets,
    write: false,
  });
  context.printPlan({ include, name, parentPath, report, targets });
  const confirmed = await session.prompts.confirm({
    default: false,
    message: "Proceed?",
  });
  if (!confirmed) return { reason: "write confirmation declined", report };
  return {
    reason: "written",
    report: await createSkillset({
      cwd: parentPath,
      include,
      name,
      rootPath: resolve(parentPath, name),
      targets,
      write: true,
    }),
  };
}

async function promptForCreateTargets(
  session: InteractiveSession
): Promise<readonly TargetName[]> {
  const mode = await session.prompts.select<"all" | "specific">({
    choices: [
      {
        description: "Generate every supported provider projection",
        name: "All supported providers (Recommended)",
        value: "all",
      },
      {
        description: "Select one or more provider projections",
        name: "Choose specific providers",
        value: "specific",
      },
    ],
    default: "all",
    message: "Which providers should Skillset generate for?",
  });
  if (mode === "all") return targetNames();
  return session.prompts.checkbox({
    choices: targetNames().map((target) => ({
      checked: true,
      name: displayTarget(target),
      value: target,
    })),
    message: "Choose providers:",
    required: true,
  });
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

export function formatInteractiveCreatePlan(
  plan: InteractiveCreatePlan
): string {
  return [
    `Create repository ${plan.report.rootPath}`,
    `Name it ${plan.name}`,
    `Generate for ${formatHumanList(plan.targets.map(displayTarget))}`,
    "Create the canonical .skillset/ source layout",
    "Initialize a local Git repository",
    ...(plan.include.includes("ci") ? ["Add the Skillset GitHub Action"] : []),
    "",
  ].join("\n");
}

export function normalizeCreateName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return validateSlug(normalized, "skillset create name");
}

function validateCreateName(value: string): true | string {
  try {
    normalizeCreateName(value);
    return true;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function displayTarget(target: TargetName): string {
  return `${target[0]?.toUpperCase() ?? ""}${target.slice(1)}`;
}

function formatHumanList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return values.join(" and ");
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
