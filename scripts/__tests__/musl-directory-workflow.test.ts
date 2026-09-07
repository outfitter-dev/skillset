import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const source = await readFile(
  join(root, ".github/workflows/musl-directory-install.yml"),
  "utf8"
);
const workflow = Bun.YAML.parse(source) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      "runs-on": string;
      "timeout-minutes": number;
      strategy: { matrix: { include: { runner: string; arch: string }[] } };
      steps: { uses?: string; run?: string }[];
    }
  >;
};

test("Alpine directory proof runs on both target architectures without release authority", () => {
  expect(Object.keys(workflow.on).sort()).toEqual([
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  const job = workflow.jobs["directory-install"]!;
  expect(job.strategy.matrix.include).toEqual([
    { runner: "ubuntu-24.04-arm", arch: "arm64" },
    { runner: "ubuntu-24.04", arch: "x64" },
  ]);
  expect(job["runs-on"]).toBe("${{ matrix.runner }}");
  expect(job["timeout-minutes"]).toBe(10);
  expect(source).not.toContain("environment:");
  expect(source).not.toContain("publish:");
});

test("Alpine source and compiled probes use pinned musl bytes and preserve the checkout", () => {
  const run = workflow.jobs["directory-install"]!.steps.map(
    (step) => step.run ?? ""
  ).join("\n");
  expect(run).toContain(
    "oven/bun@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb"
  );
  expect(run).toContain('test "$(bun --version)" = "$(cat .bun-version)"');
  expect(run).toContain('test "$(bun -p process.arch)" = "$EXPECTED_ARCH"');
  expect(run).toContain("target=/workspace,readonly");
  expect(run).toContain(
    "bun test packages/core/src/__tests__/directory-rename-no-replace.test.ts"
  );
  expect(run).toContain(
    'bun test packages/core/src/__tests__/workspace-transaction.test.ts --test-name-pattern "allows exactly one competing directory transaction"'
  );
  expect(run).toContain("bun scripts/native-directory-rename-smoke.ts");
  expect(run).not.toContain("--required");
});
