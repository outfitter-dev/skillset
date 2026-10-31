import { expect, test } from "bun:test";
import { mkdir, readFile, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { validateCliResult } from "@skillset/schema";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const cli = join(import.meta.dir, "../cli.ts");
async function fixture() {
  const parent = await createTestFixtureRoot("status-workspace-reads-");
  const root = join(parent, "workspace");
  const outside = join(parent, "outside");
  await mkdir(outside);
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n\nBody.\n");
  await Bun.write(join(root, ".skillset/changes/example.md"), "Pending reason.\n");
  await Bun.write(join(root, ".skillset/changes/ledger.jsonl"), "");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  return { root, outside, parent };
}

function tracedStatus(root: string, link: string) {
  return Bun.spawnSync([process.execPath, "--eval", `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      const fs = await import("node:fs/promises");
      let unsafeReads = 0;
      const wrapped = {};
      for (const name of ["readFile", "readdir", "stat", "realpath", "access", "open"]) {
        const original = fs[name];
        wrapped[name] = async (path, ...args) => {
          const value = String(path);
          if (value === ${JSON.stringify(link)} || value.startsWith(${JSON.stringify(link + "/")})) unsafeReads++;
          return original(path, ...args);
        };
      }
      mock.module("node:fs/promises", () => ({ ...fs, ...wrapped }));
      const syncFs = await import("node:fs");
      const wrappedSync = {};
      for (const name of ["readFileSync", "readdirSync", "statSync", "realpathSync", "existsSync"]) {
        const original = syncFs[name];
        wrappedSync[name] = (path, ...args) => {
          const value = String(path);
          if (value === ${JSON.stringify(link)} || value.startsWith(${JSON.stringify(link + "/")})) unsafeReads++;
          return original(path, ...args);
        };
      }
      mock.module("node:fs", () => ({ ...syncFs, ...wrappedSync }));
      process.argv = [process.execPath, ${JSON.stringify(cli)}, "status", "--root", ${JSON.stringify(root)}, "--json"];
      await import(${JSON.stringify(cli)});
      assert.equal(unsafeReads, 0, "status followed a rejected link");
    `], { stdout: "pipe", stderr: "pipe" });
}

for (const relative of [
  "skillset.yaml",
  ".skillset",
  ".skillset/skills/demo/SKILL.md",
  ".skillset/changes",
  ".skillset/changes/example.md",
  ".skillset/changes/ledger.jsonl",
  ".agents/skills/skillset.lock",
  ".agents/skills/demo",
  ".agents/skills/demo/SKILL.md",
]) {
  test(`status does not follow ${relative} symlink`, async () => {
    const { root, outside } = await fixture();
    const link = join(root, relative);
    const destination = join(outside, "sentinel");
    await rename(link, destination);
    await symlink(destination, link);
    const child = tracedStatus(root, link);
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    const skippedByDiscovery = relative === ".skillset/skills/demo/SKILL.md" || relative === ".skillset/changes/example.md";
    expect(child.exitCode).toBe(skippedByDiscovery ? 0 : 1);
    const envelope = JSON.parse(new TextDecoder().decode(child.stdout));
    expect(validateCliResult(envelope).ok).toBe(true);
    expect(envelope.ok).toBe(skippedByDiscovery);
    if (!skippedByDiscovery) expect(JSON.stringify(envelope)).toContain("workspace inspection");
  });
}

test("status accepts a workspace selected through a symlink", async () => {
  const { root, parent } = await fixture();
  const selected = join(parent, "selected");
  await symlink(root, selected);
  const child = Bun.spawnSync([process.execPath, cli, "status", "--root", selected, "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(child.stdout)).data.conclusion.state).toBe("current");
  expect(await readFile(join(root, ".skillset/changes/example.md"), "utf8")).toBe("Pending reason.\n");
});


const conditionalReads = [
  { name: "repo support manifest", path: "package.json", files: {
    "skillset.yaml": "compile:\n  targets: [codex]\nsupports:\n  packages:\n    - name: demo\n      range: ^1.0.0\n      source: repo:package.json\n",
    "package.json": '{"dependencies":{"demo":"1.2.0"}}',
  } },
  { name: "shared partial", path: ".skillset/shared/partials/intro.md", files: {
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill\n---\n\n{{> intro}}\n",
    ".skillset/shared/partials/intro.md": "Shared intro.\n",
  } },
  { name: "shared resource", path: ".skillset/shared/references/guide.md", files: {
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill\nresources:\n  - from: shared:references/guide.md\n    to: references/guide.md\n---\n\nBody.\n",
    ".skillset/shared/references/guide.md": "Reference content.\n",
  } },
  { name: "license descriptor", path: ".skillset/LICENSE.txt", files: {
    ".skillset/LICENSE.txt": "License text.\n",
  } },
  { name: "native root guidance", path: "AGENTS.md", files: {
    "AGENTS.md": "# Authored native guidance\n",
  } },
  { name: "migration-state directory", path: ".skillset/adopt", files: {
    ".skillset/adopt/.keep": "",
  } },
  { name: "pending-event directory", path: ".skillset/changes/events", files: {
    ".skillset/changes/events/.keep": "",
  } },
] as const;

for (const scenario of conditionalReads) {
  test(`status confines conditional ${scenario.name} reads`, async () => {
    const { root, outside } = await fixture();
    for (const [path, content] of Object.entries(scenario.files)) await Bun.write(join(root, path), content);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const link = join(root, scenario.path);
    const destination = join(outside, "sentinel");
    await rename(link, destination);
    await symlink(destination, link);
    const child = tracedStatus(root, link);
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(1);
    const envelope = JSON.parse(new TextDecoder().decode(child.stdout));
    expect(validateCliResult(envelope).ok).toBe(true);
    expect(envelope.ok).toBe(false);
    expect(JSON.stringify(envelope)).toContain("workspace inspection");
  });
}
