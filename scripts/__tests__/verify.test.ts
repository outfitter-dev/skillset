import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import {
  initializeTestGitRepository,
  runTestGit,
} from "../test-helpers/git-remote";
import {
  checkReceipt,
  parseOptions,
  readReceiptStatus,
  receiptPath,
  VERIFY_GATES,
  VERIFY_RECEIPT_SCHEMA_VERSION,
  verifyTarget,
  writeReceipt,
  type GateRunner,
  type VerifyContext,
  type VerifyReceipt,
} from "../verify";

function receipt(overrides: Partial<VerifyReceipt> = {}): VerifyReceipt {
  return {
    schemaVersion: VERIFY_RECEIPT_SCHEMA_VERSION,
    tree: "a".repeat(40),
    commit: "b".repeat(40),
    trunk: { ref: "origin/main", commit: "c".repeat(40) },
    mergeBase: "c".repeat(40),
    gates: VERIFY_GATES.map((argv) => ({ argv, exitCode: 0, durationMs: 1 })),
    bunVersion: "1.4.0",
    lockfileSha256: "d".repeat(64),
    host: { platform: "linux", arch: "x64", release: "test" },
    startedAt: "2026-10-22T00:00:00.000Z",
    endedAt: "2026-10-22T00:01:00.000Z",
    ...overrides,
  };
}

async function fixtureRepo(): Promise<{
  root: string;
  repo: string;
  gitDir: string;
}> {
  const root = await createTestFixtureRoot("skillset-verify-");
  const repo = join(root, "repo");
  await mkdir(repo);
  await writeFile(join(repo, "file.txt"), "one\n");
  await initializeTestGitRepository(repo, { disposableRoot: root });
  return { root, repo, gitDir: join(repo, ".git") };
}

