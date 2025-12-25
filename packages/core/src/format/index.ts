import { readFileSync } from "node:fs";
import { sep } from "node:path";
import type {
  CacheSchema,
  ConfigSchema,
  InjectOutcome,
  ResolveResult,
  Skill,
  SkillEntry,
  SkillSet,
} from "@skillset/types";
import { normalizeTokenRef, normalizeTokenSegment } from "../normalize";
import { buildDirectoryTreeLines } from "../tree";

const LINE_BREAK_REGEX = /\r?\n/;

function header() {
  return "## skillset: Resolved Skills\n\nThe user invoked skills explicitly via `$alias`. These are loaded below. Ignore the literal `$...` tokens in the prompt.\n\n---";
}

function findSkillEntry(
  config: ConfigSchema,
  alias: string
): SkillEntry | undefined {
  if (config.skills[alias]) {
    return config.skills[alias];
  }
  const normalized = normalizeTokenSegment(alias);
  if (config.skills[normalized]) {
    return config.skills[normalized];
  }
  const lower = alias.toLowerCase();
  for (const [key, entry] of Object.entries(config.skills)) {
    if (key.toLowerCase() === lower) {
      return entry;
    }
    if (normalizeTokenRef(key) === normalized) {
      return entry;
    }
  }
  return undefined;
}

function resolveOutputOptions(config: ConfigSchema, entry?: SkillEntry) {
  const includeLayout =
    typeof entry === "object" && entry !== null && "include_layout" in entry
      ? (entry.include_layout ?? config.output.include_layout)
      : config.output.include_layout;
  const includeFull =
    typeof entry === "object" && entry !== null && entry.include_full === true;
  const maxLines = includeFull
    ? Number.POSITIVE_INFINITY
    : config.output.max_lines;
  return { includeLayout, maxLines };
}

function formatSkillBlock(
  skill: Skill,
  config: ConfigSchema,
  heading: string,
  label: string,
  entry?: SkillEntry
): string {
  const { includeLayout, maxLines } = resolveOutputOptions(config, entry);
  const lines: string[] = [];
  lines.push(heading);
  lines.push("");
  lines.push(`- **Path:** ${skill.path}`);
  lines.push(`- **Name:** ${skill.name}`);
  if (skill.description) {
    lines.push(`- **Description:** ${skill.description}`);
  }
  if (includeLayout && skill.structure) {
    lines.push("- **Structure:**");
    lines.push("```");
    lines.push(skill.structure.trim());
    lines.push("```");
  }
  const content = loadContent(skill, maxLines);
  lines.push(`\n\`\`\`markdown skill:${label}`);
  lines.push(content.block);
  lines.push("```\n");
  if (content.truncated) {
    const start = maxLines + 1;
    lines.push(
      `**Truncated:** Lines 1-${maxLines} of ${skill.lineCount ?? "?"}`
    );
    lines.push(
      `Continue: sed -n '${start},${skill.lineCount ?? ""}p' ${skill.path}`
    );
  }
  return lines.join("\n");
}

function formatSkill(result: ResolveResult, config: ConfigSchema): string {
  const skill = result.skill as Skill;
  const entry = findSkillEntry(config, result.invocation.alias);
  return formatSkillBlock(
    skill,
    config,
    `### ${result.invocation.raw}`,
    result.invocation.alias,
    entry
  );
}

function formatSet(
  result: ResolveResult,
  config: ConfigSchema,
  cache: CacheSchema
): string {
  const set = result.set as SkillSet;
  const lines = formatSetIntro(result, set, cache);
  const resolved = resolveSetSkillsForFormat(result, set, cache);
  const skillBlocks = formatSetSkillBlocks(resolved, set, config);
  lines.push(...skillBlocks);
  return lines.join("\n");
}

function formatSetIntro(
  result: ResolveResult,
  set: SkillSet,
  cache: CacheSchema
): string[] {
  const lines: string[] = [];
  lines.push(`### ${result.invocation.raw}`);
  lines.push("");
  lines.push(`- **Set:** ${set.setRef}`);
  lines.push(`- **Name:** ${set.name}`);
  if (set.description) {
    lines.push(`- **Description:** ${set.description}`);
  }
  if (set.skillRefs.length) {
    lines.push("- **Skills:**");
    lines.push(...formatSetSkillRefs(set, cache));
  }
  return lines;
}

