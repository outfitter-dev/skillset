import path from "node:path";

import { isTargetName, targetNames } from "@skillset/core";
import type {
  BuildScope,
  CompileBuildMode,
  TargetName,
} from "@skillset/core/internal/types";

export interface CliParseContext {
  readonly cwd: string;
}

export const tokenizeCsv = (value: string): readonly string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const isBuildScope = (value: string): value is BuildScope =>
  value === "repo" ||
  value === "plugins" ||
  value === "project" ||
  value === "user";

export const resolveCliRoot = (
  context: CliParseContext,
  rootPath?: string
): string => path.resolve(context.cwd, rootPath ?? ".");

export const readPositiveInteger = (value: string, flag: string): number => {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(`skillset: expected ${flag} to be a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`skillset: expected ${flag} to be a positive integer`);
  }
  return parsed;
};

export const readTargetName = (value: string): TargetName => {
  if (isTargetName(value)) {
    return value;
  }
  throw new Error(`skillset: expected --target ${targetNames().join(", ")}`);
};

export const readTargetNames = (
  value: string,
  flag = "--targets"
): readonly TargetName[] => {
  const targets = tokenizeCsv(value);
  if (targets.length === 0) {
    throw new Error(`skillset: ${flag} requires at least one target`);
  }
  const seen = new Set<TargetName>();
  for (const target of targets) {
    if (!isTargetName(target)) {
      throw new Error(`skillset: expected ${flag} ${targetNames().join(", ")}`);
    }
    seen.add(target);
  }
  return [...seen];
};

export const mergeBuildMode = (
  current: CompileBuildMode | undefined,
  next: CompileBuildMode
): CompileBuildMode => {
  if (current !== undefined && current !== next) {
    throw new Error(
      `skillset: conflicting build mode flags --${current} and --${next}`
    );
  }
  return next;
};

export const readBuildScopes = (value: string): readonly BuildScope[] => {
  const scopes = tokenizeCsv(value);
  if (scopes.length === 0) {
    throw new Error("skillset: --scope requires at least one scope");
  }
  if (scopes.includes("all")) {
    if (scopes.length > 1) {
      throw new Error(
        "skillset: --scope all cannot be combined with other scopes"
      );
    }
    return ["repo", "plugins", "project", "user"];
  }
  const seen = new Set<BuildScope>();
  for (const scope of scopes) {
    if (!isBuildScope(scope)) {
      throw new Error(
        "skillset: expected --scope repo, plugins, project, user, all, or a comma-separated combination"
      );
    }
    seen.add(scope);
  }
  return [...seen];
};
