import { randomBytes } from "node:crypto";
import { type FileHandle, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { supportsGeneratedFileModes } from "./generated-file-mode";

/**
 * Same-directory single-file publication.
 *
 * Readers of `path` observe either the complete previous document or a complete
 * replacement. Bytes are written to an exclusive randomized temporary file in
 * the destination directory, flushed when the host supports file sync, closed,
 * then renamed over the destination. The parent directory is synced when the
 * host supports directory sync so the rename itself becomes durable.
 *
 * Platform boundary:
 * - POSIX file modes are applied through `open` plus `fchmod` on platforms
 *   that expose them. Windows uses the same skip as generated-file modes:
 *   publication still replaces bytes atomically, but the requested mode is
 *   not a portable chmod contract.
 * - Directory `fsync` persists the directory entry created by rename. Windows
 *   and some filesystems reject that with `EISDIR`, `EINVAL`, `EPERM`, or
 *   `ENOTSUP`. Those errors are skipped; the rename remains the publication
 *   point. File `fsync` uses the same unsupported-error set so a host that
 *   cannot flush still publishes only after a complete write and close.
 *
 * This helper owns byte completeness for one file. Ledger JSONL appends,
 * multi-file workspace transactions, and directory no-replace claims stay on
 * their specialized mechanisms. Concurrent logical read-modify-write
 * serialization is the caller's responsibility.
 */
export const ATOMIC_FILE_PUBLICATION_DEFAULT_MODE = 0o644;

export interface AtomicFilePublicationTestHooks {
  readonly beforePublish?: () => Promise<void> | void;
  readonly beforeTemporaryClose?: () => Promise<void> | void;
  readonly beforeTemporarySync?: () => Promise<void> | void;
  readonly beforeTemporaryWrite?: () => Promise<void> | void;
}

export interface AtomicFilePublicationOptions {
  readonly beforeRename?: () => Promise<void> | void;
  readonly mode?: number;
  readonly testHooks?: AtomicFilePublicationTestHooks;
}

export async function publishAtomicFile(
  path: string,
  content: string | Uint8Array,
  options: AtomicFilePublicationOptions = {}
): Promise<void> {
  const mode = options.mode ?? ATOMIC_FILE_PUBLICATION_DEFAULT_MODE;
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporaryPath = join(parent, `.${basename(path)}.tmp-${randomBytes(16).toString("hex")}`);
  try {
    const file = await open(temporaryPath, "wx", mode);
    try {
      await options.testHooks?.beforeTemporaryWrite?.();
      await writePublishedContent(file, content);
      if (supportsGeneratedFileModes()) {
        await file.chmod(mode & 0o777);
      }
      await options.testHooks?.beforeTemporarySync?.();
      await syncPublishedHandle(file);
      await options.testHooks?.beforeTemporaryClose?.();
    } finally {
      await file.close();
    }
    await options.testHooks?.beforePublish?.();
    await options.beforeRename?.();
    await rename(temporaryPath, path);
    await syncPublishedDirectory(parent);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writePublishedContent(file: FileHandle, content: string | Uint8Array): Promise<void> {
  if (typeof content === "string") {
    await file.writeFile(content, "utf8");
    return;
  }
  await file.writeFile(content);
}

async function syncPublishedHandle(file: FileHandle): Promise<void> {
  try {
    await file.sync();
  } catch (error) {
    if (!isUnsupportedSyncError(error)) throw error;
  }
}

async function syncPublishedDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedSyncError(error)) throw error;
  } finally {
    await directory?.close();
  }
}

function isUnsupportedSyncError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EISDIR" ||
      error.code === "EINVAL" ||
      error.code === "EPERM" ||
      error.code === "ENOTSUP");
}
