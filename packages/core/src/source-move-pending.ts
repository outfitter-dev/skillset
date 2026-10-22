/* eslint-disable func-style, no-await-in-loop -- Pending entries are read in a stable order. */
/* eslint-disable unicorn/import-style -- Named path helpers keep path construction concise. */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { readChangeLedger } from "./change-ledger";
import { compareStrings } from "./path";
import { ledgerReasonsNaming } from "./source-identity-mapping";
import {
  hasScopeDirective,
  isFrontmatterChangeEntry,
  rewritePendingChangeScopes,
} from "./source-move-rewrite";
import { display, pathExists } from "./source-rename-paths";
import { workspaceChangesDir } from "./workspace-state";

export interface PendingChangeRewriteRequest {
  readonly fromSelector: string;
  /** Wraps a rewrite failure in the calling planner's error type. */
  readonly planError: (message: string, options: ErrorOptions) => Error;
  readonly rootPath: string;
  readonly sourceDir: string;
  readonly toSelector: string;
}

/** Pending change entries are mutable authored source; JSONL streams are not. */
async function pendingChangeDocuments(rootPath: string, sourceDir: string): Promise<readonly string[]> {
  const changesPath = join(rootPath, workspaceChangesDir(sourceDir));
  if (!(await pathExists(changesPath))) {
    return [];
  }
  const entries = await readdir(changesPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .map((entry) => join(changesPath, entry.name))
    .toSorted(compareStrings);
}

/**
 * Plan the pending change entry rewrites for one selector change, adding each
 * rewritten entry to `updates` (keyed by absolute path; an entry already in
 * `updates` is rewritten from its planned content) and each follow-up step to
 * `notices`.
 */
export async function planPendingChangeRewrites(
  request: PendingChangeRewriteRequest,
  updates: Map<string, string>,
  notices: Set<string>
): Promise<void> {
  const { fromSelector, rootPath, sourceDir, toSelector } = request;
  const ledgerReasons = ledgerReasonsNaming(await readChangeLedger(rootPath, { sourceDir }), fromSelector);
  // Source hashes bind the unit's kind and selector, so the plan cannot carry current evidence.
  const refreshNotice = `pending change entries named ${fromSelector}; source hashes bind a unit's identity, so run \`skillset change refresh --yes\` after the move to re-record their evidence for ${toSelector}, or \`skillset change refresh --ref <id> --yes\` for one entry when unrelated uncovered changes block the workspace-wide refresh`;
  for (const documentPath of await pendingChangeDocuments(rootPath, sourceDir)) {
    const source = updates.get(documentPath) ?? (await readFile(documentPath, "utf-8"));
    const label = display(rootPath, documentPath);
    let rewritten: string;
    try {
      rewritten = rewritePendingChangeScopes(source, label, { fromSelector, toSelector });
    } catch (error) {
      throw request.planError(
        `cannot rewrite pending change entry ${
          error instanceof Error ? error.message.replace(/^skillset: /u, "") : String(error)
        }`,
        { cause: error }
      );
    }
    if (rewritten !== source) {
      updates.set(documentPath, rewritten);
      notices.add(refreshNotice);
      if (isFrontmatterChangeEntry(source, label)) {
        notices.add(
          "migrate frontmatter pending change entries with `skillset change migrate --yes` before `skillset change refresh` re-records their evidence"
        );
      }
    } else if (
      // A reason-only entry without Scope: directives takes its scopes from the ledger, which the move remaps.
      !isFrontmatterChangeEntry(source, label) &&
      !hasScopeDirective(source) &&
      ledgerReasons.has(basename(documentPath, ".md"))
    ) {
      notices.add(refreshNotice);
    }
  }
}
