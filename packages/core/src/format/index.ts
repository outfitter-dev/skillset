import { readFileSync } from "node:fs";
import type {
  ConfigSchema,
  InjectOutcome,
  ResolveResult,
  Skill,
} from "@skillset/types";

function header() {
  return "## skillset: Resolved Skills\n\nThe user invoked skills explicitly via `$alias`. These are loaded below. Ignore the literal `$...` tokens in the prompt.\n\n---";
}

function formatSkill(result: ResolveResult, config: ConfigSchema): string {
  const skill = result.skill as Skill;
  const lines: string[] = [];
  lines.push(`### ${result.invocation.raw}`);
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
  lines.push(`\n\`\`\`markdown skill:${result.invocation.alias}`);
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
  config: ConfigSchema
): InjectOutcome {
  const blocks: string[] = [header()];
  for (const r of results) {
    if (!r.skill) continue;
    blocks.push("", formatSkill(r, config));
  }
  const warn = warningsSection(results);
  if (warn) blocks.push("", warn);
  return {
    resolved: results,
    warnings: warn ? [warn] : [],
    context: blocks.join("\n"),
  };
}
