import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  buildSkillsetResult,
  diffSkillsetResult,
  type SkillsetDiff,
  type SkillsetOptions,
  type SkillsetRenderResult,
} from "@skillset/core";
import { listGeneratedEntries } from "@skillset/core/internal/authoring";
import {
  getProviderDestinationFormatSnapshot,
  listProviderFormatMigrations,
  type ProviderDestinationFormatSnapshotId,
  type ProviderFormatMigrationEntry,
} from "@skillset/registry";

export type ProviderFormatUpdateCommand = "check" | "update";

export interface ProviderFormatUpdateOptions extends SkillsetOptions {
  readonly write?: boolean;
}

export interface ProviderFormatUpdateAction {
  readonly affectedPaths: readonly string[];
  readonly description: string;
  readonly id: string;
  readonly provider: string;
  readonly safety: ProviderFormatMigrationEntry["safety"];
  readonly snapshotId: ProviderDestinationFormatSnapshotId;
  readonly sourceUnit: string;
  readonly surface: string;
  readonly updatePath: ProviderFormatMigrationEntry["updatePath"];
}

export interface ProviderFormatUpdateReport {
  readonly blocked: boolean;
  readonly checkedFiles: number;
  readonly command: ProviderFormatUpdateCommand;
  readonly drift: SkillsetDiff;
  readonly legacyLockOutputPaths: readonly string[];
  readonly manualReviews: readonly ProviderFormatUpdateAction[];
  readonly ok: boolean;
  readonly safeUpdates: readonly ProviderFormatUpdateAction[];
  readonly sourceDriftPaths: readonly string[];
  readonly unplannedDriftPaths: readonly string[];
  readonly wrote: boolean;
  readonly writtenPaths: readonly string[];
}

export async function runProviderFormatUpdates(
  rootPath: string,
  command: ProviderFormatUpdateCommand,
  options: ProviderFormatUpdateOptions = {}
): Promise<ProviderFormatUpdateReport> {
  const { write = false, ...skillsetOptions } = options;
  const preview = await diffSkillsetResult(rootPath, skillsetOptions);
  const driftPaths = allDriftPaths(preview.data);
  const driftPathSet = new Set(driftPaths);
  const managedState = await inspectManagedOutputState(
    rootPath,
    driftPaths,
    preview.data.missing,
    preview.data.removed,
    skillsetOptions
  );
  const sourceDriftPaths = new Set(managedState.sourceDriftPaths);
  if (sourceDriftPaths.size > 0) {
    for (const path of driftPaths) {
      if (path === "skillset.lock" || path.endsWith("/skillset.lock")) sourceDriftPaths.add(path);
    }
  }
  const providerDriftPaths = driftPaths.filter((path) => !sourceDriftPaths.has(path));
  const plan = planProviderFormatUpdates(
    preview.renderResults,
    providerDriftPaths,
    managedState.providerEligiblePaths,
    sourceDriftPaths
  );
  const plannedPaths = new Set(
    [...plan.safeUpdates, ...plan.manualReviews].flatMap((action) => action.affectedPaths)
  );
  for (const path of managedState.missingRenderInputsPaths) sourceDriftPaths.add(path);
  const uncoveredLegacyLockPaths = managedState.missingRenderInputsPaths.some(
    (path) => !plannedPaths.has(path)
  )
    ? managedState.missingRenderInputsLockPaths.filter((path) => driftPathSet.has(path))
    : [];
  const hasProviderPlan = plannedPaths.size > 0;
  const unplannedDriftPaths = [
    ...new Set([
      ...unplannedProviderDriftPaths(providerDriftPaths, plan.safeUpdates, plan.manualReviews),
      ...uncoveredLegacyLockPaths,
      ...(hasProviderPlan
        ? [...sourceDriftPaths].filter((path) =>
            driftPathSet.has(path) && !plannedPaths.has(path)
          )
        : []),
    ]),
  ].sort(compareStrings);
  const blocked = plan.manualReviews.length > 0 || unplannedDriftPaths.length > 0;
  let wrote = false;
  let writtenPaths: readonly string[] = [];

  if (write && plan.safeUpdates.length > 0 && !blocked) {
    const built = await buildSkillsetResult(rootPath, skillsetOptions);
    wrote = built.writes.paths.length > 0;
    writtenPaths = built.writes.paths;
  }

  return {
    blocked,
    checkedFiles: preview.renderResults.length,
    command,
    drift: preview.data,
    legacyLockOutputPaths: managedState.missingRenderInputsLockOutputPaths,
    manualReviews: plan.manualReviews,
    ok: !write || (!blocked && (plan.safeUpdates.length === 0 || wrote)),
    safeUpdates: plan.safeUpdates,
    sourceDriftPaths: [...sourceDriftPaths].sort(compareStrings),
    unplannedDriftPaths,
    wrote,
    writtenPaths,
  };
}

