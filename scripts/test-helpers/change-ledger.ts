import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Pending change-ledger event file path, relative to the workspace (ADR-0045). */
export const PENDING_LEDGER_EVENT_FILE =
  /^(?:.+\/)?changes\/events\/\d{8}T\d{9}Z-[A-Za-z0-9][A-Za-z0-9-]*\.jsonl$/u;

/** Workspace-relative pending event files under `<sourceRoot>/changes/events/`, in fold order. */
export async function pendingLedgerEventFiles(
  root: string,
  sourceRoot = ".skillset"
): Promise<readonly string[]> {
  const directory = `${sourceRoot}/changes/events`;
  try {
    return (await readdir(join(root, directory)))
      .filter((name) => !name.startsWith("."))
      .toSorted()
      .map((name) => `${directory}/${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The change ledger as readers fold it: `ledger.jsonl`, then every pending
 * event file by name. Empty when neither exists.
 */
export async function readFoldedLedger(
  root: string,
  sourceRoot = ".skillset"
): Promise<string> {
  const parts: string[] = [];
  for (const path of [
    `${sourceRoot}/changes/ledger.jsonl`,
    ...await pendingLedgerEventFiles(root, sourceRoot),
  ]) {
    try {
      parts.push(await readFile(join(root, path), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return parts.join("");
}

/** Records of the folded ledger, parsed. */
export async function readFoldedLedgerRecords(
  root: string,
  sourceRoot = ".skillset"
): Promise<readonly Record<string, unknown>[]> {
  return (await readFoldedLedger(root, sourceRoot))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
