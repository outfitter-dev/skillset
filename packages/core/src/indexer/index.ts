import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { CacheSchema, Skill } from "@skillset/types";
import { updateCacheSync } from "../cache";

const SKILL_FILENAME = "SKILL.md";

interface ScanOptions {
  projectRoot?: string;
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

function skillRefFromPath(path: string, projectRoot: string): string {
  const home = homedir();
  if (path.startsWith(join(projectRoot, ".claude", "skills"))) {
    const rel = relative(join(projectRoot, ".claude", "skills"), path).split(
      sep
    )[0];
    return `project:${rel}`;
  }
  if (path.startsWith(join(home, ".claude", "skills"))) {
    const rel = relative(join(home, ".claude", "skills"), path).split(sep)[0];
    return `user:${rel}`;
  }
  const pluginsRoot = join(home, ".claude", "plugins");
  if (path.startsWith(pluginsRoot)) {
    const rel = relative(pluginsRoot, path).split(sep);
    const namespace = rel[0];
    const alias = rel.slice(2)[0] ?? rel[0];
    return `plugin:${namespace}/${alias}`;
  }
  // fallback
  return `skill:${path.split(sep).slice(-2, -1)[0]}`;
}

function readSkillMetadata(path: string, projectRoot: string): Skill {
  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/);
  const firstHeading = lines.find((l) => l.startsWith("#"));
  const fallbackName = path.split(sep).slice(-2, -1)[0] ?? "unknown";
  const name = firstHeading
    ? firstHeading.replace(/^#+\s*/, "").trim()
    : fallbackName;
  const description = lines
    .find((l) => l.trim().length > 0 && !l.startsWith("#"))
    ?.trim();
  const skillRef = skillRefFromPath(path, projectRoot);
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
    if (!popped) break;
    const { path: current, depth } = popped;
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry) continue;
      const prefix = `${"  ".repeat(depth)}${entry.isDirectory() ? "├──" : "├──"}`;
      lines.push(`${prefix} ${entry.name}`);
      if (entry.isDirectory()) {
        stack.push({ path: join(current, entry.name), depth: depth + 1 });
      }
    }
  }
  return lines.join("\n");
}

export function indexSkills(options: ScanOptions = {}): CacheSchema {
  const projectRoot = options.projectRoot ?? process.cwd();
  const skills: Record<string, Skill> = {};
  const sources = [
    join(projectRoot, ".claude", "skills"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".claude"),
  ];
  const files = sources.flatMap((src) => walkForSkillFiles(src));

  for (const file of files) {
    const meta = readSkillMetadata(file, projectRoot);
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
