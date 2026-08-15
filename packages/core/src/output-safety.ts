import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, rmdir, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";

import { readOutputConfig, readSkillsetMetadata, targetNames } from "./config";
import { compareStrings, resolveInside } from "./path";
import {
  formatGeneratedFileMode,
  supportsGeneratedFileModes,
} from "./generated-file-mode";
import { renderValidatedJson } from "./structured-output";
import type { SkillsetDiagnostic, SkillsetWriteSummary } from "./operation-result";
import {
  createOperationalPathContext,
  logicalOperationalPath,
  resolveOperationalPath,
} from "./operational-cache";
import type { JsonRecord, RenderedFile, SkillsetOptions } from "./types";
import { isJsonRecord, parseYamlRecord } from "./yaml";
import { readSkillsetWorkspaceConfig } from "./xdg";

export const WORKSPACE_LOCK_FILE = "skillset.lock";
export const OUTPUT_BACKUP_ROOT = ".skillset/snapshots";

export type OutPath = (path: string) => string;
export type OutputPathResolver = (path: string) => string;
export type OutputPathDisplayMapper = (absolutePath: string) => string;

export interface ManagedOutputState {
  readonly editedPaths: ReadonlySet<string>;
  readonly hasBaseline: boolean;
  readonly paths: ReadonlySet<string>;
}

export type OutputBackupReason = "managed-target-edit" | "unmanaged-collision";
export type OutputBackupAction = "delete" | "overwrite";

export interface OutputBackupRecord {
  readonly action: OutputBackupAction;
  readonly backupPath: string;
  readonly generatedHash?: string;
  readonly generatedMode?: string;
  readonly originalHash: string;
  readonly originalMode?: string;
  readonly reason: OutputBackupReason;
  readonly sourcePath?: string;
  readonly targetPath: string;
}

export type OutputBackupPlanRecord = Omit<OutputBackupRecord, "backupPath">;

export type OutputWritePreimage =
  | {
      readonly state: "absent";
      readonly targetPath: string;
    }
  | {
      readonly content: Uint8Array;
      readonly mode?: string;
      readonly state: "present";
      readonly targetPath: string;
    };

export interface OutputBackupPlan {
  readonly preflightDiagnostics: readonly SkillsetDiagnostic[];
  readonly preimages: readonly OutputWritePreimage[];
  readonly records: readonly (OutputBackupPlanRecord & {
    readonly content: Uint8Array;
  })[];
}

export interface OutputBackupGitStorage {
  readonly commit: string;
  readonly gitDir: string;
  readonly kind: "git";
  readonly ref: string;
}

export interface OutputBackupManifest {
  readonly generatedBy: string;
  readonly records: readonly OutputBackupRecord[];
  readonly runHash: string;
  readonly runId: string;
  readonly schemaVersion: 2;
  readonly storage: OutputBackupGitStorage;
}

export interface OutputBackupSummary {
  readonly manifestPath: string;
  readonly records: readonly OutputBackupRecord[];
  readonly runHash: string;
  readonly runId: string;
}

export interface OutputBackupRestoreReport {
  readonly manifestPath: string;
  readonly restoredPaths: readonly string[];
  readonly runId: string;
  readonly write: boolean;
}

export type OutputBackupInspectionState =
  | "restorable-now"
  | "blocked-by-current-target"
  | "corrupt-or-unavailable";

export interface OutputBackupInspectionRecord {
  readonly action?: OutputBackupAction;
  readonly detail?: string;
  readonly reason?: OutputBackupReason;
  readonly sourcePath?: string;
  readonly state: OutputBackupInspectionState;
  readonly targetPath?: string;
}

export interface OutputBackupInspectionRun {
  readonly detail?: string;
  readonly manifestPath: string;
  readonly records: readonly OutputBackupInspectionRecord[];
  readonly runId: string;
  readonly state: OutputBackupInspectionState;
}

export interface OutputBackupInspectionReport {
  readonly runs: readonly OutputBackupInspectionRun[];
}

interface OutputBackupManifestEnvelope extends Omit<OutputBackupManifest, "records"> {
  readonly rawRecords: readonly unknown[];
}

interface ParsedLock {
  readonly items: readonly ParsedLockItem[];
  readonly legacyRoot?: boolean;
  readonly schemaVersion: 1 | 2;
}

interface ParsedLockItem {
  readonly fileModes?: Readonly<Record<string, "0644" | "0755">>;
  readonly files: readonly string[];
  readonly outputHash?: string;
}

interface LockFileEntry {
  readonly displayPath: string;
  readonly file: string;
}

export async function readManagedOutputState(
  rootPath: string,
  liveOutputRoots: readonly string[],
  includeWorkspaceLock: boolean,
  outPath: OutPath,
  resolveOutputPath: OutputPathResolver = (path) => resolveInside(rootPath, path),
  displayOutputPath: OutputPathDisplayMapper = (absolutePath) => relative(rootPath, absolutePath)
): Promise<ManagedOutputState> {
  const paths = new Set<string>();
  const editedPaths = new Set<string>();
  let hasBaseline = false;

  if (includeWorkspaceLock) {
    hasBaseline = (await addManagedPathsFromLock(WORKSPACE_LOCK_FILE, ".", outPath, paths, editedPaths, resolveOutputPath, displayOutputPath)) || hasBaseline;
  }

  for (const outputRoot of liveOutputRoots) {
    hasBaseline = (await addManagedPathsFromLock(join(outputRoot, WORKSPACE_LOCK_FILE), outputRoot, outPath, paths, editedPaths, resolveOutputPath, displayOutputPath)) || hasBaseline;
  }

  return { editedPaths, hasBaseline, paths };
}

/**
 * Recover scoped baseline evidence without loading the source graph. This is
 * deliberately narrower than graph resolution: a malformed source unit must
 * not hide already-managed output from read-only status and readiness checks.
 */
