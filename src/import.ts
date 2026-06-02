import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { readSkillsetMetadata, readSkillsetName, readString } from "./config";
import { resolveInside, validateSlug } from "./path";
import { parseMarkdown, parseYamlRecord } from "./yaml";

const DEFAULT_SOURCE_DIR = ".skillset";

export type ImportKind = "plugin" | "skill";

export interface ImportOptions {
  readonly kind: ImportKind;
  readonly name?: string;
  readonly rootPath: string;
  readonly sourceDir?: string;
  readonly sourcePath: string;
}

export interface ImportResult {
  readonly files: number;
  readonly name: string;
  readonly targetPath: string;
}

export async function importSource(options: ImportOptions): Promise<ImportResult> {
  const sourcePath = resolve(options.sourcePath);
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const name = await resolveImportName(sourcePath, options);
  const targetPath = resolveInside(
    options.rootPath,
    join(sourceDir, options.kind === "plugin" ? "plugins" : "skills", name)
  );

  if (await exists(targetPath)) {
    throw new Error(`skillset: import target already exists: ${targetPath}`);
  }

  await mkdir(targetPath, { recursive: true });
  const files = await copyImportSource(sourcePath, targetPath, options.kind);
  return { files, name, targetPath };
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
): Promise<number> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    if (kind !== "skill" || basename(sourcePath) !== "SKILL.md") {
      throw new Error("skillset: importing a file is only supported for skill SKILL.md files");
    }
    await writeFile(join(targetPath, "SKILL.md"), await readFile(sourcePath));
    return 1;
  }

  let files = 0;
  for (const file of await collectFiles(sourcePath)) {
    const relativePath = relativeImportPath(sourcePath, file, kind);
    await mkdir(dirname(join(targetPath, relativePath)), { recursive: true });
    await writeFile(join(targetPath, relativePath), await readFile(file));
    files += 1;
  }

  return files;
}

function relativeImportPath(sourceRoot: string, file: string, kind: ImportKind): string {
  const relativePath = file.slice(sourceRoot.length + 1);
  if (kind === "plugin" && relativePath === "skillset.yaml") {
    return "config.yaml";
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
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
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
