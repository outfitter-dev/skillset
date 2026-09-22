import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyResourceAccounting,
  collectAttributabilityIssues,
  parseResourceUsage,
} from "../measure-gate";

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
    const outDir = await mkdtemp(join(tmpdir(), "skillset-measure-gate-"));

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
    expect(report.thermalCondition).toBe("warm");
    expect(report.commandSucceeded).toBe(true);
    expect(report.schemaVersion).toBe(2);
    expect(report.revision.head).toMatch(/^[0-9a-f]{40}$/u);
    expect(report.revision.lockfileSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.toolchainBefore.resolvedBunVersion).toBe(Bun.version);
    // Both sides of the timed region are sampled so an interpreter swap is
    // detected rather than averaged into the result.
    expect(report.toolchainAfter.resolvedBunVersion).toBe(Bun.version);
    expect(report.hostBefore.cpuCount).toBeGreaterThan(0);
    expect(Array.isArray(report.hostBefore.loadAverage)).toBe(true);
    expect(typeof report.wallMs).toBe("number");
  });

  test("marks a sample invalid when the tree cannot back the revision it claims", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "skillset-measure-gate-"));
    const dirtyRepo = await mkdtemp(join(tmpdir(), "skillset-measure-dirty-"));
    for (const args of [
      ["init", "--quiet"],
      ["commit", "--allow-empty", "-m", "base", "--quiet"],
    ]) {
      const git = Bun.spawn({
        cmd: ["git", ...args],
        cwd: dirtyRepo,
        env: {
          ...process.env,
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
    const outDir = await mkdtemp(join(tmpdir(), "skillset-measure-gate-"));
    const unbornRepo = await mkdtemp(join(tmpdir(), "skillset-measure-unborn-"));
    const init = Bun.spawn({
      cmd: ["git", "init", "--quiet"],
      cwd: unbornRepo,
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
    const outDir = await mkdtemp(join(tmpdir(), "skillset-measure-gate-"));
    const lockedRepo = await mkdtemp(join(tmpdir(), "skillset-measure-locked-"));
    for (const args of [
      ["init", "--quiet"],
      ["commit", "--allow-empty", "-m", "base", "--quiet"],
    ]) {
      const git = Bun.spawn({
        cmd: ["git", ...args],
        cwd: lockedRepo,
        env: {
          ...process.env,
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
    // stale lock as ignorable.
    await chmod(join(lockedRepo, ".git", "index"), 0o000);

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
});

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
      collectAttributabilityIssues(CLEAN_REVISION, TOOLCHAIN, TOOLCHAIN)
    ).toEqual([]);
  });

  test("rejects a sample whose ambient interpreter changed underneath it", () => {
    // The exact event that invalidated test-warm-2: another repository's
    // bootstrap replaced ~/.bun/bin/bun mid-run. Since the resolved
    // interpreter became an immutable cache copy, the ambient comparison is
    // the only thing that can still catch this.
    const after = { ...TOOLCHAIN, ambientBunVersion: "1.4.2" };

    const issues = collectAttributabilityIssues(CLEAN_REVISION, TOOLCHAIN, after);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("ambient interpreter version changed");
    expect(issues[0]).toContain("1.4.0 -> 1.4.2");
  });

  test("rejects a sample whose ambient interpreter moved path", () => {
    const after = { ...TOOLCHAIN, ambientBunPath: "/opt/homebrew/bin/bun" };

    expect(
      collectAttributabilityIssues(CLEAN_REVISION, TOOLCHAIN, after).join(" ")
    ).toContain("ambient interpreter path changed");
  });

  test("rejects a resolved interpreter that does not match the pin", () => {
    const off = { ...TOOLCHAIN, resolvedBunVersion: "1.3.10" };

    expect(collectAttributabilityIssues(CLEAN_REVISION, off, off).join(" ")).toContain(
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
      collectAttributabilityIssues(dirty, TOOLCHAIN, TOOLCHAIN).join(" ")
    ).toContain("dirty");
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
