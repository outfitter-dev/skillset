import { dirname, join, relative } from "node:path";

import { compareStrings } from "./path";
import { loadBuildGraph } from "./resolver";
import type { SkillsetOptions, SourceSkill, TargetName } from "./types";

export interface SkillsetEvalListEntry {
  readonly evalId: number;
  readonly evalPath: string;
  readonly expectedOutput: string;
  readonly expectations: readonly string[];
  readonly files: readonly string[];
  readonly prompt: string;
  readonly skill: string;
  readonly skillPath: string;
  readonly target: TargetName;
}

/**
 * Derives the portable eval case/target matrix from source already resolved by
 * the build graph. This read-only operation never invokes a provider.
 */
export async function listSkillEvals(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly SkillsetEvalListEntry[]> {
  const graph = await loadBuildGraph(rootPath, options);
  const skills = [
    ...graph.standaloneSkills,
    ...graph.plugins.flatMap((plugin) => plugin.skills),
  ];
  const entries = skills.flatMap((skill) => listSkillEvalEntries(graph.rootPath, skill));
  return entries.sort((left, right) =>
    compareStrings(left.skillPath, right.skillPath) ||
    left.evalId - right.evalId ||
    compareStrings(left.target, right.target)
  );
}

function listSkillEvalEntries(
  rootPath: string,
  skill: SourceSkill
): readonly SkillsetEvalListEntry[] {
  const declaration = skill.evalDeclaration;
  if (declaration === undefined) return [];
  const skillPath = normalizeEvalDisplayPath(relative(rootPath, skill.sourcePath));
  const evalPath = normalizeEvalDisplayPath(
    join(relative(rootPath, dirname(skill.sourcePath)), declaration.relativePath)
  );
  return declaration.cases.flatMap((entry) =>
    entry.targets.map((target) => ({
      evalId: entry.id,
      evalPath,
      expectedOutput: entry.expectedOutput,
      expectations: entry.expectations,
      files: entry.files,
      prompt: entry.prompt,
      skill: skill.id,
      skillPath,
      target,
    }))
  );
}

export function normalizeEvalDisplayPath(path: string): string {
  return path.replaceAll("\\", "/");
}
