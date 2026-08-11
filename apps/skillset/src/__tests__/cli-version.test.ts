import { expect, test } from "bun:test";

import packageJson from "../../package.json";
import { cliVersion } from "../cli-version";

test("CLI version is owned by the product package manifest", async () => {
  expect(cliVersion).toBe(packageJson.version);

  const process = Bun.spawn(["bun", "apps/skillset/src/cli.ts", "--version"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toBe(`${packageJson.version}\n`);
});