function formatSetSkillRefs(set: SkillSet, cache: CacheSchema): string[] {
  const lines: string[] = [];
  for (const ref of set.skillRefs) {
    const normalized = normalizeTokenRef(ref);
    const found = cache.skills[ref] ?? cache.skills[normalized];
    lines.push(`  - ${ref}${found ? "" : " (missing)"}`);
  }
  return lines;
}

function resolveSetSkillsForFormat(
  result: ResolveResult,
  set: SkillSet,
  cache: CacheSchema
): Skill[] {
  if (result.setSkills && result.setSkills.length > 0) {
    return result.setSkills;
  }

  const resolved: Skill[] = [];
  for (const ref of set.skillRefs) {
    const normalized = normalizeTokenRef(ref);
    const skill = cache.skills[ref] ?? cache.skills[normalized];
    if (skill) {
      resolved.push(skill);
    }
  }
  return resolved;
}

function formatSetSkillBlocks(
  resolved: Skill[],
  set: SkillSet,
  config: ConfigSchema
): string[] {
  const lines: string[] = [];
  for (let i = 0; i < resolved.length; i += 1) {
    const skill = resolved[i];
    if (!skill) {
      continue;
    }
    const alias = set.skillRefs[i] ?? skill.skillRef;
    const entry = findSkillEntry(config, alias);
    lines.push(
      "",
      formatSkillBlock(
        skill,
        config,
        `#### ${skill.skillRef}`,
        skill.skillRef,
        entry
      )
    );
  }
  return lines;
}

function loadContent(
  skill: Skill,
  maxLines: number
): { block: string; truncated: boolean } {
  try {
    const content = readFileSync(skill.path, "utf8");
    const lines = content.split(LINE_BREAK_REGEX);
    const truncated = Number.isFinite(maxLines) && lines.length > maxLines;
    const slice = truncated ? lines.slice(0, maxLines) : lines;
    const withoutFrontmatter = stripFrontmatter(slice.join("\n"));
    return { block: withoutFrontmatter, truncated };
  } catch {
    return { block: "(failed to read skill content)", truncated: false };
  }
}

export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) {
    return text;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return text;
  }
  return text.slice(end + 4).trimStart();
}

function warningsSection(
  results: ResolveResult[],
  config: ConfigSchema
): string | null {
  const warnings: string[] = [];
  for (const r of results) {
    if (r.skill) {
      continue;
    }
    const warning = buildWarning(r, config);
    if (warning) {
      warnings.push(warning);
    }
  }
  if (!warnings.length) {
    return null;
  }
  return ["---", "", "## skillset: Warnings", "", ...warnings].join("\n");
}

function buildWarning(
  result: ResolveResult,
  config: ConfigSchema
): string | null {
  if (result.reason === "ambiguous" && result.candidates?.length) {
    if (config.rules.ambiguous === "ignore") {
      return null;
    }
    const opts = result.candidates.map((c) => c.skillRef).join(", ");
    return `- **Ambiguous:** ${result.invocation.raw} → ${opts}`;
  }

  if (result.reason === "unmatched") {
    if (config.rules.unresolved === "ignore") {
      return null;
    }
    return `- **Unmatched:** ${result.invocation.raw}`;
  }

  if (result.reason) {
    return `- **${result.reason}:** ${result.invocation.raw}`;
  }

  return null;
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
  const warn = warningsSection(results, config);
  if (warn) {
    blocks.push("", warn);
  }
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
      maxLines: config.output.max_lines,
    });
    if (tree.length === 0) {
      continue;
    }
    lines.push("", `- **Root:** ${root}`, "", "```text");
    const capped =
      tree.length > config.output.max_lines
        ? [...tree.slice(0, config.output.max_lines), "..."]
        : tree;
    lines.push(...capped, "```");
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

function collectSkillsRoots(cache: CacheSchema): string[] {
  const roots = new Set<string>();
  for (const skill of Object.values(cache.skills)) {
    const root = findSkillsRoot(skill.path);
    if (root) {
      roots.add(root);
    }
  }
  return Array.from(roots).sort();
}

function findSkillsRoot(path: string): string | null {
  const markers = [
    `${sep}.claude${sep}skills${sep}`,
    `${sep}.codex${sep}skills${sep}`,
    `${sep}.github${sep}skills${sep}`,
    `${sep}.cursor${sep}skills${sep}`,
    `${sep}.amp${sep}skills${sep}`,
    `${sep}.goose${sep}skills${sep}`,
  ];
  for (const marker of markers) {
    const idx = path.indexOf(marker);
    if (idx !== -1) {
      return path.slice(0, idx + marker.length - 1);
    }
  }
  return null;
}
