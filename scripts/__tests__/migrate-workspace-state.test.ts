import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseYamlRecord } from "../../packages/core/src/yaml";

describe("workspace state migration", () => {
  it("combines ordinary workspace config and source manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, ".skillset", "src"), { recursive: true });
      await writeFile(
        join(root, ".skillset", "config.yaml"),
        `compile:
  targets:
    - claude
tests:
  self-hosted:
    source: repo:.skillset
`,
        "utf8"
      );
      await writeFile(
        join(root, ".skillset", "src", "skillset.yaml"),
        `skillset:
  name: demo
  version: 0.1.0
`,
        "utf8"
      );

      const result = await runMigration(root);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("write skillset.yaml");
      expect(result.stderr).toContain("remove .skillset/config.yaml");
      expect(result.stderr).toContain("remove .skillset/src/skillset.yaml");
      const migrated = parseYamlRecord(await readFile(join(root, "skillset.yaml"), "utf8"), "workspace");
      expect(migrated).toEqual({
        compile: { targets: ["claude"] },
        skillset: { name: "demo", version: "0.1.0" },
        tests: { "self-hosted": { source: "repo:.skillset" } },
      });
      await expect(readFile(join(root, ".skillset", "config.yaml"), "utf8")).rejects.toThrow();
      await expect(readFile(join(root, ".skillset", "src", "skillset.yaml"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("flattens pending entries and preserves ledger files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, ".skillset", "changes", "pending"), { recursive: true });
      await writeFile(join(root, ".skillset", "changes", "pending", "abc123def456.md"), "pending\n", "utf8");
      await writeFile(join(root, ".skillset", "changes", "history.jsonl"), "history\n", "utf8");
      await writeFile(join(root, ".skillset", "changes", "releases.jsonl"), "release\n", "utf8");
      await writeFile(join(root, ".skillset", "changes", "state.json"), "{}\n", "utf8");

      const result = await runMigration(root);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("move .skillset/changes/pending/abc123def456.md -> .skillset/changes/abc123def456.md");
      expect(result.stderr).toContain("remove .skillset/changes/pending");
      await expect(readFile(join(root, ".skillset", "changes", "abc123def456.md"), "utf8")).resolves.toBe("pending\n");
      await expect(readFile(join(root, ".skillset", "changes", "history.jsonl"), "utf8")).resolves.toBe("history\n");
      await expect(readFile(join(root, ".skillset", "changes", "releases.jsonl"), "utf8")).resolves.toBe("release\n");
      await expect(readFile(join(root, ".skillset", "changes", "state.json"), "utf8")).resolves.toBe("{}\n");
      await expect(readFile(join(root, ".skillset", "changes", "pending", "abc123def456.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses pending entry collisions before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, ".skillset", "changes", "pending"), { recursive: true });
      await writeFile(join(root, ".skillset", "changes", "pending", "abc123def456.md"), "old pending\n", "utf8");
      await writeFile(join(root, ".skillset", "changes", "abc123def456.md"), "new pending\n", "utf8");

      const result = await runMigration(root);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("refusing to overwrite existing pending change entry .skillset/changes/abc123def456.md");
      await expect(readFile(join(root, ".skillset", "changes", "pending", "abc123def456.md"), "utf8")).resolves.toBe(
        "old pending\n"
      );
      await expect(readFile(join(root, ".skillset", "changes", "abc123def456.md"), "utf8")).resolves.toBe(
        "new pending\n"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses ambiguous config and manifest merges", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, ".skillset", "src"), { recursive: true });
      await writeFile(join(root, ".skillset", "config.yaml"), "compile:\n  targets:\n    - claude\n", "utf8");
      await writeFile(join(root, ".skillset", "src", "skillset.yaml"), "compile:\n  targets:\n    - codex\n", "utf8");

      const result = await runMigration(root);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cannot merge duplicate top-level key compile");
      await expect(readFile(join(root, ".skillset", "config.yaml"), "utf8")).resolves.toContain("claude");
      await expect(readFile(join(root, ".skillset", "src", "skillset.yaml"), "utf8")).resolves.toContain("codex");
      await expect(readFile(join(root, ".skillset", "skillset.yaml"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("supports dry-run output without mutating files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, "skillset"), { recursive: true });
      await mkdir(join(root, "changes", "pending"), { recursive: true });
      await writeFile(join(root, "changes", "pending", "abc123def456.md"), "pending\n", "utf8");

      const result = await runMigration(root, "--dry-run");

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("move changes/pending/abc123def456.md -> changes/abc123def456.md");
      expect(result.stderr).toContain("move changes -> .skillset/changes");
      expect(result.stderr).toContain("migration dry run wrote no files");
      await expect(readFile(join(root, "changes", "pending", "abc123def456.md"), "utf8")).resolves.toBe("pending\n");
      await expect(readFile(join(root, "changes", "abc123def456.md"), "utf8")).rejects.toThrow();
      await expect(readFile(join(root, ".skillset", "changes", "abc123def456.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("moves dedicated root change state into the source root", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, "skillset"), { recursive: true });
      await mkdir(join(root, "changes", "pending"), { recursive: true });
      await writeFile(join(root, "changes", "pending", "abc123def456.md"), "pending\n", "utf8");
      await writeFile(join(root, "changes", "history.jsonl"), "history\n", "utf8");

      const result = await runMigration(root);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("move changes -> .skillset/changes");
      await expect(readFile(join(root, ".skillset", "changes", "abc123def456.md"), "utf8")).resolves.toBe("pending\n");
      await expect(readFile(join(root, ".skillset", "changes", "history.jsonl"), "utf8")).resolves.toBe("history\n");
      await expect(readFile(join(root, "changes", "history.jsonl"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not flatten top-level changes without a dedicated workspace marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-workspace-state-"));
    try {
      await mkdir(join(root, "changes", "pending"), { recursive: true });
      await writeFile(join(root, "changes", "pending", "abc123def456.md"), "pending\n", "utf8");

      const result = await runMigration(root);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("no workspace state migration needed");
      await expect(readFile(join(root, "changes", "pending", "abc123def456.md"), "utf8")).resolves.toBe("pending\n");
      await expect(readFile(join(root, "changes", "abc123def456.md"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function runMigration(root: string, ...args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const process = Bun.spawn({
    cmd: ["bun", "./scripts/migrate-workspace-state.ts", ...args, root],
    cwd: join(import.meta.dir, "..", ".."),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
  return { exitCode, stderr };
}
