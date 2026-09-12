import path from "node:path";

import type { StandardProfileId } from "@skillset/registry";
import {
  RENDERED_METADATA_SCHEMA_KEY,
  RENDERED_METADATA_SCHEMA_VERSION,
} from "@skillset/schema";

import { readRecord, readString } from "./config";
import type { LogicalRenderedFile } from "./output-plan";
import { formatPreprocessDependency, preprocessText } from "./preprocess";
import { textFile } from "./render-support";
import {
  resolveDeclaredResourceReference,
  rewriteResourceLinks,
} from "./resources";
import { readAllowedTools } from "./skill-policy";
import { renderValidatedMarkdown } from "./structured-output";
import type {
  BuildGraph,
  BuildScope,
  JsonRecord,
  JsonValue,
  SourcePlugin,
  SourceSkill,
} from "./types";
import { skillVersion } from "./versioning";

const STANDARD_FRONTMATTER_KEYS = new Set([
  "allowed-tools",
  "compatibility",
  "description",
  "license",
  "metadata",
  "name",
]);

type SkillStandardProfile = Extract<
  StandardProfileId,
  "agent-plugins-1.0" | "agent-skills"
>;

export interface AgentSkillStandardIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface AgentSkillStandardProjectionIssue {
  readonly issues: readonly AgentSkillStandardIssue[];
  readonly plugin?: SourcePlugin;
  readonly skill: SourceSkill;
  readonly standardProfile: SkillStandardProfile;
}

export type AgentSkillStandardClassification =
  | { readonly frontmatter: JsonRecord; readonly status: "supported" }
  | { readonly issue: AgentSkillStandardIssue; readonly status: "unsupported" };

export interface RenderedAgentSkillStandardMarkdown {
  readonly content: string;
  readonly file: LogicalRenderedFile;
  readonly preprocessDependencies: readonly string[];
}

export function agentSkillSourceUnit(
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): string {
  return plugin === undefined
    ? `skill:${skill.id}`
    : `plugin.${plugin.id}.skill:${skill.id}`;
}

export function classifyAgentSkillStandard(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  directoryName = skill.id,
  resolvedLicense?: string
): AgentSkillStandardClassification {
  const name = resolvedSkillName(skill);
  const description = resolvedSkillDescription(skill);
  const label = path.relative(graph.rootPath, skill.sourcePath);
  const nameIssue = validateName(name, directoryName, label);
  if (nameIssue !== undefined) {
    return { issue: nameIssue, status: "unsupported" };
  }
  if (characterLength(description) > 1024) {
    return unsupported(
      "agent-skills-description-limit",
      `${label}.description`,
      "Agent Skills description must contain at most 1024 characters"
    );
  }

  const frontmatter: Record<string, JsonValue> = { name, description };
  if (resolvedLicense !== undefined) {
    frontmatter.license = resolvedLicense;
  }
  const compatibilityIssue = addCompatibility(frontmatter, skill, label);
  if (compatibilityIssue !== undefined) {
    return { issue: compatibilityIssue, status: "unsupported" };
  }
  const metadataIssue = addMetadata(frontmatter, graph, plugin, skill, label);
  if (metadataIssue !== undefined) {
    return { issue: metadataIssue, status: "unsupported" };
  }

  const allowedTools = readAllowedTools(skill.frontmatter, "agents", label);
  if (allowedTools !== undefined && allowedTools !== false) {
    frontmatter["allowed-tools"] = allowedTools.join(" ");
  }
  if (
    Object.keys(frontmatter).some((key) => !STANDARD_FRONTMATTER_KEYS.has(key))
  ) {
    throw new Error(
      "skillset: internal Agent Skills frontmatter whitelist drift"
    );
  }
  return { frontmatter, status: "supported" };
}

