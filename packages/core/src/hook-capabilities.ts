import {
  getProviderHookEvidence,
  type ProviderHookEvidence,
  type ProviderHookFieldEvidence,
  type ProviderHookMatcherEvaluation,
  type ProviderHookMatcherKind,
} from "@skillset/provider-formats";

import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type HookCapabilityProvider = TargetName;

export type HookScope = "agent" | "plugin" | "project" | "skill" | "user";

export type HookScopeSupport = "native" | "unsupported";

export type HookMatcherKind = ProviderHookMatcherKind;
export type HookMatcherEvaluation = ProviderHookMatcherEvaluation;

export interface HookProviderCapability {
  readonly asyncCommand: boolean;
  readonly canBlockByEvent: Readonly<Record<string, boolean>>;
  readonly configFields: {
    readonly groupFields: readonly string[];
    readonly handlerCommonFields: readonly string[];
    readonly rootFields: readonly string[];
  };
  readonly documentedEvents: ReadonlySet<string>;
  readonly handlerFieldsByType: Readonly<Record<string, readonly string[]>>;
  readonly handlerSkippedFieldsByType: Readonly<Record<string, readonly string[]>>;
  readonly handlerTypes: ReadonlySet<string>;
  readonly handlerTypesByEvent: Readonly<Record<string, ReadonlySet<string>>>;
  readonly inputFieldsByEvent: Readonly<Record<string, readonly ProviderHookFieldEvidence[]>>;
  readonly matcherByEvent: Readonly<Record<string, HookMatcherKind>>;
  readonly matcherEvaluationByEvent: Readonly<Record<string, HookMatcherEvaluation>>;
  readonly matcherValuesByEvent: Readonly<Record<string, readonly string[]>>;
  readonly outputFieldsByEvent: Readonly<Record<string, readonly string[]>>;
  readonly provider: HookCapabilityProvider;
  readonly providerRefByEvent: Readonly<Record<string, string>>;
  readonly rawOutputFieldsByEvent: Readonly<Record<string, readonly string[]>>;
  readonly runtimeNotesByEvent: Readonly<Record<string, readonly string[]>>;
  readonly scopeSupport: Readonly<Record<HookScope, HookScopeSupport>>;
  readonly statusMessage: boolean;
  readonly unsupportedOutputFieldsByEvent: Readonly<Record<string, readonly string[]>>;
}

export interface AdaptiveHookPathIssue {
  readonly code: "hook-aggregate-collision" | "hook-directory-ambiguous" | "hook-name-duplicate" | "hook-name-invalid";
  readonly message: string;
  readonly paths: readonly string[];
}

export type AdaptiveHookUnitPath =
  | {
      readonly kind: "adaptive-unit";
      readonly name: string;
      readonly path: string;
      readonly shape: "directory-hook" | "directory-named" | "flat";
    }
  | {
      readonly kind: "native-aggregate";
      readonly path: "hooks/hooks.json";
    }
  | {
      readonly kind: "ignored";
      readonly path: string;
    };

const CLAUDE_HOOK_EVIDENCE = getProviderHookEvidence("claude");
const CODEX_HOOK_EVIDENCE = getProviderHookEvidence("codex");

export const CLAUDE_HOOK_EVENTS: ReadonlySet<string> = eventSet(CLAUDE_HOOK_EVIDENCE);
export const CODEX_HOOK_EVENTS: ReadonlySet<string> = eventSet(CODEX_HOOK_EVIDENCE);
export const CODEX_HOOK_HANDLER_TYPES: ReadonlySet<string> = handlerTypeSet(CODEX_HOOK_EVIDENCE);

export const hookProviderCapabilities: Readonly<Record<HookCapabilityProvider, HookProviderCapability>> = {
  claude: capabilityFromEvidence(CLAUDE_HOOK_EVIDENCE, {
    asyncCommand: true,
    scopeSupport: {
      agent: "native",
      plugin: "native",
      project: "native",
      skill: "native",
      user: "native",
    },
    statusMessage: true,
  }),
  codex: capabilityFromEvidence(CODEX_HOOK_EVIDENCE, {
    asyncCommand: false,
    scopeSupport: {
      agent: "unsupported",
      plugin: "native",
      project: "native",
      skill: "unsupported",
      user: "native",
    },
    statusMessage: true,
  }),
};

function eventSet(evidence: ProviderHookEvidence): ReadonlySet<string> {
  return new Set(evidence.events.map((event) => event.name));
}

function handlerTypeSet(evidence: ProviderHookEvidence): ReadonlySet<string> {
  return new Set(evidence.handlerTypes.map((handler) => handler.type));
}

