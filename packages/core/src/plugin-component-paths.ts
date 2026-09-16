import {
  getProviderDestinationFormatSnapshot,
  type ProviderDestinationFormatJsonValue,
  type ProviderDestinationFormatSnapshotId,
} from "@skillset/registry";

import type { TargetName } from "./types";

const PLUGIN_SNAPSHOT_IDS = {
  claude: "claude-plugin",
  codex: "codex-plugin",
  cursor: "cursor-plugin",
} as const satisfies Readonly<
  Record<TargetName, ProviderDestinationFormatSnapshotId>
>;

export interface PluginComponent {
  readonly kind: string;
  readonly manifestField?: string;
  readonly path: string;
}

export function pluginComponents(
  target: TargetName
): readonly PluginComponent[] {
  const snapshotId = PLUGIN_SNAPSHOT_IDS[target];
  const snapshot = getProviderDestinationFormatSnapshot(snapshotId);
  if (snapshot === undefined || !isRecord(snapshot.format)) {
    throw new Error(
      `skillset: provider snapshot ${snapshotId} has no plugin format`
    );
  }
  const rawComponents = snapshot.format.components;
  if (!Array.isArray(rawComponents)) {
    throw new Error(
      `skillset: provider snapshot ${snapshotId} has no plugin component table`
    );
  }

  return rawComponents.map((rawComponent, index) => {
    if (!isRecord(rawComponent)) {
      throw new Error(
        `skillset: provider snapshot ${snapshotId} plugin component ${index} must be an object`
      );
    }
    const kind = rawComponent.kind;
    const defaultPath = rawComponent.defaultPath;
    const manifestField = rawComponent.manifestField;
    if (typeof kind !== "string" || typeof defaultPath !== "string") {
      throw new Error(
        `skillset: provider snapshot ${snapshotId} plugin component ${index} must declare kind and defaultPath`
      );
    }
    if (manifestField !== null && typeof manifestField !== "string") {
      throw new Error(
        `skillset: provider snapshot ${snapshotId} plugin component ${kind} has an invalid manifestField`
      );
    }
    return {
      kind,
      ...(typeof manifestField === "string" ? { manifestField } : {}),
      path: `./${defaultPath}`,
    };
  });
}

export function pluginComponentPath(target: TargetName, kind: string): string {
  return pluginComponent(target, kind).path;
}

export function pluginComponentManifestField(
  target: TargetName,
  kind: string
): string | undefined {
  return pluginComponent(target, kind).manifestField;
}

function pluginComponent(target: TargetName, kind: string): PluginComponent {
  const component = pluginComponents(target).find(
    (candidate) => candidate.kind === kind
  );
  if (component !== undefined) return component;
  throw new Error(
    `skillset: provider snapshot ${PLUGIN_SNAPSHOT_IDS[target]} has no plugin component ${kind}`
  );
}

function isRecord(
  value: ProviderDestinationFormatJsonValue | undefined
): value is Readonly<Record<string, ProviderDestinationFormatJsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
