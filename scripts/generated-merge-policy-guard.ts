/**
 * Merge policy guard (SET-601, SET-769).
 *
 * `.gitattributes` can only express globs, but which files are generated is
 * decided by the committed `skillset.lock` files. This guard closes that gap:
 * every tracked file is sorted into exactly one merge-policy category, and its
 * resolved git `merge` attribute must be the one that category requires.
 * Since ADR-0045 generated output merges as ordinary text, so the guard keeps
 * a `-merge` or `union` pattern from claiming it, or an authored file, again.
 *
 * Nothing here enumerates paths. The generated set comes from the locks, the
 * ledger set from the pathspec the change-stream guard already declares, and
 * authored is the remainder — so a new file of any kind is covered the moment
 * it is tracked, and an over-broad `.gitattributes` pattern is caught by the
 * authored side rather than by someone noticing.
 *
 * Run it with `bun run generated-merge-policy:guard`.
 */

import path from "node:path";

import { readLegacyGeneratedLockFromDisk } from "@skillset/core";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { CHANGE_STREAM_PATHSPEC } from "./change-stream-guard";

const LOCK_FILE = "skillset.lock";

/**
 * The three kinds of file this repository commits, and the one git `merge`
 * value each requires.
 *
 * - `generated-snapshot` is derived, and each lock line belongs to one unit
 *   (ADR-0045), so git's ordinary three-way merge (`unspecified`) of branches
 *   that changed different units is the merged render. A true conflict still
 *   conflicts, and `skillset resolve` regenerates it. GitHub's server-side
 *   merge ignores merge attributes anyway, so `-merge` would only make local
 *   merges and restacks disagree with it.
 * - `append-only-ledger` only ever grows, so both sides are always valid and
 *   `union` concatenates them; `change-stream:guard` checks what union cannot.
 * - `authored` keeps git's ordinary three-way merge (`unspecified`).
 */
