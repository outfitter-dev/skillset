import { relative } from "node:path";

import { loadBuildGraph } from "./resolver";
import {
  readAllowedTools,
  readClaudeNativeToolRules,
  readCodexToolMetadata,
} from "./skill-policy";
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

  for (const skill of graph.standaloneSkills) {
    checkedSkills += 1;
    issues.push(...lintSkill(graph, skill));
  }

  return { checkedSkills, issues };
}

function lintSkill(graph: BuildGraph, skill: SourceSkill): readonly LintIssue[] {
  const issues: LintIssue[] = [];
  issues.push(...lintToolEscapes(graph, skill));

  if (!skill.targets.codex.enabled) return issues;

  issues.push(...lintCodexAllowedTools(graph, skill));

  const matches = CLAUDE_DYNAMIC_PATTERNS.filter(({ pattern }) => pattern.test(skill.body));
  if (matches.length === 0) return issues;

  const path = relative(graph.rootPath, skill.sourcePath);
  const labels = matches.map((match) => match.label).join(", ");
  issues.push({
    code: "codex-claude-dynamic-context",
    path,
    message:
      `${path} uses Claude dynamic context (${labels}) while Codex output is enabled. ` +
      "Set codex: false for this skill or move the dynamic behavior into a target-safe script/fallback before emitting Codex.",
  });

  return issues;
}

function lintToolEscapes(graph: BuildGraph, skill: SourceSkill): readonly LintIssue[] {
  const path = relative(graph.rootPath, skill.sourcePath);

  try {
    if (skill.targets.claude.enabled) {
      readClaudeNativeToolRules(skill.frontmatter, skill.targets.claude.options, path);
    }
    if (skill.targets.codex.enabled) {
      readCodexToolMetadata(skill.frontmatter, skill.targets.codex.options, path);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        code: "skill-tools-invalid",
        path,
        message,
      },
    ];
  }

  return [];
}

function lintCodexAllowedTools(graph: BuildGraph, skill: SourceSkill): readonly LintIssue[] {
  const path = relative(graph.rootPath, skill.sourcePath);
  const allowedTools = readAllowedTools(skill.frontmatter, "codex", path);
  if (allowedTools === undefined || allowedTools === false) return [];

  return [
    {
      code: "codex-allowed-tools-unsupported",
      path,
      message:
        `${path} sets allowed_tools for Codex, but Codex skills do not currently have a skill-local allowed-tools equivalent. ` +
        "Set allowed_tools.codex: false or move Codex tool dependencies into agents/openai.yaml.",
    },
  ];
}

function formatLintError(issues: readonly LintIssue[]): string {
  return `skillset: lint failed\n${issues
    .map((issue) => `${issue.path}: ${issue.code}: ${issue.message}`)
    .join("\n")}`;
}
