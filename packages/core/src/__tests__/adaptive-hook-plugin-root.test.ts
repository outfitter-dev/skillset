import { expect, test } from "bun:test";
import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { targetNames } from "../config";
import { pluginPackageComponentFile } from "../plugin-component-paths";
import type { TargetName } from "../types";

const documentedRoots = {
  claude: ["CLAUDE_PLUGIN_ROOT"],
  codex: ["PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"],
  cursor: ["CURSOR_PLUGIN_ROOT"],
} as const satisfies Record<TargetName, readonly string[]>;

test.each(Object.entries(documentedRoots) as [TargetName, readonly string[]][])(
  "%s plugin script hooks use the documented root environment",
  async (target) => {
    const root = await fixture([target]);
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    await expectScriptRuns(root, target);
  }
);

test("a shared package's script hook remains usable by all enabled providers", async () => {
  const root = await fixture(targetNames());
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  for (const target of targetNames()) await expectScriptRuns(root, target);
});

async function expectScriptRuns(
  root: string,
  target: TargetName
): Promise<void> {
  const hookPath = join(
    root,
    "plugins/demo",
    pluginPackageComponentFile(target, "hooks")
  );
  const hook = JSON.parse(await readFile(hookPath, "utf8"));
  const event = Object.values(hook.hooks)[0] as {
    command?: string;
    hooks?: { command: string }[];
  }[];
  const command = event[0]?.command ?? event[0]?.hooks?.[0]?.command;
  expect(command).toBeDefined();
  const env = { ...process.env };
  for (const variable of Object.values(documentedRoots).flat())
    delete env[variable];
  for (const rootVariable of documentedRoots[target])
    env[rootVariable] = join(root, "plugins/demo");
  const processResult = Bun.spawn(["sh", "-c", command!], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ]);
  expect({ exitCode, stdout, stderr }).toEqual({
    exitCode: 0,
    stdout: "hook-root-ok",
    stderr: "",
  });
}

async function fixture(targets: readonly TargetName[]): Promise<string> {
  const root = join(
    await createTestFixtureRoot("skillset-plugin-hook-root-"),
    "workspace with spaces"
  );
  await Bun.write(
    join(root, "skillset.yaml"),
    `compile:\n  targets: [${targets.join(", ")}]\n`
  );
  await Bun.write(
    join(root, ".skillset/plugins/demo/skillset.yaml"),
    "skillset:\n  name: demo\nhooks:\n  SessionStart: [start]\n"
  );
  await Bun.write(
    join(root, ".skillset/plugins/demo/hooks/start/hook.json"),
    JSON.stringify({
      events: ["SessionStart"],
      run: { script: "./check script.sh" },
    })
  );
  const scriptPath = join(
    root,
    ".skillset/plugins/demo/hooks/start/check script.sh"
  );
  await Bun.write(scriptPath, "#!/bin/sh\nprintf 'hook-root-ok'\n");
  await chmod(scriptPath, 0o755);
  return root;
}
