/* eslint-disable no-await-in-loop -- Worker barriers and fixture setup are intentionally ordered. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { renameDirectoryNoReplace } from "@skillset/core/internal/directory-rename-no-replace";

import { importSource } from "../import";

const WORKER_FLAG = "--import-no-replace-worker";
const supportedPlatform = ["darwin", "linux", "win32"].includes(process.platform);

const withTemporaryDirectory = async (
  operation: (root: string) => Promise<void>
): Promise<void> => {
  const root = await createTestFixtureRoot("skillset-import-no-replace-");
  await operation(root);
};

const missing = async (path: string): Promise<boolean> =>
  await lstat(path).then(
    () => false,
    () => true
  );

const writeSkill = async (directory: string, name: string, body: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} import.\n---\n\n${body}\n`
  );
};

const leftoverStaging = async (skillsDir: string, name: string): Promise<string[]> => {
  try {
    return (await readdir(skillsDir)).filter((entry) => entry.startsWith(`.${name}.tmp-`));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
};

type OccupantCase = {
  readonly name: string;
  readonly occupy: (targetPath: string, root: string) => Promise<void>;
  readonly assertPreserved: (targetPath: string, root: string) => Promise<void>;
};

const preexistingOccupants: OccupantCase[] = [
  {
    name: "empty directory",
    occupy: async (targetPath) => {
      await mkdir(targetPath, { recursive: true });
    },
    assertPreserved: async (targetPath) => {
      expect((await lstat(targetPath)).isDirectory()).toBe(true);
      expect(await readdir(targetPath)).toEqual([]);
    },
  },
  {
    name: "nonempty directory",
    occupy: async (targetPath) => {
      await mkdir(targetPath, { recursive: true });
      await writeFile(join(targetPath, "keep.md"), "winner\n");
    },
    assertPreserved: async (targetPath) => {
      expect(await readFile(join(targetPath, "keep.md"), "utf-8")).toBe("winner\n");
    },
  },
  {
    name: "file",
    occupy: async (targetPath) => {
      await mkdir(join(targetPath, ".."), { recursive: true });
      await writeFile(targetPath, "keep-file\n");
    },
    assertPreserved: async (targetPath) => {
      expect((await lstat(targetPath)).isFile()).toBe(true);
      expect(await readFile(targetPath, "utf-8")).toBe("keep-file\n");
    },
  },
  {
    name: "symlink",
    occupy: async (targetPath, root) => {
      const linked = join(root, "linked");
      await mkdir(linked);
      await writeFile(join(linked, "keep.txt"), "linked\n");
      await mkdir(join(targetPath, ".."), { recursive: true });
      await symlink(linked, targetPath);
    },
    assertPreserved: async (targetPath, root) => {
      expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(root, "linked/keep.txt"), "utf-8")).toBe("linked\n");
    },
  },
  {
    name: "dangling symlink",
    occupy: async (targetPath, root) => {
      await mkdir(join(targetPath, ".."), { recursive: true });
      await symlink(join(root, "missing-target"), targetPath);
    },
    assertPreserved: async (targetPath, root) => {
      expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);
      expect(await missing(join(root, "missing-target"))).toBe(true);
    },
  },
];

const lateOccupants: OccupantCase[] = [
  {
    name: "empty directory",
    occupy: async (targetPath) => {
      await mkdir(targetPath, { recursive: true });
    },
    assertPreserved: async (targetPath) => {
      expect((await lstat(targetPath)).isDirectory()).toBe(true);
      expect(await readdir(targetPath)).toEqual([]);
    },
  },
  {
    name: "nonempty directory",
    occupy: async (targetPath) => {
      await mkdir(targetPath, { recursive: true });
      await writeFile(join(targetPath, "keep.md"), "late-winner\n");
    },
    assertPreserved: async (targetPath) => {
      expect(await readFile(join(targetPath, "keep.md"), "utf-8")).toBe("late-winner\n");
    },
  },
  {
    name: "file",
    occupy: async (targetPath) => {
      await writeFile(targetPath, "late-file\n");
    },
    assertPreserved: async (targetPath) => {
      expect((await lstat(targetPath)).isFile()).toBe(true);
      expect(await readFile(targetPath, "utf-8")).toBe("late-file\n");
    },
  },
  {
    name: "symlink",
    occupy: async (targetPath, root) => {
      const linked = join(root, "late-linked");
      await mkdir(linked);
      await writeFile(join(linked, "keep.txt"), "late-linked\n");
      await symlink(linked, targetPath);
    },
    assertPreserved: async (targetPath, root) => {
      expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(root, "late-linked/keep.txt"), "utf-8")).toBe("late-linked\n");
    },
  },
];

const workerIndex = process.argv.indexOf(WORKER_FLAG);

if (import.meta.main && workerIndex !== -1) {
  const [rootPath, sourcePath, readyPath, gatePath] = process.argv.slice(workerIndex + 1);
  if (!(rootPath && sourcePath && readyPath && gatePath)) {
    throw new Error("import no-replace test worker is missing an argument");
  }
  await writeFile(readyPath, "ready\n");
  while (await missing(gatePath)) {
    await Bun.sleep(1);
  }
  try {
    const report = await importSource({
      kind: "skill",
      rootPath,
      sourcePath,
      testHooks: {
        beforeClaim: async () => {
          await writeFile(join(rootPath, `claimed-${process.pid}`), "claim\n");
          const claimGate = join(rootPath, "claim-gate");
          while (await missing(claimGate)) {
            const claimed = (await readdir(rootPath)).filter((entry) =>
              entry.startsWith("claimed-")
            );
            if (claimed.length >= 2) {
              await writeFile(claimGate, "go\n");
              break;
            }
            await Bun.sleep(1);
          }
        },
      },
    });
    process.stdout.write(JSON.stringify({ kind: "installed", targetPath: report.targetPath }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ kind: "occupied", message }));
  }
} else {
  describe("import source directory no-replace claim", () => {
    test("fails closed when atomic no-replace rename is unsupported", async () => {
      await withTemporaryDirectory(async (root) => {
        const sourcePath = join(root, "external");
        const targetPath = join(root, ".skillset/skills/demo");
        await writeSkill(sourcePath, "demo", "imported body");

        await expect(
          importSource({
            kind: "skill",
            rootPath: root,
            sourcePath,
            testHooks: {
              renameDirectory: () => ({
                kind: "unsupported",
                reason: "probe filesystem lacks renameat2",
              }),
            },
          })
        ).rejects.toThrow(
          /cannot atomically install import target .*probe filesystem lacks renameat2.*supported local filesystem/u
        );
        expect(await missing(targetPath)).toBe(true);
        expect(await leftoverStaging(join(root, ".skillset/skills"), "demo")).toEqual([]);
      });
    });

    describe.skipIf(!supportedPlatform)("on hosts with atomic no-replace rename", () => {
      test("installs when the destination is absent", async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = join(root, "external");
          await writeSkill(sourcePath, "demo", "imported body");

          const report = await importSource({
            kind: "skill",
            rootPath: root,
            sourcePath,
          });

          expect(report.targetPath).toBe(join(root, ".skillset/skills/demo"));
          expect(await readFile(join(report.targetPath, "SKILL.md"), "utf-8")).toContain(
            "imported body"
          );
          expect(await leftoverStaging(join(root, ".skillset/skills"), "demo")).toEqual([]);
        });
      });

      test("preserves a replacement when baseline seeding fails after the claim", async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = join(root, "external");
          const targetPath = join(root, ".skillset/skills/demo");
          const replacement = "---\nname: \"\n---\n\nreplacement winner\n";
          await writeSkill(sourcePath, "demo", "imported body");
          await writeFile(join(root, "skillset.yaml"), "skillset:\n  name: test-root\n  version: 1.0.0\n");

          await expect(
            importSource({
              kind: "skill",
              rootPath: root,
              sourcePath,
              testHooks: {
                renameDirectory: (stagingPath, destinationPath) => {
                  const result = renameDirectoryNoReplace(stagingPath, destinationPath);
                  if (result.kind === "installed") {
                    rmSync(destinationPath, { force: true, recursive: true });
                    mkdirSync(destinationPath);
                    writeFileSync(join(destinationPath, "SKILL.md"), replacement);
                  }
                  return result;
                },
              },
            })
          ).rejects.toThrow("remove it and rerun only if it is the intended import");
          expect(await readFile(join(targetPath, "SKILL.md"), "utf-8")).toBe(replacement);
          expect(await leftoverStaging(join(root, ".skillset/skills"), "demo")).toEqual([]);
        });
      });

      test.each(preexistingOccupants)(
        "refuses a pre-existing $name without replacing or following it",
        async ({ assertPreserved, occupy }) => {
          await withTemporaryDirectory(async (root) => {
            const sourcePath = join(root, "external");
            const targetPath = join(root, ".skillset/skills/demo");
            await writeSkill(sourcePath, "demo", "imported body");
            await occupy(targetPath, root);

            await expect(
              importSource({
                kind: "skill",
                rootPath: root,
                sourcePath,
              })
            ).rejects.toThrow("Import never overwrites");
            await assertPreserved(targetPath, root);
            expect(await leftoverStaging(join(root, ".skillset/skills"), "demo")).toEqual([]);
          });
        }
      );

      test.each(lateOccupants)(
        "refuses a late $name that appears before the claim without replacing or following it",
        async ({ assertPreserved, occupy }) => {
          await withTemporaryDirectory(async (root) => {
            const sourcePath = join(root, "external");
            const targetPath = join(root, ".skillset/skills/demo");
            await writeSkill(sourcePath, "demo", "imported body");

            await expect(
              importSource({
                kind: "skill",
                rootPath: root,
                sourcePath,
                testHooks: {
                  beforeClaim: async () => {
                    await occupy(targetPath, root);
                  },
                },
              })
            ).rejects.toThrow("Import never overwrites");
            await assertPreserved(targetPath, root);
            expect(await leftoverStaging(join(root, ".skillset/skills"), "demo")).toEqual([]);
          });
        }
      );

      test("allows exactly one winner across competing Bun processes", async () => {
        await withTemporaryDirectory(async (root) => {
          const destinationPath = join(root, ".skillset/skills/demo");
          const gatePath = join(root, "gate");
          const children = ["a", "b"].map((name) => {
            const sourcePath = join(root, `source-${name}`);
            const readyPath = join(root, `ready-${name}`);
            return { name, readyPath, sourcePath };
          });
          for (const child of children) {
            await writeSkill(child.sourcePath, "demo", `${child.name} body`);
          }

          const processes = children.map((child) =>
            Bun.spawn(
              [
                process.execPath,
                import.meta.path,
                WORKER_FLAG,
                root,
                child.sourcePath,
                child.readyPath,
                gatePath,
              ],
              { stderr: "pipe", stdout: "pipe" }
            )
          );
          while (
            await Promise.all(children.map((child) => missing(child.readyPath))).then((states) =>
              states.some(Boolean)
            )
          ) {
            await Bun.sleep(1);
          }
          await writeFile(gatePath, "go\n");

          const results = await Promise.all(
            processes.map(async (childProcess) => {
              const [exitCode, stdout, stderr] = await Promise.all([
                childProcess.exited,
                new Response(childProcess.stdout).text(),
                new Response(childProcess.stderr).text(),
              ]);
              expect(stderr).toBe("");
              expect(exitCode).toBe(0);
              return JSON.parse(stdout) as {
                readonly kind: "installed" | "occupied";
                readonly message?: string;
              };
            })
          );

          expect(results.map((result) => result.kind).toSorted()).toEqual([
            "installed",
            "occupied",
          ]);
          const occupied = results.find((result) => result.kind === "occupied");
          expect(occupied?.message).toContain("Import never overwrites");
          const winnerBody = await readFile(join(destinationPath, "SKILL.md"), "utf-8");
          expect(winnerBody).toMatch(/^[ab] body$/m);
          expect(await leftoverStaging(join(root, ".skillset/skills"), "demo")).toEqual([]);
        });
      });
    });
  });
}
