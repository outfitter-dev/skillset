import { resolve, relative } from "node:path";

import { SkillsetLoweringError, type SkillsetLoweringOutcome } from "@skillset/core";
import { collectLoweringOutcomes } from "@skillset/core/internal/lowering-outcome-collector";

import { diffSkillsetResult, scopedRenderedFiles, type SkillsetDiff } from "./build";
import { inspectSkillset } from "./lint";
import { compareStrings } from "./path";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import type { BuildGraph, GeneratedEntry, LintIssue, SkillsetOptions, SourceOrigin } from "./types";
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
  readonly loweringOutcomes: readonly SkillsetLoweringOutcome[];
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
  const allRendered = await renderBuildGraph(graph);
  const rendered = scopedRenderedFiles(graph, allRendered, options.scopes);
  const loweringOutcomes = collectLoweringOutcomes(graph, allRendered, {
    includedPaths: new Set(rendered.map((file) => file.path)),
    scopes: options.scopes,
  });
  const target = normalizeRepoPath(rootPath, inputPath);
  const items = collectLockItems(rendered);

  const asSource = items.filter((item) => item.sourcePath === target);
  if (asSource.length > 0) {
    return {
      path: target,
      kind: explainSourceKind(graph, target),
      entries: asSource.map((item) => item.entry),
      loweringOutcomes: explainLoweringOutcomes(target, asSource, loweringOutcomes),
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
      loweringOutcomes: explainLoweringOutcomes(target, asGenerated, loweringOutcomes, {
        includeSourcePaths: false,
      }),
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
      loweringOutcomes: explainLoweringOutcomes(target, prefixMatch, loweringOutcomes),
      notes: [`Matched ${prefixMatch.length} generated entries under this source path.`],
    };
  }

  return {
    path: target,
    kind: "unknown",
    entries: [],
    loweringOutcomes: [],
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
  const rendered = scopedRenderedFiles(graph, await renderBuildGraph(graph), options.scopes);
  return collectLockItems(rendered).map((item) => item.entry);
}

export interface DoctorReport {
  readonly buildError?: string;
  readonly drift: SkillsetDiff;
  readonly lintIssues: readonly LintIssue[];
  readonly loweringOutcomes: readonly SkillsetLoweringOutcome[];
  readonly notableLoweringOutcomes: readonly SkillsetLoweringOutcome[];
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
  let graph: BuildGraph;
  try {
    graph = await loadBuildGraph(rootPath, options);
  } catch (error) {
    const loweringOutcomes = loweringOutcomesFromError(error);
    return {
      buildError: errorMessage(error),
      drift: { added: [], changed: [], missing: [], removed: [] },
      lintIssues: [],
      loweringOutcomes,
      notableLoweringOutcomes: notableLoweringOutcomes(loweringOutcomes),
      ok: false,
      warnings: [],
    };
  }
  const lint = await inspectSkillset(graph);

  let drift: SkillsetDiff = { added: [], changed: [], missing: [], removed: [] };
  let buildError: string | undefined;
  let loweringOutcomes: readonly SkillsetLoweringOutcome[] = [];
  try {
    const diff = await diffSkillsetResult(rootPath, options);
    drift = diff.data;
    loweringOutcomes = diff.loweringOutcomes;
  } catch (error) {
    buildError = errorMessage(error);
    loweringOutcomes = loweringOutcomesFromError(error);
  }

  const hasDrift =
    drift.added.length > 0 || drift.changed.length > 0 || drift.missing.length > 0 || drift.removed.length > 0;
  const notable = notableLoweringOutcomes(loweringOutcomes);

