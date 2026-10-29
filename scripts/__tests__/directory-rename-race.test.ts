import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import {
  runDirectoryRenameRace,
  runDirectoryRenameWorker,
} from "../test-helpers/directory-rename-race";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import { expectProcessGone } from "../test-helpers/process";

const faultWorker = `
import { mkdir, rm, writeFile } from "node:fs/promises";
const mode = process.argv[2];
const [source, destination, ready, gate] = process.argv.slice(4);
await writeFile(ready + ".pid", String(process.pid));
if (mode === "before-ready") await new Promise(() => { setInterval(() => {}, 1000); });
await writeFile(ready, "ready\\n");
while (!(await Bun.file(gate).exists())) await Bun.sleep(1);
if (mode === "after-gate") await new Promise(() => { setInterval(() => {}, 1000); });
if (mode === "invalid-json") { console.log("not-json"); process.exit(0); }
if (mode === "stderr") { console.error("unexpected warning"); process.exit(0); }
if (mode === "wrong-results") { console.log('{"kind":"installed"}'); process.exit(0); }
// A plausible result pair must still prove the matching on-disk winner and loser.
const name = source.endsWith("-a") ? "a" : "b";
if (name === "a") {
  await mkdir(destination);
  await writeFile(destination + "/marker.txt", mode === "bad-marker" ? "invalid" : "a\\n");
}
if (name === "a" && mode !== "retained-winner") await rm(source, { recursive: true });
if (mode === "changed-loser" && name === "b") await writeFile(source + "/marker.txt", "changed");
console.log(JSON.stringify({ kind: (name === "a") !== (mode === "swapped-results") ? "installed" : "occupied" }));
`;

for (const [mode, message] of [
  ["before-ready", "workers at ready barrier"],
  ["after-gate", "workers to exit"],
  ["invalid-json", "JSON"],
  ["stderr", "worker wrote stderr"],
  ["wrong-results", "expected installed,occupied"],
  ["bad-marker", "unexpected installed marker"],
  ["retained-winner", "winning source was not consumed"],
  ["changed-loser", "losing source marker changed"],
  ["swapped-results", "installed result does not identify the winning marker"],
] as const) {
  test(`race rejects ${mode} and reaps both owned workers`, async () => {
    const root = await createTestFixtureRoot("skillset-rename-race-fault-");
    const entry = nodePath.join(root, "fault-worker.ts");
    await writeFile(entry, faultWorker);
    await expect(
      runDirectoryRenameRace(root, [process.execPath, entry, mode], {
        timeoutMs: 500,
      })
    ).rejects.toThrow(message);
    for (const name of ["a", "b"]) {
      const pid = Number(
        await readFile(nodePath.join(root, `race-ready-${name}.pid`), "utf-8")
      );
      await expectProcessGone(pid);
    }
  });
}

test("worker rejects an incomplete protocol before creating ready state", async () => {
  await expect(
    runDirectoryRenameWorker(["--directory-rename-race-worker"])
  ).rejects.toThrow("missing an argument");
});
