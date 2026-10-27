import { createHash } from "node:crypto";

import type { JsonRecord, JsonValue } from "./types";
import { isJsonRecord, stringifyJson } from "./yaml";

const PROVENANCE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * First lock schema whose provenance is split per entry (ADR-0045): a header
 * hash over the config-derived top-level fields and one hash per item, so two
 * branches that change different units touch different lock lines.
 */
export const PER_ENTRY_PROVENANCE_SCHEMA_VERSION = 5;

/** Top-level fields the header hash leaves out: each item carries its own. */
const UNHASHED_HEADER_KEYS = new Set([
  "headerHash",
  "items",
  "provenanceHash",
  "renderResults",
]);

function sha256(domain: string, value: JsonRecord): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(stringifyJson(value))
    .digest("hex")}`;
}

function documentProvenanceHash(lock: JsonRecord): string {
  const canonical = Object.fromEntries(
    Object.entries(lock).filter(([key]) => key !== "provenanceHash")
  );
  return sha256("skillset.lock.provenance@1", canonical);
}

function headerProvenanceHash(lock: JsonRecord): string {
  const header = Object.fromEntries(
    Object.entries(lock).filter(([key]) => !UNHASHED_HEADER_KEYS.has(key))
  );
  return sha256("skillset.lock.header@1", header);
}

function itemProvenanceHash(item: JsonRecord): string {
  const canonical = Object.fromEntries(
    Object.entries(item).filter(([key]) => key !== "provenanceHash")
  );
  return sha256("skillset.lock.item@1", canonical);
}

/** Whether a lock records per-entry provenance rather than one document hash. */
export function usesPerEntryProvenance(lock: JsonRecord): boolean {
  return typeof lock.schemaVersion === "number" &&
    lock.schemaVersion >= PER_ENTRY_PROVENANCE_SCHEMA_VERSION;
}

/** Whether the lock carries any provenance field this compiler writes. */
export function hasLockProvenanceFields(lock: JsonRecord): boolean {
  return usesPerEntryProvenance(lock)
    ? lock.headerHash !== undefined
    : lock.provenanceHash !== undefined;
}

/**
 * A v5 lock is trusted exactly when its header hash and every item hash
 * verify. Earlier locks verify their single document hash.
 */
export function hasValidLockProvenance(lock: JsonRecord): boolean {
  if (!usesPerEntryProvenance(lock)) {
    return isLockProvenanceHash(lock.provenanceHash) &&
      lock.provenanceHash === documentProvenanceHash(lock);
  }
  if (lock.provenanceHash !== undefined) return false;
  if (
    !isLockProvenanceHash(lock.headerHash) ||
    lock.headerHash !== headerProvenanceHash(lock)
  ) {
    return false;
  }
  if (!Array.isArray(lock.items)) return false;
  return lock.items.every((item) =>
    isJsonRecord(item) &&
    isLockProvenanceHash(item.provenanceHash) &&
    item.provenanceHash === itemProvenanceHash(item)
  );
}

export function withLockProvenance(lock: JsonRecord): JsonRecord {
  if (!usesPerEntryProvenance(lock)) {
    return {
      ...lock,
      provenanceHash: documentProvenanceHash(lock),
    };
  }
  const { provenanceHash: _documentHash, ...rest } = lock;
  const items = Array.isArray(rest.items)
    ? rest.items.map((item) =>
      isJsonRecord(item)
        ? { ...item, provenanceHash: itemProvenanceHash(item) }
        : item
    )
    : rest.items;
  const withItems: JsonRecord = items === undefined ? rest : { ...rest, items };
  return {
    ...withItems,
    headerHash: headerProvenanceHash(withItems),
  };
}

function isLockProvenanceHash(value: JsonValue | undefined): value is string {
  return typeof value === "string" && PROVENANCE_HASH_PATTERN.test(value);
}
