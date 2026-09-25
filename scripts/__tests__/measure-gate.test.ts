import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import {
  classifyResourceAccounting,
  collectAttributabilityIssues,
  parseResourceUsage,
} from "../measure-gate";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

const repoRoot = join(import.meta.dir, "..", "..");

/**
 * The measurement harness exists to make performance claims attributable, so
 * its own failure modes matter: a report that silently invents a counter, or
 * one that calls a sample valid after the interpreter moved underneath it,
 * would launder noise into evidence.
 */
const BSD_TIME_REPORT = `        1.23 real         4.56 user         7.89 sys
          1707704320  maximum resident set size
                   0  average shared memory size
                1002  page reclaims
                   0  swaps
               16735  voluntary context switches
             4472446  involuntary context switches
            48407725  instructions retired
            18119090  cycles elapsed
             3310096  peak memory footprint
`;

describe("parseResourceUsage", () => {
  test("reads the summary line and the labelled counters", () => {
    const usage = parseResourceUsage(BSD_TIME_REPORT);

    expect(usage.realSeconds).toBe(1.23);
    expect(usage.userSeconds).toBe(4.56);
    expect(usage.systemSeconds).toBe(7.89);
    expect(usage.maxRssBytes).toBe(1707704320);
    expect(usage.peakMemoryFootprintBytes).toBe(3310096);
    expect(usage.voluntaryContextSwitches).toBe(16735);
    expect(usage.involuntaryContextSwitches).toBe(4472446);
  });

  test("reports an absent counter as absent rather than zero", () => {
    const usage = parseResourceUsage(
      "        0.10 real         0.00 user         0.00 sys\n"
    );

    // A platform that does not publish a counter must not be recorded as
    // having measured zero for it.
    expect(usage.realSeconds).toBe(0.1);
    expect(usage.maxRssBytes).toBeUndefined();
    expect(usage.cyclesElapsed).toBeUndefined();
  });

  test("returns nothing at all for unparseable output", () => {
    expect(parseResourceUsage("")).toEqual({});
    expect(parseResourceUsage("time: command not found\n")).toEqual({});
  });
});

