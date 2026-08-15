import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { SkillsetReport } from "@skillset/schema";

import {
  containsSensitiveReportContent,
  renderSkillsetReportMarkdown,
  sanitizeAndValidateSkillsetReport,
  serializeSkillsetReport,
  validateAndNormalizeSkillsetReport,
} from "./report";
import { resolveSkillsetXdgPaths, type SkillsetXdgOptions } from "./xdg";

const REPORT_JSON = "report.json";
const REPORT_MARKDOWN = "report.md";
const REPORT_FILES = [REPORT_JSON, REPORT_MARKDOWN] as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ReportStoreErrorCode =
  | "invalid_bundle"
  | "invalid_reference"
  | "invariant"
  | "not_found"
  | "read_failed";

export class ReportStoreError extends Error {
  readonly code: ReportStoreErrorCode;

  constructor(
    code: ReportStoreErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(`skillset: ${message}`, options);
    this.name = "ReportStoreError";
    this.code = code;
  }
}

export interface ReportStoreOptions extends SkillsetXdgOptions {
  /** Explicit root reserved for hermetic owners and focused tests. */
  readonly boundary?: ReportStoreBoundary | undefined;
  /** Base used to resolve an explicitly relative report path. */
  readonly cwd?: string | undefined;
  readonly sentinels?: readonly string[] | undefined;
  /** Deterministic failure/race seams available only through the internal subpath. */
  readonly testHooks?: ReportStoreTestHooks | undefined;
}

export interface ReportStoreBoundary {
  readonly reportRoot: string;
  /** Existing caller-owned directory from which every report-root component is inspected. */
  readonly trustedBase: string;
}

export interface ReportStoreTestHooks {
  readonly afterFinalRename?:
    | ((context: { readonly finalPath: string }) => Promise<void> | void)
    | undefined;
  readonly afterStagingCreated?:
    | ((context: { readonly stagingPath: string }) => Promise<void> | void)
    | undefined;
  readonly beforeBundleFileRead?:
    | ((context: { readonly bundlePath: string }) => Promise<void> | void)
    | undefined;
}

export interface ReadReportBundleOptions extends SkillsetXdgOptions {
  /** Base used to resolve an explicitly relative report path. */
  readonly cwd?: string | undefined;
}

export interface StoredReportBundle {
  readonly markdown: string;
  readonly report: SkillsetReport;
  readonly resolvedPath: string;
}

export interface ImportReportBundleInput {
  readonly destination?: ReportStoreOptions | undefined;
  readonly sentinels?: readonly string[] | undefined;
  readonly sourceReference: string;
  readonly sourceReportRoot: string;
  readonly sourceSandboxRoot: string;
}

export function resolveReportStoreRoot(
  options: SkillsetXdgOptions = {}
): string {
  return join(resolveSkillsetXdgPaths(options).state, "reports");
}

