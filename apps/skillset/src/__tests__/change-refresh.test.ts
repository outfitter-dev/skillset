import { mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { refreshChangeEvidence } from "../change-workflow";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";

const DEAD_OWNER_TOKEN = "d".repeat(32);
const LIVE_OWNER_TOKEN = "1".repeat(32);
const SUCCESSOR_OWNER_TOKEN = "2".repeat(32);
const VALID_OWNER_TOKEN = "a".repeat(32);

test("SET-329 refresh previews, replans, and idempotently applies stacked stale evidence", async () => {
  const root = await refreshFixture();
  const skillPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(skillPath, skill("First changed body."), "utf8");

  for (const label of ["first", "second"]) {
    const added = await runCli(
      "change", "add", "--root", root, "--since", "HEAD", "--scope", "skill:demo", "--bump", "patch",
      "--reason", `Record the ${label} stacked reason with enough detail to remain independently auditable.`
    );
    expect(added.exitCode).toBe(0);
  }
  await writeFile(skillPath, skill("Second changed body."), "utf8");
  const ledgerPath = join(root, ".skillset/changes/ledger.jsonl");
  const ledgerBefore = await readFile(ledgerPath, "utf8");
  const sourceBefore = await readFile(skillPath, "utf8");

  await runCli("check", "--ci", "--fix", "--since", "HEAD", "--root", root);
  expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBefore);
  expect(await readFile(skillPath, "utf8")).toBe(sourceBefore);

  const preview = await runCli("change", "refresh", "--root", root, "--json");
  expect(preview.exitCode).toBe(0);
  const previewData = jsonRefresh(preview.stdout);
  expect(previewData.state).toBe("planned");
  expect(previewData.writes).toEqual([]);
  expect(previewData.report.entries).toHaveLength(2);
  expect(previewData.report.entries.map((entry) => entry.path)).toEqual(
    previewData.report.entries.map((entry) => entry.path).toSorted()
  );
  expect(previewData.report.entries.every((entry) => entry.scopes[0]?.priorHashes.length === 1)).toBe(true);
  expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBefore);

  await writeFile(skillPath, skill("Apply-time changed body."), "utf8");
  const applied = await runCli("change", "refresh", "--root", root, "--yes", "--json");
  expect(applied.exitCode).toBe(0);
  const appliedData = jsonRefresh(applied.stdout);
  expect(appliedData.state).toBe("written");
  expect(appliedData.writes).toEqual([".skillset/changes/ledger.jsonl"]);
  expect(appliedData.report.entries).toHaveLength(2);
  expect(appliedData.report.entries[0]?.scopes[0]?.currentHash).not.toBe(
    previewData.report.entries[0]?.scopes[0]?.currentHash
  );

  const ledgerAfter = await readFile(ledgerPath, "utf8");
  const repeated = jsonRefresh((await runCli("change", "refresh", "--root", root, "--yes", "--json")).stdout);
  expect(repeated.report.entries).toEqual([]);
  expect(repeated.writes).toEqual([]);
  expect(await readFile(ledgerPath, "utf8")).toBe(ledgerAfter);
  expect((ledgerAfter.match(/"type":"change.covered"/g) ?? []).length).toBe(4);
  const checked = await runCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
});

test("SET-329 refresh handles missing evidence and an optional targeted ref", async () => {
  const root = await refreshFixture();
  const skillPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(skillPath, skill("Changed body."), "utf8");
  for (const id of ["111111abcdef", "222222abcdef"]) {
    await writeReason(root, id, "This pending reason has enough detail to validate while its ledger evidence is missing.");
  }

  const targeted = await runCli("change", "refresh", "@111111", "--root", root, "--yes", "--json");
  expect(targeted.exitCode).toBe(0);
  const data = jsonRefresh(targeted.stdout);
  expect(data.report.entries).toHaveLength(1);
  expect(data.report.entries[0]?.ref).toBe("@111111abcdef");
  expect(data.report.entries[0]?.scopes[0]?.priorHashes).toEqual([]);
  expect(data.writes).toEqual([".skillset/changes/ledger.jsonl"]);

  const remaining = await runCli("change", "check", "@222222", "--root", root, "--since", "HEAD");
  expect(remaining.exitCode).toBe(1);
  expect(remaining.stdout).toContain("change-evidence-missing");
  expect((await runCli("change", "refresh", "--root", root, "--yes")).exitCode).toBe(0);
  expect((await runCli("change", "check", "--root", root, "--since", "HEAD")).exitCode).toBe(0);
});

