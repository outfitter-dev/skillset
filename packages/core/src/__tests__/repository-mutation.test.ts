import { describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import {
  prepareRepositoryMutationPath,
  RepositoryMutationError,
  resolveWorkspaceMutationRoot,
} from "../repository-mutation";

const withRoots = async (
  operation: (root: string, outside: string) => Promise<void>
): Promise<void> => {
  const parent = await createTestFixtureRoot("skillset-repository-mutation-");
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

describe("repository mutation ancestry", () => {
  test("supports a symlink supplied as the workspace root itself", async () => {
    await withRoots(async (root, _outside) => {
      const parent = join(root, "..");
      const linkedRoot = join(parent, "linked-root");
      await symlink(root, linkedRoot);
      const resolved = await resolveWorkspaceMutationRoot(linkedRoot);
      expect(resolved).toBe(await realpath(root));

      const prepared = await prepareRepositoryMutationPath(
        linkedRoot,
        join(linkedRoot, ".skillset/changes/state.json")
      );
      expect(prepared.workspaceRoot).toBe(resolved);
      expect(prepared.createdDirectories.length).toBeGreaterThan(0);
      await writeFile(prepared.path, "{}\n");
      expect(await readFile(join(root, ".skillset/changes/state.json"), "utf8")).toBe(
        "{}\n"
      );
    });
  });

  test("creates missing in-repository parents one component at a time", async () => {
    await withRoots(async (root) => {
      const prepared = await prepareRepositoryMutationPath(
        root,
        join(root, ".skillset/plugins/tools/skillset.yaml")
      );
      expect(prepared.createdDirectories).toEqual([
        join(root, ".skillset"),
        join(root, ".skillset/plugins"),
        join(root, ".skillset/plugins/tools"),
      ]);
      await writeFile(prepared.path, "name: tools\n");
      expect(
        await readFile(join(root, ".skillset/plugins/tools/skillset.yaml"), "utf8")
      ).toBe("name: tools\n");
    });
  });

  test("refuses a symlinked .skillset parent before outside bytes change", async () => {
    await withRoots(async (root, outside) => {
      await symlink(outside, join(root, ".skillset"));
      await expect(
        prepareRepositoryMutationPath(root, join(root, ".skillset/escaped.txt"))
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset");
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
      await expect(lstat(join(outside, "escaped.txt"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
    });
  });

  test("refuses a symlinked .skillset/changes parent", async () => {
    await withRoots(async (root, outside) => {
      await mkdir(join(root, ".skillset"));
      await symlink(outside, join(root, ".skillset/changes"));
      await expect(
        prepareRepositoryMutationPath(
          root,
          join(root, ".skillset/changes/ledger.jsonl")
        )
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/changes");
      await expect(lstat(join(outside, "ledger.jsonl"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
    });
  });

  test("refuses a symlinked leaf so append and write cannot follow it", async () => {
    await withRoots(async (root, outside) => {
      await mkdir(join(root, ".skillset/changes"), { recursive: true });
      await symlink(join(outside, "sentinel.txt"), join(root, ".skillset/changes/ledger.jsonl"));
      await symlink(join(outside, "absent.txt"), join(root, "dangling.txt"));
      await expect(
        prepareRepositoryMutationPath(root, join(root, ".skillset/changes/ledger.jsonl"))
      ).rejects.toThrow("refusing to write through symbolic link: .skillset/changes/ledger.jsonl");
      await expect(
        prepareRepositoryMutationPath(root, join(root, "dangling.txt"))
      ).rejects.toThrow("refusing to write through symbolic link: dangling.txt");
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
      await expect(lstat(join(outside, "absent.txt"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
    });
  });

  test("allows a symlinked leaf when the caller replaces or removes the leaf itself", async () => {
    await withRoots(async (root, outside) => {
      await mkdir(join(root, ".skillset/changes"), { recursive: true });
      const leaf = join(root, ".skillset/changes/state.json");
      await symlink(join(outside, "sentinel.txt"), leaf);
      const prepared = await prepareRepositoryMutationPath(root, leaf, {
        replacesLeaf: true,
      });
      expect(prepared.path).toBe(join(await realpath(root), ".skillset/changes/state.json"));
      await rm(prepared.path, { force: true });
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
    });
  });

  test("refuses a non-directory parent", async () => {
    await withRoots(async (root) => {
      await writeFile(join(root, ".skillset"), "not a directory\n");
      await expect(
        prepareRepositoryMutationPath(root, join(root, ".skillset/changes/state.json"))
      ).rejects.toThrow("refusing to traverse non-directory parent: .skillset");
    });
  });

  test("fails closed when a created parent is swapped for a symlink", async () => {
    await withRoots(async (root, outside) => {
      await expect(
        prepareRepositoryMutationPath(root, join(root, ".skillset/changes/state.json"), {
          testHooks: {
            afterCreateComponent: async (logicalPath, absolutePath) => {
              if (logicalPath !== ".skillset") return;
              await rm(absolutePath, { force: true, recursive: true });
              await symlink(outside, absolutePath);
            },
          },
        })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset");
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
    });
  });

  test("fails closed when a created parent is swapped for a file", async () => {
    await withRoots(async (root) => {
      await expect(
        prepareRepositoryMutationPath(root, join(root, ".agents/skills/demo/SKILL.md"), {
          testHooks: {
            afterCreateComponent: async (logicalPath, absolutePath) => {
              if (logicalPath !== ".agents") return;
              await rm(absolutePath, { force: true, recursive: true });
              await writeFile(absolutePath, "file\n");
            },
          },
        })
      ).rejects.toThrow("refusing to traverse non-directory parent: .agents");
    });
  });

  test("does not create missing parents when createParents is false", async () => {
    await withRoots(async (root, outside) => {
      const prepared = await prepareRepositoryMutationPath(
        root,
        join(root, ".skillset/changes/missing.md"),
        { createParents: false }
      );
      expect(prepared.createdDirectories).toEqual([]);
      await expect(lstat(join(root, ".skillset"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );

      await symlink(outside, join(root, ".skillset"));
      await expect(
        prepareRepositoryMutationPath(
          root,
          join(root, ".skillset/changes/missing.md"),
          { createParents: false }
        )
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset");
    });
  });

  test("preserves EACCES, EIO, and ELOOP with the logical path", async () => {
    await withRoots(async (root) => {
      await mkdir(join(root, ".skillset"));
      await expect(
        prepareRepositoryMutationPath(root, join(root, ".skillset/changes/state.json"), {
          testHooks: {
            beforeInspectComponent: (logicalPath) => {
              if (logicalPath !== ".skillset") return;
              const error = new Error("permission denied") as NodeJS.ErrnoException;
              error.code = "EACCES";
              throw error;
            },
          },
        })
      ).rejects.toMatchObject({
        code: "EACCES",
        logicalPath: ".skillset",
        message: "skillset: unable to inspect .skillset: EACCES",
        name: "RepositoryMutationError",
      });

      await expect(
        prepareRepositoryMutationPath(root, join(root, ".skillset/changes/state.json"), {
          testHooks: {
            beforeInspectComponent: (logicalPath) => {
              if (logicalPath !== ".skillset") return;
              const error = new Error("input/output error") as NodeJS.ErrnoException;
              error.code = "EIO";
              throw error;
            },
          },
        })
      ).rejects.toMatchObject({
        code: "EIO",
        message: "skillset: unable to inspect .skillset: EIO",
      });

      await symlink(join(root, "loop-b"), join(root, "loop-a"));
      await symlink(join(root, "loop-a"), join(root, "loop-b"));
      await expect(resolveWorkspaceMutationRoot(join(root, "loop-a"))).rejects.toMatchObject({
        code: "ELOOP",
        message: expect.stringContaining("unable to inspect"),
      });
    });
  });

  test("keeps a chmod-denied parent as EACCES when the process is not root", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return;
    }
    await withRoots(async (root) => {
      const parent = join(root, ".skillset");
      await mkdir(parent, { mode: 0o700 });
      await chmod(parent, 0o000);
      try {
        await expect(
          prepareRepositoryMutationPath(root, join(parent, "changes/state.json"))
        ).rejects.toBeInstanceOf(RepositoryMutationError);
        try {
          await prepareRepositoryMutationPath(root, join(parent, "changes/state.json"));
          throw new Error("expected EACCES while inspecting a chmod-denied parent");
        } catch (error) {
          expect(error).toBeInstanceOf(RepositoryMutationError);
          expect(error).toMatchObject({
            code: "EACCES",
            logicalPath: ".skillset/changes",
          });
        }
      } finally {
        await chmod(parent, 0o700);
      }
    });
  });
});
