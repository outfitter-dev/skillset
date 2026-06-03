import { dirname, relative } from "node:path";

export interface RuleVariableContext {
  readonly outputPath: string;
  readonly rootPath: string;
  readonly sourcePath: string;
}

interface RuleVariables {
  readonly label: string;
  readonly outputDir: string;
  readonly repoRoot: string;
  readonly sourceRule: string;
}

export function renderRuleVariables(body: string, context: RuleVariableContext): string {
  return interpolateRuleVariables(body, ruleVariablesFor(context));
}

function ruleVariablesFor(context: RuleVariableContext): RuleVariables {
  const outputDir = outputDirectory(context.outputPath);
  const sourceRule = normalizeWorkspacePath(relative(context.rootPath, context.sourcePath));
  return {
    label: sourceRule,
    outputDir,
    repoRoot: relativeOutputPath(outputDir, ""),
    sourceRule,
  };
}

function interpolateRuleVariables(body: string, variables: RuleVariables): string {
  return body.replace(/\{\{\s*skillset\.([^}\s]+)\s*\}\}/g, (match, key: string) => {
    switch (key) {
      case "output_dir":
        return variables.outputDir;
      case "repo_root":
        return variables.repoRoot;
      case "source_rule":
        return variables.sourceRule;
      default:
        throw new Error(`skillset: unknown rule variable ${match} in ${variables.label}`);
    }
  });
}

function outputDirectory(outputPath: string): string {
  const directory = normalizeWorkspacePath(dirname(outputPath));
  if (directory.length === 0 || directory === ".") return ".";
  return directory;
}

function relativeOutputPath(from: string, to: string): string {
  const normalizedFrom = from === "." ? "" : from;
  const normalizedTo = to === "." ? "" : to;
  const path = normalizeWorkspacePath(relative(normalizedFrom, normalizedTo));
  return path.length === 0 ? "." : path;
}

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