export async function independentlyObservedOutputBaseline(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<boolean> {
  const configPath = join(rootPath, "skillset.yaml");
  let config: JsonRecord = {};
  try {
    config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  } catch {
    // Fixed default roots remain independently observable without config.
  }

  let workspaceCacheKey: string | undefined;
  try {
    workspaceCacheKey = readSkillsetWorkspaceConfig(config, configPath).cacheKey;
  } catch {
    // A malformed workspace stanza cannot invalidate ordinary local evidence.
  }

  let outputs = readOutputConfig(
    {},
    {},
    options.distDir === undefined ? {} : { distDir: options.distDir }
  );
  try {
    outputs = readOutputConfig(
      config,
      readSkillsetMetadata(config, configPath),
      options.distDir === undefined ? {} : { distDir: options.distDir }
    );
  } catch {
    // Invalid output configuration falls back to fixed default roots only.
  }

  const scopes = options.scopes;
  const includesScope = (scope: "plugins" | "project" | "repo") =>
    scopes === undefined || scopes.includes(scope);
  const includedTargets = new Set(options.targetFilter ?? targetNames());
  const outputRoots = new Set<string>();
  if (includesScope("plugins")) {
    for (const target of targetNames()) {
      if (includedTargets.has(target)) outputRoots.add(outputs.plugins[target]);
    }
    addDeclaredProviderOutputRoots(
      outputRoots,
      config,
      "plugins",
      rootPath,
      includedTargets
    );
  }
  if (includesScope("repo")) {
    for (const target of targetNames()) {
      if (includedTargets.has(target)) outputRoots.add(outputs.skills[target]);
    }
    addDeclaredProviderOutputRoots(
      outputRoots,
      config,
      "skills",
      rootPath,
      includedTargets
    );
  }

  const outPath = options.isolated === true
    ? (path: string) => join(".skillset/cache/latest", path)
    : (path: string) => path;
  const pathContext = createOperationalPathContext(rootPath, {
    ...(workspaceCacheKey === undefined ? {} : { workspaceCacheKey }),
    ...(options.xdg?.env === undefined ? {} : { env: options.xdg.env }),
    ...(options.xdg?.homeDir === undefined ? {} : { homeDir: options.xdg.homeDir }),
  });
  const inspect = async (
    liveOutputRoots: readonly string[],
    includeWorkspaceLock: boolean
  ): Promise<boolean> => {
    try {
      return (await readManagedOutputState(
        rootPath,
        liveOutputRoots,
        includeWorkspaceLock,
        outPath,
        (path) => resolveOperationalPath(pathContext, path),
        (path) => logicalOperationalPath(pathContext, path)
      )).hasBaseline;
    } catch {
      return false;
    }
  };

  if (includesScope("project") && await inspect([], true)) return true;
  for (const outputRoot of [...outputRoots].sort(compareStrings)) {
    if (await inspect([outputRoot], false)) return true;
  }
  return false;
}

function addDeclaredProviderOutputRoots(
  outputRoots: Set<string>,
  config: JsonRecord,
  surface: "plugins" | "skills",
  rootPath: string,
  includedTargets: ReadonlySet<string>
): void {
  for (const target of targetNames()) {
    if (!includedTargets.has(target)) continue;
    const targetConfig = config[target];
    if (!isJsonRecord(targetConfig)) continue;
    const output = targetConfig[surface];
    if (!isJsonRecord(output)) continue;
    const path = output.path;
    if (typeof path !== "string" || path.trim().length === 0) continue;
    try {
      resolveInside(rootPath, path);
      outputRoots.add(path);
    } catch {
      // Graph validation owns invalid output-path diagnostics.
    }
  }
}

export async function prepareOutputBackups(
  rootPath: string,
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState,
  resolveOutputPath: OutputPathResolver = (path) => resolveInside(rootPath, path)
): Promise<{
  readonly backup?: OutputBackupSummary;
  readonly diagnostics: readonly SkillsetDiagnostic[];
}> {
  return persistOutputBackupPlan(
    rootPath,
    await planOutputBackups(
      rootPath,
      rendered,
      deletePaths,
      managedState,
      resolveOutputPath
    )
  );
}

export async function planOutputBackups(
  rootPath: string,
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState,
  resolveOutputPath: OutputPathResolver = (path) => resolveInside(rootPath, path)
): Promise<OutputBackupPlan> {
  const [caseOnlyManagedInspection, preflightDiagnostics, preimages] =
    await Promise.all([
      inspectCaseOnlyManagedAliases(
        rendered,
        deletePaths,
        managedState,
        resolveOutputPath
      ),
      diagnoseOutputShapeCollisions(rendered, deletePaths, resolveOutputPath),
      collectOutputWritePreimages(
        [...rendered.map((file) => file.path), ...deletePaths],
        resolveOutputPath
      ),
    ]);
  return {
    preflightDiagnostics,
    preimages,
    records: collectOutputBackupRecords(
      rendered,
      deletePaths,
      managedState,
      new Map(preimages.map((preimage) => [preimage.targetPath, preimage])),
      caseOnlyManagedInspection
    ),
  };
}

export async function persistOutputBackupPlan(
  rootPath: string,
  plan: OutputBackupPlan
): Promise<{
  readonly backup?: OutputBackupSummary;
  readonly diagnostics: readonly SkillsetDiagnostic[];
}> {
  const { records } = plan;

  if (records.length === 0) return { diagnostics: [] };

  const seed = {
    now: new Date().toISOString(),
    records: records.map(({ content: _content, ...record }) => record).sort((left, right) => compareStrings(left.targetPath, right.targetPath)),
    random: randomUUID(),
  };
  const runHash = `sha256:${createHash("sha256").update(JSON.stringify(seed)).digest("hex")}`;
  const runId = runHash.slice("sha256:".length, "sha256:".length + 12);
  const manifestPath = join(OUTPUT_BACKUP_ROOT, runId, "manifest.json");
  const { records: finalized, storage } = await writeGitBackupStorage(rootPath, runId, records);

  const manifest: OutputBackupManifest = {
    generatedBy: "skillset@0.1.0",
    records: finalized,
    runHash,
    runId,
    schemaVersion: 2 as const,
    storage,
  };
  const absoluteManifestPath = resolveInside(rootPath, manifestPath);
  await mkdir(dirname(absoluteManifestPath), { recursive: true });
  await writeFile(absoluteManifestPath, renderValidatedJson(manifest as unknown as JsonRecord, manifestPath), "utf8");

  return {
    backup: { manifestPath, records: finalized, runHash, runId },
    diagnostics: finalized.map((record) => backupDiagnostic(record, runId, manifestPath)),
  };
}

export async function discardOutputBackup(
  rootPath: string,
  backup: OutputBackupSummary
): Promise<void> {
  if (!/^[a-f0-9]{8,64}$/.test(backup.runId)) {
    throw new Error(`skillset: cannot discard invalid backup id ${JSON.stringify(backup.runId)}`);
  }
  await rm(resolveInside(rootPath, join(OUTPUT_BACKUP_ROOT, backup.runId)), {
    force: true,
    recursive: true,
  });
  try {
    await rmdir(resolveInside(rootPath, OUTPUT_BACKUP_ROOT));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
    ) throw error;
  }
}