function context(
  repo: string,
  gitDir: string,
  checkoutRoot: string,
  runGate: GateRunner
): VerifyContext {
  return {
    repoRoot: repo,
    gitCommonDir: gitDir,
    trunk: { ref: "origin/main", commit: "HEAD" },
    originUrl: null,
    bunVersion: "1.4.0",
    keep: false,
    prepare: async (target) => {
      const dir = join(checkoutRoot, target.tree);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    runGate,
  };
}

describe("checkReceipt", () => {
  test("accepts a passing receipt for its own tree", () => {
    expect(checkReceipt(receipt(), "a".repeat(40)).valid).toBe(true);
  });

  test("rejects a receipt for another tree", () => {
    expect(checkReceipt(receipt(), "e".repeat(40))).toEqual({
      valid: false,
      reason: "receipt names a different tree",
    });
  });

  test("retires receipts when the gate list changes", () => {
    const stale = receipt({
      gates: [{ argv: ["bun", "run", "test"], exitCode: 0, durationMs: 1 }],
    });
    expect(checkReceipt(stale, stale.tree)).toEqual({
      valid: false,
      reason: "gate list changed since this receipt",
    });
  });

  test("never certifies a failed gate", () => {
    const failed = receipt({
      gates: VERIFY_GATES.map((argv, index) => ({
        argv,
        exitCode: index === 0 ? 1 : 0,
        durationMs: 1,
      })),
    });
    expect(checkReceipt(failed, failed.tree).valid).toBe(false);
  });

  test("rejects other schema versions", () => {
    const old = { ...receipt(), schemaVersion: 0 };
    expect(checkReceipt(old, old.tree).valid).toBe(false);
  });
});

describe("receipts on disk", () => {
  test("writeReceipt refuses a failing receipt and writes nothing", async () => {
    const { gitDir } = await fixtureRepo();
    const failed = receipt({
      gates: VERIFY_GATES.map((argv) => ({ argv, exitCode: 2, durationMs: 1 })),
    });
    await expect(writeReceipt(gitDir, failed)).rejects.toThrow(
      "refusing to write receipt"
    );
    expect(await readReceiptStatus(gitDir, failed.tree)).toEqual({
      valid: false,
      reason: "no receipt",
    });
  });

  test("a reworded commit keeps the same tree and so the same receipt", async () => {
    const { repo, gitDir } = await fixtureRepo();
    const tree = await runTestGit(repo, "rev-parse", "HEAD^{tree}");
    await writeReceipt(gitDir, receipt({ tree }));
    await runTestGit(repo, "commit", "--amend", "-m", "reworded");
    const rewordedTree = await runTestGit(repo, "rev-parse", "HEAD^{tree}");
    expect(rewordedTree).toBe(tree);
    expect((await readReceiptStatus(gitDir, rewordedTree)).valid).toBe(true);
  });

  test("corrupt receipts read as invalid instead of throwing", async () => {
    const { gitDir } = await fixtureRepo();
    const tree = "f".repeat(40);
    await mkdir(join(gitDir, "skillset", "receipts"), { recursive: true });
    await writeFile(receiptPath(gitDir, tree), "{not json");
    expect(await readReceiptStatus(gitDir, tree)).toEqual({
      valid: false,
      reason: "receipt is not valid JSON",
    });
  });
});

describe("verifyTarget", () => {
  test("runs every gate in order and writes a receipt", async () => {
    const { root, repo, gitDir } = await fixtureRepo();
    const commit = await runTestGit(repo, "rev-parse", "HEAD");
    const tree = await runTestGit(repo, "rev-parse", "HEAD^{tree}");
    const ran: string[] = [];
    const outcome = await verifyTarget(
      { ref: "HEAD", commit, tree },
      context(
        repo,
        gitDir,
        join(root, "checkouts"),
        async (argv, _cwd, log) => {
          ran.push(argv.join(" "));
          await writeFile(log, "ok\n");
          return 0;
        }
      )
    );
    expect(outcome.kind).toBe("passed");
    expect(ran).toEqual(VERIFY_GATES.map((argv) => argv.join(" ")));
    const status = await readReceiptStatus(gitDir, tree);
    expect(status.valid).toBe(true);
    if (status.valid) {
      expect(status.receipt.commit).toBe(commit);
      expect(status.receipt.mergeBase).toBe(commit);
    }
    // The disposable checkout is removed after a pass.
    expect(await readdir(join(root, "checkouts"))).toEqual([]);
  });

  test("a failing gate stops the run, writes no receipt and keeps logs", async () => {
    const { root, repo, gitDir } = await fixtureRepo();
    const commit = await runTestGit(repo, "rev-parse", "HEAD");
    const tree = await runTestGit(repo, "rev-parse", "HEAD^{tree}");
    const ran: string[] = [];
    const outcome = await verifyTarget(
      { ref: "HEAD", commit, tree },
      context(
        repo,
        gitDir,
        join(root, "checkouts"),
        async (argv, _cwd, log) => {
          ran.push(argv.join(" "));
          await writeFile(log, "boom\n");
          return 1;
        }
      )
    );
    expect(outcome.kind).toBe("failed");
    expect(ran).toHaveLength(1);
    expect((await readReceiptStatus(gitDir, tree)).valid).toBe(false);
    if (outcome.kind === "failed") {
      const logs = await readdir(outcome.logDir);
      expect(logs).toHaveLength(1);
      expect(
        await readFile(join(outcome.logDir, logs[0] as string), "utf8")
      ).toBe("boom\n");
      // A failed checkout is kept for debugging.
      expect(outcome.checkout).not.toBeNull();
    }
  });
});

describe("parseOptions", () => {
  test("defaults to HEAD", () => {
    expect(parseOptions([]).refs).toEqual(["HEAD"]);
  });

  test("reads refs and flags", () => {
    const options = parseOptions(["--jobs", "3", "--force", "a", "b"]);
    expect(options).toMatchObject({ refs: ["a", "b"], jobs: 3, force: true });
  });

  test("rejects a bad job count and unknown flags", () => {
    expect(() => parseOptions(["--jobs", "0"])).toThrow("positive integer");
    expect(() => parseOptions(["--nope"])).toThrow("unknown option");
  });
});
