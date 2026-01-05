/**
 * Config migration utilities for transforming legacy camelCase config to new kebab-case format
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConfigSchema, RuleSeverity, SkillEntry } from "@skillset/types";
import { YAML } from "bun";

/**
 * Legacy config format (pre-v1, camelCase)
 */
interface LegacyConfig {
  mode?: "warn" | "strict";
  mappings?: Record<string, SkillEntry>;
  showStructure?: boolean;
  maxLines?: number;
  namespaceAliases?: Record<string, string>;
  // Other fields we don't need to migrate
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Detect if a config object uses the old camelCase format
 */
export function detectLegacyConfig(config: unknown): boolean {
  if (!isRecord(config)) {
    return false;
  }

  // Check for presence of any camelCase keys that existed in old format
  const legacyKeys = [
    "mode",
    "mappings",
    "showStructure",
    "maxLines",
    "namespaceAliases",
  ];

  return legacyKeys.some((key) => key in config);
}

/**
 * Transform legacy config to new schema format
 */
export function migrateLegacyConfig(config: unknown): ConfigSchema {
  if (!isRecord(config)) {
    throw new Error("Invalid config: expected object");
  }

  const legacy = config as LegacyConfig;

  // Map old mode to new rules.unresolved
  const unresolved: RuleSeverity = legacy.mode === "strict" ? "error" : "warn";

  // Build new config structure
  const migrated: ConfigSchema = {
    version: 1,
    rules: {
      unresolved,
      ambiguous: "warn", // Default, didn't exist in old format
    },
    output: {
      max_lines: legacy.maxLines ?? 500,
      include_layout: legacy.showStructure ?? false,
    },
    skills: legacy.mappings ?? {},
  };

  // Copy over any other fields that might be valid in new format
  // (resolution, ignore_scopes, tools, sets)
  const validNewKeys = [
    "resolution",
    "ignore_scopes",
    "tools",
    "sets",
  ] as const;

  for (const key of validNewKeys) {
    if (key in config) {
      // @ts-expect-error - dynamically adding optional fields
      migrated[key] = config[key];
    }
  }

  return migrated;
}

/**
 * Migrate a config file from legacy to new format, creating backup
 */
export async function migrateConfigFile(
  path: string
): Promise<{ migrated: boolean; backupPath?: string }> {
  const file = Bun.file(path);

  // Check if file exists
  if (!(await file.exists())) {
    return { migrated: false };
  }

  // Read and parse the file
  let content: string;
  let parsed: unknown;

  try {
    content = await file.text();
    parsed = YAML.parse(content);
  } catch (err) {
    console.warn(`skillset: failed to read config ${path}:`, err);
    return { migrated: false };
  }

  // Check if migration is needed
  if (!detectLegacyConfig(parsed)) {
    return { migrated: false };
  }

  // Create backup with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.${timestamp}.bak`;

  try {
    // Write backup
    await Bun.write(backupPath, content);

    // Migrate config
    const migrated = migrateLegacyConfig(parsed);

    // Write migrated config with schema comment
    const header =
      "# yaml-language-server: $schema=https://unpkg.com/@skillset/types/schemas/config.schema.json\n";
    const yaml = YAML.stringify(migrated, null, 2) ?? "";

    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, `${header}${yaml}`);

    return { migrated: true, backupPath };
  } catch (err) {
    console.error(`skillset: failed to migrate config ${path}:`, err);
    return { migrated: false };
  }
}
