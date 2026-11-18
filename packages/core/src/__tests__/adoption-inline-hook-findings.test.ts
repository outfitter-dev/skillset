import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { recordImportedFindings } from "../adoption-findings";
import { classifyNativeHookSource, nativeHookFindings } from "../adoption-native-findings";
import { MIGRATION_STATE_PATH } from "../migration-state";

const path = ".skillset/plugins/demo/.claude-plugin/plugin.json";
const eventMap = { SessionStart: [{ hooks: [{ type: "command", command: "echo native" }] }] };
const content = JSON.stringify({ name: "demo", hooks: [eventMap, "./extra.json", eventMap] });
const source = { path, pointers: ["/hooks/0", "/hooks/2"], targets: ["claude" as const] };

test("inline pointers give repeated event maps distinct stable identities", () => {
  const flags = nativeHookFindings(source, content);
  expect(flags).toHaveLength(2);
  expect(new Set(flags.map((flag) => flag.id)).size).toBe(2);
  expect(flags.every((flag) => flag.source.path === path && flag.placement.kind === "sidecar")).toBe(true);
  expect(nativeHookFindings({ ...source, pointers: ["/hooks/2", "/hooks/0", "/hooks/0"] }, content)).toEqual(flags);
  expect(classifyNativeHookSource(source, content).map((item) => item.path)).toEqual([`${path}#/hooks/0/SessionStart/0`, `${path}#/hooks/2/SessionStart/0`]);
});

test("inline selection does not classify unrelated manifest metadata or path entries", () => {
  const flags = nativeHookFindings({ ...source, pointers: ["/hooks/0"] }, content);
  expect(flags).toHaveLength(1);
  expect(flags[0]?.code).toBe("adopt.native-hook-runtime-unverified");
  for (const pointer of ["/hooks/1", "/hooks/3", "/hooks/01", "/__proto__", "/hooks/~2"]) {
    const diagnostics = classifyNativeHookSource({ ...source, pointers: [pointer] }, content);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "native-hook-lift-unclassified", path: `${path}#${pointer}` });
  }
});

test("inline diagnostic locations retain JSON pointer escaping", () => {
  const value = JSON.stringify({ hooks: { "Odd/~Event": [{ hooks: [{ type: "command", command: "echo native" }] }] } });
  const diagnostics = classifyNativeHookSource({ ...source, pointers: ["/hooks"] }, value);
  expect(diagnostics[0]?.path).toBe(`${path}#/hooks/Odd~1~0Event/0`);
});

test("manifest edits abort both inline sidecars and Markdown locator installation", async () => {
  const root = await createTestFixtureRoot("skillset-inline-hook-preimage-");
  const bodyPath = ".skillset/skills/demo/SKILL.md";
  const body = "---\nname: demo\ndescription: Demo.\n---\nAsk @alice.\n";
  await Bun.write(join(root, path), content);
  await Bun.write(join(root, bodyPath), body);
  const changed = content.replace("echo native", "echo changed");
  await expect(recordImportedFindings(root, { bodyPaths: [bodyPath], nativeHooks: [source] }, {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, path), changed); } },
  })).rejects.toThrow();
  expect(await readFile(join(root, path), "utf8")).toBe(changed);
  expect(await readFile(join(root, bodyPath), "utf8")).toBe(body);
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
});
