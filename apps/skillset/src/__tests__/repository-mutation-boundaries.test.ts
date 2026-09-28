import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { buildSkillset } from "@skillset/core";
import { writeReleaseState } from "@skillset/core/internal/release-state";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";
import { addChangeEntry, updateChangeReason } from "../change-workflow";
import { importSource } from "../import";
import { scaffoldSourceUnit } from "../new-source";
import { applyRelease } from "../release";
import { createSkillset, initSkillset } from "../setup";

const withBoundary = async (
  operation: (root: string, outside: string) => Promise<void>
): Promise<void> => {
  const parent = await createTestGitFixtureRoot("skillset-mutation-boundary-");
  const root = join(parent, "repo");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel.txt"), "outside\n");
  try {
    await operation(root, outside);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
};

const commitWorkspace = async (root: string): Promise<void> => {
  await initializeTestGitRepository(root, {
    disposableRoot: join(root, ".."),
  });
};

const initWorkspace = async (root: string): Promise<void> => {
  await initSkillset({
    cwd: root,
    rootPath: root,
    useGitRoot: false,
    write: true,
  });
};

const assertSentinelUnchanged = async (outside: string, escaped: string): Promise<void> => {
  expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
  await expect(lstat(join(outside, escaped))).rejects.toHaveProperty("code", "ENOENT");
};

describe("SET-637 repository mutation boundaries", () => {
  test("setup, new-source, and a valid in-repository layout still write", async () => {
    await withBoundary(async (root, outside) => {
      const home = join(root, "home");
      await mkdir(home);
      const globalSource = await createSkillset({ global: true, homeDir: home, write: true });
      expect(globalSource.rootPath).toBe(join(home, ".skillset/source"));
      expect(await readFile(join(home, ".skillset/source/skillset.yaml"), "utf8")).toContain(
        "skillset:"
      );
      await assertSentinelUnchanged(outside, "skillset.yaml");

      await initWorkspace(root);
      expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("skillset:");
      expect((await lstat(join(root, ".skillset"))).isDirectory()).toBe(true);

      const created = await scaffoldSourceUnit(root, {
        kind: "skill",
        name: "demo",
        write: true,
      });
      expect(created.files.map((file) => file.path)).toContain(
        ".skillset/skills/demo/SKILL.md"
      );
      expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain(
        "name: demo"
      );
    });
  });

  test("setup refuses a symlinked .skillset parent before outside bytes change", async () => {
    await withBoundary(async (root, outside) => {
      await symlink(outside, join(root, ".skillset"));
      await expect(initWorkspace(root)).rejects.toThrow(
        "refusing to traverse symbolic link: .skillset"
      );
      await assertSentinelUnchanged(outside, "skillset.yaml");
    });
  });

  test("new-source refuses a symlinked skills parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await rm(join(root, ".skillset/skills"), { force: true, recursive: true });
      await symlink(outside, join(root, ".skillset/skills"));
      await expect(
        scaffoldSourceUnit(root, { kind: "skill", name: "escaped", write: true })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/skills");
      await assertSentinelUnchanged(outside, "escaped");
    });
  });

  test("import refuses a symlinked plugin parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      const source = join(outside, "imported-plugin");
      await mkdir(source);
      await writeFile(
        join(source, "skillset.yaml"),
        "skillset:\n  name: escaped-plugin\n  description: Imported plugin for mutation ancestry.\n"
      );
      await rm(join(root, ".skillset/plugins"), { force: true, recursive: true });
      await symlink(outside, join(root, ".skillset/plugins"));
      await expect(
        importSource({
          kind: "plugin",
          name: "escaped-plugin",
          rootPath: root,
          sourcePath: source,
        })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/plugins");
      await assertSentinelUnchanged(outside, "escaped-plugin");
    });
  });

  test("a target-native skill merge refuses a symlinked SKILL.md leaf", async () => {
    await withBoundary(async (root, outside) => {
      const { outsideSkill, source } = await mergeFixture(root, outside);
      const before = await readFile(outsideSkill, "utf8");
      await expect(
        importSource({
          kind: "skill",
          mergeTargetNativeSkill: true,
          rootPath: root,
          sourcePath: source,
        })
      ).rejects.toThrow("refusing to write through symbolic link: .skillset/skills/demo/SKILL.md");
      expect(await readFile(outsideSkill, "utf8")).toBe(before);
    });
  });

  test("a failed merge baseline refuses to restore SKILL.md through a symlinked leaf", async () => {
    await withBoundary(async (root, outside) => {
      const { outsideSkill, source } = await mergeFixture(root, outside);
      const targetSkill = join(root, ".skillset/skills/demo/SKILL.md");
      await rm(targetSkill);
      await writeFile(targetSkill, await readFile(outsideSkill, "utf8"));
      await writeFile(outsideSkill, "outside bytes a restore must not replace\n");
      const before = await readFile(outsideSkill, "utf8");
      await expect(
        importSource({
          kind: "skill",
          mergeTargetNativeSkill: true,
          rootPath: root,
          sourcePath: source,
          testHooks: {
            beforeBaselineSeed: async () => {
              await rm(targetSkill);
              await symlink(outsideSkill, targetSkill);
              throw new Error("test: baseline seeding failed after the merge");
            },
          },
        })
      ).rejects.toThrow("refusing to write through symbolic link: .skillset/skills/demo/SKILL.md");
      expect(await readFile(outsideSkill, "utf8")).toBe(before);
    });
  });

  test("change add and release-state writes refuse a symlinked changes parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await commitWorkspace(root);
      const preserved = await replaceWithSymlink(join(root, ".skillset/changes"), outside);
      await expect(
        addChangeEntry(root, {
          bump: "patch",
          reason: {
            kind: "inline",
            value: "Document a source change that must stay inside the workspace.",
          },
          scopes: ["skill:demo"],
        })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/changes");
      await expect(writeReleaseState(root, { scopes: {} })).rejects.toThrow(
        "refusing to traverse symbolic link: .skillset/changes"
      );
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
      await expect(lstat(join(preserved, "state.json"))).resolves.toBeDefined();
    });
  });

  test("change add refuses a symlinked ledger leaf before appending outside", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await commitWorkspace(root);
      const ledger = join(root, ".skillset/changes/ledger.jsonl");
      const redirected = join(outside, "ledger.jsonl");
      await writeFile(redirected, await readFile(ledger).catch(() => ""));
      const before = await readFile(redirected, "utf8");
      await rm(ledger, { force: true });
      await symlink(redirected, ledger);
      await expect(
        addChangeEntry(root, {
          bump: "patch",
          reason: {
            kind: "inline",
            value: "Document a source change whose ledger must stay inside the workspace.",
          },
          scopes: ["skill:demo"],
        })
      ).rejects.toThrow(
        "refusing to write through symbolic link: .skillset/changes/ledger.jsonl"
      );
      expect(await readFile(redirected, "utf8")).toBe(before);
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
    });
  });

  test("change reason refuses to rewrite a pending entry reached through a symlinked changes parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await commitWorkspace(root);
      const added = await addChangeEntry(root, {
        bump: "patch",
        reason: {
          kind: "inline",
          value: "Pending reason that will be moved outside the workspace before an edit.",
        },
        scopes: ["skill:demo"],
      });
      await writeFile(
        join(root, ".skillset/changes/legacy.md"),
        "---\nid: abcdef123456\nbump: patch\nscope: skill:demo\n---\n\nLegacy frontmatter reason that must stay outside untouched.\n"
      );
      const preserved = await replaceWithSymlink(join(root, ".skillset/changes"), outside);
      const reasonFile = join(preserved, added.entry.path.split("/").at(-1) ?? "");
      const legacyFile = join(preserved, "legacy.md");
      const reasonBefore = await readFile(reasonFile, "utf8");
      const legacyBefore = await readFile(legacyFile, "utf8");

      for (const ref of [`@${added.entry.id}`, "@abcdef123456"]) {
        await expect(
          updateChangeReason(root, {
            append: false,
            reason: {
              kind: "inline",
              value: "Rewritten reason that must never land in the outside directory.",
            },
            ref,
          })
        ).rejects.toThrow("refusing to traverse symbolic link: .skillset/changes");
      }
      expect(await readFile(reasonFile, "utf8")).toBe(reasonBefore);
      expect(await readFile(legacyFile, "utf8")).toBe(legacyBefore);
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
    });
  });

  test("release restore refuses a swapped changes parent and keeps the outside sentinel", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await commitWorkspace(root);
      const added = await addChangeEntry(root, {
        bump: "patch",
        reason: {
          kind: "inline",
          value: "Cover the demo skill so release restore can be exercised.",
        },
        scopes: ["skill:demo"],
      });
      const preserved = await replaceWithSymlink(join(root, ".skillset/changes"), outside);
      expect(added.entry.id.length).toBeGreaterThan(0);
      await expect(applyRelease(root)).rejects.toThrow(
        "refusing to traverse symbolic link: .skillset/changes"
      );
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
      await expect(lstat(join(preserved, "history.jsonl"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
      await expect(lstat(join(preserved, "releases.jsonl"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
    });
  });

  test("generated-output writes refuse a symlinked .agents parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await symlink(outside, join(root, ".agents"));
      await expect(buildSkillset(root)).rejects.toThrow(
        "refusing to traverse symbolic link"
      );
      await assertSentinelUnchanged(outside, "skills");
    });
  });
});

async function mergeFixture(
  root: string,
  outside: string
): Promise<{ readonly outsideSkill: string; readonly source: string }> {
  await initWorkspace(root);
  const skill = "---\nname: demo\ndescription: Demo skill for merge ancestry.\n---\n\nDemo body.\n";
  const outsideSkill = join(outside, "SKILL.md");
  await writeFile(outsideSkill, skill);
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await symlink(outsideSkill, join(root, ".skillset/skills/demo/SKILL.md"));
  const source = join(outside, "provider/demo");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), skill);
  return { outsideSkill, source };
}

async function replaceWithSymlink(path: string, outside: string): Promise<string> {
  const preserved = join(outside, "preserved");
  await mkdir(preserved);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await writeFile(join(preserved, entry.name), await readFile(join(path, entry.name)));
  }
  await rm(path, { force: true, recursive: true });
  await symlink(preserved, path);
  return preserved;
}
