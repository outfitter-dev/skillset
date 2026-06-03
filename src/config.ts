import type {
  JsonRecord,
  JsonValue,
  OutputConfig,
  OutputSelection,
  ResolvedTarget,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

const TARGET_NAMES: readonly TargetName[] = ["claude", "codex"];
const CONFIG_TOP_LEVEL_KEYS = new Set(["agents", "claude", "codex", "skillset"]);
const SOURCE_ONLY_KEYS = new Set([
  "agents",
  "allowed_tools",
  "claude",
  "codex",
  "implicit_invocation",
  "resources",
  "schema",
  "skillset",
  "summary",
  "targets",
  "title",
  "tool_intent",
  "tools",
  "version",
]);

export function defaultTargets(): Readonly<Record<TargetName, ResolvedTarget>> {
  return {
    claude: { enabled: true, options: {} },
    codex: { enabled: true, options: {} },
  };
}

export function readSkillsetMetadata(record: JsonRecord, label: string): JsonRecord {
  rejectTargetsKey(record, label);
  const raw = record.skillset;
  if (raw === undefined) return {};
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.skillset to be an object`);
  }
  return raw;
}

/**
 * Resolve a source identity. Machine identity derives from the directory name by
 * default; an explicit `skillset.name` (or its `skillset.id` compatibility alias)
 * overrides it. `topLevelName` is the standard top-level identity key — the
 * Agent Skills `name` for skills — which is preferred over the `skillset` aliases
 * but must agree with them. Conflicting aliases fail loudly rather than picking
 * one silently.
 */
export function readSkillsetName(
  metadata: JsonRecord,
  fallback: string,
  label: string,
  topLevelName?: string
): string {
  const name = readString(metadata, "name");
  const id = readString(metadata, "id");
  if (name !== undefined && id !== undefined && name !== id) {
    throw new Error(`skillset: ${label} has conflicting skillset.name and skillset.id`);
  }
  const skillsetName = name ?? id;
  if (topLevelName !== undefined && skillsetName !== undefined && topLevelName !== skillsetName) {
    const aliasKey = name !== undefined ? "skillset.name" : "skillset.id";
    throw new Error(
      `skillset: ${label} has conflicting top-level name ${JSON.stringify(topLevelName)} and ${aliasKey} ${JSON.stringify(skillsetName)}`
    );
  }
  return topLevelName ?? skillsetName ?? fallback;
}

export function readOutputConfig(
  record: JsonRecord,
  metadata: JsonRecord,
  options: { readonly distDir?: string } = {}
): OutputConfig {
  const outputs = readRecord(metadata, "outputs") ?? {};
  const pluginOutputs = readRecord(outputs, "plugins") ?? {};
  const skillOutputs = readRecord(outputs, "skills") ?? {};
  const claudePlugins = readTargetOutputSetting(record.claude, "plugins", "claude.plugins");
  const claudeSkills = readTargetOutputSetting(record.claude, "skills", "claude.skills");
  const codexPlugins = readTargetOutputSetting(record.codex, "plugins", "codex.plugins");
  const codexSkills = readTargetOutputSetting(record.codex, "skills", "codex.skills");

  return {
    plugins: {
      claude:
        claudePlugins.path ??
        readString(pluginOutputs, "claude") ??
        (options.distDir === undefined ? "plugins-claude" : `${options.distDir}/claude`),
      codex:
        codexPlugins.path ??
        readString(pluginOutputs, "codex") ??
        (options.distDir === undefined ? "plugins-codex" : `${options.distDir}/codex`),
    },
    skills: {
      claude: claudeSkills.path ?? readString(skillOutputs, "claude") ?? ".claude/skills",
      codex: codexSkills.path ?? readString(skillOutputs, "codex") ?? ".agents/skills",
    },
    targetOutputs: {
      claude: {
        plugins: claudePlugins.selection,
        skills: claudeSkills.selection,
      },
      codex: {
        plugins: codexPlugins.selection,
        skills: codexSkills.selection,
      },
    },
  };
}

export function validateConfigDocument(record: JsonRecord, label: string): void {
  rejectTargetsKey(record, label);
  for (const key of Object.keys(record)) {
    if (!CONFIG_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`skillset: unsupported top-level key ${key} in ${label}`);
    }
  }
}

export function resolveTargets(
  parent: Readonly<Record<TargetName, ResolvedTarget>>,
  record: JsonRecord,
  label: string
): Readonly<Record<TargetName, ResolvedTarget>> {
  rejectTargetsKey(record, label);
  return {
    claude: resolveTarget(parent.claude, record.claude, `${label}.claude`),
    codex: resolveTarget(parent.codex, record.codex, `${label}.codex`),
  };
}

export function resolveTarget(
  parent: ResolvedTarget,
  raw: JsonValue | undefined,
  label: string
): ResolvedTarget {
  if (raw === undefined) return parent;
  if (raw === true) return { enabled: true, options: parent.options };
  if (raw === false) return { enabled: false, options: parent.options };

  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be true, false, or an object`);
  }

  const { enabled, ...rest } = raw;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error(`skillset: expected ${label}.enabled to be a boolean`);
  }

  return {
    enabled: enabled === false ? false : true,
    options: mergeRecords(parent.options, rest),
  };
}

