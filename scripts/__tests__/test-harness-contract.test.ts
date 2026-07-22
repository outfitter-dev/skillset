import { expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

test("repo tests cannot inherit the user XDG config root", async () => {
  const packageJson = (await Bun.file(join(repoRoot, "package.json")).json()) as {
    readonly scripts: { readonly test: string };
  };

  expect(packageJson.scripts.test).toStartWith(
    "env -u XDG_CONFIG_HOME NODE_ENV=test bun test "
  );
});