test("SET-329 refresh preserves the explicit check baseline for a removed scope", async () => {
  const root = await refreshFixture();
  await runGit(root, "branch", "-M", "main");
  const baselineA = await runGitOutput(root, "rev-parse", "HEAD");
  const oldPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(oldPath, skill("Version B body on main."), "utf8");
  await runGit(root, "add", ".skillset/skills/demo/SKILL.md");
  await runGit(root, "commit", "-qm", "advance removed-scope baseline");
  await runGit(root, "switch", "-qc", "feature/rename-demo");

  const renamedPath = join(root, ".skillset/skills/renamed/SKILL.md");
  await mkdir(join(root, ".skillset/skills/renamed"), { recursive: true });
  await rename(oldPath, renamedPath);
  await writeFile(
    renamedPath,
    "---\nname: renamed\ndescription: Renamed demo.\n---\n\nRenamed feature body.\n",
    "utf8"
  );
  await writeReason(root, "abcdef123456", "Record removal of the old demo skill scope during the rename against the selected comparison baseline.");

  const missing = await runCli("change", "check", "@abcdef", "--root", root, "--since", baselineA);
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout).toContain("change-evidence-missing");

  const defaultRefresh = jsonRefresh(
    (await runCli("change", "refresh", "@abcdef", "--root", root, "--yes", "--json")).stdout
  );
  const defaultHash = defaultRefresh.report.entries[0]?.scopes[0]?.currentHash;
  expect(defaultHash).toBeDefined();
  const stillStale = await runCli("change", "check", "@abcdef", "--root", root, "--since", baselineA);
  expect(stillStale.exitCode).toBe(1);
  expect(stillStale.stdout).toContain("change-evidence-stale");

  const matchedRefresh = jsonRefresh(
    (await runCli("change", "refresh", "@abcdef", "--root", root, "--since", baselineA, "--yes", "--json")).stdout
  );
  expect(matchedRefresh.report.entries[0]?.scopes[0]?.currentHash).not.toBe(defaultHash);
  expect((await runCli("change", "check", "@abcdef", "--root", root, "--since", baselineA)).exitCode).toBe(0);
  expect(await ledgerLockArtifacts(root)).toEqual([]);
});

test("SET-329 refresh refuses invalid or uncovered entries and replans from current facts", async () => {
  const root = await refreshFixture();
  const skillPath = join(root, ".skillset/skills/demo/SKILL.md");
  await writeFile(skillPath, skill("First body."), "utf8");
  const uncovered = await runCli("change", "refresh", "--root", root, "--yes");
  expect(uncovered.exitCode).toBe(1);
  expect(uncovered.stderr).toContain("change-uncovered");

  await writeReason(root, "abcdef123456", "TODO");
  const invalid = await runCli("change", "refresh", "--root", root, "--yes");
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("change-reason-placeholder");
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);

  await writeReason(root, "abcdef123456", "This reason is valid and deliberately begins without ledger evidence for the source scope.");
  const preview = await refreshChangeEvidence(root, { since: "HEAD", write: false });
  const applied = await refreshChangeEvidence(root, {
    beforeOwnershipVerification: async () => writeFile(skillPath, skill("Second body."), "utf8"),
    since: "HEAD",
    write: true,
  });
  expect(applied.entries[0]?.scopes[0]?.currentHash).not.toBe(preview.entries[0]?.scopes[0]?.currentHash);
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).toContain(applied.entries[0]?.scopes[0]?.currentHash ?? "missing-current-hash");
  expect(ledger).not.toContain(preview.entries[0]?.scopes[0]?.currentHash ?? "missing-preview-hash");
});

