import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  resolveAdaptiveHookAttachmentsForTarget,
  type ResolvedAdaptiveHookAttachment,
} from "./adaptive-hook-attachments";
import type {
  EffectiveAdaptiveHookDefinition,
  EffectiveAdaptiveHookJsonRecord,
  EffectiveAdaptiveHookJsonValue,
} from "./adaptive-hook-effective";
import {
  adaptiveHookUnsupportedRenderReason,
  type AdaptiveHookRenderSurface,
} from "./adaptive-hook-render-support";
import { readRecord, readString, readStringArray } from "./config";
import { nativeHookEventName } from "./hook-capabilities";
import { validateHookDefinition } from "./hooks";
import { compareStrings } from "./path";
import { exists, textFile } from "./render-support";
import { renderValidatedJson } from "./structured-output";
import { targetDescriptor } from "./targets";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  RenderedFile,
  SourcePlugin,
  SourceSkill,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

function targetLabel(target: TargetName): string {
  return targetDescriptor(target).displayLabel;
}

export async function renderAdaptivePluginHookFiles(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string
): Promise<readonly RenderedFile[]> {
  const resolved = adaptivePluginHookAttachments(graph, plugin, target);
  if (resolved.length === 0) return [];
  const nativeSource = join(plugin.path, "hooks", "hooks.json");
  if (await exists(nativeSource)) {
    throw new Error(
      `skillset: plugin ${plugin.id} cannot combine adaptive hook attachments with native hooks/hooks.json for ${target}; choose one hook source model`
    );
  }

  const hooks: Record<string, JsonValue[]> = {};
  const scriptFiles = new Map<string, RenderedFile>();
  for (const item of resolved) {
    const event = nativeHookEventName(target, item.event);
    const eventGroups = hooks[event] ?? [];
    eventGroups.push(
      renderAdaptiveHookGroup(
        graph,
        plugin,
        target,
        item,
        basePath,
        scriptFiles
      )
    );
    hooks[event] = eventGroups;
  }

  const normalized = { hooks };
  validateHookDefinition(normalized, {
    sourcePath: `${plugin.id} adaptive hooks -> ${join(basePath, "hooks", "hooks.json")}`,
    target,
  });

  return [
    textFile(
      join(basePath, "hooks", "hooks.json"),
      renderValidatedJson(normalized, `${plugin.id} ${target} adaptive hooks`),
      relative(graph.rootPath, plugin.configPath)
    ),
    ...[...scriptFiles.values()].sort((left, right) =>
      compareStrings(left.path, right.path)
    ),
  ];
}

