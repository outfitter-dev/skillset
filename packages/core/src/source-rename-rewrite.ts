/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- Reference resolution preserves document order and groups hoisted rewrite helpers. */
/* eslint-disable no-nested-ternary, prefer-destructuring, prefer-named-capture-group -- Compact source-shape branches mirror the authored grammar. */
/* eslint-disable unicorn/import-style, unicorn/no-nested-ternary, unicorn/no-useless-spread -- Named path helpers and stable match iteration keep rewrites readable. */

import { basename, dirname, join, relative } from "node:path";

import { targetNames } from "./config";
import { resolveInside } from "./path";
import {
  resolvePreprocessNamedPartialReference,
  resolvePreprocessPathReference,
} from "./preprocess";
import {
  updateMarkdownSourceDocument,
  updateYamlSourceDocument,
} from "./source-document";
import { assertRewrittenSourceReference } from "./source-reference-contract";
import {
  allSkills,
  display,
  isWithin,
  pluginForPath,
  pluginForSkill,
  toPosix,
} from "./source-rename-paths";
import { writableRecord } from "./source-rename-structured";
import type { BuildGraph, JsonRecord, JsonValue, SourceSkill } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

const MARKED_PATH_REFERENCE = /\{\{\s*@([^}\s]+)\s*\}\}/gu;
const NAMED_PARTIAL_REFERENCE = /\{\{\s*>\s*([^}\s]+)\s*\}\}/gu;

export interface SkillIdentityRename {
  readonly from: string;
  readonly pluginId?: string;
  readonly sourcePath: string;
  readonly to: string;
}

interface MarkdownUpdateArgs {
  readonly documentPath: string;
  readonly fromPath: string;
  readonly graph: BuildGraph;
  readonly hookIdentityRenames: ReadonlyMap<string, string>;
  readonly identityRename?: SkillIdentityRename;
  readonly renamedPath: (path: string) => string;
  readonly source: string;
  readonly warnings: Set<string>;
}

export async function updateMarkdownDocument(
  args: MarkdownUpdateArgs
): Promise<string> {
  const parts = parseMarkdown(args.source, args.documentPath);
  const updatedFrontmatter = rewriteMarkdownFrontmatter(
    parts.frontmatter,
    args.documentPath,
    args.graph,
    args.identityRename,
    args.renamedPath,
    args.hookIdentityRenames,
    args.warnings
  );
  const updatedBody = await rewriteMarkdownBody(
    args,
    parts.frontmatter,
    parts.body
  );
  return updateMarkdownSourceDocument(args.source, args.documentPath, () => ({
    body: updatedBody,
    frontmatter: updatedFrontmatter,
  }));
}

export function updateYamlDocument(
  args: Omit<MarkdownUpdateArgs, "source"> & { readonly source: string }
): string {
  return updateYamlSourceDocument(args.source, args.documentPath, (current) => {
    let updated = rewriteHookAttachments(
      current,
      args.hookIdentityRenames.get(args.documentPath)
    );
    const skill = skillForDocument(args.graph, args.documentPath);
    if (skill !== undefined) {
      updated = rewriteSkillResources(
        updated,
        skill,
        args.graph,
        args.renamedPath,
        args.warnings
      );
    }
    return updated;
  });
}

function rewriteMarkdownFrontmatter(
  frontmatter: JsonRecord,
  documentPath: string,
  graph: BuildGraph,
  identityRename: SkillIdentityRename | undefined,
  renamedPath: (path: string) => string,
  hookIdentityRenames: ReadonlyMap<string, string>,
  warnings: Set<string>
): JsonRecord {
  let updated = rewriteHookAttachments(
    frontmatter,
    hookIdentityRenames.get(documentPath)
  );
  if (isAgentDocument(graph, documentPath) && identityRename !== undefined) {
    updated = rewriteAgentSkillReferences(updated, identityRename);
  }
  const skill = skillForDocument(graph, documentPath);
  if (skill !== undefined) {
    updated = rewriteSkillResources(
      updated,
      skill,
      graph,
      renamedPath,
      warnings
    );
    if (
      identityRename !== undefined &&
      skill.sourcePath === identityRename.sourcePath
    ) {
      updated = { ...updated, name: identityRename.to };
    }
  }
  return updated;
}