export async function renderAgentSkillStandardMarkdown(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  targetSkillDir: string,
  resolvedLicense: string | undefined,
  standardProfile: SkillStandardProfile
): Promise<RenderedAgentSkillStandardMarkdown | AgentSkillStandardIssue> {
  const classification = classifyAgentSkillStandard(
    graph,
    plugin,
    skill,
    skill.id,
    resolvedLicense
  );
  if (classification.status === "unsupported") {
    return classification.issue;
  }

  const preprocessDependencies = new Set<string>();
  const body = await preprocessText(skill.body, {
    frontmatter: skill.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: skill.sourcePath,
    sourceRoot: graph.sourceRoot,
    promptArguments: graph.root.compile.features.promptArguments,
    renderPathReference: (reference) =>
      reference.scheme === undefined
        ? reference.specifier.replaceAll("\\", "/")
        : resolveDeclaredResourceReference(
            reference.specifier,
            skill.resources,
            skill.sourcePath
          ),
    ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
  });
  const content = renderValidatedMarkdown(
    classification.frontmatter,
    rewriteResourceLinks(body, skill.resources, skill.sourcePath),
    `${path.relative(graph.rootPath, skill.sourcePath)} -> Agent Skills`
  );
  return {
    content,
    file: asAgentSkillStandardFile(
      textFile(
        path.join(targetSkillDir, "SKILL.md"),
        content,
        path.relative(graph.rootPath, skill.sourcePath)
      ),
      agentSkillSourceUnit(plugin, skill),
      standardProfile
    ),
    preprocessDependencies: [...preprocessDependencies]
      .map((dependency) =>
        formatPreprocessDependency(graph.rootPath, dependency)
      )
      .sort(),
  };
}

export function asAgentSkillStandardFile(
  file: Omit<LogicalRenderedFile, "outputProjection">,
  sourceUnit: string,
  standardProfile: SkillStandardProfile = "agent-skills"
): LogicalRenderedFile {
  return {
    ...file,
    outputProjection: {
      consumer: { phase: "baseline", standardProfile },
      ownership: "managed",
      sourceUnit,
    },
  };
}

export function asCodexAgentSkillDeltaFile(
  file: Omit<LogicalRenderedFile, "outputProjection">,
  sourceUnit: string
): LogicalRenderedFile {
  return {
    ...file,
    outputProjection: {
      consumer: { phase: "delta", target: "codex" },
      ownership: "managed",
      sourceUnit,
    },
  };
}

export function agentSkillStandardDirectory(
  root: ".agents/skills" | string,
  skill: SourceSkill
): string {
  return path.join(root, skill.id).replaceAll("\\", "/");
}

export function classifyAgentPluginSkillLayout(
  graph: BuildGraph,
  plugin: SourcePlugin,
  skill: SourceSkill
): AgentSkillStandardIssue | undefined {
  const relativePath = path
    .relative(plugin.path, skill.sourcePath)
    .replaceAll("\\", "/");
  const parts = relativePath.split("/");
  if (
    parts.length === 3 &&
    parts[0] === "skills" &&
    parts[1] === skill.id &&
    parts[2] === "SKILL.md"
  ) {
    return undefined;
  }
  return issue(
    "agent-plugins-skill-immediate-child",
    path.relative(graph.rootPath, skill.sourcePath),
    `Agent Plugins discovers only immediate skills/<name>/SKILL.md children; ${relativePath} would be hidden`
  );
}

/** Standard-scoped failures never invalidate the shared adaptive source. */
export function agentSkillStandardProjectionIssues(
  graph: BuildGraph,
  scopes?: readonly BuildScope[]
): readonly AgentSkillStandardProjectionIssue[] {
  const issues: AgentSkillStandardProjectionIssue[] = [];
  if (
    (scopes === undefined || scopes.includes("repo")) &&
    graph.root.compile.agents.skills &&
    graph.standardProjections.adopted.includes("agent-skills")
  ) {
    for (const skill of graph.standaloneSkills) {
      pushStandardIssue(issues, graph, undefined, skill);
    }
    for (const plugin of graph.plugins) {
      for (const skill of plugin.skills) {
        pushStandardIssue(issues, graph, plugin, skill);
      }
    }
  }
  if (
    (scopes === undefined || scopes.includes("plugins")) &&
    graph.root.compile.agents.plugins &&
    graph.standardProjections.adopted.includes("agent-plugins-1.0")
  ) {
    for (const plugin of graph.plugins) {
      for (const skill of plugin.skills) {
        const skillIssues = [
          classifyAgentPluginSkillLayout(graph, plugin, skill),
          classificationIssue(classifyAgentSkillStandard(graph, plugin, skill)),
        ].filter((item): item is AgentSkillStandardIssue => item !== undefined);
        if (skillIssues.length > 0) {
          issues.push({
            issues: skillIssues,
            plugin,
            skill,
            standardProfile: "agent-plugins-1.0",
          });
        }
      }
    }
  }
  return issues;
}