export async function diagnoseOutputBackupPreflight(
  rootPath: string,
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState,
  resolveOutputPath: OutputPathResolver = (path) => resolveInside(rootPath, path)
): Promise<readonly SkillsetDiagnostic[]> {
  const plan = await planOutputBackups(
    rootPath,
    rendered,
    deletePaths,
    managedState,
    resolveOutputPath
  );
  return diagnoseOutputBackupPlan(plan);
}

export function diagnoseOutputBackupPlan(
  plan: OutputBackupPlan
): readonly SkillsetDiagnostic[] {
  return [
    ...plan.preflightDiagnostics,
    ...plan.records.map(preflightBackupDiagnostic),
  ];
}

export async function restoreOutputBackup(
  rootPath: string,
  runId: string,
  options: { readonly write?: boolean } = {}
): Promise<OutputBackupRestoreReport> {
  if (!/^[a-f0-9]{8,64}$/.test(runId)) {
    throw new Error(`skillset: expected backup id to be a lowercase hex ref, received ${JSON.stringify(runId)}`);
  }

  const manifestPath = join(OUTPUT_BACKUP_ROOT, runId, "manifest.json");
  const manifest = await readBackupManifest(rootPath, manifestPath, runId);
  await assertBackupStorage(rootPath, manifest);
  const restoredPaths: string[] = [];
  const backupContents = new Map<string, Uint8Array>();

  for (const record of manifest.records) {
    const targetPath = resolveInside(rootPath, record.targetPath);
    const backupContent = await readBackupContent(rootPath, manifest, record);
    assertBackupPayloadIntegrity(record, backupContent);
    await assertRestoreTargetIsSafe(record, targetPath);
    backupContents.set(record.targetPath, backupContent);
    restoredPaths.push(record.targetPath);
  }

  if (options.write === true) {
    for (const record of manifest.records) {
      const targetPath = resolveInside(rootPath, record.targetPath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, backupContents.get(record.targetPath) ?? (await readBackupContent(rootPath, manifest, record)));
      if (record.originalMode !== undefined && supportsGeneratedFileModes()) {
        await chmod(targetPath, Number.parseInt(record.originalMode, 8));
      }
    }
  }

  return {
    manifestPath,
    restoredPaths: restoredPaths.sort(compareStrings),
    runId,
    write: options.write === true,
  };
}

/**
 * Read backup state without creating snapshot roots or changing the filesystem.
 *
 * Each existing snapshot directory is isolated so that one damaged backup does
 * not hide independently inspectable siblings. A run is selectable only when
 * every one of its records is restorable at the instant of inspection; restore
 * repeats these guards immediately before it writes to remain race-safe.
 */
export async function inspectOutputBackups(rootPath: string): Promise<OutputBackupInspectionReport> {
  const backupRoot = resolveInside(rootPath, OUTPUT_BACKUP_ROOT);
  let entries: readonly Dirent[];
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return { runs: [] };
    throw error;
  }

  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .toSorted((left, right) => compareStrings(left.name, right.name))
      .map((entry) => inspectOutputBackupRun(rootPath, entry.name))
  );
  return { runs };
}

export function withBackupSummary(
  summary: SkillsetWriteSummary,
  backup: OutputBackupSummary | undefined
): SkillsetWriteSummary {
  if (backup === undefined) return summary;
  return {
    ...summary,
    backupManifestPath: backup.manifestPath,
    backupRecords: backup.records,
    backupRunId: backup.runId,
  };
}

async function addManagedPathsFromLock(
  lockPath: string,
  expectedOutputRoot: string,
  outPath: OutPath,
  paths: Set<string>,
  editedPaths: Set<string>,
  resolveOutputPath: OutputPathResolver,
  displayOutputPath: OutputPathDisplayMapper
): Promise<boolean> {
  const displayLockPath = outPath(lockPath);
  const absoluteLockPath = resolveOutputPath(displayLockPath);
  if (!(await exists(absoluteLockPath))) return false;

  const lock = await readManagedLock(lockPath, displayLockPath, expectedOutputRoot, resolveOutputPath);
  paths.add(displayLockPath);

  if (lock.legacyRoot === true) {
    const displayOutputRoot = outPath(expectedOutputRoot);
    for (const file of await collectFiles(resolveOutputPath(displayOutputRoot))) {
      paths.add(displayOutputPath(file));
    }
  }

  for (const item of lock.items) {
    const files = item.files
      .map((file) => ({ displayPath: outPath(joinOutputRoot(expectedOutputRoot, file)), file }))
      .sort((left, right) => compareStrings(left.file, right.file));
    for (const file of files) paths.add(file.displayPath);
    if (item.outputHash === undefined) continue;
    const currentHash = await currentOutputHash(files, item, lock.schemaVersion, resolveOutputPath);
    if (currentHash === undefined) {
      for (const file of files) {
        if (await exists(resolveOutputPath(file.displayPath))) editedPaths.add(file.displayPath);
      }
      continue;
    }
    if (currentHash === item.outputHash) continue;
    for (const file of files) editedPaths.add(file.displayPath);
  }
  return lock.items.some((item) => item.outputHash !== undefined);
}

async function readManagedLock(
  lockPath: string,
  displayLockPath: string,
  expectedOutputRoot: string,
  resolveOutputPath: OutputPathResolver
): Promise<ParsedLock> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolveOutputPath(displayLockPath), "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corruptManagedLock(lockPath, displayLockPath, `it is not valid JSON: ${message}`);
  }

  if (!isRecord(parsed) || typeof parsed.generatedBy !== "string") {
    throw corruptManagedLock(lockPath, displayLockPath, "it is missing a string generatedBy field");
  }
  if (!parsed.generatedBy.startsWith("skillset@")) {
    throw corruptManagedLock(lockPath, displayLockPath, `its generatedBy ${JSON.stringify(parsed.generatedBy)} is not a skillset lock`);
  }
  if (
    lockPath !== WORKSPACE_LOCK_FILE &&
    parsed.outputRoot === undefined &&
    parsed.items === undefined
  ) {
    return { items: [], legacyRoot: true, schemaVersion: 1 };
  }
  if (parsed.outputRoot !== expectedOutputRoot) {
    const expected = expectedOutputRoot === "." ? "the workspace root" : JSON.stringify(expectedOutputRoot);
    throw corruptManagedLock(lockPath, displayLockPath, `its outputRoot ${JSON.stringify(parsed.outputRoot)} is not ${expected}`);
  }
  if (!Array.isArray(parsed.items)) {
    throw corruptManagedLock(lockPath, displayLockPath, "its items field is not an array");
  }

  const schemaVersion = parsed.schemaVersion === 2 ? 2 : 1;
  return {
    items: parsed.items.map((item) => parseLockItem(lockPath, displayLockPath, item, schemaVersion)),
    schemaVersion,
  };
}

