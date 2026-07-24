import { relative } from "node:path";

import { readStringArray, targetNames } from "./config";
import { assertRewrittenSourceReference } from "./source-reference-contract";
import type {
  BuildGraph,
  SourceProjectAgent,
  SourcePlugin,
  TargetName,
} from "./types";

const QUALIFIED_PLUGIN_SKILL =
  /^plugin\.([a-z0-9][a-z0-9-]*)\.skill:([a-z0-9][a-z0-9-]*)$/u;

export interface ResolvedProjectAgentSkill {
  readonly authored: string;
  readonly pluginId?: string;
  readonly rendered: string;
  readonly skillId: string;
}

export function resolveProjectAgentSkills(
  graph: Pick<BuildGraph, "plugins" | "rootPath" | "standaloneSkills">,
  agent: SourceProjectAgent,
  target: TargetName
): readonly ResolvedProjectAgentSkill[] | undefined {
  assertRewrittenSourceReference("agent-skills");
  const authored =
    readStringArray(agent.targets[target].options, "skills") ??
    readStringArray(agent.frontmatter, "skills");
  if (authored === undefined) return undefined;

  return authored.map((reference) =>
    resolveProjectAgentSkillReference(
      graph,
      agent,
      target,
      reference
    )
  );
}

export function validateProjectAgentSkills(
  graph: Pick<
    BuildGraph,
    "plugins" | "projectAgents" | "rootPath" | "standaloneSkills"
  >
): void {
  for (const agent of graph.projectAgents) {
    for (const target of targetNames()) {
      if (!agent.targets[target].enabled) continue;
      resolveProjectAgentSkills(graph, agent, target);
    }
  }
}

function resolveProjectAgentSkillReference(
  graph: Pick<BuildGraph, "plugins" | "rootPath" | "standaloneSkills">,
  agent: SourceProjectAgent,
  target: TargetName,
  reference: string
): ResolvedProjectAgentSkill {
  const qualified = reference.match(QUALIFIED_PLUGIN_SKILL);
  if (qualified !== null) {
    const pluginId = qualified[1];
    const skillId = qualified[2];
    if (pluginId === undefined || skillId === undefined) {
      throw invalidSkillReference(
        graph.rootPath,
        agent,
        target,
        reference,
        "expected plugin.<plugin>.skill:<skill>"
      );
    }
    const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
    const skill = plugin?.skills.find((candidate) => candidate.id === skillId);
    if (plugin === undefined || skill === undefined) {
      throw invalidSkillReference(
        graph.rootPath,
        agent,
        target,
        reference,
        "no matching plugin skill exists"
      );
    }
    assertSkillAvailableForTarget(
      graph.rootPath,
      agent,
      target,
      reference,
      skill.targets[target].enabled
    );
    return {
      authored: reference,
      pluginId,
      rendered: renderPluginSkillReference(plugin, skillId),
      skillId,
    };
  }

  if (reference.startsWith("plugin.")) {
    throw invalidSkillReference(
      graph.rootPath,
      agent,
      target,
      reference,
      "expected plugin.<plugin>.skill:<skill>"
    );
  }

  const skill = graph.standaloneSkills.find(
    (candidate) => candidate.id === reference
  );
  if (skill === undefined) {
    throw invalidSkillReference(
      graph.rootPath,
      agent,
      target,
      reference,
      "no matching standalone skill exists; use plugin.<plugin>.skill:<skill> for a plugin skill"
    );
  }
  assertSkillAvailableForTarget(
    graph.rootPath,
    agent,
    target,
    reference,
    skill.targets[target].enabled
  );
  return {
    authored: reference,
    rendered: skill.id,
    skillId: skill.id,
  };
}

function assertSkillAvailableForTarget(
  rootPath: string,
  agent: SourceProjectAgent,
  target: TargetName,
  reference: string,
  available: boolean
): void {
  if (available) return;
  throw invalidSkillReference(
    rootPath,
    agent,
    target,
    reference,
    `the skill is not enabled for ${target}`
  );
}

function invalidSkillReference(
  rootPath: string,
  agent: SourceProjectAgent,
  target: TargetName,
  reference: string,
  reason: string
): Error {
  return new Error(
    `skillset: ${relative(rootPath, agent.sourcePath)} ${target}.skills references ${JSON.stringify(reference)}: ${reason}`
  );
}

function renderPluginSkillReference(
  plugin: SourcePlugin,
  skillId: string
): string {
  return `${plugin.id}:${skillId}`;
}