export function stripSourceFrontmatter(frontmatter: JsonRecord): JsonRecord {
  const stripped: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || SOURCE_ONLY_KEYS.has(key)) continue;
    stripped[key] = value;
  }
  return stripped;
}

export function mergeRecords(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value;
  }

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    if (isJsonRecord(current) && isJsonRecord(value)) {
      merged[key] = mergeRecords(current, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readStringArray(record: JsonRecord, key: string): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return readStringArrayValue(value, key);
}

export function readRecord(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${key} to be an object`);
  }
  return value;
}

export function targetNames(): readonly TargetName[] {
  return TARGET_NAMES;
}

export function isOutputSelected(selection: OutputSelection, name: string): boolean {
  if (selection === true) return true;
  if (selection === false) return false;
  return selection.includes(name);
}

function rejectTargetsKey(record: JsonRecord, label: string): void {
  if (record.targets !== undefined) {
    throw new Error(`skillset: ${label} uses unsupported targets key; use top-level claude/codex`);
  }
}

interface ParsedTargetOutputSetting {
  readonly path?: string;
  readonly selection: OutputSelection;
}

function readTargetOutputSetting(
  rawTarget: JsonValue | undefined,
  key: "plugins" | "skills",
  label: string
): ParsedTargetOutputSetting {
  if (rawTarget === undefined || rawTarget === true) return { selection: true };
  if (rawTarget === false) return { selection: false };
  if (!isJsonRecord(rawTarget)) {
    throw new Error(`skillset: expected ${label.split(".")[0]} to be true, false, or an object`);
  }

  if (rawTarget.enabled === false) return { selection: false };
  const rawOutput = rawTarget[key];
  if (rawOutput === undefined) return { selection: true };
  return readOutputSetting(rawOutput, label);
}

function readOutputSetting(raw: JsonValue, label: string): ParsedTargetOutputSetting {
  if (raw === true || raw === false) return { selection: raw };
  if (Array.isArray(raw)) return { selection: readStringArrayValue(raw, label) };
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be true, false, a string array, or an object`);
  }

  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new Error(`skillset: expected ${label}.enabled to be a boolean`);
  }

  const include = raw.include === undefined ? undefined : readStringArrayValue(raw.include, `${label}.include`);
  const path = readString(raw, "path");
  return {
    ...(path === undefined ? {} : { path }),
    selection: raw.enabled === false ? false : include ?? true,
  };
}

function readStringArrayValue(value: JsonValue, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`skillset: expected ${label} to be a string array`);
  }
  return value.map((item) => String(item));
}