function capabilityFromEvidence(
  evidence: ProviderHookEvidence,
  options: {
    readonly asyncCommand: boolean;
    readonly scopeSupport: Readonly<Record<HookScope, HookScopeSupport>>;
    readonly statusMessage: boolean;
  }
): HookProviderCapability {
  return {
    asyncCommand: options.asyncCommand,
    canBlockByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.canBlock])),
    configFields: evidence.config,
    documentedEvents: eventSet(evidence),
    handlerFieldsByType: Object.fromEntries(evidence.handlerTypes.map((handler) => [handler.type, handler.fields])),
    handlerSkippedFieldsByType: Object.fromEntries(evidence.handlerTypes.map((handler) => [handler.type, handler.skippedFields ?? []])),
    handlerTypes: handlerTypeSet(evidence),
    handlerTypesByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, new Set(event.handlerTypes)])),
    inputFieldsByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.inputFields])),
    matcherByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.matcherKind])),
    matcherEvaluationByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.matcherEvaluation])),
    matcherValuesByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.matcherValues])),
    outputFieldsByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.outputFields])),
    provider: evidence.target,
    providerRefByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.providerRef])),
    rawOutputFieldsByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.rawOutputFields])),
    runtimeNotesByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.runtimeNotes])),
    scopeSupport: options.scopeSupport,
    statusMessage: options.statusMessage,
    unsupportedOutputFieldsByEvent: Object.fromEntries(evidence.events.map((event) => [event.name, event.unsupportedOutputFields])),
  };
}

export function hookHandlerTypesForEvent(provider: HookCapabilityProvider, event: string): ReadonlySet<string> {
  return hookProviderCapabilities[provider].handlerTypesByEvent[event] ?? new Set();
}

export function hookEventSupported(provider: HookCapabilityProvider, event: string): boolean {
  return hookProviderCapabilities[provider].documentedEvents.has(event);
}

export function classifyAdaptiveHookUnitPath(path: string): AdaptiveHookUnitPath {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (normalized === "hooks/hooks.json") return { kind: "native-aggregate", path: "hooks/hooks.json" };
  if (/^hooks\/hooks-[^/]+\.json$/u.test(normalized)) return { kind: "ignored", path };
  if (!normalized.startsWith("hooks/") || !normalized.endsWith(".json")) return { kind: "ignored", path };

  const parts = normalized.split("/");
  if (parts.length === 2) {
    const fileName = parts[1] ?? "";
    if (fileName === "hooks.json") return { kind: "ignored", path };
    return {
      kind: "adaptive-unit",
      name: fileName.slice(0, -".json".length),
      path,
      shape: "flat",
    };
  }

  if (parts.length === 3) {
    const directory = parts[1] ?? "";
    const fileName = parts[2] ?? "";
    if (fileName === "hook.json") {
      return { kind: "adaptive-unit", name: directory, path, shape: "directory-hook" };
    }
    if (fileName === `${directory}.json`) {
      return { kind: "adaptive-unit", name: directory, path, shape: "directory-named" };
    }
  }

  return { kind: "ignored", path };
}

export function validateAdaptiveHookUnitPaths(paths: readonly string[]): readonly AdaptiveHookPathIssue[] {
  const classified = paths.map(classifyAdaptiveHookUnitPath);
  const units = classified.filter((item): item is Extract<AdaptiveHookUnitPath, { kind: "adaptive-unit" }> => item.kind === "adaptive-unit");
  const aggregate = classified.find((item): item is Extract<AdaptiveHookUnitPath, { kind: "native-aggregate" }> => item.kind === "native-aggregate");
  const issues: AdaptiveHookPathIssue[] = [];
  const validUnits = units.filter((unit) => {
    if (unit.name.length > 0) return true;
    issues.push({
      code: "hook-name-invalid",
      message: "adaptive hook path must derive a non-empty hook name",
      paths: [unit.path],
    });
    return false;
  });

  if (aggregate !== undefined && validUnits.length > 0) {
    issues.push({
      code: "hook-aggregate-collision",
      message: "hooks/hooks.json is native aggregate source and cannot be combined with adaptive hook units for the same destination",
      paths: [aggregate.path, ...validUnits.map((unit) => unit.path)].sort(compareStrings),
    });
  }

  for (const [name, nameUnits] of groupBy(validUnits, (unit) => unit.name)) {
    if (nameUnits.length > 1) {
      issues.push({
        code: "hook-name-duplicate",
        message: `adaptive hook name ${name} is defined more than once`,
        paths: nameUnits.map((unit) => unit.path).sort(compareStrings),
      });
    }
  }

  for (const [directory, directoryUnits] of groupBy(validUnits.filter((unit) => unit.shape !== "flat"), (unit) => unit.name)) {
    const shapes = new Set(directoryUnits.map((unit) => unit.shape));
    if (shapes.has("directory-hook") && shapes.has("directory-named")) {
      issues.push({
        code: "hook-directory-ambiguous",
        message: `adaptive hook directory ${directory} contains both hook.json and ${directory}.json`,
        paths: directoryUnits.map((unit) => unit.path).sort(compareStrings),
      });
    }
  }

  return issues.sort((left, right) => compareStrings(left.code, right.code) || compareStrings(left.paths[0] ?? "", right.paths[0] ?? ""));
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = grouped.get(key);
    if (group === undefined) grouped.set(key, [item]);
    else group.push(item);
  }
  return grouped;
}