function renderAdaptiveHookGroup(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  item: ResolvedAdaptiveHookAttachment,
  basePath: string,
  scriptFiles: Map<string, RenderedFile>
): JsonRecord {
  validateSupportedAdaptiveHookRenderFields(item, target);
  const effective = effectiveAdaptiveHookDefinition(item, target);
  const matcher =
    item.attachment.match ??
    materializeEffectiveAdaptiveHookValue(effective.match);
  const statusMessage =
    item.attachment.status ?? readString(item.definition.frontmatter, "status");
  const group: JsonRecord = {
    ...(matcher === undefined ? {} : { matcher }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
    hooks: [
      {
        command: adaptiveHookCommand(
          graph,
          plugin,
          target,
          item,
          basePath,
          scriptFiles
        ),
        type: "command",
      },
    ],
  };
  return group;
}

function validateSupportedAdaptiveHookRenderFields(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): void {
  const reason = adaptiveHookUnsupportedRenderReason(item, target, "plugin");
  if (reason !== undefined) {
    throw new Error(`skillset: ${reason}`);
  }
}

function adaptiveHookCommand(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  item: ResolvedAdaptiveHookAttachment,
  basePath: string,
  scriptFiles: Map<string, RenderedFile>
): string {
  const run = materializeEffectiveAdaptiveHookRecord(
    effectiveAdaptiveHookDefinition(item, target).run
  );
  const command = readString(run, "command");
  if (command !== undefined)
    return withAdaptiveHookContextCommand(
      withAdaptiveHookRunEnv(command, item, target),
      item,
      target
    );

  const script = readString(run, "script");
  if (script === undefined) {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} must define run.command or run.script`
    );
  }
  const reference = item.definition.scriptReferences.find(
    (candidate) => candidate.reference === script
  );
  if (reference === undefined) {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} has unresolved run.script ${script}`
    );
  }
  const relativeScriptPath = relative(
    plugin.path,
    reference.sourcePath
  ).replaceAll("\\", "/");
  if (relativeScriptPath.startsWith("../") || relativeScriptPath === "..") {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} script must stay inside plugin ${plugin.id}`
    );
  }
  const outputPath = join(basePath, relativeScriptPath);
  if (!scriptFiles.has(outputPath)) {
    scriptFiles.set(outputPath, {
      content: readFileSync(reference.sourcePath),
      path: outputPath,
      sourcePath: relative(graph.rootPath, reference.sourcePath),
    });
  }
  const pluginRoot =
    target === "claude" ? "$CLAUDE_PLUGIN_ROOT" : "$PLUGIN_ROOT";
  return withAdaptiveHookContextCommand(
    withAdaptiveHookRunEnv(`${pluginRoot}/${relativeScriptPath}`, item, target),
    item,
    target
  );
}

export function hasAdaptivePluginHookOutput(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): boolean {
  return adaptivePluginHookAttachments(graph, plugin, target).length > 0;
}

function adaptivePluginHookAttachments(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): readonly ResolvedAdaptiveHookAttachment[] {
  return resolveAdaptiveHookAttachmentsForTarget(
    graph.adaptiveHooks,
    graph.hookAttachments,
    target
  ).resolved.filter(
    (item) =>
      item.attachment.scope.kind === "plugin" &&
      item.attachment.scope.pluginId === plugin.id &&
      supportsAdaptiveHookTarget(item, target, "plugin")
  );
}

function supportsAdaptiveHookTarget(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  surface: AdaptiveHookRenderSurface
): boolean {
  return (
    providerListAllows(item.definition.providers, target) &&
    providerListAllows(item.attachment.providers, target) &&
    adaptiveHookUnsupportedRenderReason(item, target, surface) === undefined
  );
}

function providerListAllows(
  providers: readonly TargetName[] | undefined,
  target: TargetName
): boolean {
  return providers === undefined || providers.includes(target);
}

export function hasAdaptivePluginHookSources(plugin: SourcePlugin): boolean {
  return plugin.adaptiveHooks.length > 0 || plugin.hookAttachments.length > 0;
}

export function renderAdaptiveFrontmatterHooks(
  graph: BuildGraph,
  scope: ResolvedAdaptiveHookAttachment["attachment"]["scope"],
  target: TargetName,
  sourceLabel: string
): JsonRecord | undefined {
  const resolved = adaptiveHookAttachmentsForScope(graph, scope, target);
  if (resolved.length === 0) return undefined;

  const hooks: Record<string, JsonValue[]> = {};
  for (const item of resolved) {
    const event = nativeHookEventName(target, item.event);
    const eventGroups = hooks[event] ?? [];
    eventGroups.push(renderAdaptiveFrontmatterHookGroup(item, target));
    hooks[event] = eventGroups;
  }

  validateHookDefinition(
    { hooks },
    { sourcePath: `${sourceLabel} adaptive hooks`, target }
  );
  return hooks;
}

function renderAdaptiveFrontmatterHookGroup(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): JsonRecord {
  validateSupportedAdaptiveFrontmatterHookFields(item, target);
  const effective = effectiveAdaptiveHookDefinition(item, target);
  const matcher =
    item.attachment.match ??
    materializeEffectiveAdaptiveHookValue(effective.match);
  const statusMessage =
    item.attachment.status ?? readString(item.definition.frontmatter, "status");
  return {
    ...(matcher === undefined ? {} : { matcher }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
    hooks: [
      {
        command: adaptiveFrontmatterHookCommand(item),
        type: "command",
      },
    ],
  };
}

function validateSupportedAdaptiveFrontmatterHookFields(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): void {
  const reason = adaptiveHookUnsupportedRenderReason(
    item,
    target,
    "frontmatter"
  );
  if (reason !== undefined) {
    throw new Error(`skillset: ${reason}`);
  }
}

function adaptiveFrontmatterHookCommand(
  item: ResolvedAdaptiveHookAttachment
): string {
  const run = materializeEffectiveAdaptiveHookRecord(
    effectiveAdaptiveHookDefinition(item, "claude").run
  );
  const command = readString(run, "command");
  if (command === undefined) {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} must define run.command for frontmatter hook rendering`
    );
  }
  return withAdaptiveHookContextCommand(command, item, "claude");
}

