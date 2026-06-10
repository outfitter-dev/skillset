import { relative } from 'node:path';

import { readRecord, readString } from './config';
import { compareStrings } from './path';
import { validateSemverRange } from './supports';
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SourcePlugin,
  SourcePluginDependency,
  TargetName,
} from './types';
import { pluginVersion } from './versioning';
import { isJsonRecord } from './yaml';

export function readPluginDependencies(
  value: JsonValue | undefined,
  label: string
): readonly SourcePluginDependency[] {
  if (value === undefined) {
    return [];
  }
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label}.dependencies to be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== 'plugins') {
      throw new Error(
        `skillset: unsupported ${label}.dependencies key ${key}; v1 supports plugins`
      );
    }
  }
  const { plugins } = value;
  if (plugins === undefined) {
    return [];
  }
  if (!Array.isArray(plugins)) {
    throw new TypeError(
      `skillset: expected ${label}.dependencies.plugins to be an array`
    );
  }
  return plugins.map((item) => readPluginDependency(item, label));
}

export function pluginDependencies(
  graph: BuildGraph,
  plugin: SourcePlugin
): readonly SourcePluginDependency[] {
  const dependencies: SourcePluginDependency[] = [...plugin.dependencies];
  for (const skill of plugin.skills) {
    dependencies.push(
      ...readPluginDependencies(
        skill.frontmatter.dependencies,
        relative(graph.rootPath, skill.sourcePath)
      )
    );
  }
  return dedupeDependencies(dependencies);
}

export function validatePluginDependencyGraph(
  plugins: readonly SourcePlugin[]
): void {
  const ids = new Set(plugins.map((plugin) => plugin.id));
  for (const plugin of plugins) {
    const dependencies = [
      ...plugin.dependencies,
      ...plugin.skills.flatMap((skill) =>
        readPluginDependencies(skill.frontmatter.dependencies, skill.sourcePath)
      ),
    ];
    for (const dependency of dependencies) {
      if (dependency.kind !== 'internal') {
        continue;
      }
      if (dependency.name === plugin.id) {
        throw new Error(
          `skillset: plugin ${plugin.id} must not depend on itself`
        );
      }
      if (!ids.has(dependency.name)) {
        throw new Error(
          `skillset: plugin ${plugin.id} depends on unknown plugin ${dependency.name}`
        );
      }
    }
  }
}

export function renderClaudePluginDependencies(
  graph: BuildGraph,
  plugin: SourcePlugin
): JsonRecord | undefined {
  const plugins = pluginDependencies(graph, plugin).map((dependency) =>
    dependencyManifestEntry(graph, dependency, true)
  );
  if (plugins.length === 0) {
    return undefined;
  }
  return { plugins };
}

export function pluginDependencySummaries(
  graph: BuildGraph,
  plugin: SourcePlugin
): readonly string[] {
  return pluginDependencies(graph, plugin)
    .map((dependency) => {
      const entry = dependencyManifestEntry(graph, dependency, false);
      const range = readString(entry, 'range');
      const marketplace = readString(entry, 'marketplace');
      return [
        readString(entry, 'name') ?? dependency.name,
        range === undefined ? undefined : `range ${range}`,
        marketplace === undefined ? undefined : `marketplace ${marketplace}`,
        dependency.kind,
      ]
        .filter((item): item is string => item !== undefined)
        .join(' ');
    })
    .toSorted(compareStrings);
}

export function pluginDependencyHashSummaries(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): readonly string[] {
  return pluginDependencies(graph, plugin)
    .map((dependency) =>
      JSON.stringify(
        dependencyManifestEntry(graph, dependency, target === 'claude')
      )
    )
    .toSorted(compareStrings);
}

export function renderCodexDependencyNotice(
  graph: BuildGraph,
  plugin: SourcePlugin
): string | undefined {
  const dependencies = pluginDependencySummaries(graph, plugin);
  if (dependencies.length === 0) {
    return undefined;
  }
  return [
    '<skillset_plugin_dependencies>',
    'This plugin requires the following Skillset plugin dependencies. Do not install or resolve them yourself. If one is unavailable, tell the user which dependency is missing and ask them to install or enable it through their Skillset or plugin marketplace workflow.',
    '',
    ...dependencies.map((dependency) => `- ${dependency}`),
    '</skillset_plugin_dependencies>',
  ].join('\n');
}