export function renderProviderFormatUpdateReport(report: ProviderFormatUpdateReport): string {
  const lines: string[] = [
    "skillset: update owns registered, source-preserving provider-format migrations only",
  ];
  const driftCount = allDriftPaths(report.drift).length;
  if (driftCount === 0) {
    lines.push(`skillset: provider format ${report.command} found no generated-output drift`);
    return `${lines.join("\n")}\n`;
  }

  for (const action of report.safeUpdates) {
    lines.push(`  safe destination update: ${displayProvider(action.provider)} ${action.surface}`);
    lines.push(`    source: ${action.sourceUnit}`);
    lines.push(`    action: ${action.description}`);
    for (const path of action.affectedPaths) lines.push(`    output: ${path}`);
    lines.push(`    next: ${safeUpdateNextStep(report)}`);
  }
  for (const action of report.manualReviews) {
    lines.push(`  manual review required: ${displayProvider(action.provider)} ${action.surface}`);
    lines.push(`    source: ${action.sourceUnit}`);
    lines.push(`    reason: ${action.description}`);
    for (const path of action.affectedPaths) lines.push(`    output: ${path}`);
    lines.push("    next: review the generated output and update Skillset source or provider support before writing");
  }
  for (const path of report.unplannedDriftPaths) {
    lines.push(`  unplanned destination drift: ${path}`);
    lines.push("    reason: no registered safe destination-format update covers this generated output");
    lines.push("    next: inspect the file, then update Skillset source or provider-format evidence before writing");
  }
  const mixedSourceAndProviderDrift = report.command === "update" &&
    report.safeUpdates.length > 0 &&
    report.sourceDriftPaths.some((path) => path !== "skillset.lock" && !path.endsWith("/skillset.lock"));
  if (mixedSourceAndProviderDrift) {
    lines.push("  source drift must be written separately before destination-format updates");
    lines.push("    next: run skillset check --write, then rerun skillset update");
  }

  lines.push(
    `skillset: destination-format ${report.command} found ${report.safeUpdates.length} safe update` +
      `${report.safeUpdates.length === 1 ? "" : "s"}, ${report.manualReviews.length} manual review` +
      `${report.manualReviews.length === 1 ? "" : "s"}, and ${report.unplannedDriftPaths.length} unplanned drift path` +
      `${report.unplannedDriftPaths.length === 1 ? "" : "s"}`
  );

  if (report.wrote) {
    lines.push(`skillset: applied safe destination-format updates to ${report.writtenPaths.length} file${report.writtenPaths.length === 1 ? "" : "s"}`);
    for (const path of report.writtenPaths) lines.push(`  updated ${path}`);
  } else if (report.blocked) {
    lines.push(mixedSourceAndProviderDrift
      ? "skillset: destination-format updates are blocked until source drift is written"
      : "skillset: destination-format updates require manual review before writing");
  } else if (report.safeUpdates.length > 0 && report.command === "update") {
    lines.push("skillset: rerun skillset update with --yes to apply safe destination-format updates");
  }

  return `${lines.join("\n")}\n`;
}

function safeUpdateNextStep(report: ProviderFormatUpdateReport): string {
  if (report.wrote) return "done";
  if (report.blocked) return "resolve blocking manual review or unplanned drift before applying safe updates";
  if (report.command === "check") return "run skillset update --yes";
  return "run skillset update --yes";
}

function displayProvider(provider: string): string {
  return provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : provider;
}

