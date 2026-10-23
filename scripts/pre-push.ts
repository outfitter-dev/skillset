/**
 * Receipt-aware pre-push check for every pushed ref.
 *
 * Git hands pre-push one `<local-ref> <local-sha> <remote-ref> <remote-sha>`
 * line per ref on stdin. The full gate no longer runs here; it runs ahead of
 * time through `bun run verify`, which records a receipt per tree. For each
 * pushed commit this hook:
 *
 * 1. checks whitespace over `trunk...commit`;
 * 2. accepts the ref when a valid verify receipt exists for its tree on its
 *    merge base with trunk;
 * 3. otherwise, when the ref is the clean checked-out tree, runs the fast tier
 *    (`bun run check:fast`) in place, and reports that no full receipt exists;
 * 4. otherwise reports the ref as unverified.
 *
 * Unverified refs pass by default: draft pull requests carry them, and hosted
 * CI runs the full gate before any merge. `SKILLSET_PUSH_STRICT=1` fails the
 * push instead. Run outside a push (no stdin), it checks `HEAD`.
 */
import { isAbsolute, resolve } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { mergeBase, readReceiptStatus, resolveTrunk } from "./verify";

const ZERO = /^0+$/u;

export interface PushedRef {
  readonly localRef: string;
  readonly commit: string;
}

/** Parse pre-push stdin; deletions (an all-zero local sha) are skipped. */
export function parsePushedRefs(input: string): PushedRef[] {
  const refs: PushedRef[] = [];
  for (const line of input.split("\n")) {
    const [localRef, commit] = line.trim().split(/\s+/u);
    if (!localRef || !commit || ZERO.test(commit)) continue;
    refs.push({ commit, localRef });
  }
  return refs;
}

export type RefVerdict = "verified" | "fast-tier" | "unverified";

/** Decide what a pushed ref needs, given what is known about it. */
export function refVerdict(input: {
  readonly hasReceipt: boolean;
  readonly isCleanHead: boolean;
}): RefVerdict {
  if (input.hasReceipt) return "verified";
  return input.isCleanHead ? "fast-tier" : "unverified";
}

async function git(args: readonly string[], cwd: string) {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...gitSafeEnv(), GIT_PAGER: "cat" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stderr: stderr.trim(), stdout: stdout.trim() };
}

async function must(args: readonly string[], cwd: string): Promise<string> {
  const result = await git(args, cwd);
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.code}: ${result.stderr}`
    );
  }
  return result.stdout;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return Bun.stdin.text();
}

async function main(): Promise<number> {
  const strict = process.env.SKILLSET_PUSH_STRICT === "1";
  const repoRoot = await must(["rev-parse", "--show-toplevel"], process.cwd());
  const commonRaw = await must(["rev-parse", "--git-common-dir"], repoRoot);
  const gitCommonDir = isAbsolute(commonRaw)
    ? commonRaw
    : resolve(repoRoot, commonRaw);
  const trunk = await resolveTrunk(repoRoot);

  const input = await readStdin();
  let refs = parsePushedRefs(input);
  if (refs.length === 0) {
    // Git sent lines, but every one deletes a remote ref: nothing to check.
    if (input.trim().length > 0) return 0;
    refs = [
      { commit: await must(["rev-parse", "HEAD"], repoRoot), localRef: "HEAD" },
    ];
  }

  const headTree = await must(["rev-parse", "HEAD^{tree}"], repoRoot);
  const clean = (await must(["status", "--porcelain"], repoRoot)).length === 0;
  let failed = false;
  let fastTierRan = false;

  for (const ref of refs) {
    const label = `${ref.localRef} (${ref.commit.slice(0, 12)})`;
    const whitespace = await git(
      ["diff", "--check", `${trunk.commit}...${ref.commit}`],
      repoRoot
    );
    if (whitespace.code !== 0) {
      console.error(
        `pre-push: ${label}: whitespace errors against ${trunk.ref}:\n${whitespace.stdout}`
      );
      failed = true;
      continue;
    }
    const tree = await must(["rev-parse", `${ref.commit}^{tree}`], repoRoot);
    const base = await mergeBase(repoRoot, ref.commit, trunk.commit);
    const receipt = await readReceiptStatus(gitCommonDir, tree, base);
    const verdict = refVerdict({
      hasReceipt: receipt.valid,
      isCleanHead: clean && tree === headTree,
    });
    if (verdict === "verified") {
      console.log(`pre-push: ${label}: verified`);
      continue;
    }
    const reason = receipt.valid ? "" : receipt.reason;
    const hint = `no full verify receipt (${reason}); run \`bun run verify ${ref.localRef}\``;
    if (verdict === "fast-tier" && !fastTierRan) {
      console.log(`pre-push: ${label}: ${hint}. Running the fast tier.`);
      const child = Bun.spawn({
        cmd: ["bun", "run", "check:fast"],
        cwd: repoRoot,
        env: gitSafeEnv(),
        stderr: "inherit",
        stdout: "inherit",
      });
      fastTierRan = true;
      if ((await child.exited) !== 0) {
        console.error(`pre-push: ${label}: fast tier failed`);
        failed = true;
        continue;
      }
    } else if (verdict === "unverified") {
      console.log(`pre-push: ${label}: ${hint}.`);
    }
    if (strict) {
      console.error(
        `pre-push: ${label}: SKILLSET_PUSH_STRICT=1 requires a verify receipt`
      );
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main();