test("SET-329 refresh serializes concurrent public CLI applies without duplicate evidence", async () => {
  const root = await refreshFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Concurrent changed body."), "utf8");
  await writeReason(root, "abcdef123456", "This valid pending reason is applied concurrently to prove ledger evidence remains unique.");

  const results = await Promise.all(
    Array.from({ length: 12 }, () => runCli("change", "refresh", "--root", root, "--yes", "--json"))
  );
  expect(results.every((result) => result.exitCode === 0)).toBe(true);
  const reports = results.map((result) => jsonRefresh(result.stdout));
  expect(reports.filter((report) => report.writes.length === 1)).toHaveLength(1);
  expect(reports.filter((report) => report.writes.length === 0)).toHaveLength(11);
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect((ledger.match(/"type":"change.covered"/g) ?? [])).toHaveLength(1);
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl.lock")).exists()).toBe(false);
  expect((await readdir(join(root, ".skillset/changes"))).filter((path) => path.includes("ledger.jsonl.lock"))).toEqual([]);
  expect((await runCli("change", "check", "--root", root, "--since", "HEAD")).exitCode).toBe(0);
});

test("SET-329 refresh refuses frontmatter compatibility entries without a ledger write", async () => {
  const root = await refreshFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Frontmatter changed body."), "utf8");
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/legacy.md"),
    "---\nid: abcdef123456\nbump: patch\nscope: skill:demo\n---\n\nThis legacy entry is otherwise valid but must migrate before refreshing evidence.\n",
    "utf8"
  );
  const result = await runCli("change", "refresh", "--root", root, "--yes");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("change-frontmatter-compatibility");
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);
});

test("SET-329 refresh reclaims a dead stale owner and removes its lock artifacts", async () => {
  const root = await refreshFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Dead-owner changed body."), "utf8");
  await writeReason(root, "abcdef123456", "This pending reason proves a dead stale owner can be fenced before evidence is applied.");
  await seedLedgerLock(root, { createdAt: 0, heartbeatAt: 0, pid: 999_999, token: DEAD_OWNER_TOKEN });

  const result = await refreshChangeEvidence(root, {
    lock: { heartbeatMs: 1000, isProcessAlive: () => false, leaseMs: 10, now: () => 1000, pollMs: 1, timeoutMs: 50 },
    since: "HEAD",
    write: true,
  });
  expect(result.written).toBe(true);
  expect(await ledgerLockArtifacts(root)).toEqual([]);
});

test("SET-329 malformed semantic owners are reclaimed without process liveness probes", async () => {
  const invalidOwners = [
    `${JSON.stringify({ createdAt: 0, pid: 0, token: VALID_OWNER_TOKEN })}\n`,
    `${JSON.stringify({ createdAt: 0, pid: 1234, token: "../owner" })}\n`,
    `{"createdAt":1e309,"pid":1234,"token":"${VALID_OWNER_TOKEN}"}\n`,
  ];
  for (const ownerContent of invalidOwners) {
    const root = await refreshFixture();
    await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Invalid-owner changed body."), "utf8");
    await writeReason(root, "abcdef123456", "This pending reason proves invalid semantic lock ownership never reaches process liveness checks.");
    await seedMalformedLedgerLock(root, ownerContent);
    let livenessProbes = 0;

    const result = await refreshChangeEvidence(root, {
      lock: {
        heartbeatMs: 1000,
        isProcessAlive: () => {
          livenessProbes += 1;
          return true;
        },
        leaseMs: 10,
        pollMs: 1,
        timeoutMs: 50,
      },
      since: "HEAD",
      write: true,
    });
    expect(result.written).toBe(true);
    expect(livenessProbes).toBe(0);
    expect(await ledgerLockArtifacts(root)).toEqual([]);
  }
});

