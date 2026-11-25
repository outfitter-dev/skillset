/* eslint-disable no-await-in-loop -- Worker barriers and fixture setup are intentionally ordered. */

import { describe, expect, test } from "bun:test";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import nodePath from "node:path";

import {
  DIRECTORY_RENAME_WORKER_FLAG,
  runDirectoryRenameRace,
  runDirectoryRenameWorker,
} from "../../../../scripts/test-helpers/directory-rename-race";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import {
  renameDirectoryNoReplace,
  toWindowsExtendedPath,
} from "../directory-rename-no-replace";

const supportedPlatform = ["darwin", "linux", "win32"].includes(
  process.platform
);
const supportedPlatformTest = test.skipIf(!supportedPlatform);

const withTemporaryDirectory = async (
  operation: (root: string) => Promise<void> | void
): Promise<void> => {
  const root = await createTestFixtureRoot("skillset-directory-rename-");
  await operation(root);
};

const missing = async (path: string): Promise<boolean> =>
  await access(path).then(
    () => false,
    () => true
  );

const workerIndex = process.argv.indexOf(DIRECTORY_RENAME_WORKER_FLAG);

if (import.meta.main && workerIndex !== -1) {
  await runDirectoryRenameWorker(process.argv);
} else {
  describe("atomic no-replace directory rename", () => {
    test("prefixes Windows paths so MoveFileExW can exceed MAX_PATH", () => {
      expect(
        toWindowsExtendedPath("C:\\Users\\alice\\.skillset\\skills\\demo")
      ).toBe("\\\\?\\C:\\Users\\alice\\.skillset\\skills\\demo");
      expect(toWindowsExtendedPath("\\\\server\\share\\skills\\demo")).toBe(
        "\\\\?\\UNC\\server\\share\\skills\\demo"
      );
      expect(toWindowsExtendedPath("\\\\?\\C:\\Users\\alice\\demo")).toBe(
        "\\\\?\\C:\\Users\\alice\\demo"
      );
    });

    supportedPlatformTest(
      "installs when the destination exceeds the Windows MAX_PATH limit",
      async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = nodePath.join(root, "source");
          await mkdir(sourcePath);
          await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");

          let destParent = root;
          while (nodePath.join(destParent, "destination").length < 280) {
            destParent = nodePath.join(destParent, "nested-directory-segment");
          }
          await mkdir(destParent, { recursive: true });
          const destinationPath = nodePath.join(destParent, "destination");

          expect(renameDirectoryNoReplace(sourcePath, destinationPath)).toEqual(
            {
              kind: "installed",
            }
          );
          expect(await missing(sourcePath)).toBe(true);
          expect(
            await readFile(
              nodePath.join(destinationPath, "marker.txt"),
              "utf-8"
            )
          ).toBe("source\n");
        });
      }
    );

    supportedPlatformTest(
      "installs when the destination is absent",
      async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = nodePath.join(root, "source");
          const destinationPath = nodePath.join(root, "destination");
          await mkdir(sourcePath);
          await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");

          expect(renameDirectoryNoReplace(sourcePath, destinationPath)).toEqual(
            {
              kind: "installed",
            }
          );
          expect(await missing(sourcePath)).toBe(true);
          expect(
            await readFile(
              nodePath.join(destinationPath, "marker.txt"),
              "utf-8"
            )
          ).toBe("source\n");
        });
      }
    );

    supportedPlatformTest(
      "reports occupied without changing either directory",
      async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = nodePath.join(root, "source");
          const destinationPath = nodePath.join(root, "destination");
          await mkdir(sourcePath);
          await mkdir(destinationPath);
          await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");
          await writeFile(
            nodePath.join(destinationPath, "marker.txt"),
            "destination\n"
          );

          expect(renameDirectoryNoReplace(sourcePath, destinationPath)).toEqual(
            {
              kind: "occupied",
            }
          );
          expect(
            await readFile(nodePath.join(sourcePath, "marker.txt"), "utf-8")
          ).toBe("source\n");
          expect(
            await readFile(
              nodePath.join(destinationPath, "marker.txt"),
              "utf-8"
            )
          ).toBe("destination\n");
        });
      }
    );

    supportedPlatformTest(
      "reports occupied for an empty destination directory",
      async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = nodePath.join(root, "source");
          const destinationPath = nodePath.join(root, "destination");
          await mkdir(sourcePath);
          await mkdir(destinationPath);
          await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");

          expect(renameDirectoryNoReplace(sourcePath, destinationPath)).toEqual(
            {
              kind: "occupied",
            }
          );
          expect(await readdir(destinationPath)).toEqual([]);
          expect(
            await readFile(nodePath.join(sourcePath, "marker.txt"), "utf-8")
          ).toBe("source\n");
        });
      }
    );

    supportedPlatformTest(
      "reports occupied for a file destination without replacing it",
      async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = nodePath.join(root, "source");
          const destinationPath = nodePath.join(root, "destination");
          await mkdir(sourcePath);
          await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");
          await writeFile(destinationPath, "keep-file\n");

          expect(renameDirectoryNoReplace(sourcePath, destinationPath)).toEqual(
            {
              kind: "occupied",
            }
          );
          expect(await readFile(destinationPath, "utf-8")).toBe("keep-file\n");
          expect(
            await readFile(nodePath.join(sourcePath, "marker.txt"), "utf-8")
          ).toBe("source\n");
        });
      }
    );

    supportedPlatformTest(
      "reports occupied for a symlink destination without following it",
      async () => {
        await withTemporaryDirectory(async (root) => {
          const sourcePath = nodePath.join(root, "source");
          const destinationPath = nodePath.join(root, "destination");
          const linkedPath = nodePath.join(root, "linked");
          await mkdir(sourcePath);
          await mkdir(linkedPath);
          await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");
          await writeFile(nodePath.join(linkedPath, "keep.txt"), "linked\n");
          await symlink(linkedPath, destinationPath);

          expect(renameDirectoryNoReplace(sourcePath, destinationPath)).toEqual(
            {
              kind: "occupied",
            }
          );
          expect(await lstat(destinationPath).then((entry) => entry.isSymbolicLink())).toBe(
            true
          );
          expect(await readFile(nodePath.join(linkedPath, "keep.txt"), "utf-8")).toBe(
            "linked\n"
          );
          expect(
            await readFile(nodePath.join(sourcePath, "marker.txt"), "utf-8")
          ).toBe("source\n");
        });
      }
    );

    supportedPlatformTest(
      "throws an actionable native error for operational failures",
      async () => {
        await withTemporaryDirectory((root) => {
          expect(() =>
            renameDirectoryNoReplace(
              nodePath.join(root, "missing-source"),
              nodePath.join(root, "destination")
            )
          ).toThrow(/atomic directory rename failed with native code/u);
        });
      }
    );

    supportedPlatformTest(
      "allows exactly one winner across competing Bun processes",
      async () => {
        await withTemporaryDirectory(async (root) => {
          await runDirectoryRenameRace(root, [
            process.execPath,
            import.meta.path,
          ]);
        });
      }
    );
  });
}
