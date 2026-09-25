import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import { reapOwnedProcess, waitForCondition, waitForPath, waitForPids } from "../test-helpers/wait";

test("waitForCondition resolves once the predicate becomes true", async () => {
  let ready = false;
  const becomeReady = setTimeout(() => {
    ready = true;
  }, 20);

  try {
    await waitForCondition("local readiness flag", () => ready, {
      intervalMs: 5,
      timeoutMs: 1_000,
    });
  } finally {
    clearTimeout(becomeReady);
  }
});

test("waitForCondition names the condition and elapsed bound on timeout", async () => {
  await expect(
    waitForCondition("missing readiness flag", () => false, {
      intervalMs: 5,
      timeoutMs: 20,
    })
  ).rejects.toThrow("timed out after 20ms waiting for missing readiness flag");
});

test("waitForCondition includes the path when one is supplied", async () => {
  const path = "/tmp/skillset-wait-missing-marker";
  await expect(
    waitForCondition("missing worker marker", () => false, {
      intervalMs: 5,
      path,
      timeoutMs: 20,
    })
  ).rejects.toThrow(
    `timed out after 20ms waiting for missing worker marker at ${path}`
  );
});

test("waitForPath observes a created marker and names a missing one", async () => {
  const root = await createTestFixtureRoot("skillset-wait-path-");
  const path = join(root, "ready");
  const create = setTimeout(() => {
    void writeFile(path, "ready\n");
  }, 20);

  try {
    await waitForPath(path, "created test marker", {
      intervalMs: 5,
      timeoutMs: 1_000,
    });
    await expect(
      waitForPath(join(root, "absent"), "absent test marker", {
        intervalMs: 5,
        timeoutMs: 20,
      })
    ).rejects.toThrow(
      `timed out after 20ms waiting for absent test marker at ${join(root, "absent")}`
    );
  } finally {
    clearTimeout(create);
  }
});

test("waitForCondition rejects an empty description", async () => {
  await expect(waitForCondition("  ", () => true)).rejects.toThrow(
    "waitForCondition requires a description"
  );
});

test("reapOwnedProcess terminates a running process and waits for it to exit", async () => {
  const proc = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30_000)"], {
    stderr: "ignore",
    stdout: "ignore",
  });
  await reapOwnedProcess(proc);
  expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
});

test("reapOwnedProcess escalates to SIGKILL when SIGTERM is ignored", async () => {
  const proc = Bun.spawn(
    [
      process.execPath,
      "-e",
      "process.on('SIGTERM', () => {}); console.log('ready'); await Bun.sleep(30_000);",
    ],
    { stderr: "ignore", stdout: "pipe" }
  );
  const reader = proc.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  await reapOwnedProcess(proc, { graceMs: 100 });
  expect(proc.signalCode).toBe("SIGKILL");
});

test("reapOwnedProcess leaves an already-exited process alone", async () => {
  const proc = Bun.spawn([process.execPath, "-e", "process.exit(3)"], {
    stderr: "ignore",
    stdout: "ignore",
  });
  await proc.exited;
  await reapOwnedProcess(proc);
  expect(proc.exitCode).toBe(3);
  expect(proc.signalCode).toBeNull();
});

test("waitForPids waits for a complete line of positive pids, not an existing file", async () => {
  const root = await createTestFixtureRoot("skillset-wait-pids-");
  const path = join(root, "pids");
  // A truncated-but-unwritten marker and a partial write both parse to
  // nonsense pids (Number("") is 0), so neither may satisfy the wait.
  await writeFile(path, "");
  await expect(
    waitForPids(path, 2, "empty pid marker", { intervalMs: 5, timeoutMs: 30 })
  ).rejects.toThrow("timed out after 30ms waiting for empty pid marker");
  await writeFile(path, "123 45");
  await expect(
    waitForPids(path, 2, "partial pid marker", { intervalMs: 5, timeoutMs: 30 })
  ).rejects.toThrow("timed out after 30ms waiting for partial pid marker");
  await writeFile(path, "0 45\n");
  await expect(
    waitForPids(path, 2, "zero pid marker", { intervalMs: 5, timeoutMs: 30 })
  ).rejects.toThrow("timed out after 30ms waiting for zero pid marker");
  await writeFile(path, "123 45\n");
  expect(await waitForPids(path, 2, "complete pid marker", { intervalMs: 5 })).toEqual([123, 45]);
});
