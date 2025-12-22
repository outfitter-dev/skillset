import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigSchema, Mode } from "@skillset/types";

const DEFAULT_CONFIG: ConfigSchema = {
  version: 1,
  mode: "warn",
  showStructure: false,
  maxLines: 500,
  mappings: {},
  namespaceAliases: {},
};

export const CONFIG_PATHS = {
  project: join(process.cwd(), ".claude", "wskill", "config.json"),
  projectLocal: join(process.cwd(), ".claude", "wskill", "config.local.json"),
  user: join(homedir(), ".claude", "wskill", "config.json"),
};

function readConfig(path: string): Partial<ConfigSchema> | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    return JSON.parse(content) as ConfigSchema;
  } catch (err) {
    console.warn(`wskill: failed to read config ${path}:`, err);
    return null;
  }
}

function deepMerge<T extends object>(base: T, overrides: Partial<T>): T {
  const result = { ...(base as object) } as T;
  for (const [key, value] of Object.entries(overrides)) {
    const k = key as keyof T;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[k] = deepMerge(
        (result[k] as object | undefined) ?? {},
        value as Partial<T>
      ) as T[keyof T];
    } else if (value !== undefined) {
      result[k] = value as T[keyof T];
    }
  }
  return result;
}

export function loadConfig(): ConfigSchema {
  const parts: Partial<ConfigSchema>[] = [
    DEFAULT_CONFIG,
    readConfig(CONFIG_PATHS.project) ?? {},
    readConfig(CONFIG_PATHS.projectLocal) ?? {},
    readConfig(CONFIG_PATHS.user) ?? {},
  ];

  const merged = parts.reduce<ConfigSchema>(
    (acc, curr) => deepMerge(acc, curr),
    DEFAULT_CONFIG
  );
  return merged;
}

export function ensureConfigFiles() {
  for (const path of [
    CONFIG_PATHS.project,
    CONFIG_PATHS.projectLocal,
    CONFIG_PATHS.user,
  ]) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
  }
}

export function modeLabel(mode: Mode) {
  return mode === "strict" ? "strict" : "warn";
}

/**
 * Write config to a specific file
 */
export function writeConfig(
  scope: "project" | "local" | "user",
  config: Partial<ConfigSchema>
): void {
  const path =
    scope === "local"
      ? CONFIG_PATHS.projectLocal
      : scope === "user"
        ? CONFIG_PATHS.user
        : CONFIG_PATHS.project;

  const dir = path.split("/").slice(0, -1).join("/");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Read config from a specific scope
 */
export function readConfigByScope(
  scope: "project" | "local" | "user"
): Partial<ConfigSchema> {
  const path =
    scope === "local"
      ? CONFIG_PATHS.projectLocal
      : scope === "user"
        ? CONFIG_PATHS.user
        : CONFIG_PATHS.project;

  return readConfig(path) ?? {};
}

/**
 * Get path for a specific config scope
 */
export function getConfigPath(scope: "project" | "local" | "user"): string {
  return scope === "local"
    ? CONFIG_PATHS.projectLocal
    : scope === "user"
      ? CONFIG_PATHS.user
      : CONFIG_PATHS.project;
}

/**
 * Get a config value using dot notation
 */
export function getConfigValue(
  config: ConfigSchema,
  key: string
): unknown | undefined {
  const parts = key.split(".");
  let current: unknown = config;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a config value using dot notation
 */
export function setConfigValue(
  config: Partial<ConfigSchema>,
  key: string,
  value: unknown
): Partial<ConfigSchema> {
  const parts = key.split(".");
  const result = JSON.parse(JSON.stringify(config)) as Partial<ConfigSchema>;

  let current: Record<string, unknown> = result as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;

    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    current[lastPart] = value;
  }

  return result;
}