  return {
    ...(buildError === undefined ? {} : { buildError }),
    drift,
    lintIssues: lint.issues,
    loweringOutcomes,
    notableLoweringOutcomes: notable,
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

function explainLoweringOutcomes(
  target: string,
  items: readonly LockItemMatch[],
  outcomes: readonly SkillsetLoweringOutcome[],
  options: { readonly includeSourcePaths?: boolean } = {}
): readonly SkillsetLoweringOutcome[] {
  const includeSourcePaths = options.includeSourcePaths !== false;
  const itemSourcePaths = new Set(items.map((item) => item.sourcePath));
  const itemOutputPaths = new Set(items.flatMap((item) => [
    item.outputPath,
    ...item.files.map((file) => joinOutputRoot(item.outputRoot, file)),
  ]));
  const seen = new Set<string>();
  const matched: SkillsetLoweringOutcome[] = [];
  for (const outcome of outcomes) {
    const sourcePath = outcome.sourcePath;
    const outputPaths = outcome.outputs?.map((output) => output.path) ?? [];
    const matchesSource = includeSourcePaths &&
      (
        sourcePath === target ||
        (sourcePath !== undefined && sourcePath.startsWith(`${target}/`)) ||
        itemSourcePaths.has(sourcePath ?? "")
      );
    if (
      !matchesSource &&
      !outputPaths.includes(target) &&
      !outputPaths.some((path) => itemOutputPaths.has(path))
    ) {
      continue;
    }
    const key = `${outcome.sourceUnit}\0${outcome.target ?? ""}\0${outcome.featureId}\0${outcome.status}\0${sourcePath ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(outcome);
  }
  return matched;
}

function notableLoweringOutcomes(
  outcomes: readonly SkillsetLoweringOutcome[]
): readonly SkillsetLoweringOutcome[] {
  return outcomes
    .filter((outcome) =>
      outcome.status === "degraded" ||
      outcome.status === "externally_managed" ||
      outcome.status === "failed" ||
      outcome.status === "intentionally_skipped" ||
      outcome.status === "lossy" ||
      outcome.status === "unsupported"
    )
    .sort((left, right) =>
      compareStrings(
        `${left.target ?? "workspace"}\0${left.sourceUnit}\0${left.featureId}\0${left.status}`,
        `${right.target ?? "workspace"}\0${right.sourceUnit}\0${right.featureId}\0${right.status}`
      )
    );
}

function loweringOutcomesFromError(error: unknown): readonly SkillsetLoweringOutcome[] {
  return error instanceof SkillsetLoweringError ? error.loweringOutcomes : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      const dependencies = Array.isArray(rawItem.dependencies)
        ? rawItem.dependencies.filter((value): value is string => typeof value === "string")
        : undefined;
      const transforms = Array.isArray(rawItem.transforms)
        ? rawItem.transforms.flatMap((value) =>
            isJsonRecord(value) && typeof value.intent === "string" && typeof value.count === "number"
              ? [{ count: value.count, intent: value.intent }]
              : []
          )
        : undefined;
      const sourceOrigin = readSourceOrigin(rawItem.sourceOrigin);
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
          ...(dependencies === undefined ? {} : { dependencies }),
          ...(typeof rawItem.feature === "string" ? { feature: rawItem.feature } : {}),
          ...(typeof rawItem.kind === "string" ? { kind: rawItem.kind } : {}),
          ...(typeof rawItem.origin === "string" ? { origin: rawItem.origin } : {}),
          ...(typeof rawItem.outputHash === "string" ? { outputHash: rawItem.outputHash } : {}),
          ...(preprocessDependencies === undefined ? {} : { preprocessDependencies }),
          ...(typeof rawItem.sourceHash === "string" ? { sourceHash: rawItem.sourceHash } : {}),
          ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
          ...(typeof rawItem.sourcePointer === "string" ? { sourcePointer: rawItem.sourcePointer } : {}),
          ...(transforms === undefined || transforms.length === 0 ? {} : { transforms }),
          ...(typeof rawItem.version === "string" ? { version: rawItem.version } : {}),
          ...(typeof rawItem.targetState === "string" ? { targetState: rawItem.targetState } : {}),
          ...(typeof rawItem.validation === "string" ? { validation: rawItem.validation } : {}),
        },
      });
    }
  }
  return matches;
}

function readSourceOrigin(value: unknown): SourceOrigin | undefined {
  if (!isJsonRecord(value) || typeof value.path !== "string") return undefined;
  return {
    path: value.path,
    ...(typeof value.ref === "string" ? { ref: value.ref } : {}),
    ...(typeof value.repo === "string" ? { repo: value.repo } : {}),
  };
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