function parseLockItem(
  lockPath: string,
  displayLockPath: string,
  value: unknown,
  schemaVersion: 1 | 2
): ParsedLockItem {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw corruptManagedLock(lockPath, displayLockPath, "one of its items is missing a files array");
  }
  const files = value.files.map((file) => {
    if (typeof file !== "string" || file.trim().length === 0) {
      throw corruptManagedLock(lockPath, displayLockPath, "one of its tracked file entries is not a non-empty string");
    }
    return file;
  });
  const outputHash = value.outputHash;
  if (outputHash !== undefined && typeof outputHash !== "string") {
    throw corruptManagedLock(lockPath, displayLockPath, "one of its items has a non-string outputHash");
  }
  const fileModes = parseLockFileModes(lockPath, displayLockPath, value.fileModes, files, schemaVersion);
  return {
    ...(fileModes === undefined ? {} : { fileModes }),
    files,
    ...(outputHash === undefined ? {} : { outputHash }),
  };
}

function parseLockFileModes(
  lockPath: string,
  displayLockPath: string,
  value: unknown,
  files: readonly string[],
  schemaVersion: 1 | 2
): Readonly<Record<string, "0644" | "0755">> | undefined {
  if (schemaVersion === 1 && value === undefined) return undefined;
  if (!isRecord(value)) {
    throw corruptManagedLock(lockPath, displayLockPath, "one of its v2 items is missing a fileModes object");
  }
  const modes: Record<string, "0644" | "0755"> = {};
  for (const [file, mode] of Object.entries(value)) {
    if ((mode !== "0644" && mode !== "0755")) {
      throw corruptManagedLock(lockPath, displayLockPath, "one of its items has invalid fileModes evidence");
    }
    modes[file] = mode;
  }
  if (files.some((file) => modes[file] === undefined)) {
    throw corruptManagedLock(lockPath, displayLockPath, "one of its v2 items has incomplete fileModes evidence");
  }
  return modes;
}

