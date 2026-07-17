import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import {
  adaptiveHookEventDefinitions,
  appendAdaptiveHookAttachment,
  appendAdaptiveHookAttachmentToMarkdown,
  appendAdaptiveHookAttachmentToYaml,
  planAdaptiveHookCompatibility,
} from "@skillset/core/internal/adaptive-hook-authoring";
import {
  loadBuildGraph,
  resolveAdaptiveHookScriptPath,
  validateAdaptiveHookScriptSource,
} from "@skillset/core/internal/resolver";
import { targetNames } from "@skillset/core/internal/targets";
import { compareStrings } from "@skillset/core/internal/path";
import {
  selectorForPluginConfig,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForStandaloneSkill,
} from "@skillset/core/internal/source-unit-selector";
import type {
  AdaptiveHookScope,
  BuildGraph,
  JsonRecord,
  SourceProjectAgent,
  SourceSkill,
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";
import {
  parseMarkdown,
  parseYamlRecord,
  stringifyJson,
} from "@skillset/core/internal/yaml";
import { validateAdaptiveHookUnitSource } from "@skillset/schema";

import type { NewSourcePlannedFile } from "./new-source";

export interface NewAdaptiveHookOptions {
  readonly attachment: string | undefined;
  readonly command: string | undefined;
  readonly container: string | undefined;
  readonly events: readonly string[] | undefined;
  readonly providers: readonly TargetName[] | undefined;
  readonly presets: readonly string[] | undefined;
  readonly script: string | undefined;
  readonly skillsetOptions: SkillsetOptions;
}

export interface NewAdaptiveHookAttachmentTarget {
  readonly description: string;
  readonly name: string;
  readonly scope: AdaptiveHookScope;
  readonly selector: string;
}

interface HookOwner {
  readonly content: string;
  readonly document: JsonRecord;
  readonly hookRoot: string;
  readonly ownerPath: string;
  readonly path: string;
  readonly render: (hook: string) => string;
  readonly scope: AdaptiveHookScope;
  readonly selector: string;
}

export async function planNewAdaptiveHook(
  rootPath: string,
  id: string,
  displayName: string,
  options: NewAdaptiveHookOptions
): Promise<readonly NewSourcePlannedFile[]> {
  if (options.attachment === undefined) {
    throw new Error("skillset: new hook requires --attach <source-unit>");
  }
  if (options.container !== undefined) {
    throw new Error("skillset: new hook uses --attach for placement; --in is not supported");
  }
  if (options.presets !== undefined && options.presets.length > 0) {
    throw new Error("skillset: new hook does not support --preset");
  }
  const events = uniqueRequired(options.events, "--event");
  const action = hookAction(options);
  const graph = await loadBuildGraph(rootPath, options.skillsetOptions);
  const owner = await resolveHookOwner(rootPath, graph, options.attachment);
  const eventCatalog = new Map(
    adaptiveHookEventDefinitions().map((event) => [event.id, event])
  );
  const invalidEvents = events.filter((event) => !eventCatalog.has(event));
  if (invalidEvents.length > 0) {
    throw new Error(
      `skillset: unknown adaptive hook event ${invalidEvents.join(", ")}; use skillset lookup hooks --events`
    );
  }
  const compatibility = planAdaptiveHookCompatibility({
    events: [...events],
    ...(options.providers === undefined ? {} : { providers: options.providers }),
    scope: owner.scope,
  });
  const requestedProviders = options.providers;
  if (
    requestedProviders !== undefined &&
    compatibility.providers.length !== requestedProviders.length
  ) {
    const reasons = compatibility.classifications
      .filter((item) => !compatibility.providers.includes(item.target))
      .flatMap((item) => item.reasons);
    throw new Error(
      `skillset: adaptive hook cannot attach to ${owner.selector} for the selected providers: ${[...new Set(reasons)].join("; ")}`
    );
  }
  if (compatibility.providers.length === 0) {
    throw new Error(
      `skillset: adaptive hook has no compatible provider projection for ${owner.selector}`
    );
  }
  const allProviders = targetNames();
  const hookDocument: JsonRecord = {
    description: displayName,
    events: [...events],
    name: id,
    ...(compatibility.providers.length === allProviders.length
      ? {}
      : { providers: [...compatibility.providers] }),
    run: action,
  };
  const diagnostics = validateAdaptiveHookUnitSource(hookDocument).diagnostics;
  if (diagnostics.length > 0) {
    throw new Error(
      `skillset: adaptive hook failed schema validation: ${diagnostics.map((item) => item.message).join("; ")}`
    );
  }
  const directory = options.script?.startsWith("./") === true;
  const hookPath = directory
    ? join(owner.hookRoot, id, "hook.json")
    : join(owner.hookRoot, `${id}.json`);
  if (options.script !== undefined) {
    const scriptPath = resolveAdaptiveHookScriptPath(
      rootPath,
      owner.ownerPath,
      hookPath,
      directory ? "directory-hook" : "flat",
      options.script
    );
    await validateAdaptiveHookScriptSource(
      rootPath,
      scriptPath,
      hookPath,
      options.script
    );
  }
  appendAdaptiveHookAttachment(owner.document, id);
  return [
    {
      content: stringifyJson(hookDocument),
      operation: "create",
      path: relative(rootPath, hookPath),
    },
    {
      content: owner.render(id),
      expectedContent: owner.content,
      operation: "update",
      path: relative(rootPath, owner.path),
    },
  ];
}

export async function listNewAdaptiveHookAttachmentTargets(
  rootPath: string,
  skillsetOptions: SkillsetOptions = {}
): Promise<readonly NewAdaptiveHookAttachmentTarget[]> {
  let graph: BuildGraph;
  try {
    graph = await loadBuildGraph(rootPath, skillsetOptions);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        "no source plugins, skills, rules, project agents, or provider source found"
      )
    ) {
      return [];
    }
    throw error;
  }
  const targets: NewAdaptiveHookAttachmentTarget[] = [];
  for (const plugin of graph.plugins) {
    targets.push({
      description: "Attach to this plugin and place the hook in its source",
      name: `Plugin: ${plugin.id}`,
      scope: { kind: "plugin", pluginId: plugin.id },
      selector: `plugin:${plugin.id}`,
    });
    for (const skill of plugin.skills) {
      targets.push({
        description: `Attach to skill ${skill.id} inside plugin ${plugin.id}`,
        name: `Plugin skill: ${plugin.id}/${skill.id}`,
        scope: { kind: "skill", pluginId: plugin.id, skillId: skill.id },
        selector: selectorForPluginSkill(plugin.id, skill.id),
      });
    }
  }
  for (const skill of graph.standaloneSkills) {
    targets.push({
      description: "Attach to this standalone skill",
      name: `Skill: ${skill.id}`,
      scope: { kind: "skill", skillId: skill.id },
      selector: selectorForStandaloneSkill(skill.id),
    });
  }
  for (const agent of graph.projectAgents) {
    targets.push({
      description: "Attach to this project agent",
      name: `Project agent: ${agent.outputName}`,
      scope: { agentId: agent.outputName, kind: "agent" },
      selector: selectorForProjectAgent(agent.outputName),
    });
  }
  return targets.sort((left, right) => compareStrings(left.selector, right.selector));
}

