import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const source = await readFile(
  join(root, ".github/workflows/release-wait-diagnostic.yml"),
  "utf8"
);
const workflow = Bun.YAML.parse(source) as {
  permissions: Record<string, string>;
  on: {
    schedule: { cron: string }[];
    workflow_run: { workflows: string[]; types: string[] };
  };
  jobs: {
    observe: {
      name: string;
      if: string;
      steps: { uses?: string; run?: string; with?: Record<string, unknown> }[];
    };
  };
};

test("automatic diagnostics are independent of protected Release serialization", async () => {
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.on.schedule).toEqual([{ cron: "7,22,37,52 * * * *" }]);
  expect(workflow.on.workflow_run.workflows).toEqual(["Release"]);
  expect(workflow.on.workflow_run.types).toContain("completed");
  expect(workflow.jobs.observe.name).not.toBe("check");
  expect(workflow.jobs.observe.name).not.toBe("skillset-ci");
  expect(workflow.jobs.observe.if).toContain(
    "github.event_name != 'pull_request'"
  );
  expect(source).not.toContain("concurrency:");
  expect(source).not.toContain("environment:");
  expect(source).not.toContain("needs:");
  expect(source).not.toContain("publish:packages");
  const checkout = workflow.jobs.observe.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@")
  );
  expect(checkout?.with).toEqual({ ref: "main", "persist-credentials": false });
  expect(
    workflow.jobs.observe.steps.some(
      (step) => step.run === "bun scripts/release-wait-diagnostic.ts"
    )
  ).toBe(true);
  const release = await readFile(
    join(root, ".github/workflows/release.yml"),
    "utf8"
  );
  expect(release).toContain(
    "concurrency: ${{ github.workflow }}-${{ github.ref }}"
  );
  expect(release).not.toContain("release-wait-diagnostic");
});
