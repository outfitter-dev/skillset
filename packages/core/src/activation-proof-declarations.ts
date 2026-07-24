import { createHash } from "node:crypto";

import { compareStrings } from "./path";
import type { SkillsetRenderResult } from "./render-result";
import { resolveActivationProofClaims } from "./runtime-readiness";
import {
  isPluginOwnedSelector,
  selectorForPluginConfig,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForStandaloneSkill,
} from "./source-unit-selector";
import { loadSkillsetTestDeclarationsFromGraph } from "./test-declaration";
import type {
  SkillsetActivationProbe,
  SkillsetTestDeclaration,
} from "./test-declaration";
import type { BuildGraph, TargetName } from "./types";

export interface CurrentActivationProofDeclaration {
  readonly declarationHash: string;
  readonly projectionSourceUnits?: readonly string[];
  readonly requirementIds: readonly string[];
  readonly target: TargetName;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => compareStrings(left, right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
};

const stableJson = (value: unknown): string => JSON.stringify(sortJson(value));

const normalizeStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted(compareStrings);

const hashDeclaration = (value: unknown): string => {
  const hash = createHash("sha256");
  hash.update("skillset.activation-proof.declaration@1\0");
  hash.update("declared-test\0");
  hash.update(stableJson(value));
  return `sha256:${hash.digest("hex")}`;
};

const declarationKey = (
  declaration: CurrentActivationProofDeclaration
): string =>
  [
    declaration.target,
    declaration.declarationHash,
    ...declaration.requirementIds,
  ].join("\0");

export const declaredTestActivationProofHash = (input: {
  readonly declaration: SkillsetTestDeclaration;
  readonly probe: SkillsetActivationProbe;
  readonly requirementIds: readonly string[];
  readonly target: TargetName;
}): string => {
  const { declaration, probe, requirementIds, target } = input;
  const { runtime } = probe;
  if (runtime === undefined || runtime.claims.length === 0) {
    throw new Error(
      "skillset: activation proof declaration requires runtime claims"
    );
  }
  return hashDeclaration({
    declaration: {
      name: declaration.name,
      selection: declaration.selection,
      sourcePath: declaration.sourcePath,
    },
    probe: {
      expect: probe.expect,
      name: probe.name,
      prompt: probe.prompt,
      promptProvenance: probe.promptProvenance,
      runtime: {
        claims: runtime.claims,
        claudeSettingSources: runtime.claudeSettingSources,
        contains: runtime.contains,
        notContains: runtime.notContains,
        timeoutMs: runtime.timeoutMs,
      },
    },
    requirementIds: normalizeStrings(requirementIds),
    target,
  });
};

export const declaredTestActivationProofSourceUnits = (
  declaration: SkillsetTestDeclaration,
  target: TargetName,
  renderResults: readonly SkillsetRenderResult[]
): readonly string[] => {
  const outputBearingUnits = [
    ...new Set(
      renderResults
        .filter(
          (result) =>
            result.target === target && (result.outputs?.length ?? 0) > 0
        )
        .map((result) => result.sourceUnit)
    ),
  ];
  if (!declaration.selection.filterSource) {
    return outputBearingUnits.toSorted(compareStrings);
  }

  const selectedPluginSkills = new Set(
    declaration.selection.pluginSkills.map(({ pluginId, skillId }) =>
      selectorForPluginSkill(pluginId, skillId)
    )
  );
  const selectedPluginConfigs = new Set(
    declaration.selection.pluginSkills.map(({ pluginId }) =>
      selectorForPluginConfig(pluginId)
    )
  );
  const selectedStandaloneSkills = new Set(
    declaration.selection.primarySkills.map(selectorForStandaloneSkill)
  );
  const selectedAgents = new Set(
    declaration.selection.agents.map(({ outputName }) =>
      selectorForProjectAgent(outputName)
    )
  );

  return outputBearingUnits
    .filter(
      (sourceUnit) =>
        declaration.selection.plugins.some((pluginId) =>
          isPluginOwnedSelector(sourceUnit, pluginId)
        ) ||
        selectedPluginSkills.has(sourceUnit) ||
        selectedPluginConfigs.has(sourceUnit) ||
        selectedStandaloneSkills.has(sourceUnit) ||
        selectedAgents.has(sourceUnit)
    )
    .toSorted(compareStrings);
};

export const listCurrentActivationProofDeclarations = async (
  graph: BuildGraph,
  renderResults: readonly SkillsetRenderResult[]
): Promise<readonly CurrentActivationProofDeclaration[]> => {
  const declarations: CurrentActivationProofDeclaration[] = [];
  for (const declaration of await loadSkillsetTestDeclarationsFromGraph(
    graph
  )) {
    for (const probe of declaration.activationProbes) {
      if (probe.runtime === undefined || probe.runtime.claims.length === 0) {
        continue;
      }
      for (const target of probe.targets) {
        const requirementIds = resolveActivationProofClaims({
          claims: probe.runtime.claims,
          graph,
          targets: [target],
        }).flatMap(({ requirementIds: ids }) => ids);
        declarations.push({
          declarationHash: declaredTestActivationProofHash({
            declaration,
            probe,
            requirementIds,
            target,
          }),
          projectionSourceUnits: declaredTestActivationProofSourceUnits(
            declaration,
            target,
            renderResults
          ),
          requirementIds,
          target,
        });
      }
    }
  }
  return declarations.toSorted((left, right) =>
    compareStrings(declarationKey(left), declarationKey(right))
  );
};
