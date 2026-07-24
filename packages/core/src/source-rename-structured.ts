/* eslint-disable func-style, no-use-before-define -- Hoisted helpers keep hook and eval rewrite phases together. */
/* eslint-disable no-nested-ternary, unicorn/import-style -- Structured preservation branches mirror the input schema. */

import { dirname, join, relative } from "node:path";

import { resolveAdaptiveHookAttachmentIdentities } from "./adaptive-hook-attachments";
import { targetNames } from "./config";
import { classifyAdaptiveHookUnitPath } from "./hook-capabilities";
import { resolveInside } from "./path";
import { assertRewrittenSourceReference } from "./source-reference-contract";
import {
  absoluteWorkspacePath,
  allSkills,
  isWithin,
  pluginForSkill,
  toPosix,
} from "./source-rename-paths";
import type { SkillIdentityRename } from "./source-rename-rewrite";
import type {
  AdaptiveHookScope,
  BuildGraph,
  JsonRecord,
  JsonValue,
  SourceAdaptiveHook,
  SourceSkill,
  StandaloneSkill,
} from "./types";
import { isJsonRecord } from "./yaml";

export function updateAdaptiveHookDocument(args: {
  readonly graph: BuildGraph;
  readonly hook: SourceAdaptiveHook;
  readonly renamedPath: (path: string) => string;
  readonly source: string;
}): string {
  assertRewrittenSourceReference("adaptive-hook-run-script");
  const parsed = JSON.parse(args.source) as unknown;
  if (!isJsonRecord(parsed)) {
    return args.source;
  }
  const ownerPath = hookOwnerPath(args.graph, args.hook.scope);
  const rewriteRun = (value: JsonValue | undefined): JsonValue | undefined => {
    if (
      !isJsonRecord(value) ||
      !isJsonRecord(value.run) ||
      typeof value.run.script !== "string"
    ) {
      return value;
    }
    const next = rewriteHookScript(
      value.run.script,
      args.hook,
      ownerPath,
      args.renamedPath
    );
    return next === undefined
      ? value
      : { ...value, run: { ...value.run, script: next } };
  };
  const updated = writableRecord(parsed);
  let changed = false;
  const shared = rewriteRun(parsed);
  if (shared !== parsed && isJsonRecord(shared)) {
    Object.assign(updated, shared);
    changed = true;
  }
  for (const target of targetNames()) {
    const targetValue = rewriteRun(parsed[target]);
    if (targetValue !== undefined && targetValue !== parsed[target]) {
      updated[target] = targetValue;
      changed = true;
    }
  }
  return changed ? jsonSource(updated, args.source) : args.source;
}

export function updateSkillEvalDocument(args: {
  readonly identityRename?: SkillIdentityRename;
  readonly renamedPath: (path: string) => string;
  readonly skill: SourceSkill;
  readonly source: string;
}): string {
  assertRewrittenSourceReference("skill-eval-file");
  assertRewrittenSourceReference("skill-eval-skill-name");
  const parsed = JSON.parse(args.source) as unknown;
  if (!isJsonRecord(parsed)) {
    return args.source;
  }
  const skillRoot = dirname(args.skill.sourcePath);
  let evalsChanged = false;
  const rewriteFile = (value: JsonValue): JsonValue => {
    if (typeof value !== "string") {
      return value;
    }
    const resolved = resolveInside(skillRoot, value);
    const next = args.renamedPath(resolved);
    return next === resolved || !isWithin(skillRoot, next)
      ? value
      : toPosix(relative(skillRoot, next));
  };
  const evals = Array.isArray(parsed.evals)
    ? parsed.evals.map((entry) =>
        isJsonRecord(entry) && Array.isArray(entry.files)
          ? rewriteEvalFiles(entry)
          : entry
      )
    : parsed.evals;
  const identityChanged =
    args.identityRename !== undefined &&
    parsed.skill_name !== args.identityRename.to;
  if (!evalsChanged && !identityChanged) {
    return args.source;
  }
  const updated = writableRecord(parsed);
  if (evalsChanged && evals !== undefined) {
    updated.evals = evals;
  }
  if (identityChanged && args.identityRename !== undefined) {
    updated.skill_name = args.identityRename.to;
  }
  return jsonSource(updated, args.source);

  function rewriteEvalFiles(entry: JsonRecord): JsonRecord {
    const previousFiles = entry.files;
    if (!Array.isArray(previousFiles)) {
      return entry;
    }
    const files = previousFiles.map(rewriteFile);
    if (files.every((file, index) => file === previousFiles[index])) {
      return entry;
    }
    evalsChanged = true;
    return { ...entry, files };
  }
}

