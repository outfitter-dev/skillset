/* eslint-disable func-style, no-use-before-define -- The private orchestration entrypoint leads its small, ordered graph-rewrite helpers. */
import type { StandardProfile, StandardProfileId } from "@skillset/registry";

import { renderStandardProjectionBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import {
  resolveCandidateStandardProjectionPlan,
  standardProjectionSourceInventory,
} from "./standard-projections";
import type {
  BuildGraph,
  RenderedFile,
  ResolvedTarget,
  SkillsetOptions,
  SourcePlugin,
  SourceProjectAgent,
  SourceRule,
  SourceSkill,
  TargetName,
} from "./types";

export type CandidateStandardRenderOptions = Pick<
  SkillsetOptions,
  "sourceDir" | "xdg"
> & {
  /** Private test seam; production conformance always uses the live registry. */
  readonly profiles?: readonly StandardProfile[];
};

/**
 * Render one registry candidate through the production standard renderers.
 *
 * The operation is intentionally available only from Core's private internal
 * export map. It returns logical artifacts without writing them and removes
 * every provider projection from the loaded graph before rendering.
 */
export async function renderCandidateStandardProfile(
  rootPath: string,
  profileId: StandardProfileId,
  options: CandidateStandardRenderOptions = {}
): Promise<readonly RenderedFile[]> {
  const { profiles, ...loadOptions } = options;
  const loaded = await loadBuildGraph(rootPath, {
    ...loadOptions,
    targetFilter: [],
  });
  const standardProjections = resolveCandidateStandardProjectionPlan(
    standardProjectionSourceInventory(loaded),
    profileId,
    profiles
  );
  return renderStandardProjectionBuildGraph({
    ...withoutProviderProjections(loaded),
    standardProjections,
  });
}

const DISABLED_TARGET: ResolvedTarget = { enabled: false, options: {} };

function disabledTargets(): Readonly<Record<TargetName, ResolvedTarget>> {
  return {
    claude: DISABLED_TARGET,
    codex: DISABLED_TARGET,
    cursor: DISABLED_TARGET,
  };
}

function withoutProviderProjections(graph: BuildGraph): BuildGraph {
  return {
    ...graph,
    plugins: graph.plugins.map(disablePluginTargets),
    projectAgents: graph.projectAgents.map(disableProjectAgentTargets),
    root: {
      ...graph.root,
      compile: { ...graph.root.compile, targets: [] },
      marketplaces: {},
      targets: disabledTargets(),
    },
    rules: graph.rules.map(disableRuleTargets),
    standaloneSkills: graph.standaloneSkills.map(disableSkillTargets),
  };
}

function disablePluginTargets(plugin: SourcePlugin): SourcePlugin {
  return {
    ...plugin,
    skills: plugin.skills.map(disableSkillTargets),
    targets: disabledTargets(),
  };
}

function disableSkillTargets<T extends SourceSkill>(skill: T): T {
  return { ...skill, targets: disabledTargets() };
}

function disableRuleTargets(rule: SourceRule): SourceRule {
  return { ...rule, targets: disabledTargets() };
}

function disableProjectAgentTargets(
  agent: SourceProjectAgent
): SourceProjectAgent {
  return { ...agent, targets: disabledTargets() };
}
