import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isCliSurfacePath, scanCliSurface } from "../cli-surface-guard";

test("SET-285: CLI surface guard rejects retired commands, flags, and environment", () => {
  const content = [
    "Run skillset verify before handoff.",
    "Run bun run skillset:verify before handoff.",
    "Build/diff/verify report the same render results.",
    "Inspect doctor/explain output.",
    "Use skillset dev --watch --apply.",
    "const retiredTarget = \"--codex\";",
    "flags: --claude --codex --cursor --json",
    "Set SKILLSET_TRY_CODEX_BIN for tests.",
    "throw new Error(`skillset: unknown try plugin ${pluginId}`);",
    "const label = \"try status\";",
  ].join("\n");
  expect(scanCliSurface("README.md", content)).toHaveLength(10);
  expect(scanCliSurface("README.md", "Run skillset check --only outputs and skillset dev --write.")).toEqual([]);
});

test("SET-285: CLI surface guard preserves deliberate history and migration evidence", () => {
  expect(isCliSurfacePath("docs/adrs/20260101-old.md")).toBe(false);
  expect(isCliSurfacePath("docs/reference/cli-flags.md")).toBe(false);
  expect(isCliSurfacePath("apps/skillset/src/__tests__/contract.test.ts")).toBe(false);
  expect(isCliSurfacePath(".envrc.example")).toBe(true);
  expect(isCliSurfacePath("fixtures/example/.envrc")).toBe(true);
  expect(isCliSurfacePath("README.md")).toBe(true);
});

test("SET-285: CLI surface guard ignores inherited repository targeting", async () => {
  const gitDir = join(await mkdtemp(join(tmpdir(), "skillset-cli-guard-git-")), "foreign.git");
  const initialized = Bun.spawnSync(["git", "init", "--bare", "-q", gitDir]);
  expect(initialized.exitCode).toBe(0);

  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "cli-surface-guard.ts")], {
    env: { ...process.env, GIT_DIR: gitDir },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toContain("CLI surface guard scanned");
  expect(stderr).not.toContain("scanned 0 files");
});
