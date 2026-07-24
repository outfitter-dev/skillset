import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";

import { runRuntimeProbe } from "../runtime-probe";

test("runtime probe cancels a spawned process when onProcess aborts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-runtime-probe-"));
  const bin = join(root, "bin", "sleeping-probe");
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, "#!/bin/sh\nsleep 10\n", "utf8");
  await chmod(bin, 0o755);
  const controller = new AbortController();
  let pid: number | undefined;

  await expect(runRuntimeProbe({ cmd: [bin], cwd: root, display: [bin] }, "prompt", {
    env: process.env,
    onProcess: async (processId) => {
      pid = processId;
      controller.abort();
    },
    signal: controller.signal,
    timeoutMs: 10_000,
  })).rejects.toMatchObject({ name: "AbortError" });

  expect(pid).toBeDefined();
  expect(() => process.kill(pid!, 0)).toThrow();
});

test("runtime probe terminates a spawned process when an output callback fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-runtime-probe-"));
  const bin = await processTreeBin(root, "callback-tree");
  const callbackError = new Error("output callback failed");
  let pid: number | undefined;
  let childPid: number | undefined;

  await expect(runRuntimeProbe({ cmd: [bin], cwd: root, display: [bin] }, "prompt", {
    env: process.env,
    onOutput: async (stream, text) => {
      if (stream === "stdout") childPid = Number(text.trim());
      throw callbackError;
    },
    onProcess: async (processId) => { pid = processId; },
    timeoutMs: 10_000,
  })).rejects.toBe(callbackError);

  expect(pid).toBeDefined();
  expect(childPid).toBeDefined();
  expect(() => process.kill(pid!, 0)).toThrow();
  expect(() => process.kill(childPid!, 0)).toThrow();
});

test("runtime probe AbortSignal terminates descendants holding provider pipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-runtime-probe-"));
  const bin = await processTreeBin(root, "abort-tree");
  const controller = new AbortController();
  let pid: number | undefined;
  let childPid: number | undefined;
  const startedAt = performance.now();

  await expect(runRuntimeProbe({ cmd: [bin], cwd: root, display: [bin] }, "prompt", {
    env: process.env,
    onOutput: async (stream, text) => {
      if (stream !== "stdout") return;
      childPid = Number(text.trim());
      controller.abort();
    },
    onProcess: async (processId) => { pid = processId; },
    signal: controller.signal,
    timeoutMs: 10_000,
  })).rejects.toMatchObject({ name: "AbortError" });

  expect(performance.now() - startedAt).toBeLessThan(2_000);
  expect(pid).toBeDefined();
  expect(childPid).toBeDefined();
  expect(() => process.kill(pid!, 0)).toThrow();
  expect(() => process.kill(childPid!, 0)).toThrow();
});

test("runtime probe timeout terminates descendants holding provider pipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-runtime-probe-"));
  const bin = await processTreeBin(root, "timeout-tree");
  let pid: number | undefined;
  let childPid: number | undefined;
  const startedAt = performance.now();

  const result = await runRuntimeProbe({ cmd: [bin], cwd: root, display: [bin] }, "prompt", {
    env: process.env,
    onOutput: async (stream, text) => {
      if (stream === "stdout") childPid = Number(text.trim());
    },
    onProcess: async (processId) => { pid = processId; },
    timeoutMs: 50,
  });

  expect(result.timedOut).toBe(true);
  expect(performance.now() - startedAt).toBeLessThan(2_000);
  expect(pid).toBeDefined();
  expect(childPid).toBeDefined();
  expect(() => process.kill(pid!, 0)).toThrow();
  expect(() => process.kill(childPid!, 0)).toThrow();
});

async function processTreeBin(root: string, name: string): Promise<string> {
  const bin = join(root, "bin", name);
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, "#!/bin/sh\nsleep 30 &\nchild=$!\nprintf '%s\\n' \"$child\"\nwait \"$child\"\n", "utf8");
  await chmod(bin, 0o755);
  return bin;
}
