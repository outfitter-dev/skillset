import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { isOutputSelected } from "./config";
import { validateHookDefinition } from "./hooks";
import { emitGraphWarnings, loadBuildGraph } from "./resolver";
import {
  readAllowedTools,
  readClaudeNativeToolRules,
  readCodexToolMetadata,
} from "./skill-policy";
import type {
  BuildGraph,
  JsonValue,
  LintIssue,
  LintResult,
  SkillsetOptions,
  SourcePlugin,
  SourceSkill,
  TargetName,
} from "./types";

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
  emitGraphWarnings(graph);
  const result = lintBuildGraph(graph);
  const hookIssues = await lintPluginHooks(graph);
  const issues = [...result.issues, ...hookIssues];

  if (issues.length > 0) {
    throw new Error(formatLintError(issues));
  }

  return { checkedSkills: result.checkedSkills, issues };
}

async function lintPluginHooks(graph: BuildGraph): Promise<readonly LintIssue[]> {
  const issues: LintIssue[] = [];

  for (const plugin of graph.plugins) {
    if (shouldLintPluginHook(graph, plugin, "claude")) {
      issues.push(...(await lintHookFile(graph, plugin, join("hooks", "hooks.json"), "claude")));
    }
    if (shouldLintPluginHook(graph, plugin, "codex")) {
      // Codex hook source: legacy root hooks.json (compat) precedes the canonical
      // hooks/hooks.json, mirroring renderCodexHookFile.
      const codexHookPath = (await fileExists(join(plugin.path, "hooks.json")))
        ? "hooks.json"
        : join("hooks", "hooks.json");
      issues.push(...(await lintHookFile(graph, plugin, codexHookPath, "codex")));
    }
  }

  return issues;
}

function shouldLintPluginHook(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): boolean {
  return (
    plugin.targets[target].enabled &&
    isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, plugin.id)
  );
}

async function lintHookFile(
  graph: BuildGraph,
  plugin: SourcePlugin,
  relativeHookPath: string,
  target: TargetName
): Promise<readonly LintIssue[]> {
  const hookPath = join(plugin.path, relativeHookPath);
  if (!(await fileExists(hookPath))) return [];

  const path = relative(graph.rootPath, hookPath);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(hookPath, "utf8")) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const targetLabel = target === "claude" ? "Claude" : "Codex";
    return [
      {
        code: "hook-invalid-json",
        path,
        message: `${targetLabel} hook file ${path} is not valid JSON: ${message}`,
      },
    ];
  }

  try {
    validateHookDefinition(parsed, { sourcePath: path, target });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ code: "hook-target-incompatible", path, message }];
  }

  return [];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
