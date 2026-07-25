import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  isProviderCommandMissingBinary,
  runProviderCommand,
} from "../provider-command";

test("provider command uses literal argv, accepts optional stdin, and preserves split UTF-8", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-command-"));
  const marker = join(root, "shell-ran");
  const bin = await executable(
    root,
    "literal-argv",
    `#!/bin/sh
printf '%s\\n' "$1"
cat
printf '\\303'
sleep 0.02
printf '\\251'
`
  );
  const output: string[] = [];

  const result = await runProviderCommand(
    { cmd: [bin, `literal; touch ${marker}`], cwd: root },
    {
      env: process.env,
      onOutput: async (_stream, text) => {
        output.push(text);
      },
      stdin: "stdin payload",
      timeoutMs: 10_000,
    }
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`literal; touch ${marker}`);
  expect(result.stdout).toContain("stdin payload");
  expect(result.stdout).toEndWith("é");
  expect(output.join("")).toContain("é");
  expect(await Bun.file(marker).exists()).toBe(false);
});

test("provider command bounds retained output while continuing to drain both streams", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-command-"));
  const bin = await executable(
    root,
    "noisy",
    `#!/bin/sh
printf 'abcdefghij'
printf 'klmnopqrst' >&2
printf 'done'
printf 'done' >&2
`
  );
  const output: string[] = [];

  const result = await runProviderCommand(
    { cmd: [bin], cwd: root },
    {
      env: process.env,
      maxStderrBytes: 10,
      maxStdoutBytes: 10,
      onOutput: async (stream, text) => {
        output.push(`${stream}:${text}`);
      },
      timeoutMs: 10_000,
    }
  );

  expect(result).toMatchObject({
    exitCode: 0,
    stderr: "klmnopqrst",
    stderrBytes: 14,
    stderrTruncated: true,
    stdout: "abcdefghij",
    stdoutBytes: 14,
    stdoutTruncated: true,
  });
  expect(
    output
      .filter((entry) => entry.startsWith("stdout:"))
      .map((entry) => entry.slice("stdout:".length))
      .join("")
  ).toContain("abcdefghijdone");
  expect(
    output
      .filter((entry) => entry.startsWith("stderr:"))
      .map((entry) => entry.slice("stderr:".length))
      .join("")
  ).toContain("klmnopqrstdone");
});

test("provider command abort and timeout terminate a detached descendant tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-command-"));
  const bin = await processTreeBin(root, "abort-tree");
  const controller = new AbortController();
  let pid: number | undefined;
  let childPid: number | undefined;

  await expect(
    runProviderCommand(
      { cmd: [bin], cwd: root },
      {
        env: process.env,
        onOutput: async (stream, text) => {
          if (stream !== "stdout") return;
          childPid = Number(text.trim());
          controller.abort();
        },
        onProcess: async (processId) => {
          pid = processId;
        },
        signal: controller.signal,
        timeoutMs: 10_000,
      }
    )
  ).rejects.toMatchObject({ name: "AbortError" });

  expect(pid).toBeDefined();
  expect(childPid).toBeDefined();
  expect(await processIsRunning(pid!)).toBe(false);
  expect(await processIsRunning(childPid!)).toBe(false);

  const timeoutBin = await processTreeBin(root, "timeout-tree");
  let timeoutChildPid: number | undefined;
  const timeout = await runProviderCommand(
    { cmd: [timeoutBin], cwd: root },
    {
      env: process.env,
      onOutput: async (stream, text) => {
        if (stream === "stdout") timeoutChildPid = Number(text.trim());
      },
      timeoutMs: 50,
    }
  );
  expect(timeout.timedOut).toBe(true);
  expect(timeoutChildPid).toBeDefined();
  expect(await processIsRunning(timeoutChildPid!)).toBe(false);
});

test("provider command classifies missing binaries without exposing spawn details", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-command-"));
  const missing = join(root, "does-not-exist");

  try {
    await runProviderCommand(
      { cmd: [missing], cwd: root },
      { env: process.env, timeoutMs: 10_000 }
    );
    throw new Error("expected the missing provider binary to fail");
  } catch (error) {
    expect(isProviderCommandMissingBinary(error)).toBe(true);
    expect(error).toMatchObject({
      code: "ENOENT",
      message: "skillset: provider command executable is unavailable",
    });
    expect(String(error)).not.toContain(missing);
  }
});

async function executable(
  root: string,
  name: string,
  content: string
): Promise<string> {
  const path = join(root, "bin", name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function processTreeBin(root: string, name: string): Promise<string> {
  return executable(
    root,
    name,
    '#!/bin/sh\ntrap \'\' TERM\nsleep 30 &\nchild=$!\nprintf \'%s\\n\' "$child"\nwait "$child"\n'
  );
}

async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
  if (process.platform !== "linux") return true;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(") ") + 2, stat.lastIndexOf(") ") + 3) !== "Z";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
