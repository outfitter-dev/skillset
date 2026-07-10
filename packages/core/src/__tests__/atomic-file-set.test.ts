import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { writeAtomicFileSet } from "../atomic-file-set";

test("marketplace file transactions roll back every installed file after a late failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-atomic-file-set-"));
  const providerPath = join(root, ".claude-plugin", "marketplace.json");
  const lockPath = join(root, "skillset.lock");
  await Bun.write(providerPath, "provider-before\n");
  await writeFile(lockPath, "lock-before\n");

  await expect(writeAtomicFileSet([
    { content: "provider-after\n", path: providerPath },
    { content: "lock-after\n", path: lockPath },
  ], {
    beforeInstall: (_path, index) => {
      if (index === 1) throw new Error("injected late lock failure");
    },
  })).rejects.toThrow("injected late lock failure");

  expect(await readFile(providerPath, "utf8")).toBe("provider-before\n");
  expect(await readFile(lockPath, "utf8")).toBe("lock-before\n");
  expect((await readdir(root)).filter((name) => name.startsWith(".skillset-marketplace-"))).toEqual([]);
  expect((await readdir(join(root, ".claude-plugin"))).filter((name) => name.startsWith(".skillset-marketplace-"))).toEqual([]);
});
