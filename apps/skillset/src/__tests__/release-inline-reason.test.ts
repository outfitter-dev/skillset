import { expect, test } from "bun:test";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const cli = join(import.meta.dir, "..", "cli.ts");

for (const json of [false, true]) {
  test(`release amend rejects blank inline reasons as usage (${json ? "json" : "human"})`, async () => {
    const root = await createTestFixtureRoot("release-inline-reason-");
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
      expect((await run(["init", "--yes"])).code).toBe(0);
      const empty = join(root, "empty.txt");
      await writeFile(empty, "");
      const before = (await readdir(root, { recursive: true })).sort();
      for (const args of [
        ["release", "amend", "@abcdef", "--reason", ""],
        ["release", "amend", "@abcdef", "--reason", " \t "],
        ["release", "amend", "@abcdef", "--reason="],
        ["release", "amend", "@not-a-ref", "--reason", ""],
      ]) {
        const result = await run(args);
        expect(result.code).toBe(2);
        if (json) expect(JSON.parse(result.stdout).diagnostics[0]).toMatchObject({
          code: "cli.usage", message: "skillset: change reason must not be empty",
        });
        else expect(result.stderr).toContain("change reason must not be empty");
      }
      for (const args of [
        ["release", "amend", "@abcdef", "--reason", "real reason"],
        ["release", "amend", "@abcdef", "--reason", "-"],
        ["release", "amend", "@abcdef", "--reason-file", empty],
        ["release", "amend", "@abcdef", "--reason-file", join(root, "missing.txt")],
      ]) {
        const result = await run(args);
        expect(result.code).toBe(1);
        if (json) expect(JSON.parse(result.stdout).diagnostics[0].code).toBe("cli.failure");
      }
      expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
