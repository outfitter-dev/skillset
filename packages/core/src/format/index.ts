import { readFileSync } from "node:fs";
import { sep } from "node:path";
import type {
  CacheSchema,
  ConfigSchema,
  InjectOutcome,
  ResolveResult,
  Skill,
  SkillSet,
} from "@skillset/types";
import { normalizeTokenRef } from "../normalize";
import { buildDirectoryTreeLines } from "../tree";

function header() {
  return "## skillset: Resolved Skills\n\nThe user invoked skills explicitly via `$alias`. These are loaded below. Ignore the literal `$...` tokens in the prompt.\n\n---";
}

function formatSkillBlock(
  skill: Skill,
  config: ConfigSchema,
  heading: string,
  label: string
): string {
  const lines: string[] = [];
  lines.push(heading);
  lines.push("");
  lines.push(`- **Path:** ${skill.path}`);
  lines.push(`- **Name:** ${skill.name}`);
  if (skill.description) lines.push(`- **Description:** ${skill.description}`);
  if (config.showStructure && skill.structure) {
    lines.push("- **Structure:**");
    lines.push("```");
    lines.push(skill.structure.trim());
    lines.push("```");
  }
  const content = loadContent(skill, config.maxLines);
  lines.push(`\n\`\`\`markdown skill:${label}`);
  lines.push(content.block);
  lines.push("```\n");
  if (content.truncated) {
    const start = config.maxLines + 1;
    lines.push(
      `**Truncated:** Lines 1-${config.maxLines} of ${skill.lineCount ?? "?"}`
    );
    lines.push(
      `Continue: sed -n '${start},${skill.lineCount ?? ""}p' ${skill.path}`
    );
  }
  return lines.join("\n");
}

function formatSkill(result: ResolveResult, config: ConfigSchema): string {
  const skill = result.skill as Skill;
  return formatSkillBlock(
    skill,
    config,
    `### ${result.invocation.raw}`,
    result.invocation.alias
  );
}

function formatSet(
  result: ResolveResult,
  config: ConfigSchema,
  cache: CacheSchema
): string {
  const set = result.set as SkillSet;
  const lines: string[] = [];
  lines.push(`### ${result.invocation.raw}`);
  lines.push("");
  lines.push(`- **Set:** ${set.setRef}`);
  lines.push(`- **Name:** ${set.name}`);
  if (set.description) lines.push(`- **Description:** ${set.description}`);
  if (set.skillRefs.length) {
    lines.push("- **Skills:**");
    for (const ref of set.skillRefs) {
      const normalized = normalizeTokenRef(ref);
      const found = cache.skills[ref] ?? cache.skills[normalized];
      lines.push(`  - ${ref}${found ? "" : " (missing)"}`);
    }
  }

  const resolved: Skill[] = [];
  for (const ref of set.skillRefs) {
    const normalized = normalizeTokenRef(ref);
    const skill = cache.skills[ref] ?? cache.skills[normalized];
    if (skill) resolved.push(skill);
  }
  for (const skill of resolved) {
    lines.push(
      "",
      formatSkillBlock(
        skill,
        config,
        `#### ${skill.skillRef}`,
        skill.skillRef
      )
    );
  }
  return lines.join("\n");
}

function loadContent(
  skill: Skill,
  maxLines: number
): { block: string; truncated: boolean } {
  try {
    const content = readFileSync(skill.path, "utf8");
    const lines = content.split(/\r?\n/);
    const truncated = lines.length > maxLines;
    const slice = truncated ? lines.slice(0, maxLines) : lines;
    const withoutFrontmatter = stripFrontmatter(slice.join("\n"));
    return { block: withoutFrontmatter, truncated };
  } catch {
    return { block: "(failed to read skill content)", truncated: false };
  }
}

export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  return text.slice(end + 4).trimStart();
}

function warningsSection(results: ResolveResult[]): string | null {
  const warnings: string[] = [];
  for (const r of results) {
    if (r.skill) continue;
    if (r.reason === "ambiguous" && r.candidates?.length) {
      const opts = r.candidates.map((c) => c.skillRef).join(", ");
      warnings.push(`- **Ambiguous:** ${r.invocation.raw} → ${opts}`);
    } else if (r.reason === "unmatched") {
      warnings.push(`- **Unmatched:** ${r.invocation.raw}`);
    } else if (r.reason) {
      warnings.push(`- **${r.reason}:** ${r.invocation.raw}`);
    }
  }
  if (!warnings.length) return null;
  return ["---", "", "## skillset: Warnings", "", ...warnings].join("\n");
}

export function formatOutcome(
  results: ResolveResult[],
  config: ConfigSchema,
  cache?: CacheSchema
): InjectOutcome {
  const blocks: string[] = [header()];
  if (cache) {
    const directorySection = skillsDirectorySection(cache, config);
    if (directorySection) {
      blocks.push("", directorySection, "", "---");
    }
  }
  for (const r of results) {
    if (r.skill) {
      blocks.push("", formatSkill(r, config));
      continue;
    }
    if (r.set && cache) {
      blocks.push("", formatSet(r, config, cache));
    }
  }
  const warn = warningsSection(results);
  if (warn) blocks.push("", warn);
  return {
    resolved: results,
    warnings: warn ? [warn] : [],
    context: blocks.join("\n"),
  };
}

function skillsDirectorySection(
  cache: CacheSchema,
  config: ConfigSchema
): string | null {
  const roots = collectSkillsRoots(cache);
  if (roots.length === 0) {
    return null;
  }
  const lines: string[] = ["## skillset: Skills Directory"];
  for (const root of roots) {
    const tree = buildDirectoryTreeLines(root, {
      maxDepth: 6,
      maxLines: config.maxLines,
    });
    if (tree.length === 0) {
      continue;
    }
    lines.push("", `- **Root:** ${root}`, "", "```text");
    const capped =
      tree.length > config.maxLines
        ? [...tree.slice(0, config.maxLines), "..."]
        : tree;
    lines.push(...capped, "```");
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

function collectSkillsRoots(cache: CacheSchema): string[] {
  const roots = new Set<string>();
  for (const skill of Object.values(cache.skills)) {
    const root = findSkillsRoot(skill.path);
    if (root) roots.add(root);
  }
  return Array.from(roots).sort();
}

function findSkillsRoot(path: string): string | null {
  const marker = `${sep}.claude${sep}skills${sep}`;
  const idx = path.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  return path.slice(0, idx + marker.length - 1);
}
