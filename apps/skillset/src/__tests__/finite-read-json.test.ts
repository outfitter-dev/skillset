import { describe, expect, test } from "bun:test";
import path from "node:path";

import { validateCliResult, type SkillsetCliResult } from "@skillset/schema";

const cli = path.join(import.meta.dir, "..", "cli.ts");
const repoRoot = path.resolve(import.meta.dir, "../../../..");
const fixtureRoot = path.join(repoRoot, "fixtures", "kitchen-sink");

describe("SET-287 finite read-only JSON", () => {
  for (const route of [
    ["check", "--root", fixtureRoot],
    ["diff", "--root", fixtureRoot],
    ["list", "--root", fixtureRoot],
    ["explain", "skillset.yaml", "--root", fixtureRoot],
    ["lookup", "skill", "frontmatter"],
  ] as const) {
    test(`${route.join(" ")} emits one versioned result`, async () => {
      const result = await runJsonRoute(...route);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
      expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
      expect(envelope.exitCode).toBe(result.exitCode);
    });
  }

  for (const route of [
    ["change", "status", "--root", repoRoot],
    ["change", "list", "--root", repoRoot],
    ["change", "history", "--root", repoRoot],
  ] as const) {
    test(`${route.slice(0, 2).join(" ")} emits a versioned ledger result`, async () => {
      const result = await runJsonRoute(...route);
      expect(result.stderr).toBe("");
      const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
      expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
      expect(envelope.exitCode).toBe(result.exitCode);
    });
  }


  test("change check keeps a negative ledger result structured", async () => {
    const result = await runJsonRoute("change", "check", "--root", repoRoot);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope.command).toBe("change.check");
    expect(envelope.exitCode).toBe(result.exitCode);
  });
});

async function runJsonRoute(...args: readonly string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn([process.execPath, cli, ...args, "--json"], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "test" },
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
