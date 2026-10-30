import { basename } from "node:path";

import { SKILL_FILE } from "@skillset/registry";

import { compareStrings } from "./path";
import type { SkillsetRenderResult } from "./render-result";
import type { RenderedFile, TargetName } from "./types";

export interface RenderedSkillEvidence {
  readonly rendered: readonly RenderedFile[];
  readonly renderResults: readonly SkillsetRenderResult[];
}

export interface RenderedSkillIdentity {
  readonly sourceUnit: string;
  readonly sourcePath: string;
}

/** Query the completed build, including shared packages and allocated project-use names. */
export function renderedSkillPaths(
  evidence: RenderedSkillEvidence,
  target: TargetName,
  identities: readonly RenderedSkillIdentity[]
): readonly string[] {
  const paths = new Set<string>();
  const primaryFiles = new Map(
    evidence.rendered
      .filter((file) => basename(file.path) === SKILL_FILE)
      .map((file) => [file.path, file.sourcePath?.replaceAll("\\", "/")])
  );
  for (const result of evidence.renderResults) {
    if (result.target !== target || result.destination !== "skill") continue;
    if (
      !identities.some(
        (identity) =>
          identity.sourceUnit === result.sourceUnit &&
          identity.sourcePath.replaceAll("\\", "/") ===
            result.sourcePath?.replaceAll("\\", "/")
      )
    )
      continue;
    for (const output of result.outputs ?? []) {
      if (
        result.sourcePath !== undefined &&
        primaryFiles.get(output.path) ===
          result.sourcePath.replaceAll("\\", "/")
      )
        paths.add(output.path);
    }
  }
  return [...paths].sort(compareStrings);
}
