import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseYamlRecord } from "../../packages/core/src/yaml";

describe("source layout migration", () => {
  it("moves legacy output roots into workspace config instead of source manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-migrate-"));
    try {
      await mkdir(join(root, ".skillset", "skills", "demo"), { recursive: true });
      await writeFile(
        join(root, ".skillset", "config.yaml"),
        `skillset:
  name: demo-root
  version: 1.2.3
  outputs:
    plugins:
      claude: packages/claude-plugin
      codex: tools/codex-plugin
    skills:
      claude: .claude/custom-skills
      codex: .agents/custom-skills
supports:
  - "@acme/docs-cli@^2.4.0"
compile:
  targets:
    - claude
    - codex
`,
        "utf8"
      );
      await writeFile(
        join(root, ".skillset", "skills", "demo", "SKILL.md"),
        "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
        "utf8"
      );

      const process = Bun.spawn({
        cmd: ["bun", "./scripts/migrate-source-layout.ts", root],
        cwd: join(import.meta.dir, "..", ".."),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);

      expect(stderr).toContain("migrated");
      expect(exitCode).toBe(0);

      const config = parseYamlRecord(await readFile(join(root, ".skillset", "config.yaml"), "utf8"), "config");
      expect(config.skillset).toBeUndefined();
      expect(config.supports).toBeUndefined();
      expect(config.claude).toEqual({
        plugins: { path: "packages/claude-plugin" },
        skills: { path: ".claude/custom-skills" },
      });
      expect(config.codex).toEqual({
        plugins: { path: "tools/codex-plugin" },
        skills: { path: ".agents/custom-skills" },
      });

      const manifest = parseYamlRecord(
        await readFile(join(root, ".skillset", "src", "skillset.yaml"), "utf8"),
        "manifest"
      );
      expect(manifest.skillset).toEqual({
        name: "demo-root",
        version: "1.2.3",
      });
      expect(manifest.supports).toEqual(["@acme/docs-cli@^2.4.0"]);
      expect(manifest.skillset).not.toHaveProperty("outputs");
      expect(await readFile(join(root, ".skillset", "src", "skills", "demo", "SKILL.md"), "utf8")).toContain(
        "Body."
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("migrates configs that only contain legacy output roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-migrate-"));
    try {
      await mkdir(join(root, ".skillset", "skills", "demo"), { recursive: true });
      await writeFile(
        join(root, ".skillset", "config.yaml"),
        `skillset:
  outputs:
    plugins:
      claude: packages/claude-plugin
    skills:
      codex: .agents/custom-skills
`,
        "utf8"
      );
      await writeFile(
        join(root, ".skillset", "skills", "demo", "SKILL.md"),
        "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
        "utf8"
      );

      const process = Bun.spawn({
        cmd: ["bun", "./scripts/migrate-source-layout.ts", root],
        cwd: join(import.meta.dir, "..", ".."),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);

      expect(stderr).toContain("migrated");
      expect(exitCode).toBe(0);

      const config = parseYamlRecord(await readFile(join(root, ".skillset", "config.yaml"), "utf8"), "config");
      expect(config.skillset).toBeUndefined();
      expect(config.claude).toEqual({ plugins: { path: "packages/claude-plugin" } });
      expect(config.codex).toEqual({ skills: { path: ".agents/custom-skills" } });

      const manifest = parseYamlRecord(
        await readFile(join(root, ".skillset", "src", "skillset.yaml"), "utf8"),
        "manifest"
      );
      expect(manifest).toEqual({});
      expect(await readFile(join(root, ".skillset", "src", "skills", "demo", "SKILL.md"), "utf8")).toContain(
        "Body."
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
