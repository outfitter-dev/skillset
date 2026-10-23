import { expect, test } from "bun:test";
import { join } from "node:path";

import { bucketCwd, classifyProcess, summarize } from "../test-cli-invocations";

const sourceCli = "/repo/apps/skillset/src/cli.ts";
const roots = { repo: "/repo", temp: "/tmp" };

test("SET-625: CLI processes are told apart from other Bun processes", () => {
  expect(classifyProcess({ argv: [], cwd: "/", main: sourceCli }, sourceCli)).toBe("source");
  expect(classifyProcess({ argv: [], cwd: "/", main: "/$bunfs/root/skillset" }, sourceCli)).toBe("compiled");
  expect(classifyProcess({ argv: [], cwd: "/", main: "B:\\~BUN\\root\\skillset.exe" }, sourceCli)).toBe("compiled");
  expect(classifyProcess({ argv: [], cwd: "/", main: "/repo/scripts/test-sandbox.ts" }, sourceCli)).toBe("other");
  expect(classifyProcess({ argv: [], cwd: "/", main: "/$bunfs/root/other-tool" }, sourceCli)).toBe("other");
});

test("SET-625: invocation cwd is bucketed by repository, sandbox, and temp", () => {
  expect(bucketCwd("/repo", roots)).toBe("repo");
  expect(bucketCwd("/repo/apps", roots)).toBe("repo");
  expect(bucketCwd(join("/tmp", "skillset-test-abc", "fixture"), roots)).toBe("sandbox");
  expect(bucketCwd(join("/tmp", "elsewhere"), roots)).toBe("temp");
  expect(bucketCwd("/tmp", roots)).toBe("temp");
  expect(bucketCwd("/home/user", roots)).toBe("other");
});

test("SET-625: a file report counts only CLI processes toward cwd buckets", () => {
  const report = summarize(
    "a.test.ts",
    0,
    12.4,
    [
      { argv: [], cwd: "/repo", main: "/$bunfs/root/skillset" },
      { argv: [], cwd: "/tmp/skillset-test-x", main: "/$bunfs/root/skillset" },
      { argv: [], cwd: "/repo", main: "/repo/a.test.ts" },
    ],
    roots
  );
  expect(report).toEqual({
    cwds: { other: 0, repo: 1, sandbox: 1, temp: 0 },
    durationMs: 12,
    exitCode: 0,
    file: "a.test.ts",
    invocations: { compiled: 2, other: 1, source: 0 },
  });
});
