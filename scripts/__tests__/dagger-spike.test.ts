import { expect, test } from "bun:test";

import { spikeOptions, testScript } from "../dagger-spike";

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
