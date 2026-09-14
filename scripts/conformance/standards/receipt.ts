/* eslint-disable func-style, no-use-before-define, sort-keys -- The receipt schema and top-down parser deliberately mirror the persisted contract before private validators. */
/* eslint-disable no-nested-ternary, unicorn/no-array-for-each, unicorn/no-nested-ternary -- Canonical key ordering and small validation walks are clearer in their direct forms. */
import { createHash } from "node:crypto";

export const STANDARDS_CONFORMANCE_RECEIPT_SCHEMA_VERSION =
  "skillset.standards-conformance-receipt@1" as const;

export const STANDARDS_CONFORMANCE_PROFILE_IDS = [
  "agent-instructions",
  "agent-skills",
  "agent-plugins-1.0",
] as const;

export type StandardsConformanceProfileId =
  (typeof STANDARDS_CONFORMANCE_PROFILE_IDS)[number];

export interface StandardsConformanceSnapshot {
  readonly contentHash: `sha256:${string}`;
  readonly kind: "schema" | "specification";
  readonly revision: string;
  readonly source: string;
}

export interface StandardsConformanceArtifact {
  readonly bytes: number;
  readonly hash: `sha256:${string}`;
  readonly mode: string;
  readonly path: string;
}

export interface StandardsConformanceValidator {
  readonly argv: readonly string[];
  readonly id: string;
  readonly integrity: string;
  readonly outcome: "passed";
  readonly pin: string;
  readonly version: string;
}

export interface StandardsConformanceCanary {
  readonly argv: readonly string[];
  readonly id: string;
  readonly observed: "rejected";
  readonly path: string;
}

export interface StandardsConformanceConsumer {
  readonly id: string;
  readonly integrity: string;
  readonly pin: string;
  readonly version: string;
}

export interface StandardsConformanceSafetySnapshot {
  readonly hash: `sha256:${string}`;
  readonly root: string;
}

export interface StandardsConformanceReceipt {
  readonly artifacts: readonly StandardsConformanceArtifact[];
  readonly canaries: readonly StandardsConformanceCanary[];
  readonly consumers: readonly StandardsConformanceConsumer[];
  readonly lifecycle: "candidate";
  readonly limitations: readonly string[];
  readonly observations: readonly string[];
  readonly profile: StandardsConformanceProfileId;
  readonly profileSnapshot: {
    readonly contentHash: `sha256:${string}`;
    readonly snapshots: readonly StandardsConformanceSnapshot[];
    readonly version: string;
  };
  readonly recordedAt: string;
  readonly renderer: {
    readonly clean: true;
    readonly commit: string;
  };
  readonly safety: {
    readonly after: readonly StandardsConformanceSafetySnapshot[];
    readonly before: readonly StandardsConformanceSafetySnapshot[];
    readonly unchanged: true;
  };
  readonly schemaVersion: typeof STANDARDS_CONFORMANCE_RECEIPT_SCHEMA_VERSION;
  readonly sourceTree: {
    readonly fileCount: number;
    readonly sourceHash: `sha256:${string}`;
    readonly treeHash: `sha256:${string}`;
  };
  readonly validators: readonly StandardsConformanceValidator[];
}

const HASH_PATTERN = "^sha256:[a-f0-9]{64}$";
const NONEMPTY_STRING = { minLength: 1, type: "string" } as const;

