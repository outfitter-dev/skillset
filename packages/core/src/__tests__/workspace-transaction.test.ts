import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  stat,
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

const detectCaseSensitiveWorkspaceVolume = async (): Promise<boolean> => {
  const probeRoot = await mkdtemp(
    nodePath.join(tmpdir(), "skillset-workspace-case-probe-")
  );
  try {
    await writeFile(nodePath.join(probeRoot, "probe.txt"), "probe\n");
    return await access(nodePath.join(probeRoot, "PROBE.txt")).then(
      () => false,
      () => true
    );
  } finally {
    await rm(probeRoot, { force: true, recursive: true });
  }
};

/**
 * Two fixtures below need two distinct entries whose paths differ only by
 * case. That is unrepresentable on a case-insensitive volume (macOS APFS by
 * default), so they report as skipped there rather than passing vacuously.
 */
const caseSensitiveVolume = await detectCaseSensitiveWorkspaceVolume();
const caseSensitiveTest = test.skipIf(!caseSensitiveVolume);

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
      expect(report.supersededDeletePaths).toEqual([]);
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

  test("reports a recreated delete target as superseded, not deleted", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "gone.txt"), "managed\n");
      await writeFile(nodePath.join(root, "also-gone.txt"), "managed\n");
      await mkdir(nodePath.join(root, "linked"));
      await writeFile(nodePath.join(root, "linked/entry.txt"), "managed\n");
      await mkdir(nodePath.join(root, "elsewhere"));
      await writeFile(nodePath.join(root, "elsewhere/entry.txt"), "outside\n");

      const linkedDeletePath = nodePath.join("linked", "entry.txt");
      const report = await applyWorkspaceTransaction(
        root,
        { deletes: ["also-gone.txt", "gone.txt", "linked/entry.txt"] },
        {
          testHooks: {
            beforeApply: async (operation) => {
              if (operation.kind === "delete" && operation.path === "gone.txt") {
                await writeFile(
                  nodePath.join(root, "gone.txt"),
                  "unmanaged\n"
                );
              }
              if (
                operation.kind === "delete" &&
                operation.path === linkedDeletePath
              ) {
                // An ancestor swapped for a symlink must not read as a
                // recreation through the link target.
                await rm(nodePath.join(root, "linked"), {
                  force: true,
                  recursive: true,
                });
                await symlink(
                  nodePath.join(root, "elsewhere"),
                  nodePath.join(root, "linked")
                );
              }
            },
          },
        }
      );

      expect(report.supersededDeletePaths).toEqual(["gone.txt"]);
      expect(await readFile(nodePath.join(root, "gone.txt"), "utf-8")).toBe(
        "unmanaged\n"
      );
      await expect(
        access(nodePath.join(root, "also-gone.txt"))
      ).rejects.toThrow();
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

      const report = await applyWorkspaceTransaction(root, {
        deletes: ["right.txt"],
        moves: [{ from: "left.txt", to: "right.txt" }],
      });
      // The moved entry legitimately takes the deleted path; it is not a
      // superseding recreation.
      expect(report.supersededDeletePaths).toEqual([]);
      await expect(access(nodePath.join(root, "left.txt"))).rejects.toThrow();
      expect(await readFile(nodePath.join(root, "right.txt"), "utf-8")).toBe(
        "left\n"
      );
    });
  });

  caseSensitiveTest(
    "rejects a distinct occupied case-variant move target (case-sensitive volume)",
    async () => {
      await withWorkspace(async (root) => {
        const sourcePath = nodePath.join(root, "guide.txt");
        const targetPath = nodePath.join(root, "Guide.txt");
        await writeFile(sourcePath, "managed source\n");
        await writeFile(targetPath, "unmanaged target\n");

        await expect(
          applyWorkspaceTransaction(root, {
            moves: [{ from: "guide.txt", to: "Guide.txt" }],
          })
        ).rejects.toThrow(
          "move target already exists without a matching move source or delete"
        );
        expect(await readFile(sourcePath, "utf-8")).toBe("managed source\n");
        expect(await readFile(targetPath, "utf-8")).toBe("unmanaged target\n");
      });
    }
  );

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

  caseSensitiveTest(
    "removes case staging before rolling back its created parent (case-sensitive volume)",
    async () => {
      await withWorkspace(async (root) => {
        const sourceDirectory = nodePath.join(root, "References");
        const targetDirectory = nodePath.join(root, "references");
        await mkdir(sourceDirectory);
        await writeFile(nodePath.join(sourceDirectory, "Guide.md"), "before\n");

        let transactionFailure: unknown;
        try {
          await applyWorkspaceTransaction(
            root,
            {
              moves: [
                {
                  from: "References/Guide.md",
                  to: "references/guide.md",
                },
              ],
              writes: [{ content: "late\n", path: "zz.txt" }],
            },
            {
              testHooks: {
                beforeApply: (operation) => {
                  if (operation.kind === "write") {
                    throw new Error("injected case-staging failure");
                  }
                },
              },
            }
          );
        } catch (error) {
          transactionFailure = error;
        }

        expect(transactionFailure).toBeInstanceOf(Error);
        expect(transactionFailure).not.toBeInstanceOf(
          WorkspaceTransactionRollbackError
        );
        expect((transactionFailure as Error).message).toBe(
          "injected case-staging failure"
        );
        expect(
          await readFile(nodePath.join(sourceDirectory, "Guide.md"), "utf-8")
        ).toBe("before\n");
        await expect(access(targetDirectory)).rejects.toThrow();
        expect(
          (await readdir(root)).filter((entry) =>
            entry.startsWith(".skillset-workspace-")
          )
        ).toEqual([]);
      });
    }
  );

  test("rejects and preserves a write target occupied before atomic install", async () => {
    await withWorkspace(async (root) => {
      const targetPath = nodePath.join(root, "created/occupied.txt");
      let transactionFailure: unknown;

      try {
        await applyWorkspaceTransaction(
          root,
          {
            writes: [
              { content: "managed\n", path: "created/occupied.txt" },
            ],
          },
          {
            testHooks: {
              beforeWriteInstall: async (path) => {
                expect(path).toBe("created/occupied.txt");
                await writeFile(targetPath, "unmanaged\n");
              },
            },
          }
        );
      } catch (error) {
        transactionFailure = error;
      }

      expect(transactionFailure).toBeInstanceOf(Error);
      expect(transactionFailure).not.toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect((transactionFailure as Error).message).toBe(
        "skillset: workspace transaction write target appeared before " +
          "atomic install: created/occupied.txt"
      );
      expect(await readFile(targetPath, "utf-8")).toBe("unmanaged\n");
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".skillset-workspace-")
        )
      ).toEqual([]);
    });
  });

  test("retains a staged preimage when its target is recreated", async () => {
    await withWorkspace(async (root) => {
      const targetPath = nodePath.join(root, "occupied.txt");
      await writeFile(targetPath, "original\n");
      let transactionFailure: unknown;

      try {
        await applyWorkspaceTransaction(
          root,
          {
            writes: [{ content: "managed\n", path: "occupied.txt" }],
          },
          {
            testHooks: {
              beforeApply: async (operation) => {
                if (operation.kind === "write") {
                  await writeFile(targetPath, "late unmanaged\n");
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
      const rollbackError =
        transactionFailure as WorkspaceTransactionRollbackError;
      expect(rollbackError.originalError).toBeInstanceOf(Error);
      expect((rollbackError.originalError as Error).message).toBe(
        "skillset: workspace transaction write target reappeared after " +
          "preimage staging: occupied.txt"
      );
      expect(await readFile(targetPath, "utf-8")).toBe("late unmanaged\n");

      const reportedFailures = rollbackError.rollbackFailures.join("\n");
      const preservedPreimage =
        /preserved preimage at (?<path>\S+)/u.exec(reportedFailures)?.groups
          ?.path;
      const retainedJournal =
        /recovery journal retained at (?<path>\S+)/u.exec(reportedFailures)
          ?.groups?.path;
      if (preservedPreimage === undefined || retainedJournal === undefined) {
        throw new Error(
          `rollback failures did not report recovery paths: ${reportedFailures}`
        );
      }
      expect(
        await readFile(nodePath.join(root, preservedPreimage), "utf-8")
      ).toBe("original\n");

      const journals = (await readdir(root)).filter((entry) =>
        entry.startsWith(".skillset-workspace-transaction-")
      );
      expect(journals).toEqual([retainedJournal]);
      const recoveryEntries = await readdir(
        nodePath.join(root, retainedJournal, "preimages")
      );
      expect(recoveryEntries).toHaveLength(1);
    });
  });

  test("rejects and preserves a move target occupied before atomic install", async () => {
    await withWorkspace(async (root) => {
      const sourcePath = nodePath.join(root, "move.txt");
      const targetPath = nodePath.join(root, "created/moved.txt");
      await writeFile(sourcePath, "managed source\n");
      let transactionFailure: unknown;

      try {
        await applyWorkspaceTransaction(
          root,
          { moves: [{ from: "move.txt", to: "created/moved.txt" }] },
          {
            testHooks: {
              beforeApply: async (operation) => {
                if (operation.kind !== "move") {
                  return;
                }
                await mkdir(nodePath.join(root, "created"), {
                  recursive: true,
                });
                await writeFile(targetPath, "unmanaged late\n");
              },
            },
          }
        );
      } catch (error) {
        transactionFailure = error;
      }

      expect(transactionFailure).toBeInstanceOf(Error);
      expect(transactionFailure).not.toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect((transactionFailure as Error).message).toBe(
        "skillset: workspace transaction move target appeared before " +
          "atomic install: created/moved.txt"
      );
      expect(await readFile(targetPath, "utf-8")).toBe("unmanaged late\n");
      expect(await readFile(sourcePath, "utf-8")).toBe("managed source\n");
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".skillset-workspace-")
        )
      ).toEqual([]);
    });
  });

  test("rejects a directory move target claimed between inspection and install", async () => {
    await withWorkspace(async (root) => {
      const sourceDirectory = nodePath.join(root, "skills/old");
      const targetDirectory = nodePath.join(root, "skills/new");
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(nodePath.join(sourceDirectory, "SKILL.md"), "managed\n");
      let transactionFailure: unknown;

      try {
        await applyWorkspaceTransaction(
          root,
          { moves: [{ from: "skills/old", to: "skills/new" }] },
          {
            testHooks: {
              beforeDirectoryInstall: async (path) => {
                if (path !== "skills/new") {
                  return;
                }
                await mkdir(targetDirectory);
              },
            },
          }
        );
      } catch (error) {
        transactionFailure = error;
      }

      expect(transactionFailure).toBeInstanceOf(Error);
      expect(transactionFailure).not.toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect((transactionFailure as Error).message).toBe(
        "skillset: workspace transaction move target appeared before " +
          "atomic install: skills/new"
      );
      expect(await readdir(targetDirectory)).toEqual([]);
      expect(
        await readFile(nodePath.join(sourceDirectory, "SKILL.md"), "utf-8")
      ).toBe("managed\n");
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".skillset-workspace-")
        )
      ).toEqual([]);
    });
  });

  test("rejects a directory move target symlinked between inspection and install", async () => {
    await withWorkspace(async (root) => {
      const sourceDirectory = nodePath.join(root, "skills/old");
      const unmanagedDirectory = nodePath.join(root, "unmanaged");
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(nodePath.join(sourceDirectory, "SKILL.md"), "managed\n");
      await mkdir(unmanagedDirectory);
      await writeFile(
        nodePath.join(unmanagedDirectory, "keep.md"),
        "unmanaged\n"
      );
      let transactionFailure: unknown;

      try {
        await applyWorkspaceTransaction(
          root,
          { moves: [{ from: "skills/old", to: "skills/new" }] },
          {
            testHooks: {
              beforeDirectoryInstall: async (path) => {
                if (path !== "skills/new") {
                  return;
                }
                await symlink(
                  unmanagedDirectory,
                  nodePath.join(root, "skills/new")
                );
              },
            },
          }
        );
      } catch (error) {
        transactionFailure = error;
      }

      expect(transactionFailure).toBeInstanceOf(Error);
      expect(transactionFailure).not.toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect((transactionFailure as Error).message).toBe(
        "skillset: workspace transaction move target appeared before " +
          "atomic install: skills/new"
      );
      expect(await readdir(unmanagedDirectory)).toEqual(["keep.md"]);
      expect(
        await readFile(nodePath.join(sourceDirectory, "SKILL.md"), "utf-8")
      ).toBe("managed\n");
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".skillset-workspace-")
        )
      ).toEqual([]);
    });
  });

  test("allows exactly one competing directory transaction to install", async () => {
    await withWorkspace(async (root) => {
      const targetDirectory = nodePath.join(root, "skills/installed");
      const targetRelative = nodePath.join("skills", "installed");
      const competitors = ["a", "b"] as const;
      await Promise.all(
        competitors.map(async (name) => {
          const sourceDirectory = nodePath.join(root, `skills/${name}`);
          await mkdir(sourceDirectory, { recursive: true });
          await writeFile(
            nodePath.join(sourceDirectory, "SKILL.md"),
            `${name}\n`
          );
        })
      );

      const barrier = Promise.withResolvers<undefined>();
      let readyCount = 0;
      const outcomes = await Promise.all(
        competitors.map(async (name) => {
          try {
            await applyWorkspaceTransaction(
              root,
              {
                moves: [{ from: `skills/${name}`, to: "skills/installed" }],
              },
              {
                testHooks: {
                  beforeDirectoryInstall: async (path) => {
                    if (path !== targetRelative) {
                      return;
                    }
                    readyCount += 1;
                    if (readyCount === competitors.length) {
                      barrier.resolve(undefined);
                    }
                    await barrier.promise;
                  },
                },
              }
            );
            return { kind: "installed" as const, name };
          } catch (error) {
            return { error, kind: "occupied" as const, name };
          }
        })
      );

      expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual([
        "installed",
        "occupied",
      ]);
      const installed = outcomes.find(
        (outcome) => outcome.kind === "installed"
      );
      const occupied = outcomes.find((outcome) => outcome.kind === "occupied");
      if (!(installed && occupied)) {
        throw new Error("expected one installed and one occupied transaction");
      }
      expect(occupied.error).toBeInstanceOf(Error);
      expect(occupied.error).not.toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect((occupied.error as Error).message).toBe(
        "skillset: workspace transaction move target appeared before " +
          `atomic install: ${targetRelative}`
      );
      expect(
        await readFile(nodePath.join(targetDirectory, "SKILL.md"), "utf-8")
      ).toBe(`${installed.name}\n`);
      expect(
        await readFile(
          nodePath.join(root, `skills/${occupied.name}/SKILL.md`),
          "utf-8"
        )
      ).toBe(`${occupied.name}\n`);
      const installedSourceMissing = await access(
        nodePath.join(root, `skills/${installed.name}`)
      ).then(
        () => false,
        () => true
      );
      expect(installedSourceMissing).toBe(true);
      const rootEntries = await readdir(root);
      expect(
        rootEntries.filter((entry) => entry.startsWith(".skillset-workspace-"))
      ).toEqual([]);
    });
  });

  test("enforces caller-approved absence during initial inspection", async () => {
    await withWorkspace(async (root) => {
      const targetPath = nodePath.join(root, "occupied.txt");

      await expect(
        applyWorkspaceTransaction(
          root,
          {
            writes: [
              {
                content: "managed\n",
                expectedAbsent: true,
                path: "occupied.txt",
              },
            ],
          },
          {
            testHooks: {
              beforeInitialInspection: async () => {
                await writeFile(targetPath, "unmanaged\n");
              },
            },
          }
        )
      ).rejects.toThrow(
        "write target appeared after final approval: occupied.txt"
      );

      expect(await readFile(targetPath, "utf-8")).toBe("unmanaged\n");
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".skillset-workspace-")
        )
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

  test("falls back to exclusive create when the filesystem rejects hard links", async () => {
    await withWorkspace(async (root) => {
      const report = await applyWorkspaceTransaction(
        root,
        {
          writes: [
            { content: "tool\n", mode: 0o755, path: "bin/tool" },
            { content: "plain\n", path: "plain.txt" },
          ],
        },
        {
          testHooks: {
            failHardLink: (path) =>
              path === "bin/tool" || path === "plain.txt"
                ? Object.assign(
                    new Error("EPERM: operation not permitted, link"),
                    { code: "EPERM" }
                  )
                : undefined,
          },
        }
      );

      expect(report.operations).toEqual([
        { kind: "write", path: "bin/tool" },
        { kind: "write", path: "plain.txt" },
      ]);
      const toolPath = nodePath.join(root, "bin/tool");
      expect(await readFile(toolPath, "utf-8")).toBe("tool\n");
      expect((await stat(toolPath)).mode & 0o777).toBe(0o755);
      expect(await readFile(nodePath.join(root, "plain.txt"), "utf-8")).toBe(
        "plain\n"
      );
      const rootEntries = await readdir(root);
      expect(
        rootEntries.filter((entry) => entry.startsWith(".skillset-workspace-"))
      ).toEqual([]);
    });
  });

  test("exclusive-create fallback removes its partial target when a later write fails", async () => {
    await withWorkspace(async (root) => {
      await writeFile(nodePath.join(root, "target.txt"), "old\n");

      let exclusiveWriteFailures = 0;
      await expect(
        applyWorkspaceTransaction(
          root,
          { writes: [{ content: "new\n", path: "target.txt" }] },
          {
            testHooks: {
              // Fails only the transaction's own install so the rollback
              // restore can complete through the same fallback.
              failExclusiveCreateWrite: () =>
                exclusiveWriteFailures++ === 0
                  ? Object.assign(
                      new Error("ENOSPC: no space left on device, write"),
                      { code: "ENOSPC" }
                    )
                  : undefined,
              failHardLink: () =>
                Object.assign(
                  new Error("EPERM: operation not permitted, link"),
                  { code: "EPERM" }
                ),
            },
          }
        )
      ).rejects.toThrow("ENOSPC");

      // The partial fallback file was removed, so rollback restored the
      // preimage instead of colliding with a leftover entry.
      expect(await readFile(nodePath.join(root, "target.txt"), "utf-8")).toBe(
        "old\n"
      );
    });
  });

  test("exclusive-create fallback still rejects an occupied target", async () => {
    await withWorkspace(async (root) => {
      await expect(
        applyWorkspaceTransaction(
          root,
          { writes: [{ content: "managed\n", path: "target.txt" }] },
          {
            testHooks: {
              beforeWriteInstall: async () => {
                await writeFile(
                  nodePath.join(root, "target.txt"),
                  "interloper\n"
                );
              },
              failHardLink: () =>
                Object.assign(
                  new Error("EPERM: operation not permitted, link"),
                  { code: "EPERM" }
                ),
            },
          }
        )
      ).rejects.toThrow("write target appeared before atomic install");
      expect(await readFile(nodePath.join(root, "target.txt"), "utf-8")).toBe(
        "interloper\n"
      );
    });
  });

  test("supports validated file and directory shape transitions", async () => {
    await withWorkspace(async (root) => {
      const outputPath = nodePath.join(root, "references/guide");
      await mkdir(nodePath.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, "flat before\n");
      await chmod(outputPath, 0o644);

      const report = await applyWorkspaceTransaction(root, {
        deletes: ["references/guide"],
        writes: [
          {
            content: "nested after\n",
            mode: 0o755,
            path: "references/guide/subdir/page.md",
          },
        ],
      });
      // The plan's own write rebuilt the deleted path as a directory; the
      // delete is not superseded.
      expect(report.supersededDeletePaths).toEqual([]);

      const nestedPath = nodePath.join(outputPath, "subdir/page.md");
      expect(await readFile(nestedPath, "utf-8")).toBe("nested after\n");
      expect((await stat(nestedPath)).mode & 0o777).toBe(0o755);

      await applyWorkspaceTransaction(root, {
        deletes: ["references/guide/subdir/page.md"],
        writes: [
          {
            content: "flat again\n",
            mode: 0o644,
            path: "references/guide",
          },
        ],
      });

      expect(await readFile(outputPath, "utf-8")).toBe("flat again\n");
      expect((await stat(outputPath)).mode & 0o777).toBe(0o644);
    });
  });

  test("validates each directory replacement once before journaling", async () => {
    await withWorkspace(async (root) => {
      const leafPaths = Array.from(
        { length: 128 },
        (_, index) => `bundle/nested/file-${String(index).padStart(3, "0")}.txt`
      );
      await mkdir(nodePath.join(root, "bundle/nested"), { recursive: true });
      await Promise.all(
        leafPaths.map((path) => writeFile(nodePath.join(root, path), path))
      );
      let validationCount = 0;

      await applyWorkspaceTransaction(
        root,
        {
          deletes: leafPaths,
          writes: [{ content: "flat\n", path: "bundle" }],
        },
        {
          testHooks: {
            beforeDirectoryReplacementValidation: async (path) => {
              validationCount += 1;
              expect(path).toBe("bundle");
              expect(
                (await readdir(root)).filter((entry) =>
                  entry.startsWith(".skillset-workspace-transaction-")
                )
              ).toEqual([]);
            },
          },
        }
      );

      expect(validationCount).toBe(1);
      expect(await readFile(nodePath.join(root, "bundle"), "utf-8")).toBe(
        "flat\n"
      );
    });
  });

  test("rejects shape transitions that could consume unmanaged directory entries", async () => {
    await withWorkspace(async (root) => {
      await mkdir(nodePath.join(root, "old"));
      await writeFile(nodePath.join(root, "old/managed.txt"), "managed\n");
      await writeFile(
        nodePath.join(root, "old/unmanaged.txt"),
        "unmanaged\n"
      );

      await expect(
        applyWorkspaceTransaction(root, {
          deletes: ["old"],
          writes: [{ content: "new\n", path: "old/new.txt" }],
        })
      ).rejects.toThrow(
        "delete ancestor must be an existing regular file before a descendant write"
      );
      await expect(
        applyWorkspaceTransaction(root, {
          deletes: ["old/managed.txt"],
          writes: [{ content: "flat\n", path: "old" }],
        })
      ).rejects.toThrow(
        "refusing to replace directory containing unmanaged entry: old/unmanaged.txt"
      );

      expect(
        await readFile(nodePath.join(root, "old/managed.txt"), "utf-8")
      ).toBe("managed\n");
      expect(
        await readFile(nodePath.join(root, "old/unmanaged.txt"), "utf-8")
      ).toBe("unmanaged\n");
      await expect(access(nodePath.join(root, "old/new.txt"))).rejects.toThrow();
    });
  });

  test("rejects a directory delete as coverage for nested unmanaged content", async () => {
    await withWorkspace(async (root) => {
      await mkdir(nodePath.join(root, "old/subdir"), { recursive: true });
      await writeFile(
        nodePath.join(root, "old/subdir/unmanaged.txt"),
        "unmanaged\n"
      );

      await expect(
        applyWorkspaceTransaction(root, {
          deletes: ["old/subdir"],
          writes: [{ content: "flat\n", path: "old" }],
        })
      ).rejects.toThrow(
        "delete descendant must be an existing regular file before an ancestor write: old/subdir"
      );

      expect(
        await readFile(nodePath.join(root, "old/subdir/unmanaged.txt"), "utf-8")
      ).toBe("unmanaged\n");
      expect(await readdir(nodePath.join(root, "old"))).toEqual(["subdir"]);
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

  test("restores a file after a failed file-to-directory transition", async () => {
    await withWorkspace(async (root) => {
      const transitionPath = nodePath.join(root, "resource");
      await writeFile(transitionPath, "before\n");

      let transactionFailure: unknown;
      try {
        await applyWorkspaceTransaction(
          root,
          {
            deletes: ["resource"],
            writes: [
              { content: "after\n", path: "resource/page.md" },
              { content: "late\n", path: "zz.txt" },
            ],
          },
          {
            testHooks: {
              beforeApply: (operation) => {
                if (operation.kind === "write" && operation.path === "zz.txt") {
                  throw new Error("injected file-to-directory failure");
                }
              },
            },
          }
        );
      } catch (error) {
        transactionFailure = error;
      }

      expect(transactionFailure).toBeInstanceOf(Error);
      expect(transactionFailure).not.toBeInstanceOf(
        WorkspaceTransactionRollbackError
      );
      expect((transactionFailure as Error).message).toBe(
        "injected file-to-directory failure"
      );
      expect(await readFile(transitionPath, "utf-8")).toBe("before\n");
      await expect(access(nodePath.join(root, "zz.txt"))).rejects.toThrow();
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".skillset-workspace-")
        )
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