async function currentOutputHash(
  files: readonly LockFileEntry[],
  item: ParsedLockItem,
  schemaVersion: 1 | 2,
  resolveOutputPath: OutputPathResolver
): Promise<string | undefined> {
  const hash = createHash("sha256");
  hash.update(schemaVersion === 2 ? "skillset-output-v2\0" : "skillset-output-v1\0");

  for (const entry of files) {
    const outputPath = resolveOutputPath(entry.displayPath);
    if (!(await exists(outputPath))) return undefined;
    hash.update(entry.file);
    hash.update("\0");
    if (schemaVersion === 2) {
      const expectedMode = item.fileModes?.[entry.file];
      if (expectedMode === undefined) return undefined;
      const mode = supportsGeneratedFileModes()
        ? ((await stat(outputPath)).mode & 0o777).toString(8).padStart(4, "0")
        : expectedMode;
      hash.update(mode);
      hash.update("\0");
    }
    hash.update(await readFile(outputPath));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

function collectOutputBackupRecords(
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState,
  preimages: ReadonlyMap<string, OutputWritePreimage>,
  caseOnlyManagedInspection: Awaited<
    ReturnType<typeof inspectCaseOnlyManagedAliases>
  >
): Array<OutputBackupPlanRecord & { readonly content: Uint8Array }> {
  const records: Array<OutputBackupPlanRecord & { readonly content: Uint8Array }> = [];
  const renderedByPath = new Map(rendered.map((file) => [file.path, file]));
  const caseOnlyManagedAliases = caseOnlyManagedInspection.aliases;
  const caseOnlyManagedAliasSources = new Set(
    caseOnlyManagedAliases.values()
  );

  for (const file of rendered) {
    const preimage = preimages.get(file.path);
    if (preimage?.state !== "present") continue;
    const current = preimage.content;
    const managedPath = managedState.paths.has(file.path)
      ? file.path
      : caseOnlyManagedAliases.get(file.path);
    const matchesRendered = bytesEqual(current, file.content) &&
      (!supportsGeneratedFileModes() ||
        preimage.mode === formatGeneratedFileMode(file.mode));
    if (managedPath !== undefined && matchesRendered) continue;
    if (
      managedPath === undefined &&
      !caseOnlyManagedInspection.targets.has(file.path) &&
      matchesRendered
    ) {
      continue;
    }

    const reason = managedPath !== undefined
      ? managedState.editedPaths.has(managedPath)
        ? "managed-target-edit"
        : undefined
      : "unmanaged-collision";
    if (reason === undefined) continue;

    records.push({
      action: "overwrite",
      content: current,
      generatedHash: contentHash(file.content),
      ...(supportsGeneratedFileModes() ? { generatedMode: formatGeneratedFileMode(file.mode) } : {}),
      originalHash: contentHash(current),
      ...(preimage.mode === undefined ? {} : { originalMode: preimage.mode }),
      reason,
      ...(file.sourcePath === undefined ? {} : { sourcePath: canonicalBackupRecordPath(file.sourcePath) }),
      targetPath: canonicalBackupRecordPath(file.path),
    });
  }

  for (const targetPath of deletePaths) {
    if (caseOnlyManagedAliasSources.has(targetPath)) continue;
    if (!managedState.editedPaths.has(targetPath)) continue;
    if (renderedByPath.has(targetPath)) continue;
    const preimage = preimages.get(targetPath);
    if (preimage?.state !== "present") continue;
    const current = preimage.content;
    records.push({
      action: "delete",
      content: current,
      originalHash: contentHash(current),
      ...(preimage.mode === undefined ? {} : { originalMode: preimage.mode }),
      reason: "managed-target-edit",
      targetPath: canonicalBackupRecordPath(targetPath),
    });
  }

  return records.sort((left, right) => compareStrings(left.targetPath, right.targetPath));
}

async function diagnoseOutputShapeCollisions(
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  resolveOutputPath: OutputPathResolver
): Promise<readonly SkillsetDiagnostic[]> {
  const diagnostics: SkillsetDiagnostic[] = [];
  for (const file of rendered) {
    const absolutePath = resolveOutputPath(file.path);
    const entry = await lstat(absolutePath).catch((error: unknown) => {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    });
    if (entry === undefined || entry.isFile()) {
      continue;
    }
    if (!entry.isDirectory()) {
      diagnostics.push(outputShapeCollisionDiagnostic(file.path));
      continue;
    }
    const collision = await firstUnmanagedDirectoryEntry(
      absolutePath,
      file.path,
      deletePaths
    );
    if (collision !== undefined) {
      diagnostics.push(outputShapeCollisionDiagnostic(collision));
    }
  }
  return diagnostics;
}

async function firstUnmanagedDirectoryEntry(
  absoluteDirectory: string,
  logicalDirectory: string,
  deletePaths: readonly string[]
): Promise<string | undefined> {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) =>
    compareStrings(left.name, right.name)
  )) {
    const logicalPath = `${logicalDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      return logicalPath;
    }
    const coveredByDelete = deletePaths.some(
      (path) => path === logicalPath || logicalPath.startsWith(`${path}/`)
    );
    if (coveredByDelete) {
      continue;
    }
    const containsManagedDelete = deletePaths.some((path) =>
      path.startsWith(`${logicalPath}/`)
    );
    if (entry.isDirectory() && containsManagedDelete) {
      const nested = await firstUnmanagedDirectoryEntry(
        join(absoluteDirectory, entry.name),
        logicalPath,
        deletePaths
      );
      if (nested === undefined) {
        continue;
      }
      return nested;
    }
    return logicalPath;
  }
  return undefined;
}

function outputShapeCollisionDiagnostic(path: string): SkillsetDiagnostic {
  return {
    code: "unmanaged-output-collision",
    featureId: "output-safety",
    message: `existing output shape is not fully owned by Skillset; refusing to replace ${path}`,
    outputPath: path,
    severity: "error",
  };
}

async function inspectCaseOnlyManagedAliases(
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState,
  resolveOutputPath: OutputPathResolver
): Promise<{
  readonly aliases: ReadonlyMap<string, string>;
  readonly targets: ReadonlySet<string>;
}> {
  const renderedByCase = new Map<string, RenderedFile[]>();
  const staleManagedByCase = new Map<string, string[]>();
  for (const file of rendered) {
    const key = file.path.toLowerCase();
    renderedByCase.set(key, [...(renderedByCase.get(key) ?? []), file]);
  }
  for (const path of deletePaths) {
    if (!managedState.paths.has(path)) continue;
    const key = path.toLowerCase();
    staleManagedByCase.set(key, [
      ...(staleManagedByCase.get(key) ?? []),
      path,
    ]);
  }

  const aliases = new Map<string, string>();
  const candidateTargets = new Set<string>();
  for (const [key, renderedTargets] of renderedByCase) {
    const sources = staleManagedByCase.get(key) ?? [];
    if (renderedTargets.length !== 1 || sources.length !== 1) continue;
    const target = renderedTargets[0]?.path;
    const source = sources[0];
    if (target === undefined || source === undefined || target === source) {
      continue;
    }
    candidateTargets.add(target);
    try {
      const [sourcePath, targetPath] = await Promise.all([
        realpath(resolveOutputPath(source)),
        realpath(resolveOutputPath(target)),
      ]);
      if (sourcePath === targetPath) aliases.set(target, source);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return { aliases, targets: candidateTargets };
}

async function collectOutputWritePreimages(
  targetPaths: readonly string[],
  resolveOutputPath: OutputPathResolver
): Promise<readonly OutputWritePreimage[]> {
  const preimages: OutputWritePreimage[] = [];
  for (const targetPath of [...new Set(targetPaths)].sort(compareStrings)) {
    const absolutePath = resolveOutputPath(targetPath);
    const entry = await lstat(absolutePath).catch((error: unknown) => {
      if (isNotFound(error)) return;
      throw error;
    });
    if (entry === undefined) {
      preimages.push({ state: "absent", targetPath });
      continue;
    }
    if (entry.isDirectory()) continue;
    const content = await readFile(absolutePath);
    const currentStats = await stat(absolutePath);
    preimages.push({
      content,
      ...(supportsGeneratedFileModes()
        ? { mode: formatDiskMode(currentStats.mode) }
        : {}),
      state: "present",
      targetPath,
    });
  }
  return preimages;
}

function preflightBackupDiagnostic(record: OutputBackupPlanRecord): SkillsetDiagnostic {
  const reason = record.reason === "managed-target-edit"
    ? "existing generated output differs from the previous lock"
    : "existing file is not owned by Skillset";
  return {
    code: record.reason === "managed-target-edit" ? "managed-output-edited" : "unmanaged-output-collision",
    featureId: "output-safety",
    message: `${reason}; ${record.targetPath} will be backed up before ${record.action}`,
    outputPath: record.targetPath,
    severity: "warning",
  };
}

function backupDiagnostic(record: OutputBackupRecord, runId: string, manifestPath: string): SkillsetDiagnostic {
  const reason = record.reason === "managed-target-edit"
    ? "existing generated output differs from the previous lock"
    : "existing file is not owned by Skillset";
  return {
    code: record.reason === "managed-target-edit" ? "managed-output-edited" : "unmanaged-output-collision",
    featureId: "output-safety",
    message: `${reason}; backed up ${record.targetPath} before ${record.action} (${runId}, ${manifestPath})`,
    outputPath: record.targetPath,
    severity: "warning",
  };
}

async function writeGitBackupStorage(
  rootPath: string,
  runId: string,
  records: readonly (OutputBackupPlanRecord & { readonly content: Uint8Array })[]
): Promise<{
  readonly records: readonly OutputBackupRecord[];
  readonly storage: OutputBackupGitStorage;
}> {
  const gitDir = join(OUTPUT_BACKUP_ROOT, runId, "git");
  const absoluteGitDir = resolveInside(rootPath, gitDir);
  const ref = `refs/skillset/backups/${runId}`;
  const indexRoot = await mkdtemp(join(tmpdir(), "skillset-output-backup-index-"));
  const indexPath = join(indexRoot, "index");
  const finalized: OutputBackupRecord[] = [];

  await mkdir(dirname(absoluteGitDir), { recursive: true });
  await runGit(["init", "--bare", "-q", absoluteGitDir], { cwd: rootPath });

  try {
    for (const record of [...records].sort((left, right) => compareStrings(left.targetPath, right.targetPath))) {
      const backupPath = backupTreePath(record.targetPath);
      const object = await runGit(["--git-dir", absoluteGitDir, "hash-object", "-w", "--stdin"], {
        cwd: rootPath,
        input: record.content,
      });
      const objectId = object.stdoutText.trim();
      const gitMode = record.originalMode !== undefined && (Number.parseInt(record.originalMode, 8) & 0o111) !== 0
        ? "100755"
        : "100644";
      await runGit(["--git-dir", absoluteGitDir, "update-index", "--add", "--cacheinfo", gitMode, objectId, backupPath], {
        cwd: rootPath,
        env: { GIT_INDEX_FILE: indexPath },
      });
      const { content: _content, ...withoutContent } = record;
      finalized.push({ ...withoutContent, backupPath });
    }

    const tree = await runGit(["--git-dir", absoluteGitDir, "write-tree"], {
      cwd: rootPath,
      env: { GIT_INDEX_FILE: indexPath },
    });
    const commit = await runGit(["--git-dir", absoluteGitDir, "commit-tree", tree.stdoutText.trim(), "-m", `skillset output backup ${runId}`], {
      cwd: rootPath,
      env: gitIdentityEnv(),
    });
    const commitId = commit.stdoutText.trim();
    await runGit(["--git-dir", absoluteGitDir, "update-ref", ref, commitId], { cwd: rootPath });

    return {
      records: finalized,
      storage: {
        commit: commitId,
        gitDir,
        kind: "git",
        ref,
      },
    };
  } finally {
    await rm(indexRoot, { force: true, recursive: true });
  }
}

async function inspectOutputBackupRun(rootPath: string, runId: string): Promise<OutputBackupInspectionRun> {
  const manifestPath = join(OUTPUT_BACKUP_ROOT, runId, "manifest.json");
  let envelope: OutputBackupManifestEnvelope;
  try {
    envelope = await readBackupManifestEnvelope(rootPath, manifestPath, runId);
  } catch (error) {
    return {
      detail: inspectionDetail(error),
      manifestPath,
      records: [],
      runId,
      state: "corrupt-or-unavailable",
    };
  }

  const parsedRecords = inspectBackupRecords(manifestPath, envelope.rawRecords);
  if (parsedRecords.length === 0) {
    return {
      detail: `backup manifest ${manifestPath} has no records`,
      manifestPath,
      records: [],
      runId,
      state: "corrupt-or-unavailable",
    };
  }
  const validRecords = parsedRecords.flatMap((entry) => entry.record === undefined ? [] : [entry.record]);
  const manifest = materializeBackupManifest(envelope, validRecords);

  try {
    await assertBackupStorage(rootPath, manifest);
  } catch (error) {
    const detail = inspectionDetail(error);
    return {
      detail,
      manifestPath,
      records: parsedRecords.map((entry) => entry.record === undefined
        ? entry.inspection
        : { ...trustedBackupRecord(entry.record), detail, state: "corrupt-or-unavailable" }),
      runId,
      state: "corrupt-or-unavailable",
    };
  }

  const records = await Promise.all(
    parsedRecords.map((entry) => entry.record === undefined
      ? entry.inspection
      : inspectOutputBackupRecord(rootPath, manifest, entry.record))
  );
  const state = aggregateBackupInspectionState(records.map((record) => record.state));
  return {
    ...(state === "restorable-now" ? {} : { detail: inspectionRunDetail(state) }),
    manifestPath,
    records: records.toSorted(compareBackupInspectionRecords),
    runId,
    state,
  };
}

async function inspectOutputBackupRecord(
  rootPath: string,
  manifest: OutputBackupManifest,
  record: OutputBackupRecord
): Promise<OutputBackupInspectionRecord> {
  const trusted = trustedBackupRecord(record);

  let backupContent: Uint8Array;
  try {
    backupContent = await readBackupContent(rootPath, manifest, record);
    assertBackupPayloadIntegrity(record, backupContent);
  } catch (error) {
    return { ...trusted, detail: inspectionDetail(error), state: "corrupt-or-unavailable" };
  }

  const target = await inspectRestoreTarget(record, resolveInside(rootPath, record.targetPath));
  if (target === undefined) return { ...trusted, state: "restorable-now" };
  return { ...trusted, detail: target, state: "blocked-by-current-target" };
}

function trustedBackupRecord(record: OutputBackupRecord): Omit<OutputBackupInspectionRecord, "detail" | "state"> {
  return {
    action: record.action,
    reason: record.reason,
    ...(record.sourcePath === undefined ? {} : { sourcePath: record.sourcePath }),
    targetPath: record.targetPath,
  };
}

function aggregateBackupInspectionState(
  states: readonly OutputBackupInspectionState[]
): OutputBackupInspectionState {
  if (states.includes("corrupt-or-unavailable")) return "corrupt-or-unavailable";
  if (states.includes("blocked-by-current-target")) return "blocked-by-current-target";
  return "restorable-now";
}

function compareBackupInspectionRecords(left: OutputBackupInspectionRecord, right: OutputBackupInspectionRecord): number {
  return compareStrings(left.targetPath ?? "\uFFFF", right.targetPath ?? "\uFFFF");
}

function inspectionRunDetail(state: OutputBackupInspectionState): string {
  if (state === "blocked-by-current-target") return "one or more backup targets no longer match their generated state";
  if (state === "corrupt-or-unavailable") return "one or more backup records are corrupt or unavailable";
  return "";
}

function inspectionDetail(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^skillset: /, "") : String(error);
}

async function readBackupManifest(
  rootPath: string,
  manifestPath: string,
  expectedRunId: string
): Promise<OutputBackupManifest> {
  const envelope = await readBackupManifestEnvelope(rootPath, manifestPath, expectedRunId);
  const records = envelope.rawRecords.map((record) => parseBackupRecord(manifestPath, record));
  assertBackupRecordSet(manifestPath, records);
  return materializeBackupManifest(envelope, records);
}

async function readBackupManifestEnvelope(
  rootPath: string,
  manifestPath: string,
  expectedRunId: string
): Promise<OutputBackupManifestEnvelope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolveInside(rootPath, manifestPath), "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: cannot read backup manifest ${manifestPath}: ${message}`);
  }
  if (!isRecord(parsed) || typeof parsed.runId !== "string" || !Array.isArray(parsed.records)) {
    throw new Error(`skillset: backup manifest ${manifestPath} is malformed`);
  }
  if (parsed.schemaVersion !== 2) {
    throw new Error(`skillset: backup manifest ${manifestPath} is malformed`);
  }
  const manifest = {
    generatedBy: typeof parsed.generatedBy === "string" ? parsed.generatedBy : "",
    rawRecords: parsed.records,
    runHash: typeof parsed.runHash === "string" ? parsed.runHash : "",
    runId: parsed.runId,
    schemaVersion: 2 as const,
    storage: parseBackupStorage(manifestPath, parsed.storage),
  };
  assertBackupManifestBinding(manifestPath, expectedRunId, manifest);
  return manifest;
}

