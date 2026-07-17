import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import type { InteractiveSession } from "./interactive-session";
import {
  discoverNewSourceContainers,
  NEW_SOURCE_KINDS,
  scaffoldSourceUnit,
  SKILL_PRESETS,
  type NewSourceKind,
  type NewSourceReport,
  type NewSourceScope,
  type SkillPreset,
} from "./new-source";

const WORKSPACE_CONTAINER = "__workspace__";
const SEARCH_THRESHOLD = 8;

export interface InteractiveNewRequest {
  readonly hookAttachment?: string;
  readonly hookCommand?: string;
  readonly hookEvents?: readonly string[];
  readonly hookProviders?: readonly TargetName[];
  readonly hookScript?: string;
  readonly positionalName: string | undefined;
  readonly newContainer: string | undefined;
  readonly newId: string | undefined;
  readonly newKind: NewSourceKind | undefined;
  readonly newName: string | undefined;
  readonly newPresets: readonly string[] | undefined;
  readonly newScope: NewSourceScope | undefined;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export interface InteractiveNewContext {
  readonly printPlan: (report: NewSourceReport) => void;
}

export interface InteractiveNewResult {
  readonly reason: "write confirmation declined" | "written";
  readonly report: NewSourceReport;
}

export async function runInteractiveNew(
  request: InteractiveNewRequest,
  session: InteractiveSession,
  context: InteractiveNewContext
): Promise<InteractiveNewResult> {
  const kind = request.newKind ?? (await promptForKind(session));
  const identity = await resolveIdentity(request, kind, session);
  const container = await resolveContainer(request, kind, session);
  const presets = await resolvePresets(request, kind, session);
  const options = {
    ...(container === undefined ? {} : { container }),
    ...(identity.id === undefined ? {} : { id: identity.id }),
    kind,
    ...(request.hookAttachment === undefined ? {} : { hookAttachment: request.hookAttachment }),
    ...(request.hookCommand === undefined ? {} : { hookCommand: request.hookCommand }),
    ...(request.hookEvents === undefined ? {} : { hookEvents: request.hookEvents }),
    ...(request.hookProviders === undefined ? {} : { hookProviders: request.hookProviders }),
    ...(request.hookScript === undefined ? {} : { hookScript: request.hookScript }),
    ...(identity.displayName === undefined
      ? {}
      : { displayName: identity.displayName }),
    ...(identity.name === undefined ? {} : { name: identity.name }),
    ...(presets === undefined ? {} : { presets }),
    ...(request.newScope === undefined ? {} : { scope: request.newScope }),
    skillsetOptions: request.options,
  } as const;
  const plan = await scaffoldSourceUnit(request.rootPath, {
    ...options,
    write: false,
  });
  context.printPlan(plan);
  const confirmed = await session.prompts.confirm({
    default: false,
    message: "Proceed?",
  });
  if (!confirmed) {
    return { reason: "write confirmation declined", report: plan };
  }
  const report = await scaffoldSourceUnit(request.rootPath, {
    ...options,
    write: true,
  });
  return { reason: "written", report };
}

async function promptForKind(
  session: InteractiveSession
): Promise<NewSourceKind> {
  return session.prompts.select({
    choices: NEW_SOURCE_KINDS.map((kind) => ({
      description: kind.description,
      ...(kind.enabled ? {} : { disabled: kind.reason ?? true }),
      name: kind.name,
      value: kind.id,
    })),
    default: "skill",
    message: "Create a new:",
  });
}

async function resolveIdentity(
  request: InteractiveNewRequest,
  kind: NewSourceKind,
  session: InteractiveSession
): Promise<{
  readonly displayName: string | undefined;
  readonly id: string | undefined;
  readonly name: string | undefined;
}> {
  if (
    request.positionalName !== undefined ||
    request.newId !== undefined ||
    request.newName !== undefined
  ) {
    return {
      displayName: request.newName,
      id: request.newId,
      name: request.positionalName,
    };
  }
  const name = await session.prompts.input({
    message: "Name:",
    validate: requiredValue("source name"),
  });
  return { displayName: undefined, id: undefined, name: name.trim() };
}

async function resolveContainer(
  request: InteractiveNewRequest,
  kind: NewSourceKind,
  session: InteractiveSession
): Promise<string | undefined> {
  if (
    (kind !== "skill" && kind !== "instruction") ||
    request.newContainer !== undefined
  ) {
    return request.newContainer;
  }
  const containers = await discoverNewSourceContainers(
    request.rootPath,
    request.options
  );
  if (containers.length === 0) return undefined;
  const choices = [
    {
      description:
        kind === "skill"
          ? "Create under the workspace skills directory"
          : "Create under the workspace instruction directory",
      name: "Workspace",
      value: WORKSPACE_CONTAINER,
    },
    ...containers.map((container) => ({
      description:
        kind === "skill"
          ? "Create inside this plugin"
          : "Create this instruction inside the plugin",
      name: container,
      value: container,
    })),
  ];
  const selected =
    containers.length >= SEARCH_THRESHOLD
      ? await session.prompts.search({
          default: WORKSPACE_CONTAINER,
          message: "Destination:",
          source: (term) => {
            const query = term?.trim().toLowerCase() ?? "";
            return query.length === 0
              ? choices
              : choices.filter((choice) =>
                  choice.name.toLowerCase().includes(query)
                );
          },
        })
      : await session.prompts.select({
          choices,
          default: WORKSPACE_CONTAINER,
          message: "Destination:",
        });
  return selected === WORKSPACE_CONTAINER ? undefined : selected;
}

async function resolvePresets(
  request: InteractiveNewRequest,
  kind: NewSourceKind,
  session: InteractiveSession
): Promise<readonly SkillPreset[] | undefined> {
  if (kind !== "skill" || request.newPresets !== undefined) {
    return request.newPresets as readonly SkillPreset[] | undefined;
  }
  return session.prompts.checkbox({
    choices: SKILL_PRESETS.map((preset) => ({
      checked: preset.id === "minimal",
      description: preset.description,
      name: preset.name,
      value: preset.id,
    })),
    message: "Include starting surfaces:",
  });
}

function requiredValue(label: string): (value: string) => true | string {
  return (value) =>
    value.trim().length > 0 ? true : `skillset: ${label} is required`;
}
