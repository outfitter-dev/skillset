/**
 * Merge policy guard (SET-601).
 *
 * `.gitattributes` can only express globs, but which files are generated is
 * decided by the committed `skillset.lock` files. This guard closes that gap in
 * both directions: every tracked file is sorted into exactly one merge-policy
 * category, and its resolved git `merge` attribute must be the one that
 * category requires.
 *
 * Nothing here enumerates paths. The generated set comes from the locks, the
 * ledger set from the pathspec the change-stream guard already declares, and
 * authored is the remainder — so a new file of any kind is covered the moment
 * it is tracked, and an over-broad `.gitattributes` pattern is caught by the
 * authored side rather than by someone noticing.
 *
 * Run it with `bun run generated-merge-policy:guard`.
 */

import { dirname, join } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { CHANGE_STREAM_PATHSPEC } from "./change-stream-guard";

const LOCK_FILE = "skillset.lock";

/**
 * The three kinds of file this repository commits, and the one git `merge`
 * value each requires.
 *
 * - `generated-snapshot` is full-state and derived. It cannot be merged at all,
 *   only regenerated, so `-merge` (unset) makes git conflict it whole and
 *   `skillset resolve` rebuilds it.
 * - `append-only-ledger` only ever grows, so both sides are always valid and
 *   `union` concatenates them; `change-stream:guard` checks what union cannot.
 * - `authored` is the only content where a conflict carries information, so it
 *   keeps git's ordinary three-way merge (`unspecified`).
 */
export const MERGE_POLICY_BY_CATEGORY = {
  "append-only-ledger": "union",
  authored: "unspecified",
  "generated-snapshot": "unset",
} as const;

export type MergePolicyCategory = keyof typeof MERGE_POLICY_BY_CATEGORY;

/**
 * Pathspecs for append-only ledgers. This is the one category neither git nor
 * the locks can infer, so it is declared — once, reusing the change-stream
 * guard's own pathspec rather than restating it here.
 */
const LEDGER_PATHSPECS: readonly string[] = [CHANGE_STREAM_PATHSPEC];

export interface MergePolicyViolation {
  readonly category: MergePolicyCategory;
  readonly detail: string;
  readonly path: string;
}

export interface MergePolicyReport {
  readonly counts: Readonly<Record<MergePolicyCategory, number>>;
  readonly violations: readonly MergePolicyViolation[];
}

async function git(rootPath: string, args: readonly string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit ${exitCode}`);
  }
  return stdout;
}

async function listFiles(
  rootPath: string,
  pathspecs: readonly string[] = []
): Promise<readonly string[]> {
  const args =
    pathspecs.length === 0
      ? ["ls-files"]
      : ["ls-files", "--", ...pathspecs];
  return (await git(rootPath, args)).split("\n").filter((line) => line.length > 0);
}

/** Every generated path the committed locks claim, plus the locks themselves. */
export async function readGeneratedPaths(
  rootPath: string
): Promise<readonly string[]> {
  const locks = await listFiles(rootPath, [LOCK_FILE, `*/${LOCK_FILE}`]);
  const generated = new Set<string>();
  for (const lock of locks.filter(isLockPath)) {
    generated.add(lock);
    const root = dirname(lock) === "." ? "" : dirname(lock);
    const parsed = (await Bun.file(join(rootPath, lock)).json()) as {
      readonly items?: readonly { readonly files?: readonly string[] }[];
    };
    for (const item of parsed.items ?? []) {
      for (const file of item.files ?? []) {
        generated.add(
          (root === "" ? file : join(root, file)).replaceAll("\\", "/")
        );
      }
    }
  }
  return [...generated].sort();
}

/** `git check-attr merge` for many paths at once, keyed by path. */
export async function readMergePolicies(
  rootPath: string,
  paths: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  if (paths.length === 0) return new Map();
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, "check-attr", "--stdin", "-z", "merge"],
    env: gitSafeEnv(),
    stdin: new TextEncoder().encode(`${paths.join("\0")}\0`),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error("git check-attr failed");
  // `-z` emits NUL-separated <path> <attr> <value> triples.
  const fields = stdout.split("\0");
  const policies = new Map<string, string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    policies.set(fields[index] ?? "", fields[index + 2] ?? "");
  }
  return policies;
}

function isLockPath(path: string): boolean {
  return path === LOCK_FILE || path.endsWith(`/${LOCK_FILE}`);
}

/** Sort every tracked file into exactly one category. */
export async function categorizeTrackedPaths(
  rootPath: string
): Promise<ReadonlyMap<string, MergePolicyCategory>> {
  const generated = new Set(await readGeneratedPaths(rootPath));
  const ledgers = new Set(await listFiles(rootPath, LEDGER_PATHSPECS));
  const categories = new Map<string, MergePolicyCategory>();
  for (const path of await listFiles(rootPath)) {
    if (generated.has(path)) {
      categories.set(path, "generated-snapshot");
      continue;
    }
    categories.set(
      path,
      ledgers.has(path) ? "append-only-ledger" : "authored"
    );
  }
  // A lock claiming a path git does not track is still the guard's business.
  for (const path of generated) {
    if (!categories.has(path)) categories.set(path, "generated-snapshot");
  }
  return categories;
}

/** Check one repository's whole tracked tree against the policy model. */
export async function checkMergePolicy(
  rootPath: string
): Promise<MergePolicyReport> {
  const categories = await categorizeTrackedPaths(rootPath);
  const policies = await readMergePolicies(rootPath, [...categories.keys()]);
  const violations: MergePolicyViolation[] = [];
  const counts: Record<MergePolicyCategory, number> = {
    "append-only-ledger": 0,
    authored: 0,
    "generated-snapshot": 0,
  };

  for (const [path, category] of categories) {
    counts[category] += 1;
    const expected = MERGE_POLICY_BY_CATEGORY[category];
    const actual = policies.get(path) ?? "unspecified";
    if (actual === expected) continue;
    violations.push({
      category,
      detail:
        category === "authored"
          ? `authored file resolves merge=${actual}; narrow the generated .gitattributes patterns`
          : `${category} resolves merge=${actual}, expected ${expected}; fix its .gitattributes pattern`,
      path,
    });
  }

  return { counts, violations: violations.sort(comparePaths) };
}

function comparePaths(
  left: MergePolicyViolation,
  right: MergePolicyViolation
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function main(): Promise<void> {
  const report = await checkMergePolicy(process.cwd());
  if (report.violations.length > 0) {
    for (const violation of report.violations) {
      console.error(`  ${violation.path}: ${violation.detail}`);
    }
    console.error(
      `skillset: merge policy guard found ${report.violations.length} misclassified path(s)`
    );
    process.exit(1);
  }
  const { counts } = report;
  console.log(
    `skillset: merge policy guard checked ${counts["generated-snapshot"]} generated, ` +
      `${counts["append-only-ledger"]} ledger, and ${counts.authored} authored path(s); ` +
      "each matches its category's merge policy"
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
