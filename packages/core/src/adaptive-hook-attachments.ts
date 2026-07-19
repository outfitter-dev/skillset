import { compareStrings } from "./path";
import {
  resolveEffectiveAdaptiveHookDefinition,
  type EffectiveAdaptiveHookDefinition,
} from "./adaptive-hook-effective";
import { isTargetName } from "./targets";
import { isJsonRecord } from "./yaml";
import type {
  AdaptiveHookScope,
  JsonValue,
  SourceAdaptiveHook,
  SourceHookAttachment,
  TargetName,
} from "./types";

export interface AdaptiveHookAttachmentIssue {
  readonly code:
    | "adaptive-hook-attachment-ambiguous"
    | "adaptive-hook-attachment-event"
    | "adaptive-hook-attachment-missing"
    | "adaptive-hook-duplicate-name";
  readonly message: string;
  readonly paths: readonly string[];
}

export interface ResolvedAdaptiveHookAttachment {
  readonly attachment: SourceHookAttachment;
  readonly definition: SourceAdaptiveHook;
  readonly effectiveDefinition?: EffectiveAdaptiveHookDefinition;
  readonly event: string;
  readonly target?: TargetName;
}

export interface AdaptiveHookResolution {
  readonly issues: readonly AdaptiveHookAttachmentIssue[];
  readonly resolved: readonly ResolvedAdaptiveHookAttachment[];
}

export function readHookAttachments(
  value: JsonValue | undefined,
  scope: AdaptiveHookScope,
  sourcePath: string
): readonly SourceHookAttachment[] {
  if (!isJsonRecord(value)) return [];
  const attachments: SourceHookAttachment[] = [];
  for (const [event, entries] of Object.entries(value).sort(([left], [right]) => compareStrings(left, right))) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const attachment = readHookAttachmentEntry(entry, event, scope, sourcePath);
      if (attachment !== undefined) attachments.push(attachment);
    }
  }
  return attachments;
}

export function resolveAdaptiveHookAttachments(
  definitions: readonly SourceAdaptiveHook[],
  attachments: readonly SourceHookAttachment[]
): AdaptiveHookResolution {
  return resolveAttachments(definitions, attachments);
}

/** Resolves visible hook identities without applying base or target event rules. */
export function resolveAdaptiveHookAttachmentIdentities(
  definitions: readonly SourceAdaptiveHook[],
  attachments: readonly SourceHookAttachment[]
): AdaptiveHookResolution {
  return resolveAttachments(definitions, attachments, undefined, false);
}

export function resolveAdaptiveHookAttachmentsForTarget(
  definitions: readonly SourceAdaptiveHook[],
  attachments: readonly SourceHookAttachment[],
  target: TargetName
): AdaptiveHookResolution {
  return resolveAttachments(definitions, attachments, target, true);
}

function resolveAttachments(
  definitions: readonly SourceAdaptiveHook[],
  attachments: readonly SourceHookAttachment[],
  target?: TargetName,
  validateEvents = true
): AdaptiveHookResolution {
  const issues: AdaptiveHookAttachmentIssue[] = [...duplicateDefinitionIssues(definitions)];
  const resolved: ResolvedAdaptiveHookAttachment[] = [];

  for (const attachment of attachments) {
    const candidates = visibleDefinitions(definitions, attachment.scope).filter((definition) => definition.name === attachment.hook);
    if (candidates.length === 0) {
      issues.push({
        code: "adaptive-hook-attachment-missing",
        message: `adaptive hook attachment references missing hook ${attachment.hook}`,
        paths: [attachment.sourcePath],
      });
      continue;
    }

    const nearestRank = Math.min(...candidates.map((definition) => scopeRank(attachment.scope, definition.scope)));
    const nearest = candidates.filter((definition) => scopeRank(attachment.scope, definition.scope) === nearestRank);
    if (nearest.length > 1) {
      issues.push({
        code: "adaptive-hook-attachment-ambiguous",
        message: `adaptive hook attachment ${attachment.hook} is ambiguous in the nearest visible scope`,
        paths: [attachment.sourcePath, ...nearest.map((definition) => definition.sourcePath)].sort(compareStrings),
      });
      continue;
    }

    const definition = nearest[0];
    if (definition === undefined) continue;
    const effectiveDefinition = target === undefined
      ? undefined
      : resolveEffectiveAdaptiveHookDefinition(definition, target);
    const events = attachment.event === undefined ? effectiveDefinition?.events ?? definition.events : [attachment.event];
    for (const event of events) {
      if (validateEvents && !(effectiveDefinition?.events ?? definition.events).includes(event)) {
        const declaredEvents = effectiveDefinition?.events ?? definition.events;
        issues.push({
          code: "adaptive-hook-attachment-event",
          message: `adaptive hook attachment ${attachment.hook} uses event ${event}, but the hook declares ${declaredEvents.join(", ")}`,
          paths: [attachment.sourcePath, definition.sourcePath].sort(compareStrings),
        });
        continue;
      }
      resolved.push({
        attachment,
        definition,
        ...(effectiveDefinition === undefined ? {} : { effectiveDefinition }),
        event,
        ...(target === undefined ? {} : { target }),
      });
    }
  }

  return {
    issues: issues.sort((left, right) => compareStrings(left.code, right.code) || compareStrings(left.paths[0] ?? "", right.paths[0] ?? "")),
    resolved: resolved.sort((left, right) =>
      compareStrings(left.attachment.sourcePath, right.attachment.sourcePath) ||
      compareStrings(left.attachment.hook, right.attachment.hook) ||
      compareStrings(left.event, right.event)
    ),
  };
}

