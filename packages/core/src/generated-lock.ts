import { posix } from "node:path";

import {
  STANDARD_PROFILE_IDS,
  type StandardProfileId,
} from "@skillset/registry";

import { hasValidLockProvenance } from "./lock-provenance";
import { parseRenderResult, type SkillsetRenderResult } from "./render-result";
import { isTargetName } from "./targets";
import type {
  CompileBuildMode,
  JsonRecord,
  ProjectionConsumer,
  ProjectionOwner,
  SourceOrigin,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

export type GeneratedLockSchemaVersion = 1 | 2 | 3;
export type GeneratedLockHashSchema =
  | "skillset-output-v1"
  | "skillset-output-v2";

export type GeneratedLockStandardConsumer = Extract<
  ProjectionConsumer,
  { readonly standardProfile: StandardProfileId }
>;
export type GeneratedLockProviderConsumer = Extract<
  ProjectionConsumer,
  { readonly target: TargetName }
>;
export type GeneratedLockConsumer = ProjectionConsumer;
export type GeneratedLockOwner = ProjectionOwner;

export interface ParsedGeneratedLockItem {
  readonly consumers: readonly GeneratedLockConsumer[];
  readonly dependencies?: readonly string[];
  readonly feature?: string;
  readonly fileModes?: Readonly<Record<string, "0644" | "0755">>;
  readonly files: readonly string[];
  readonly kind?: string;
  readonly name?: string;
  readonly origin?: string;
  readonly outputHash?: string;
  readonly outputPath?: string;
  readonly owner?: GeneratedLockOwner;
  readonly plugin?: string;
  readonly preprocessDependencies?: readonly string[];
  readonly renderInputsHash?: string;
  readonly sourcePath?: string;
  readonly sourceHash?: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly targetState?: string;
  readonly sourcePointer?: string;
  readonly transforms?: readonly Record<string, unknown>[];
  readonly validation?: string;
  readonly version?: string;
}

export interface ParsedGeneratedLockSourceUnit {
  readonly hash: string;
  readonly id: string;
  readonly kind: string;
  readonly sourcePath: string;
}

export interface ParsedGeneratedLockSourceInventory {
  readonly hashSchema: string;
  readonly units: readonly ParsedGeneratedLockSourceUnit[];
}

export interface ParsedGeneratedLock {
  readonly buildMode?: CompileBuildMode;
  readonly generatedBy: string;
  readonly hashSchema: GeneratedLockHashSchema;
  readonly items: readonly ParsedGeneratedLockItem[];
  readonly outputRoot: string;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly schemaVersion: GeneratedLockSchemaVersion;
  readonly selectedStandards: readonly StandardProfileId[];
  readonly selectedTargets: readonly TargetName[];
  readonly sourceInventory?: ParsedGeneratedLockSourceInventory;
  readonly target: TargetName | "workspace";
}

export type ParsedCurrentGeneratedLock = Omit<
  ParsedGeneratedLock,
  "schemaVersion"
> & {
  readonly schemaVersion: 3;
};

export interface ParseGeneratedLockOptions {
  /**
   * Parse structural evidence without accepting the lock as authoritative.
   * This is reserved for recovery paths that classify or discard invalid
   * provenance instead of consuming it.
   */
  readonly provenance?: "inspect" | "require";
}

/**
 * Parse the generated-lock facts shared by status, diff, explain, reconcile,
 * and cleanup readers. The parser keeps the output-hash generation explicit:
 * v1 excludes file modes, while v2 and v3 use the v2 hash domain and require
 * complete mode evidence.
 */
export function parseGeneratedLock(
  value: unknown,
  label = "generated lock",
  options: ParseGeneratedLockOptions = {}
): ParsedGeneratedLock {
  if (!isJsonRecord(value)) throw invalidLock(label, "must be an object");

  const schemaVersion = parseSchemaVersion(value.schemaVersion, label);
  if (options.provenance !== "inspect") {
    validateProvenance(value, schemaVersion, label);
  }
  const generatedBy = requiredString(value.generatedBy, label, "generatedBy");
  if (!generatedBy.startsWith("skillset@")) {
    throw invalidLock(label, "generatedBy must identify skillset");
  }
  const outputRoot = requiredString(value.outputRoot, label, "outputRoot");
  assertOutputRoot(outputRoot, `${label}.outputRoot`);
  const target = parseLockTarget(value.target, label);
  const selectedTargets = parseTargets(value.selectedTargets, label);
  const selectedStandards =
    schemaVersion === 3 ? parseStandards(value.selectedStandards, label) : [];
  const buildMode = parseBuildMode(value.buildMode, label);
  const sourceInventory = parseSourceInventory(value.sourceInventory, label);

  if (!Array.isArray(value.items)) {
    throw invalidLock(label, "items must be an array");
  }
  const items = value.items.map((item, index) =>
    parseGeneratedLockItem(item, schemaVersion, `${label}.items[${index}]`)
  );

  const rawRenderResults = value.renderResults;
  if (rawRenderResults !== undefined && !Array.isArray(rawRenderResults)) {
    throw invalidLock(label, "renderResults must be an array when present");
  }
  const renderResults = (rawRenderResults ?? []).map((result, index) => {
    try {
      return parseRenderResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw invalidLock(
        label,
        `renderResults[${index}] is invalid: ${message}`
      );
    }
  });

  return {
    ...(buildMode === undefined ? {} : { buildMode }),
    generatedBy,
    hashSchema:
      schemaVersion === 1 ? "skillset-output-v1" : "skillset-output-v2",
    items,
    outputRoot,
    renderResults,
    schemaVersion,
    selectedStandards,
    selectedTargets,
    ...(sourceInventory === undefined ? {} : { sourceInventory }),
    target,
  };
}

/**
 * Read generated state that may authorize current compiler behavior.
 *
 * Pre-v3 locks remain structurally recognizable for bounded diagnostics, but
 * they are rebuild-only and must never supply ownership or cleanup authority.
 */
export function parseCurrentGeneratedLock(
  value: unknown,
  label = "generated lock",
  options: ParseGeneratedLockOptions = {}
): ParsedCurrentGeneratedLock {
  if (
    isJsonRecord(value) &&
    (value.schemaVersion === 1 || value.schemaVersion === 2)
  ) {
    throw invalidLock(
      label,
      `uses pre-v3 schema ${value.schemaVersion}; this generated state is rebuild-only. Preserve canonical source and user edits, move only owner-reviewed generated output to a recoverable backup, then run skillset build --yes with the current Skillset release. The old lock cannot authorize cleanup`
    );
  }
  return parseGeneratedLock(value, label, options) as ParsedCurrentGeneratedLock;
}

function parseSourceInventory(
  value: unknown,
  label: string
): ParsedGeneratedLockSourceInventory | undefined {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw invalidLock(label, "sourceInventory must be an object");
  }
  const hashSchema = requiredString(
    value.hashSchema,
    label,
    "sourceInventory.hashSchema"
  );
  if (!Array.isArray(value.units)) {
    throw invalidLock(label, "sourceInventory.units must be an array");
  }
  const units = value.units.map((unit, index) => {
    const unitLabel = `${label}.sourceInventory.units[${index}]`;
    if (!isJsonRecord(unit)) {
      throw invalidLock(unitLabel, "must be an object");
    }
    const hash = requiredString(unit.hash, unitLabel, "hash");
    const id = requiredString(unit.id, unitLabel, "id");
    const kind = requiredString(unit.kind, unitLabel, "kind");
    const sourcePath = requiredString(unit.sourcePath, unitLabel, "sourcePath");
    assertManagedRelativePath(sourcePath, `${unitLabel}.sourcePath`);
    return { hash, id, kind, sourcePath };
  });
  return { hashSchema, units };
}

