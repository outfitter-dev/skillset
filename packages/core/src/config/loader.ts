import { existsSync, readFileSync } from "node:fs";
import type {
  ConfigSchema,
  GeneratedSettingsSchema,
  ProjectSettings,
} from "@skillset/types";
import { load as loadYaml } from "js-yaml";
import { hashValue } from "./hash";
import {
  deleteValueAtPath,
  getValueAtPath,
  joinKeyPath,
  setValueAtPath,
} from "./utils";

const DEFAULT_GENERATED: GeneratedSettingsSchema = {
  _yaml_hashes: {},
  projects: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadYamlConfig(path: string): Partial<ConfigSchema> {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf8");
    const parsed = loadYaml(content);
    if (!isRecord(parsed)) return {};
    return parsed as Partial<ConfigSchema>;
  } catch (err) {
    console.warn(`skillset: failed to read config ${path}:`, err);
    return {};
  }
}

export function loadGeneratedConfig(path: string): GeneratedSettingsSchema {
  if (!existsSync(path)) return { ...DEFAULT_GENERATED };
  try {
    const content = readFileSync(path, "utf8");
    const parsed = JSON.parse(content) as Partial<GeneratedSettingsSchema>;
    const generated: GeneratedSettingsSchema = {
      _yaml_hashes: parsed._yaml_hashes ?? {},
      projects: parsed.projects ?? {},
    };
    if (parsed.skills) generated.skills = parsed.skills;
    if (parsed.output) generated.output = parsed.output;
    if (parsed.rules) generated.rules = parsed.rules;
    if (parsed.project_id_strategy) {
      generated.project_id_strategy = parsed.project_id_strategy;
    }
    return generated;
  } catch (err) {
    console.warn(`skillset: failed to read generated config ${path}:`, err);
    return { ...DEFAULT_GENERATED };
  }
}

export function applyGeneratedOverrides(
  baseConfig: ConfigSchema,
  yamlConfig: Partial<ConfigSchema>,
  generated: GeneratedSettingsSchema | ProjectSettings
): ConfigSchema {
  if (
    !generated._yaml_hashes ||
    Object.keys(generated._yaml_hashes).length === 0
  ) {
    return baseConfig;
  }

  let result = baseConfig;

  const walk = (value: unknown, pathSegments: string[]) => {
    const fullPath = joinKeyPath(pathSegments);
    const storedHash = generated._yaml_hashes[fullPath];
    if (storedHash) {
      const yamlValue = getValueAtPath(yamlConfig, fullPath);
      const currentHash = hashValue(yamlValue);
      if (currentHash === storedHash) {
        result = setValueAtPath(result, fullPath, value) as ConfigSchema;
      }
      return;
    }

    if (isRecord(value)) {
      for (const [key, next] of Object.entries(value)) {
        walk(next, [...pathSegments, key]);
      }
    }
  };

  for (const [key, value] of Object.entries(generated)) {
    if (
      key === "_yaml_hashes" ||
      key === "projects" ||
      key === "project_id_strategy"
    ) {
      continue;
    }
    walk(value, [key]);
  }

  return result;
}

export function cleanupStaleHashes<
  T extends { _yaml_hashes?: Record<string, string> },
>(target: T, yamlConfig: Partial<ConfigSchema>): T {
  const hashes = target._yaml_hashes ?? {};
  let next = {
    ...target,
    _yaml_hashes: { ...hashes },
  } as T & { _yaml_hashes: Record<string, string> };

  for (const keyPath of Object.keys(next._yaml_hashes)) {
    const yamlValue = getValueAtPath(yamlConfig, keyPath);
    if (yamlValue === undefined) {
      delete next._yaml_hashes[keyPath];
      next = deleteValueAtPath(
        next as Record<string, unknown>,
        keyPath
      ) as typeof next;
    }
  }

  return next as T;
}
