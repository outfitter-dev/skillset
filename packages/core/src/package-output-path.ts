import { posix } from "node:path";

import type { PackageOutputConfig, TargetName } from "./types";

export function expandPackageOutputPath(path: string, name: string): string {
  if (path === ".") return ".";
  const expanded = path.includes("[name]")
    ? path.replace("[name]", name)
    : posix.join(path, name);
  return `${expanded.replace(/\/$/u, "")}/`;
}

export function plannedPackageOutputPath(
  config: PackageOutputConfig,
  target: TargetName,
  pluginId: string
): string {
  const targetConfig = config.targets[target];
  if (targetConfig.combine !== undefined) {
    throw new Error(
      `skillset: plugins.output.${target}.combine is parsed but unsupported until SET-568`
    );
  }
  if (targetConfig.name !== undefined) {
    throw new Error(
      `skillset: plugins.output.${target}.name is parsed but unsupported until SET-561`
    );
  }
  const configuredPath = targetConfig.path ?? config.path;
  const expanded = expandPackageOutputPath(configuredPath, pluginId);
  if (expanded === ".") {
    throw new Error(
      "skillset: plugins.output requests repository-root package placement, unsupported until SET-581"
    );
  }
  const current = expandPackageOutputPath("plugins/[name]", pluginId);
  if (expanded !== current) {
    throw new Error(
      `skillset: plugins.output plans ${expanded}; custom package placement is unsupported until SET-561`
    );
  }
  return expanded;
}