function uniqueRequired(
  values: readonly string[] | undefined,
  flag: string
): readonly string[] {
  if (values === undefined || values.length === 0) {
    throw new Error(`skillset: new hook requires ${flag}`);
  }
  const unique = [...new Set(values.map((value) => value.trim()))];
  if (unique.some((value) => value.length === 0)) {
    throw new Error(`skillset: ${flag} values must be non-empty`);
  }
  return unique;
}

function hookAction(options: NewAdaptiveHookOptions): JsonRecord {
  const command = options.command?.trim();
  const script = options.script?.trim();
  if ((command === undefined || command.length === 0) === (script === undefined || script.length === 0)) {
    throw new Error("skillset: new hook requires exactly one of --command or --script");
  }
  return command === undefined || command.length === 0
    ? { script: script ?? "" }
    : { command };
}

async function resolveHookOwner(
  rootPath: string,
  graph: BuildGraph,
  selector: string
): Promise<HookOwner> {
  for (const plugin of graph.plugins) {
    const pluginSelectors = [
      `plugin:${plugin.id}`,
      selectorForPluginConfig(plugin.id),
    ];
    if (pluginSelectors.includes(selector)) {
      const content = await readFile(plugin.configPath, "utf8");
      return {
        content,
        document: parseYamlRecord(content, plugin.configPath),
        hookRoot: join(plugin.path, "hooks"),
        ownerPath: plugin.path,
        path: plugin.configPath,
        render: (hook) => appendAdaptiveHookAttachmentToYaml(content, hook),
        scope: { kind: "plugin", pluginId: plugin.id },
        selector: `plugin:${plugin.id}`,
      };
    }
    for (const skill of plugin.skills) {
      const skillSelector = selectorForPluginSkill(plugin.id, skill.id);
      if (skillSelector === selector) {
        return markdownHookOwner(
          rootPath,
          skillSelector,
          skill,
          { kind: "skill", pluginId: plugin.id, skillId: skill.id },
          dirname(skill.sourcePath)
        );
      }
    }
  }
  for (const skill of graph.standaloneSkills) {
    const skillSelector = selectorForStandaloneSkill(skill.id);
    if (skillSelector === selector) {
      return markdownHookOwner(
        rootPath,
        skillSelector,
        skill,
        { kind: "skill", skillId: skill.id },
        dirname(skill.sourcePath)
      );
    }
  }
  for (const agent of graph.projectAgents) {
    const agentSelector = selectorForProjectAgent(agent.outputName);
    if (agentSelector === selector) {
      return markdownHookOwner(
        rootPath,
        agentSelector,
        agent,
        { agentId: agent.outputName, kind: "agent" },
        join(dirname(agent.sourcePath), basename(agent.sourcePath, ".md"))
      );
    }
  }
  throw new Error(
    `skillset: hook attachment source unit ${selector} was not found`
  );
}

async function markdownHookOwner(
  _rootPath: string,
  selector: string,
  source: SourceSkill | SourceProjectAgent,
  scope: AdaptiveHookScope,
  hookRoot: string
): Promise<HookOwner> {
  const content = await readFile(source.sourcePath, "utf8");
  const parts = parseMarkdown(content, source.sourcePath);
  return {
    content,
    document: parts.frontmatter,
    hookRoot: join(hookRoot, "hooks"),
    ownerPath: hookRoot,
    path: source.sourcePath,
    render: (hook) => appendAdaptiveHookAttachmentToMarkdown(content, hook),
    scope,
    selector,
  };
}
