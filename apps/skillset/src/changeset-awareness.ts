import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { parseMarkdown } from "@skillset/core/internal/yaml";

import { gitSafeEnv } from "./git-env";

export type ChangedFile = {
  path: string;
  status?: string;
};

export type ChangesetGuardResult = {
  changesetFiles: readonly ChangedFile[];
  diagnostics: readonly string[];
  ok: boolean;
  packageFiles: readonly ChangedFile[];
};

export type MixedChangesetReleaseEntry = {
  readonly changesetPath: string;
  readonly ignoredPackages: readonly string[];
  readonly publishedPackages: readonly string[];
};

export async function findMixedChangesetReleaseEntries(
  rootPath: string
): Promise<readonly MixedChangesetReleaseEntry[]> {
  const changesetConfig = await readJsonRecord(join(rootPath, ".changeset/config.json"));
  const ignoredPackages = new Set(readStringArray(changesetConfig.ignore));
  const privatePackages = isRecord(changesetConfig.privatePackages)
    ? changesetConfig.privatePackages
    : {};

  for (const workspaceRoot of ["apps", "packages"]) {
    const entries = await readDirectory(join(rootPath, workspaceRoot));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readJsonRecord(join(rootPath, workspaceRoot, entry.name, "package.json"));
      const name = typeof manifest.name === "string" ? manifest.name : undefined;
      if (name && manifest.private === true && privatePackages.version !== true) {
        ignoredPackages.add(name);
      }
    }
  }

  const mixed: MixedChangesetReleaseEntry[] = [];
  for (const entry of (await readDirectory(join(rootPath, ".changeset")))
    .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const changesetPath = `.changeset/${entry.name}`;
    const source = await Bun.file(join(rootPath, changesetPath)).text();
    const packageNames = Object.keys(parseMarkdown(source, changesetPath).frontmatter).sort();
    const ignored = packageNames.filter((name) => ignoredPackages.has(name));
    const published = packageNames.filter((name) => !ignoredPackages.has(name));
    if (ignored.length === 0 || published.length === 0) continue;
    mixed.push({
      changesetPath,
      ignoredPackages: ignored,
      publishedPackages: published,
    });
  }

  return mixed;
}

export function evaluateChangesetGuard(changedFiles: readonly ChangedFile[]): ChangesetGuardResult {
  const packageFiles = changedFiles.filter((file) => isPackageAffectingPath(file.path));
  const changesetFiles = changedFiles.filter(isActiveChangesetEntry);
  const diagnostics: string[] = [];

  if (packageFiles.length > 0 && changesetFiles.length === 0) {
    diagnostics.push(
      `Package-facing changes require a .changeset/*.md entry. Changed package paths: ${summarizePaths(packageFiles)}`
    );
  }

  if (packageFiles.length === 0 && changesetFiles.some(isNewStatus)) {
    diagnostics.push(
      `Changeset entries are only for published package payload changes. Remove ${summarizePaths(changesetFiles)} or include the package-facing change on this branch.`
    );
  }

  return {
    changesetFiles,
    diagnostics,
    ok: diagnostics.length === 0,
    packageFiles,
  };
}

export function isActiveChangesetEntry(file: ChangedFile) {
  return /^\.changeset\/[^/]+\.md$/.test(file.path) && !isDeletedStatus(file.status);
}

export function isPackageAffectingPath(path: string) {
  if (path === "apps/skillset/package.json") return true;
  if (path === "bun.lock" || path === "bun.lockb") return true;

  if (isRuntimeSourcePath(path, "apps/skillset/src")) return true;
  if (isRuntimeSourcePath(path, "packages/core/src")) return true;
  if (isRuntimeSourcePath(path, "packages/lint/src")) return true;
  if (isRuntimeSourcePath(path, "packages/registry/src")) return true;
  if (isRuntimeSourcePath(path, "packages/schema/src")) return true;
  if (isRuntimeSourcePath(path, "packages/toolkit/src")) return true;
  if (isRuntimeSourcePath(path, "packages/transforms/src")) return true;

  return (
    path === "packages/core/package.json" ||
    path === "packages/lint/package.json" ||
    path === "packages/registry/package.json" ||
    path === "packages/schema/package.json" ||
    path === "packages/toolkit/package.json" ||
    path === "packages/transforms/package.json"
  );
}

