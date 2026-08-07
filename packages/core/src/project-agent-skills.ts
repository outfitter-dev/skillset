import { relative } from "node:path";

import { isProviderNativeReferenceName } from "@skillset/schema";

import { readStringArray, targetNames } from "./config";
import { assertRewrittenSourceReference } from "./source-reference-contract";
import type {
  BuildGraph,
  JsonRecord,
  SourceProjectAgent,
  SourcePlugin,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

const QUALIFIED_PLUGIN_SKILL =
  /^plugin\.([a-z0-9][a-z0-9-]*)\.skill:([a-z0-9][a-z0-9-]*)$/u;

interface ResolvedProjectAgentSkillBase {
  readonly authored: string;
  readonly rendered: string;
}

export interface ResolvedManagedProjectAgentSkill extends ResolvedProjectAgentSkillBase {
  readonly ownership: "managed";
  readonly pluginId?: string;
  readonly skillId: string;
}

export interface ResolvedProviderNativeProjectAgentSkill extends ResolvedProjectAgentSkillBase {
  readonly ownership: "provider-native";
}

export type ResolvedProjectAgentSkill =
  | ResolvedManagedProjectAgentSkill
  | ResolvedProviderNativeProjectAgentSkill;

type AuthoredProjectAgentSkill =
  | { readonly kind: "managed"; readonly reference: string }
  | { readonly kind: "provider-native"; readonly reference: string };

export function resolveProjectAgentSkills(
  graph: Pick<BuildGraph, "plugins" | "rootPath" | "standaloneSkills">,
  agent: SourceProjectAgent,
  target: TargetName
): readonly ResolvedProjectAgentSkill[] | undefined {
  assertRewrittenSourceReference("agent-skills");
  const targetSkills = agent.targets[target].options.skills;
  const authored =
    targetSkills === undefined
      ? readStringArray(agent.frontmatter, "skills")?.map((reference) => ({
          kind: "managed" as const,
          reference,
        }))
      : readTargetProjectAgentSkills(
          graph.rootPath,
          agent,
          target,
          agent.targets[target].options
        );
  if (authored === undefined) return undefined;

  return authored.map((reference) => {
    if (reference.kind === "provider-native") {
      return {
        authored: reference.reference,
        ownership: "provider-native",
        rendered: reference.reference,
      };
    }
    return resolveProjectAgentSkillReference(
      graph,
      agent,
      target,
      reference.reference
    );
  });
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
      ownership: "managed",
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
    ownership: "managed",
    rendered: skill.id,
    skillId: skill.id,
  };
}

function readTargetProjectAgentSkills(
  rootPath: string,
  agent: SourceProjectAgent,
  target: TargetName,
  options: JsonRecord
): readonly AuthoredProjectAgentSkill[] {
  const value = options.skills;
  if (!Array.isArray(value)) {
    throw invalidTargetSkills(
      rootPath,
      agent,
      target,
      "must be an array of managed strings or { native: string } entries"
    );
  }
  return value.map((entry, index) => {
    if (typeof entry === "string" && entry.length > 0) {
      return { kind: "managed", reference: entry };
    }
    if (
      isJsonRecord(entry) &&
      Object.keys(entry).length === 1 &&
      typeof entry.native === "string" &&
      isProviderNativeReferenceName(entry.native)
    ) {
      return { kind: "provider-native", reference: entry.native };
    }
    throw invalidTargetSkills(
      rootPath,
      agent,
      target,
      `entry ${index + 1} must be a non-empty managed string or exactly { native: <non-blank string without surrounding whitespace> }`
    );
  });
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

function invalidTargetSkills(
  rootPath: string,
  agent: SourceProjectAgent,
  target: TargetName,
  reason: string
): Error {
  return new Error(
    `skillset: ${relative(rootPath, agent.sourcePath)} ${target}.skills ${reason}`
  );
}

function renderPluginSkillReference(
  plugin: SourcePlugin,
  skillId: string
): string {
  return `${plugin.id}:${skillId}`;
}
