import { createHash } from "node:crypto";

import type { JsonRecord, JsonValue } from "./types";
import { stringifyJson } from "./yaml";

const PROVENANCE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function lockProvenanceHash(lock: JsonRecord): string {
  const canonical = Object.fromEntries(
    Object.entries(lock).filter(([key]) => key !== "provenanceHash")
  );
  return `sha256:${createHash("sha256")
    .update("skillset.lock.provenance@1\0")
    .update(stringifyJson(canonical))
    .digest("hex")}`;
}

export function hasValidLockProvenance(lock: JsonRecord): boolean {
  return isLockProvenanceHash(lock.provenanceHash) &&
    lock.provenanceHash === lockProvenanceHash(lock);
}

export function withLockProvenance(lock: JsonRecord): JsonRecord {
  return {
    ...lock,
    provenanceHash: lockProvenanceHash(lock),
  };
}

function isLockProvenanceHash(value: JsonValue | undefined): value is string {
  return typeof value === "string" && PROVENANCE_HASH_PATTERN.test(value);
}
