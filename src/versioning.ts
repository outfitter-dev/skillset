import { readString } from "./config";
import type { BuildGraph, JsonRecord, SourcePlugin, SourceSkill } from "./types";

export const DEFAULT_VERSION = "0.1.0";

/**
 * The source-contract schema this compiler understands. `skillset.schema` marks
 * the shape of the authored source, distinct from `skillset.version` (content
 * version), generated `metadata.version` (skill artifact version), and the lock
 * `schemaVersion` (generated-output provenance schema).
 */
export const SUPPORTED_SOURCE_SCHEMA = 1;

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Validate an explicit `skillset.schema` source marker. The schema is the source
 * contract version, not the content version: it is an integer, defaults to the
 * current schema when absent, and rejects semver-style values so it cannot be
 * confused with `skillset.version`.
 */
export function validateSchemaField(metadata: JsonRecord, label: string): void {
  const value = metadata.schema;
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `skillset: expected ${label} to be a positive integer (currently ${SUPPORTED_SOURCE_SCHEMA}); ` +
        "skillset.schema is the source schema marker, not a version string"
    );
  }
  if (value !== SUPPORTED_SOURCE_SCHEMA) {
    throw new Error(
      `skillset: unsupported source schema ${value} in ${label}; ` +
        `this compiler supports skillset.schema ${SUPPORTED_SOURCE_SCHEMA}`
    );
  }
}

export function validateVersionField(record: JsonRecord, label: string): void {
  const value = record.version;
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`skillset: expected ${label} to be a semantic version string`);
  }
  if (!SEMVER_PATTERN.test(value.trim())) {
    throw new Error(`skillset: expected ${label} to be a semantic version`);
  }
}

export function rootVersion(graph: BuildGraph): string {
  return readString(graph.root.metadata, "version") ?? DEFAULT_VERSION;
}

export function pluginVersion(plugin: SourcePlugin): string {
  return readString(plugin.metadata, "version") ?? DEFAULT_VERSION;
}

export function skillVersion(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): string {
  return (
    readString(skill.frontmatter, "version") ??
    readString(skill.metadata, "version") ??
    (plugin === undefined ? undefined : pluginVersion(plugin)) ??
    rootVersion(graph)
  );
}

export function skillVersionLabel(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): string {
  return `${skill.id}@${skillVersion(graph, plugin, skill)}`;
}
