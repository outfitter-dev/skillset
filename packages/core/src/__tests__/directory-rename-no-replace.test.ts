/* eslint-disable no-await-in-loop -- Worker barriers and fixture setup are intentionally ordered. */

import { describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { renameDirectoryNoReplace } from "../directory-rename-no-replace";
import type { DirectoryRenameNoReplaceResult } from "../directory-rename-no-replace";

const WORKER_FLAG = "--directory-rename-no-replace-worker";
const supportedPlatform = ["darwin", "linux", "win32"].includes(
  process.platform
);
const supportedPlatformTest = test.skipIf(!supportedPlatform);

const withTemporaryDirectory = async (
  operation: (root: string) => Promise<void> | void
): Promise<void> => {
  const root = await mkdtemp(
    nodePath.join(tmpdir(), "skillset-directory-rename-")
  );
  try {
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const missing = async (path: string): Promise<boolean> =>
  await access(path).then(
    () => false,
    () => true
  );

const workerIndex = process.argv.indexOf(WORKER_FLAG);

if (import.meta.main && workerIndex !== -1) {
  const [sourcePath, destinationPath, readyPath, gatePath] = process.argv.slice(
    workerIndex + 1
  );
  if (!(sourcePath && destinationPath && readyPath && gatePath)) {
    throw new Error("directory rename test worker is missing an argument");
  }
  await writeFile(readyPath, "ready\n");
  while (await missing(gatePath)) {
    await Bun.sleep(1);
  }
  process.stdout.write(
    JSON.stringify(renameDirectoryNoReplace(sourcePath, destinationPath))
  );
} else {
  describe("atomic no-replace directory rename", () => {
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
          const destinationPath = nodePath.join(root, "destination");
          const gatePath = nodePath.join(root, "gate");
          const children = ["a", "b"].map((name) => {
            const sourcePath = nodePath.join(root, `source-${name}`);
            const readyPath = nodePath.join(root, `ready-${name}`);
            return { name, readyPath, sourcePath };
          });
          for (const child of children) {
            await mkdir(child.sourcePath);
            await writeFile(
              nodePath.join(child.sourcePath, "marker.txt"),
              `${child.name}\n`
            );
          }

          const processes = children.map((child) =>
            Bun.spawn(
              [
                process.execPath,
                import.meta.path,
                WORKER_FLAG,
                child.sourcePath,
                destinationPath,
                child.readyPath,
                gatePath,
              ],
              { stderr: "pipe", stdout: "pipe" }
            )
          );
          while (
            await Promise.all(
              children.map((child) => missing(child.readyPath))
            ).then((states) => states.some(Boolean))
          ) {
            await Bun.sleep(1);
          }
          await writeFile(gatePath, "go\n");

          const results = await Promise.all(
            processes.map(async (process) => {
              const [exitCode, stdout, stderr] = await Promise.all([
                process.exited,
                new Response(process.stdout).text(),
                new Response(process.stderr).text(),
              ]);
              expect(stderr).toBe("");
              expect(exitCode).toBe(0);
              return JSON.parse(stdout) as DirectoryRenameNoReplaceResult;
            })
          );

          expect(results.map((result) => result.kind).toSorted()).toEqual([
            "installed",
            "occupied",
          ]);
          const marker = await readFile(
            nodePath.join(destinationPath, "marker.txt"),
            "utf-8"
          );
          const winner = marker.trim();
          expect(["a", "b"]).toContain(winner);
          const loser = winner === "a" ? "b" : "a";
          expect(
            await readFile(
              nodePath.join(root, `source-${loser}`, "marker.txt"),
              "utf-8"
            )
          ).toBe(`${loser}\n`);
        });
      }
    );
  });
}
