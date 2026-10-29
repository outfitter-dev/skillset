/* eslint-disable no-await-in-loop -- Barriers and fixture setup are intentionally ordered. */

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { renameDirectoryNoReplace } from "../packages/core/src/directory-rename-no-replace";
import type { DirectoryRenameNoReplaceResult } from "../packages/core/src/directory-rename-no-replace";

import { getNativeTarget } from "./native-targets";
import {
  DIRECTORY_RENAME_WORKER_FLAG,
  runDirectoryRenameRace,
  runDirectoryRenameWorker,
} from "./test-helpers/directory-rename-race";

const RUN_FLAG = "--directory-rename-packaged-run";

const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(
      `skillset: packaged directory rename smoke failed: ${message}`
    );
  }
};

const readMarker = async (directoryPath: string): Promise<string> =>
  await readFile(nodePath.join(directoryPath, "marker.txt"), "utf-8");

const assertOccupied = (
  result: DirectoryRenameNoReplaceResult,
  fixture: string
): void => {
  requireCondition(
    result.kind === "occupied",
    `${fixture} returned ${result.kind}`
  );
};

const runChild = async (
  argv: readonly string[],
  options: { readonly allowStderr?: boolean } = {}
): Promise<string> => {
  const child = Bun.spawn(argv, { stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `skillset: packaged directory rename child failed (${exitCode}):\n${stdout}${stderr}`
    );
  }
  if (options.allowStderr !== true) {
    requireCondition(stderr === "", `child wrote stderr: ${stderr}`);
  }
  return stdout;
};

const runOccupiedFixtures = async (root: string): Promise<void> => {
  for (const shape of ["file", "directory", "symlink"] as const) {
    const sourcePath = nodePath.join(root, `${shape}-source`);
    const destinationPath = nodePath.join(root, `${shape}-destination`);
    await mkdir(sourcePath);
    await writeFile(nodePath.join(sourcePath, "marker.txt"), "source\n");

    if (shape === "file") {
      await writeFile(destinationPath, "destination\n");
    } else if (shape === "directory") {
      await mkdir(destinationPath);
      await writeFile(
        nodePath.join(destinationPath, "marker.txt"),
        "destination\n"
      );
    } else {
      const targetPath = nodePath.join(root, "symlink-target");
      await mkdir(targetPath);
      await writeFile(nodePath.join(targetPath, "marker.txt"), "destination\n");
      await symlink(
        targetPath,
        destinationPath,
        process.platform === "win32" ? "junction" : "dir"
      );
    }

    assertOccupied(
      renameDirectoryNoReplace(sourcePath, destinationPath),
      shape
    );
    const sourceMarker = await readMarker(sourcePath);
    requireCondition(sourceMarker === "source\n", `${shape} consumed source`);
    if (shape === "file") {
      const destinationContents = await readFile(destinationPath, "utf-8");
      requireCondition(
        destinationContents === "destination\n",
        "file destination changed"
      );
    } else {
      const destinationMarker = await readMarker(destinationPath);
      requireCondition(
        destinationMarker === "destination\n",
        `${shape} destination changed`
      );
    }
    if (shape === "symlink") {
      const destinationStats = await lstat(destinationPath);
      requireCondition(
        destinationStats.isSymbolicLink(),
        "symlink was replaced"
      );
    }
  }
};

const runPackagedScenarios = async (): Promise<void> => {
  const root = await mkdtemp(
    nodePath.join(tmpdir(), "skillset-packaged-rename-run-")
  );
  try {
    await runOccupiedFixtures(root);
    await runDirectoryRenameRace(root, [process.execPath]);
    console.log(
      `skillset: packaged directory rename smoke passed (${process.platform} ${process.arch})`
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const childEnvironmentWithoutBun = (
  emptyPath: string
): Record<string, string> => {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0].toLowerCase() !== "path"
    )
  );
  environment.PATH = emptyPath;
  return environment;
};

const runPackagedExecutable = async (): Promise<void> => {
  const root = await mkdtemp(
    nodePath.join(tmpdir(), "skillset-packaged-rename-build-")
  );
  const executablePath = nodePath.join(
    root,
    process.platform === "win32"
      ? "directory-rename-smoke.exe"
      : "directory-rename-smoke"
  );
  try {
    await runChild(
      [
        process.execPath,
        "build",
        "--compile",
        "--minify",
        import.meta.path,
        "--outfile",
        executablePath,
      ],
      { allowStderr: true }
    );
    if (process.platform === "darwin") {
      // Build-only helpers read repository metadata; compiled workers must not load them.
      const { adHocSignDarwinExecutable } = await import("./native-artifacts");
      await adHocSignDarwinExecutable(
        getNativeTarget(`darwin-${process.arch}`),
        executablePath
      );
    }
    const emptyPath = nodePath.join(root, "empty-path");
    await mkdir(emptyPath);
    const child = Bun.spawn([executablePath, RUN_FLAG], {
      env: childEnvironmentWithoutBun(emptyPath),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `skillset: packaged directory rename executable failed (${exitCode}):\n${stdout}${stderr}`
      );
    }
    requireCondition(
      stderr === "",
      `packaged executable wrote stderr: ${stderr}`
    );
    process.stdout.write(stdout);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

if (import.meta.main) {
  if (process.argv.includes(DIRECTORY_RENAME_WORKER_FLAG)) {
    await runDirectoryRenameWorker(process.argv);
  } else if (process.argv.includes(RUN_FLAG)) {
    await runPackagedScenarios();
  } else {
    await runPackagedExecutable();
  }
}
