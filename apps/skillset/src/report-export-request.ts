import { constants, type Dirent, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  createReportBundle,
  readReportBundle,
  type StoredReportBundle,
} from "@skillset/core/internal/report-store";

import {
  exportSandboxReportToParent,
  type CapturedParentXdg,
} from "./report-parent-export";
import { TEST_SANDBOX_ENV, validateTestSandbox } from "./verification-sandbox";

export const REPORT_EXPORT_REQUEST_SCHEMA_VERSION =
  "skillset.report-export-request@1";
export const REPORT_EXPORT_REQUESTS_DIR = "report-export-requests";

const MAX_EXPORT_REQUESTS = 100;
const MAX_REQUEST_BYTES = 4096;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ReportExportRequest {
  readonly reportId: string;
  readonly schemaVersion: typeof REPORT_EXPORT_REQUEST_SCHEMA_VERSION;
}

export interface RegisterSandboxReportExportRequestInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly expectedRepoRoot: string;
  readonly reportId: string;
}

export interface ImportRequestedSandboxReportsInput {
  readonly artifactDirectory?: string;
  readonly childEnv: Readonly<Record<string, string | undefined>>;
  readonly expectedRepoRoot: string;
  readonly parentXdg: CapturedParentXdg;
  readonly sensitiveValues?: readonly string[];
  /** Deterministic security seams reserved for focused tests. */
  readonly testHooks?: ReportExportRequestTestHooks;
}

type OwnershipUidTransform = (context: {
  readonly label: string;
  readonly path: string;
  readonly uid: number;
}) => number;

interface OwnershipTestHooks {
  readonly transformOwnershipUid?: OwnershipUidTransform | undefined;
}

interface ReportExportRequestTestHooks extends OwnershipTestHooks {
  readonly afterRequestEnumeration?: (context: {
    readonly requestDirectory: string;
  }) => Promise<void> | void;
  readonly beforeRequestOpen?: (context: {
    readonly requestPath: string;
  }) => Promise<void> | void;
  readonly beforeBundleWrite?: (context: {
    readonly id: string;
    readonly index: number;
  }) => Promise<void> | void;
  readonly beforePublication?: (context: {
    readonly finalPath: string;
    readonly stagingPath: string;
  }) => Promise<void> | void;
}

interface FilesystemIdentity {
  readonly birthtimeMs: number;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
}

/**
 * Registers one completed child report for its owning sandbox parent.
 *
 * Direct, non-sandboxed commands already write to the user's report store and
 * therefore have no parent export to request.
 */
export async function registerSandboxReportExportRequest(
  input: RegisterSandboxReportExportRequestInput
): Promise<boolean> {
  assertReportId(input.reportId);
  const env = input.env ?? process.env;
  if (!env[TEST_SANDBOX_ENV]?.trim()) return false;

  const sandbox = await validateTestSandbox(env, input.expectedRepoRoot);
  await readReportBundle(input.reportId, { env });

  const requestDirectory = join(
    sandbox.descriptor.sandboxPath,
    REPORT_EXPORT_REQUESTS_DIR
  );
  await preparePrivateDirectory(requestDirectory);
  const requestPath = join(requestDirectory, `${input.reportId}.json`);
  const request: ReportExportRequest = {
    reportId: input.reportId,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  };
  await writePrivateCreateOnlyFile(
    requestPath,
    `${JSON.stringify(request, null, 2)}\n`
  );
  return true;
}

/**
 * Imports only explicitly requested child reports, then optionally materializes
 * the same validated receipts in one atomic CI artifact directory.
 */
export async function importRequestedSandboxReports(
  input: ImportRequestedSandboxReportsInput
): Promise<readonly StoredReportBundle[]> {
  const sandbox = await validateTestSandbox(
    input.childEnv,
    input.expectedRepoRoot
  );
  const reportIds = await readExportRequests(
    sandbox.descriptor.sandboxPath,
    input.testHooks
  );
  if (reportIds.length === 0) return [];

  if (
    input.artifactDirectory !== undefined &&
    !isAbsolute(input.artifactDirectory)
  ) {
    throw new Error(
      "skillset: report artifact directory must be an absolute path"
    );
  }

  const imported: StoredReportBundle[] = [];
  for (const reportId of reportIds) {
    imported.push(
      await exportSandboxReportToParent({
        childEnv: input.childEnv,
        expectedRepoRoot: input.expectedRepoRoot,
        parentXdg: input.parentXdg,
        reportId,
        ...(input.artifactDirectory === undefined
          ? {}
          : { artifactDirectory: input.artifactDirectory }),
        ...(input.sensitiveValues === undefined
          ? {}
          : { sensitiveValues: input.sensitiveValues }),
      })
    );
  }

  if (input.artifactDirectory !== undefined) {
    await publishImportedReportArtifacts(
      imported,
      input.artifactDirectory,
      input.testHooks
    );
  }
  return imported;
}

