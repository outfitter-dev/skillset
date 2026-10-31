import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { prepareRepositoryMutationPath, resolveWorkspaceMutationRoot } from "./repository-mutation";
import { composeHookEventText, hasCommand, readHookEventEntries } from "./settings-json-edit";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";
import { applyWorkspaceTransaction, type WorkspaceTransactionOptions, type WorkspaceTransactionPlan } from "./workspace-transaction";

const EVENT = "PreToolUse";

export interface GeneratedEditHookSetupPlan {
  readonly entry: JsonRecord | null;
  readonly rootPath: string;
  readonly settingsPath: string;
  readonly recordPath: string;
  readonly changed: boolean;
  readonly remove: boolean;
  readonly transaction: WorkspaceTransactionPlan;
}

/** Plan only: the selected directory may be a project or a user configuration root. */
export async function planGeneratedEditHookSetup(rootPath: string, options: {
  readonly settingsPath: string;
  readonly entry: JsonRecord;
  readonly remove?: boolean;
}): Promise<GeneratedEditHookSetupPlan> {
  const root = await resolveWorkspaceMutationRoot(rootPath);
  const recordPath = join(dirname(options.settingsPath), `${basename(options.settingsPath)}.skillset-generated-edit-hook.json`);
  const priorText = await readSelected(root, options.settingsPath);
  const recordText = await readSelected(root, recordPath);
  const source = priorText ?? "{}\n";
  const entries = readHookEventEntries(source, EVENT);
  const prior = readRecord(recordText, resolve(root, options.settingsPath));
  const command = entryCommand(options.entry);
  const owned = prior === null ? [] : entries.filter((entry) => hasCommand(entry, entryCommand(prior)));
  if (prior !== null && (owned.length !== 1 || !isDeepStrictEqual(owned[0], prior))) {
    throw new Error("skillset: owned generated-edit hook changed or disappeared; refusing to overwrite or remove it");
  }
  const collisions = entries.filter((entry) => hasCommand(entry, command) && entry !== owned[0]);
  if (!options.remove && collisions.length > 0) throw new Error("skillset: matching unmanaged generated-edit hook already exists; refusing adoption");
  const unchanged = options.remove ? prior === null : prior !== null && isDeepStrictEqual(prior, options.entry);
  if (unchanged) return { entry: options.remove ? prior : options.entry, rootPath: root, settingsPath: options.settingsPath, recordPath, remove: options.remove === true, changed: false, transaction: {} };
  let next = source;
  if (prior !== null) next = composeHookEventText(next, EVENT, entries, prior, entryCommand(prior), true);
  if (!options.remove) next = composeHookEventText(next, EVENT, readHookEventEntries(next, EVENT), options.entry, command, false);
  // Retain a cleared receipt on removal: it owns no hook and permits safe reinstallation.
  const nextRecord = `${JSON.stringify({ version: 1, settingsPath: resolve(root, options.settingsPath), entry: options.remove ? null : options.entry }, null, 2)}\n`;
  return {
    entry: options.remove ? prior : options.entry,
    rootPath: root, settingsPath: options.settingsPath, recordPath,
    remove: options.remove === true, changed: true,
    transaction: { writes: [
      { path: options.settingsPath, content: next, ...(priorText === undefined ? { expectedAbsent: true } : { expectedContent: priorText }) },
      { path: recordPath, content: nextRecord, ...(recordText === undefined ? { expectedAbsent: true } : { expectedContent: recordText }) },
    ] },
  };
}

export async function applyGeneratedEditHookSetup(plan: GeneratedEditHookSetupPlan, options: WorkspaceTransactionOptions = {}) {
  if (!plan.changed) return undefined;
  return applyWorkspaceTransaction(plan.rootPath, plan.transaction, options);
}

async function readSelected(root: string, path: string): Promise<string | undefined> {
  const prepared = await prepareRepositoryMutationPath(root, path, { createParents: false });
  try { return await readFile(prepared.path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function readRecord(text: string | undefined, settingsPath: string): JsonRecord | null {
  if (text === undefined) return null;
  // Reuse strict duplicate-key validation, including nested objects.
  readHookEventEntries(text, EVENT);
  const record: unknown = JSON.parse(text);
  if (!isJsonRecord(record) || record.version !== 1 || record.settingsPath !== settingsPath ||
      Object.keys(record).some((key) => !["version", "settingsPath", "entry"].includes(key)) ||
      (record.entry !== null && !isJsonRecord(record.entry))) {
    throw new Error("skillset: invalid generated-edit hook ownership record");
  }
  if (record.entry !== null) entryCommand(record.entry as JsonRecord);
  return record.entry as JsonRecord | null;
}

function entryCommand(entry: JsonRecord): string {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks) || hooks.length !== 1 || !isJsonRecord(hooks[0]) ||
      hooks[0].type !== "command" || typeof hooks[0].command !== "string" || !hooks[0].command.trim()) {
    throw new Error("skillset: expected one generated-edit command hook");
  }
  return hooks[0].command;
}
