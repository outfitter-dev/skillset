import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";
import {
  adaptiveHookEventDefinitions,
  planAdaptiveHookCompatibility,
} from "@skillset/core/internal/adaptive-hook-authoring";
import { targetNames } from "@skillset/core/internal/targets";

import type { InteractiveSession } from "./interactive-session";
import { listNewAdaptiveHookAttachmentTargets } from "./new-hook";
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
  const hookIntent = kind === "hook"
    ? await resolveHookIntent(request, session)
    : {};
  const options = {
    ...(container === undefined ? {} : { container }),
    ...(identity.id === undefined ? {} : { id: identity.id }),
    kind,
    ...hookIntent,
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

async function resolveHookIntent(
  request: InteractiveNewRequest,
  session: InteractiveSession
): Promise<{
  readonly hookAttachment: string;
  readonly hookCommand?: string;
  readonly hookEvents: readonly string[];
  readonly hookProviders?: readonly TargetName[];
  readonly hookScript?: string;
}> {
  const targets = await listNewAdaptiveHookAttachmentTargets(
    request.rootPath,
    request.options
  );
  if (targets.length === 0) {
    throw new Error(
      "skillset: new hook requires an existing plugin, skill, or project agent attachment target"
    );
  }
  const hookAttachment = request.hookAttachment ?? await session.prompts.search({
    message: "Attach to:",
    source: (term) => filterChoices(
      term,
      targets.map((target) => ({
        description: target.description,
        name: target.name,
        value: target.selector,
      }))
    ),
  });
  const target = targets.find((item) => item.selector === hookAttachment);
  if (target === undefined) {
    throw new Error(
      `skillset: hook attachment source unit ${hookAttachment} was not found`
    );
  }
  const eventChoices = adaptiveHookEventDefinitions().map((event) => {
    const plan = planAdaptiveHookCompatibility({
      events: [event.id],
      run: { command: "true" },
      scope: target.scope,
    });
    return {
      description: `Compatible providers: ${plan.providers.join(", ")}`,
      ...(plan.providers.length === 0
        ? { disabled: "No faithful provider destination for this attachment" }
        : {}),
      name: event.id,
      value: event.id,
    };
  });
  const hookEvents = request.hookEvents ?? await session.prompts.searchCheckbox({
    choices: eventChoices,
    message: "Events:",
    required: true,
    source: (term, choices) => filterChoices(term, choices),
  });
  const action = await resolveHookAction(request, session);
  const hookProviders = request.hookProviders ?? await resolveHookProviders(
    action,
    hookEvents,
    target.scope,
    session
  );
  return {
    hookAttachment,
    ...action,
    hookEvents,
    ...(hookProviders === undefined ? {} : { hookProviders }),
  };
}

async function resolveHookAction(
  request: InteractiveNewRequest,
  session: InteractiveSession
): Promise<{ readonly hookCommand?: string; readonly hookScript?: string }> {
  if (request.hookCommand !== undefined || request.hookScript !== undefined) {
    return {
      ...(request.hookCommand === undefined ? {} : { hookCommand: request.hookCommand }),
      ...(request.hookScript === undefined ? {} : { hookScript: request.hookScript }),
    };
  }
  const kind = await session.prompts.select({
    choices: [
      {
        description: "Run a shell command directly",
        name: "Command",
        value: "command" as const,
      },
      {
        description: "Run an existing source script",
        name: "Script",
        value: "script" as const,
      },
    ],
    default: "command" as const,
    message: "Action:",
  });
  const value = await session.prompts.input({
    message: kind === "command" ? "Command:" : "Script path:",
    validate: (input) => input.trim().length > 0 || "Enter a hook action.",
  });
  return kind === "command"
    ? { hookCommand: value }
    : { hookScript: value };
}

async function resolveHookProviders(
  action: { readonly hookCommand?: string; readonly hookScript?: string },
  events: readonly string[],
  scope: Parameters<typeof planAdaptiveHookCompatibility>[0]["scope"],
  session: InteractiveSession
): Promise<readonly TargetName[] | undefined> {
  const plan = planAdaptiveHookCompatibility({
    events,
    run: hookRunForCompatibility(action),
    scope,
  });
  const compatible = new Set(plan.providers);
  const choices = targetNames().map((target) => {
    const classification = plan.classifications.find(
      (item) =>
        item.target === target &&
        !compatible.has(target) &&
        item.reason !== undefined
    );
    return {
      checked: compatible.has(target),
      description: compatible.has(target)
        ? "Compatible"
        : (classification?.reason ?? "Not compatible with this hook intent"),
      disabled: compatible.has(target) ? false : (classification?.reason ?? true),
      name: target,
      value: target,
    };
  });
  session.note(
    choices
      .map((choice) =>
        `${choice.name}: ${choice.disabled ? choice.description : "compatible"}`
      )
      .join("\n"),
    "Compatibility"
  );
  if (plan.providers.length <= 1) {
    return undefined;
  }
  const selected = await session.prompts.checkbox({
    choices,
    message: "Providers:",
    required: true,
  });
  return selected.length === plan.providers.length ? undefined : selected;
}

function hookRunForCompatibility(action: {
  readonly hookCommand?: string;
  readonly hookScript?: string;
}): { readonly command: string } | { readonly script: string } {
  if (
    (action.hookCommand === undefined) === (action.hookScript === undefined)
  ) {
    throw new Error(
      "skillset: new hook requires exactly one of --command or --script"
    );
  }
  return action.hookCommand === undefined
    ? { script: action.hookScript ?? "" }
    : { command: action.hookCommand };
}

function filterChoices<Value>(
  term: string | undefined,
  choices: readonly {
    readonly description?: string;
    readonly name: string;
    readonly value: Value;
  }[]
): readonly {
  readonly description?: string;
  readonly name: string;
  readonly value: Value;
}[] {
  const query = term?.trim().toLowerCase() ?? "";
  return query.length === 0
    ? choices
    : choices.filter((choice) =>
        `${choice.name} ${choice.description ?? ""}`.toLowerCase().includes(query)
      );
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
