import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";
import {
  canonicalHookEventName,
  hookHandlerTypesForEvent,
  hookEventSupported,
  hookProviderCapabilities,
} from "./hook-capabilities";
import { targetDescriptor } from "./targets";
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
  context: {
    readonly acceptCompatibilityEnvelope?: boolean;
    readonly sourcePath: string;
    readonly target: TargetName;
  }
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
  context: {
    readonly acceptCompatibilityEnvelope?: boolean;
    readonly sourcePath: string;
    readonly target: TargetName;
  }
): void {
  const capabilities = hookProviderCapabilities[context.target];
  const targetLabel = labelForTarget(context.target);
  const events = isJsonRecord(parsed.hooks) ? parsed.hooks : parsed;

  if (context.target === "cursor" && isJsonRecord(parsed.hooks)) {
    if (parsed.version !== undefined && parsed.version !== 1) {
      throw new Error(
        `skillset: Cursor hook file ${context.sourcePath} uses unsupported version ${String(parsed.version)}; Cursor native hooks require version 1.`
      );
    }
    if (!context.acceptCompatibilityEnvelope && parsed.version !== 1) {
      throw new Error(
        `skillset: Cursor hook file ${context.sourcePath} must set version to 1.`
      );
    }
    for (const field of Object.keys(parsed)) {
      if (!capabilities.configFields.rootFields.includes(field)) {
        throw new Error(
          `skillset: Cursor hook file ${context.sourcePath} uses unsupported root field ${field}; Cursor root fields are version and hooks.`
        );
      }
    }
  }

  for (const [event, groups] of Object.entries(events)) {
    if (events === parsed && event === "hooks") continue;
    const capabilityEvent = canonicalHookEventName(context.target, event);
    if (!hookEventSupported(context.target, event)) {
      throw new Error(
        `skillset: ${targetLabel} hook file ${context.sourcePath} uses the ${event} event, which ${targetLabel} does not support. ` +
          `${targetLabel} hook events are: ${[...capabilities.documentedEvents].join(", ")}.`
      );
    }
    if (groups === undefined || !Array.isArray(groups)) {
      if (context.target === "cursor") {
        throw new Error(
          `skillset: Cursor hook file ${context.sourcePath} must map ${event} to an array of handlers.`
        );
      }
      continue;
    }
    const handlerTypes = hookHandlerTypesForEvent(context.target, event);
    for (const group of groups) {
      if (!isJsonRecord(group)) {
        if (context.target === "cursor") {
          throw new Error(
            `skillset: Cursor hook file ${context.sourcePath} must use object handlers for ${event}.`
          );
        }
        continue;
      }
      const compatibilityGroup = Array.isArray(group.hooks);
      if (
        capabilities.configFields.handlerEnvelope === "flat" &&
        compatibilityGroup &&
        !context.acceptCompatibilityEnvelope
      ) {
        throw new Error(
          `skillset: ${targetLabel} hook file ${context.sourcePath} uses a grouped compatibility envelope for ${event}, ` +
            `but ${targetLabel} native hook handlers must be flat event-array entries.`
        );
      }
      const handlers = compatibilityGroup ? group.hooks as JsonValue[] : [group];
      if (context.target === "cursor" && compatibilityGroup) {
        for (const field of Object.keys(group)) {
          if (field !== "hooks" && field !== "matcher") {
            throw new Error(
              `skillset: Cursor hook file ${context.sourcePath} cannot lower compatibility group field ${field} for ${event}.`
            );
          }
        }
      }
      for (const handler of handlers) {
        if (!isJsonRecord(handler)) {
          if (context.target === "cursor") {
            throw new Error(
              `skillset: Cursor hook file ${context.sourcePath} must use object handlers for ${event}.`
            );
          }
          continue;
        }
        const type = handler.type ?? (capabilities.configFields.handlerEnvelope === "flat" ? "command" : undefined);
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
        if (context.target === "cursor") {
          validateCursorHandler(handler, type, event, context.sourcePath);
        }
      }
    }
  }
}

function validateCursorHandler(
  handler: JsonRecord,
  type: string,
  event: string,
  sourcePath: string
): void {
  const capabilities = hookProviderCapabilities.cursor;
  const allowedFields = new Set(capabilities.handlerFieldsByType[type] ?? []);
  for (const field of Object.keys(handler)) {
    if (!allowedFields.has(field)) {
      throw new Error(
        `skillset: Cursor hook file ${sourcePath} uses unsupported field ${field} on a flat ${type} handler for ${event}. ` +
          `Cursor ${type} handler fields are: ${[...allowedFields].sort().join(", ")}.`
      );
    }
  }
  const requiredField = type === "prompt" ? "prompt" : "command";
  if (typeof handler[requiredField] !== "string") {
    throw new Error(
      `skillset: Cursor hook file ${sourcePath} ${type} handler for ${event} requires a string ${requiredField} field.`
    );
  }
  if (handler.timeout !== undefined && typeof handler.timeout !== "number") {
    throw new Error(`skillset: Cursor hook file ${sourcePath} uses a non-number timeout for ${event}.`);
  }
  if (handler.failClosed !== undefined && typeof handler.failClosed !== "boolean") {
    throw new Error(`skillset: Cursor hook file ${sourcePath} uses a non-boolean failClosed for ${event}.`);
  }
  if (handler.model !== undefined && typeof handler.model !== "string") {
    throw new Error(`skillset: Cursor hook file ${sourcePath} uses a non-string model for ${event}.`);
  }
  if (handler.loop_limit !== undefined) {
    const canonicalEvent = canonicalHookEventName("cursor", event);
    if (canonicalEvent !== "Stop" && canonicalEvent !== "SubagentStop") {
      throw new Error(
        `skillset: Cursor hook file ${sourcePath} uses loop_limit for ${event}, but Cursor documents it only for stop and subagentStop.`
      );
    }
    if (handler.loop_limit !== null && typeof handler.loop_limit !== "number") {
      throw new Error(`skillset: Cursor hook file ${sourcePath} uses an invalid loop_limit for ${event}; expected a number or null.`);
    }
  }
}

function formatHandlerTypes(types: ReadonlySet<string>): string {
  return [...types].sort().map((type) => `type: ${type}`).join(", ");
}

function labelForTarget(target: TargetName): string {
  return targetDescriptor(target).displayLabel;
}