export async function createReportBundle(
  input: SkillsetReport,
  options: ReportStoreOptions = {}
): Promise<StoredReportBundle> {
  const boundary = resolveStoreBoundary(options);
  const reportRoot = boundary.reportRoot;
  const report = sanitizeAndValidateSkillsetReport(input, options.sentinels);
  const json = serializeSkillsetReport(report);
  const markdown = renderSkillsetReportMarkdown(report);
  assertNoSensitiveContent(json, markdown, options.sentinels);
  await preparePrivateReportRoot(boundary);
  const reportRootIdentity = await captureDirectoryIdentity(
    reportRoot,
    "report root"
  );

  const stagingPath = join(
    reportRoot,
    `.stage-${report.id}-${randomBytes(12).toString("hex")}`
  );
  const finalPath = join(reportRoot, report.id);
  await mkdir(stagingPath, { mode: 0o700 });
  let stagedIdentity: DirectoryIdentity | undefined;
  let completed = false;
  try {
    await options.testHooks?.afterStagingCreated?.({ stagingPath });
    await enforceMode(stagingPath, 0o700);
    await writePrivateFile(join(stagingPath, REPORT_JSON), json);
    await writePrivateFile(join(stagingPath, REPORT_MARKDOWN), markdown);
    await validateCompletedBundleDirectory(stagingPath, report.id, {
      allowStagedName: true,
      sentinels: options.sentinels,
    });
    await syncDirectory(stagingPath);
    assertSameDirectoryIdentity(
      reportRootIdentity,
      await captureDirectoryIdentity(reportRoot, "report root")
    );

    if (await pathExists(finalPath)) {
      throw new ReportStoreError(
        "invalid_bundle",
        `report ${report.id} already exists`
      );
    }
    stagedIdentity = await captureDirectoryIdentity(
      stagingPath,
      "staged report bundle"
    );
    try {
      await rename(stagingPath, finalPath);
      completed = true;
    } catch (error) {
      if (isAlreadyExistsError(error) || (await pathExists(finalPath))) {
        throw new ReportStoreError(
          "invalid_bundle",
          `report ${report.id} already exists`,
          { cause: error }
        );
      }
      throw error;
    }
    await syncDirectory(reportRoot);
    assertSameDirectoryIdentity(
      reportRootIdentity,
      await captureDirectoryIdentity(reportRoot, "report root")
    );
    const stored = await validateCompletedPublication(
      finalPath,
      stagedIdentity,
      report.id,
      options.sentinels
    );
    await options.testHooks?.afterFinalRename?.({ finalPath });
    return stored;
  } catch (error) {
    if (!completed) {
      await rm(stagingPath, { force: true, recursive: true });
    }
    // The final rename is the completion marker. Never remove or rewrite the
    // UUID path after it succeeds; report success only when the exact staged
    // object still validates as the completed bundle.
    if (completed && stagedIdentity !== undefined) {
      try {
        return await validateCompletedPublication(
          finalPath,
          stagedIdentity,
          report.id,
          options.sentinels
        );
      } catch (verificationError) {
        throw new ReportStoreError(
          "invariant",
          "report completed but could not be verified after publication",
          {
            cause: new AggregateError(
              [error, verificationError],
              "post-completion verification failed"
            ),
          }
        );
      }
    }
    if (error instanceof ReportStoreError) throw error;
    throw new ReportStoreError(
      "invariant",
      "could not complete report bundle",
      {
        cause: error,
      }
    );
  }
}

async function validateCompletedPublication(
  finalPath: string,
  stagedIdentity: DirectoryIdentity,
  expectedId: string,
  sentinels: readonly string[] | undefined
): Promise<StoredReportBundle> {
  const stored = await validateCompletedBundleDirectory(finalPath, expectedId, {
    sentinels,
  });
  assertSameFilesystemObjectIdentity(
    stagedIdentity,
    await captureDirectoryIdentity(finalPath, "report bundle")
  );
  return stored;
}

export async function readReportBundle(
  reference: string,
  options: ReadReportBundleOptions = {}
): Promise<StoredReportBundle> {
  return readReportBundleAtBoundary(reference, options);
}

