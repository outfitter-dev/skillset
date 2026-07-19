import type { ResolvedAdaptiveHookAttachment } from "./adaptive-hook-attachments";
import { resolveEffectiveAdaptiveHookDefinition } from "./adaptive-hook-effective";
import { canonicalHookEventName, hookProviderCapabilities } from "./hook-capabilities";
import { targetDescriptor, targetNames } from "./targets";
import type { AdaptiveHookScope, TargetName } from "./types";

export type AdaptiveHookRenderSurface = "frontmatter" | "plugin";

export type AdaptiveHookIntentStatus =
  | "lossless-adaptive"
  | "provider-scoped-adaptive"
  | "native-only"
  | "unsupported";

export interface AdaptiveHookIntentClassification {
  readonly event: string;
  readonly matcherEvaluation: string;
  readonly matcherKind: string;
  readonly providerRef: string;
  readonly reason?: string;
  readonly reasons: readonly string[];
  readonly scope: AdaptiveHookScope;
  readonly status: AdaptiveHookIntentStatus;
  readonly surface: AdaptiveHookRenderSurface;
  readonly target: TargetName;
}

const TARGETS = targetNames();

export function classifyAdaptiveHookIntent(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): AdaptiveHookIntentClassification {
  const capabilities = hookProviderCapabilities[target];
  const capabilityEvent = canonicalHookEventName(target, item.event);
  const providerRef = capabilities.providerRefByEvent[capabilityEvent] ?? `hook-capabilities:${target}`;
  const matcherKind = capabilities.matcherByEvent[capabilityEvent] ?? "none";
  const matcherEvaluation = capabilities.matcherEvaluationByEvent[capabilityEvent] ?? "provider-native";
  const unsupportedReason = adaptiveHookUnsupportedReason(item, target, surface);
  if (unsupportedReason !== undefined) {
    const status: AdaptiveHookIntentStatus = adaptiveHookNativeOnlyReason(item.attachment.scope, target) === unsupportedReason
      ? "native-only"
      : "unsupported";
    return classification({
      item,
      matcherEvaluation,
      matcherKind,
      providerRef,
      reasons: [unsupportedReason],
      status,
      surface,
      target,
    });
  }

  const allowedTargets = allowedAdaptiveHookTargets(item);
  if (allowedTargets.length < TARGETS.length) {
    return classification({
      item,
      matcherEvaluation,
      matcherKind,
      providerRef,
      reasons: [`Adaptive hook ${item.definition.name} is scoped to ${allowedTargets.join(", ")}.`],
      status: "provider-scoped-adaptive",
      surface,
      target,
    });
  }

  const peerReasons = allowedTargets
    .filter((candidate) => candidate !== target)
    .map((candidate) => adaptiveHookUnsupportedReason(item, candidate, surface))
    .filter((reason): reason is string => reason !== undefined);
  if (peerReasons.length > 0) {
    return classification({
      item,
      matcherEvaluation,
      matcherKind,
      providerRef,
      reasons: peerReasons,
      status: "provider-scoped-adaptive",
      surface,
      target,
    });
  }

  return classification({
    item,
    matcherEvaluation,
    matcherKind,
    providerRef,
    reasons: [],
    status: "lossless-adaptive",
    surface,
    target,
  });
}

export function adaptiveHookIntentIsRenderable(classification: AdaptiveHookIntentClassification): boolean {
  return classification.status === "lossless-adaptive" || classification.status === "provider-scoped-adaptive";
}

function classification(input: {
  readonly item: ResolvedAdaptiveHookAttachment;
  readonly matcherEvaluation: string;
  readonly matcherKind: string;
  readonly providerRef: string;
  readonly reasons: readonly string[];
  readonly status: AdaptiveHookIntentStatus;
  readonly surface: AdaptiveHookRenderSurface;
  readonly target: TargetName;
}): AdaptiveHookIntentClassification {
  return {
    event: input.item.event,
    matcherEvaluation: input.matcherEvaluation,
    matcherKind: input.matcherKind,
    providerRef: input.providerRef,
    ...(input.reasons[0] === undefined ? {} : { reason: input.reasons[0] }),
    reasons: input.reasons,
    scope: input.item.attachment.scope,
    status: input.status,
    surface: input.surface,
    target: input.target,
  };
}

