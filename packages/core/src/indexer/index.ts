import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { getProjectRoot, SKILL_PATHS } from "@skillset/shared";
import type { CacheSchema, ConfigSchema, Skill, Tool } from "@skillset/types";
import { updateCacheSync } from "../cache";
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

function walkForSkillFiles(root: string): string[] {
  const results: string[] = [];
  try {
    const items = readdirSync(root, { withFileTypes: true });
    for (const entry of items) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkForSkillFiles(full));
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

function readSkillMetadata(path: string, source: SkillSourceRoot): Skill {
  const content = readFileSync(path, "utf8");
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

function generateStructure(path: string): string {
  const parts = path.split(sep);
  parts.pop(); // remove SKILL.md
  const root = parts.join(sep);
  const stack: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  const lines: string[] = [];
  while (stack.length) {
    const popped = stack.pop();
    if (!popped) {
      break;
    }
    const { path: current, depth } = popped;
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry) {
        continue;
      }
      const prefix = `${"  ".repeat(depth)}${entry.isDirectory() ? "├──" : "├──"}`;
      lines.push(`${prefix} ${entry.name}`);
      if (entry.isDirectory()) {
        stack.push({ path: join(current, entry.name), depth: depth + 1 });
      }
    }
  }
  return lines.join("\n");
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

export function indexSkills(options: ScanOptions = {}): CacheSchema {
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const config = options.config ?? loadConfig(projectRoot);
  const toolOverride = options.tools ?? config.tools;
  const tools =
    toolOverride && toolOverride.length > 0
      ? toolOverride
      : (Object.keys(SKILL_PATHS) as Tool[]);

  const skills: Record<string, Skill> = {};
  const sources = buildSources(projectRoot, tools);
  const files = sources.flatMap((src) => walkForSkillFiles(src.root));

  for (const file of files) {
    const source = sources.find((src) => file.startsWith(src.root));
    if (!source) {
      continue;
    }
    const meta = readSkillMetadata(file, source);
    skills[meta.skillRef] = { ...meta, structure: generateStructure(file) };
  }

  const cache: CacheSchema = {
    version: 1,
    structureTTL: 3600,
    skills,
  };

  updateCacheSync("project", () => cache);
  return cache;
}
