import { readFile } from "node:fs/promises";

import { compareStrings, resolveInside } from "./path";
import { pluginTargetForOutputPath } from "./plugin-output";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import {
  selectorForPluginSkill,
  selectorForRootConfig,
  selectorForStandaloneSkill,
} from "./source-unit-selector";
import type { BuildGraph, RenderedFile, SkillsetOptions, TargetName } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

export const VERSION_DRIFT_STATUS_VALUES = [
  "destination-owned",
  "externally-managed",
  "in-sync",
  "malformed",
  "missing",
  "stale-generated",
  "unsupported",
] as const;

export type VersionDriftStatus = (typeof VERSION_DRIFT_STATUS_VALUES)[number];
export type VersionAuthority = "external" | "generated" | "release-state" | "source";

export interface VersionAuditReport {
  readonly issues: readonly VersionLocus[];
  readonly loci: readonly VersionLocus[];
  readonly rootPath: string;
}

export interface VersionLocus {
  readonly actualVersion?: string;
  readonly authority: VersionAuthority;
  readonly expectedVersion?: string;
  readonly field: string;
  readonly path: string;
  readonly reason: string;
  readonly scope: string;
  readonly status: VersionDriftStatus;
  readonly target?: TargetName;
}

interface ExpectedVersionLocus {
  readonly authority: VersionAuthority;
  readonly expectedVersion: string;
  readonly field: string;
  readonly marketplacePluginName?: string;
  readonly path: string;
  readonly scope: string;
  readonly target?: TargetName;
}

export async function auditVersions(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<VersionAuditReport> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);
  const loci = await Promise.all(
    rendered.flatMap((file) => expectedVersionLoci(graph, file)).map((locus) => auditVersionLocus(graph, locus))
  );
  const sorted = loci.sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.field, right.field));
  return {
    issues: sorted.filter((locus) => isVersionIssue(locus.status)),
    loci: sorted,
    rootPath: graph.rootPath,
  };
}

async function auditVersionLocus(
  graph: BuildGraph,
  expected: ExpectedVersionLocus
): Promise<VersionLocus> {
  let current: Uint8Array;
  try {
    current = await readFile(resolveInside(graph.rootPath, expected.path));
  } catch (error) {
    if (isNotFound(error)) {
      return versionLocus(expected, {
        reason: "Generated output is missing on disk.",
        status: "missing",
      });
    }
    throw error;
  }

  const actualVersion = extractVersion(expected.path, current, expected);
  if (actualVersion === undefined) {
    return versionLocus(expected, {
      reason: "Generated output exists but its version field is missing or malformed.",
      status: "malformed",
    });
  }
  if (actualVersion !== expected.expectedVersion) {
    return versionLocus(expected, {
      actualVersion,
      reason: "Generated output version does not match the current source/release authority.",
      status: "stale-generated",
    });
  }
  return versionLocus(expected, {
    actualVersion,
    reason: "Generated output version matches the current source/release authority.",
    status: "in-sync",
  });
}

function expectedVersionLoci(graph: BuildGraph, file: RenderedFile): readonly ExpectedVersionLocus[] {
  if (file.path === ".claude-plugin/marketplace.json" || file.path.endsWith("/.claude-plugin/marketplace.json")) {
    return expectedMarketplaceVersionLoci(graph, file);
  }

  const field = versionFieldForPath(file.path);
  const expectedVersion = extractVersion(file.path, file.content, { field });
  if (expectedVersion === undefined) return [];
  const identity = identifyVersionPath(graph, file.path);
  if (identity === undefined) return [];
  return [{
    authority: authorityForScope(graph, identity.scope),
    expectedVersion,
    field,
    path: file.path,
    scope: identity.scope,
    ...(identity.target === undefined ? {} : { target: identity.target }),
  }];
}

function expectedMarketplaceVersionLoci(graph: BuildGraph, file: RenderedFile): readonly ExpectedVersionLocus[] {
  const target = targetForPath(graph, file.path) ?? "claude";
  let record;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(file.content)) as unknown;
    if (!isJsonRecord(parsed)) return [];
    record = parsed;
  } catch {
    return [];
  }

  const loci: ExpectedVersionLocus[] = [];
  const rootScope = selectorForRootConfig();
  const rootVersion = extractJsonVersion(file.content, ["metadata", "version"]);
  if (rootVersion !== undefined) {
    loci.push({
      authority: authorityForScope(graph, rootScope),
      expectedVersion: rootVersion,
      field: "metadata.version@marketplace",
      path: file.path,
      scope: rootScope,
      ...(target === undefined ? {} : { target }),
    });
  }

  const plugins = record.plugins;
  if (!Array.isArray(plugins)) return loci;
  for (const plugin of plugins) {
    if (!isJsonRecord(plugin)) continue;
    const name = plugin.name;
    const version = plugin.version;
    if (typeof name !== "string" || name.trim().length === 0) continue;
    if (typeof version !== "string" || version.trim().length === 0) continue;
    const scope = `plugin:${name.trim()}`;
    loci.push({
      authority: authorityForScope(graph, scope),
      expectedVersion: version.trim(),
      field: `plugins.${name.trim()}.version`,
      marketplacePluginName: name.trim(),
      path: file.path,
      scope,
      ...(target === undefined ? {} : { target }),
    });
  }
  return loci;
}

function authorityForScope(graph: BuildGraph, scope: string): VersionAuthority {
  if (graph.releaseState.scopes[scope]?.removed === true) return "generated";
  return graph.releaseState.scopes[scope] === undefined ? "source" : "release-state";
}