function allowedAdaptiveHookTargets(item: ResolvedAdaptiveHookAttachment): readonly TargetName[] {
  const definitionTargets = providerSet(item.definition.providers);
  const attachmentTargets = providerSet(item.attachment.providers);
  return TARGETS.filter((target) => definitionTargets.has(target) && attachmentTargets.has(target));
}

function providerSet(providers: readonly TargetName[] | undefined): ReadonlySet<TargetName> {
  return new Set(providers ?? TARGETS);
}

function adaptiveHookUnsupportedReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): string | undefined {
  const providerScopeReason = adaptiveHookProviderScopeReason(item, target);
  if (providerScopeReason !== undefined) return providerScopeReason;

  const nativeOnlyReason = adaptiveHookNativeOnlyReason(item.attachment.scope, target);
  if (nativeOnlyReason !== undefined) return nativeOnlyReason;

  const fieldReason = adaptiveHookUnsupportedFieldReason(item, target, surface);
  if (fieldReason !== undefined) return fieldReason;

  return adaptiveHookUnsupportedCapabilityReason(item, target);
}

function adaptiveHookProviderScopeReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string | undefined {
  if (providerListAllows(item.definition.providers, target) && providerListAllows(item.attachment.providers, target)) {
    return undefined;
  }
  return `Adaptive hook ${item.definition.name} is not enabled for ${target}.`;
}

function adaptiveHookNativeOnlyReason(scope: AdaptiveHookScope, target: TargetName): string | undefined {
  const support = scope.kind === "skill"
    ? hookProviderCapabilities[target].scopeSupport.skill
    : scope.kind === "agent"
    ? hookProviderCapabilities[target].scopeSupport.agent
    : scope.kind === "plugin"
    ? hookProviderCapabilities[target].scopeSupport.plugin
    : undefined;
  if (support === "unsupported") {
    const destination = scope.kind === "skill"
      ? "skill-local"
      : scope.kind === "agent"
      ? "project-agent"
      : "plugin";
    return `${targetLabel(target)} has no faithful ${destination} hook destination for adaptive hook attachments.`;
  }
  return undefined;
}

function adaptiveHookUnsupportedFieldReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): string | undefined {
  const effective = item.effectiveDefinition?.target === target
    ? item.effectiveDefinition
    : resolveEffectiveAdaptiveHookDefinition(item.definition, target);
  const run = effective.run;
  for (const key of ["args", "cwd"] as const) {
    if (run[key] !== undefined) {
      const supported = surface === "plugin" ? "run.command, run.script, and run.env" : "run.command";
      return `Adaptive hook ${item.definition.name} uses run.${key}, but ${surface} hook rendering only supports ${supported} yet.`;
    }
  }

  if (run.env !== undefined && surface !== "plugin") {
    return `Adaptive hook ${item.definition.name} uses run.env, but ${surface} hook rendering only supports run.command yet.`;
  }

  if (surface === "frontmatter" && run.script !== undefined) {
    return `Adaptive hook ${item.definition.name} uses run.script, but frontmatter hook rendering does not have stable runtime path proof yet.`;
  }

  return undefined;
}

function adaptiveHookUnsupportedCapabilityReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string | undefined {
  const capabilities = hookProviderCapabilities[target];
  const capabilityEvent = canonicalHookEventName(target, item.event);
  const label = targetLabel(target);
  if (!capabilities.documentedEvents.has(capabilityEvent)) {
    return `${label} does not support adaptive hook event ${item.event}.`;
  }
  const effective = item.effectiveDefinition?.target === target
    ? item.effectiveDefinition
    : resolveEffectiveAdaptiveHookDefinition(item.definition, target);
  const matcher = item.attachment.match ?? effective.match;
  if (matcher !== undefined && capabilities.matcherByEvent[capabilityEvent] === "ignored") {
    return `${label} ignores matchers for adaptive hook event ${item.event}, so this attachment cannot render faithfully.`;
  }
  return undefined;
}

function providerListAllows(providers: readonly TargetName[] | undefined, target: TargetName): boolean {
  return providers === undefined || providers.includes(target);
}

function targetLabel(target: TargetName): string {
  return targetDescriptor(target).displayLabel;
}