function effectiveAdaptiveHookDefinition(
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): EffectiveAdaptiveHookDefinition {
  const effective = item.effectiveDefinition;
  if (effective?.target !== target) {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} is missing its ${target} effective definition`
    );
  }
  return effective;
}

function materializeEffectiveAdaptiveHookValue(
  value: EffectiveAdaptiveHookJsonValue | undefined
): JsonValue | undefined {
  // Core freezes effective definitions; rendering emits an independent JSON value
  // through helpers whose legacy record types are mutable.
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as JsonValue);
}

function materializeEffectiveAdaptiveHookRecord(
  value: EffectiveAdaptiveHookJsonRecord
): JsonRecord {
  return materializeEffectiveAdaptiveHookValue(value) as JsonRecord;
}

function withAdaptiveHookRunEnv(
  command: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string {
  const run = materializeEffectiveAdaptiveHookRecord(
    effectiveAdaptiveHookDefinition(item, target).run
  );
  const env = readRecord(run, "env");
  if (env === undefined) return command;
  const assignments = Object.entries(env)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(
          `skillset: adaptive hook ${item.definition.name} run.env key ${key} is not a valid shell environment variable name`
        );
      }
      if (typeof value !== "string") {
        throw new Error(
          `skillset: adaptive hook ${item.definition.name} run.env key ${key} must be a string`
        );
      }
      return `${key}=${shellLiteral(value)}`;
    });
  if (assignments.length === 0) return command;
  return `env ${assignments.join(" ")} sh -c ${shellLiteral(command)}`;
}

function withAdaptiveHookContextCommand(
  command: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string {
  const context = effectiveAdaptiveHookDefinition(item, target).context;
  if (context === undefined) return command;
  const materializedContext = materializeEffectiveAdaptiveHookRecord(context);
  const strategy = readString(materializedContext, "strategy") ?? "none";
  if (strategy === "none") return command;
  if (strategy === "toolkit") {
    return withAdaptiveHookToolkitContextCommand(
      command,
      item,
      target,
      readStringArray(materializedContext, "env") ?? []
    );
  }
  if (strategy !== "inline") {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} context.strategy ${strategy} is not supported for rendering yet`
    );
  }
  const fields = readStringArray(materializedContext, "env") ?? [];
  if (fields.length === 0) {
    throw new Error(
      `skillset: adaptive hook ${item.definition.name} context.env must list fields for inline context rendering`
    );
  }
  const assignments = fields.map((field) =>
    adaptiveHookContextAssignment(field, item, target)
  );
  return `${assignments.join(" ")} ${command}`;
}

function withAdaptiveHookToolkitContextCommand(
  command: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName,
  fields: readonly string[]
): string {
  const event = shellLiteral(item.event);
  const provider = `SKILLSET_PROVIDER=${target}`;
  const hookEvent = `SKILLSET_HOOK_EVENT=${event}`;
  const fieldArgs =
    fields.length === 0 ? "" : ` --fields ${shellLiteral(fields.join(","))}`;
  const helper = `${provider} ${hookEvent} skillset-toolkit runtime context --event ${event} --format env${fieldArgs}`;
  return `eval "$(${helper})" && ${command}`;
}