function pushStandardIssue(
  issues: AgentSkillStandardProjectionIssue[],
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): void {
  const standardIssue = classificationIssue(
    classifyAgentSkillStandard(graph, plugin, skill)
  );
  if (standardIssue === undefined) return;
  issues.push({
    issues: [standardIssue],
    ...(plugin === undefined ? {} : { plugin }),
    skill,
    standardProfile: "agent-skills",
  });
}

function classificationIssue(
  classification: AgentSkillStandardClassification
): AgentSkillStandardIssue | undefined {
  return classification.status === "unsupported"
    ? classification.issue
    : undefined;
}

function resolvedSkillName(skill: SourceSkill): string {
  return (
    readString(skill.metadata, "name") ??
    readString(skill.metadata, "id") ??
    readString(skill.frontmatter, "name") ??
    skill.id
  );
}

function resolvedSkillDescription(skill: SourceSkill): string {
  return (
    readString(skill.frontmatter, "description") ??
    readString(skill.metadata, "description") ??
    readString(skill.frontmatter, "summary") ??
    readString(skill.metadata, "summary") ??
    readString(skill.frontmatter, "title") ??
    readString(skill.metadata, "title") ??
    skill.id
  );
}

function addCompatibility(
  frontmatter: Record<string, JsonValue>,
  skill: SourceSkill,
  label: string
): AgentSkillStandardIssue | undefined {
  const compatibility = skill.frontmatter.compatibility;
  if (compatibility === undefined) {
    return undefined;
  }
  if (
    typeof compatibility !== "string" ||
    characterLength(compatibility) < 1 ||
    characterLength(compatibility) > 500
  ) {
    return issue(
      "agent-skills-compatibility-limit",
      `${label}.compatibility`,
      "Agent Skills compatibility must contain 1 to 500 characters"
    );
  }
  frontmatter.compatibility = compatibility;
  return undefined;
}

function addMetadata(
  frontmatter: Record<string, JsonValue>,
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill,
  label: string
): AgentSkillStandardIssue | undefined {
  const metadata = standardMetadata(graph, plugin, skill);
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string") {
      return issue(
        "agent-skills-metadata-string",
        `${label}.metadata.${key}`,
        `Agent Skills metadata value ${key} must be a string`
      );
    }
  }
  if (Object.keys(metadata).length > 0) {
    frontmatter.metadata = metadata;
  }
  return undefined;
}

function standardMetadata(
  graph: BuildGraph,
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): JsonRecord {
  const source = readRecord(skill.frontmatter, "metadata") ?? {};
  if (!graph.root.compile.skillset.metadata) {
    return source;
  }
  return {
    ...source,
    version: skillVersion(graph, plugin, skill),
    [RENDERED_METADATA_SCHEMA_KEY]: RENDERED_METADATA_SCHEMA_VERSION,
  };
}

function validateName(
  name: string,
  directoryName: string,
  label: string
): AgentSkillStandardIssue | undefined {
  if (characterLength(name) < 1 || characterLength(name) > 64) {
    return issue(
      "agent-skills-name-limit",
      `${label}.name`,
      "Agent Skills name must contain 1 to 64 characters"
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    return issue(
      "agent-skills-name-shape",
      `${label}.name`,
      "Agent Skills name must use lowercase letters, digits, and single hyphens"
    );
  }
  if (name !== directoryName) {
    return issue(
      "agent-skills-name-directory",
      `${label}.name`,
      `Agent Skills name ${name} must match directory ${directoryName}`
    );
  }
  return undefined;
}

function characterLength(value: string): number {
  return [...value].length;
}

function unsupported(
  code: string,
  issuePath: string,
  message: string
): AgentSkillStandardClassification {
  return { issue: issue(code, issuePath, message), status: "unsupported" };
}

function issue(
  code: string,
  issuePath: string,
  message: string
): AgentSkillStandardIssue {
  return { code, message, path: issuePath };
}