/** Internal boundary for hermetic owners and focused tests. */
export async function readReportBundleAtBoundary(
  reference: string,
  options: ReportStoreOptions = {}
): Promise<StoredReportBundle> {
  const boundary = resolveStoreBoundary(options);
  const reportRoot = boundary.reportRoot;
  const isId = UUID_V4_PATTERN.test(reference);
  try {
    if (!(await pathExists(reportRoot))) {
      if (isId) {
        throw new ReportStoreError(
          "not_found",
          `report ${reference} was not found`
        );
      }
      throw new ReportStoreError(
        "invalid_reference",
        "report root does not exist"
      );
    }
    await assertNoSymlinkPath(
      boundary.trustedBase,
      reportRoot,
      "invalid_reference"
    );
    await assertPlainDirectory(reportRoot, "invalid_reference", "report root");
    await assertMode(reportRoot, 0o700, "report root");
    const reportRootIdentity = await captureDirectoryIdentity(
      reportRoot,
      "report root"
    );
    const bundlePath = await resolveBundleReference(
      reference,
      reportRoot,
      isId,
      options.cwd ?? process.cwd()
    );
    if (!(await pathExists(bundlePath))) {
      if (isId) {
        throw new ReportStoreError(
          "not_found",
          `report ${reference} was not found`
        );
      }
      throw new ReportStoreError(
        "invalid_reference",
        "report path does not exist"
      );
    }
    await assertNoSymlinkPath(reportRoot, bundlePath, "invalid_reference");
    const bundle = await validateCompletedBundleDirectory(
      bundlePath,
      basename(bundlePath),
      {
        sentinels: options.sentinels,
        testHooks: options.testHooks,
      }
    );
    assertSameDirectoryIdentity(
      reportRootIdentity,
      await captureDirectoryIdentity(reportRoot, "report root")
    );
    return bundle;
  } catch (error) {
    if (error instanceof ReportStoreError) throw error;
    if (isMissingError(error) && isId) {
      throw new ReportStoreError(
        "not_found",
        `report ${reference} was not found`
      );
    }
    throw new ReportStoreError("read_failed", "could not read report bundle", {
      cause: error,
    });
  }
}

export async function importReportBundle(
  input: ImportReportBundleInput
): Promise<StoredReportBundle> {
  const sandboxRoot = resolve(input.sourceSandboxRoot);
  const sourceReportRoot = resolve(input.sourceReportRoot);
  if (!isContainedPath(sandboxRoot, sourceReportRoot)) {
    throw new ReportStoreError(
      "invalid_reference",
      "child report root is outside the validated sandbox"
    );
  }
  await assertNoSymlinkPath(sandboxRoot, sourceReportRoot, "invalid_reference");
  await assertPlainDirectory(
    sourceReportRoot,
    "invalid_reference",
    "child report root"
  );
  await assertMode(sourceReportRoot, 0o700, "child report root");
  const sourceRootIdentity = await captureDirectoryIdentity(
    sourceReportRoot,
    "child report root"
  );
  const sourceIsId = UUID_V4_PATTERN.test(input.sourceReference);
  const sourceBundlePath = await resolveBundleReference(
    input.sourceReference,
    sourceReportRoot,
    sourceIsId,
    process.cwd()
  );
  await assertNoSymlinkPath(
    sourceReportRoot,
    sourceBundlePath,
    "invalid_reference"
  );
  const source = await validateCompletedBundleDirectory(
    sourceBundlePath,
    basename(sourceBundlePath),
    {
      allowSensitiveSource: true,
      sentinels: input.sentinels,
    }
  );
  assertSameDirectoryIdentity(
    sourceRootIdentity,
    await captureDirectoryIdentity(sourceReportRoot, "child report root")
  );
  const sanitized = sanitizeAndValidateSkillsetReport(
    source.report,
    input.sentinels
  );
  const destination = input.destination ?? {};
  return createReportBundle(sanitized, {
    ...destination,
    sentinels: input.sentinels ?? destination.sentinels,
  });
}