function parseGeneratedLockItem(
  value: unknown,
  schemaVersion: GeneratedLockSchemaVersion,
  label: string
): ParsedGeneratedLockItem {
  if (!isJsonRecord(value)) throw invalidLock(label, "must be an object");
  if (!Array.isArray(value.files)) {
    throw invalidLock(label, "files must be an array");
  }
  const files = value.files.map((file, index) => {
    if (typeof file !== "string" || file.trim().length === 0) {
      throw invalidLock(label, `files[${index}] must be a non-empty string`);
    }
    assertManagedRelativePath(file, `${label}.files[${index}]`);
    return file;
  });
  const fileModes = parseFileModes(
    value.fileModes,
    files,
    schemaVersion,
    label
  );
  const outputHash = optionalString(value.outputHash, label, "outputHash");
  const kind = optionalString(value.kind, label, "kind");
  const name = optionalString(value.name, label, "name");
  const origin = optionalString(value.origin, label, "origin");
  const outputPath = optionalString(value.outputPath, label, "outputPath");
  if (outputPath !== undefined) {
    assertManagedRelativePath(outputPath, `${label}.outputPath`);
  }
  const sourcePath = optionalString(value.sourcePath, label, "sourcePath");
  const dependencies = optionalStringArray(
    value.dependencies,
    label,
    "dependencies"
  );
  const feature = optionalString(value.feature, label, "feature");
  const plugin = optionalString(value.plugin, label, "plugin");
  const preprocessDependencies = optionalStringArray(
    value.preprocessDependencies,
    label,
    "preprocessDependencies"
  );
  const renderInputsHash = optionalString(
    value.renderInputsHash,
    label,
    "renderInputsHash"
  );
  const sourceHash = optionalString(value.sourceHash, label, "sourceHash");
  const sourceOrigin = parseSourceOrigin(value.sourceOrigin, label);
  const sourcePointer = optionalString(
    value.sourcePointer,
    label,
    "sourcePointer"
  );
  const targetState = optionalString(value.targetState, label, "targetState");
  const transforms = optionalRecordArray(value.transforms, label, "transforms");
  const validation = optionalString(value.validation, label, "validation");
  const version = optionalString(value.version, label, "version");

  if (
    schemaVersion !== 3 &&
    (value.consumers !== undefined || value.owner !== undefined)
  ) {
    throw invalidLock(label, "legacy items cannot declare consumers or owner");
  }
  const consumers =
    schemaVersion === 3 ? parseConsumers(value.consumers, label) : [];
  const owner =
    schemaVersion === 3 ? parseOwner(value.owner, label) : undefined;
  validateOwnerConsumerRelationship(consumers, owner, label);

  return {
    consumers,
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(feature === undefined ? {} : { feature }),
    ...(fileModes === undefined ? {} : { fileModes }),
    files,
    ...(kind === undefined ? {} : { kind }),
    ...(name === undefined ? {} : { name }),
    ...(origin === undefined ? {} : { origin }),
    ...(outputHash === undefined ? {} : { outputHash }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(owner === undefined ? {} : { owner }),
    ...(plugin === undefined ? {} : { plugin }),
    ...(preprocessDependencies === undefined ? {} : { preprocessDependencies }),
    ...(renderInputsHash === undefined ? {} : { renderInputsHash }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    ...(sourceHash === undefined ? {} : { sourceHash }),
    ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
    ...(sourcePointer === undefined ? {} : { sourcePointer }),
    ...(targetState === undefined ? {} : { targetState }),
    ...(transforms === undefined ? {} : { transforms }),
    ...(validation === undefined ? {} : { validation }),
    ...(version === undefined ? {} : { version }),
  };
}

function parseSourceOrigin(
  value: unknown,
  label: string
): SourceOrigin | undefined {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw invalidLock(label, "sourceOrigin must be an object");
  }
  const path = requiredString(value.path, label, "sourceOrigin.path");
  const ref = optionalString(value.ref, label, "sourceOrigin.ref");
  const repo = optionalString(value.repo, label, "sourceOrigin.repo");
  return {
    path,
    ...(ref === undefined ? {} : { ref }),
    ...(repo === undefined ? {} : { repo }),
  };
}

function parseFileModes(
  value: unknown,
  files: readonly string[],
  schemaVersion: GeneratedLockSchemaVersion,
  label: string
): Readonly<Record<string, "0644" | "0755">> | undefined {
  if (value === undefined && schemaVersion === 1) return undefined;
  if (!isJsonRecord(value)) {
    throw invalidLock(label, "versioned items require a fileModes object");
  }
  const modes: Record<string, "0644" | "0755"> = {};
  for (const [file, mode] of Object.entries(value)) {
    if (mode !== "0644" && mode !== "0755") {
      throw invalidLock(label, `fileModes.${file} must be 0644 or 0755`);
    }
    modes[file] = mode;
  }
  if (files.some((file) => modes[file] === undefined)) {
    throw invalidLock(label, "fileModes must cover every tracked file");
  }
  return modes;
}

function parseConsumers(
  value: unknown,
  label: string
): readonly GeneratedLockConsumer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalidLock(label, "consumers must be an array");
  }
  return value.map((consumer, index) => {
    const consumerLabel = `${label}.consumers[${index}]`;
    if (!isJsonRecord(consumer)) {
      throw invalidLock(consumerLabel, "must be an object");
    }
    if (consumer.phase === "baseline") {
      if (consumer.target !== undefined) {
        throw invalidLock(
          consumerLabel,
          "baseline consumer cannot name a target"
        );
      }
      return {
        phase: "baseline",
        standardProfile: parseStandardProfile(
          consumer.standardProfile,
          consumerLabel
        ),
      };
    }
    if (consumer.phase === "delta") {
      if (consumer.standardProfile !== undefined) {
        throw invalidLock(
          consumerLabel,
          "delta consumer cannot name a standardProfile"
        );
      }
      return {
        phase: "delta",
        target: parseProviderTarget(consumer.target, consumerLabel),
      };
    }
    throw invalidLock(consumerLabel, "phase must be baseline or delta");
  });
}