/** JSON Schema for persisted maintainer evidence; this is not a product config surface. */
export const STANDARDS_CONFORMANCE_RECEIPT_JSON_SCHEMA = {
  $id: "https://skillset.dev/schemas/internal/standards-conformance-receipt-v1.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: {
    artifacts: {
      items: {
        additionalProperties: false,
        properties: {
          bytes: { minimum: 0, type: "integer" },
          hash: { pattern: HASH_PATTERN, type: "string" },
          mode: { pattern: "^[0-7]{6}$", type: "string" },
          path: NONEMPTY_STRING,
        },
        required: ["bytes", "hash", "mode", "path"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    canaries: {
      items: {
        additionalProperties: false,
        properties: {
          argv: { items: NONEMPTY_STRING, minItems: 1, type: "array" },
          id: NONEMPTY_STRING,
          observed: { const: "rejected" },
          path: NONEMPTY_STRING,
        },
        required: ["argv", "id", "observed", "path"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    consumers: {
      items: {
        additionalProperties: false,
        properties: {
          id: NONEMPTY_STRING,
          integrity: NONEMPTY_STRING,
          pin: NONEMPTY_STRING,
          version: NONEMPTY_STRING,
        },
        required: ["id", "integrity", "pin", "version"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    lifecycle: { const: "candidate" },
    limitations: { items: NONEMPTY_STRING, type: "array" },
    observations: { items: NONEMPTY_STRING, type: "array" },
    profile: { enum: STANDARDS_CONFORMANCE_PROFILE_IDS },
    profileSnapshot: {
      additionalProperties: false,
      properties: {
        contentHash: { pattern: HASH_PATTERN, type: "string" },
        snapshots: {
          items: {
            additionalProperties: false,
            properties: {
              contentHash: { pattern: HASH_PATTERN, type: "string" },
              kind: { enum: ["schema", "specification"] },
              revision: NONEMPTY_STRING,
              source: NONEMPTY_STRING,
            },
            required: ["contentHash", "kind", "revision", "source"],
            type: "object",
          },
          minItems: 1,
          type: "array",
        },
        version: NONEMPTY_STRING,
      },
      required: ["contentHash", "snapshots", "version"],
      type: "object",
    },
    recordedAt: { format: "date-time", type: "string" },
    renderer: {
      additionalProperties: false,
      properties: {
        clean: { const: true },
        commit: { pattern: "^[a-f0-9]{40}$", type: "string" },
      },
      required: ["clean", "commit"],
      type: "object",
    },
    safety: {
      additionalProperties: false,
      properties: {
        after: { $ref: "#/$defs/safetySnapshots" },
        before: { $ref: "#/$defs/safetySnapshots" },
        unchanged: { const: true },
      },
      required: ["after", "before", "unchanged"],
      type: "object",
    },
    schemaVersion: { const: STANDARDS_CONFORMANCE_RECEIPT_SCHEMA_VERSION },
    sourceTree: {
      additionalProperties: false,
      properties: {
        fileCount: { minimum: 1, type: "integer" },
        sourceHash: { pattern: HASH_PATTERN, type: "string" },
        treeHash: { pattern: HASH_PATTERN, type: "string" },
      },
      required: ["fileCount", "sourceHash", "treeHash"],
      type: "object",
    },
    validators: {
      items: {
        additionalProperties: false,
        properties: {
          argv: { items: NONEMPTY_STRING, minItems: 1, type: "array" },
          id: NONEMPTY_STRING,
          integrity: NONEMPTY_STRING,
          outcome: { const: "passed" },
          pin: NONEMPTY_STRING,
          version: NONEMPTY_STRING,
        },
        required: ["argv", "id", "integrity", "outcome", "pin", "version"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
  },
  required: [
    "artifacts",
    "canaries",
    "consumers",
    "lifecycle",
    "limitations",
    "observations",
    "profile",
    "profileSnapshot",
    "recordedAt",
    "renderer",
    "safety",
    "schemaVersion",
    "sourceTree",
    "validators",
  ],
  type: "object",
  $defs: {
    safetySnapshots: {
      items: {
        additionalProperties: false,
        properties: {
          hash: { pattern: HASH_PATTERN, type: "string" },
          root: NONEMPTY_STRING,
        },
        required: ["hash", "root"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
  },
} as const;

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const MODE = /^[0-7]{6}$/u;

export function parseStandardsConformanceReceipt(
  value: unknown
): StandardsConformanceReceipt {
  const receipt = object(value, "receipt", [
    "artifacts",
    "canaries",
    "consumers",
    "lifecycle",
    "limitations",
    "observations",
    "profile",
    "profileSnapshot",
    "recordedAt",
    "renderer",
    "safety",
    "schemaVersion",
    "sourceTree",
    "validators",
  ]);
  literal(
    receipt.schemaVersion,
    STANDARDS_CONFORMANCE_RECEIPT_SCHEMA_VERSION,
    "receipt.schemaVersion"
  );
  literal(receipt.lifecycle, "candidate", "receipt.lifecycle");
  oneOf(receipt.profile, STANDARDS_CONFORMANCE_PROFILE_IDS, "receipt.profile");
  isoDate(receipt.recordedAt, "receipt.recordedAt");

  const profileSnapshot = object(
    receipt.profileSnapshot,
    "receipt.profileSnapshot",
    ["contentHash", "snapshots", "version"]
  );
  hash(profileSnapshot.contentHash, "receipt.profileSnapshot.contentHash");
  string(profileSnapshot.version, "receipt.profileSnapshot.version");
  array(
    profileSnapshot.snapshots,
    "receipt.profileSnapshot.snapshots",
    true
  ).forEach((entry, index) => {
    const snapshot = object(
      entry,
      `receipt.profileSnapshot.snapshots[${index}]`,
      ["contentHash", "kind", "revision", "source"]
    );
    hash(
      snapshot.contentHash,
      `receipt.profileSnapshot.snapshots[${index}].contentHash`
    );
    oneOf(
      snapshot.kind,
      ["schema", "specification"] as const,
      `receipt.profileSnapshot.snapshots[${index}].kind`
    );
    string(
      snapshot.revision,
      `receipt.profileSnapshot.snapshots[${index}].revision`
    );
    string(
      snapshot.source,
      `receipt.profileSnapshot.snapshots[${index}].source`
    );
  });

  const sourceTree = object(receipt.sourceTree, "receipt.sourceTree", [
    "fileCount",
    "sourceHash",
    "treeHash",
  ]);
  integer(sourceTree.fileCount, "receipt.sourceTree.fileCount", 1);
  hash(sourceTree.sourceHash, "receipt.sourceTree.sourceHash");
  hash(sourceTree.treeHash, "receipt.sourceTree.treeHash");

  const renderer = object(receipt.renderer, "receipt.renderer", [
    "clean",
    "commit",
  ]);
  literal(renderer.clean, true, "receipt.renderer.clean");
  match(renderer.commit, COMMIT, "receipt.renderer.commit");

  array(receipt.artifacts, "receipt.artifacts", true).forEach(
    (entry, index) => {
      const artifact = object(entry, `receipt.artifacts[${index}]`, [
        "bytes",
        "hash",
        "mode",
        "path",
      ]);
      integer(artifact.bytes, `receipt.artifacts[${index}].bytes`, 0);
      hash(artifact.hash, `receipt.artifacts[${index}].hash`);
      match(artifact.mode, MODE, `receipt.artifacts[${index}].mode`);
      relativePath(artifact.path, `receipt.artifacts[${index}].path`);
    }
  );

  array(receipt.validators, "receipt.validators", true).forEach(
    (entry, index) => {
      const validator = object(entry, `receipt.validators[${index}]`, [
        "argv",
        "id",
        "integrity",
        "outcome",
        "pin",
        "version",
      ]);
      stringArray(validator.argv, `receipt.validators[${index}].argv`, true);
      for (const key of ["id", "integrity", "pin", "version"] as const) {
        string(validator[key], `receipt.validators[${index}].${key}`);
      }
      literal(
        validator.outcome,
        "passed",
        `receipt.validators[${index}].outcome`
      );
    }
  );

  array(receipt.canaries, "receipt.canaries", true).forEach((entry, index) => {
    const canary = object(entry, `receipt.canaries[${index}]`, [
      "argv",
      "id",
      "observed",
      "path",
    ]);
    stringArray(canary.argv, `receipt.canaries[${index}].argv`, true);
    string(canary.id, `receipt.canaries[${index}].id`);
    literal(canary.observed, "rejected", `receipt.canaries[${index}].observed`);
    relativePath(canary.path, `receipt.canaries[${index}].path`);
  });

  array(receipt.consumers, "receipt.consumers", true).forEach(
    (entry, index) => {
      const consumer = object(entry, `receipt.consumers[${index}]`, [
        "id",
        "integrity",
        "pin",
        "version",
      ]);
      for (const key of ["id", "integrity", "pin", "version"] as const) {
        string(consumer[key], `receipt.consumers[${index}].${key}`);
      }
    }
  );

  const safety = object(receipt.safety, "receipt.safety", [
    "after",
    "before",
    "unchanged",
  ]);
  literal(safety.unchanged, true, "receipt.safety.unchanged");
  const before = safetySnapshots(safety.before, "receipt.safety.before");
  const after = safetySnapshots(safety.after, "receipt.safety.after");
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    fail("receipt.safety", "before and after snapshots must match exactly");
  }

  stringArray(receipt.observations, "receipt.observations", false);
  stringArray(receipt.limitations, "receipt.limitations", false);
  return deepFreeze(
    structuredClone(receipt)
  ) as unknown as StandardsConformanceReceipt;
}

export function createStandardsConformanceReceipt(
  receipt: StandardsConformanceReceipt
): StandardsConformanceReceipt {
  return parseStandardsConformanceReceipt(receipt);
}

/** Canonical persisted bytes: object keys sorted recursively, array order preserved. */
export function serializeStandardsConformanceReceipt(value: unknown): string {
  return `${JSON.stringify(canonicalize(parseStandardsConformanceReceipt(value)))}\n`;
}

/** Content address for the exact canonical bytes returned by the serializer. */
export function hashStandardsConformanceReceipt(
  value: unknown
): `sha256:${string}` {
  const serialized = serializeStandardsConformanceReceipt(value);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
}

function safetySnapshots(value: unknown, path: string): readonly unknown[] {
  const snapshots = array(value, path, true);
  snapshots.forEach((entry, index) => {
    const snapshot = object(entry, `${path}[${index}]`, ["hash", "root"]);
    hash(snapshot.hash, `${path}[${index}].hash`);
    string(snapshot.root, `${path}[${index}].root`);
  });
  return snapshots;
}

function object(
  value: unknown,
  path: string,
  keys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).toSorted();
  const expected = [...keys].toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(path, `must contain exactly: ${expected.join(", ")}`);
  }
  return record;
}

function array(
  value: unknown,
  path: string,
  nonempty: boolean
): readonly unknown[] {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    fail(path, nonempty ? "must be a non-empty array" : "must be an array");
  }
  return value;
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "must be a non-empty string");
  }
}

function stringArray(value: unknown, path: string, nonempty: boolean): void {
  array(value, path, nonempty).forEach((entry, index) =>
    string(entry, `${path}[${index}]`)
  );
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    fail(path, `must be ${JSON.stringify(expected)}`);
  }
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  expected: T,
  path: string
): asserts value is T[number] {
  if (typeof value !== "string" || !expected.includes(value)) {
    fail(path, `must be one of: ${expected.join(", ")}`);
  }
}

function match(
  value: unknown,
  pattern: RegExp,
  path: string
): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(path, `must match ${pattern.source}`);
  }
}

function hash(
  value: unknown,
  path: string
): asserts value is `sha256:${string}` {
  match(value, HASH, path);
}

function integer(value: unknown, path: string, minimum: number): void {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(path, `must be an integer >= ${minimum}`);
  }
}

function isoDate(value: unknown, path: string): void {
  string(value, path);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail(path, "must be a canonical ISO 8601 UTC date-time");
  }
}

function relativePath(value: unknown, path: string): void {
  string(value, path);
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").includes("..")
  ) {
    fail(path, "must be a portable relative path");
  }
}

function deepFreeze<T>(value: T): T {
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (
      typeof nested === "object" &&
      nested !== null &&
      !Object.isFrozen(nested)
    ) {
      deepFreeze(nested);
    }
  }
  return value;
}

function fail(path: string, message: string): never {
  throw new Error(
    `skillset: invalid standards conformance receipt: ${path} ${message}`
  );
}
