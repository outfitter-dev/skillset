import { relative, sep } from "node:path";
import { isOutputSelected } from "./config";
import { compareStrings } from "./path";
import { resolveRenderedSkillCopies, type RenderedSkillCopy, type ProjectUseStatusEntry } from "./project-use";
import { classifyAgentSkillStandard, type AgentSkillStandardClassification } from "./render-agent-skills-standard";
import { targetNames } from "./targets";
import type { BuildGraph, TargetName } from "./types";

/** Allocation and support facts shared by one operation, never cached across graphs. */
export function createProjectCopyPlan(graph: BuildGraph) {
  const copies = resolveRenderedSkillCopies(graph);
  const byIdentity = new Map(copies.map((copy) => [`${copy.sourceUnit}\0${copy.effectiveName}`, copy]));
  const classifications = new Map<RenderedSkillCopy, AgentSkillStandardClassification>();
  return {
    copies,
    find: (sourceUnit: string, effectiveName: string | undefined) =>
      byIdentity.get(`${sourceUnit}\0${effectiveName}`),
    isSelected: (copy: RenderedSkillCopy, target: TargetName) =>
      copy.skill.targets[target].enabled &&
      isOutputSelected(graph.root.outputs.targetOutputs[target].skills, copy.skill.id),
    codexClassification(copy: RenderedSkillCopy): AgentSkillStandardClassification {
      let classification = classifications.get(copy);
      if (classification === undefined) {
        classification = classifyAgentSkillStandard(
          graph, "plugin" in copy ? copy.plugin : undefined, copy.skill,
          copy.effectiveName, undefined, {
            draft: copy.draftOrigin !== undefined,
            effectiveName: copy.effectiveName,
            internal: copy.draftOrigin !== undefined || graph.root.internalMarker,
          }
        );
        classifications.set(copy, classification);
      }
      return classification;
    },
  };
}

export type ProjectCopyPlan = ReturnType<typeof createProjectCopyPlan>;

export function projectUseStatusEntries(graph: BuildGraph): readonly ProjectUseStatusEntry[] {
  const plan = createProjectCopyPlan(graph);
  return plan.copies.flatMap((copy) => targetNames().flatMap((target) => {
    if (!plan.isSelected(copy, target) ||
        (target === "codex" && plan.codexClassification(copy).status === "unsupported")) return [];
    return [{
      ...(copy.draftOrigin === undefined ? {} : { draftOrigin: copy.draftOrigin }),
      ...("draftPolicy" in copy && copy.draftPolicy !== undefined ? { draftPolicy: copy.draftPolicy } : {}),
      effectiveName: copy.effectiveName,
      owner: { target },
      role: "plugin" in copy ? "project-use" as const : "bundle" as const,
      selectionRule: copy.selectionRule,
      ...(copy.shippedSibling === undefined ? {} : { shippedSibling: copy.shippedSibling }),
      sourcePath: relative(graph.rootPath, copy.skill.sourcePath).split(sep).join("/"),
      sourceUnit: copy.sourceUnit,
      target,
    }];
  })).sort((left, right) => compareStrings(
    `${left.sourceUnit}\0${left.effectiveName}\0${left.target}`,
    `${right.sourceUnit}\0${right.effectiveName}\0${right.target}`
  ));
}
