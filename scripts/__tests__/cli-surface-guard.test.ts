import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDirectRetiredSurfacePatterns,
  isCliSurfacePath,
  scanCliSurface,
} from "../cli-surface-guard";
import { RETIRED_CLI_COMMANDS, RETIRED_CLI_FLAGS } from "../cli-contract";

test("SET-346: CLI surface guard derives direct command and flag patterns", () => {
  const patterns = buildDirectRetiredSurfacePatterns(
    ["retire.command"],
    ["--retire+flag"]
  );
  const matches = (text: string) => patterns.some((pattern) => pattern.test(text));

  expect(matches("Run skillset retire.command before handoff.")).toBe(true);
  expect(matches("Run cli.ts retire.command before handoff.")).toBe(true);
  expect(matches("Use --retire+flag before handoff.")).toBe(true);
  expect(matches("Run skillset retire.command-extra before handoff.")).toBe(false);
  expect(matches("Use --retire+flag-extra before handoff.")).toBe(false);
});

test("SET-346: CLI surface guard covers every canonical retired command and flag", () => {
  expect(scanCliSurface("README.md", "Run skillset verify before handoff.")).toHaveLength(1);
  expect(scanCliSurface("README.md", "Run ./apps/skillset/src/cli.ts verify before handoff.")).toHaveLength(1);
  for (const invocation of ["mycli.ts", "my-cli.ts", "foo.skillset", "my-skillset"]) {
    expect(scanCliSurface("README.md", `Run ${invocation} verify before handoff.`)).toEqual([]);
  }
  for (const command of RETIRED_CLI_COMMANDS) {
    expect(scanCliSurface("README.md", `Run skillset ${command} before handoff.`)).toHaveLength(1);
    expect(scanCliSurface("README.md", `Run bun run skillset:${command} before handoff.`)).toHaveLength(1);
    expect(scanCliSurface("README.md", `Run skillset ${command}-extended before handoff.`)).toEqual([]);
  }
  for (const flag of RETIRED_CLI_FLAGS) {
    expect(scanCliSurface("README.md", `Use ${flag} before handoff.`)).toHaveLength(1);
    expect(scanCliSurface("README.md", `Use ${flag}-extended before handoff.`)).toEqual([]);
  }
});

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
  expect(scanCliSurface("apps/skillset/src/cli-core.ts", "throw new Error(`${label} does not support --dry-run`);")).toHaveLength(1);
  expect(scanCliSurface("README.md", "skillset build [--yes|--dry-run] [--source <dir>]")).toHaveLength(1);
  expect(scanCliSurface("README.md", "example--source and example--codex are not flags")).toEqual([]);
  expect(scanCliSurface("docs/package-releases.md", "Run bun pm pack --dry-run before publishing.")).toEqual([]);
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
