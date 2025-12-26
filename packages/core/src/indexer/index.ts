import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { getProjectRoot, SKILL_PATHS } from "@skillset/shared";
import type { CacheSchema, ConfigSchema, Skill, Tool } from "@skillset/types";
import { updateCache } from "../cache";
import { loadConfig } from "../config";

const SKILL_FILENAME = "SKILL.md";
const LINE_BREAK_REGEX = /\r?\n/;
const HEADING_PREFIX_REGEX = /^#+\s*/;

interface ScanOptions {
  projectRoot?: string;
  tools?: Tool[];
  config?: ConfigSchema;
}

interface SkillSourceRoot {
  root: string;
  scope: "project" | "user" | "plugin";
  tool?: Tool;
}

async function walkForSkillFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const items = await readdir(root, { withFileTypes: true });
    for (const entry of items) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walkForSkillFiles(full)));
      } else if (entry.isFile() && entry.name === SKILL_FILENAME) {
        results.push(full);
      }
    }
  } catch {
    // ignore missing paths
  }
  return results;
}

function toolPrefix(tool?: Tool): string {
  if (!tool || tool === "claude") {
    return "";
  }
  return `${tool}/`;
}

function getSkillPathSegments(root: string, path: string): string[] {
  const rel = relative(root, path);
  const parts = rel.split(sep).filter(Boolean);
  if (parts.at(-1) === SKILL_FILENAME) {
    parts.pop();
  }
  return parts;
}

function skillRefFromPath(path: string, source: SkillSourceRoot): string {
  const parts = getSkillPathSegments(source.root, path);
  if (source.scope === "plugin") {
    const namespace = parts[0] ?? "unknown";
    const alias = parts[2] ?? parts[0] ?? "unknown";
    return `plugin:${namespace}/${alias}`;
  }

  const alias = parts[0] ?? path.split(sep).at(-2) ?? "unknown";
  return `${source.scope}:${toolPrefix(source.tool)}${alias}`;
}

async function readSkillMetadata(
  path: string,
  source: SkillSourceRoot
): Promise<Skill> {
  const content = await Bun.file(path).text();
  const lines = content.split(LINE_BREAK_REGEX);
  const firstHeading = lines.find((l) => l.startsWith("#"));
  const fallbackName = path.split(sep).at(-2) ?? "unknown";
  const name = firstHeading
    ? firstHeading.replace(HEADING_PREFIX_REGEX, "").trim()
    : fallbackName;
  const description = lines
    .find((l) => l.trim().length > 0 && !l.startsWith("#"))
    ?.trim();
  const skillRef = skillRefFromPath(path, source);
  return {
    skillRef,
    path,
    name,
    description,
    structure: undefined,
    lineCount: lines.length,
    cachedAt: new Date().toISOString(),
  };
}

async function generateStructure(path: string): Promise<string> {
  const root = getStructureRoot(path);
  const stack: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  const lines: string[] = [];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    await appendStructureEntries(lines, stack, current);
  }
  return lines.join("\n");
}

function getStructureRoot(path: string): string {
  const parts = path.split(sep);
  parts.pop(); // remove SKILL.md
  return parts.join(sep);
}

async function readStructureEntries(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  } catch {
    return null;
  }
}

async function appendStructureEntries(
  lines: string[],
  stack: Array<{ path: string; depth: number }>,
  current: { path: string; depth: number }
): Promise<void> {
  const entries = await readStructureEntries(current.path);
  if (!entries) {
    return;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }
    const prefix = `${"  ".repeat(current.depth)}${entry.isDirectory() ? "├──" : "├──"}`;
    lines.push(`${prefix} ${entry.name}`);
    if (entry.isDirectory()) {
      stack.push({
        path: join(current.path, entry.name),
        depth: current.depth + 1,
      });
    }
  }
}

function buildSources(projectRoot: string, tools: Tool[]): SkillSourceRoot[] {
  const sources: SkillSourceRoot[] = [];
  for (const tool of tools) {
    const projectRootPath = SKILL_PATHS[tool].project(projectRoot);
    const userRootPath = SKILL_PATHS[tool].user();
    sources.push({ root: projectRootPath, scope: "project", tool });
    sources.push({ root: userRootPath, scope: "user", tool });
  }
  sources.push({
    root: join(homedir(), ".claude", "plugins"),
    scope: "plugin",
  });
  return sources;
}

export async function indexSkills(
  options: ScanOptions = {}
): Promise<CacheSchema> {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const config = options.config ?? (await loadConfig(projectRoot));
  const toolOverride = options.tools ?? config.tools;
  const tools =
    toolOverride && toolOverride.length > 0
      ? toolOverride
      : (Object.keys(SKILL_PATHS) as Tool[]);

  const skills: Record<string, Skill> = {};
  const sources = buildSources(projectRoot, tools);
  const filesNested = await Promise.all(
    sources.map((src) => walkForSkillFiles(src.root))
  );
  const files = filesNested.flat();

  for (const file of files) {
    const source = sources.find((src) => file.startsWith(src.root));
    if (!source) {
      continue;
    }
    const meta = await readSkillMetadata(file, source);
    skills[meta.skillRef] = {
      ...meta,
      structure: await generateStructure(file),
    };
  }

  const cache: CacheSchema = {
    version: 1,
    structureTTL: 3600,
    skills,
  };

  await updateCache("project", () => cache);
  return cache;
}
