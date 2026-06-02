import { relative } from "node:path";

import { loadBuildGraph } from "./resolver";
import type { BuildGraph, LintIssue, LintResult, SkillsetOptions, SourceSkill } from "./types";

interface DynamicPattern {
  readonly code: string;
  readonly label: string;
  readonly pattern: RegExp;
}

const CLAUDE_DYNAMIC_PATTERNS: readonly DynamicPattern[] = [
  {
    code: "claude-arguments",
    label: "$ARGUMENTS",
    pattern: /\$ARGUMENTS(?:\b|\[[^\]]+\]|\.[A-Za-z_][A-Za-z0-9_-]*)/,
  },
  {
    code: "claude-positional-argument",
    label: "$0/$1 positional arguments",
    pattern: /(^|[^\w$])\$[0-9]+\b/,
  },
  {
    code: "claude-env-substitution",
    label: "${CLAUDE_*} substitution",
    pattern: /\$\{CLAUDE_[A-Z0-9_]+\}/,
  },
  {
    code: "claude-shell-placeholder",
    label: "Claude shell-command placeholder",
    pattern: /(^|\n)\s*!`[^`\n]+`/,
  },
];

export async function lintSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<LintResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const result = lintBuildGraph(graph);

  if (result.issues.length > 0) {
    throw new Error(formatLintError(result.issues));
  }

  return result;
}

export function lintBuildGraph(graph: BuildGraph): LintResult {
  const issues: LintIssue[] = [];
  let checkedSkills = 0;

  for (const plugin of graph.plugins) {
    for (const skill of plugin.skills) {
      checkedSkills += 1;
      issues.push(...lintSkill(graph, skill));
    }
  }

  return { checkedSkills, issues };
}

function lintSkill(graph: BuildGraph, skill: SourceSkill): readonly LintIssue[] {
  if (!skill.targets.codex.enabled) return [];

  const matches = CLAUDE_DYNAMIC_PATTERNS.filter(({ pattern }) => pattern.test(skill.body));
  if (matches.length === 0) return [];

  const path = relative(graph.rootPath, skill.sourcePath);
  const labels = matches.map((match) => match.label).join(", ");
  return [
    {
      code: "codex-claude-dynamic-context",
      path,
      message:
        `${path} uses Claude dynamic context (${labels}) while Codex output is enabled. ` +
        "Set codex: false for this skill or move the dynamic behavior into a target-safe script/fallback before emitting Codex.",
    },
  ];
}

function formatLintError(issues: readonly LintIssue[]): string {
  return `skillset: lint failed\n${issues
    .map((issue) => `${issue.path}: ${issue.code}: ${issue.message}`)
    .join("\n")}`;
}