export function hookIdentityRenameMap(
  graph: BuildGraph,
  fromPath: string,
  toPath: string
): ReadonlyMap<string, string> {
  const bySource = new Map<string, string>();
  for (const hook of graph.adaptiveHooks) {
    if (hook.sourcePath !== fromPath) {
      continue;
    }
    const next = hookNameForRenamedPath(hook, graph, toPath);
    if (next !== undefined && next !== hook.name) {
      bySource.set(hook.sourcePath, `${hook.name}\u0000${next}`);
    }
  }
  const resolved = resolveAdaptiveHookAttachmentIdentities(
    graph.adaptiveHooks,
    graph.hookAttachments
  );
  const byDocument = new Map<string, string>();
  for (const item of resolved.resolved) {
    const rename = bySource.get(item.definition.sourcePath);
    if (rename !== undefined) {
      byDocument.set(
        absoluteWorkspacePath(graph.rootPath, item.attachment.sourcePath),
        rename
      );
    }
  }
  return byDocument;
}

export function writableRecord(record: JsonRecord): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined
    )
  );
}

function rewriteHookScript(
  reference: string,
  hook: SourceAdaptiveHook,
  ownerPath: string,
  renamedPath: (path: string) => string
): string | undefined {
  const script = hook.scriptReferences.find(
    (entry) => entry.reference === reference
  );
  if (script === undefined) {
    return undefined;
  }
  const next = renamedPath(script.sourcePath);
  if (next === script.sourcePath) {
    return undefined;
  }
  if (reference.startsWith("{{scripts.dir}}/")) {
    const root = join(ownerPath, "scripts");
    return isWithin(root, next)
      ? `{{scripts.dir}}/${toPosix(relative(root, next))}`
      : undefined;
  }
  if (reference.startsWith("./")) {
    const root = dirname(hook.sourcePath);
    return isWithin(root, next)
      ? `./${toPosix(relative(root, next))}`
      : undefined;
  }
  return isWithin(ownerPath, next)
    ? toPosix(relative(ownerPath, next))
    : undefined;
}

function hookNameForRenamedPath(
  hook: SourceAdaptiveHook,
  graph: BuildGraph,
  toPath: string
): string | undefined {
  const owner = hookOwnerPath(graph, hook.scope);
  const hooksRoot = join(owner, "hooks");
  if (!isWithin(hooksRoot, toPath) || !toPath.endsWith(".json")) {
    return undefined;
  }
  const rel = toPosix(relative(hooksRoot, toPath));
  const classified = classifyAdaptiveHookUnitPath(`hooks/${rel}`);
  return classified.kind === "adaptive-unit" ? classified.name : undefined;
}

function hookOwnerPath(graph: BuildGraph, scope: AdaptiveHookScope): string {
  if (scope.kind === "root") {
    return graph.sourceRootPath;
  }
  if (scope.kind === "plugin") {
    return (
      graph.plugins.find((plugin) => plugin.id === scope.pluginId)?.path ??
      graph.sourceRootPath
    );
  }
  if (scope.kind === "skill") {
    const skill = allSkills(graph).find(
      (entry) =>
        entry.id === scope.skillId &&
        (scope.pluginId === undefined
          ? graph.standaloneSkills.includes(entry as StandaloneSkill)
          : pluginForSkill(graph, entry)?.id === scope.pluginId)
    );
    return skill === undefined
      ? graph.sourceRootPath
      : dirname(skill.sourcePath);
  }
  const agent = graph.projectAgents.find(
    (entry) => entry.outputName === scope.agentId
  );
  return agent === undefined ? graph.sourceRootPath : dirname(agent.sourcePath);
}

function jsonSource(value: JsonRecord, source: string): string {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  return rendered === source ? source : rendered;
}
