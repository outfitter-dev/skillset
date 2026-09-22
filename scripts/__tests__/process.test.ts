import { expect, test } from "bun:test";

import { expectProcessGone } from "../test-helpers/process";

test("SET-633: expectProcessGone resolves once a process has exited", async () => {
  const proc = Bun.spawn(["true"], { stderr: "ignore", stdout: "ignore" });
  await proc.exited;
  await expectProcessGone(proc.pid);
});

test("SET-633: expectProcessGone fails when the process is still running", async () => {
  const proc = Bun.spawn(["sleep", "30"], { stderr: "ignore", stdout: "ignore" });
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
