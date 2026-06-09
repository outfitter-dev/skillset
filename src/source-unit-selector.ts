import { compareStrings } from "./path";

export type SourceUnitDisplayMode = "display" | "selector";

const TARGETS = new Set(["claude", "codex"]);

export function sourceUnitSelector(raw: string): string {
  return legacySourceUnitToSelector(raw) ?? raw;
}

export function sourceUnitLegacyId(raw: string): string {
  const selector = sourceUnitSelector(raw);
  if (selector === "config:root") return "root-config";
  if (selector.startsWith("skill:")) return `standalone-skill:${selector.slice("skill:".length)}`;
  if (selector.startsWith("agent:")) return `project-agent:${selector.slice("agent:".length)}`;
  if (selector.startsWith("instruction:")) return selector;
  if (selector.startsWith("plugin:")) return selector;

  const pluginNativeMatch = selector.match(/^plugin\.([^.]+)\.([^.]+)\.([^.]+):(.+)$/);
  if (pluginNativeMatch !== null) {
    const [, pluginId, target, , path] = pluginNativeMatch;
    if (pluginId === undefined || target === undefined || path === undefined || !TARGETS.has(target)) return selector;
    return `target-native-island:${target}:plugin:${pluginId}:${path}`;
  }

  const pluginMatch = selector.match(/^plugin\.([^.]+)\.([^.]+):(.+)$/);
  if (pluginMatch !== null) {
    const [, pluginId, surface, name] = pluginMatch;
    if (pluginId === undefined || surface === undefined || name === undefined) return selector;
    if (surface === "config") return `plugin-config:${pluginId}`;
    if (surface === "skill") return `plugin-skill:${pluginId}/${name}`;
    if (surface === "feature") return `plugin-feature:${pluginId}/${name}`;
    if (surface === "companion") return `plugin-companion:${pluginId}/${name}`;
  }

  const nativeMatch = selector.match(/^([^.]+)\.([^.]+):(.+)$/);
  if (nativeMatch !== null) {
    const [, target, , path] = nativeMatch;
    if (target === undefined || path === undefined || !TARGETS.has(target)) return selector;
    return `target-native-island:${target}:project:${path}`;
  }

  return selector;
}

export function sourceUnitDisplay(raw: string, mode: SourceUnitDisplayMode = "display"): string {
  const selector = sourceUnitSelector(raw);
  if (mode === "selector") return selector;

  if (selector === "config:root") return "config: root";
  if (selector.startsWith("skill:")) return `skill: ${selector.slice("skill:".length)}`;
  if (selector.startsWith("instruction:")) return `instruction: ${selector.slice("instruction:".length)}`;
  if (selector.startsWith("agent:")) return `agent: ${selector.slice("agent:".length)}`;
  if (selector.startsWith("plugin:")) return `plugin: ${selector.slice("plugin:".length)}`;

  const pluginNativeMatch = selector.match(/^plugin\.([^.]+)\.([^.]+)\.([^.]+):(.+)$/);
  if (pluginNativeMatch !== null) {
    const [, pluginId, target, surface, name] = pluginNativeMatch;
    if (pluginId !== undefined && target !== undefined && surface !== undefined && name !== undefined && TARGETS.has(target)) {
      return `${target}.${surface}(plugin:${pluginId}): ${name}`;
    }
  }

  const pluginMatch = selector.match(/^plugin\.([^.]+)\.([^.]+):(.+)$/);
  if (pluginMatch !== null) {
    const [, pluginId, surface, name] = pluginMatch;
    if (pluginId !== undefined && surface !== undefined && name !== undefined) {
      return `${surface}(plugin:${pluginId}): ${name}`;
    }
  }

  const nativeMatch = selector.match(/^([^.]+)\.([^.]+):(.+)$/);
  if (nativeMatch !== null) {
    const [, target, surface, name] = nativeMatch;
    if (target !== undefined && surface !== undefined && name !== undefined && TARGETS.has(target)) {
      return `${target}.${surface}: ${name}`;
    }
  }

  return selector;
}

export function sourceUnitDisplays(scopes: readonly string[], mode: SourceUnitDisplayMode = "display"): string {
  return scopes.map((scope) => sourceUnitDisplay(scope, mode)).sort(compareStrings).join(", ");
}

export function pluginScopeFromSourceUnit(raw: string): string | undefined {
  const selector = sourceUnitSelector(raw);
  if (selector.startsWith("plugin:")) return selector;
  const pluginMatch = selector.match(/^plugin\.([^.]+)\./);
  return pluginMatch?.[1] === undefined ? undefined : `plugin:${pluginMatch[1]}`;
}