export const MERGE_POLICY_BY_CATEGORY = {
  "append-only-ledger": "union",
  authored: "unspecified",
  "generated-snapshot": "unspecified",
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

const git = async (
  rootPath: string,
  args: readonly string[]
): Promise<string> => {
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
};

const listFiles = async (
  rootPath: string,
  pathspecs: readonly string[] = []
): Promise<readonly string[]> => {
  const args =
    pathspecs.length === 0
      ? ["ls-files", "-z"]
      : ["ls-files", "-z", "--", ...pathspecs];
  const stdout = await git(rootPath, args);
  return stdout.split("\0").filter((line) => line.length > 0);
};

export const isLockPath = (candidatePath: string): boolean =>
  candidatePath === LOCK_FILE || candidatePath.endsWith(`/${LOCK_FILE}`);

const outputFiles = (item: {
  readonly files: readonly string[];
  readonly outputPath?: string;
}): readonly string[] => {
  if (item.files.length > 0) {
    return item.files;
  }
  return item.outputPath === undefined ? [] : [item.outputPath];
};

/** Generated claims from tracked locks and caller-supplied current lock locations. */
export const readGeneratedPaths = async (
  rootPath: string,
  currentLockPaths: readonly string[] = []
): Promise<readonly string[]> => {
  const trackedLocks = await listFiles(rootPath, [LOCK_FILE, `*/${LOCK_FILE}`]);
  const locks = [...new Set([...trackedLocks, ...currentLockPaths])];
  const generated = new Set<string>();
  const parsedLocks = await Promise.all(
    locks.filter(isLockPath).map(async (lock) => {
      // SET-638: inspect ownership claims; the guard supplies tracked locks and
      // authoring callers may add current lock locations. Use the explicit legacy
      // inspect policy so pre-v4 committed state stays readable and corruption
      // cannot be treated as an empty generated set.
      const read = await readLegacyGeneratedLockFromDisk(
        path.join(rootPath, lock),
        {
          logicalPath: lock,
          missing: trackedLocks.includes(lock) ? "error" : "absent",
          provenance: "inspect",
        }
      );
      if (read.kind !== "present") return undefined;
      return { lock, parsed: read.lock };
    })
  );
  for (const entry of parsedLocks) {
    if (entry === undefined) continue;
    const { lock, parsed } = entry;
    generated.add(lock);
    const outputRoot = path.posix.dirname(lock);
    for (const item of parsed.items) {
      for (const file of outputFiles(item)) {
        generated.add(path.posix.join(outputRoot, file));
      }
    }
  }
  return [...generated].toSorted();
};

/** `git check-attr merge` for many paths at once, keyed by path. */
export const readMergePolicies = async (
  rootPath: string,
  paths: readonly string[],
  ignoreCase: boolean
): Promise<ReadonlyMap<string, string>> => {
  if (paths.length === 0) {
    return new Map();
  }
  const proc = Bun.spawn({
    cmd: [
      "git",
      "-C",
      rootPath,
      "-c",
      `core.ignorecase=${String(ignoreCase)}`,
      "check-attr",
      "--stdin",
      "-z",
      "merge",
    ],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdin: new TextEncoder().encode(`${paths.join("\0")}\0`),
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error("git check-attr failed");
  }
  // `-z` emits NUL-separated <path> <attr> <value> triples.
  const fields = stdout.split("\0");
  const policies = new Map<string, string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    policies.set(fields[index] ?? "", fields[index + 2] ?? "");
  }
  return policies;
};

/** Sort every tracked file into exactly one category. */
export const categorizeTrackedPaths = async (
  rootPath: string
): Promise<ReadonlyMap<string, MergePolicyCategory>> => {
  const generated = new Set(await readGeneratedPaths(rootPath));
  const ledgers = new Set(await listFiles(rootPath, LEDGER_PATHSPECS));
  const categories = new Map<string, MergePolicyCategory>();
  for (const trackedPath of await listFiles(rootPath)) {
    if (generated.has(trackedPath)) {
      categories.set(trackedPath, "generated-snapshot");
      continue;
    }
    categories.set(
      trackedPath,
      ledgers.has(trackedPath) ? "append-only-ledger" : "authored"
    );
  }
  // A lock claiming a path git does not track is still the guard's business.
  for (const generatedPath of generated) {
    if (!categories.has(generatedPath)) {
      categories.set(generatedPath, "generated-snapshot");
    }
  }
  return categories;
};

const comparePaths = (
  left: MergePolicyViolation,
  right: MergePolicyViolation
): number => {
  if (left.path < right.path) {
    return -1;
  }
  return left.path > right.path ? 1 : 0;
};

/** Check one repository's whole tracked tree against the policy model. */
export const checkMergePolicy = async (
  rootPath: string
): Promise<MergePolicyReport> => {
  const categories = await categorizeTrackedPaths(rootPath);
  const violations: MergePolicyViolation[] = [];
  const counts: Record<MergePolicyCategory, number> = {
    "append-only-ledger": 0,
    authored: 0,
    "generated-snapshot": 0,
  };

  for (const category of categories.values()) {
    counts[category] += 1;
  }

  const policySets = await Promise.all(
    [false, true].map(async (ignoreCase) => ({
      ignoreCase,
      policies: await readMergePolicies(
        rootPath,
        [...categories.keys()],
        ignoreCase
      ),
    }))
  );
  for (const { ignoreCase, policies } of policySets) {
    for (const [trackedPath, category] of categories) {
      const expected = MERGE_POLICY_BY_CATEGORY[category];
      const actual = policies.get(trackedPath) ?? "unspecified";
      if (actual === expected) {
        continue;
      }
      const mode = `core.ignorecase=${String(ignoreCase)}`;
      violations.push({
        category,
        detail:
          category === "append-only-ledger"
            ? `${category} resolves merge=${actual}, expected ${expected} with ${mode}; fix its .gitattributes pattern`
            : `${category} file resolves merge=${actual} with ${mode}; remove the .gitattributes pattern that claims it`,
        path: trackedPath,
      });
    }
  }

  return { counts, violations: violations.toSorted(comparePaths) };
};

const main = async (): Promise<void> => {
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
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