async function rewriteMarkdownBody(
  args: MarkdownUpdateArgs,
  frontmatter: JsonRecord,
  initialBody: string
): Promise<string> {
  const context = preprocessContext(args.graph, args.documentPath, frontmatter);
  const outputPath = args.renamedPath(args.documentPath);
  let body = initialBody;
  for (const match of [...initialBody.matchAll(MARKED_PATH_REFERENCE)]) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }
    let resolved: string;
    try {
      resolved = resolvePreprocessPathReference(specifier, context);
    } catch {
      continue;
    }
    const replacement = rewritePathSpecifier(
      specifier,
      resolved,
      outputPath,
      args.renamedPath,
      args.graph
    );
    if (replacement !== undefined && replacement !== specifier) {
      body = body.replace(match[0], `{{@${replacement}}}`);
    }
  }
  for (const match of [...initialBody.matchAll(NAMED_PARTIAL_REFERENCE)]) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }
    let resolved: string;
    try {
      resolved = await resolvePreprocessNamedPartialReference(
        specifier,
        context
      );
    } catch {
      continue;
    }
    const replacement = rewriteNamedPartialSpecifier(
      specifier,
      resolved,
      args.renamedPath,
      args.graph
    );
    if (replacement !== undefined && replacement !== specifier) {
      body = body.replace(match[0], `{{> ${replacement}}}`);
    }
  }
  reportUnmarkedMention(args, initialBody);
  return body;
}

function rewriteAgentSkillReferences(
  frontmatter: JsonRecord,
  identityRename: SkillIdentityRename
): JsonRecord {
  assertRewrittenSourceReference("agent-skills");
  const rewrite = (value: JsonValue | undefined): JsonValue | undefined => {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item) => {
      if (typeof item !== "string") {
        return item;
      }
      if (identityRename.pluginId === undefined) {
        return item === identityRename.from ? identityRename.to : item;
      }
      const prefix = `plugin.${identityRename.pluginId}.skill:`;
      return item === `${prefix}${identityRename.from}`
        ? `${prefix}${identityRename.to}`
        : item;
    });
  };
  const skills = rewrite(frontmatter.skills);
  const updated = writableRecord(frontmatter);
  Object.assign(updated, skills === undefined ? {} : { skills });
  for (const target of targetNames()) {
    const value = frontmatter[target];
    if (!isJsonRecord(value)) {
      continue;
    }
    const targetSkills = rewrite(value.skills);
    updated[target] = {
      ...value,
      ...(targetSkills === undefined ? {} : { skills: targetSkills }),
    };
  }
  return updated;
}

function rewriteHookAttachments(
  frontmatter: JsonRecord,
  rename: string | undefined
): JsonRecord {
  assertRewrittenSourceReference("hook-attachment");
  if (rename === undefined || !isJsonRecord(frontmatter.hooks)) {
    return frontmatter;
  }
  const [from, to] = rename.split("\u0000");
  if (from === undefined || to === undefined) {
    return frontmatter;
  }
  const hooks: Record<string, JsonValue> = {};
  for (const [event, entries] of Object.entries(frontmatter.hooks)) {
    if (entries === undefined) {
      continue;
    }
    hooks[event] = Array.isArray(entries)
      ? entries.map((entry) => {
          if (typeof entry === "string") {
            return entry === from ? to : entry;
          }
          if (!isJsonRecord(entry) || typeof entry.hook !== "string") {
            return entry;
          }
          return entry.hook === from ? { ...entry, hook: to } : entry;
        })
      : entries;
  }
  return { ...frontmatter, hooks };
}

function rewriteSkillResources(
  frontmatter: JsonRecord,
  skill: SourceSkill,
  graph: BuildGraph,
  renamedPath: (path: string) => string,
  warnings: Set<string>
): JsonRecord {
  assertRewrittenSourceReference("skill-resource-source");
  if (frontmatter.resources === undefined) {
    return frontmatter;
  }
  const plugin = pluginForSkill(graph, skill);
  const rewriteEntry = (entry: JsonValue): JsonValue => {
    if (typeof entry === "string") {
      return rewriteResourceFrom(entry, plugin, graph, renamedPath) ?? entry;
    }
    if (!isJsonRecord(entry)) {
      return entry;
    }
    const from =
      typeof entry.from === "string"
        ? rewriteResourceFrom(entry.from, plugin, graph, renamedPath)
        : undefined;
    if (
      typeof entry.to === "string" &&
      resourceMatchesRename(entry.from, plugin, graph, renamedPath)
    ) {
      warnings.add(
        `preserved generated resource destination in ${display(graph.rootPath, skill.sourcePath)}`
      );
    }
    return from === undefined ? entry : { ...entry, from };
  };
  const { resources } = frontmatter;
  const rewritten = Array.isArray(resources)
    ? resources.map(rewriteEntry)
    : isJsonRecord(resources) && resources.from === undefined
      ? rewriteResourceGroups(resources, rewriteEntry)
      : rewriteEntry(resources);
  return { ...frontmatter, resources: rewritten };
}

