import type {
  ConfigSchema,
  GeneratedSettingsSchema,
  ProjectSettings,
} from "@skillset/types";
import { YAML } from "bun";
import type { ZodIssue } from "zod";
import { hashValue } from "./hash";
import {
  ConfigSchema as ConfigZodSchema,
  GeneratedSettingsSchema as GeneratedSettingsZodSchema,
} from "./schema";
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

const CONFIG_PARTIAL_SCHEMA = ConfigZodSchema.deepPartial();
const GENERATED_PARTIAL_SCHEMA = GeneratedSettingsZodSchema.deepPartial();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectTopLevelKeys(issues: ZodIssue[]): string[] {
  const keys = new Set<string>();
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string") {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function logConfigWarnings(path: string, warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }
  const hint = "Run 'skillset doctor config' for details.";
  for (const warning of warnings) {
    console.warn(`skillset: ${warning} (${path}). ${hint}`);
  }
}

function sanitizeBySchema<T>(
  schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      error?: { issues: ZodIssue[] };
    };
  },
  input: unknown,
  label: string,
  path: string
): T {
  if (!isRecord(input)) {
    logConfigWarnings(path, [`Invalid ${label} (expected object); using defaults`]);
    return {} as T;
  }

  const initial = schema.safeParse(input);
  if (initial.success) {
    return input as T;
  }

  const warnings: string[] = [];
  const invalidKeys = collectTopLevelKeys(initial.error?.issues ?? []);
  if (invalidKeys.length > 0) {
    const cleaned = { ...input };
    for (const key of invalidKeys) {
      delete cleaned[key];
    }
    warnings.push(
      `Ignored invalid ${label} section(s): ${invalidKeys.join(", ")}`
    );
    const retry = schema.safeParse(cleaned);
    if (retry.success) {
      logConfigWarnings(path, warnings);
      return cleaned as T;
    }
  }

  warnings.push(`Invalid ${label}; using defaults`);
  logConfigWarnings(path, warnings);
  return {} as T;
}

export async function loadYamlConfig(
  path: string
): Promise<Partial<ConfigSchema>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  try {
    const content = await file.text();
    const parsed = YAML.parse(content);
    return sanitizeBySchema<Partial<ConfigSchema>>(
      CONFIG_PARTIAL_SCHEMA,
      parsed,
      "config",
      path
    );
  } catch (err) {
    console.warn(`skillset: failed to read config ${path}:`, err);
    return {};
  }
}

export async function loadGeneratedConfig(
  path: string
): Promise<GeneratedSettingsSchema> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ...DEFAULT_GENERATED };
  }
  try {
    const parsed = (await file.json()) as Partial<GeneratedSettingsSchema>;
    const sanitized = sanitizeBySchema<Partial<GeneratedSettingsSchema>>(
      GENERATED_PARTIAL_SCHEMA,
      parsed,
      "generated config",
      path
    );
    const generated: GeneratedSettingsSchema = {
      _yaml_hashes: sanitized._yaml_hashes ?? {},
      projects: sanitized.projects ?? {},
    };
    if (sanitized.skills) {
      generated.skills = sanitized.skills;
    }
    if (sanitized.output) {
      generated.output = sanitized.output;
    }
    if (sanitized.rules) {
      generated.rules = sanitized.rules;
    }
    if (sanitized.project_id_strategy) {
      generated.project_id_strategy = sanitized.project_id_strategy;
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
