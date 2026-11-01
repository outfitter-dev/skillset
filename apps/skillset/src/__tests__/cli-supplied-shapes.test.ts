import { expect, test } from "bun:test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const cli = join(import.meta.dir, "..", "cli.ts");

for (const json of [false, true]) {
  test(`supplied shapes are usage errors without writes (${json ? "json" : "human"})`, async () => {
    const root = await createTestFixtureRoot("cli-supplied-shapes-");
    const run = async (args: string[]) => {
      const child = Bun.spawn({
        cmd: [process.execPath, cli, ...args, "--root", root, ...(json ? ["--json"] : [])],
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      return { stdout, stderr, code };
    };
    try {
      const initialized = await run(["init", "--yes"]);
      expect(initialized).toMatchObject({ code: 0 });
      const source = join(root, "input");
      await mkdir(source);
      await writeFile(join(source, "SKILL.md"), "---\nname: sample\ndescription: Sample.\n---\n\nBody.\n");
      const before = (await readdir(root, { recursive: true })).sort();
      for (const args of [
        ["restore", "NOT-A-HEX"],
        ["import", source, "--kind", "skill", "--name", "Bad Name"],
        ["create", "!!!"],
      ]) {
        const result = await run(args);
        expect(result.code).toBe(2);
        if (json) expect(JSON.parse(result.stdout).diagnostics[0].code).toBe("cli.usage");
        expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
        expect(result.stdout).not.toContain("\"receipt\"");
        expect(result.stdout).not.toContain("  report:");
      }
      const absent = await run(["restore", "deadbeef"]);
      expect(absent.code).toBe(1);
      if (json) expect(JSON.parse(absent.stdout).diagnostics[0].code).toBe("cli.failure");
      expect((await run(["import", source, "--kind", "skill", "--name", "good-name"])).code).toBe(0);
      await writeFile(join(source, "SKILL.md"), "---\nname: Bad Name\ndescription: Sample.\n---\n\nBody.\n");
      const invalidSource = await run(["import", source, "--kind", "skill"]);
      expect(invalidSource.code).toBe(1);
      if (json) expect(JSON.parse(invalidSource.stdout).diagnostics[0].code).toBe("import.partial");
      const conflict = await run(["import", source, "--kind", "skill", "--name", "good-name"]);
      expect(conflict.code).toBe(1);
      if (json) expect(JSON.parse(conflict.stdout).diagnostics[0].code).toBe("import.partial");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
