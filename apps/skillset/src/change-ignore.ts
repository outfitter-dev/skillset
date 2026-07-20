import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { compareStrings } from "@skillset/core/internal/path";
import type { JsonRecord } from "@skillset/core/internal/types";
import { workspaceChangeFile } from "@skillset/core";

import { changeCheck, resolvePendingChangeRef } from "./change-entries";
import { detectWorkspaceOptions, type ChangeStatusOptions } from "./change-status";
import {
  withChangeLedgerLock,
  type ChangeLedgerLockOptions,
} from "./change-refresh";

export interface ChangeIgnoreOptions extends ChangeStatusOptions {
  readonly lock?: ChangeLedgerLockOptions;
  readonly ref: string;
  readonly write: boolean;
}

export interface ChangeIgnoreEntry {
  readonly path: string;
  readonly ref: string;
  readonly sourceUnits: readonly JsonRecord[];
}

export interface ChangeIgnoreReport {
  readonly alreadyIgnored: boolean;
  readonly entry: ChangeIgnoreEntry;
  readonly ledgerPath: string;
  readonly written: boolean;
}

type LedgerEvent = {
  readonly payload: JsonRecord;
  readonly type: ChangeLedgerEventType;
};

type AppendLedgerEvents = (
  rootPath: string,
  sourceDir: string | undefined,
  events: readonly LedgerEvent[]
) => Promise<void>;

export async function ignorePendingChangeWithAppend(
  rootPath: string,
  options: ChangeIgnoreOptions,
  appendLedgerEvents: AppendLedgerEvents
): Promise<ChangeIgnoreReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  if (!options.write) return planChangeIgnore(rootPath, storageOptions, options.ref);

  return withChangeLedgerLock(rootPath, storageOptions.sourceDir, options.lock, async (lock) => {
    const planned = await planChangeIgnore(rootPath, storageOptions, options.ref);
    if (planned.alreadyIgnored) return planned;
    await lock.assertOwned();
    const confirmed = await planChangeIgnore(rootPath, storageOptions, options.ref);
    if (confirmed.alreadyIgnored) return confirmed;
    await lock.assertOwned();
    await appendLedgerEvents(rootPath, storageOptions.sourceDir, [
      {
        payload: {
          reasonId: confirmed.entry.ref.slice(1),
          sourceUnits: [...confirmed.entry.sourceUnits],
        },
        type: "change.ignored",
      },
    ]);
    return { ...confirmed, written: true };
  });
}

async function planChangeIgnore(
  rootPath: string,
  storageOptions: ChangeStatusOptions,
  ref: string
): Promise<ChangeIgnoreReport> {
  const checked = await changeCheck(rootPath, { ...storageOptions, ref });
  const entry = resolvePendingChangeRef(checked.entries, ref);
  if (entry.format === "frontmatter") {
    throw new Error("skillset: frontmatter pending entries must be migrated before they can be ignored");
  }
  const errors = checked.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    const details = errors
      .toSorted((left, right) => compareStrings(`${left.path ?? ""}\0${left.code}`, `${right.path ?? ""}\0${right.code}`))
      .map((issue) => `${issue.path ?? "workspace"}: [${issue.code}] ${issue.message}`);
    throw new Error(`skillset: cannot ignore non-validating pending change entry\n${details.join("\n")}`);
  }
  if (entry.id === undefined) throw new Error(`skillset: pending change ${entry.path} is missing an id`);
  return {
    alreadyIgnored: entry.ignored,
    entry: {
      path: entry.path,
      ref: `@${entry.id}`,
      sourceUnits: [...entry.sourceHashes]
        .flatMap(([selector, hashes]) => hashes.map((sourceHash) => ({
          hashSchema: "skillset-source-unit-v2",
          selector,
          sourceHash,
        })))
        .toSorted((left, right) => compareStrings(`${left.selector}\0${left.sourceHash}`, `${right.selector}\0${right.sourceHash}`)),
    },
    ledgerPath: workspaceChangeFile(storageOptions.sourceDir, "ledger.jsonl"),
    written: false,
  };
}