function readHookAttachmentEntry(
  entry: JsonValue,
  event: string,
  scope: AdaptiveHookScope,
  sourcePath: string
): SourceHookAttachment | undefined {
  const hook = typeof entry === "string" ? entry : isJsonRecord(entry) && typeof entry.hook === "string" ? entry.hook : undefined;
  if (hook === undefined || hook.trim().length === 0) return undefined;
  const object = isJsonRecord(entry) ? entry : {};
  const match = object.match;
  const status = typeof object.status === "string" ? object.status : undefined;
  const providers = readProviders(object.providers);
  return {
    ...(event === "auto" ? {} : { event }),
    hook,
    ...(match === undefined ? {} : { match }),
    ...(providers === undefined ? {} : { providers }),
    scope,
    sourcePath,
    ...(status === undefined ? {} : { status }),
  };
}

function readProviders(value: JsonValue | undefined): readonly TargetName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const providers = value.filter(isTargetName);
  return providers.length === 0 ? undefined : providers;
}

function duplicateDefinitionIssues(definitions: readonly SourceAdaptiveHook[]): readonly AdaptiveHookAttachmentIssue[] {
  const byScopeAndName = new Map<string, SourceAdaptiveHook[]>();
  for (const definition of definitions) {
    const key = `${scopeKey(definition.scope)}:${definition.name}`;
    const group = byScopeAndName.get(key);
    if (group === undefined) byScopeAndName.set(key, [definition]);
    else group.push(definition);
  }
  return [...byScopeAndName.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      code: "adaptive-hook-duplicate-name" as const,
      message: `adaptive hook name ${group[0]?.name ?? ""} is defined more than once in the same resolution scope`,
      paths: group.map((definition) => definition.sourcePath).sort(compareStrings),
    }));
}

function visibleDefinitions(
  definitions: readonly SourceAdaptiveHook[],
  attachmentScope: AdaptiveHookScope
): readonly SourceAdaptiveHook[] {
  return definitions.filter((definition) => scopeRank(attachmentScope, definition.scope) < Number.POSITIVE_INFINITY);
}

function scopeRank(attachmentScope: AdaptiveHookScope, definitionScope: AdaptiveHookScope): number {
  if (sameScope(attachmentScope, definitionScope)) return 0;
  if (attachmentScope.kind === "skill") {
    if (definitionScope.kind === "plugin" && definitionScope.pluginId === attachmentScope.pluginId) return 1;
    if (definitionScope.kind === "root") return 2;
  }
  if (attachmentScope.kind === "agent" && definitionScope.kind === "root") return 1;
  if (attachmentScope.kind === "plugin" && definitionScope.kind === "root") return 1;
  return Number.POSITIVE_INFINITY;
}

function sameScope(left: AdaptiveHookScope, right: AdaptiveHookScope): boolean {
  return scopeKey(left) === scopeKey(right);
}

function scopeKey(scope: AdaptiveHookScope): string {
  return [
    scope.kind,
    scope.pluginId ?? "",
    scope.skillId ?? "",
    scope.agentId ?? "",
  ].join(":");
}
