import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { compareStrings, resolveInside } from "./path";
import { renderValidatedJson } from "./structured-output";
import type { SkillsetDiagnostic, SkillsetWriteSummary } from "./operation-result";
import type { JsonRecord, RenderedFile } from "./types";

export const WORKSPACE_LOCK_FILE = ".skillset.lock";
export const OUTPUT_BACKUP_ROOT = ".skillset/build/backups";

export type OutPath = (path: string) => string;

export interface ManagedOutputState {
  readonly editedPaths: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
}

export type OutputBackupReason = "managed-target-edit" | "unmanaged-collision";
export type OutputBackupAction = "delete" | "overwrite";

export interface OutputBackupRecord {
  readonly action: OutputBackupAction;
  readonly backupPath: string;
  readonly generatedHash?: string;
  readonly originalHash: string;
  readonly reason: OutputBackupReason;
  readonly sourcePath?: string;
  readonly targetPath: string;
}

export type OutputBackupPlanRecord = Omit<OutputBackupRecord, "backupPath">;

export interface OutputBackupManifest {
  readonly generatedBy: string;
  readonly records: readonly OutputBackupRecord[];
  readonly runHash: string;
  readonly runId: string;
  readonly schemaVersion: 1;
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

interface ParsedLock {
  readonly items: readonly ParsedLockItem[];
  readonly legacyRoot?: boolean;
}

interface ParsedLockItem {
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
  outPath: OutPath
): Promise<ManagedOutputState> {
  const paths = new Set<string>();
  const editedPaths = new Set<string>();

  if (includeWorkspaceLock) {
    await addManagedPathsFromLock(rootPath, WORKSPACE_LOCK_FILE, ".", outPath, paths, editedPaths);
  }

  for (const outputRoot of liveOutputRoots) {
    await addManagedPathsFromLock(rootPath, join(outputRoot, WORKSPACE_LOCK_FILE), outputRoot, outPath, paths, editedPaths);
  }

  return { editedPaths, paths };
}

export async function prepareOutputBackups(
  rootPath: string,
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState
): Promise<{
  readonly backup?: OutputBackupSummary;
  readonly diagnostics: readonly SkillsetDiagnostic[];
}> {
  const records = await collectOutputBackupRecords(rootPath, rendered, deletePaths, managedState);

  if (records.length === 0) return { diagnostics: [] };

  const seed = {
    now: new Date().toISOString(),
    records: records.map(({ content: _content, ...record }) => record).sort((left, right) => compareStrings(left.targetPath, right.targetPath)),
    random: randomUUID(),
  };
  const runHash = `sha256:${createHash("sha256").update(JSON.stringify(seed)).digest("hex")}`;
  const runId = runHash.slice("sha256:".length, "sha256:".length + 12);
  const manifestPath = join(OUTPUT_BACKUP_ROOT, runId, "manifest.json");
  const finalized: OutputBackupRecord[] = [];

  for (const record of records.sort((left, right) => compareStrings(left.targetPath, right.targetPath))) {
    const backupPath = join(OUTPUT_BACKUP_ROOT, runId, "files", `${record.targetPath}.bak.${runId}`);
    const absoluteBackupPath = resolveInside(rootPath, backupPath);
    await mkdir(dirname(absoluteBackupPath), { recursive: true });
    await writeFile(absoluteBackupPath, record.content);
    const { content: _content, ...withoutContent } = record;
    finalized.push({ ...withoutContent, backupPath });
  }

  const manifest: OutputBackupManifest = {
    generatedBy: "skillset@0.1.0",
    records: finalized,
    runHash,
    runId,
    schemaVersion: 1,
  };
  const absoluteManifestPath = resolveInside(rootPath, manifestPath);
  await mkdir(dirname(absoluteManifestPath), { recursive: true });
  await writeFile(absoluteManifestPath, renderValidatedJson(manifest as unknown as JsonRecord, manifestPath), "utf8");

  return {
    backup: { manifestPath, records: finalized, runHash, runId },
    diagnostics: finalized.map((record) => backupDiagnostic(record, runId, manifestPath)),
  };
}

export async function diagnoseOutputBackupPreflight(
  rootPath: string,
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState
): Promise<readonly SkillsetDiagnostic[]> {
  const records = await collectOutputBackupRecords(rootPath, rendered, deletePaths, managedState);
  return records.map(preflightBackupDiagnostic);
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
  const manifest = await readBackupManifest(rootPath, manifestPath);
  const restoredPaths: string[] = [];

  for (const record of manifest.records) {
    const targetPath = resolveInside(rootPath, record.targetPath);
    await assertRestoreIsSafe(rootPath, record, targetPath);
    restoredPaths.push(record.targetPath);
  }

  if (options.write === true) {
    for (const record of manifest.records) {
      const backupPath = resolveInside(rootPath, record.backupPath);
      const targetPath = resolveInside(rootPath, record.targetPath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, await readFile(backupPath));
    }
  }

  return {
    manifestPath,
    restoredPaths: restoredPaths.sort(compareStrings),
    runId,
    write: options.write === true,
  };
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
  rootPath: string,
  lockPath: string,
  expectedOutputRoot: string,
  outPath: OutPath,
  paths: Set<string>,
  editedPaths: Set<string>
): Promise<void> {
  const displayLockPath = outPath(lockPath);
  const absoluteLockPath = resolveInside(rootPath, displayLockPath);
  if (!(await exists(absoluteLockPath))) return;

  const lock = await readManagedLock(rootPath, lockPath, displayLockPath, expectedOutputRoot);
  paths.add(displayLockPath);

  if (lock.legacyRoot === true) {
    const displayOutputRoot = outPath(expectedOutputRoot);
    for (const file of await collectFiles(resolveInside(rootPath, displayOutputRoot))) {
      paths.add(relative(rootPath, file));
    }
  }

  for (const item of lock.items) {
    const files = item.files
      .map((file) => ({ displayPath: outPath(joinOutputRoot(expectedOutputRoot, file)), file }))
      .sort((left, right) => compareStrings(left.file, right.file));
    for (const file of files) paths.add(file.displayPath);
    if (item.outputHash === undefined) continue;
    const currentHash = await currentOutputHash(rootPath, files);
    if (currentHash === undefined) {
      for (const file of files) {
        if (await exists(resolveInside(rootPath, file.displayPath))) editedPaths.add(file.displayPath);
      }
      continue;
    }
    if (currentHash === item.outputHash) continue;
    for (const file of files) editedPaths.add(file.displayPath);
  }
}

async function readManagedLock(
  rootPath: string,
  lockPath: string,
  displayLockPath: string,
  expectedOutputRoot: string
): Promise<ParsedLock> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolveInside(rootPath, displayLockPath), "utf8")) as unknown;
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
    return { items: [], legacyRoot: true };
  }
  if (parsed.outputRoot !== expectedOutputRoot) {
    const expected = expectedOutputRoot === "." ? "the workspace root" : JSON.stringify(expectedOutputRoot);
    throw corruptManagedLock(lockPath, displayLockPath, `its outputRoot ${JSON.stringify(parsed.outputRoot)} is not ${expected}`);
  }
  if (!Array.isArray(parsed.items)) {
    throw corruptManagedLock(lockPath, displayLockPath, "its items field is not an array");
  }

  return {
    items: parsed.items.map((item) => parseLockItem(lockPath, displayLockPath, item)),
  };
}

