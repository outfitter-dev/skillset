import { createHash } from "node:crypto";

import type { SettingsEntryOwnership } from "./types";
import { isJsonRecord } from "./yaml";

/** The settings lock claims the command-matched entry, never its containing file. */
export function hashOwnedSettingsEntries(
  bytes: Uint8Array,
  ownership: readonly SettingsEntryOwnership[]
): string | undefined {
  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (!isJsonRecord(settings) || !isJsonRecord(settings.hooks)) return undefined;
  const sessionStart = settings.hooks.SessionStart;
  if (!Array.isArray(sessionStart)) return undefined;
  const hash = createHash("sha256");
  hash.update("skillset-settings-entry-v1\0");
  for (const entry of ownership) {
    hash.update(entry.file);
    hash.update("\0");
    hash.update(entry.keyPath);
    hash.update("\0");
    hash.update(entry.commandHash);
    hash.update("\0");
    const matching = sessionStart.filter((value) => hasOwnedCommand(value, entry.commandHash));
    if (matching.length === 0) return undefined;
    hash.update(JSON.stringify(matching));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function hasOwnedCommand(value: unknown, commandHash: string): boolean {
  if (!isJsonRecord(value) || !Array.isArray(value.hooks)) return false;
  return value.hooks.some((hook) =>
    isJsonRecord(hook) &&
    typeof hook.command === "string" &&
    hashCommand(hook.command) === commandHash
  );
}

export function hashCommand(command: string): string {
  return `sha256:${createHash("sha256").update(command).digest("hex")}`;
}

/** Semantic baseline used only to detect simultaneous source and foreign edits. */
export function hashForeignSettings(bytes: Uint8Array, commandHash: string): string | undefined {
  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (!isJsonRecord(settings)) return undefined;
  const foreign = structuredClone(settings) as Record<string, unknown>;
  if (isJsonRecord(foreign.hooks)) {
    const hooks = foreign.hooks as Record<string, unknown>;
    if (Array.isArray(hooks.SessionStart)) {
      const remaining = hooks.SessionStart.filter((entry) => !hasOwnedCommand(entry, commandHash));
      if (remaining.length === 0) delete hooks.SessionStart;
      else hooks.SessionStart = remaining;
    }
    if (Object.keys(hooks).length === 0) delete foreign.hooks;
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(foreign)).digest("hex")}`;
}
