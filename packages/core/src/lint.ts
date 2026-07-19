import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { type LintDiagnostic, type LintSubject, runLintRules } from "@skillset/lint";

import { isOutputSelected } from "./config";
import { validateHookDefinition } from "./hooks";
import {
  findPluginRootScriptLinks,
  findUndeclaredResourceLinks,
  isScriptTargetPath,
} from "./resources";
import { loadBuildGraph } from "./resolver";
import {
  readAllowedTools,
  readClaudeNativeToolRules,
  readToolsPolicyMetadata,
} from "./skill-policy";
import { targetDescriptor, targetNames } from "./targets";
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

type SkillFeatureId = "plugin-skills" | "standalone-skills";

interface DynamicPattern {
  readonly code: string;
  readonly label: string;
  readonly pattern: RegExp;
}

const CLAUDE_DYNAMIC_PATTERNS: readonly DynamicPattern[] = [
  {
    code: "claude-arguments",
    label: "$ARGUMENTS",
    pattern: /\$ARGUMENTS(?:\[[^\]]+\]|\.[A-Za-z_][A-Za-z0-9_-]*|\b)/,
  },
  {
    code: "claude-positional-argument",
    label: "$0/$1 positional arguments",
    pattern: /(^|[^\w$])\$[01]\b(?!\.\d)/,
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
const FENCE_PATTERN = /^\s*(?:```|~~~)/u;
const INLINE_CODE_PATTERN = /`[^`]*`/gu;
const SKILLSET_PROMPT_ARGUMENT_PATTERN = /\{\{\s*\$ARGUMENTS(?:\b|\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/gu;

export async function lintSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<LintResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const result = await inspectBuildGraph(graph);

  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(formatLintError(errors));
  }

  return result;
}

/**
 * Collect lint issues without throwing. Used by `skillset status` to aggregate
 * findings alongside other health checks.
 */
export async function inspectSkillset(
  graph: BuildGraph
): Promise<LintResult> {
  return inspectBuildGraph(graph);
}

async function inspectBuildGraph(graph: BuildGraph): Promise<LintResult> {
  const result = lintBuildGraph(graph);
  const hookIssues = await lintPluginHooks(graph);
  const resourceIssues = await lintResourceUsage(graph);
  const ruleIssues = await lintSkillRules(graph);
  return {
    checkedSkills: result.checkedSkills,
    issues: [...result.issues, ...hookIssues, ...resourceIssues, ...ruleIssues],
  };
}

/**
 * Run the registered `@skillset/lint` rules over every source skill
 * (plugin-bound and standalone) and map their diagnostics into LintIssues.
 */
async function lintSkillRules(graph: BuildGraph): Promise<readonly LintIssue[]> {
  const subjects: Array<{ readonly featureId: SkillFeatureId; readonly subject: LintSubject }> = [];
  for (const skill of graph.plugins.flatMap((plugin) => plugin.skills)) {
    subjects.push({
      featureId: "plugin-skills",
      subject: await lintSubjectForSkill(graph, skill),
    });
  }
  for (const skill of graph.standaloneSkills) {
    subjects.push({
      featureId: "standalone-skills",
      subject: await lintSubjectForSkill(graph, skill),
    });
  }

  return subjects.flatMap(({ featureId, subject }) =>
    runLintRules([subject]).map((diagnostic) => lintIssueFromDiagnostic(diagnostic, featureId))
  );
}

async function lintSubjectForSkill(graph: BuildGraph, skill: SourceSkill): Promise<LintSubject> {
  return {
    body: skill.body,
    directoryName: basename(dirname(skill.sourcePath)),
    files: [basename(skill.sourcePath)],
    frontmatter: skill.frontmatter,
    kind: "skill",
    path: relative(graph.rootPath, skill.sourcePath),
    raw: await readFile(skill.sourcePath, "utf8"),
  };
}

function lintIssueFromDiagnostic(diagnostic: LintDiagnostic, sourceFeatureId?: SkillFeatureId): LintIssue {
  const featureId = diagnostic.featureId ?? sourceFeatureId;
  return {
    code: diagnostic.code === undefined ? diagnostic.rule : `${diagnostic.rule}:${diagnostic.code}`,
    ...(featureId === undefined ? {} : { featureId }),
    message: diagnostic.message,
    path: diagnostic.path,
    severity: diagnostic.severity,
  };
}

async function lintPluginHooks(graph: BuildGraph): Promise<readonly LintIssue[]> {
  const issues: LintIssue[] = [];

  for (const plugin of graph.plugins) {
    for (const target of targetNames()) {
      if (!shouldLintPluginHook(graph, plugin, target)) continue;
      issues.push(...(await lintHookFile(graph, plugin, join("hooks", "hooks.json"), target)));
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
    const targetLabel = targetDescriptor(target).displayLabel;
    return [
      {
        code: "hook-invalid-json",
        featureId: "plugin-hooks",
        severity: "error",
        path,
        message: `${targetLabel} hook file ${path} is not valid JSON: ${message}`,
      },
    ];
  }

  try {
    validateHookDefinition(parsed, { sourcePath: path, target });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ code: "hook-target-incompatible", featureId: "plugin-hooks", message, path, severity: "error" }];
  }

  return [];
}

/**
 * SET-15: shared-resource and script authoring diagnostics. Reports undeclared
 * resource links (with a suggested entry), skill bodies that depend on plugin-root
 * script paths instead of skill-local copies, and declared script resources whose
 * source file is missing an executable bit.
 */
async function lintResourceUsage(graph: BuildGraph): Promise<readonly LintIssue[]> {
  const issues: LintIssue[] = [];
  const skills = [
    ...graph.plugins.flatMap((plugin) => plugin.skills),
    ...graph.standaloneSkills,
  ];

  for (const skill of skills) {
    const path = relative(graph.rootPath, skill.sourcePath);

    for (const undeclared of findUndeclaredResourceLinks(skill.body, skill.resources)) {
      issues.push({
        code: "resource-undeclared-link",
        featureId: "resources",
        severity: "error",
        path,
        message:
          `${path} links to undeclared resource ${undeclared.reference}; ` +
          `declare it, e.g. ${undeclared.suggestion}`,
      });
    }

    for (const offender of findPluginRootScriptLinks(skill.body)) {
      issues.push({
        code: "skill-plugin-root-script",
        featureId: "resources",
        severity: "error",
        path,
        message:
          `${path} links to a plugin-root script path ${offender}; ` +
          "skills should copy scripts skill-local via resources.scripts and reference ./scripts/<name> so the script travels with the generated skill.",
      });
    }

    for (const resource of skill.resources) {
      if (resource.kind !== "file" || !isScriptTargetPath(resource.targetPath)) continue;
      if (await sourceIsExecutable(resource.sourcePath)) continue;
      issues.push({
        code: "resource-script-not-executable",
        featureId: "resources",
        severity: "error",
        path,
        message:
          `${path} declares script resource ${resource.from} -> ${resource.targetPath}, ` +
          `but ${relative(graph.rootPath, resource.sourcePath)} is not executable. ` +
          "Run chmod +x on the source so the generated skill-local script keeps its executable expectation.",
      });
    }
  }

  return issues;
}

async function sourceIsExecutable(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return (stats.mode & 0o111) !== 0;
  } catch {
    // Missing/unreadable sources are reported elsewhere (build/resource resolution).
    return true;
  }
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
      issues.push(...lintSkill(graph, skill, "plugin-skills"));
    }
  }

  for (const skill of graph.standaloneSkills) {
    checkedSkills += 1;
    issues.push(...lintSkill(graph, skill, "standalone-skills"));
  }

  return { checkedSkills, issues };
}