function identifyVersionPath(
  graph: BuildGraph,
  path: string
): { readonly scope: string; readonly target?: TargetName } | undefined {
  const target = targetForPath(graph, path);
  if (path === ".claude-plugin/marketplace.json" || path.endsWith("/.claude-plugin/marketplace.json")) {
    return { scope: selectorForRootConfig(), target: target ?? "claude" };
  }
  const pluginFirstManifest = path.match(/(?:^|\/)plugins\/([^/]+)\/(?:claude|codex)\/\.(?:claude|codex)-plugin\/plugin\.json$/);
  if (pluginFirstManifest?.[1] !== undefined) {
    return { scope: `plugin:${pluginFirstManifest[1]}`, ...(target === undefined ? {} : { target }) };
  }
  const pluginManifest = path.match(/\/plugins\/([^/]+)\/\.(?:claude|codex)-plugin\/plugin\.json$/);
  if (pluginManifest?.[1] !== undefined) {
    return { scope: `plugin:${pluginManifest[1]}`, ...(target === undefined ? {} : { target }) };
  }
  const pluginFirstSkill = path.match(/(?:^|\/)plugins\/([^/]+)\/(?:claude|codex)\/skills\/([^/]+)\/SKILL\.md$/);
  if (pluginFirstSkill?.[1] !== undefined && pluginFirstSkill[2] !== undefined) {
    return { scope: selectorForPluginSkill(pluginFirstSkill[1], pluginFirstSkill[2]), ...(target === undefined ? {} : { target }) };
  }
  const pluginSkill = path.match(/\/plugins\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/);
  if (pluginSkill?.[1] !== undefined && pluginSkill[2] !== undefined) {
    return { scope: selectorForPluginSkill(pluginSkill[1], pluginSkill[2]), ...(target === undefined ? {} : { target }) };
  }
  const standaloneSkill = path.match(/\/skills\/([^/]+)\/SKILL\.md$/);
  if (standaloneSkill?.[1] !== undefined) {
    return { scope: selectorForStandaloneSkill(standaloneSkill[1]), ...(target === undefined ? {} : { target }) };
  }
  return undefined;
}

function targetForPath(graph: BuildGraph, path: string): TargetName | undefined {
  const pluginTarget = pluginTargetForOutputPath(graph, path);
  if (pluginTarget !== undefined) return pluginTarget;
  if (isInside(path, graph.root.outputs.skills.claude)) return "claude";
  if (isInside(path, graph.root.outputs.skills.codex)) return "codex";
  return undefined;
}

function extractVersion(path: string, content: Uint8Array, locus: Pick<ExpectedVersionLocus, "field" | "marketplacePluginName">): string | undefined {
  const field = locus.field;
  if (locus.marketplacePluginName !== undefined) {
    return extractMarketplacePluginVersion(content, locus.marketplacePluginName);
  }
  if (field === "metadata.version") return extractSkillVersion(path, content);
  if (field === "metadata.version" || field === "version") return extractJsonVersion(content, ["version"]);
  if (field === "metadata.version@marketplace") return extractJsonVersion(content, ["metadata", "version"]);
  return undefined;
}

function extractMarketplacePluginVersion(content: Uint8Array, name: string): string | undefined {
  let current: unknown;
  try {
    current = JSON.parse(new TextDecoder().decode(content)) as unknown;
  } catch {
    return undefined;
  }
  if (!isJsonRecord(current) || !Array.isArray(current.plugins)) return undefined;
  for (const plugin of current.plugins) {
    if (!isJsonRecord(plugin)) continue;
    if (plugin.name !== name) continue;
    const version = plugin.version;
    return typeof version === "string" && version.trim().length > 0 ? version.trim() : undefined;
  }
  return undefined;
}

function extractSkillVersion(path: string, content: Uint8Array): string | undefined {
  let frontmatter;
  try {
    frontmatter = parseMarkdown(new TextDecoder().decode(content), path).frontmatter;
  } catch {
    return undefined;
  }
  const metadata = frontmatter.metadata;
  if (!isJsonRecord(metadata)) return undefined;
  const version = metadata.version;
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : undefined;
}

function extractJsonVersion(content: Uint8Array, path: readonly string[]): string | undefined {
  let current: unknown;
  try {
    current = JSON.parse(new TextDecoder().decode(content)) as unknown;
  } catch {
    return undefined;
  }
  for (const segment of path) {
    if (!isJsonRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : undefined;
}

function versionFieldForPath(path: string): string {
  if (path.endsWith("/SKILL.md")) return "metadata.version";
  if (path.endsWith("/.claude-plugin/marketplace.json")) return "metadata.version@marketplace";
  return "version";
}

function versionLocus(
  expected: ExpectedVersionLocus,
  result: {
    readonly actualVersion?: string;
    readonly reason: string;
    readonly status: VersionDriftStatus;
  }
): VersionLocus {
  return {
    ...(result.actualVersion === undefined ? {} : { actualVersion: result.actualVersion }),
    authority: expected.authority,
    expectedVersion: expected.expectedVersion,
    field: expected.field,
    path: expected.path,
    reason: result.reason,
    scope: expected.scope,
    status: result.status,
    ...(expected.target === undefined ? {} : { target: expected.target }),
  };
}

function isVersionIssue(status: VersionDriftStatus): boolean {
  return status === "malformed" || status === "missing" || status === "stale-generated";
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
