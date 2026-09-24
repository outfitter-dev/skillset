import { expect, test } from "bun:test";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { buildSkillsetResult, diffSkillsetResult } from "@skillset/core";
import { SESSION_START_COMMAND } from "@skillset/core/internal/render-project-hooks";

test("SET-559: authoring model composes and removes only the project SessionStart entry", async () => {
  const root = await createTestFixtureRoot("skillset-authoring-hooks-");
  await cp(join(process.cwd(), "fixtures/authoring-model"), root, { recursive: true });
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const settingsPath = join(root, ".claude/settings.json");
  const withHook = await readFile(settingsPath, "utf8");
  const sessionStart = (JSON.parse(withHook) as { hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> } }).hooks.SessionStart;
  expect(sessionStart.map((entry) => entry.hooks[0]?.command)).toEqual([
    "echo foreign-session-start",
    SESSION_START_COMMAND,
  ]);
  expect(withHook).toContain("echo preserve-post-tool-use");
  expect((await diffSkillsetResult(root)).data.changed).toEqual([]);

  const configPath = join(root, "skillset.yaml");
  await writeFile(configPath, (await readFile(configPath, "utf8")).replace("session_start_hook: on", "session_start_hook: off"));
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const withoutHook = await readFile(settingsPath, "utf8");
  expect(withoutHook).not.toContain(SESSION_START_COMMAND);
  expect(withoutHook).toContain("echo foreign-session-start");
  expect(withoutHook).toContain("echo preserve-post-tool-use");
  const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
    items: Array<{ kind: string; outputPath: string }>;
  };
  expect(lock.items).not.toContainEqual(expect.objectContaining({ kind: "settings-entry", outputPath: ".claude/settings.json" }));
  expect((await diffSkillsetResult(root)).data.changed).toEqual([]);
});
