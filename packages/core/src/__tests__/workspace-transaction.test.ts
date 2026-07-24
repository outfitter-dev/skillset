import { describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import {
  applyWorkspaceTransaction,
  WorkspaceTransactionRollbackError,
} from "../workspace-transaction";

const withWorkspace = async (
  operation: (root: string) => Promise<void>
): Promise<void> => {
  const root = await mkdtemp(
    nodePath.join(tmpdir(), "skillset-workspace-transaction-")
  );
  try {
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("workspace transactions", () => {
  test("applies writes, moves, and deletes in deterministic report order", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "delete.txt"), "delete before\n");
      await writeFile(nodePath.join(root, "move.txt"), "move before\n");
      await writeFile(nodePath.join(root, "replace.txt"), "replace before\n");

      const report = await applyWorkspaceTransaction(root, {
        deletes: ["delete.txt"],
        moves: [{ from: "move.txt", to: "nested/moved.txt" }],
        writes: [
          { content: "created\n", path: "created.txt" },
          { content: "replace after\n", path: "replace.txt" },
        ],
      });

      expect(report.workspaceRoot).toBe(await realpath(root));
      expect(report.operations).toEqual([
        { from: "move.txt", kind: "move", to: "nested/moved.txt" },
        { kind: "write", path: "created.txt" },
        { kind: "write", path: "replace.txt" },
        { kind: "delete", path: "delete.txt" },
      ]);
      expect(
        await readFile(nodePath.join(root, "nested/moved.txt"), "utf-8")
      ).toBe("move before\n");
      expect(await readFile(nodePath.join(root, "created.txt"), "utf-8")).toBe(
        "created\n"
      );
      expect(await readFile(nodePath.join(root, "replace.txt"), "utf-8")).toBe(
        "replace after\n"
      );
      await expect(access(nodePath.join(root, "delete.txt"))).rejects.toThrow();
      const rootEntries = await readdir(root);
      expect(
        rootEntries.filter((entry) => entry.startsWith(".skillset-workspace-"))
      ).toEqual([]);
    });
  });

  test("allows move targets only when their existing entry is explicitly moved or deleted", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "left.txt"), "left\n");
      await writeFile(nodePath.join(root, "right.txt"), "right\n");

      await expect(
        applyWorkspaceTransaction(root, {
          moves: [{ from: "left.txt", to: "right.txt" }],
        })
      ).rejects.toThrow(
        "move target already exists without a matching move source or delete"
      );
      expect(await readFile(nodePath.join(root, "left.txt"), "utf-8")).toBe(
        "left\n"
      );
      expect(await readFile(nodePath.join(root, "right.txt"), "utf-8")).toBe(
        "right\n"
      );

      await applyWorkspaceTransaction(root, {
        deletes: ["right.txt"],
        moves: [{ from: "left.txt", to: "right.txt" }],
      });
      await expect(access(nodePath.join(root, "left.txt"))).rejects.toThrow();
      expect(await readFile(nodePath.join(root, "right.txt"), "utf-8")).toBe(
        "left\n"
      );
    });
  });

  test("supports swaps and case-only moves without leaving staging artifacts", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "a.txt"), "a\n");
      await writeFile(nodePath.join(root, "b.txt"), "b\n");

      await applyWorkspaceTransaction(root, {
        moves: [
          { from: "b.txt", to: "a.txt" },
          { from: "a.txt", to: "b.txt" },
        ],
      });
      expect(await readFile(nodePath.join(root, "a.txt"), "utf-8")).toBe("b\n");
      expect(await readFile(nodePath.join(root, "b.txt"), "utf-8")).toBe("a\n");

      await applyWorkspaceTransaction(root, {
        moves: [{ from: "a.txt", to: "A.txt" }],
      });
      expect(await readdir(root)).toContain("A.txt");
      expect(await readdir(root)).not.toContain("a.txt");
      expect(await readFile(nodePath.join(root, "A.txt"), "utf-8")).toBe("b\n");
      const rootEntries = await readdir(root);
      expect(
        rootEntries.filter((entry) => entry.startsWith(".skillset-workspace-"))
      ).toEqual([]);
    });
  });

  test("rewrites a moved file at its destination and restores it on rollback", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "old.txt"), "before\n");

      await applyWorkspaceTransaction(root, {
        moves: [{ from: "old.txt", to: "new.txt" }],
        writes: [{ content: "after\n", path: "new.txt" }],
      });
      await expect(access(nodePath.join(root, "old.txt"))).rejects.toThrow();
      expect(await readFile(nodePath.join(root, "new.txt"), "utf-8")).toBe(
        "after\n"
      );

      await expect(
        applyWorkspaceTransaction(
          root,
          {
            moves: [{ from: "new.txt", to: "final.txt" }],
            writes: [
              { content: "final\n", path: "final.txt" },
              { content: "late\n", path: "zz.txt" },
            ],
          },
          {
            testHooks: {
              beforeApply: (_operation, index) => {
                if (index === 2) {
                  throw new Error("injected moved-file rewrite failure");
                }
              },
            },
          }
        )
      ).rejects.toThrow("injected moved-file rewrite failure");

      expect(await readFile(nodePath.join(root, "new.txt"), "utf-8")).toBe(
        "after\n"
      );
      await expect(access(nodePath.join(root, "final.txt"))).rejects.toThrow();
    });
  });

  test("supports a case-only moved-file rewrite", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "old.txt"), "before\n");

      await applyWorkspaceTransaction(root, {
        moves: [{ from: "old.txt", to: "Old.txt" }],
        writes: [{ content: "after\n", path: "Old.txt" }],
      });

      expect(await readdir(root)).toContain("Old.txt");
      expect(await readdir(root)).not.toContain("old.txt");
      expect(await readFile(nodePath.join(root, "Old.txt"), "utf-8")).toBe(
        "after\n"
      );
    });
  });

  test("rewrites files beneath a moved directory and restores them on rollback", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "old.txt"), "outside before\n");
      await mkdir(nodePath.join(root, "skills/old"), { recursive: true });
      await writeFile(
        nodePath.join(root, "skills/old/SKILL.md"),
        "skill before\n"
      );

      await applyWorkspaceTransaction(root, {
        moves: [{ from: "skills/old", to: "skills/new" }],
        writes: [
          { content: "outside after\n", path: "old.txt" },
          { content: "skill after\n", path: "skills/new/SKILL.md" },
        ],
      });

      expect(
        await readFile(nodePath.join(root, "skills/new/SKILL.md"), "utf-8")
      ).toBe("skill after\n");

      await expect(
        applyWorkspaceTransaction(
          root,
          {
            moves: [{ from: "skills/new", to: "skills/next" }],
            writes: [
              { content: "skill final\n", path: "skills/next/SKILL.md" },
              { content: "late write\n", path: "zz.txt" },
            ],
          },
          {
            testHooks: {
              beforeApply: (_operation, index) => {
                if (index === 2) {
                  throw new Error("injected nested write failure");
                }
              },
            },
          }
        )
      ).rejects.toThrow("injected nested write failure");

      expect(
        await readFile(nodePath.join(root, "skills/new/SKILL.md"), "utf-8")
      ).toBe("skill after\n");
      await expect(
        access(nodePath.join(root, "skills/next"))
      ).rejects.toThrow();
    });
  });

  test("refuses paths that escape or traverse symbolic links", async () => {
    await withWorkspace(async (root) => {
      const outside = await mkdtemp(
        nodePath.join(tmpdir(), "skillset-workspace-transaction-outside-")
      );
      try {
        await expect(
          applyWorkspaceTransaction(root, {
            writes: [{ content: "nope\n", path: "../outside.txt" }],
          })
        ).rejects.toThrow("path escapes workspace root");

        await symlink(outside, nodePath.join(root, "linked"));
        await expect(
          applyWorkspaceTransaction(root, {
            writes: [{ content: "nope\n", path: "linked/escaped.txt" }],
          })
        ).rejects.toThrow("refusing to traverse symbolic link");
        await expect(
          access(nodePath.join(outside, "escaped.txt"))
        ).rejects.toThrow();
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test("rolls back every applied change after an injected late failure", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "delete.txt"), "delete before\n");
      await writeFile(nodePath.join(root, "move.txt"), "move before\n");
      await writeFile(nodePath.join(root, "replace.txt"), "replace before\n");

      await expect(
        applyWorkspaceTransaction(
          root,
          {
            deletes: ["delete.txt"],
            moves: [{ from: "move.txt", to: "nested/moved.txt" }],
            writes: [
              { content: "created\n", path: "created.txt" },
              { content: "replace after\n", path: "replace.txt" },
            ],
          },
          {
            testHooks: {
              beforeApply: (_operation, index) => {
                if (index === 2) {
                  throw new Error("injected late write failure");
                }
              },
            },
          }
        )
      ).rejects.toThrow("injected late write failure");

      expect(await readFile(nodePath.join(root, "delete.txt"), "utf-8")).toBe(
        "delete before\n"
      );
      expect(await readFile(nodePath.join(root, "move.txt"), "utf-8")).toBe(
        "move before\n"
      );
      expect(await readFile(nodePath.join(root, "replace.txt"), "utf-8")).toBe(
        "replace before\n"
      );
      await expect(
        access(nodePath.join(root, "created.txt"))
      ).rejects.toThrow();
      await expect(access(nodePath.join(root, "nested"))).rejects.toThrow();
      const rootEntries = await readdir(root);
      expect(
        rootEntries.filter((entry) => entry.startsWith(".skillset-workspace-"))
      ).toEqual([]);
    });
  });

  test("reports a distinct error when rollback itself fails", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "move.txt"), "move before\n");

      let transactionFailure: unknown;
      try {
        await applyWorkspaceTransaction(
          root,
          {
            moves: [{ from: "move.txt", to: "moved.txt" }],
            writes: [{ content: "created\n", path: "created.txt" }],
          },
          {
            testHooks: {
              beforeApply: (_operation, index) => {
                if (index === 1) {
                  throw new Error("injected apply failure");
                }
              },
              beforeRollback: (action) => {
                if (action.kind === "restore-move") {
                  throw new Error("injected rollback failure");
                }
              },
            },
          }
        );
      } catch (error) {
        transactionFailure = error;
      }

      expect(transactionFailure).toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect(
        (
          transactionFailure as WorkspaceTransactionRollbackError
        ).rollbackFailures.join("\n")
      ).toContain("injected rollback failure");
      expect(await readFile(nodePath.join(root, "moved.txt"), "utf-8")).toBe(
        "move before\n"
      );
    });
  });
});