async function resolveBundleReference(
  reference: string,
  reportRoot: string,
  isId: boolean,
  cwd: string
): Promise<string> {
  if (reference.length === 0 || reference.includes("\0")) {
    throw new ReportStoreError(
      "invalid_reference",
      "report reference is invalid"
    );
  }
  if (isId) return join(reportRoot, reference);
  if (reference.split(/[\\/]/u).includes("..")) {
    throw new ReportStoreError(
      "invalid_reference",
      "report traversal is not allowed"
    );
  }
  const target = isAbsolute(reference)
    ? resolve(reference)
    : resolve(cwd, reference);
  if (!isContainedPath(reportRoot, target)) {
    throw new ReportStoreError(
      "invalid_reference",
      "report path is outside the report store"
    );
  }
  const name = basename(target);
  const bundlePath = REPORT_FILES.includes(
    name as (typeof REPORT_FILES)[number]
  )
    ? dirname(target)
    : target;
  if (!UUID_V4_PATTERN.test(basename(bundlePath))) {
    throw new ReportStoreError(
      "invalid_reference",
      "report path does not name a completed UUID bundle"
    );
  }
  if (
    target !== bundlePath &&
    !REPORT_FILES.includes(name as (typeof REPORT_FILES)[number])
  ) {
    throw new ReportStoreError(
      "invalid_reference",
      "report filename is invalid"
    );
  }
  return bundlePath;
}

async function validateCompletedBundleDirectory(
  bundlePath: string,
  expectedId: string,
  options: {
    readonly allowStagedName?: boolean | undefined;
    readonly allowSensitiveSource?: boolean | undefined;
    readonly sentinels?: readonly string[] | undefined;
    readonly testHooks?: ReportStoreTestHooks | undefined;
  }
): Promise<StoredReportBundle> {
  const initialIdentity = await captureDirectoryIdentity(
    bundlePath,
    "report bundle"
  );
  await assertPlainDirectory(bundlePath, "invalid_bundle", "report bundle");
  await assertMode(bundlePath, 0o700, "report bundle");
  if (!options.allowStagedName && !UUID_V4_PATTERN.test(basename(bundlePath))) {
    throw new ReportStoreError(
      "invalid_reference",
      "report path does not name a completed UUID bundle"
    );
  }
  const entries = (await readdir(bundlePath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  );
  if (
    entries.length !== REPORT_FILES.length ||
    entries.some(
      (entry, index) =>
        entry.name !== [...REPORT_FILES].sort()[index] || !entry.isFile()
    )
  ) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report bundle must contain exactly report.json and report.md"
    );
  }

  await options.testHooks?.beforeBundleFileRead?.({ bundlePath });

  const jsonPath = join(bundlePath, REPORT_JSON);
  const markdownPath = join(bundlePath, REPORT_MARKDOWN);
  const [json, markdown] = await Promise.all([
    readPrivateRegularFile(jsonPath),
    readPrivateRegularFile(markdownPath),
  ]);
  const finalIdentity = await captureDirectoryIdentity(
    bundlePath,
    "report bundle"
  );
  assertSameDirectoryIdentity(initialIdentity, finalIdentity);
  await assertExactReportEntries(bundlePath);
  if (!options.allowSensitiveSource) {
    assertNoSensitiveContent(json, markdown, options.sentinels);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report.json is not valid JSON",
      {
        cause: error,
      }
    );
  }
  let report: SkillsetReport;
  try {
    report = validateAndNormalizeSkillsetReport(parsed);
  } catch (error) {
    throw new ReportStoreError("invalid_bundle", "report.json is invalid", {
      cause: error,
    });
  }
  if (report.id !== expectedId) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report manifest ID does not match its bundle directory"
    );
  }
  const expectedMarkdown = renderSkillsetReportMarkdown(report);
  if (markdown !== expectedMarkdown) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report.md does not match report.json"
    );
  }
  return { markdown: expectedMarkdown, report, resolvedPath: bundlePath };
}

interface DirectoryIdentity {
  readonly birthtimeMs: number;
  readonly canonicalPath: string;
  readonly ctimeMs: number;
  readonly dev: number;
  readonly ino: number;
}

