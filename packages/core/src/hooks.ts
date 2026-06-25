import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";
import {
  CODEX_HOOK_EVENTS,
  CODEX_HOOK_HANDLER_TYPES,
} from "./hook-capabilities";
export {
  CLAUDE_HOOK_EVENTS,
  CODEX_HOOK_EVENTS,
  CODEX_HOOK_HANDLER_TYPES,
} from "./hook-capabilities";

/**
 * Validate a parsed hook definition for a target.
 *
 * Claude: confirm the file is a JSON object (broad, by design).
 * Codex: additionally reject events Codex does not support plus handler options
 * Codex parses but skips, so unsupported hooks fail loudly at build/lint time
 * instead of being copied through as dead configuration.
 */
export function validateHookDefinition(
  parsed: JsonValue,
  context: { readonly sourcePath: string; readonly target: TargetName }
): void {
  const targetLabel = context.target === "claude" ? "Claude" : "Codex";
  if (!isJsonRecord(parsed)) {
    throw new Error(
      `skillset: ${targetLabel} hook file ${context.sourcePath} must contain a JSON object`
    );
  }
  if (context.target === "codex") {
    validateCodexHooks(parsed, context.sourcePath);
  }
}

function validateCodexHooks(parsed: JsonRecord, sourcePath: string): void {
  const events = isJsonRecord(parsed.hooks) ? parsed.hooks : parsed;

  for (const [event, groups] of Object.entries(events)) {
    if (events === parsed && event === "hooks") continue;
    if (!CODEX_HOOK_EVENTS.has(event)) {
      throw new Error(
        `skillset: Codex hook file ${sourcePath} uses the ${event} event, which Codex does not support. ` +
          `Codex hook events are: ${[...CODEX_HOOK_EVENTS].join(", ")}.`
      );
    }
    if (groups === undefined || !Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isJsonRecord(group)) continue;
      const handlers = group.hooks;
      if (!Array.isArray(handlers)) continue;
      for (const handler of handlers) {
        if (!isJsonRecord(handler)) continue;
        const type = handler.type;
        if (type !== "command") {
          const typeLabel = typeof type === "string" ? type : "a missing/non-string type";
          throw new Error(
            `skillset: Codex hook file ${sourcePath} uses ${typeLabel} for ${event}, ` +
              "but Codex only runs type: command hook handlers (prompt and agent handlers are parsed but skipped). " +
              "Use type: command or set codex: false for this plugin."
          );
        }
        if (handler.async === true) {
          throw new Error(
            `skillset: Codex hook file ${sourcePath} uses async: true for ${event}, ` +
              "but Codex parses async command hooks and skips them. " +
              "Remove async: true or set codex: false for this plugin."
          );
        }
      }
    }
  }
}
