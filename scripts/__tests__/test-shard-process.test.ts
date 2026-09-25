import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import { runAllOrAbort, runProcess } from "../test-shard-process";

test("SET-608: a timed-out shard and its descendant cannot remain active", async () => {
  if (process.platform === "win32") return;
  const root = await createTestFixtureRoot("skillset-shard-timeout-");
  const log = join(root, "timeout.log");
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "const child=Bun.spawn({cmd:[process.execPath,'-e','await Bun.sleep(30000)'],stdout:'ignore',stderr:'ignore'});console.log(child.pid);await Bun.sleep(30000)",
    ],
    root,
    process.env,
    log,
    300,
    new AbortController().signal
  );
  expect(result.timedOut).toBeTrue();
  expect(result.exitCode).not.toBe(0);
  const pid = Number((await readFile(log, "utf8")).trim());
  expect(Number.isSafeInteger(pid)).toBeTrue();
  await expectGone(pid);
});

test("SET-608: cancellation terminates a running shard process group", async () => {
  if (process.platform === "win32") return;
  const root = await createTestFixtureRoot("skillset-shard-cancel-");
  const log = join(root, "cancel.log");
  const controller = new AbortController();
  const running = runProcess(
    process.execPath,
    [
      "-e",
      "const child=Bun.spawn({cmd:[process.execPath,'-e','await Bun.sleep(30000)'],stdout:'ignore',stderr:'ignore'});console.log(child.pid);await Bun.sleep(30000)",
    ],
    root,
    process.env,
    log,
    30_000,
    controller.signal
  );
  const pid = await waitForPid(log);
  controller.abort("SIGTERM");
  const result = await running;
  expect(result.signal).toBe("SIGTERM");
  await expectGone(pid);
});

test("SET-608: leader exit does not spare a descendant ignoring SIGTERM", async () => {
  if (process.platform === "win32") return;
  const root = await createTestFixtureRoot("skillset-shard-stubborn-");
  const log = join(root, "stubborn.log");
  const ready = join(root, "descendant-ready");
  const started = performance.now();
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      `const fs=require('node:fs');const marker=${JSON.stringify(ready)};const child=Bun.spawn({cmd:[process.execPath,'-e',"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],'ready');await Bun.sleep(30000)",marker],stdout:'ignore',stderr:'ignore'});while(!fs.existsSync(marker))await Bun.sleep(10);console.log(child.pid);await Bun.sleep(30000)`,
    ],
    root,
    process.env,
    log,
    300,
    new AbortController().signal
  );
  expect(result.timedOut).toBeTrue();
  expect(performance.now() - started).toBeGreaterThanOrEqual(2000);
  const pid = Number((await readFile(log, "utf8")).trim());
  expect(Number.isSafeInteger(pid)).toBeTrue();
  await expectGone(pid);
});

test("SET-667: a rejected shard launch terminates its running siblings first", async () => {
  if (process.platform === "win32") return;
  const root = await createTestFixtureRoot("skillset-shard-reject-");
  const log = join(root, "sibling.log");
  const controller = new AbortController();
  const run = runAllOrAbort(controller, [
    () =>
      runProcess(
        process.execPath,
        ["-e", "console.log(process.pid);await Bun.sleep(30000)"],
        root,
        process.env,
        log,
        30_000,
        controller.signal
      ),
    async () => {
      await waitForPid(log);
      return runProcess(
        join(root, "missing-shard-binary"),
        [],
        root,
        process.env,
        join(root, "missing.log"),
        30_000,
        controller.signal
      );
    },
  ]);
  await expect(run).rejects.toThrow();
  const pid = await waitForPid(log);
  await expectGroupGone(pid, 1000);
  expect(controller.signal.aborted).toBeTrue();
});

async function waitForPid(path: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pid = Number((await readFile(path, "utf8").catch(() => "")).trim());
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
    await Bun.sleep(10);
  }
  throw new Error("child PID was not written before cancellation");
}

async function expectGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await Bun.sleep(10);
  }
  throw new Error(`descendant ${pid} survived shard termination`);
}

async function expectGroupGone(pgid: number, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  do {
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await Bun.sleep(10);
  } while (performance.now() < deadline);
  throw new Error(`process group ${pgid} outlived the rejected shard run`);
}