export function parseChangedFileLine(line: string): ChangedFile | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  const tabParts = trimmed.split("\t");
  const [tabStatus] = tabParts;
  if (tabParts.length > 1 && tabStatus && isStatusToken(tabStatus)) {
    const path = tabParts.at(-1);
    if (path) return { path, status: tabStatus };
  }

  const statusMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/);
  if (statusMatch) {
    const [, status, path] = statusMatch;
    if (status && path && isStatusToken(status)) return { path, status };
  }

  return { path: trimmed };
}

export async function readChangedFilesFromPath(path: string): Promise<readonly ChangedFile[]> {
  const raw = await Bun.file(path).text();
  return raw.split("\n").map(parseChangedFileLine).filter((file): file is ChangedFile => Boolean(file));
}

export async function readChangedFilesFromGit(rootPath: string, base: string): Promise<readonly ChangedFile[]> {
  const output = await runText(["git", "-C", rootPath, "diff", "--name-status", `${base}...HEAD`], rootPath);
  if (!output) return [];
  return output.split("\n").map(parseChangedFileLine).filter((file): file is ChangedFile => Boolean(file));
}

export async function defaultChangesetBaseline(rootPath: string): Promise<string> {
  for (const candidate of ["origin/HEAD", "origin/main", "main"]) {
    const mergeBase = await runText(
      ["git", "-C", rootPath, "merge-base", "HEAD", candidate],
      rootPath,
      { allowFailure: true }
    );
    if (mergeBase !== undefined && mergeBase.trim().length > 0) return mergeBase.trim();
  }

  const head = await runText(
    ["git", "-C", rootPath, "rev-parse", "--verify", "HEAD^{commit}"],
    rootPath,
    { allowFailure: true }
  );
  if (head !== undefined && head.trim().length > 0) return head.trim();

  throw new Error("skillset: could not resolve a Changesets baseline; pass --since <ref>");
}

function isRuntimeSourcePath(path: string, root: string) {
  if (!path.startsWith(`${root}/`)) return false;
  const relative = path.slice(root.length + 1);
  if (!relative) return false;
  if (relative.startsWith("__tests__/")) return false;
  if (relative.endsWith(".test.ts")) return false;
  if (relative === "AGENTS.md") return false;
  return true;
}

function isDeletedStatus(status: string | undefined) {
  return status === "D" || status === "deleted" || status === "removed";
}

function isNewStatus(file: ChangedFile) {
  return file.status === "A" || file.status === "added";
}

function isStatusToken(value: string) {
  return /^[ACDMRTUXB][0-9]*$/.test(value) || githubFileStatuses.has(value);
}

const githubFileStatuses = new Set([
  "added",
  "changed",
  "copied",
  "deleted",
  "modified",
  "removed",
  "renamed",
  "unchanged",
]);

function summarizePaths(files: readonly ChangedFile[]) {
  const paths = files.map((file) => file.path);
  const shown = paths.slice(0, 8);
  const suffix = paths.length > shown.length ? `, and ${paths.length - shown.length} more` : "";
  return shown.join(", ") + suffix;
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const parsed = await Bun.file(path).json() as unknown;
  if (!isRecord(parsed)) throw new Error(`skillset: expected ${path} to contain a JSON object`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function runText(
  command: readonly string[],
  cwd: string,
  options: { readonly allowFailure?: boolean } = {}
) {
  const subprocess = Bun.spawn([...command], {
    cwd,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode !== 0) {
    if (options.allowFailure === true) return undefined;
    throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  }

  return stdout.trim();
}