function parseLockItem(
  lockPath: string,
  displayLockPath: string,
  value: unknown
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
  return {
    files,
    ...(outputHash === undefined ? {} : { outputHash }),
  };
}

async function currentOutputHash(
  rootPath: string,
  files: readonly LockFileEntry[]
): Promise<string | undefined> {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");

  for (const entry of files) {
    if (!(await exists(resolveInside(rootPath, entry.displayPath)))) return undefined;
    hash.update(entry.file);
    hash.update("\0");
    hash.update(await readFile(resolveInside(rootPath, entry.displayPath)));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

async function collectOutputBackupRecords(
  rootPath: string,
  rendered: readonly RenderedFile[],
  deletePaths: readonly string[],
  managedState: ManagedOutputState
): Promise<Array<OutputBackupPlanRecord & { readonly content: Uint8Array }>> {
  const records: Array<OutputBackupPlanRecord & { readonly content: Uint8Array }> = [];
  const renderedByPath = new Map(rendered.map((file) => [file.path, file]));

  for (const file of rendered) {
    const absolutePath = resolveInside(rootPath, file.path);
    if (!(await exists(absolutePath))) continue;
    const current = await readFile(absolutePath);
    if (bytesEqual(current, file.content)) continue;

    const reason = managedState.paths.has(file.path)
      ? managedState.editedPaths.has(file.path)
        ? "managed-target-edit"
        : undefined
      : "unmanaged-collision";
    if (reason === undefined) continue;

    records.push({
      action: "overwrite",
      content: current,
      generatedHash: contentHash(file.content),
      originalHash: contentHash(current),
      reason,
      ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }),
      targetPath: file.path,
    });
  }

  for (const targetPath of deletePaths) {
    if (!managedState.editedPaths.has(targetPath)) continue;
    if (renderedByPath.has(targetPath)) continue;
    const absolutePath = resolveInside(rootPath, targetPath);
    if (!(await exists(absolutePath))) continue;
    const current = await readFile(absolutePath);
    records.push({
      action: "delete",
      content: current,
      originalHash: contentHash(current),
      reason: "managed-target-edit",
      targetPath,
    });
  }

  return records.sort((left, right) => compareStrings(left.targetPath, right.targetPath));
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

async function readBackupManifest(rootPath: string, manifestPath: string): Promise<OutputBackupManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolveInside(rootPath, manifestPath), "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: cannot read backup manifest ${manifestPath}: ${message}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.runId !== "string" || !Array.isArray(parsed.records)) {
    throw new Error(`skillset: backup manifest ${manifestPath} is malformed`);
  }
  return {
    generatedBy: typeof parsed.generatedBy === "string" ? parsed.generatedBy : "",
    records: parsed.records.map((record) => parseBackupRecord(manifestPath, record)),
    runHash: typeof parsed.runHash === "string" ? parsed.runHash : "",
    runId: parsed.runId,
    schemaVersion: 1,
  };
}

