import { resolve, relative } from "node:path";

import { diffSkillset, type SkillsetDiff } from "./build";
import { inspectSkillset } from "./lint";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import type { BuildGraph, GeneratedEntry, LintIssue, SkillsetOptions } from "./types";
import { isJsonRecord } from "./yaml";

const textDecoder = new TextDecoder();

export type ExplainKind =
  | "source-skill"
  | "source-instruction"
  | "source-island"
  | "source-project-agent"
  | "source-plugin"
  | "generated"
  | "unknown";

export interface ExplainResult {
  readonly entries: readonly GeneratedEntry[];
  readonly kind: ExplainKind;
  readonly notes: readonly string[];
  readonly path: string;
}

/**
 * Explain a source or generated path: how it lowers, the lock provenance that
 * tracks it (source path, output path, hashes, target state, version), and a few
 * derived notes. Read-only — never writes generated outputs.
 */
export async function explainPath(
  rootPath: string,
  inputPath: string,
  options: SkillsetOptions = {}
): Promise<ExplainResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);
  const target = normalizeRepoPath(rootPath, inputPath);
  const items = collectLockItems(rendered);

  const asSource = items.filter((item) => item.sourcePath === target);
  if (asSource.length > 0) {
    return {
      path: target,
      kind: explainSourceKind(graph, target),
      entries: asSource.map((item) => item.entry),
      notes: sourceNotes(graph, target),
    };
  }

  const asGenerated = items.filter(
    (item) =>
      item.outputPath === target ||
      item.files.some((file) => joinOutputRoot(item.outputRoot, file) === target)
  );
  if (asGenerated.length > 0) {
    return {
      path: target,
      kind: "generated",
      entries: asGenerated.map((item) => item.entry),
      notes: [`Generated output; rebuild with skillset build, verify with skillset check.`],
    };
  }

  // Source path that did not match a lock item exactly (e.g. a directory or an
  // instruction whose lock lives at the workspace root) — fall back to prefix.
  const prefixMatch = items.filter((item) => item.sourcePath.startsWith(`${target}/`));
  if (prefixMatch.length > 0) {
    return {
      path: target,
      kind: "source-plugin",
      entries: prefixMatch.map((item) => item.entry),
      notes: [`Matched ${prefixMatch.length} generated entries under this source path.`],
    };
  }

  return {
    path: target,
    kind: "unknown",
    entries: [],
    notes: [
      `No lock entry references ${target}. Pass a source path under ${graph.sourceDir}/ or a generated output path.`,
    ],
  };
}

export async function listGeneratedEntries(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly GeneratedEntry[]> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);
  return collectLockItems(rendered).map((item) => item.entry);
}

export interface DoctorReport {
  readonly buildError?: string;
  readonly drift: SkillsetDiff;
  readonly lintIssues: readonly LintIssue[];
  readonly ok: boolean;
  readonly warnings: readonly string[];
}

/**
 * Aggregate local health checks: lint diagnostics (resources, scripts, hooks,
 * tool policy), generated-output drift, and source warnings. Read-only and
 * local: it never installs, trusts, publishes, or mutates user-level config.
 *
 * A hard render failure (e.g. an undeclared resource link) is surfaced as a
 * `buildError` finding rather than crashing the report, so doctor can still
 * report the lint issues it already collected.
 */
export async function doctorSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<DoctorReport> {
  const graph = await loadBuildGraph(rootPath, options);
  const lint = await inspectSkillset(graph);

  let drift: SkillsetDiff = { added: [], changed: [], removed: [] };
  let buildError: string | undefined;
  try {
    drift = await diffSkillset(rootPath, options);
  } catch (error) {
    buildError = error instanceof Error ? error.message : String(error);
  }

  const hasDrift =
    drift.added.length > 0 || drift.changed.length > 0 || drift.removed.length > 0;

  return {
    ...(buildError === undefined ? {} : { buildError }),
    drift,
    lintIssues: lint.issues,
    ok: lint.issues.length === 0 && !hasDrift && buildError === undefined,
    warnings: graph.warnings,
  };
}

interface LockItemMatch {
  readonly entry: GeneratedEntry;
  readonly files: readonly string[];
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly sourcePath: string;
}