function adaptiveHookContextAssignment(
  field: string,
  item: ResolvedAdaptiveHookAttachment,
  target: TargetName
): string {
  switch (field) {
    case "provider":
      return `SKILLSET_PROVIDER=${target}`;
    case "hook.event":
      return `SKILLSET_HOOK_EVENT=${shellLiteral(item.event)}`;
    case "session.id":
      return `SKILLSET_SESSION_ID="${targetSessionIdExpression(target)}"`;
    default:
      throw new Error(
        `skillset: adaptive hook ${item.definition.name} context.env field ${field} is not supported`
      );
  }
}

function targetSessionIdExpression(target: TargetName): string {
  return targetDescriptor(target).generatedSessionIdExpression;
}

function shellLiteral(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function adaptiveHookAttachmentsForScope(
  graph: BuildGraph,
  scope: ResolvedAdaptiveHookAttachment["attachment"]["scope"],
  target: TargetName
): readonly ResolvedAdaptiveHookAttachment[] {
  return resolveAdaptiveHookAttachmentsForTarget(
    graph.adaptiveHooks,
    graph.hookAttachments,
    target
  ).resolved.filter(
    (item) =>
      sameAdaptiveHookScope(item.attachment.scope, scope) &&
      supportsAdaptiveHookTarget(item, target, "frontmatter")
  );
}

function sameAdaptiveHookScope(
  left: ResolvedAdaptiveHookAttachment["attachment"]["scope"],
  right: ResolvedAdaptiveHookAttachment["attachment"]["scope"]
): boolean {
  return (
    left.kind === right.kind &&
    left.pluginId === right.pluginId &&
    left.skillId === right.skillId &&
    left.agentId === right.agentId
  );
}

export function skillScope(
  plugin: SourcePlugin | undefined,
  skill: SourceSkill
): ResolvedAdaptiveHookAttachment["attachment"]["scope"] {
  return {
    kind: "skill",
    ...(plugin === undefined ? {} : { pluginId: plugin.id }),
    skillId: skill.id,
  };
}

export async function renderNormalizedPluginHookFile(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  basePath: string
): Promise<RenderedFile | undefined> {
  const canonicalSource = join(plugin.path, "hooks", "hooks.json");
  if (!(await exists(canonicalSource))) return undefined;

  await validateHookJson(graph, canonicalSource, target);
  const parsed = JSON.parse(
    await readFile(canonicalSource, "utf8")
  ) as JsonValue;
  const normalized =
    isJsonRecord(parsed) && isJsonRecord(parsed.hooks)
      ? parsed
      : { hooks: parsed };
  const providerNative = normalizePluginHookEventNames(
    normalized,
    target,
    relative(graph.rootPath, canonicalSource)
  );
  return textFile(
    join(basePath, "hooks", "hooks.json"),
    renderValidatedJson(
      providerNative,
      `${relative(graph.rootPath, canonicalSource)} -> ${join(basePath, "hooks", "hooks.json")}`
    ),
    relative(graph.rootPath, canonicalSource)
  );
}

function normalizePluginHookEventNames(
  normalized: JsonRecord,
  target: TargetName,
  sourceLabel: string
): JsonRecord {
  if (target !== "cursor" || !isJsonRecord(normalized.hooks)) return normalized;

  const hooks: Record<string, JsonValue> = {};
  for (const [event, groups] of Object.entries(normalized.hooks)) {
    if (groups === undefined) continue;
    const nativeEvent = nativeHookEventName(target, event);
    if (Object.hasOwn(hooks, nativeEvent)) {
      throw new Error(
        `skillset: Cursor hook file ${sourceLabel} maps multiple events to ${nativeEvent}; keep only one canonical or native spelling.`
      );
    }
    hooks[nativeEvent] = groups;
  }

  return { ...normalized, hooks };
}

export async function validateHookJson(
  graph: BuildGraph,
  sourcePath: string,
  target: TargetName
): Promise<void> {
  if (!(await exists(sourcePath))) return;

  const sourceLabel = relative(graph.rootPath, sourcePath);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8")) as JsonValue;
  } catch (error) {
    const provider = targetLabel(target);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `skillset: ${provider} hook file ${sourceLabel} is not valid JSON: ${message}`
    );
  }

  validateHookDefinition(parsed, { sourcePath: sourceLabel, target });
}