function materializeBackupManifest(
  envelope: OutputBackupManifestEnvelope,
  records: readonly OutputBackupRecord[]
): OutputBackupManifest {
  return {
    generatedBy: envelope.generatedBy,
    records,
    runHash: envelope.runHash,
    runId: envelope.runId,
    schemaVersion: envelope.schemaVersion,
    storage: envelope.storage,
  };
}

interface InspectedBackupRecord {
  readonly inspection: OutputBackupInspectionRecord;
  readonly record?: OutputBackupRecord;
}

function inspectBackupRecords(manifestPath: string, rawRecords: readonly unknown[]): readonly InspectedBackupRecord[] {
  const targetPaths = new Set<string>();
  return rawRecords.map((value) => {
    try {
      const record = parseBackupRecord(manifestPath, value);
      if (targetPaths.has(record.targetPath)) {
        return {
          inspection: {
            ...trustedBackupRecord(record),
            detail: `backup manifest ${manifestPath} has duplicate target paths`,
            state: "corrupt-or-unavailable",
          },
        };
      }
      targetPaths.add(record.targetPath);
      return { inspection: { ...trustedBackupRecord(record), state: "restorable-now" }, record };
    } catch (error) {
      return { inspection: { detail: inspectionDetail(error), state: "corrupt-or-unavailable" } };
    }
  });
}

