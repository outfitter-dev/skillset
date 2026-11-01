import { prepareRepositoryMutationPath } from "./repository-mutation";
import { lstat, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicFileWrite {
  readonly content: Uint8Array | string;
  readonly path: string;
}

interface AtomicFileSetOptions {
  readonly beforeInstall?: (path: string, index: number) => Promise<void> | void;
}

interface StagedFile {
  readonly backupPath: string;
  backupMoved: boolean;
  installed: boolean;
  readonly nextPath: string;
  readonly path: string;
  readonly stagingPath: string;
}

export async function writeAtomicFileSet(
  workspaceRoot: string,
  writes: readonly AtomicFileWrite[],
  options: AtomicFileSetOptions = {}
): Promise<void> {
  // Inspect every destination before staging any member of the transaction.
  const preparedWrites: AtomicFileWrite[] = [];
  for (const write of writes) {
    const prepared = await prepareRepositoryMutationPath(workspaceRoot, write.path, { createParents: false });
    preparedWrites.push({ ...write, path: prepared.path });
  }
  assertUniquePaths(preparedWrites);
  const staged: StagedFile[] = [];
  try {
    for (const write of preparedWrites) staged.push(await stageFile(workspaceRoot, write));
  } catch (error) {
    await cleanupStaging(workspaceRoot, staged);
    throw error;
  }

  try {
    for (const [index, file] of staged.entries()) {
      await options.beforeInstall?.(file.path, index);
      await prepareRepositoryMutationPath(workspaceRoot, file.path, { createParents: false });
      await prepareRepositoryMutationPath(workspaceRoot, file.nextPath, { createParents: false });
      await prepareRepositoryMutationPath(workspaceRoot, file.backupPath, { createParents: false });
      const existing = await lstat(file.path).catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      if (existing !== undefined) {
        if (!existing.isFile()) throw new Error(`skillset: marketplace output is not a regular file: ${file.path}`);
        await rename(file.path, file.backupPath);
        file.backupMoved = true;
      }
      await rename(file.nextPath, file.path);
      file.installed = true;
    }
  } catch (error) {
    const rollbackErrors = await rollback(workspaceRoot, staged);
    if (rollbackErrors.length > 0) {
      throw new Error(
        `skillset: marketplace update failed and rollback failed for ${rollbackErrors.join(", ")}: ${errorMessage(error)}`
      );
    }
    await cleanupStaging(workspaceRoot, staged);
    throw error;
  }

  await cleanupStaging(workspaceRoot, staged);
}

function assertUniquePaths(writes: readonly AtomicFileWrite[]): void {
  const paths = new Set<string>();
  for (const write of writes) {
    if (paths.has(write.path)) throw new Error(`skillset: duplicate marketplace transaction path ${write.path}`);
    paths.add(write.path);
  }
}

async function stageFile(workspaceRoot: string, write: AtomicFileWrite): Promise<StagedFile> {
  const parent = dirname(write.path);
  await prepareRepositoryMutationPath(workspaceRoot, write.path);
  const stagingPath = await mkdtemp(join(parent, ".skillset-marketplace-"));
  const nextPath = join(stagingPath, `${basename(write.path)}.next`);
  try {
    await writeFile(nextPath, write.content);
    return {
      backupMoved: false,
      backupPath: join(stagingPath, `${basename(write.path)}.previous`),
      installed: false,
      nextPath,
      path: write.path,
      stagingPath,
    };
  } catch (error) {
    await removeStaging(workspaceRoot, stagingPath);
    throw error;
  }
}

async function rollback(workspaceRoot: string, staged: readonly StagedFile[]): Promise<readonly string[]> {
  const failures: string[] = [];
  for (const file of [...staged].reverse()) {
    try {
      if (file.installed || file.backupMoved) {
        await prepareRepositoryMutationPath(workspaceRoot, file.path, { createParents: false });
        if (file.backupMoved) await prepareRepositoryMutationPath(workspaceRoot, file.backupPath, { createParents: false });
        if (file.installed) await rm(file.path, { force: true });
        if (file.backupMoved) await rename(file.backupPath, file.path);
      }
    } catch {
      failures.push(file.path);
    }
  }
  return failures;
}

async function cleanupStaging(workspaceRoot: string, staged: readonly StagedFile[]): Promise<void> {
  await Promise.all(staged.map(({ stagingPath }) =>
    removeStaging(workspaceRoot, stagingPath)
  ));
}

async function removeStaging(workspaceRoot: string, stagingPath: string): Promise<void> {
  try {
    await prepareRepositoryMutationPath(workspaceRoot, stagingPath, { createParents: false });
    await rm(stagingPath, { force: true, recursive: true });
  } catch {
    // Leave recovery artifacts in place if their ancestry can no longer be trusted.
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
