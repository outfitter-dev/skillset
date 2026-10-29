import { validateMigrationState, type MigrationFlag, type MigrationObservation, type MigrationState } from "@skillset/schema";
import { assertMigrationState, migrationDigest } from "./migration-state";
import { compareStrings } from "./path";

export interface MigrationReconciliationDiagnostic {
  readonly code: "migration/duplicate" | "migration/orphan" | "migration/ambiguous-identity" | "migration/stale-location" | "migration/stale-evidence" | "migration/malformed";
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly id?: string;
  readonly path?: string;
}
export interface MigrationReconciliation {
  readonly state: MigrationState;
  readonly diagnostics: readonly MigrationReconciliationDiagnostic[];
}

/**
 * Reconcile a complete scan. Explicit anchors reserve identities before unique
 * fingerprint matching. Any blocking diagnostic returns the unchanged ledger,
 * so a caller cannot accidentally persist a partial or guessed reconciliation.
 * Missing observations never resolve records, including sidecar-only records.
 */
export function reconcileMigrationState(previous: MigrationState, observations: readonly MigrationObservation[]): MigrationReconciliation {
  assertMigrationState(previous);
  const diagnostics: MigrationReconciliationDiagnostic[] = [];
  const old = new Map(previous.flags.map((flag) => [flag.id, flag]));
  const matched = new Map<string, MigrationObservation>();
  const pending: MigrationObservation[] = [];
  const explicitIds = new Set<string>();
  const occurrences = new Set<string>();
  const error = (code: MigrationReconciliationDiagnostic["code"], message: string, observation: MigrationObservation) => {
    diagnostics.push({ code, severity: "error", message, ...(observation.id ? { id: observation.id } : {}), path: observation.source?.path });
  };
  for (const observation of observations) {
    const id = observation.id ?? "adopt-validation";
    const validation = validateMigrationState({ schemaVersion: previous.schemaVersion, flags: [{ ...observation, id, state: "open", history: [] }] });
    if (!validation.ok) {
      error("migration/malformed", validation.diagnostics.map((item) => `${item.path}: ${item.message}`).join("; "), observation);
      continue;
    }
    const occurrence = initialId(observation);
    if (occurrences.has(occurrence)) error("migration/duplicate", "Duplicate scan observation at the same evidence location.", observation);
    occurrences.add(occurrence);
    if (observation.id === undefined) {
      pending.push(observation);
      continue;
    }
    if (explicitIds.has(observation.id)) error("migration/duplicate", "An explicit anchor ID occurs more than once in the scan.", observation);
    explicitIds.add(observation.id);
    const existing = old.get(observation.id);
    if (existing === undefined) {
      error("migration/orphan", "Explicit anchor has no ledger entry; review its origin instead of inventing ownership.", observation);
    } else if (matchKey(existing) !== matchKey(observation) || reviewEvidence(existing) !== reviewEvidence(observation)) {
      error("migration/stale-evidence", "Explicit anchor evidence changed; retain its prior decision until reviewed.", observation);
    } else matched.set(existing.id, observation);
  }

  const byFingerprint = new Map<string, MigrationFlag[]>();
  for (const flag of previous.flags) {
    if (explicitIds.has(flag.id)) continue;
    const key = matchKey(flag);
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), flag]);
  }
  const pendingCounts = new Map<string, number>();
  for (const item of pending) pendingCounts.set(matchKey(item), (pendingCounts.get(matchKey(item)) ?? 0) + 1);
  const added: MigrationFlag[] = [];
  for (const item of pending) {
    const candidates = byFingerprint.get(matchKey(item)) ?? [];
    if (candidates.length > 1 || (candidates.length === 1 && pendingCounts.get(matchKey(item)) !== 1)) {
      error("migration/ambiguous-identity", "Fingerprint evidence does not identify one ledger entry and one observation; retain explicit anchors.", item);
    } else if (candidates.length === 1) {
      const existing = candidates[0]!;
      if (reviewEvidence(existing) !== reviewEvidence(item)) {
        error("migration/stale-evidence", "Matched content has changed review evidence; retain its prior decision until reviewed.", item);
      } else matched.set(existing.id, item);
    } else {
      const id = initialId(item);
      if (old.has(id)) error("migration/duplicate", "Initial identity collides with a retained ledger entry.", item);
      else added.push({ ...item, id, state: "open", history: [] });
    }
  }
  if (diagnostics.some((item) => item.severity === "error")) return { state: previous, diagnostics };

  const flags = previous.flags.map((flag): MigrationFlag => {
    const observation = matched.get(flag.id);
    if (observation === undefined) {
      diagnostics.push({ code: "migration/orphan", severity: "warning", id: flag.id, path: flag.source.path,
        message: "Ledger entry was not observed. Absence does not resolve or accept it." });
      return flag;
    }
    if (migrationDigest(flag.source) !== migrationDigest(observation.source) || migrationDigest(flag.placement) !== migrationDigest(observation.placement)) {
      diagnostics.push({ code: "migration/stale-location", severity: "warning", id: flag.id, path: observation.source.path,
        message: "Matched identity has moved; the proposed ledger updates its location." });
    }
    // Keep the author decision and its historical evidence. Rescanning refreshes
    // location/placement and report associations, not review authority.
    return { ...flag, source: observation.source, placement: observation.placement,
      relatedReportIds: [...new Set([...flag.relatedReportIds, ...observation.relatedReportIds])].sort(compareStrings) };
  });
  return { state: { ...previous, flags: [...flags, ...added].sort((a, b) => compareStrings(a.id, b.id)) }, diagnostics };
}

function matchKey(item: MigrationObservation): string {
  return migrationDigest({ code: item.code, severity: item.severity, disposition: item.disposition, fingerprints: item.fingerprints });
}

function initialId(item: MigrationObservation): string {
  return `adopt-${migrationDigest({ evidence: matchKey(item), source: item.source, origin: item.origin }).slice(0, 32)}`;
}

function reviewEvidence(item: MigrationObservation): string {
  return migrationDigest({
    message: item.message,
    origin: item.origin,
    evidence: item.evidence.map((entry) => migrationDigest(entry)).sort(compareStrings),
  });
}