function lintSkill(
  graph: BuildGraph,
  skill: SourceSkill,
  featureId: SkillFeatureId
): readonly LintIssue[] {
  const issues: LintIssue[] = [];
  issues.push(...lintToolEscapes(graph, skill));

  if (!skill.targets.codex.enabled) return issues;

  issues.push(...lintCodexAllowedTools(graph, skill));

  const markdownSearchableBody = maskMarkdownCodeRegions(skill.body);
  if (!graph.root.compile.features.promptArguments && hasSkillsetPromptArguments(skill.body)) {
    const path = relative(graph.rootPath, skill.sourcePath);
    issues.push({
      code: "prompt-arguments-disabled",
      featureId,
      severity: "error",
      path,
      message:
        `${path} uses Skillset prompt argument placeholders while compile.features.promptArguments is false. ` +
        "Enable compile.features.promptArguments or remove the {{$ARGUMENTS...}} placeholders.",
    });
  }

  const searchableBody = maskSkillsetPromptArguments(markdownSearchableBody);
  const matches = CLAUDE_DYNAMIC_PATTERNS.filter(({ pattern }) => pattern.test(searchableBody));
  if (matches.length === 0) return issues;

  const path = relative(graph.rootPath, skill.sourcePath);
  const labels = matches.map((match) => match.label).join(", ");
  issues.push({
    code: "codex-claude-dynamic-context",
    featureId,
    severity: "error",
    path,
    message:
      `${path} uses Claude dynamic context (${labels}) while Codex output is enabled. ` +
      "Set codex: false for this skill or move the dynamic behavior into a target-safe script/fallback before emitting Codex.",
  });

  return issues;
}

function maskSkillsetPromptArguments(body: string): string {
  SKILLSET_PROMPT_ARGUMENT_PATTERN.lastIndex = 0;
  return body.replaceAll(SKILLSET_PROMPT_ARGUMENT_PATTERN, "");
}

function hasSkillsetPromptArguments(body: string): boolean {
  SKILLSET_PROMPT_ARGUMENT_PATTERN.lastIndex = 0;
  return SKILLSET_PROMPT_ARGUMENT_PATTERN.test(body);
}

function maskMarkdownCodeRegions(body: string): string {
  let inFence = false;
  return body
    .split(/\r?\n/u)
    .map((line) => {
      if (FENCE_PATTERN.test(line)) {
        inFence = !inFence;
        return "";
      }
      if (inFence) return "";
      return line.replace(INLINE_CODE_PATTERN, "");
    })
    .join("\n");
}

function lintToolEscapes(graph: BuildGraph, skill: SourceSkill): readonly LintIssue[] {
  const path = relative(graph.rootPath, skill.sourcePath);

  try {
    if (skill.targets.claude.enabled) {
      readClaudeNativeToolRules(skill.frontmatter, skill.targets.claude.options, path);
    }
    for (const target of targetNames()) {
      if (target === "claude" || !skill.targets[target].enabled) continue;
      readToolsPolicyMetadata(skill.frontmatter, skill.targets[target].options, target, path);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        code: "skill-tools-invalid",
        featureId: "tools-policy",
        severity: "error",
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
      featureId: "tools-policy",
      severity: "error",
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