function rewriteResourceGroups(
  resources: JsonRecord,
  rewriteEntry: (entry: JsonValue) => JsonValue
): JsonRecord {
  const groups: Record<string, JsonValue> = {};
  for (const [group, value] of Object.entries(resources)) {
    if (value !== undefined) {
      groups[group] = Array.isArray(value)
        ? value.map(rewriteEntry)
        : rewriteEntry(value);
    }
  }
  return groups;
}

function rewriteResourceFrom(
  value: string,
  plugin: ReturnType<typeof pluginForSkill>,
  graph: BuildGraph,
  renamedPath: (path: string) => string
): string | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const scheme = value.slice(0, separator);
  const path = value.slice(separator + 1);
  const root =
    scheme === "shared"
      ? join(graph.sourceRootPath, "shared")
      : scheme === "plugin" && plugin !== undefined
        ? join(plugin.path, "shared")
        : undefined;
  if (root === undefined) {
    return undefined;
  }
  const resolved = resolveInside(root, path);
  const next = renamedPath(resolved);
  return next === resolved || !isWithin(root, next)
    ? undefined
    : `${scheme}:${toPosix(relative(root, next))}`;
}

function resourceMatchesRename(
  value: JsonValue | undefined,
  plugin: ReturnType<typeof pluginForSkill>,
  graph: BuildGraph,
  renamedPath: (path: string) => string
): boolean {
  return (
    typeof value === "string" &&
    rewriteResourceFrom(value, plugin, graph, renamedPath) !== undefined
  );
}

function reportUnmarkedMention(args: MarkdownUpdateArgs, body: string): void {
  const structured = body
    .replace(MARKED_PATH_REFERENCE, "")
    .replace(NAMED_PARTIAL_REFERENCE, "");
  const path = display(args.graph.rootPath, args.fromPath);
  const name = basename(args.fromPath);
  if (
    structured.includes(path) ||
    (name.length > 0 && structured.includes(name))
  ) {
    args.warnings.add(
      `unmarked source mention may need manual update in ${display(args.graph.rootPath, args.documentPath)}`
    );
  }
}

function preprocessContext(
  graph: BuildGraph,
  sourcePath: string,
  frontmatter: JsonRecord
) {
  const plugin = pluginForPath(graph, sourcePath);
  return {
    frontmatter,
    ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
    rootPath: graph.rootPath,
    sourcePath,
    sourceRoot: graph.sourceRoot,
  };
}

function rewritePathSpecifier(
  specifier: string,
  resolved: string,
  outputDocumentPath: string,
  renamedPath: (path: string) => string,
  graph: BuildGraph
): string | undefined {
  const next = renamedPath(resolved);
  if (next === resolved) {
    return undefined;
  }
  const separator = specifier.indexOf(":");
  const scheme = separator === -1 ? undefined : specifier.slice(0, separator);
  const plugin = pluginForPath(graph, outputDocumentPath);
  const root =
    scheme === "shared" || scheme === "root"
      ? join(graph.sourceRootPath, "shared")
      : scheme === "plugin" && plugin !== undefined
        ? join(plugin.path, "shared")
        : scheme === undefined
          ? dirname(outputDocumentPath)
          : undefined;
  if (root === undefined || !isWithin(root, next)) {
    return undefined;
  }
  const path = toPosix(relative(root, next));
  if (path.startsWith("../")) {
    return undefined;
  }
  return scheme === undefined ? path : `${scheme}:${path}`;
}

function rewriteNamedPartialSpecifier(
  specifier: string,
  resolved: string,
  renamedPath: (path: string) => string,
  graph: BuildGraph
): string | undefined {
  const next = renamedPath(resolved);
  if (next === resolved || !next.endsWith(".md")) {
    return undefined;
  }
  const plugin = pluginForPath(graph, resolved);
  const root =
    plugin === undefined
      ? join(graph.sourceRootPath, "partials")
      : join(plugin.path, "partials");
  if (!isWithin(root, resolved) || !isWithin(root, next)) {
    return undefined;
  }
  const name = toPosix(relative(root, next)).replace(/\.md$/u, "");
  const qualified =
    specifier.includes(".") &&
    plugin !== undefined &&
    specifier.startsWith(`${plugin.id}.`);
  return qualified ? `${plugin.id}.${name}` : name;
}

function isAgentDocument(graph: BuildGraph, path: string): boolean {
  return graph.projectAgents.some((agent) => agent.sourcePath === path);
}

function skillForDocument(
  graph: BuildGraph,
  path: string
): SourceSkill | undefined {
  return allSkills(graph).find((skill) => skill.sourcePath === path);
}
