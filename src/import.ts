import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { readSkillsetMetadata, readSkillsetName, readString } from "./config";
import { compareStrings, resolveInside, validateSlug } from "./path";
import type { JsonRecord } from "./types";
import { parseMarkdown, parseYamlRecord } from "./yaml";

const DEFAULT_SOURCE_DIR = ".skillset";

export type ImportKind = "plugin" | "skill";

/**
 * Frontmatter keys Skillset understands as portable source. Present keys are
 * reported as inferred source fields; absent ones are classified further.
 */
const RECOGNIZED_SOURCE_KEYS: ReadonlySet<string> = new Set([
  "agents",
  "allowed_tools",
  "claude",
  "codex",
  "description",
  "id",
  "implicit_invocation",
  "name",
  "resources",
  "skillset",
  "summary",
  "title",
  "tool_intent",
  "tools",
  "version",
]);

/**
 * Frontmatter keys that are target-native (Claude/Codex) rather than Skillset
 * source. Import preserves them verbatim and reports them so the author can
 * decide whether to move them under a portable key or a `claude`/`codex` block.
 */
const KNOWN_TARGET_NATIVE_KEYS: ReadonlySet<string> = new Set([
  "allowed-tools",
  "argument-hint",
  "color",
  "disable-model-invocation",
  "disallowed-tools",
  "license",
  "metadata",
  "model",
  "user-facing-name",
]);

export interface ImportOptions {
  readonly kind: ImportKind;
  readonly name?: string;
  readonly rootPath: string;
  readonly sourceDir?: string;
  readonly sourcePath: string;
}

export interface ImportReport {
  readonly copiedFiles: readonly string[];
  readonly files: number;
  readonly inferredSourceFields: readonly string[];
  readonly kind: ImportKind;
  readonly name: string;
  readonly nextChecks: readonly string[];
  readonly preservedTargetNativeFields: readonly string[];
  readonly targetPath: string;
  readonly unsupportedFields: readonly string[];
  readonly warnings: readonly string[];
}

/** Back-compat alias; importSource now returns the richer {@link ImportReport}. */
export type ImportResult = ImportReport;

export async function importSource(options: ImportOptions): Promise<ImportReport> {
  const sourcePath = resolve(options.sourcePath);
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const name = await resolveImportName(sourcePath, options);
  const targetPath = resolveInside(
    options.rootPath,
    join(sourceDir, options.kind === "plugin" ? "plugins" : "skills", name)
  );

  if (await exists(targetPath)) {
    throw new Error(
      `skillset: import target already exists: ${targetPath}. ` +
        "Import never overwrites; remove the existing source or import under a different --name."
    );
  }

  await mkdir(targetPath, { recursive: true });
  const copiedFiles = await copyImportSource(sourcePath, targetPath, options.kind);
  const frontmatter = await readImportedFrontmatter(targetPath, options.kind);
  const classification = classifyFrontmatter(frontmatter);

  return {
    copiedFiles,
    files: copiedFiles.length,
    inferredSourceFields: classification.recognized,
    kind: options.kind,
    name,
    nextChecks: [
      "skillset lint",
      "skillset build",
      "skillset check",
    ],
    preservedTargetNativeFields: classification.targetNative,
    targetPath,
    unsupportedFields: classification.unsupported,
    warnings: importWarnings(classification),
  };
}

interface FrontmatterClassification {
  readonly recognized: readonly string[];
  readonly targetNative: readonly string[];
  readonly unsupported: readonly string[];
}

function classifyFrontmatter(frontmatter: JsonRecord): FrontmatterClassification {
  const recognized: string[] = [];
  const targetNative: string[] = [];
  const unsupported: string[] = [];

  for (const key of Object.keys(frontmatter).sort(compareStrings)) {
    if (RECOGNIZED_SOURCE_KEYS.has(key)) recognized.push(key);
    else if (KNOWN_TARGET_NATIVE_KEYS.has(key)) targetNative.push(key);
    else unsupported.push(key);
  }

  return { recognized, targetNative, unsupported };
}

function importWarnings(classification: FrontmatterClassification): readonly string[] {
  const warnings: string[] = [];
  if (classification.targetNative.length > 0) {
    warnings.push(
      `preserved target-native fields verbatim: ${classification.targetNative.join(", ")}. ` +
        "Consider moving them to a portable source key (e.g. tool_intent, implicit_invocation) or a claude/codex block."
    );
  }
  if (classification.unsupported.length > 0) {
    warnings.push(
      `kept unrecognized frontmatter keys verbatim: ${classification.unsupported.join(", ")}. ` +
        "Verify they lower correctly with skillset build, or remove them."
    );
  }
  return warnings;
}

async function readImportedFrontmatter(targetPath: string, kind: ImportKind): Promise<JsonRecord> {
  if (kind === "skill") {
    const skillFile = join(targetPath, "SKILL.md");
    if (!(await exists(skillFile))) return {};
    return parseMarkdown(await readFile(skillFile, "utf8"), skillFile).frontmatter;
  }

  const configPath = join(targetPath, "skillset.yaml");
  if (!(await exists(configPath))) return {};
  return parseYamlRecord(await readFile(configPath, "utf8"), configPath);
}

async function resolveImportName(sourcePath: string, options: ImportOptions): Promise<string> {
  if (options.name !== undefined) {
    return validateSlug(options.name, "import name");
  }

  if (options.kind === "skill") {
    const skillPath = await resolveSkillFile(sourcePath);
    const parts = parseMarkdown(await readFile(skillPath, "utf8"), skillPath);
    const metadata = readSkillsetMetadata(parts.frontmatter, skillPath);
    return validateSlug(
      readSkillsetName(metadata, readString(parts.frontmatter, "name") ?? basename(dirname(skillPath)), skillPath),
      `skillset.name in ${skillPath}`
    );
  }

  const configPath = await resolvePluginConfig(sourcePath);
  if (configPath === undefined) {
    return validateSlug(basename(sourcePath), "plugin directory");
  }

  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  const metadata = readSkillsetMetadata(config, configPath);
  return validateSlug(readSkillsetName(metadata, basename(sourcePath), configPath), `skillset.name in ${configPath}`);
}

async function copyImportSource(
  sourcePath: string,
  targetPath: string,
  kind: ImportKind
): Promise<readonly string[]> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    if (kind !== "skill" || basename(sourcePath) !== "SKILL.md") {
      throw new Error("skillset: importing a file is only supported for skill SKILL.md files");
    }
    await writeFile(join(targetPath, "SKILL.md"), await readFile(sourcePath));
    return ["SKILL.md"];
  }

  const copied: string[] = [];
  for (const file of await collectFiles(sourcePath)) {
    const relativePath = relativeImportPath(sourcePath, file, kind);
    await mkdir(dirname(join(targetPath, relativePath)), { recursive: true });
    await writeFile(join(targetPath, relativePath), await readFile(file));
    copied.push(relativePath);
  }

  return copied.sort(compareStrings);
}

function relativeImportPath(sourceRoot: string, file: string, kind: ImportKind): string {
  const relativePath = file.slice(sourceRoot.length + 1);
  if (kind === "plugin" && (relativePath === "skillset.yaml" || relativePath === "config.yaml")) {
    return "skillset.yaml";
  }
  return relativePath;
}

async function resolveSkillFile(sourcePath: string): Promise<string> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) return sourcePath;
  return join(sourcePath, "SKILL.md");
}

async function resolvePluginConfig(sourcePath: string): Promise<string | undefined> {
  for (const file of ["config.yaml", "skillset.yaml"]) {
    const candidate = join(sourcePath, file);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push(path);
    }
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
