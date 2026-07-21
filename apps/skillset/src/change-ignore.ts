import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { compareStrings } from "@skillset/core/internal/path";
import type { JsonRecord } from "@skillset/core/internal/types";
import { workspaceChangeFile } from "@skillset/core";

import { changeCheck, hasRecordedChangeIgnore, resolvePendingChangeRef } from "./change-entries";
import { detectWorkspaceOptions, type ChangeStatusOptions } from "./change-status";
import {
  withChangeLedgerLock,
  type ChangeLedgerLockOptions,
} from "./change-refresh";

export interface ChangeIgnoreOptions extends ChangeStatusOptions {
  /** @internal Test seam for a source or reason edit between stable plans. */
  readonly beforeFinalComparison?: () => Promise<void>;
  /** @internal Test seam for an edit immediately before the final ownership check. */
  readonly beforeOwnershipVerification?: () => Promise<void>;
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

interface PlannedChangeIgnore {
  readonly key: string;
  readonly report: ChangeIgnoreReport;
}

export async function ignorePendingChangeWithAppend(
  rootPath: string,
  options: ChangeIgnoreOptions,
  appendLedgerEvents: AppendLedgerEvents
): Promise<ChangeIgnoreReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  if (!options.write) {
    return (await planChangeIgnore(rootPath, storageOptions, options.ref)).report;
  }

  return withChangeLedgerLock(rootPath, storageOptions.sourceDir, options.lock, async (lock) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const planned = await planChangeIgnore(rootPath, storageOptions, options.ref);
      if (planned.report.alreadyIgnored) return planned.report;
      await options.beforeFinalComparison?.();
      const confirmed = await planChangeIgnore(rootPath, storageOptions, options.ref);
      if (confirmed.report.alreadyIgnored) return confirmed.report;
      if (planned.key !== confirmed.key) continue;
      await lock.assertOwned();
      await options.beforeOwnershipVerification?.();
      const fresh = await planChangeIgnore(rootPath, storageOptions, options.ref);
      if (fresh.report.alreadyIgnored) return fresh.report;
      if (confirmed.key !== fresh.key) continue;
      await lock.assertOwned();
      await appendLedgerEvents(rootPath, storageOptions.sourceDir, [
        {
          payload: {
            reasonId: fresh.report.entry.ref.slice(1),
            sourceUnits: [...fresh.report.entry.sourceUnits],
          },
          type: "change.ignored",
        },
      ]);
      return { ...fresh.report, written: true };
    }
    throw new Error("skillset: source or pending change evidence kept changing while change ignore was applying; retry the command");
  });
}

async function planChangeIgnore(
  rootPath: string,
  storageOptions: ChangeStatusOptions,
  ref: string
): Promise<PlannedChangeIgnore> {
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
  const sourceUnits = [...entry.sourceHashes]
    .flatMap(([selector, hashes]) => hashes.map((sourceHash) => ({
      hashSchema: "skillset-source-unit-v2",
      selector,
      sourceHash,
    })))
    .toSorted((left, right) => compareStrings(`${left.selector}\0${left.sourceHash}`, `${right.selector}\0${right.sourceHash}`));
  const report = {
    alreadyIgnored: hasRecordedChangeIgnore(entry),
    entry: {
      path: entry.path,
      ref: `@${entry.id}`,
      sourceUnits,
    },
    ledgerPath: workspaceChangeFile(storageOptions.sourceDir, "ledger.jsonl"),
    written: false,
  } satisfies ChangeIgnoreReport;
  return {
    key: JSON.stringify({
      bump: entry.bump,
      group: entry.group,
      id: entry.id,
      ignored: entry.ignored,
      path: entry.path,
      reason: entry.reason,
      scopes: entry.scopes,
      sourceUnits,
    }),
    report,
  };
}