function parseBackupRecord(manifestPath: string, value: unknown): OutputBackupRecord {
  if (!isRecord(value)) throw new Error(`skillset: backup manifest ${manifestPath} has malformed records`);
  const action = value.action;
  const backupPath = value.backupPath;
  const generatedHash = value.generatedHash;
  const generatedMode = value.generatedMode;
  const originalHash = value.originalHash;
  const originalMode = value.originalMode;
  const reason = value.reason;
  const sourcePath = value.sourcePath;
  const targetPath = value.targetPath;
  if (action !== "delete" && action !== "overwrite") throw new Error(`skillset: backup manifest ${manifestPath} has invalid action`);
  if (typeof backupPath !== "string" || typeof originalHash !== "string" || typeof targetPath !== "string") {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid paths or hashes`);
  }
  if (reason !== "managed-target-edit" && reason !== "unmanaged-collision") {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid reason`);
  }
  if (generatedHash !== undefined && typeof generatedHash !== "string") {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid generatedHash`);
  }
  if (generatedMode !== undefined && (generatedMode !== "0644" && generatedMode !== "0755")) {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid generatedMode`);
  }
  if (originalMode !== undefined && (typeof originalMode !== "string" || !/^[0-7]{4}$/.test(originalMode))) {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid originalMode`);
  }
  if (sourcePath !== undefined && typeof sourcePath !== "string") {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid sourcePath`);
  }
  if (!isSafeBackupPath(targetPath) || backupPath !== backupTreePath(targetPath) || !isContentHash(originalHash)) {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid backup path or originalHash`);
  }
  if (generatedHash !== undefined && !isContentHash(generatedHash)) {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid generatedHash`);
  }
  if (sourcePath !== undefined && !isSafeBackupPath(sourcePath)) {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid sourcePath`);
  }
  return {
    action,
    backupPath,
    ...(generatedHash === undefined ? {} : { generatedHash }),
    ...(generatedMode === undefined ? {} : { generatedMode }),
    originalHash,
    ...(originalMode === undefined ? {} : { originalMode }),
    reason,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    targetPath,
  };
}

function formatDiskMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

function assertBackupManifestBinding(
  manifestPath: string,
  expectedRunId: string,
  manifest: Pick<OutputBackupManifest, "generatedBy" | "runHash" | "runId" | "storage">
): void {
  if (!manifest.generatedBy.startsWith("skillset@")) {
    throw new Error(`skillset: backup manifest ${manifestPath} has an invalid generatedBy binding`);
  }
  if (!/^[a-f0-9]{8,64}$/.test(expectedRunId) || manifest.runId !== expectedRunId) {
    throw new Error(`skillset: backup manifest ${manifestPath} is bound to a different backup id`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.runHash) || !manifest.runHash.startsWith(`sha256:${expectedRunId}`)) {
    throw new Error(`skillset: backup manifest ${manifestPath} has an invalid runHash binding`);
  }
  if (manifest.storage.gitDir !== join(OUTPUT_BACKUP_ROOT, expectedRunId, "git")) {
    throw new Error(`skillset: backup manifest ${manifestPath} has an invalid git directory binding`);
  }
  if (manifest.storage.ref !== `refs/skillset/backups/${expectedRunId}`) {
    throw new Error(`skillset: backup manifest ${manifestPath} has an invalid git ref binding`);
  }
}

function assertBackupRecordSet(manifestPath: string, records: readonly OutputBackupRecord[]): void {
  if (records.length === 0) {
    throw new Error(`skillset: backup manifest ${manifestPath} has no records`);
  }
  const targetPaths = new Set<string>();
  for (const record of records) {
    if (targetPaths.has(record.targetPath)) {
      throw new Error(`skillset: backup manifest ${manifestPath} has duplicate target paths`);
    }
    targetPaths.add(record.targetPath);
  }
}

function isSafeBackupPath(value: string): boolean {
  return value.length > 0 &&
    !/^[a-z]:/iu.test(value) &&
    !value.includes("\\") &&
    !posix.isAbsolute(value) &&
    posix.normalize(value) === value &&
    !value.split("/").includes("..");
}

function canonicalBackupRecordPath(value: string): string {
  const canonical = value.replaceAll("\\", "/");
  if (!isSafeBackupPath(canonical)) {
    throw new Error(`skillset: refusing unsafe backup record path ${JSON.stringify(value)}`);
  }
  return canonical;
}

function backupTreePath(targetPath: string): string {
  return `files/${targetPath}`;
}

function isContentHash(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function parseBackupStorage(manifestPath: string, value: unknown): OutputBackupGitStorage {
  if (!isRecord(value)) throw new Error(`skillset: backup manifest ${manifestPath} has malformed storage`);
  const commit = value.commit;
  const gitDir = value.gitDir;
  const kind = value.kind;
  const ref = value.ref;
  if (kind !== "git" || typeof commit !== "string" || typeof gitDir !== "string" || typeof ref !== "string") {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid git storage`);
  }
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid git commit`);
  }
  return {
    commit,
    gitDir,
    kind,
    ref,
  };
}

async function readBackupContent(
  rootPath: string,
  manifest: OutputBackupManifest,
  record: OutputBackupRecord
): Promise<Uint8Array> {
  const gitDir = resolveInside(rootPath, manifest.storage.gitDir);
  if (!(await exists(gitDir))) {
    throw new Error(`skillset: backup git store is missing for ${record.targetPath}: ${manifest.storage.gitDir}`);
  }
  try {
    const object = await runGit(["--git-dir", gitDir, "show", `${manifest.storage.commit}:${record.backupPath}`], { cwd: rootPath });
    return object.stdout;
  } catch {
    throw new Error(`skillset: backup payload is unavailable for ${record.targetPath}`);
  }
}

async function assertBackupStorage(rootPath: string, manifest: OutputBackupManifest): Promise<void> {
  const gitDir = resolveInside(rootPath, manifest.storage.gitDir);
  if (!(await exists(gitDir))) {
    throw new Error(`skillset: backup git store is missing: ${manifest.storage.gitDir}`);
  }
  let ref: string;
  try {
    ref = (await runGit(["--git-dir", gitDir, "rev-parse", "--verify", manifest.storage.ref], { cwd: rootPath })).stdoutText.trim();
  } catch {
    throw new Error(`skillset: backup git ref is unavailable: ${manifest.storage.ref}`);
  }
  if (ref !== manifest.storage.commit) {
    throw new Error(`skillset: backup git ref does not match manifest commit: ${manifest.storage.ref}`);
  }
}

function assertBackupPayloadIntegrity(
  record: OutputBackupRecord,
  backupContent: Uint8Array
): void {
  const backupHash = contentHash(backupContent);
  if (backupHash !== record.originalHash) {
    throw new Error(`skillset: backup payload hash changed for ${record.targetPath}`);
  }
}

async function assertRestoreTargetIsSafe(record: OutputBackupRecord, targetPath: string): Promise<void> {
  const blocked = await inspectRestoreTarget(record, targetPath);
  if (blocked !== undefined) throw new Error(`skillset: ${blocked}`);
}

async function inspectRestoreTarget(record: OutputBackupRecord, targetPath: string): Promise<string | undefined> {
  const targetExists = await exists(targetPath);
  if (record.generatedHash === undefined) {
    if (targetExists) {
      return `refusing ambiguous restore for ${record.targetPath}; target exists after a delete backup`;
    }
    return undefined;
  }
  if (!targetExists) return undefined;
  let current: Uint8Array;
  try {
    current = await readFile(targetPath);
  } catch {
    return `refusing ambiguous restore for ${record.targetPath}; current target cannot be read`;
  }
  const currentHash = contentHash(current);
  if (currentHash !== record.generatedHash) {
    return `refusing ambiguous restore for ${record.targetPath}; target changed since backup ${record.generatedHash}`;
  }
  if (record.generatedMode !== undefined && supportsGeneratedFileModes()) {
    let currentMode: string;
    try {
      currentMode = formatDiskMode((await stat(targetPath)).mode);
    } catch {
      return `refusing ambiguous restore for ${record.targetPath}; current target mode cannot be read`;
    }
    if (currentMode !== record.generatedMode) {
      return `refusing ambiguous restore for ${record.targetPath}; target mode changed since backup ${record.generatedMode}`;
    }
  }
  return undefined;
}

function corruptManagedLock(lockPath: string, displayLockPath: string, reason: string): Error {
  if (lockPath === WORKSPACE_LOCK_FILE) return corruptWorkspaceLock(displayLockPath, reason);
  return new Error(
    `skillset: generated lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Fix or remove the lock before running build, check, or diff."
  );
}

