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
  if (isRuntimeSourcePath(path, "packages/provider-formats/src")) return true;
  if (isRuntimeSourcePath(path, "packages/schema/src")) return true;
  if (isRuntimeSourcePath(path, "packages/toolkit/src")) return true;
  if (isRuntimeSourcePath(path, "packages/transforms/src")) return true;

  return (
    path === "packages/core/package.json" ||
    path === "packages/lint/package.json" ||
    path === "packages/provider-formats/package.json" ||
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