function parseOwner(
  value: unknown,
  label: string
): GeneratedLockOwner | undefined {
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) throw invalidLock(label, "owner must be an object");
  const hasStandardProfile = value.standardProfile !== undefined;
  const hasTarget = value.target !== undefined;
  if (hasStandardProfile === hasTarget) {
    throw invalidLock(
      label,
      "owner must name exactly one target or standardProfile"
    );
  }
  return hasStandardProfile
    ? {
        standardProfile: parseStandardProfile(
          value.standardProfile,
          `${label}.owner`
        ),
      }
    : { target: parseProviderTarget(value.target, `${label}.owner`) };
}

function validateOwnerConsumerRelationship(
  consumers: readonly GeneratedLockConsumer[],
  owner: GeneratedLockOwner | undefined,
  label: string
): void {
  if (consumers.length === 0 && owner === undefined) return;
  if (consumers.length === 0 || owner === undefined) {
    throw invalidLock(label, "owner and consumers must be declared together");
  }
  const keys = consumers.map(identityKey);
  if (new Set(keys).size !== keys.length) {
    throw invalidLock(label, "consumers must have unique identities");
  }
  const baselineIndexes = consumers.flatMap((consumer, index) =>
    "standardProfile" in consumer ? [index] : []
  );
  if (baselineIndexes.length > 1) {
    throw invalidLock(
      label,
      "consumers may name at most one standards baseline"
    );
  }
  if (baselineIndexes.some((index) => index !== 0)) {
    throw invalidLock(
      label,
      "standards baseline consumer must precede provider deltas"
    );
  }
  if (consumers.length > 1 && baselineIndexes.length === 0) {
    throw invalidLock(label, "shared consumers require a standards baseline");
  }
  const ownerKey = identityKey(owner);
  if (!consumers.some((consumer) => identityKey(consumer) === ownerKey)) {
    throw invalidLock(label, "owner must match a logical consumer");
  }
}

