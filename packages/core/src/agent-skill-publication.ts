import { pluginDependencies } from "./dependencies";
import { compareStrings } from "./path";
import type {
  BuildGraph,
  SourceAdaptiveHook,
  SourceHookAttachment,
  SourcePlugin,
  SourcePluginDependency,
  SourceSkill,
} from "./types";

export type IndividualAgentSkillPublicationBlockerCode =
  | "adaptive-hook-required"
  | "plugin-dependency-required";

export interface IndividualAgentSkillPublicationBlocker {
  readonly code: IndividualAgentSkillPublicationBlockerCode;
  readonly message: string;
  readonly paths: readonly string[];
}

export type IndividualAgentSkillPublicationClassification =
  | {
      readonly blockers: readonly [];
      readonly status: "eligible";
    }
  | {
      readonly blockers: readonly IndividualAgentSkillPublicationBlocker[];
      readonly status: "ineligible";
    };

const dependencyBlocker = (
  dependency: SourcePluginDependency
): IndividualAgentSkillPublicationBlocker => ({
  code: "plugin-dependency-required",
  message: `plugin dependency ${dependency.name} is required by the containing plugin package and cannot travel with an individual Agent Skill`,
  paths: [dependency.sourceLabel],
});

const hookAttachmentBlocker = (
  attachment: SourceHookAttachment
): IndividualAgentSkillPublicationBlocker => ({
  code: "adaptive-hook-required",
  message: `adaptive hook ${attachment.hook} is attached to the skill and cannot travel with an individual Agent Skill`,
  paths: [attachment.sourcePath],
});

const hookDefinitionBlocker = (
  hook: SourceAdaptiveHook
): IndividualAgentSkillPublicationBlocker => ({
  code: "adaptive-hook-required",
  message: `adaptive hook ${hook.name} is defined by the skill and cannot travel with an individual Agent Skill`,
  paths: [hook.sourcePath],
});

/**
 * Classify whether one rendered Agent Skill can be published independently of
 * its containing plugin package.
 *
 * Only explicit required edges disqualify a skill. Plugin-level agents,
 * commands, MCP configuration, hooks, and other companions are not inferred as
 * dependencies merely because they share a container. Declared resources and
 * preprocessing inputs travel through the Agent Skills renderer itself.
 */
export const classifyIndividualAgentSkillPublication = (
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): IndividualAgentSkillPublicationClassification => {
  if (plugin === undefined) {
    return { blockers: [], status: "eligible" };
  }
  const blockers = [
    ...pluginDependencies(graph, plugin).map(dependencyBlocker),
    ...skill.adaptiveHooks.map(hookDefinitionBlocker),
    ...skill.hookAttachments.map(hookAttachmentBlocker),
  ].toSorted(
    (left, right) =>
      compareStrings(left.code, right.code) ||
      compareStrings(left.paths[0] ?? "", right.paths[0] ?? "") ||
      compareStrings(left.message, right.message)
  );

  return blockers.length === 0
    ? { blockers: [], status: "eligible" }
    : { blockers, status: "ineligible" };
};
