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

function resolveOutputOptions(
  config: ConfigSchema,
  result?: ResolveResult,
  entry?: SkillEntry
) {
  const includeLayout =
    result?.include_layout ??
    (typeof entry === "object" && entry !== null && "include_layout" in entry
      ? (entry.include_layout ?? config.output.include_layout)
      : config.output.include_layout);
  const includeFull =
    result?.include_full ??
    (typeof entry === "object" && entry !== null && entry.include_full === true);
  const maxLines = includeFull
    ? Number.POSITIVE_INFINITY
    : config.output.max_lines;
  return { includeLayout, maxLines };
}

async function formatSkillBlock(
  skill: Skill,
  config: ConfigSchema,
  heading: string,
  label: string,
  result?: ResolveResult,
  entry?: SkillEntry
): Promise<string> {
  const { includeLayout, maxLines } = resolveOutputOptions(
    config,
    result,
    entry
  );
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
  const content = await loadContent(skill, maxLines);
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

async function formatSkill(
  result: ResolveResult,
  config: ConfigSchema
): Promise<string> {
  const skill = result.skill as Skill;
  const entry = findSkillEntry(config, result.invocation.alias);
  return await formatSkillBlock(
    skill,
    config,
    `### ${result.invocation.raw}`,
    result.invocation.alias,
    result,
    entry
  );
}

async function formatSet(
  result: ResolveResult,
  config: ConfigSchema,
  cache: CacheSchema
): Promise<string> {
  const set = result.set as SkillSet;
  const lines = formatSetIntro(result, set, cache);
  const resolved = resolveSetSkillsForFormat(result, set, cache);
  const skillBlocks = await formatSetSkillBlocks(resolved, config);
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

interface SetSkillEntry {
  ref: string;
  skill: Skill;
}

function resolveSetSkillsForFormat(
  result: ResolveResult,
  set: SkillSet,
  cache: CacheSchema
): SetSkillEntry[] {
  const resolvedByRef = new Map<string, Skill>();
  if (result.setSkills && result.setSkills.length > 0) {
    for (const skill of result.setSkills) {
      resolvedByRef.set(skill.skillRef, skill);
      resolvedByRef.set(normalizeTokenRef(skill.skillRef), skill);
    }
  }

  const resolved: SetSkillEntry[] = [];
  for (const ref of set.skillRefs) {
    const normalized = normalizeTokenRef(ref);
    const skill =
      resolvedByRef.get(ref) ??
      resolvedByRef.get(normalized) ??
      cache.skills[ref] ??
      cache.skills[normalized];
    if (skill) {
      resolved.push({ ref, skill });
    }
  }
  return resolved;
}

async function formatSetSkillBlocks(
  resolved: SetSkillEntry[],
  config: ConfigSchema
): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of resolved) {
    const alias = entry.ref;
    const entryConfig = findSkillEntry(config, alias);
    lines.push(
      "",
      await formatSkillBlock(
        entry.skill,
        config,
        `#### ${entry.skill.skillRef}`,
        entry.skill.skillRef,
        undefined,
        entryConfig
      )
    );
  }
  return lines;
}

async function loadContent(
  skill: Skill,
  maxLines: number
): Promise<{ block: string; truncated: boolean }> {
  try {
    const content = await Bun.file(skill.path).text();
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
  if (result.missingSkillRefs && result.missingSkillRefs.length > 0) {
    const severity = config.rules.missing_set_members ?? "warn";
    if (severity === "ignore") {
      return null;
    }
    const label =
      severity === "error"
        ? "Missing set members (error)"
        : "Missing set members";
    return `- **${label}:** ${result.invocation.raw} → ${result.missingSkillRefs.join(", ")}`;
  }

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

export async function formatOutcome(
  results: ResolveResult[],
  config: ConfigSchema,
  cache?: CacheSchema
): Promise<InjectOutcome> {
  const blocks: string[] = [header()];
  if (cache) {
    const directorySection = skillsDirectorySection(cache, config);
    if (directorySection) {
      blocks.push("", directorySection, "", "---");
    }
  }
  for (const r of results) {
    if (r.skill) {
      blocks.push("", await formatSkill(r, config));
      continue;
    }
    if (r.set && cache) {
      blocks.push("", await formatSet(r, config, cache));
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
