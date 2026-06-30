import type { ResolvedAdaptiveHookAttachment } from "./adaptive-hook-attachments";
import { readRecord } from "./config";
import { hookProviderCapabilities } from "./hook-capabilities";
import type { TargetName } from "./types";

export type AdaptiveHookRenderSurface = "frontmatter" | "plugin";

export function adaptiveHookUnsupportedRenderReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): string | undefined {
  const fieldReason = adaptiveHookUnsupportedFieldReason(item, target, surface);
  if (fieldReason !== undefined) return fieldReason;
  if (surface === "plugin") return adaptiveHookUnsupportedCapabilityReason(item, target);
  return undefined;
}

function adaptiveHookUnsupportedFieldReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): string | undefined {
  const providerOverride = item.definition.frontmatter[target];
  if (providerOverride !== undefined) {
    return `Adaptive hook ${item.definition.name} uses ${target} provider overrides, but ${surface} hook rendering does not support overrides yet.`;
  }

  const context = readRecord(item.definition.frontmatter, "context");
  const contextStrategy = context === undefined ? undefined : readContextStrategy(context);
  if (contextStrategy === "toolkit") {
    return `Adaptive hook ${item.definition.name} uses context.strategy toolkit, but ${surface} hook rendering does not support toolkit context delivery yet.`;
  }

  const run = readRecord(item.definition.frontmatter, "run") ?? {};
  for (const key of ["args", "cwd", "env"] as const) {
    if (run[key] !== undefined) {
      const supported = surface === "plugin" ? "run.command and run.script" : "run.command";
      return `Adaptive hook ${item.definition.name} uses run.${key}, but ${surface} hook rendering only supports ${supported} yet.`;
    }
  }

  if (surface === "frontmatter" && run.script !== undefined) {
    return `Adaptive hook ${item.definition.name} uses run.script, but frontmatter hook rendering does not have stable runtime path proof yet.`;
  }

  return undefined;
}

function readContextStrategy(context: Record<string, unknown>): string | undefined {
  const strategy = context.strategy;
  return typeof strategy === "string" ? strategy : undefined;
}

function adaptiveHookUnsupportedCapabilityReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string | undefined {
  if (target !== "codex") return undefined;
  const capabilities = hookProviderCapabilities.codex;
  if (!capabilities.documentedEvents.has(item.event)) {
    return `Codex does not support adaptive hook event ${item.event}.`;
  }
  const matcher = item.attachment.match ?? item.definition.frontmatter.match;
  if (matcher !== undefined && capabilities.matcherByEvent[item.event] === "ignored") {
    return `Codex ignores matchers for adaptive hook event ${item.event}, so this attachment cannot render faithfully.`;
  }
  return undefined;
}