test("SET-329 invalid owner and heartbeat timestamp domains recover from bounded current facts", async () => {
  const now = Date.now();
  const staleOwner = `${JSON.stringify({ createdAt: now - 1000, pid: 999_999, token: VALID_OWNER_TOKEN })}\n`;
  const timestampCases = [
    { heartbeatContent: `{"heartbeatAt":1e309,"token":"${VALID_OWNER_TOKEN}"}\n`, ownerContent: staleOwner, probes: 1 },
    {
      heartbeatContent: `${JSON.stringify({ heartbeatAt: now + 11, token: VALID_OWNER_TOKEN })}\n`,
      ownerContent: staleOwner,
      probes: 1,
    },
    {
      heartbeatContent: `${JSON.stringify({ heartbeatAt: now - 1000, token: VALID_OWNER_TOKEN })}\n`,
      ownerContent: `${JSON.stringify({ createdAt: now + 11, pid: 999_999, token: VALID_OWNER_TOKEN })}\n`,
      probes: 0,
    },
  ];
  for (const timestampCase of timestampCases) {
    const root = await refreshFixture();
    await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Timestamp-domain changed body."), "utf8");
    await writeReason(root, "abcdef123456", "This pending reason proves future and nonfinite lock timestamps cannot indefinitely suppress recovery.");
    await seedRawLedgerLock(root, timestampCase.ownerContent, timestampCase.heartbeatContent);
    let livenessProbes = 0;

    const result = await refreshChangeEvidence(root, {
      lock: {
        heartbeatMs: 1000,
        isProcessAlive: () => {
          livenessProbes += 1;
          return false;
        },
        leaseMs: 10,
        now: () => now,
        pollMs: 1,
        timeoutMs: 50,
      },
      since: "HEAD",
      write: true,
    });
    expect(result.written).toBe(true);
    expect(livenessProbes).toBe(timestampCase.probes);
    expect(await ledgerLockArtifacts(root)).toEqual([]);
  }
});

test("SET-329 public refresh reclaims missing and malformed aged owners without heartbeat residue", async () => {
  const malformedOwners = [
    undefined,
    "not-json\n",
    `${JSON.stringify({ createdAt: 0, pid: 0, token: VALID_OWNER_TOKEN })}\n`,
    `${JSON.stringify({ createdAt: 0, pid: 1234, token: "../owner" })}\n`,
    `{"createdAt":1e309,"pid":1234,"token":"${VALID_OWNER_TOKEN}"}\n`,
  ];
  for (const ownerContent of malformedOwners) {
    const root = await refreshFixture();
    await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Malformed-owner changed body."), "utf8");
    await writeReason(root, "abcdef123456", "This pending reason proves malformed lock ownership can be recovered without residue.");
    await seedMalformedLedgerLock(root, ownerContent);

    const result = await runCli("change", "refresh", "--root", root, "--yes", "--json");
    expect(result.exitCode).toBe(0);
    expect(jsonRefresh(result.stdout).writes).toEqual([".skillset/changes/ledger.jsonl"]);
    expect(await ledgerLockArtifacts(root)).toEqual([]);
  }
});

test("SET-329 public refresh rejects nonfinite and over-skew lock timestamps without residue", async () => {
  const now = Date.now();
  const staleOwner = `${JSON.stringify({ createdAt: now - 120_000, pid: 999_999, token: VALID_OWNER_TOKEN })}\n`;
  const timestampCases = [
    {
      heartbeatContent: `{"heartbeatAt":1e309,"token":"${VALID_OWNER_TOKEN}"}\n`,
      ownerContent: staleOwner,
    },
    {
      heartbeatContent: `${JSON.stringify({ heartbeatAt: now + 120_000, token: VALID_OWNER_TOKEN })}\n`,
      ownerContent: staleOwner,
    },
    {
      heartbeatContent: `${JSON.stringify({ heartbeatAt: now - 120_000, token: VALID_OWNER_TOKEN })}\n`,
      ownerContent: `${JSON.stringify({ createdAt: now + 120_000, pid: 999_999, token: VALID_OWNER_TOKEN })}\n`,
    },
  ];
  for (const timestampCase of timestampCases) {
    const root = await refreshFixture();
    await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Public timestamp-domain changed body."), "utf8");
    await writeReason(root, "abcdef123456", "This pending reason proves the public CLI recovers from invalid owner and heartbeat timestamp domains.");
    await seedRawLedgerLock(root, timestampCase.ownerContent, timestampCase.heartbeatContent);

    const result = await runCli("change", "refresh", "--root", root, "--yes", "--json");
    expect(result.exitCode).toBe(0);
    expect(jsonRefresh(result.stdout).writes).toEqual([".skillset/changes/ledger.jsonl"]);
    expect(await ledgerLockArtifacts(root)).toEqual([]);
  }
});