/**
 * Writes a non-empty set of validated reports as one create-only artifact.
 * The final directory appears only after every UUID bundle is complete.
 */
async function publishImportedReportArtifacts(
  bundles: readonly StoredReportBundle[],
  artifactDirectory: string,
  testHooks?: ReportExportRequestTestHooks
): Promise<string> {
  if (!isAbsolute(artifactDirectory)) {
    throw new Error(
      "skillset: report artifact directory must be an absolute path"
    );
  }
  if (bundles.length === 0) {
    throw new Error(
      "skillset: report artifact export requires at least one bundle"
    );
  }

  const finalPath = resolve(artifactDirectory);
  const parentPath = dirname(finalPath);
  const parentIdentity = await assertPlainExistingDirectory(
    parentPath,
    "report artifact parent",
    testHooks
  );

  const seen = new Set<string>();
  const prepared = bundles
    .map((bundle) => {
      const id = bundle.report.id;
      assertReportId(id);
      if (seen.has(id)) {
        throw new Error(`skillset: duplicate report artifact ${id}`);
      }
      seen.add(id);
      return { id, report: bundle.report };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const stagingPath = join(
    parentPath,
    `.stage-${basename(finalPath)}-${crypto.randomUUID()}`
  );
  const lockPath = join(parentPath, `.${basename(finalPath)}.lock`);
  await assertPathIdentity(
    parentPath,
    parentIdentity,
    "report artifact parent"
  );
  const lock = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
    throw new Error("skillset: report artifact publication is already active", {
      cause: error,
    });
  });
  try {
    if (process.platform !== "win32") await lock.chmod(0o600);
    const lockEntry = await lock.stat();
    if (!lockEntry.isFile()) {
      throw new Error("skillset: report artifact lock must be a regular file");
    }
    await assertMode(lockEntry.mode, 0o600, "report artifact lock");
    assertCurrentUserOwned(
      lockEntry.uid,
      "report artifact lock",
      lockPath,
      testHooks
    );
    await assertPathIdentity(
      parentPath,
      parentIdentity,
      "report artifact parent"
    );
    await assertMissing(finalPath, "report artifact directory already exists");
    let completed = false;
    try {
      await mkdir(stagingPath, { mode: 0o700 });
      await enforceMode(stagingPath, 0o700);
      for (const [index, bundle] of prepared.entries()) {
        await testHooks?.beforeBundleWrite?.({ id: bundle.id, index });
        await createReportBundle(bundle.report, {
          boundary: {
            reportRoot: stagingPath,
            trustedBase: stagingPath,
          },
        });
      }
      await testHooks?.beforePublication?.({
        finalPath,
        stagingPath,
      });
      await assertPathIdentity(
        parentPath,
        parentIdentity,
        "report artifact parent"
      );
      await assertMissing(
        finalPath,
        "report artifact directory already exists"
      );
      await rename(stagingPath, finalPath);
      completed = true;
      return finalPath;
    } finally {
      if (!completed) {
        await rm(stagingPath, { force: true, recursive: true });
      }
    }
  } finally {
    try {
      await lock.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}

async function readExportRequests(
  sandboxPath: string,
  testHooks?: ReportExportRequestTestHooks
): Promise<readonly string[]> {
  const requestDirectory = join(sandboxPath, REPORT_EXPORT_REQUESTS_DIR);
  const pathEntry = await lstat(requestDirectory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  );
  if (pathEntry === undefined) return [];
  if (!pathEntry.isDirectory() || pathEntry.isSymbolicLink()) {
    throw new Error(
      "skillset: report export requests must be a plain directory"
    );
  }
  const directoryHandle = await openNoFollow(
    requestDirectory,
    constants.O_DIRECTORY ?? 0,
    "report export request directory"
  );
  try {
    const directoryEntry = await directoryHandle.stat();
    if (!directoryEntry.isDirectory()) {
      throw new Error(
        "skillset: report export requests must be a plain directory"
      );
    }
    await assertMode(
      directoryEntry.mode,
      0o700,
      "report export request directory"
    );
    assertCurrentUserOwned(
      directoryEntry.uid,
      "report export request directory",
      requestDirectory,
      testHooks
    );
    if ((await realpath(requestDirectory)) !== requestDirectory) {
      throw new Error(
        "skillset: report export request directory must be canonical"
      );
    }
    const directoryIdentity = captureIdentity(directoryEntry);
    await assertPathIdentity(
      requestDirectory,
      directoryIdentity,
      "report export request directory"
    );

    const entries: Dirent[] = [];
    const requestStream = await opendir(requestDirectory);
    try {
      while (true) {
        const entry = await requestStream.read();
        if (entry === null) break;
        if (entries.length === MAX_EXPORT_REQUESTS) {
          throw new Error(
            `skillset: report export requests exceed the ${MAX_EXPORT_REQUESTS} request limit`
          );
        }
        entries.push(entry);
      }
    } finally {
      await requestStream.close();
    }
    await testHooks?.afterRequestEnumeration?.({ requestDirectory });
    await assertPathIdentity(
      requestDirectory,
      directoryIdentity,
      "report export request directory"
    );

    const requests: string[] = [];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const match = entry.name.match(
        /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/
      );
      if (!entry.isFile() || entry.isSymbolicLink() || match === null) {
        throw new Error(
          `skillset: invalid report export request entry ${entry.name}`
        );
      }
      const filenameId = match[1]!;
      const requestPath = join(requestDirectory, entry.name);
      await testHooks?.beforeRequestOpen?.({ requestPath });
      const request = parseRequest(
        await readPrivateBoundedRegularFile(
          requestPath,
          "report export request file",
          testHooks
        )
      );
      if (request.reportId !== filenameId) {
        throw new Error(
          "skillset: report export request filename and reportId disagree"
        );
      }
      requests.push(request.reportId);
    }
    await assertPathIdentity(
      requestDirectory,
      directoryIdentity,
      "report export request directory"
    );
    return requests;
  } finally {
    await directoryHandle.close();
  }
}

function parseRequest(content: string): ReportExportRequest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error("skillset: invalid report export request JSON", {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("skillset: report export request must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(["reportId", "schemaVersion"])
  ) {
    throw new Error(
      "skillset: report export request has unknown or missing fields"
    );
  }
  if (record.schemaVersion !== REPORT_EXPORT_REQUEST_SCHEMA_VERSION) {
    throw new Error(
      `skillset: unsupported report export request schemaVersion: ${String(record.schemaVersion)}`
    );
  }
  if (typeof record.reportId !== "string") {
    throw new Error(
      "skillset: report export request reportId must be a UUIDv4"
    );
  }
  assertReportId(record.reportId);
  return record as unknown as ReportExportRequest;
}

function assertReportId(reportId: string): void {
  if (!UUID_V4_PATTERN.test(reportId)) {
    throw new Error("skillset: report export request requires a full UUIDv4");
  }
}

async function preparePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: false }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    }
  );
  const identity = await assertPlainExistingDirectory(
    path,
    "report export request directory"
  );
  await enforceMode(path, 0o700);
  await assertPathIdentity(path, identity, "report export request directory");
}

