import { expect, test } from "bun:test";

import { expectProcessGone } from "../test-helpers/process";

test("SET-633: expectProcessGone resolves once a process has exited", async () => {
  const proc = Bun.spawn([process.execPath, "-e", "process.exit(0)"], {
    stderr: "ignore",
    stdout: "ignore",
  });
  await proc.exited;
  await expectProcessGone(proc.pid);
});

test("SET-633: expectProcessGone fails when the process is still running", async () => {
  const proc = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30_000)"], {
    stderr: "ignore",
    stdout: "ignore",
  });
  try {
    await expect(expectProcessGone(proc.pid, { withinMs: 40 })).rejects.toThrow(
      `process ${proc.pid} is still running after 40ms`
    );
    process.kill(proc.pid, 0);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("SET-633: expectProcessGone resolves when a live process exits inside the deadline", async () => {
  const proc = Bun.spawn([process.execPath, "-e", "await Bun.sleep(100)"], {
    stderr: "ignore",
    stdout: "ignore",
  });
  try {
    // Alive at the first poll; gone before the deadline.
    process.kill(proc.pid, 0);
    await expectProcessGone(proc.pid, { withinMs: 5_000 });
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("SET-633: expectProcessGone rejects pids that do not name one process", async () => {
  // 0 signals the caller's own process group and negative pids address
  // groups, so either would make the survivor check pass vacuously.
  for (const pid of [0, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
    await expect(expectProcessGone(pid)).rejects.toThrow(
      `expectProcessGone requires a positive integer pid, got ${pid}`
    );
  }
});
