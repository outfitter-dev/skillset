import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  spikeOptions,
  testScript,
  verifyRuntimeArchive,
} from "../dagger-spike";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

const args = [
  "--bundle",
  "/bundle",
  "--revision",
  "a".repeat(40),
  "--image",
  `example@sha256:${"b".repeat(64)}`,
  "--platform",
  "linux/arm64",
  "--out",
  "/out",
  "--mode",
  "serial",
];

test("Dagger spike rejects floating images, implicit architecture and shards without provenance", () => {
  expect(() =>
    spikeOptions(
      args.map((arg) => (arg.includes("sha256") ? "bun:latest" : arg))
    )
  ).toThrow("digest");
  expect(() =>
    spikeOptions(args.map((arg) => (arg === "linux/arm64" ? "auto" : arg)))
  ).toThrow("platform");
  expect(() =>
    spikeOptions(args.map((arg) => (arg === "serial" ? "sharded" : arg)))
  ).toThrow("reference");
});

test("Dagger spike preserves the native manifest, timeout and frozen shard timing contract", () => {
  const serial = testScript("serial", false);
  expect(serial).toContain(
    "git ls-files -z 'apps/**/*.test.ts' 'packages/**/*.test.ts' 'scripts/**/*.test.ts'"
  );
  expect(serial).toContain("--timeout 15000");
  expect(serial).toContain("--update-timings");
  expect(testScript("serial", true)).not.toContain("--update-timings");
  const shards = testScript("sharded", true);
  expect(shards).toContain("scripts/test-shards.ts");
  expect(shards).toContain("--shards 2");
  expect(shards).not.toContain("--no-orphans");
});

test("an inherited Dagger session cannot bypass the outer command verdict", () => {
  const result = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "../dagger-spike.ts"), ...args],
    {
      env: {
        ...process.env,
        DAGGER_SESSION_PORT: "12345",
        DAGGER_SESSION_TOKEN: "unused",
        SKILLSET_DAGGER_SPIKE_CHILD: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain(
    "outside an existing Dagger API session"
  );
});

test("saved runtime metadata must match the Docker image identity and platform", async () => {
  const root = await createTestFixtureRoot("skillset-dagger-runtime-");
  const config = JSON.stringify({ os: "linux", architecture: "arm64" });
  const hash = createHash("sha256").update(config).digest("hex");
  const configFile = `${hash}.json`;
  await writeFile(join(root, configFile), config);
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify([{ Config: configFile }])
  );
  const archive = join(root, "runtime.tar");
  const packed = Bun.spawnSync(
    ["tar", "-cf", archive, "-C", root, "manifest.json", configFile],
    { stdout: "pipe", stderr: "pipe" }
  );
  expect(packed.exitCode).toBe(0);
  expect(() =>
    verifyRuntimeArchive(archive, `sha256:${hash}`, "linux/arm64")
  ).not.toThrow();
  expect(() =>
    verifyRuntimeArchive(archive, `sha256:${"0".repeat(64)}`, "linux/arm64")
  ).toThrow("digest differs");
  expect(() =>
    verifyRuntimeArchive(archive, `sha256:${hash}`, "linux/amd64")
  ).toThrow("platform differs");
});