async function writePrivateCreateOnlyFile(
  path: string,
  content: string
): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  let completed = false;
  try {
    await handle.writeFile(content);
    await handle.sync();
    if (process.platform !== "win32") await handle.chmod(0o600);
    const entry = await handle.stat();
    if (!entry.isFile()) {
      throw new Error(
        "skillset: report export request file must be a regular file"
      );
    }
    await assertMode(entry.mode, 0o600, "report export request file");
    assertCurrentUserOwned(entry.uid, "report export request file", path);
    completed = true;
  } finally {
    await handle.close();
    if (!completed) await rm(path, { force: true });
  }
}

async function assertPlainExistingDirectory(
  path: string,
  label: string,
  testHooks?: OwnershipTestHooks
): Promise<FilesystemIdentity> {
  const handle = await openNoFollow(path, constants.O_DIRECTORY ?? 0, label);
  try {
    const entry = await handle.stat();
    if (!entry.isDirectory()) {
      throw new Error(`skillset: ${label} must be a plain directory`);
    }
    if ((await realpath(path)) !== resolve(path)) {
      throw new Error(`skillset: ${label} ancestry must not contain symlinks`);
    }
    assertCurrentUserOwned(entry.uid, label, path, testHooks);
    const identity = captureIdentity(entry);
    await assertPathIdentity(path, identity, label);
    return identity;
  } finally {
    await handle.close();
  }
}