function resolveStoreBoundary(
  options: ReportStoreOptions
): ReportStoreBoundary {
  if (options.boundary !== undefined) {
    const trustedBase = resolve(options.boundary.trustedBase);
    const reportRoot = resolve(options.boundary.reportRoot);
    if (!isContainedPath(trustedBase, reportRoot)) {
      throw new ReportStoreError(
        "invalid_reference",
        "report root is outside its trusted base"
      );
    }
    return { reportRoot, trustedBase };
  }
  const reportRoot = resolve(resolveReportStoreRoot(options));
  const env = options.env ?? process.env;
  const configuredState = env.XDG_STATE_HOME;
  const trustedBase =
    configuredState !== undefined &&
    configuredState.trim().length > 0 &&
    isAbsolute(configuredState)
      ? dirname(resolve(configuredState))
      : resolve(options.homeDir ?? homedir());
  return { reportRoot, trustedBase };
}

async function preparePrivateReportRoot(
  boundary: ReportStoreBoundary
): Promise<void> {
  const { reportRoot, trustedBase } = boundary;
  await createDirectoryPathWithoutSymlinks(trustedBase, reportRoot);
  await assertPlainDirectory(reportRoot, "invalid_reference", "report root");
  await enforceMode(reportRoot, 0o700);
  await assertOwned(reportRoot, "report root");
}

async function createDirectoryPathWithoutSymlinks(
  trustedBase: string,
  path: string
): Promise<void> {
  if (!isContainedPath(trustedBase, path)) {
    throw new ReportStoreError(
      "invalid_reference",
      "report root escapes its trusted base"
    );
  }
  await assertPlainDirectory(trustedBase, "invalid_reference", "trusted base");
  const components = relative(trustedBase, path)
    .split(sep)
    .filter((component) => component.length > 0);
  let current = trustedBase;
  for (const component of components) {
    current = join(current, component);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new ReportStoreError(
          "invalid_reference",
          "report root parent must be a plain directory"
        );
      }
      await assertOwnedFromStat(entry.uid, "report root parent");
      continue;
    } catch (error) {
      if (!isMissingError(error)) throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!isAlreadyExistsError(mkdirError)) throw mkdirError;
      }
    }
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new ReportStoreError(
        "invalid_reference",
        "report root creation encountered a symlink"
      );
    }
    await assertOwnedFromStat(entry.uid, "report root parent");
  }
}

async function captureDirectoryIdentity(
  path: string,
  label: string
): Promise<DirectoryIdentity> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new ReportStoreError(
      "invalid_bundle",
      `${label} must remain a plain directory`
    );
  }
  await assertOwnedFromStat(entry.uid, label);
  return {
    birthtimeMs: entry.birthtimeMs,
    canonicalPath: await realpath(path),
    ctimeMs: entry.ctimeMs,
    dev: entry.dev,
    ino: entry.ino,
  };
}

function assertSameDirectoryIdentity(
  before: DirectoryIdentity,
  after: DirectoryIdentity
): void {
  if (
    before.canonicalPath !== after.canonicalPath ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    (before.ino === 0 &&
      (before.birthtimeMs !== after.birthtimeMs ||
        before.ctimeMs !== after.ctimeMs))
  ) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report bundle directory changed during validation"
    );
  }
}

function assertSameFilesystemObjectIdentity(
  before: DirectoryIdentity,
  after: DirectoryIdentity
): void {
  const inodeChanged =
    before.ino !== 0 && after.ino !== 0 && before.ino !== after.ino;
  const inodeAvailabilityChanged = (before.ino === 0) !== (after.ino === 0);
  const inodeUnavailableAndBirthChanged =
    before.ino === 0 &&
    after.ino === 0 &&
    before.birthtimeMs !== after.birthtimeMs;
  if (
    before.dev !== after.dev ||
    inodeChanged ||
    inodeAvailabilityChanged ||
    inodeUnavailableAndBirthChanged
  ) {
    throw new ReportStoreError(
      "invalid_bundle",
      "published report bundle is not the validated staged bundle"
    );
  }
}