function parseBackupRecord(manifestPath: string, value: unknown): OutputBackupRecord {
  if (!isRecord(value)) throw new Error(`skillset: backup manifest ${manifestPath} has malformed records`);
  const action = value.action;
  const backupPath = value.backupPath;
  const generatedHash = value.generatedHash;
  const originalHash = value.originalHash;
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
  if (sourcePath !== undefined && typeof sourcePath !== "string") {
    throw new Error(`skillset: backup manifest ${manifestPath} has invalid sourcePath`);
  }
  return {
    action,
    backupPath,
    ...(generatedHash === undefined ? {} : { generatedHash }),
    originalHash,
    reason,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    targetPath,
  };
}

async function assertRestoreIsSafe(
  rootPath: string,
  record: OutputBackupRecord,
  targetPath: string
): Promise<void> {
  const backupPath = resolveInside(rootPath, record.backupPath);
  if (!(await exists(backupPath))) {
    throw new Error(`skillset: backup file is missing for ${record.targetPath}: ${record.backupPath}`);
  }
  const backupHash = contentHash(await readFile(backupPath));
  if (backupHash !== record.originalHash) {
    throw new Error(`skillset: backup file hash changed for ${record.targetPath}`);
  }
  const targetExists = await exists(targetPath);
  if (record.generatedHash === undefined) {
    if (targetExists) {
      throw new Error(`skillset: refusing ambiguous restore for ${record.targetPath}; target exists after a delete backup`);
    }
    return;
  }
  if (!targetExists) return;
  const currentHash = contentHash(await readFile(targetPath));
  if (currentHash !== record.generatedHash) {
    throw new Error(`skillset: refusing ambiguous restore for ${record.targetPath}; target changed since backup ${record.generatedHash}`);
  }
}

function corruptManagedLock(lockPath: string, displayLockPath: string, reason: string): Error {
  if (lockPath === WORKSPACE_LOCK_FILE) return corruptWorkspaceLock(displayLockPath, reason);
  return new Error(
    `skillset: generated lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Fix or remove the lock before running build, check, or diff."
  );
}

function corruptWorkspaceLock(displayLockPath: string, reason: string): Error {
  return new Error(
    `skillset: workspace lock ${displayLockPath} cannot guard generated state because ${reason}. ` +
      "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
  );
}

function joinOutputRoot(outputRoot: string, file: string): string {
  if (outputRoot === "." || outputRoot === "") return file;
  return `${outputRoot}/${file}`;
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
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
