import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";

import { readAppliedChangeRecords, type AppliedChangeRecord, groupRef } from "./change-workflow";
import { compareStrings } from "./path";
import type { BuildGraph, JsonRecord, RenderedFile, SourcePlugin, SourceSkill } from "./types";
import { stringifyMarkdown } from "./yaml";

const textEncoder = new TextEncoder();
const GENERATED_BY = "skillset@0.1.0";

export interface ChangelogProjection {
  readonly entityId: string;
  readonly entityKind: "plugin" | "standalone-skill";
  readonly outputPath: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly file: RenderedFile;
}

export async function renderChangelogProjections(graph: BuildGraph): Promise<readonly ChangelogProjection[]> {
  const changes = await readAppliedChangeRecords(graph.rootPath, { sourceDir: graph.sourceDir });
  if (changes.length === 0) return [];

  const projections: ChangelogProjection[] = [];
  for (const skill of graph.standaloneSkills) {
    const scoped = changesForScopes(changes, [`standalone-skill:${skill.id}`]);
    if (scoped.length === 0) continue;
    projections.push(renderSkillChangelog(graph, skill, scoped));
  }

  for (const plugin of graph.plugins) {
    const childScopes = plugin.skills.map((skill) => `plugin-skill:${plugin.id}/${skill.id}`);
    const scoped = changesForScopes(changes, [`plugin:${plugin.id}`, `plugin-config:${plugin.id}`, ...childScopes]);
    if (scoped.length === 0) continue;
    projections.push(renderPluginChangelog(graph, plugin, scoped));
  }

  return projections.sort((left, right) => compareStrings(left.outputPath, right.outputPath));
}

function renderSkillChangelog(
  graph: BuildGraph,
  skill: SourceSkill,
  changes: readonly AppliedChangeRecord[]
): ChangelogProjection {
  const outputPath = join(dirname(relative(graph.rootPath, skill.sourcePath)), "CHANGELOG.md");
  return projection("standalone-skill", skill.id, outputPath, relative(graph.rootPath, skill.sourcePath), changes);
}

function renderPluginChangelog(
  graph: BuildGraph,
  plugin: SourcePlugin,
  changes: readonly AppliedChangeRecord[]
): ChangelogProjection {
  const outputPath = join(relative(graph.rootPath, plugin.path), "CHANGELOG.md");
  return projection("plugin", plugin.id, outputPath, relative(graph.rootPath, plugin.configPath), changes);
}

function projection(
  entityKind: ChangelogProjection["entityKind"],
  entityId: string,
  outputPath: string,
  sourcePath: string,
  changes: readonly AppliedChangeRecord[]
): ChangelogProjection {
  const content = renderChangelogMarkdown(entityKind, entityId, changes);
  return {
    entityId,
    entityKind,
    file: {
      content: textEncoder.encode(content),
      path: outputPath,
      sourcePath,
    },
    outputPath,
    sourceHash: hashChanges(entityKind, entityId, changes),
    sourcePath,
  };
}

function renderChangelogMarkdown(
  entityKind: ChangelogProjection["entityKind"],
  entityId: string,
  changes: readonly AppliedChangeRecord[]
): string {
  const frontmatter: JsonRecord = {
    metadata: {
      generated: GENERATED_BY,
      kind: "changelog",
      target: `${entityKind}:${entityId}`,
    },
  };
  const sections = changes
    .map((change) => renderChangeSection(change))
    .join("\n\n");
  return stringifyMarkdown(frontmatter, `# Changelog\n\n${sections}\n`);
}

function renderChangeSection(change: AppliedChangeRecord): string {
  const lines = [`## ${change.id}`];
  const details: string[] = [];
  if (change.bump !== undefined) details.push(`bump: ${change.bump}`);
  const group = groupRef(change.group);
  if (group !== undefined) details.push(`group: ${group}`);
  if (change.scopes.length > 0) details.push(`scopes: ${change.scopes.join(", ")}`);
  if (details.length > 0) lines.push("", details.join(" | "));
  lines.push("", change.reason.trim());
  return lines.join("\n");
}

function changesForScopes(
  changes: readonly AppliedChangeRecord[],
  scopes: readonly string[]
): readonly AppliedChangeRecord[] {
  const scopeSet = new Set(scopes);
  return changes
    .filter((change) => change.scopes.some((scope) => scopeSet.has(scope)))
    .sort(compareChangeRecords);
}

function compareChangeRecords(left: AppliedChangeRecord, right: AppliedChangeRecord): number {
  const leftKey = historySortKey(left);
  const rightKey = historySortKey(right);
  return compareStrings(rightKey, leftKey);
}

function historySortKey(change: AppliedChangeRecord): string {
  const match = change.path.match(/:(\d+)$/);
  const line = match?.[1]?.padStart(12, "0") ?? "000000000000";
  return `${line}:${change.id}`;
}

function hashChanges(
  entityKind: ChangelogProjection["entityKind"],
  entityId: string,
  changes: readonly AppliedChangeRecord[]
): string {
  const hash = createHash("sha256");
  hash.update("skillset-changelog-v1\0");
  hash.update(entityKind);
  hash.update("\0");
  hash.update(entityId);
  for (const change of changes) {
    hash.update("\0change\0");
    hash.update(change.id);
    hash.update("\0");
    hash.update(change.bump ?? "");
    hash.update("\0");
    hash.update(groupRef(change.group) ?? "");
    hash.update("\0");
    hash.update(change.reason);
    hash.update("\0");
    for (const scope of [...change.scopes].sort(compareStrings)) {
      hash.update("scope\0");
      hash.update(scope);
      hash.update("\0");
      for (const sourceHash of [...(change.sourceHashes.get(scope) ?? [])].sort(compareStrings)) {
        hash.update("sourceHash\0");
        hash.update(sourceHash);
        hash.update("\0");
      }
    }
  }
  return `sha256:${hash.digest("hex")}`;
}