async function assertExactReportEntries(bundlePath: string): Promise<void> {
  const entries = (await readdir(bundlePath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  );
  if (
    entries.length !== REPORT_FILES.length ||
    entries.some(
      (entry, index) =>
        entry.name !== [...REPORT_FILES].sort()[index] || !entry.isFile()
    )
  ) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report bundle must contain exactly report.json and report.md"
    );
  }
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await enforceMode(path, 0o600);
  await assertMode(path, 0o600, basename(path));
  await assertOwned(path, basename(path));
}

async function readPrivateRegularFile(path: string): Promise<string> {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(path, flags);
    const entry = await handle.stat();
    if (!entry.isFile()) {
      throw new ReportStoreError(
        "invalid_bundle",
        `${basename(path)} is not a regular file`
      );
    }
    await assertModeFromStat(entry.mode, 0o600, basename(path));
    await assertOwnedFromStat(entry.uid, basename(path));
    return await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof ReportStoreError) throw error;
    if (isSymlinkOpenError(error)) {
      throw new ReportStoreError(
        "invalid_bundle",
        `${basename(path)} must not be a symlink`
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function assertNoSymlinkPath(
  root: string,
  target: string,
  code: ReportStoreErrorCode
): Promise<void> {
  if (!isContainedPath(root, target)) {
    throw new ReportStoreError(code, "report path escapes its trusted root");
  }
  const components = relative(root, target)
    .split(sep)
    .filter((component) => component.length > 0);
  let current = root;
  const paths = [root];
  for (const component of components) {
    current = join(current, component);
    paths.push(current);
  }
  for (const path of paths) {
    let entry;
    try {
      entry = await lstat(path);
    } catch (error) {
      if (isMissingError(error)) {
        throw new ReportStoreError(code, "report path does not exist");
      }
      throw error;
    }
    if (entry.isSymbolicLink()) {
      throw new ReportStoreError(code, "report path must not contain symlinks");
    }
  }
}

async function assertPlainDirectory(
  path: string,
  code: ReportStoreErrorCode,
  label: string
): Promise<void> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (isMissingError(error)) {
      throw new ReportStoreError(code, `${label} does not exist`);
    }
    throw error;
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new ReportStoreError(code, `${label} must be a plain directory`);
  }
  await assertOwnedFromStat(entry.uid, label);
}

async function enforceMode(path: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(path, mode);
  await assertMode(path, mode, basename(path));
}

async function assertMode(
  path: string,
  mode: number,
  label: string
): Promise<void> {
  if (process.platform === "win32") return;
  const entry = await lstat(path);
  await assertModeFromStat(entry.mode, mode, label);
}

async function assertModeFromStat(
  actual: number,
  expected: number,
  label: string
): Promise<void> {
  if (process.platform === "win32") return;
  if ((actual & 0o777) !== expected) {
    throw new ReportStoreError(
      "invalid_bundle",
      `${label} must have mode ${expected.toString(8)}`
    );
  }
}

async function assertOwned(path: string, label: string): Promise<void> {
  if (process.platform === "win32" || process.getuid === undefined) return;
  const entry = await lstat(path);
  await assertOwnedFromStat(entry.uid, label);
}

async function assertOwnedFromStat(uid: number, label: string): Promise<void> {
  if (process.platform === "win32" || process.getuid === undefined) return;
  if (uid !== process.getuid()) {
    throw new ReportStoreError(
      "invalid_bundle",
      `${label} must be owned by the current user`
    );
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) throw error;
  } finally {
    await handle?.close();
  }
}

function assertNoSensitiveContent(
  json: string,
  markdown: string,
  sentinels: readonly string[] = []
): void {
  if (
    containsSensitiveReportContent(json, sentinels) ||
    containsSensitiveReportContent(markdown, sentinels)
  ) {
    throw new ReportStoreError(
      "invalid_bundle",
      "report contains sensitive content"
    );
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingError(error)) return false;
    throw error;
  }
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isSymlinkOpenError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ELOOP" || error.code === "EMLINK")
  );
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EINVAL", "ENOTSUP", "EPERM"].includes(String(error.code))
  );
}
