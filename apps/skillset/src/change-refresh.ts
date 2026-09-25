import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { compareStrings } from "@skillset/core/internal/path";
import {
  pluginScopeFromSourceUnit,
  sourceUnitDisplay,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { JsonRecord } from "@skillset/core/internal/types";
import { workspaceChangeFile } from "@skillset/core";

import { changeCheck, resolvePendingChangeRef } from "./change-entries";
import type { ChangeLedgerLockOptions } from "./change-ledger-lock";
import { withChangeLedgerMutation } from "./change-ledger-mutation";
import { detectWorkspaceOptions, SOURCE_HASH_SCHEMA, type ChangeStatusOptions } from "./change-status";

export interface ChangeRefreshOptions extends ChangeStatusOptions {
  /** @internal Test seam for a source edit between the initial and final plans. */
  readonly beforeFinalComparison?: () => Promise<void>;
  /** @internal Test seam for fencing immediately before the append ownership check. */
  readonly beforeOwnershipVerification?: () => Promise<void>;
  /** @internal Deterministic timing and liveness controls for lock regressions. */
  readonly lock?: ChangeLedgerLockOptions;
  readonly ref?: string;
  readonly write: boolean;
}

export interface ChangeRefreshScope {
  readonly currentHash: string;
  readonly priorHashes: readonly string[];
  readonly scope: string;
}

export interface ChangeRefreshEntry {
  readonly path: string;
  readonly ref: string;
  readonly scopes: readonly ChangeRefreshScope[];
}

export interface ChangeRefreshReport {
  readonly entries: readonly ChangeRefreshEntry[];
  readonly ledgerPath: string;
  readonly written: boolean;
}

const REFRESHABLE_EVIDENCE_CODES = new Set(["change-evidence-missing", "change-evidence-stale"]);

export async function refreshChangeEvidenceWithAppend(
  rootPath: string,
  options: ChangeRefreshOptions
): Promise<ChangeRefreshReport> {
  const storageOptions = await detectWorkspaceOptions(rootPath, options);
  if (!options.write) return planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);

  return withChangeLedgerMutation(rootPath, storageOptions.sourceDir, options.lock, async (mutation) => {
    let beforeFinalComparison = options.beforeFinalComparison;
    let beforeOwnershipVerification = options.beforeOwnershipVerification;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const planned = await planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);
      if (planned.entries.length === 0) return planned;
      await beforeFinalComparison?.();
      beforeFinalComparison = undefined;
      const confirmed = await planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);
      if (refreshPlanKey(planned) !== refreshPlanKey(confirmed)) continue;
      await mutation.assertOwned();
      await beforeOwnershipVerification?.();
      beforeOwnershipVerification = undefined;
      const fresh = await planChangeEvidenceRefresh(rootPath, storageOptions, options.ref);
      if (refreshPlanKey(confirmed) !== refreshPlanKey(fresh)) continue;
      await mutation.assertOwned();
      await mutation.appendLedger(refreshLedgerEvents(fresh.entries));
      return { ...fresh, written: true };
    }
    throw new Error("skillset: source or pending change evidence kept changing while change refresh was applying; retry the command");
  });
}

async function planChangeEvidenceRefresh(
  rootPath: string,
  storageOptions: ChangeStatusOptions,
  ref: string | undefined
): Promise<ChangeRefreshReport> {
  const report = await changeCheck(rootPath, ref === undefined ? storageOptions : { ...storageOptions, ref });
  const selected = ref === undefined ? report.entries : [resolvePendingChangeRef(report.entries, ref)];
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  const blocking = report.issues.filter((issue) => {
    if (issue.severity !== "error" || issue.code === "change-uncovered") return false;
    return issue.path === undefined || (selectedPaths.has(issue.path) && !REFRESHABLE_EVIDENCE_CODES.has(issue.code));
  });
  for (const entry of selected) {
    if (entry.format !== "frontmatter") continue;
    blocking.push({
      code: "change-frontmatter-compatibility",
      message: "frontmatter pending entries must be migrated before evidence can be refreshed",
      path: entry.path,
      severity: "error",
    });
  }
  if (ref === undefined) {
    const covered = new Set<string>();
    for (const entry of selected) {
      if (blocking.some((issue) => issue.path === entry.path)) continue;
      for (const scope of entry.scopes) {
        covered.add(scope);
        const pluginScope = pluginScopeFromSourceUnit(scope);
        if (pluginScope !== undefined) covered.add(pluginScope);
      }
    }
    for (const change of report.status.sourceChanges) {
      if (covered.has(change.id)) continue;
      blocking.push({
        code: "change-uncovered",
        message: `source change ${sourceUnitDisplay(change.id)} is missing an otherwise-valid pending change entry`,
        severity: "error",
      });
    }
  }
  if (blocking.length > 0) {
    const details = blocking
      .toSorted((left, right) => compareStrings(`${left.path ?? ""}\0${left.code}`, `${right.path ?? ""}\0${right.code}`))
      .map((issue) => `${issue.path ?? "workspace"}: [${issue.code}] ${issue.message}`);
    throw new Error(`skillset: cannot refresh non-validating pending change evidence\n${details.join("\n")}`);
  }

  const currentById = new Map(report.status.sourceUnits.map((unit) => [unit.id, unit.hash]));
  const changedById = new Map(report.status.sourceChanges.map((change) => [change.id, change]));
  const entries: ChangeRefreshEntry[] = [];
  for (const entry of selected.toSorted((left, right) => compareStrings(left.path, right.path))) {
    if (entry.id === undefined) continue;
    const scopes: ChangeRefreshScope[] = [];
    for (const scope of entry.scopes.map(sourceUnitSelector).toSorted(compareStrings)) {
      const change = changedById.get(scope);
      const currentHash = change?.currentHash ?? change?.baselineHash ?? currentById.get(scope);
      if (currentHash === undefined || (entry.sourceHashes.get(scope) ?? []).includes(currentHash)) continue;
      scopes.push({ currentHash, priorHashes: [...(entry.sourceHashes.get(scope) ?? [])].toSorted(compareStrings), scope });
    }
    if (scopes.length === 0) continue;
    entries.push({ path: entry.path, ref: `@${entry.id}`, scopes });
  }
  return {
    entries,
    ledgerPath: workspaceChangeFile(storageOptions.sourceDir, "ledger.jsonl"),
    written: false,
  };
}

function refreshLedgerEvents(entries: readonly ChangeRefreshEntry[]): readonly {
  readonly payload: JsonRecord;
  readonly type: ChangeLedgerEventType;
}[] {
  return entries.map((entry) => ({
    payload: {
      reasonId: entry.ref.slice(1),
      sourceUnits: entry.scopes.map((scope) => ({
        hashSchema: SOURCE_HASH_SCHEMA,
        selector: scope.scope,
        sourceHash: scope.currentHash,
      })),
    },
    type: "change.covered",
  }));
}

function refreshPlanKey(report: ChangeRefreshReport): string {
  return JSON.stringify(report.entries);
}
