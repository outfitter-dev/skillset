import type { JsonRecord, JsonValue } from "../packages/core/src/types";
import { isJsonRecord } from "../packages/core/src/yaml";

export interface SplitRootConfigResult {
  readonly changed: boolean;
  readonly sourceManifest?: JsonRecord;
  readonly workspaceConfig: JsonRecord;
}

export function splitRootConfigRecord(record: JsonRecord): SplitRootConfigResult {
  const sourceManifest = sourceManifestFrom(record);
  const changed = sourceManifest !== undefined || hasLegacyOutputs(record);
  return {
    changed,
    ...(sourceManifest === undefined ? {} : { sourceManifest }),
    workspaceConfig: workspaceConfigFrom(record),
  };
}

function hasLegacyOutputs(record: JsonRecord): boolean {
  return isJsonRecord(record.skillset) && record.skillset.outputs !== undefined;
}

function sourceManifestFrom(record: JsonRecord): JsonRecord | undefined {
  const manifest: Record<string, JsonRecord[keyof JsonRecord]> = {};
  if (isJsonRecord(record.skillset)) {
    const skillsetMetadata = withoutLegacyOutputs(record.skillset);
    if (Object.keys(skillsetMetadata).length > 0) manifest.skillset = skillsetMetadata;
  }
  if (record.supports !== undefined) manifest.supports = record.supports;
  return Object.keys(manifest).length === 0 ? undefined : manifest;
}

function workspaceConfigFrom(record: JsonRecord): JsonRecord {
  const config: Record<string, JsonRecord[keyof JsonRecord]> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "skillset" || key === "supports") continue;
    config[key] = value;
  }
  if (isJsonRecord(record.skillset)) applyLegacyOutputs(config, record.skillset.outputs);
  return config;
}

function withoutLegacyOutputs(record: JsonRecord): JsonRecord {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "outputs" || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

function applyLegacyOutputs(config: Record<string, JsonRecord[keyof JsonRecord]>, rawOutputs: JsonValue | undefined): void {
  if (rawOutputs === undefined) return;
  if (!isJsonRecord(rawOutputs)) throw new Error("skillset: expected legacy skillset.outputs to be an object");

  const pluginOutputs = readLegacyOutputGroup(rawOutputs, "plugins");
  const skillOutputs = readLegacyOutputGroup(rawOutputs, "skills");
  for (const [target, path] of Object.entries(pluginOutputs)) {
    setTargetOutputPath(config, target, "plugins", path);
  }
  for (const [target, path] of Object.entries(skillOutputs)) {
    setTargetOutputPath(config, target, "skills", path);
  }
}

function readLegacyOutputGroup(record: JsonRecord, key: "plugins" | "skills"): Record<string, string> {
  const raw = record[key];
  if (raw === undefined) return {};
  if (!isJsonRecord(raw)) throw new Error(`skillset: expected legacy skillset.outputs.${key} to be an object`);
  const result: Record<string, string> = {};
  for (const target of ["claude", "codex"] as const) {
    const value = raw[target];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`skillset: expected legacy skillset.outputs.${key}.${target} to be a non-empty string`);
    }
    result[target] = value.trim();
  }
  return result;
}

function setTargetOutputPath(
  config: Record<string, JsonRecord[keyof JsonRecord]>,
  target: string,
  surface: "plugins" | "skills",
  path: string
): void {
  const targetConfig = ensureTargetConfig(config, target);
  const existing = targetConfig[surface];
  targetConfig[surface] = outputSettingWithPath(existing, `${target}.${surface}`, path);
}

function ensureTargetConfig(config: Record<string, JsonRecord[keyof JsonRecord]>, target: string): Record<string, JsonValue> {
  const existing = config[target];
  if (existing === undefined) {
    const targetConfig: Record<string, JsonValue> = {};
    config[target] = targetConfig;
    return targetConfig;
  }
  if (!isJsonRecord(existing)) {
    throw new Error(`skillset: cannot migrate legacy outputs into ${target}; split .skillset/config.yaml by hand`);
  }
  const targetConfig: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (value !== undefined) targetConfig[key] = value;
  }
  config[target] = targetConfig;
  return targetConfig;
}

function outputSettingWithPath(existing: JsonValue | undefined, label: string, path: string): JsonValue {
  if (existing === undefined || existing === true) return { path };
  if (existing === false) return { enabled: false, path };
  if (Array.isArray(existing)) return { include: existing, path };
  if (!isJsonRecord(existing)) {
    throw new Error(`skillset: cannot migrate legacy outputs into ${label}; split .skillset/config.yaml by hand`);
  }

  const currentPath = existing.path;
  if (currentPath !== undefined && currentPath !== path) {
    throw new Error(`skillset: legacy skillset.outputs conflicts with ${label}.path; split .skillset/config.yaml by hand`);
  }
  return { ...existing, path };
}
