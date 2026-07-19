import type { ResolvedAdaptiveHookAttachment } from "./adaptive-hook-attachments";
import type { TargetName } from "./types";
import {
  adaptiveHookIntentIsRenderable,
  classifyAdaptiveHookIntent,
  type AdaptiveHookRenderSurface,
} from "./adaptive-hook-classifier";

export {
  adaptiveHookIntentIsRenderable,
  classifyAdaptiveHookIntent,
  type AdaptiveHookIntentClassification,
  type AdaptiveHookIntentStatus,
  type AdaptiveHookRenderSurface,
} from "./adaptive-hook-classifier";

export function adaptiveHookUnsupportedRenderReason(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): string | undefined {
  const classification = classifyAdaptiveHookIntent(item, target, surface);
  if (!adaptiveHookIntentIsRenderable(classification)) return classification.reason;
  if (item.definition.frontmatter[target] !== undefined) {
    return `Adaptive hook ${item.definition.name} uses ${target} provider overrides, but ${surface} hook rendering does not consume effective definitions yet.`;
  }
  return undefined;
}