function planProviderFormatUpdates(
  renderResults: readonly SkillsetRenderResult[],
  driftPaths: readonly string[],
  uneditedManagedPaths: ReadonlySet<string>,
  sourceDriftPaths: ReadonlySet<string>
): {
  readonly manualReviews: readonly ProviderFormatUpdateAction[];
  readonly safeUpdates: readonly ProviderFormatUpdateAction[];
} {
  const driftSet = new Set(driftPaths);
  const safeUpdates = new Map<string, ProviderFormatUpdateAction>();
  const manualReviews = new Map<string, ProviderFormatUpdateAction>();

  for (const outcome of renderResults) {
    const affectedPaths = (outcome.outputs ?? [])
      .map((output) => output.path)
      .filter((path) => driftSet.has(path))
      .sort(compareStrings);
    if (affectedPaths.length === 0) continue;
    for (const snapshotId of providerSnapshotEvidence(outcome)) {
      const snapshot = getProviderDestinationFormatSnapshot(snapshotId);
      if (snapshot === undefined || outcome.target === undefined) continue;
      const entries = listProviderFormatMigrations().filter((entry) =>
        entry.appliesTo.includes(snapshotId) &&
        entry.provider === outcome.target &&
        entry.surface === snapshot.destination
      );
      for (const entry of entries) {
        const action = actionForEntry(entry, snapshotId, outcome.sourceUnit, affectedPaths);
        if (entry.safe && entry.sourcePreserving && entry.updatePath === "adapter") {
          if (affectedPaths.every((path) => uneditedManagedPaths.has(path))) {
            safeUpdates.set(actionKey(action), action);
          } else {
            const description = affectedPaths.some((path) => sourceDriftPaths.has(path))
              ? "Source changed since the previous skillset.lock hash; review the provider migration after rebuilding source-driven drift."
              : "Current generated output differs from its previous skillset.lock hash; review before rewriting.";
            manualReviews.set(
              actionKey(action),
              actionForEntry(
                entry,
                snapshotId,
                outcome.sourceUnit,
                affectedPaths,
                description
              )
            );
          }
        } else if (!entry.safe || entry.requiresConfirmation || entry.updatePath === "manual") {
          manualReviews.set(actionKey(action), action);
        }
      }
    }
  }

  return {
    manualReviews: [...manualReviews.values()].sort(compareActions),
    safeUpdates: [...safeUpdates.values()].sort(compareActions),
  };
}

function providerSnapshotEvidence(outcome: SkillsetRenderResult): readonly ProviderDestinationFormatSnapshotId[] {
  const refs: ProviderDestinationFormatSnapshotId[] = [];
  for (const item of outcome.evidence ?? []) {
    if (item.kind !== "provider-snapshot") continue;
    if (getProviderDestinationFormatSnapshot(item.ref as ProviderDestinationFormatSnapshotId) === undefined) continue;
    refs.push(item.ref as ProviderDestinationFormatSnapshotId);
  }
  return [...new Set(refs)].sort(compareStrings);
}

function actionForEntry(
  entry: ProviderFormatMigrationEntry,
  snapshotId: ProviderDestinationFormatSnapshotId,
  sourceUnit: string,
  affectedPaths: readonly string[],
  description = entry.description
): ProviderFormatUpdateAction {
  return {
    affectedPaths,
    description,
    id: entry.id,
    provider: entry.provider,
    safety: entry.safety,
    snapshotId,
    sourceUnit,
    surface: entry.surface,
    updatePath: entry.updatePath,
  };
}