async function readPrivateBoundedRegularFile(
  path: string,
  label: string,
  testHooks?: ReportExportRequestTestHooks
): Promise<string> {
  const handle = await openNoFollow(path, 0, label);
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error(`skillset: ${label} must be a regular file`);
    }
    await assertMode(before.mode, 0o600, label);
    assertCurrentUserOwned(before.uid, label, path, testHooks);
    const pathEntry = await lstat(path);
    if (
      pathEntry.isSymbolicLink() ||
      !pathEntry.isFile() ||
      filesystemObjectIdentityChanged(
        captureIdentity(before),
        captureIdentity(pathEntry)
      )
    ) {
      throw new Error(`skillset: ${label} changed during validation`);
    }
    if (before.size > MAX_REQUEST_BYTES) {
      throw new Error("skillset: report export request is too large");
    }

    const buffer = Buffer.alloc(MAX_REQUEST_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_REQUEST_BYTES) {
      throw new Error("skillset: report export request is too large");
    }

    const after = await handle.stat();
    if (
      filesystemObjectIdentityChanged(
        captureIdentity(before),
        captureIdentity(after)
      ) ||
      before.size !== after.size ||
      before.ctimeMs !== after.ctimeMs ||
      before.mtimeMs !== after.mtimeMs ||
      offset !== after.size
    ) {
      throw new Error(
        "skillset: report export request changed during validation"
      );
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function openNoFollow(
  path: string,
  additionalFlags: number,
  label: string
): Promise<FileHandle> {
  const flags =
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | additionalFlags;
  try {
    return await open(path, flags);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ELOOP" || error.code === "EMLINK")
    ) {
      throw new Error(`skillset: ${label} must not be a symlink`, {
        cause: error,
      });
    }
    throw error;
  }
}

function captureIdentity(entry: Stats): FilesystemIdentity {
  return {
    birthtimeMs: entry.birthtimeMs,
    dev: entry.dev,
    ino: entry.ino,
    uid: entry.uid,
  };
}

async function assertPathIdentity(
  path: string,
  expected: FilesystemIdentity,
  label: string
): Promise<void> {
  const entry = await lstat(path);
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    filesystemObjectIdentityChanged(expected, captureIdentity(entry))
  ) {
    throw new Error(`skillset: ${label} changed during validation`);
  }
}

function filesystemObjectIdentityChanged(
  before: FilesystemIdentity,
  after: FilesystemIdentity
): boolean {
  if (
    before.dev !== after.dev ||
    before.uid !== after.uid ||
    (before.ino === 0) !== (after.ino === 0)
  ) {
    return true;
  }
  if (before.ino !== 0) return before.ino !== after.ino;
  const hasStableBirthTime =
    Number.isFinite(before.birthtimeMs) &&
    Number.isFinite(after.birthtimeMs) &&
    before.birthtimeMs !== 0 &&
    after.birthtimeMs !== 0;
  return !hasStableBirthTime || before.birthtimeMs !== after.birthtimeMs;
}

function assertCurrentUserOwned(
  uid: number,
  label: string,
  path: string,
  testHooks?: OwnershipTestHooks
): void {
  if (process.platform === "win32" || process.getuid === undefined) return;
  const observedUid =
    testHooks?.transformOwnershipUid?.({ label, path, uid }) ?? uid;
  if (observedUid !== process.getuid()) {
    throw new Error(`skillset: ${label} must be owned by the current user`);
  }
}

async function assertMissing(path: string, message: string): Promise<void> {
  const exists = await lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  );
  if (exists) throw new Error(`skillset: ${message}`);
}

async function enforceMode(path: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(path, mode);
  const entry = await lstat(path);
  await assertMode(entry.mode, mode, path);
}

async function assertMode(
  actualMode: number,
  expectedMode: number,
  label: string
): Promise<void> {
  if (process.platform === "win32") return;
  if ((actualMode & 0o777) !== expectedMode) {
    throw new Error(
      `skillset: ${label} must use mode ${expectedMode.toString(8)}`
    );
  }
}