test("SET-329 refresh times out without reclaiming a live over-lease owner", async () => {
  const root = await refreshFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Live-owner changed body."), "utf8");
  await writeReason(root, "abcdef123456", "This pending reason proves process liveness vetoes age-only lock reclamation.");
  await seedLedgerLock(root, { createdAt: 0, heartbeatAt: 0, pid: 1234, token: LIVE_OWNER_TOKEN });

  await expect(refreshChangeEvidence(root, {
    lock: { isProcessAlive: (pid) => pid === 1234, leaseMs: 10, now: () => 1000, pollMs: 1, timeoutMs: 10 },
    since: "HEAD",
    write: true,
  })).rejects.toThrow("timed out waiting for change ledger lock");
  expect(JSON.parse(await readFile(join(root, ".skillset/changes/ledger.jsonl.lock/owner.json"), "utf8"))).toMatchObject({ token: LIVE_OWNER_TOKEN });
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);
});

test("SET-329 refresh heartbeats keep a live holder beyond its lease", async () => {
  const root = await refreshFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Heartbeat changed body."), "utf8");
  await writeReason(root, "abcdef123456", "This pending reason proves heartbeat freshness protects a live holder past the lease.");
  const entered = deferred<void>();
  const release = deferred<void>();
  let heartbeatTick: (() => Promise<void>) | undefined;
  let now = 0;
  const lock = {
    heartbeatMs: 1,
    isProcessAlive: () => false,
    leaseMs: 5,
    now: () => now,
    pollMs: 1,
    startHeartbeat: (heartbeat: () => Promise<void>) => {
      heartbeatTick = heartbeat;
      return () => {};
    },
    timeoutMs: 12,
  } as const;
  const holder = refreshChangeEvidence(root, {
    beforeFinalComparison: async () => {
      entered.resolve();
      await release.promise;
    },
    lock,
    since: "HEAD",
    write: true,
  });
  await entered.promise;
  now = lock.leaseMs + 1;
  if (heartbeatTick === undefined) throw new Error("missing change ledger heartbeat tick");
  await heartbeatTick();
  expect(await ledgerHeartbeatAt(root)).toBe(now);
  await expect(refreshChangeEvidence(root, { lock, since: "HEAD", write: true })).rejects.toThrow(
    "timed out waiting for change ledger lock"
  );
  release.resolve();
  expect((await holder).written).toBe(true);
  expect(await ledgerLockArtifacts(root)).toEqual([]);
});