export function pluginIdForSelector(raw: string): string | undefined {
  const selector = sourceUnitSelector(raw);
  if (selector.startsWith("plugin:")) return selector.slice("plugin:".length);
  return selector.match(/^plugin\.([^.]+)\./)?.[1];
}

export function isPluginOwnedSelector(raw: string, pluginId: string): boolean {
  const selector = sourceUnitSelector(raw);
  return selector === `plugin:${pluginId}` || selector.startsWith(`plugin.${pluginId}.`);
}

export function selectorForRootConfig(): string {
  return "config:root";
}

export function selectorForStandaloneSkill(skillId: string): string {
  return `skill:${skillId}`;
}

export function selectorForPluginConfig(pluginId: string): string {
  return `plugin.${pluginId}.config:root`;
}

export function selectorForPluginSkill(pluginId: string, skillId: string): string {
  return `plugin.${pluginId}.skill:${skillId}`;
}

export function selectorForPluginFeature(pluginId: string, featureKey: string): string {
  return `plugin.${pluginId}.feature:${featureKey}`;
}

export function selectorForPluginCompanion(pluginId: string, companionPath: string): string {
  return `plugin.${pluginId}.companion:${companionPath}`;
}

export function selectorForInstruction(ruleId: string): string {
  return `instruction:${ruleId}`;
}

export function selectorForProjectAgent(agentName: string): string {
  return `agent:${agentName}`;
}

export function selectorForTargetNativeIsland(target: string, owner: "project" | `plugin:${string}`, relativePath: string): string {
  const surface = targetNativeSurface(relativePath);
  if (owner === "project") return `${target}.${surface}:${relativePath}`;
  return `${owner.replace(":", ".")}.${target}.${surface}:${relativePath}`;
}

export function targetNativeSurface(relativePath: string): string {
  if (relativePath === ".app.json") return "app";
  if (relativePath === ".mcp.json") return "mcp";
  if (relativePath === ".lsp.json") return "lsp";
  if (relativePath === "hooks.json" || relativePath.startsWith("hooks/")) return "hooks";
  const first = relativePath.split("/")[0] ?? "";
  if (first.length === 0) return "native";
  return first.replace(/[^A-Za-z0-9-]/g, "") || "native";
}

function legacySourceUnitToSelector(raw: string): string | undefined {
  if (raw === "root-config") return selectorForRootConfig();
  if (raw.startsWith("standalone-skill:")) return selectorForStandaloneSkill(raw.slice("standalone-skill:".length));
  if (raw.startsWith("project-agent:")) return selectorForProjectAgent(raw.slice("project-agent:".length));
  if (raw.startsWith("instruction:")) return raw;
  if (raw.startsWith("plugin-config:")) return selectorForPluginConfig(raw.slice("plugin-config:".length));
  if (raw.startsWith("plugin-skill:")) {
    const [pluginId, skillId] = raw.slice("plugin-skill:".length).split("/");
    if (pluginId !== undefined && skillId !== undefined) return selectorForPluginSkill(pluginId, skillId);
  }
  if (raw.startsWith("plugin-feature:")) {
    const [pluginId, featureKey] = raw.slice("plugin-feature:".length).split("/");
    if (pluginId !== undefined && featureKey !== undefined) return selectorForPluginFeature(pluginId, featureKey);
  }
  if (raw.startsWith("plugin-companion:")) {
    const [pluginId, ...pathParts] = raw.slice("plugin-companion:".length).split("/");
    const companionPath = pathParts.join("/");
    if (pluginId !== undefined && companionPath.length > 0) return selectorForPluginCompanion(pluginId, companionPath);
  }
  if (raw.startsWith("target-native-island:")) {
    const parts = raw.slice("target-native-island:".length).split(":");
    const [target, ownerKind, ownerIdOrPath, ...pathParts] = parts;
    if (target === undefined || ownerKind === undefined || ownerIdOrPath === undefined) return undefined;
    if (ownerKind === "project") return selectorForTargetNativeIsland(target, "project", [ownerIdOrPath, ...pathParts].join(":"));
    if (ownerKind === "plugin") {
      const [relativePath] = [pathParts.join(":")];
      if (relativePath.length > 0) return selectorForTargetNativeIsland(target, `plugin:${ownerIdOrPath}`, relativePath);
    }
  }
  return undefined;
}