describe("measure-gate report", () => {
  test("records the revision, toolchain and exit code of the measured command", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");

    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(repoRoot, "scripts", "measure-gate.ts"),
        "--label",
        "harness-selftest",
        "--out",
        outDir,
        "--note",
        "self test",
        "--",
        "true",
      ],
      cwd: repoRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await child.exited).toBe(0);

    const written = await readdir(outDir);
    const reportName = written.find((name) => name.endsWith(".json"));
    expect(reportName).toBeDefined();
    const report = JSON.parse(
      await readFile(join(outDir, reportName as string), "utf8")
    );

    expect(report.label).toBe("harness-selftest");
    expect(report.exitCode).toBe(0);
    expect(report.command).toEqual(["true"]);
    expect(report).not.toHaveProperty("thermalCondition");
    expect(report.commandSucceeded).toBe(true);
    expect(report.schemaVersion).toBe(4);
    expect(report.revision.head).toMatch(/^[0-9a-f]{40}$/u);
    expect(report.revision.lockfileSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.toolchainBefore.resolvedBunVersion).toBe(Bun.version);
    // Both sides of the timed region are sampled so an interpreter swap is
    // detected rather than averaged into the result.
    expect(report.toolchainAfter.resolvedBunVersion).toBe(Bun.version);
    expect(report.revisionAfter).not.toBeNull();
    // Parallel runs sharing a label must not share output paths.
    expect(reportName).toMatch(/-[0-9a-f]{8}\.json$/u);
    expect(report.hostBefore.cpuCount).toBeGreaterThan(0);
    expect(Array.isArray(report.hostBefore.loadAverage)).toBe(true);
    expect(typeof report.wallMs).toBe("number");
  });

  test("marks a sample invalid when the tree cannot back the revision it claims", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");
    const dirtyRepo = await createTestFixtureRoot("skillset-measure-dirty-");
    for (const args of [
      ["init", "--quiet"],
      ["commit", "--allow-empty", "-m", "base", "--quiet"],
    ]) {
      const git = Bun.spawn({
        cmd: ["git", ...args],
        cwd: dirtyRepo,
        env: {
          ...gitSafeEnv(),
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_AUTHOR_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
        },
        stderr: "ignore",
        stdout: "ignore",
      });
      expect(await git.exited).toBe(0);
    }
    // The harness resolves the measured checkout's own pin, so the fixture
    // needs one; the dirty working tree is what this test is about.
    await Bun.write(join(dirtyRepo, ".bun-version"), `${Bun.version}\n`);
    await Bun.write(join(dirtyRepo, "untracked.txt"), "dirt\n");

    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(repoRoot, "scripts", "measure-gate.ts"),
        "--label",
        "dirty-tree",
        "--repo",
        dirtyRepo,
        "--out",
        outDir,
        "--",
        "true",
      ],
      cwd: repoRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await child.exited).toBe(0);

    const written = await readdir(outDir);
    const report = JSON.parse(
      await readFile(
        join(outDir, written.find((n) => n.endsWith(".json")) as string),
        "utf8"
      )
    );

    expect(report.attributable).toBe(false);
    expect(report.attributabilityIssues.join(" ")).toContain("dirty");
    expect(report.revision.dirtyEntries).toContain("?? untracked.txt");
  });

  test("refuses to start when HEAD cannot be resolved", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");
    const unbornRepo = await createTestFixtureRoot("skillset-measure-unborn-");
    const init = Bun.spawn({
      cmd: ["git", "init", "--quiet"],
      cwd: unbornRepo,
      env: gitSafeEnv(),
      stderr: "ignore",
      stdout: "ignore",
    });
    expect(await init.exited).toBe(0);

    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(repoRoot, "scripts", "measure-gate.ts"),
        "--label",
        "unborn-head",
        "--repo",
        unbornRepo,
        "--out",
        outDir,
        "--",
        "true",
      ],
      cwd: repoRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await child.exited).toBe(2);
    expect((await readdir(outDir)).some((name) => name.endsWith(".json"))).toBe(
      false
    );
  });

  test("refuses to start when git status cannot inspect the tree", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");
    const lockedRepo = await createTestFixtureRoot("skillset-measure-locked-");
    for (const args of [
      ["init", "--quiet"],
      ["commit", "--allow-empty", "-m", "base", "--quiet"],
    ]) {
      const git = Bun.spawn({
        cmd: ["git", ...args],
        cwd: lockedRepo,
        env: {
          ...gitSafeEnv(),
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_AUTHOR_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
        },
        stderr: "ignore",
        stdout: "ignore",
      });
      expect(await git.exited).toBe(0);
    }
    // Identity commands still succeed; status cannot read the index. An
    // empty `.git/index.lock` is not enough on current Git, which treats a
    // stale lock as ignorable, and a mode-000 index is still readable as root.
    // A corrupt index fails the same way for every user.
    await writeFile(join(lockedRepo, ".git", "index"), "not an index\n");

    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(repoRoot, "scripts", "measure-gate.ts"),
        "--label",
        "index-lock",
        "--repo",
        lockedRepo,
        "--out",
        outDir,
        "--",
        "true",
      ],
      cwd: repoRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await child.exited).toBe(2);
    expect((await readdir(outDir)).some((name) => name.endsWith(".json"))).toBe(
      false
    );
  });

  test("keeps the report when the measured command removes the pin", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");
    const pinnedRepo = await createPinnedRepo("skillset-measure-unpinned-");

    const child = runMeasureGate(pinnedRepo, outDir, [
      "sh",
      "-c",
      "rm .bun-version",
    ]);
    expect(await child.exited).toBe(0);

    const report = await readOnlyReport(outDir);
    expect(report.commandSucceeded).toBe(true);
    expect(report.toolchainAfter).toBeNull();
    expect(report.attributable).toBe(false);
    expect(report.attributabilityIssues.join(" ")).toContain(
      "toolchain after the run could not be read"
    );
  });

  test("records the digest of each declared output", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");
    const pinnedRepo = await createPinnedRepo("skillset-measure-output-");
    const output = join(pinnedRepo, "junit.xml");

    const child = runMeasureGate(
      pinnedRepo,
      outDir,
      ["sh", "-c", "printf measured > junit.xml"],
      ["--output", output]
    );
    expect(await child.exited).toBe(0);

    const report = await readOnlyReport(outDir);
    expect(report.schemaVersion).toBe(4);
    expect(report.outputs).toEqual([
      {
        path: output,
        sha256: createHash("sha256").update("measured").digest("hex"),
      },
    ]);
  });

  test("resolves a relative output against the measured checkout", async () => {
    const outDir = await createTestFixtureRoot("skillset-measure-gate-");
    const pinnedRepo = await createPinnedRepo("skillset-measure-relative-");

    // The harness runs from this repository; the command runs in --repo.
    const child = runMeasureGate(
      pinnedRepo,
      outDir,
      ["sh", "-c", "mkdir out && printf measured > out/junit.xml"],
      ["--output", "out/junit.xml"]
    );
    expect(await child.exited).toBe(0);

    const report = await readOnlyReport(outDir);
    expect(report.outputs).toEqual([
      {
        path: join(pinnedRepo, "out", "junit.xml"),
        sha256: createHash("sha256").update("measured").digest("hex"),
      },
    ]);
  });
});