function readPluginDependency(
  value: JsonValue,
  label: string
): SourcePluginDependency {
  if (typeof value === 'string') {
    if (!value.startsWith('plugin:')) {
      throw new Error(
        `skillset: expected ${label}.dependencies.plugins string to use plugin:<id>`
      );
    }
    const name = value.slice('plugin:'.length).trim();
    if (name.length === 0) {
      throw new Error(
        `skillset: expected ${label}.dependencies.plugins string to include a plugin id`
      );
    }
    return {
      kind: 'internal',
      name,
      sourceLabel: label,
      unversioned: false,
    };
  }
  if (!isJsonRecord(value)) {
    throw new Error(
      `skillset: expected ${label}.dependencies.plugins entries to be strings or objects`
    );
  }
  for (const key of Object.keys(value)) {
    if (
      !['marketplace', 'name', 'plugin', 'range', 'unversioned'].includes(key)
    ) {
      throw new Error(
        `skillset: unsupported ${label}.dependencies.plugins entry key ${key}`
      );
    }
  }

  const plugin = readString(value, 'plugin');
  const name = readString(value, 'name');
  if (plugin !== undefined && name !== undefined) {
    throw new Error(
      `skillset: ${label}.dependencies.plugins entry must use plugin or name, not both`
    );
  }
  if (plugin !== undefined) {
    if (plugin.trim().length === 0) {
      throw new Error(
        `skillset: expected ${label}.dependencies.plugins entry plugin to include a plugin id`
      );
    }
    if (
      readString(value, 'range') !== undefined ||
      readString(value, 'marketplace') !== undefined ||
      value.unversioned !== undefined
    ) {
      throw new Error(
        `skillset: ${label}.dependencies.plugins internal entry ${plugin} must not include range, marketplace, or unversioned`
      );
    }
    return {
      kind: 'internal',
      name: plugin,
      sourceLabel: label,
      unversioned: false,
    };
  }
  if (name === undefined) {
    throw new Error(
      `skillset: expected ${label}.dependencies.plugins entry to include plugin or name`
    );
  }
  if (name.trim().length === 0) {
    throw new Error(
      `skillset: expected ${label}.dependencies.plugins entry name to include a plugin name`
    );
  }

  const range = readString(value, 'range');
  const unversioned = value.unversioned === true;
  if (range !== undefined && unversioned) {
    throw new Error(
      `skillset: external plugin dependency ${name} in ${label} must not combine range with unversioned: true`
    );
  }
  if (
    value.unversioned !== undefined &&
    typeof value.unversioned !== 'boolean'
  ) {
    throw new Error(
      `skillset: expected ${label}.dependencies.plugins entry ${name}.unversioned to be boolean`
    );
  }
  if (range === undefined && !unversioned) {
    throw new Error(
      `skillset: external plugin dependency ${name} in ${label} requires range or unversioned: true`
    );
  }
  if (range !== undefined) {
    validateSemverRange(range, `${label} dependency ${name}`);
  }
  const marketplace = readString(value, 'marketplace');
  return {
    kind: 'external',
    ...(marketplace === undefined ? {} : { marketplace }),
    name,
    ...(range === undefined ? {} : { range }),
    sourceLabel: label,
    unversioned,
  };
}

function dependencyManifestEntry(
  graph: BuildGraph,
  dependency: SourcePluginDependency,
  nativeClaudeName: boolean
): JsonRecord {
  if (dependency.kind === 'internal') {
    const plugin = graph.plugins.find((item) => item.id === dependency.name);
    const version =
      plugin === undefined ? undefined : pluginVersion(graph, plugin);
    return {
      name:
        nativeClaudeName && plugin !== undefined
          ? emittedClaudePluginName(plugin)
          : dependency.name,
      ...(version === undefined ? {} : { range: `=${version}` }),
      source: 'internal',
    };
  }
  return {
    name: dependency.name,
    ...(dependency.marketplace === undefined
      ? {}
      : { marketplace: dependency.marketplace }),
    ...(dependency.range === undefined
      ? { unversioned: true }
      : { range: dependency.range }),
  };
}

function emittedClaudePluginName(plugin: SourcePlugin): string {
  const portableManifest = readRecord(plugin.metadata, 'manifest') ?? {};
  const claudeManifest =
    readRecord(plugin.targets.claude.options, 'manifest') ?? {};
  return (
    readString(claudeManifest, 'name') ??
    readString(portableManifest, 'name') ??
    plugin.id
  );
}

function dedupeDependencies(
  dependencies: readonly SourcePluginDependency[]
): readonly SourcePluginDependency[] {
  const seen = new Map<string, SourcePluginDependency>();
  for (const dependency of dependencies) {
    const key = [
      dependency.kind,
      dependency.name,
      dependency.marketplace ?? '',
      dependency.range ?? '',
      dependency.unversioned ? 'unversioned' : '',
    ].join('\0');
    seen.set(key, dependency);
  }
  return [...seen.values()].toSorted((left, right) =>
    compareStrings(
      `${left.kind}:${left.name}:${left.range ?? ''}`,
      `${right.kind}:${right.name}:${right.range ?? ''}`
    )
  );
}
