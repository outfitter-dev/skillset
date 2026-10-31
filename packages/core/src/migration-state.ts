import { readFile } from "./workspace-fs";
import { createHash } from "node:crypto";

import { MIGRATION_STATE_SCHEMA_VERSION, validateMigrationState, type MigrationState } from "@skillset/schema";
import { readOnDiskJson } from "./on-disk-json";
import { compareStrings } from "./path";
import { prepareRepositoryMutationPath } from "./repository-mutation";
import type { WorkspaceTransactionWrite } from "./workspace-transaction";

export const MIGRATION_STATE_PATH = ".skillset/adopt/state.json";

/** Exact disk bytes are retained for the workspace transaction's preimage check. */
export interface MigrationStateSnapshot {
  readonly state: MigrationState;
  readonly content?: string;
}

/** Structural ownership stays in Schema; duplicate identity is a ledger semantic error. */
export function assertMigrationState(value: unknown): asserts value is MigrationState {
  const validation = validateMigrationState(value);
  if (!validation.ok) {
    throw new Error(`skillset: malformed migration state: ${validation.diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  }
  const state = value as MigrationState;
  const ids = new Set<string>();
  for (const flag of state.flags) {
    if (ids.has(flag.id)) throw new Error(`skillset: duplicate migration flag ID: ${flag.id}`);
    ids.add(flag.id);
  }
}

/** Read-only; missing state is empty, malformed or unsafe state is never absence. */
export async function readMigrationState(workspaceRoot: string): Promise<MigrationStateSnapshot> {
  const prepared = await prepareRepositoryMutationPath(workspaceRoot, MIGRATION_STATE_PATH, { createParents: false });
  let content: string | undefined;
  const result = await readOnDiskJson(prepared.path, {
    label: MIGRATION_STATE_PATH, missing: "absent",
    readText: async (path) => {
      content = await readFile(path, "utf8");
      return content;
    },
  });
  if (result.kind === "absent") return { state: { schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, flags: [] } };
  assertMigrationState(result.value);
  return { state: result.value, content: content! };
}

/** Compose this write into the caller's existing transaction; never write an unguarded snapshot. */
export function planMigrationStateWrite(previous: MigrationStateSnapshot, next: MigrationState): WorkspaceTransactionWrite {
  assertMigrationState(next);
  return {
    path: MIGRATION_STATE_PATH,
    content: `${JSON.stringify(canonicalMigrationState(next), null, 2)}\n`,
    ...(previous.content === undefined ? { expectedAbsent: true } : { expectedContent: previous.content }),
  };
}

/** Review state identity is deliberately outside package-facing source/release hashes. */
export function hashMigrationState(state: MigrationState): string {
  assertMigrationState(state);
  return `migration-state:sha256:${migrationDigest(canonicalMigrationState(state))}`;
}

export function migrationDigest(value: unknown): string {
  return createHash("sha256").update(`skillset.migration-state@1\0${JSON.stringify(sortKeys(value))}`).digest("hex");
}

function canonicalMigrationState(state: MigrationState): unknown {
  return sortKeys({ ...state, flags: [...state.flags].sort((a, b) => compareStrings(a.id, b.id)).map((flag) => ({
    ...flag,
    relatedReportIds: [...flag.relatedReportIds].sort(compareStrings),
    evidence: [...flag.evidence].sort((a, b) => compareStrings(JSON.stringify(sortKeys(a)), JSON.stringify(sortKeys(b)))),
  })) });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareStrings(a, b)).map(([key, item]) => [key, sortKeys(item)]));
}