async function createPinnedRepo(prefix: string): Promise<string> {
  const repo = await createTestFixtureRoot(prefix);
  await Bun.write(join(repo, ".bun-version"), `${Bun.version}\n`);
  for (const args of [
    ["init", "--quiet"],
    ["add", ".bun-version"],
    ["commit", "-m", "base", "--quiet"],
  ]) {
    const git = Bun.spawn({
      cmd: ["git", ...args],
      cwd: repo,
      env: {
        ...gitSafeEnv(),
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_AUTHOR_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
      },
      stderr: "ignore",
      stdout: "ignore",
    });
    expect(await git.exited).toBe(0);
  }
  return repo;
}

function runMeasureGate(
  repo: string,
  outDir: string,
  command: readonly string[],
  flags: readonly string[] = []
): Bun.Subprocess {
  return Bun.spawn({
    cmd: [
      process.execPath,
      join(repoRoot, "scripts", "measure-gate.ts"),
      "--label",
      "fixture",
      "--repo",
      repo,
      "--out",
      outDir,
      ...flags,
      "--",
      ...command,
    ],
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
}

async function readOnlyReport(outDir: string) {
  const reports = (await readdir(outDir)).filter((name) =>
    name.endsWith(".json")
  );
  expect(reports).toHaveLength(1);
  return JSON.parse(await readFile(join(outDir, reports[0] ?? ""), "utf8"));
}

const TOOLCHAIN = {
  ambientBunPath: "/Users/x/.bun/bin/bun",
  ambientBunVersion: "1.4.0",
  pinnedVersion: "1.4.0",
  resolvedBunPath: "/Users/x/.cache/skillset/bun/darwin-arm64/1.4.0/bin/bun",
  resolvedBunSource: "cached",
  resolvedBunVersion: "1.4.0",
} as const;

const CLEAN_REVISION = {
  branch: "main",
  dirty: false,
  dirtyEntries: [],
  head: "8b1c1c147416fb7d22394696f917255aae9dbd20",
  headTree: "a9844b9718a6f2a77a6315a0d728769b71e7065f",
  lockfileSha256: "0".repeat(64),
  repoRoot: "/repo",
} as const;

describe("collectAttributabilityIssues", () => {
  test("accepts a clean tree with a steady toolchain", () => {
    expect(
      collectAttributabilityIssues(
        CLEAN_REVISION,
        TOOLCHAIN,
        TOOLCHAIN,
        CLEAN_REVISION
      )
    ).toEqual([]);
  });

  test("rejects a sample whose ambient interpreter changed underneath it", () => {
    // The exact event that invalidated test-warm-2: another repository's
    // bootstrap replaced ~/.bun/bin/bun mid-run. Since the resolved
    // interpreter became an immutable cache copy, the ambient comparison is
    // the only thing that can still catch this.
    const after = { ...TOOLCHAIN, ambientBunVersion: "1.4.2" };

    const issues = collectAttributabilityIssues(
      CLEAN_REVISION,
      TOOLCHAIN,
      after,
      CLEAN_REVISION
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("ambient interpreter version changed");
    expect(issues[0]).toContain("1.4.0 -> 1.4.2");
  });

  test("rejects a sample whose ambient interpreter moved path", () => {
    const after = { ...TOOLCHAIN, ambientBunPath: "/opt/homebrew/bin/bun" };

    expect(
      collectAttributabilityIssues(
      CLEAN_REVISION,
      TOOLCHAIN,
      after,
      CLEAN_REVISION
    ).join(" ")
    ).toContain("ambient interpreter path changed");
  });

  test("rejects a resolved interpreter that does not match the pin", () => {
    const off = { ...TOOLCHAIN, resolvedBunVersion: "1.3.10" };

    expect(collectAttributabilityIssues(CLEAN_REVISION, off, off, CLEAN_REVISION).join(
      " "
    )).toContain(
      "does not match the pin"
    );
  });

  test("rejects a dirty tree, which cannot back the revision it names", () => {
    const dirty = {
      ...CLEAN_REVISION,
      dirty: true,
      dirtyEntries: ["?? stray.txt"],
    };

    expect(
      collectAttributabilityIssues(dirty, TOOLCHAIN, TOOLCHAIN, dirty).join(" ")
    ).toContain("dirty");
  });
});

describe("collectAttributabilityIssues, post-run repository state", () => {
  test("rejects a sample whose command moved HEAD", () => {
    const after = { ...CLEAN_REVISION, head: "b".repeat(40) };

    const issues = collectAttributabilityIssues(
      CLEAN_REVISION,
      TOOLCHAIN,
      TOOLCHAIN,
      after
    );

    expect(issues.join(" ")).toContain("moved HEAD");
  });

  test("rejects a sample whose command rewrote bun.lock", () => {
    // An install measured against the lockfile it then rewrote cannot claim
    // the toolchain inputs its report records.
    const after = { ...CLEAN_REVISION, lockfileSha256: "1".repeat(64) };

    const issues = collectAttributabilityIssues(
      CLEAN_REVISION,
      TOOLCHAIN,
      TOOLCHAIN,
      after
    );

    expect(issues.join(" ")).toContain("changed bun.lock");
  });

  test("rejects a sample whose command dirtied the working tree", () => {
    const after = {
      ...CLEAN_REVISION,
      dirty: true,
      dirtyEntries: ["?? generated.txt"],
    };

    const issues = collectAttributabilityIssues(
      CLEAN_REVISION,
      TOOLCHAIN,
      TOOLCHAIN,
      after
    );

    expect(issues.join(" ")).toContain("changed the working tree");
  });

  test("rejects a tree whose entries changed without changing in number", () => {
    // The count is a weaker signal than it looks: swapping one untracked file
    // for another leaves it identical while the tree has moved.
    const before = {
      ...CLEAN_REVISION,
      dirty: true,
      dirtyEntries: ["?? one.txt"],
    };
    const after = {
      ...CLEAN_REVISION,
      dirty: true,
      dirtyEntries: ["?? two.txt"],
    };

    const issues = collectAttributabilityIssues(
      before,
      TOOLCHAIN,
      TOOLCHAIN,
      after
    );

    expect(issues.join(" ")).toContain("changed the working tree");
  });

  test("rejects a sample whose post-run state could not be read", () => {
    const issues = collectAttributabilityIssues(
      CLEAN_REVISION,
      TOOLCHAIN,
      TOOLCHAIN,
      undefined
    );

    expect(issues.join(" ")).toContain("could not be read");
  });

  test("accepts a run that left the repository as it found it", () => {
    expect(
      collectAttributabilityIssues(
        CLEAN_REVISION,
        TOOLCHAIN,
        TOOLCHAIN,
        CLEAN_REVISION
      )
    ).toEqual([]);
  });
});

describe("classifyResourceAccounting", () => {
  test("marks the aggregate gate's impossible totals as suspect", () => {
    // Observed: `bun run check` ran 282.6 s and the wrapper reported 0.21 s
    // user and 2.55 s system, because nested `bun run` wrappers lose
    // descendant accounting. Such totals must never be quoted as measured.
    expect(
      classifyResourceAccounting(
        false,
        { systemSeconds: 2.55, userSeconds: 0.21 },
        282_611
      )
    ).toBe("suspect");
  });

  test("accepts totals that are plausible for the elapsed time", () => {
    expect(
      classifyResourceAccounting(
        false,
        { systemSeconds: 201.87, userSeconds: 271.54 },
        309_126
      )
    ).toBe("complete");
  });

  test("reports unavailable when no wrapper ran", () => {
    expect(classifyResourceAccounting(true, {}, 309_126)).toBe("unavailable");
  });

  test("reports unavailable when the wrapper produced no CPU totals", () => {
    expect(classifyResourceAccounting(false, {}, 309_126)).toBe("unavailable");
  });

  test("does not judge short runs, where start-up dominates the ratio", () => {
    expect(
      classifyResourceAccounting(false, { systemSeconds: 0, userSeconds: 0 }, 300)
    ).toBe("complete");
  });
});