function identityKey(
  value: GeneratedLockConsumer | GeneratedLockOwner
): string {
  return "standardProfile" in value
    ? `standard:${value.standardProfile}`
    : `target:${value.target}`;
}

function parseSchemaVersion(
  value: unknown,
  label: string
): GeneratedLockSchemaVersion {
  if (value === 1 || value === 2 || value === 3) return value;
  throw invalidLock(label, `unsupported schemaVersion ${String(value)}`);
}

function parseLockTarget(
  value: unknown,
  label: string
): TargetName | "workspace" {
  if (value === "workspace") return value;
  return parseProviderTarget(value, label);
}

function parseTargets(value: unknown, label: string): readonly TargetName[] {
  if (!Array.isArray(value)) {
    throw invalidLock(label, "selectedTargets must be an array");
  }
  return value.map((target, index) =>
    parseProviderTarget(target, `${label}.selectedTargets[${index}]`)
  );
}

function parseStandards(
  value: unknown,
  label: string
): readonly StandardProfileId[] {
  if (!Array.isArray(value)) {
    throw invalidLock(label, "schema v3 selectedStandards must be an array");
  }
  return value.map((profile, index) =>
    parseStandardProfile(profile, `${label}.selectedStandards[${index}]`)
  );
}

function parseProviderTarget(value: unknown, label: string): TargetName {
  if (typeof value !== "string" || !isTargetName(value)) {
    throw invalidLock(label, "target must be a provider target");
  }
  return value;
}

