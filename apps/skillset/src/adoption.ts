import { collectSourceInventory } from "./change-status";
import { readString } from "@skillset/core/internal/config";
import { compareStrings } from "@skillset/core/internal/path";
import { readReleaseState, writeReleaseState } from "@skillset/core/internal/release-state";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import {
  pluginIdForSelector,
  selectorForRootConfig,
  sourceUnitSelector,
} from "@skillset/core/internal/source-unit-selector";
import type { BuildGraph, ReleaseScopeState, ReleaseState, SkillsetOptions, SourcePlugin } from "@skillset/core/internal/types";
import { DEFAULT_VERSION } from "@skillset/core/internal/versioning";

export type ReleaseBaselineStatus = "create" | "exists";

export interface ReleaseBaselineEntry {
  readonly scope: string;
  readonly sourceHash: string;
  readonly status: ReleaseBaselineStatus;
  readonly version: string;
}

export interface ReleaseBaselineConflict {
  readonly existingVersion?: string;
  readonly scope: string;
  readonly sourceVersion: string;
}

export interface ReleaseBaselineReport {
  readonly conflicts: readonly ReleaseBaselineConflict[];
  readonly entries: readonly ReleaseBaselineEntry[];
  readonly path?: string;
  readonly skippedReason?: string;
  readonly write: boolean;
}

export interface SeedReleaseBaselinesOptions {
  readonly includeScope?: (scope: string) => boolean;
  readonly scopes?: readonly string[];
  readonly write?: boolean;
}

const NO_SOURCE_MESSAGE = "skillset: no source plugins, skills, rules, project agents, or provider source found";

export async function seedReleaseBaselines(
  rootPath: string,
  options: SkillsetOptions = {},
  seedOptions: SeedReleaseBaselinesOptions = {}
): Promise<ReleaseBaselineReport> {
  let graph: BuildGraph;
  try {
    graph = await loadBuildGraph(rootPath, options);
  } catch (error) {
    if (isErrno(error, "ENOENT") && !(await workspaceMarkerExists(rootPath, options))) {
      return {
        conflicts: [],
        entries: [],
        skippedReason: "skillset workspace not found",
        write: seedOptions.write === true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(NO_SOURCE_MESSAGE)) {
      return {
        conflicts: [],
        entries: [],
        skippedReason: "no source units to adopt",
        write: seedOptions.write === true,
      };
    }
    throw error;
  }

  const resolvedOptions = { ...options, sourceDir: graph.sourceDir };
  const inventory = await collectSourceInventory(rootPath, resolvedOptions);
  const state = await readReleaseState(rootPath, resolvedOptions);
  const scopeFilter = seedOptions.scopes === undefined
    ? undefined
    : new Set(seedOptions.scopes.map(sourceUnitSelector));
  const entries: ReleaseBaselineEntry[] = [];
  const conflicts: ReleaseBaselineConflict[] = [];
  const scopes: Record<string, ReleaseScopeState> = { ...state.scopes };
  const updatedAt = new Date().toISOString();

  for (const unit of inventory.units) {
    const scope = sourceUnitSelector(unit.id);
    if (scopeFilter !== undefined && !scopeFilter.has(scope)) continue;
    if (seedOptions.includeScope !== undefined && !seedOptions.includeScope(scope)) continue;
    const version = sourceVersionForScope(graph, scope);
    const existing = state.scopes[scope];
    if (existing?.removed === true) {
      conflicts.push({ existingVersion: existing.version, scope, sourceVersion: version });
      continue;
    }
    if (existing?.sourceHash !== undefined) {
      entries.push({
        scope,
        sourceHash: existing.sourceHash,
        status: "exists",
        version: existing.version,
      });
      continue;
    }
    if (existing !== undefined && existing.version !== version) {
      conflicts.push({ existingVersion: existing.version, scope, sourceVersion: version });
      continue;
    }

    entries.push({
      scope,
      sourceHash: unit.hash,
      status: "create",
      version,
    });

    if (seedOptions.write === true) {
      scopes[scope] = {
        sourceHash: unit.hash,
        updatedAt,
        version,
      };
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      "skillset: release baseline conflicts with existing release state\n" +
        conflicts
          .map((conflict) =>
            `  ${conflict.scope}: source version ${conflict.sourceVersion}, release state ${conflict.existingVersion ?? "removed"}`
          )
          .join("\n")
    );
  }

  let path: string | undefined;
  if (seedOptions.write === true && entries.some((entry) => entry.status === "create")) {
    path = await writeReleaseState(rootPath, { scopes }, resolvedOptions);
  }

  return {
    conflicts,
    entries: entries.sort((left, right) => compareStrings(left.scope, right.scope)),
    ...(path === undefined ? {} : { path }),
    write: seedOptions.write === true,
  };
}

export function sourceVersionForScope(graph: BuildGraph, rawScope: string): string {
  const selector = sourceUnitSelector(rawScope);
  if (selector === selectorForRootConfig()) return sourceRootVersion(graph);
  if (selector.startsWith("skill:")) {
    const skill = graph.standaloneSkills.find((item) => item.id === selector.slice("skill:".length));
    if (skill !== undefined) return readString(skill.frontmatter, "version") ?? sourceRootVersion(graph);
  }

  const pluginSkill = selector.match(/^plugin\.([^.]+)\.skill:(.+)$/);
  if (pluginSkill !== null) {
    const [, pluginId, skillId] = pluginSkill;
    const plugin = pluginId === undefined ? undefined : graph.plugins.find((item) => item.id === pluginId);
    const skill = plugin?.skills.find((item) => item.id === skillId);
    if (plugin !== undefined && skill !== undefined) {
      return readString(skill.frontmatter, "version") ?? sourcePluginVersion(graph, plugin);
    }
  }

  const pluginId = pluginIdForSelector(selector);
  if (pluginId !== undefined) {
    const plugin = graph.plugins.find((item) => item.id === pluginId);
    if (plugin !== undefined) return sourcePluginVersion(graph, plugin);
  }

  return sourceRootVersion(graph);
}

function sourceRootVersion(graph: BuildGraph): string {
  return readString(graph.root.metadata, "version") ?? DEFAULT_VERSION;
}

function sourcePluginVersion(graph: BuildGraph, plugin: SourcePlugin): string {
  return readString(plugin.metadata, "version") ?? sourceRootVersion(graph);
}

async function workspaceMarkerExists(rootPath: string, options: SkillsetOptions): Promise<boolean> {
  if (options.sourceDir !== undefined && options.sourceDir !== ".skillset") {
    return false;
  }
  return Bun.file(`${rootPath}/skillset.yaml`).exists();
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
