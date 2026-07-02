import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";
import {
  canonicalHookEventName,
  hookHandlerTypesForEvent,
  hookEventSupported,
  hookProviderCapabilities,
} from "./hook-capabilities";
export {
  CLAUDE_HOOK_EVENTS,
  CODEX_HOOK_EVENTS,
  CODEX_HOOK_HANDLER_TYPES,
} from "./hook-capabilities";

/**
 * Validate a parsed hook definition for a target.
 *
 * Reject events and handler options that the selected provider capability
 * registry cannot render faithfully instead of copying through dead config.
 */
export function validateHookDefinition(
  parsed: JsonValue,
  context: { readonly sourcePath: string; readonly target: TargetName }
): void {
  const targetLabel = labelForTarget(context.target);
  if (!isJsonRecord(parsed)) {
    throw new Error(
      `skillset: ${targetLabel} hook file ${context.sourcePath} must contain a JSON object`
    );
  }
  validateProviderHooks(parsed, context);
}

function validateProviderHooks(
  parsed: JsonRecord,
  context: { readonly sourcePath: string; readonly target: TargetName }
): void {
  const capabilities = hookProviderCapabilities[context.target];
  const targetLabel = labelForTarget(context.target);
  const events = isJsonRecord(parsed.hooks) ? parsed.hooks : parsed;

  for (const [event, groups] of Object.entries(events)) {
    if (events === parsed && event === "hooks") continue;
    const capabilityEvent = canonicalHookEventName(context.target, event);
    if (!hookEventSupported(context.target, event)) {
      throw new Error(
        `skillset: ${targetLabel} hook file ${context.sourcePath} uses the ${event} event, which ${targetLabel} does not support. ` +
          `${targetLabel} hook events are: ${[...capabilities.documentedEvents].join(", ")}.`
      );
    }
    if (groups === undefined || !Array.isArray(groups)) continue;
    const handlerTypes = hookHandlerTypesForEvent(context.target, event);
    for (const group of groups) {
      if (!isJsonRecord(group)) continue;
      const handlers = group.hooks;
      if (!Array.isArray(handlers)) continue;
      for (const handler of handlers) {
        if (!isJsonRecord(handler)) continue;
        const type = handler.type;
        if (typeof type !== "string" || !handlerTypes.has(type)) {
          const typeLabel = typeof type === "string" ? type : "a missing/non-string type";
          throw new Error(
            `skillset: ${targetLabel} hook file ${context.sourcePath} uses ${typeLabel} for ${event}, ` +
              `but ${targetLabel} only runs ${formatHandlerTypes(handlerTypes)} hook handlers for this event. ` +
              `Use a supported handler type or set ${context.target}: false for this plugin.`
          );
        }
        if (type === "command" && handler.async === true && !capabilities.asyncCommand) {
          throw new Error(
            `skillset: ${targetLabel} hook file ${context.sourcePath} uses async: true for ${capabilityEvent}, ` +
              `but ${targetLabel} parses async command hooks and skips them. ` +
              `Remove async: true or set ${context.target}: false for this plugin.`
          );
        }
      }
    }
  }
}

function formatHandlerTypes(types: ReadonlySet<string>): string {
  return [...types].sort().map((type) => `type: ${type}`).join(", ");
}

function labelForTarget(target: TargetName): string {
  if (target === "claude") return "Claude";
  if (target === "codex") return "Codex";
  return "Cursor";
}