export function corruptWorkspaceLock(displayLockPath: string, reason: string): Error {
  return new Error(
    `skillset: workspace lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
  );
}

function joinOutputRoot(outputRoot: string, file: string): string {
  if (outputRoot === "." || outputRoot === "") return file;
  return `${outputRoot}/${file}`;
}

interface GitResult {
  readonly stdout: Uint8Array;
  readonly stdoutText: string;
}

async function runGit(
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Record<string, string>;
    readonly input?: Uint8Array;
  }
): Promise<GitResult> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: options.cwd,
    env: gitCommandEnv(options.env),
    stderr: "pipe",
    stdin: options.input === undefined ? "ignore" : new Response(options.input),
    stdout: "pipe",
  });
  const [stdoutBuffer, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const stdout = new Uint8Array(stdoutBuffer);
  if (exitCode !== 0) {
    const command = ["git", ...args].join(" ");
    throw new Error(`skillset: git backup command failed (${command}): ${stderr.trim()}`);
  }
  return {
    stdout,
    stdoutText: new TextDecoder().decode(stdout),
  };
}

function gitCommandEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || isGitRepositoryEnv(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

function gitIdentityEnv(): Record<string, string> {
  return {
    GIT_AUTHOR_EMAIL: "skillset@example.invalid",
    GIT_AUTHOR_NAME: "Skillset",
    GIT_COMMITTER_EMAIL: "skillset@example.invalid",
    GIT_COMMITTER_NAME: "Skillset",
  };
}

function isGitRepositoryEnv(key: string): boolean {
  return (
    key === "GIT_DIR" ||
    key === "GIT_WORK_TREE" ||
    key === "GIT_INDEX_FILE" ||
    key === "GIT_OBJECT_DIRECTORY" ||
    key === "GIT_COMMON_DIR" ||
    key === "GIT_NAMESPACE" ||
    key.startsWith("GIT_ALTERNATE_OBJECT")
  );
}

function contentHash(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function collectFiles(root: string): Promise<readonly string[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