async function inspectManagedOutputState(
  rootPath: string,
  driftPaths: readonly string[],
  missingPaths: readonly string[],
  removedPaths: readonly string[],
  options: SkillsetOptions
): Promise<{
  readonly missingRenderInputsLockPaths: readonly string[];
  readonly missingRenderInputsLockOutputPaths: readonly string[];
  readonly missingRenderInputsPaths: readonly string[];
  readonly providerEligiblePaths: ReadonlySet<string>;
  readonly sourceDriftPaths: readonly string[];
  readonly unchangedPaths: ReadonlySet<string>;
}> {
  const expectedEntries = await listGeneratedEntries(rootPath, options);
  const expectedSourceHashes = new Map<string, string | undefined>();
  const expectedVersions = new Map<string, string | undefined>();
  const expectedRenderInputsHashes = new Map<string, string | undefined>();
  for (const entry of expectedEntries) {
    const current = await findLockItemForOutputPath(rootPath, entry.outputPath);
    const outputPaths = current?.files.map((file) => file.displayPath) ?? [entry.outputPath];
    for (const outputPath of outputPaths) {
      const normalizedPath = normalizePath(outputPath);
      expectedSourceHashes.set(normalizedPath, entry.sourceHash);
      expectedVersions.set(normalizedPath, entry.version);
      expectedRenderInputsHashes.set(normalizedPath, entry.renderInputsHash);
    }
  }
  const missingSet = new Set(missingPaths.map(normalizePath));
  const missingRenderInputsPaths: string[] = [];
  const missingRenderInputsLockPaths: string[] = [];
  const missingRenderInputsLockOutputPaths: string[] = [];
  const sourceDriftPaths = [...removedPaths];
  for (const outputPath of driftPaths) {
    if (outputPath === "skillset.lock" || outputPath.endsWith("/skillset.lock")) continue;
    if (await findLockItemForOutputPath(rootPath, outputPath) === undefined) {
      sourceDriftPaths.push(outputPath);
    }
  }
  for (const entry of expectedEntries) {
    const outputPath = normalizePath(entry.outputPath);
    const lockItem = await findLockItemForOutputPath(rootPath, outputPath);
    if (entry.renderInputsHash !== undefined && lockItem?.renderInputsHash === undefined) {
      missingRenderInputsPaths.push(outputPath);
      if (lockItem !== undefined) {
        missingRenderInputsLockPaths.push(lockItem.lockPath);
        missingRenderInputsLockOutputPaths.push(outputPath);
      }
    }
    if (
      (lockItem?.sourceHash !== undefined && entry.sourceHash !== lockItem.sourceHash) ||
      (lockItem?.renderInputsHash !== undefined && entry.renderInputsHash !== lockItem.renderInputsHash) ||
      (lockItem?.version !== undefined && entry.version !== lockItem.version)
    ) {
      sourceDriftPaths.push(
        ...(lockItem?.files.map((file) => normalizePath(file.displayPath)) ?? [outputPath])
          .filter((path) => !missingSet.has(path))
      );
    }
  }
  const unchanged = new Set<string>();
  const providerEligible = new Set<string>();
  for (const outputPath of driftPaths) {
    const lockItem = await findLockItemForOutputPath(rootPath, outputPath);
    if (lockItem === undefined || lockItem.outputHash === undefined || lockItem.sourceHash === undefined) continue;
    const currentHash = await currentOutputHash(rootPath, lockItem);
    const normalizedOutputPath = normalizePath(outputPath);
    const expectedSourceHash = expectedSourceHashes.get(normalizedOutputPath);
    const expectedVersion = expectedVersions.get(normalizedOutputPath);
    const expectedRenderInputsHash = expectedRenderInputsHashes.get(normalizedOutputPath);
    const renderInputsUnchanged = lockItem.renderInputsHash !== undefined &&
      expectedRenderInputsHash === lockItem.renderInputsHash;
    if (currentHash === lockItem.outputHash && expectedSourceHashes.has(normalizedOutputPath)) {
      unchanged.add(outputPath);
      if (
        expectedSourceHash === lockItem.sourceHash &&
        renderInputsUnchanged &&
        (lockItem.version === undefined || expectedVersion === lockItem.version)
      ) {
        providerEligible.add(outputPath);
      }
    }
  }
  return {
    missingRenderInputsLockPaths: [...new Set(missingRenderInputsLockPaths)].sort(compareStrings),
    missingRenderInputsLockOutputPaths: [...new Set(missingRenderInputsLockOutputPaths)].sort(compareStrings),
    missingRenderInputsPaths: [...new Set(missingRenderInputsPaths)].sort(compareStrings),
    providerEligiblePaths: providerEligible,
    sourceDriftPaths: [...new Set(sourceDriftPaths)].sort(compareStrings),
    unchangedPaths: unchanged,
  };
}

async function findLockItemForOutputPath(
  rootPath: string,
  outputPath: string
): Promise<LockItemState | undefined> {
  for (const lockPath of lockCandidates(outputPath)) {
    const parsed = await readLock(rootPath, lockPath);
    if (parsed === undefined) continue;
    for (const item of parsed.items) {
      const outputPaths = item.files.map((file) => joinOutputRoot(parsed.outputRoot, file));
      if (!outputPaths.includes(outputPath)) continue;
      return {
        files: item.files.map((file) => ({
          displayPath: joinOutputRoot(parsed.outputRoot, file),
          file,
        })),
        lockPath,
        ...(item.outputHash === undefined ? {} : { outputHash: item.outputHash }),
        ...(item.renderInputsHash === undefined ? {} : { renderInputsHash: item.renderInputsHash }),
        ...(item.sourceHash === undefined ? {} : { sourceHash: item.sourceHash }),
        ...(item.version === undefined ? {} : { version: item.version }),
      };
    }
  }
  return undefined;
}

