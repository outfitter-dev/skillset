import { readString } from "./config";
import type { BuildGraph, JsonRecord, SourcePlugin, SourceSkill } from "./types";

export const DEFAULT_VERSION = "0.1.0";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

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
