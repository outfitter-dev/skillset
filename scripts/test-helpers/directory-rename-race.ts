/* eslint-disable no-await-in-loop -- Race fixtures and barriers are intentionally ordered. */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import { renameDirectoryNoReplace } from "../../packages/core/src/directory-rename-no-replace";
import { reapOwnedProcess, waitForCondition, waitForPath } from "./wait";

export const DIRECTORY_RENAME_WORKER_FLAG = "--directory-rename-race-worker";

const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`directory rename race failed: ${message}`);
};

/** Shared by the source test worker and the Bun-compiled smoke worker. */
export async function runDirectoryRenameWorker(
  argv: readonly string[]
): Promise<void> {
  const index = argv.indexOf(DIRECTORY_RENAME_WORKER_FLAG);
  const [source, destination, ready, gate] = argv.slice(index + 1);
  if (index === -1 || !(source && destination && ready && gate)) {
    throw new Error("directory rename race worker is missing an argument");
  }
  await writeFile(ready, "ready\n");
  // Both workers poll at 1 ms so their native renames compete after release.
  await waitForPath(gate, "directory-rename race gate", { intervalMs: 1 });
  process.stdout.write(
    JSON.stringify(renameDirectoryNoReplace(source, destination))
  );
}

/** Runs the same protocol and preservation assertions for source and compiled workers. */
export async function runDirectoryRenameRace(
  root: string,
  workerCommand: readonly string[],
  options: { readonly timeoutMs?: number } = {}
): Promise<void> {
  const destination = nodePath.join(root, "race-destination");
  const gate = nodePath.join(root, "race-gate");
  const workers = ["a", "b"].map((name) => ({
    name,
    source: nodePath.join(root, `race-source-${name}`),
    ready: nodePath.join(root, `race-ready-${name}`),
  }));
  for (const worker of workers) {
    await mkdir(worker.source);
    await writeFile(
      nodePath.join(worker.source, "marker.txt"),
      `${worker.name}\n`
    );
  }

  const children: Bun.Subprocess<"ignore", "pipe", "pipe">[] = [];
  const outputs: Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>[] = [];
  try {
    for (const worker of workers) {
      const child = Bun.spawn(
        [
          ...workerCommand,
          DIRECTORY_RENAME_WORKER_FLAG,
          worker.source,
          destination,
          worker.ready,
          gate,
        ],
        { stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );
      children.push(child);
      // Drain immediately, including on a barrier failure, to avoid pipe backpressure.
      outputs.push(
        Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]).then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }))
      );
    }
    await waitForCondition(
      "directory-rename workers at ready barrier",
      async () => {
        const ready = await Promise.all(
          workers.map((worker) => Bun.file(worker.ready).exists())
        );
        for (const [index, child] of children.entries()) {
          requireCondition(
            child.exitCode === null || ready[index] === true,
            `worker ${workers[index]?.name} exited before ready barrier (${child.exitCode})`
          );
        }
        return ready.every(Boolean);
      },
      options
    );
    await writeFile(gate, "go\n");
    await waitForCondition(
      "directory-rename workers to exit",
      () =>
        children.every(
          (child) => child.exitCode !== null || child.signalCode !== null
        ),
      options
    );
    const results = await Promise.all(outputs);
    const kinds = results.map((result, index) => {
      requireCondition(
        result.exitCode === 0,
        `worker ${workers[index]?.name} exited ${result.exitCode}: ${result.stderr}`
      );
      requireCondition(
        result.stderr === "",
        `worker wrote stderr: ${result.stderr}`
      );
      return (JSON.parse(result.stdout) as { kind?: unknown }).kind;
    });
    requireCondition(
      kinds.toSorted().join(",") === "installed,occupied",
      `expected installed,occupied; received ${kinds.join(",")}`
    );

    const marker = await readFile(
      nodePath.join(destination, "marker.txt"),
      "utf-8"
    );
    requireCondition(
      marker === "a\n" || marker === "b\n",
      `unexpected installed marker ${marker}`
    );
    const winner = marker.trim();
    const loser = workers.find((worker) => worker.name !== winner)!;
    const winningSource = workers.find((worker) => worker.name === winner)!;
    requireCondition(
      await access(winningSource.source).then(
        () => false,
        () => true
      ),
      "winning source was not consumed"
    );
    requireCondition(
      (await readFile(nodePath.join(loser.source, "marker.txt"), "utf-8")) ===
        `${loser.name}\n`,
      "losing source marker changed"
    );
    requireCondition(
      kinds[workers.indexOf(winningSource)] === "installed",
      "installed result does not identify the winning marker"
    );
  } finally {
    await Promise.all(children.map((child) => reapOwnedProcess(child)));
    await Promise.all(outputs);
  }
}
