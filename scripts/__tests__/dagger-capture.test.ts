import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  captureCommand,
  commandVerdict,
  verifyCommandEvidence,
} from "../dagger-capture";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

async function capture(code: string, timeoutMs = 2000) {
  const root = await createTestFixtureRoot("skillset-dagger-capture-");
  const cwd = join(root, "source");
  const out = join(root, "evidence");
  await mkdir(cwd);
  const evidence = await captureCommand({
    command: [process.execPath, "-e", code],
    cwd,
    out,
    env: process.env,
    timeoutMs,
    signal: new AbortController().signal,
  });
  return { evidence, out };
}

test("Dagger capture exports failed output without changing the original exit", async () => {
  const { evidence, out } = await capture(
    "console.error('assertion canary');process.exit(7)"
  );
  expect(evidence.result?.exitCode).toBe(7);
  expect(commandVerdict(evidence)).toBe(7);
  expect(await readFile(join(out, "command.log"), "utf8")).toContain(
    "assertion canary"
  );
  expect(commandVerdict(await verifyCommandEvidence(out))).toBe(7);
});

test("Dagger capture retains a signal instead of manufacturing exit zero", async () => {
  if (process.platform === "win32") return;
  const { evidence, out } = await capture(
    "process.kill(process.pid,'SIGTERM')"
  );
  expect(evidence.result?.signal).toBe("SIGTERM");
  expect(commandVerdict(await verifyCommandEvidence(out))).toBe(143);
});

test("Dagger capture records timeout and rejects missing evidence", async () => {
  const { evidence, out } = await capture("await Bun.sleep(10000)", 100);
  expect(evidence.result?.timedOut).toBeTrue();
  expect(commandVerdict(evidence)).toBe(124);
  await writeFile(join(out, "command-result.json"), "{}");
  await expect(verifyCommandEvidence(out)).rejects.toThrow("incomplete");
});

test("Dagger capture binds artifacts and rejects missing successful output", async () => {
  const root = await createTestFixtureRoot("skillset-dagger-artifact-");
  const cwd = join(root, "source");
  const out = join(root, "evidence");
  await mkdir(cwd);
  await captureCommand({
    command: [process.execPath, "-e", "process.exit(0)"],
    cwd,
    out,
    env: process.env,
    timeoutMs: 2000,
    artifacts: ["absent.xml"],
    signal: new AbortController().signal,
  });
  await expect(verifyCommandEvidence(out)).rejects.toThrow("omitted artifact");
  await writeFile(join(out, "absent.xml"), "later counterfeit");
  await expect(verifyCommandEvidence(out)).rejects.toThrow(
    "changed after capture"
  );
});

test("Dagger capture preserves spawn failure as failed diagnostics", async () => {
  const root = await createTestFixtureRoot("skillset-dagger-spawn-");
  const cwd = join(root, "source");
  await mkdir(cwd);
  const out = join(root, "evidence");
  const evidence = await captureCommand({
    command: [join(cwd, "missing")],
    cwd,
    out,
    env: process.env,
    timeoutMs: 2000,
    signal: new AbortController().signal,
  });
  expect(evidence.result).toBeNull();
  expect(evidence.error).toContain("ENOENT");
  expect(commandVerdict(await verifyCommandEvidence(out))).toBe(1);
});