async function readLock(rootPath: string, lockPath: string): Promise<ParsedLock | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolveInside(rootPath, lockPath), "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.outputRoot !== "string" || !Array.isArray(parsed.items)) {
    return undefined;
  }
  const items: ParsedLockItem[] = [];
  for (const item of parsed.items) {
    if (!isRecord(item) || !Array.isArray(item.files)) continue;
    const files = item.files.filter((file): file is string => typeof file === "string" && file.length > 0);
    if (files.length === 0) continue;
    const outputHash = typeof item.outputHash === "string" ? item.outputHash : undefined;
    const renderInputsHash = typeof item.renderInputsHash === "string" ? item.renderInputsHash : undefined;
    const sourceHash = typeof item.sourceHash === "string" ? item.sourceHash : undefined;
    const version = typeof item.version === "string" ? item.version : undefined;
    items.push({
      files,
      ...(outputHash === undefined ? {} : { outputHash }),
      ...(renderInputsHash === undefined ? {} : { renderInputsHash }),
      ...(sourceHash === undefined ? {} : { sourceHash }),
      ...(version === undefined ? {} : { version }),
    });
  }
  return { items, outputRoot: parsed.outputRoot };
}

async function currentOutputHash(
  rootPath: string,
  item: LockItemState
): Promise<string | undefined> {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");

  for (const entry of item.files) {
    let content: Uint8Array;
    try {
      content = await readFile(resolveInside(rootPath, entry.displayPath));
    } catch {
      return undefined;
    }
    hash.update(entry.file);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

function lockCandidates(outputPath: string): readonly string[] {
  const candidates: string[] = [];
  let current = dirname(outputPath);
  while (current !== "." && current !== "") {
    candidates.push(`${current}/skillset.lock`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push("skillset.lock");
  return candidates;
}

function joinOutputRoot(outputRoot: string, path: string): string {
  if (outputRoot === ".") return normalizePath(path);
  return normalizePath(join(outputRoot, path));
}

function resolveInside(rootPath: string, path: string): string {
  const resolvedRootPath = resolve(rootPath);
  const resolvedPath = resolve(resolvedRootPath, path);
  const relativePath = relative(resolvedRootPath, resolvedPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return resolvedPath;
  }
  throw new Error(`skillset: path escapes root ${path}`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unplannedProviderDriftPaths(
  driftPaths: readonly string[],
  safeUpdates: readonly ProviderFormatUpdateAction[],
  manualReviews: readonly ProviderFormatUpdateAction[]
): readonly string[] {
  const covered = new Set<string>();
  for (const action of [...safeUpdates, ...manualReviews]) {
    for (const path of action.affectedPaths) covered.add(path);
  }
  if (safeUpdates.length > 0) {
    for (const path of driftPaths) {
      if (path === "skillset.lock" || path.endsWith("/skillset.lock")) covered.add(path);
    }
  }
  return driftPaths.filter((path) => !covered.has(path)).sort(compareStrings);
}

function allDriftPaths(diff: SkillsetDiff): readonly string[] {
  return [...new Set([...diff.added, ...diff.changed, ...diff.missing, ...diff.removed])].sort(compareStrings);
}

function actionKey(action: ProviderFormatUpdateAction): string {
  return [
    action.id,
    action.snapshotId,
    action.sourceUnit,
    ...action.affectedPaths,
  ].join("\0");
}

function compareActions(left: ProviderFormatUpdateAction, right: ProviderFormatUpdateAction): number {
  return compareStrings(actionKey(left), actionKey(right));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ParsedLock {
  readonly items: readonly ParsedLockItem[];
  readonly outputRoot: string;
}

interface ParsedLockItem {
  readonly files: readonly string[];
  readonly outputHash?: string;
  readonly renderInputsHash?: string;
  readonly sourceHash?: string;
  readonly version?: string;
}

interface LockItemState {
  readonly files: readonly LockFileEntry[];
  readonly lockPath: string;
  readonly outputHash?: string;
  readonly renderInputsHash?: string;
  readonly sourceHash?: string;
  readonly version?: string;
}

interface LockFileEntry {
  readonly displayPath: string;
  readonly file: string;
}