function parseStandardProfile(
  value: unknown,
  label: string
): StandardProfileId {
  if (
    typeof value !== "string" ||
    !(STANDARD_PROFILE_IDS as readonly string[]).includes(value)
  ) {
    throw invalidLock(label, "standardProfile must be a standard profile id");
  }
  return value as StandardProfileId;
}

function parseBuildMode(
  value: unknown,
  label: string
): CompileBuildMode | undefined {
  if (value === undefined) return undefined;
  if (value === "all" || value === "updated") return value;
  throw invalidLock(label, "buildMode must be all or updated");
}

function validateProvenance(
  value: JsonRecord,
  schemaVersion: GeneratedLockSchemaVersion,
  label: string
): void {
  if (value.provenanceHash === undefined) {
    if (schemaVersion === 3) {
      throw invalidLock(label, "schema v3 requires provenanceHash");
    }
    return;
  }
  if (!hasValidLockProvenance(value)) {
    throw invalidLock(label, "has invalid provenanceHash");
  }
}

function assertManagedRelativePath(value: string, label: string): void {
  const slashPath = value.replaceAll("\\", "/");
  const normalized = posix.normalize(slashPath);
  if (
    value !== slashPath ||
    value !== normalized ||
    posix.isAbsolute(slashPath) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith("\\\\") ||
    slashPath.split("/").includes("..") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw invalidLock(label, "must stay inside its output root");
  }
}

function assertOutputRoot(value: string, label: string): void {
  if (value === ".") return;
  assertManagedRelativePath(value.startsWith("./") ? value.slice(2) : value, label);
}

function optionalStringArray(
  value: unknown,
  label: string,
  field: string
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw invalidLock(label, `${field} must be an array`);
  }
  return value.map((entry, index) =>
    requiredString(entry, label, `${field}[${index}]`)
  );
}

function optionalRecordArray(
  value: unknown,
  label: string,
  field: string
): readonly Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => !isJsonRecord(entry))) {
    throw invalidLock(label, `${field} must be an array of objects`);
  }
  return value;
}

function requiredString(value: unknown, label: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidLock(label, `${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  value: unknown,
  label: string,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label, field);
}

function invalidLock(label: string, detail: string): Error {
  return new Error(`skillset: ${label} ${detail}`);
}