function collectLockItems(rendered: Awaited<ReturnType<typeof renderBuildGraph>>): readonly LockItemMatch[] {
  const matches: LockItemMatch[] = [];
  for (const file of rendered) {
    if (!file.path.endsWith(".skillset.lock")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(file.content)) as unknown;
    } catch {
      continue;
    }
    if (!isJsonRecord(parsed)) continue;
    const outputRoot = typeof parsed.outputRoot === "string" ? parsed.outputRoot : ".";
    const target = typeof parsed.target === "string" ? parsed.target : "unknown";
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const rawItem of items) {
      if (!isJsonRecord(rawItem)) continue;
      const sourcePath = typeof rawItem.sourcePath === "string" ? rawItem.sourcePath : "";
      const outputPath = typeof rawItem.outputPath === "string" ? rawItem.outputPath : "";
      const preprocessDependencies = Array.isArray(rawItem.preprocessDependencies)
        ? rawItem.preprocessDependencies.filter((value): value is string => typeof value === "string")
        : undefined;
      const files = Array.isArray(rawItem.files)
        ? rawItem.files.filter((value): value is string => typeof value === "string")
        : [];
      matches.push({
        sourcePath,
        outputPath: joinOutputRoot(outputRoot, outputPath),
        outputRoot,
        files,
        entry: {
          outputRoot,
          target,
          sourcePath,
          outputPath: joinOutputRoot(outputRoot, outputPath),
          ...(typeof rawItem.kind === "string" ? { kind: rawItem.kind } : {}),
          ...(typeof rawItem.outputHash === "string" ? { outputHash: rawItem.outputHash } : {}),
          ...(preprocessDependencies === undefined ? {} : { preprocessDependencies }),
          ...(typeof rawItem.sourceHash === "string" ? { sourceHash: rawItem.sourceHash } : {}),
          ...(typeof rawItem.version === "string" ? { version: rawItem.version } : {}),
          ...(typeof rawItem.targetState === "string" ? { targetState: rawItem.targetState } : {}),
          ...(typeof rawItem.validation === "string" ? { validation: rawItem.validation } : {}),
        },
      });
    }
  }
  return matches;
}

function joinOutputRoot(outputRoot: string, file: string): string {
  if (outputRoot === "." || outputRoot === "") return file;
  return `${outputRoot}/${file}`;
}

function explainSourceKind(graph: BuildGraph, target: string): ExplainKind {
  if (graph.rules.some((rule) => relative(graph.rootPath, rule.sourcePath) === target)) {
    return "source-instruction";
  }
  if (graph.projectIslands.some((island) => relative(graph.rootPath, island.sourcePath) === target)) {
    return "source-island";
  }
  if (graph.projectAgents.some((agent) => relative(graph.rootPath, agent.sourcePath) === target)) {
    return "source-project-agent";
  }
  if (target.endsWith("/SKILL.md") || target.endsWith("SKILL.md")) return "source-skill";
  return "source-plugin";
}

function sourceNotes(graph: BuildGraph, target: string): readonly string[] {
  const agent = graph.projectAgents.find((candidate) => relative(graph.rootPath, candidate.sourcePath) === target);
  if (agent !== undefined) {
    const targets = (["claude", "codex"] as const)
      .filter((name) => agent.targets[name].enabled)
      .join(", ");
    return [`Project-scoped portable agent. Enabled targets: ${targets.length > 0 ? targets : "none"}.`];
  }

  const island = graph.projectIslands.find((candidate) => relative(graph.rootPath, candidate.sourcePath) === target);
  if (island !== undefined) {
    return [
      `Target-native island for ${island.target}${island.plugin === undefined ? "" : ` plugin ${island.plugin}`}.`,
    ];
  }

  const skill = [
    ...graph.plugins.flatMap((plugin) => plugin.skills),
    ...graph.standaloneSkills,
  ].find((candidate) => relative(graph.rootPath, candidate.sourcePath) === target);
  if (skill === undefined) return [];

  const targets = (["claude", "codex"] as const)
    .filter((name) => skill.targets[name].enabled)
    .join(", ");
  const notes = [`Enabled targets: ${targets.length > 0 ? targets : "none"}.`];
  if (skill.resources.length > 0) {
    notes.push(`Declared resources: ${skill.resources.map((resource) => resource.from).join(", ")}.`);
  }
  return notes;
}

function normalizeRepoPath(rootPath: string, inputPath: string): string {
  const absolute = resolve(rootPath, inputPath);
  return relative(rootPath, absolute).replaceAll("\\", "/");
}
