import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
      if (route[0] === "check") {
        expect(envelope.data).toHaveProperty("providerUpdates");
      }
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

  test("check keeps lint failures structured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-check-json-"));
    await mkdir(path.join(root, ".skillset", "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skillset.yaml"), "skillset:\n  name: check-json\nclaude: true\ncodex: false\n");
    await writeFile(
      path.join(root, ".skillset", "skills", "demo", "SKILL.md"),
      "---\nname: wrong-name\ndescription: Demo.\n---\n\nBody.\n"
    );

    const result = await runJsonRoute("check", "--root", root);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as SkillsetCliResult;
    expect(validateCliResult(envelope)).toEqual({ diagnostics: [], ok: true });
    expect(envelope).toMatchObject({
      command: "check",
      diagnostics: [{ code: "skill-name-directory-mismatch", severity: "error" }],
      exitCode: 1,
      ok: false,
    });
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
