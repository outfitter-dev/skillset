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
  return adaptiveHookIntentIsRenderable(classification) ? undefined : classification.reason;
}
