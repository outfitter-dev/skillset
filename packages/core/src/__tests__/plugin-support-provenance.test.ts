import { afterEach, expect, test } from "bun:test";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult } from "../build";
import { parseCurrentGeneratedLock } from "../generated-lock";
import type { TargetName } from "../types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const companions = ["README.md", "CHANGELOG.md", "assets/example.txt", "scripts/setup.sh", "src/index.js", "shared/local.txt"];

async function fixture(targets: TargetName[] = ["codex"]) {
  const root = await createTestFixtureRoot("plugin-support-provenance-");
  roots.push(root);
  const files: Record<string, string> = {
    "skillset.yaml": `compile:\n  targets: ${JSON.stringify(targets)}\n  session_start_hook: off\n`,
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n  description: Demo package.\n",
    ".skillset/plugins/demo/skills/review/SKILL.md": "---\nname: review\ndescription: Review.\n---\nReview.\n",
  };
  for (const path of companions) files[`.skillset/plugins/demo/${path}`] = "before\n";
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}

async function lock(root: string) {
  return parseCurrentGeneratedLock(await Bun.file(join(root, "plugins/skillset.lock")).json());
}
async function standardPlugin(root: string) {
  const items = (await lock(root)).items.filter((item) => item.kind === "plugin" && item.name === "demo" && item.owner !== undefined && "standardProfile" in item.owner && item.owner.standardProfile === "agent-plugins-1.0");
  expect(items).toHaveLength(1);
  return items[0]!;
}

test.each(companions)("coalesced plugin source provenance follows %s", async (path) => {
  const root = await fixture();
  const built = await buildSkillsetResult(root);
  expect(built.ok).toBe(true);
  expect((await lock(root)).items.filter((item) => item.kind === "plugin")).toHaveLength(1);
  const before = await standardPlugin(root);
  expect(before.consumers).toEqual([
    { phase: "baseline", standardProfile: "agent-plugins-1.0" },
    { phase: "delta", target: "codex" },
  ]);
  expect(before.files).toContain(`demo/${path}`);
  expect(before.sourceHash).toMatch(/^sha256:/);
  const beforeLock = await Bun.file(join(root, "plugins/skillset.lock")).text();
  await Bun.write(join(root, ".skillset/plugins/demo", path), "after\n");
  expect((await diffSkillsetResult(root)).data.changed).not.toHaveLength(0);
  expect(await Bun.file(join(root, "plugins/skillset.lock")).text()).toBe(beforeLock);
  const changed = await buildSkillsetResult(root);
  expect(changed.ok).toBe(true);
  expect(changed.data.filter((file) => file.path === `plugins/demo/${path}`)).toHaveLength(1);
  const after = await standardPlugin(root);
  expect(after.sourceHash).not.toBe(before.sourceHash);
  expect(after.outputHash).not.toBe(before.outputHash);
  expect(await Bun.file(join(root, "plugins/demo", path)).text()).toBe("after\n");
  expect((await verifySkillsetResult(root)).ok).toBe(true);
  expect((await buildSkillsetResult(root)).writes.writtenPaths).toEqual([]);
});

test.skipIf(process.platform === "win32")("coalesced source provenance includes companion executable mode", async () => {
  const root = await fixture();
  const script = join(root, ".skillset/plugins/demo/scripts/setup.sh");
  await chmod(script, 0o644);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const before = await standardPlugin(root);
  await chmod(script, 0o755);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const after = await standardPlugin(root);
  expect(after.sourceHash).not.toBe(before.sourceHash);
  expect(after.outputHash).not.toBe(before.outputHash);
  expect(after.fileModes?.["demo/scripts/setup.sh"]).toBe("0755");
});

test("standard-only companions retain source provenance and scoped idempotence", async () => {
  const root = await fixture([]);
  const options = { scopes: ["plugins" as const] };
  expect((await buildSkillsetResult(root, options)).ok).toBe(true);
  const before = await standardPlugin(root);
  expect(before.consumers).toEqual([{ phase: "baseline", standardProfile: "agent-plugins-1.0" }]);
  await Bun.write(join(root, ".skillset/plugins/demo/README.md"), "changed\n");
  expect((await buildSkillsetResult(root, options)).ok).toBe(true);
  expect((await standardPlugin(root)).sourceHash).not.toBe(before.sourceHash);
  expect((await buildSkillsetResult(root, options)).writes.writtenPaths).toEqual([]);
});

test("support changes affect their coalesced owner without changing provider manifest or skill provenance", async () => {
  const root = await fixture(["claude", "codex"]);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const before = await lock(root);
  const beforeStandard = await standardPlugin(root);
  await Bun.write(join(root, ".skillset/plugins/demo/README.md"), "changed\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const after = await lock(root);
  expect((await standardPlugin(root)).sourceHash).not.toBe(beforeStandard.sourceHash);
  const otherItems = (items: typeof before.items) => items.filter((item) => !(item.kind === "plugin" && item.owner !== undefined && "standardProfile" in item.owner && item.owner.standardProfile === "agent-plugins-1.0"));
  expect(otherItems(after.items)).toEqual(otherItems(before.items));
});
