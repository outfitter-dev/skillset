import { expect, test } from "bun:test";
import { readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { inspectGeneratedEditOwnership } from "../generated-edit-ownership";
import { withLockProvenance } from "../lock-provenance";
import { parseCurrentGeneratedLock } from "../generated-lock";

const source = ".skillset/skills/demo/SKILL.md";
const output = ".agents/skills/demo/SKILL.md";
const lockPath = ".agents/skills/skillset.lock";
const config = "compile:\n  targets: [claude, codex]\n  session_start_hook: off\n";
async function fixture(extra: Record<string, string> = {}) {
  const root = await createTestFixtureRoot("generated-edit-ownership-");
  for (const [path, content] of Object.entries({
    "skillset.yaml": config,
    [source]: "---\nname: demo\ndescription: Demonstrate managed ownership.\n---\n\nBody.\n",
    ".skillset/skills/demo/notes.txt": "Resource.\n",
    ...extra,
  })) await Bun.write(join(root, path), content);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  return root;
}
const inspect = (root: string, path = output) => inspectGeneratedEditOwnership(root, join(root, path));

test("current stored ownership agrees with fresh skill and resource projections", async () => {
  const root = await fixture();
  const before = await readFile(join(root, lockPath), "utf8");
  expect(await inspect(root)).toEqual({ kind: "managed", outputPath: output, sourcePath: source, sourceKind: "file" });
  // The lock attributes resources to the source unit, not an invented exact file.
  expect(await inspect(root, ".agents/skills/demo/notes.txt")).toMatchObject({ kind: "managed", sourcePath: source });
  expect(await inspect(root, ".claude/skills/demo/SKILL.md")).toMatchObject({ kind: "managed", sourcePath: source });
  expect(await readFile(join(root, lockPath), "utf8")).toBe(before);
});

test("modified and missing output remain owned while authored files and locks do not", async () => {
  const root = await fixture();
  await writeFile(join(root, output), "Already drifted.\n");
  expect((await inspect(root)).kind).toBe("managed");
  await rm(join(root, output));
  expect((await inspect(root)).kind).toBe("managed");
  expect(await inspect(root, source)).toEqual({ kind: "unknown" });
  expect(await inspect(root, lockPath)).toEqual({ kind: "unknown" });
  expect(await inspect(root, ".agents/skills/demo/unrecorded.txt")).toEqual({ kind: "unknown" });
});

test("a fresh projection without a stored baseline never authorizes denial", async () => {
  const root = await fixture();
  await rm(join(root, lockPath));
  expect(await inspect(root)).toEqual({ kind: "unknown" });
});

for (const state of ["malformed", "header-hash", "item-hash", "legacy", "wrong-root", "stale-item", "duplicate"] as const) {
  test(`invalid or ambiguous ${state} lock evidence yields no decision`, async () => {
    const root = await fixture();
    const path = join(root, lockPath);
    if (state === "malformed") await writeFile(path, "{");
    else {
      const lock = JSON.parse(await readFile(path, "utf8"));
      if (state === "header-hash") lock.headerHash = `sha256:${"0".repeat(64)}`;
      if (state === "item-hash") lock.items[0].provenanceHash = `sha256:${"0".repeat(64)}`;
      if (state === "legacy") lock.schemaVersion = 3;
      if (state === "wrong-root") lock.outputRoot = "elsewhere";
      if (state === "stale-item") lock.items[0].sourceHash = "sha256:stale";
      if (state === "duplicate") lock.items.push({ ...lock.items[0] });
      const next = ["wrong-root", "stale-item", "duplicate"].includes(state) ? withLockProvenance(lock) : lock;
      if (state === "stale-item") expect(parseCurrentGeneratedLock(next).items[0]?.sourceHash).toBe("sha256:stale");
      await writeFile(path, JSON.stringify(next));
    }
    expect(await inspect(root)).toEqual({ kind: "unknown" });
  });
}

test("valid v4 provenance carries the same parsed ownership as v5", async () => {
  const root = await fixture();
  const path = join(root, lockPath);
  const lock = JSON.parse(await readFile(path, "utf8"));
  lock.schemaVersion = 4;
  delete lock.headerHash;
  for (const item of lock.items) delete item.provenanceHash;
  const v4 = withLockProvenance(lock);
  expect(parseCurrentGeneratedLock(v4).schemaVersion).toBe(4);
  await writeFile(path, JSON.stringify(v4));
  expect((await inspect(root)).kind).toBe("managed");
});

test("source and output-placement changes cannot retain stale ownership", async () => {
  const root = await fixture();
  const original = await readFile(join(root, source), "utf8");
  await writeFile(join(root, source), original + "New source.\n");
  expect(await inspect(root)).toEqual({ kind: "unknown" });
  await writeFile(join(root, source), original.replace("name: demo", "name: renamed"));
  expect(await inspect(root)).toEqual({ kind: "unknown" });
  await rm(join(root, source));
  expect(await inspect(root)).toEqual({ kind: "unknown" });
});

test("native root guidance remains editable while scoped generated guidance is owned", async () => {
  const root = await fixture({
    "skillset.yaml": config + "workspace:\n  nativeAgents: true\n",
    "AGENTS.md": "# Authored guidance\n\nKeep this authored.\n",
    ".skillset/rules/src/tests.md": "# Testing\n\nTest changes.\n",
  });
  expect(await inspect(root, "AGENTS.md")).toEqual({ kind: "unknown" });
  expect((await inspect(root, "src/AGENTS.md")).kind).toBe("managed");
});

test("project hook settings never authorize whole-file denial", async () => {
  const root = await fixture({ "skillset.yaml": config.replace("off", "on") });
  expect(await inspect(root, ".claude/settings.json")).toEqual({ kind: "unknown" });
  expect(await inspect(root, ".codex/hooks.json")).toEqual({ kind: "unknown" });
  expect((await inspect(root)).kind).toBe("managed");
});

test("pre-existing symlink outputs and locks are refused, but selected root aliases work", async () => {
  const root = await fixture();
  const parent = await createTestFixtureRoot("generated-edit-alias-");
  const alias = join(parent, "workspace");
  await symlink(root, alias, "dir");
  expect((await inspect(alias)).kind).toBe("managed");
  const sentinel = join(parent, "outside.txt");
  await writeFile(sentinel, "Outside.\n");
  await rm(join(root, output));
  await symlink(sentinel, join(root, output));
  expect(await inspect(root)).toEqual({ kind: "unknown" });
  await rm(join(root, output));
  const oldLock = join(parent, "lock.json");
  await rename(join(root, lockPath), oldLock);
  await symlink(oldLock, join(root, lockPath));
  expect(await inspect(root)).toEqual({ kind: "unknown" });
  expect(await inspectGeneratedEditOwnership(root, sentinel)).toEqual({ kind: "unknown" });
  expect(await inspectGeneratedEditOwnership(root, output)).toEqual({ kind: "unknown" });
});

test("plugin companions attribute a source directory and target changes invalidate prior placement", async () => {
  const root = await fixture({
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n  description: Plugin ownership.\n",
    ".skillset/plugins/demo/README.md": "# Plugin\n",
  });
  expect(await inspect(root, "plugins/demo/README.md")).toMatchObject({ kind: "managed", sourceKind: "directory", sourcePath: ".skillset/plugins/demo" });
  await writeFile(join(root, "skillset.yaml"), config.replace("[claude, codex]", "[claude]"));
  expect(await inspect(root)).toEqual({ kind: "unknown" });
});
