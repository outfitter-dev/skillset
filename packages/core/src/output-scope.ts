import { pluginTargetForOutputPath } from "./plugin-output";
import {
  standardProjectionManagedRootScope,
  standardProjectionTopology,
} from "./standard-projections";
import { targetNames } from "./targets";
import type { BuildGraph, BuildScope, ProjectionOwner } from "./types";

/**
 * The build scope that owns a generated output path. Writes and render-result
 * diagnostics must both gate on this, so a scope never admits a file while
 * suppressing the diagnostics about it (or the reverse).
 */
export function scopeForPath(
  graph: BuildGraph,
  path: string,
  owner?: ProjectionOwner
): BuildScope {
  // A workspace-owned instruction can live beneath a package or skill root.
  if (owner !== undefined && "standardProfile" in owner &&
    owner.standardProfile === "agent-instructions") return "project";
  const standardDestination = standardProjectionTopology(
    graph.standardProjections,
    graph.plugins.map((plugin) => plugin.id)
  ).find((destination) =>
    isInsideOutputRoot(path, destination.path) ||
    (destination.lockRoot !== "." && isInsideOutputRoot(path, destination.lockRoot))
  );
  if (standardDestination !== undefined) return standardDestination.scope;
  if (
    pluginTargetForOutputPath(graph, path) !== undefined ||
    targetNames().some((target) => isInsideOutputRoot(path, graph.root.outputs.plugins[target]))
  ) {
    return "plugins";
  }
  if (
    targetNames().some((target) => isInsideOutputRoot(path, graph.root.outputs.skills[target]))
  ) {
    return "repo";
  }
  const historicalStandardScope = standardProjectionManagedRootScope(path);
  if (historicalStandardScope !== undefined) return historicalStandardScope;
  return "project";
}

export function isInsideOutputRoot(path: string, outputRoot: string): boolean {
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}
