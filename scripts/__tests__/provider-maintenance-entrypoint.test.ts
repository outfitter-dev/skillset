import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("SET-281: provider evidence maintenance is repo-script owned", async () => {
  const root = join(import.meta.dir, "../..");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  expect(pkg.scripts["providers:check"]).toBe("bun scripts/provider-maintenance.ts check");
  expect(pkg.scripts["providers:diff"]).toBe("bun scripts/provider-maintenance.ts diff");
  expect(pkg.scripts["providers:update"]).toBe("bun scripts/provider-maintenance.ts update");

  const child = Bun.spawn([process.execPath, "scripts/provider-maintenance.ts", "bogus"], {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain("expected provider maintenance command check, diff, or update");

  const ignoredFlag = Bun.spawn(
    [process.execPath, "scripts/provider-maintenance.ts", "update", "--dry-run"],
    {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  expect(await ignoredFlag.exited).toBe(1);
  expect(await new Response(ignoredFlag.stderr).text()).toContain(
    "provider maintenance does not accept additional arguments: --dry-run"
  );
});