test("SET-329 a fenced owner cannot append or remove its successor lock", async () => {
  const root = await refreshFixture();
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Fenced-owner changed body."), "utf8");
  await writeReason(root, "abcdef123456", "This pending reason proves a fenced former owner cannot append evidence or delete its successor.");
  const lockPath = join(root, ".skillset/changes/ledger.jsonl.lock");
  const oldTombstone = `${lockPath}.externally-fenced`;
  await expect(refreshChangeEvidence(root, {
    beforeOwnershipVerification: async () => {
      await rename(lockPath, oldTombstone);
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({ createdAt: Date.now(), pid: process.pid, token: SUCCESSOR_OWNER_TOKEN })}\n`,
        "utf8"
      );
    },
    lock: { heartbeatMs: 1000 },
    since: "HEAD",
    write: true,
  })).rejects.toThrow("lost ownership of change ledger lock");
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);
  expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))).toMatchObject({ token: SUCCESSOR_OWNER_TOKEN });
  expect(await ledgerLockArtifacts(root)).toContain("ledger.jsonl.lock.externally-fenced");
  await rm(lockPath, { force: true, recursive: true });
  await rm(oldTombstone, { force: true, recursive: true });
  for (const artifact of await ledgerLockArtifacts(root)) await rm(join(root, ".skillset/changes", artifact), { force: true });
  expect(await ledgerLockArtifacts(root)).toEqual([]);
});

interface RefreshJsonData {
  readonly report: {
    readonly entries: readonly {
      readonly path: string;
      readonly ref: string;
      readonly scopes: readonly { readonly currentHash: string; readonly priorHashes: readonly string[] }[];
    }[];
  };
  readonly state: string;
  readonly writes: readonly string[];
}

function jsonRefresh(stdout: string): RefreshJsonData {
  return (JSON.parse(stdout) as { readonly data: RefreshJsonData }).data;
}

async function refreshFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-change-refresh-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: refresh-test\nclaude: true\ncodex: false\n", "utf8");
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Baseline body."), "utf8");
  await initializeTestGitRepository(root, { disposableRoot });
  return root;
}

async function writeReason(root: string, id: string, reason: string): Promise<void> {
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, `.skillset/changes/${id}.md`), `${reason}\n\nBump: patch\nScope: skill:demo\n`, "utf8");
}

async function seedLedgerLock(
  root: string,
  owner: { readonly createdAt: number; readonly heartbeatAt: number; readonly pid: number; readonly token: string }
): Promise<void> {
  const lockPath = join(root, ".skillset/changes/ledger.jsonl.lock");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
  await writeFile(
    join(lockPath, `heartbeat-${owner.token}.json`),
    `${JSON.stringify({ heartbeatAt: owner.heartbeatAt, token: owner.token })}\n`,
    "utf8"
  );
}

async function seedMalformedLedgerLock(root: string, ownerContent: string | undefined): Promise<void> {
  const lockPath = join(root, ".skillset/changes/ledger.jsonl.lock");
  await mkdir(lockPath, { recursive: true });
  if (ownerContent !== undefined) await writeFile(join(lockPath, "owner.json"), ownerContent, "utf8");
  await writeFile(join(lockPath, "heartbeat-unparseable.json"), "stale\n", "utf8");
  const old = new Date(Date.now() - 120_000);
  await utimes(lockPath, old, old);
}

async function seedRawLedgerLock(root: string, ownerContent: string, heartbeatContent: string): Promise<void> {
  const lockPath = join(root, ".skillset/changes/ledger.jsonl.lock");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), ownerContent, "utf8");
  await writeFile(join(lockPath, `heartbeat-${VALID_OWNER_TOKEN}.json`), heartbeatContent, "utf8");
  const old = new Date(Date.now() - 120_000);
  await utimes(lockPath, old, old);
}

async function ledgerHeartbeatAt(root: string): Promise<unknown> {
  const lockPath = join(root, ".skillset/changes/ledger.jsonl.lock");
  const owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { readonly token: string };
  const heartbeat = JSON.parse(
    await readFile(join(lockPath, `heartbeat-${owner.token}.json`), "utf8")
  ) as { readonly heartbeatAt?: unknown };
  return heartbeat.heartbeatAt;
}

async function ledgerLockArtifacts(root: string): Promise<readonly string[]> {
  return (await readdir(join(root, ".skillset/changes"))).filter((path) => path.includes("ledger.jsonl.lock")).toSorted();
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function skill(body: string): string {
  return `---\nname: demo\ndescription: Demo.\n---\n\n${body}\n`;
}

async function runCli(...args: readonly string[]): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  await runTestGit(root, ...args);
}

async function runGitOutput(root: string, ...args: readonly string[]): Promise<string> {
  return runTestGit(root, ...args);
}
