import { compareStrings } from './path';

export type SourceUnitDisplayMode = 'display' | 'selector';

const TARGETS = new Set(['claude', 'codex']);

export function sourceUnitSelector(raw: string): string {
  return raw;
}

export function sourceUnitDisplay(
  raw: string,
  mode: SourceUnitDisplayMode = 'display'
): string {
  const selector = sourceUnitSelector(raw);
  if (mode === 'selector') {
    return selector;
  }

  if (selector === 'config:root') {
    return 'config: root';
  }
  if (selector.startsWith('skill:')) {
    return `skill: ${selector.slice('skill:'.length)}`;
  }
  if (selector.startsWith('instruction:')) {
    return `instruction: ${selector.slice('instruction:'.length)}`;
  }
  if (selector.startsWith('agent:')) {
    return `agent: ${selector.slice('agent:'.length)}`;
  }
  if (selector.startsWith('plugin:')) {
    return `plugin: ${selector.slice('plugin:'.length)}`;
  }

  const pluginNativeMatch = selector.match(
    /^plugin\.([^.]+)\.([^.]+)\.([^.]+):(.+)$/
  );
  if (pluginNativeMatch !== null) {
    const [, pluginId, target, surface, name] = pluginNativeMatch;
    if (
      pluginId !== undefined &&
      target !== undefined &&
      surface !== undefined &&
      name !== undefined &&
      TARGETS.has(target)
    ) {
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
    if (
      target !== undefined &&
      surface !== undefined &&
      name !== undefined &&
      TARGETS.has(target)
    ) {
      return `${target}.${surface}: ${name}`;
    }
  }

  return selector;
}

export function sourceUnitDisplays(
  scopes: readonly string[],
  mode: SourceUnitDisplayMode = 'display'
): string {
  return scopes
    .map((scope) => sourceUnitDisplay(scope, mode))
    .toSorted(compareStrings)
    .join(', ');
}

export function pluginScopeFromSourceUnit(raw: string): string | undefined {
  const selector = sourceUnitSelector(raw);
  if (selector.startsWith('plugin:')) {
    return selector;
  }
  const pluginMatch = selector.match(/^plugin\.([^.]+)\./);
  return pluginMatch?.[1] === undefined
    ? undefined
    : `plugin:${pluginMatch[1]}`;
}

export function pluginIdForSelector(raw: string): string | undefined {
  const selector = sourceUnitSelector(raw);
  if (selector.startsWith('plugin:')) {
    return selector.slice('plugin:'.length);
  }
  return selector.match(/^plugin\.([^.]+)\./)?.[1];
}

export function isPluginOwnedSelector(raw: string, pluginId: string): boolean {
  const selector = sourceUnitSelector(raw);
  return (
    selector === `plugin:${pluginId}` ||
    selector.startsWith(`plugin.${pluginId}.`)
  );
}

export function selectorForRootConfig(): string {
  return 'config:root';
}

export function selectorForStandaloneSkill(skillId: string): string {
  return `skill:${skillId}`;
}

export function selectorForPluginConfig(pluginId: string): string {
  return `plugin.${pluginId}.config:root`;
}

export function selectorForPluginSkill(
  pluginId: string,
  skillId: string
): string {
  return `plugin.${pluginId}.skill:${skillId}`;
}

export function selectorForPluginFeature(
  pluginId: string,
  featureKey: string
): string {
  return `plugin.${pluginId}.feature:${featureKey}`;
}

export function selectorForPluginCompanion(
  pluginId: string,
  companionPath: string
): string {
  return `plugin.${pluginId}.companion:${companionPath}`;
}

export function selectorForInstruction(ruleId: string): string {
  return `instruction:${ruleId}`;
}

export function selectorForProjectAgent(agentName: string): string {
  return `agent:${agentName}`;
}

export function selectorForTargetNativeIsland(
  target: string,
  owner: 'project' | `plugin:${string}`,
  relativePath: string
): string {
  const surface = targetNativeSurface(relativePath);
  if (owner === 'project') {
    return `${target}.${surface}:${relativePath}`;
  }
  return `${owner.replace(':', '.')}.${target}.${surface}:${relativePath}`;
}

export function targetNativeSurface(relativePath: string): string {
  if (relativePath === '.app.json') {
    return 'app';
  }
  if (relativePath === '.mcp.json') {
    return 'mcp';
  }
  if (relativePath === '.lsp.json') {
    return 'lsp';
  }
  if (relativePath === 'hooks.json' || relativePath.startsWith('hooks/')) {
    return 'hooks';
  }
  const first = relativePath.split('/')[0] ?? '';
  if (first.length === 0) {
    return 'native';
  }
  return first.replaceAll(/[^A-Za-z0-9-]/g, '') || 'native';
}
