import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface Step {
  env?: Record<string, string>;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
  on?: {
    release?: { types?: string[] };
    workflow_call?: unknown;
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
}

const root = path.join(import.meta.dir, "..", "..");
const homebrewTapToken = `\${{ secrets.HOMEBREW_TAP_TOKEN }}`;

const readWorkflow = async (name: string): Promise<Workflow> =>
  Bun.YAML.parse(
    await readFile(path.join(root, ".github", "workflows", name), "utf-8")
  ) as Workflow;

describe("SET-422 release workflow contract", () => {
  test("validates a published release and renders before checking out the tap", async () => {
    const workflow = await readWorkflow("publish-homebrew.yml");
    const steps = workflow.jobs?.handoff?.steps ?? [];
    const validateIndex = steps.findIndex(
      (step) =>
        step.name === "Validate published release assets before tap checkout"
    );
    const renderIndex = steps.findIndex(
      (step) => step.name === "Render formula from immutable release assets"
    );
    const tapIndex = steps.findIndex(
      (step) => step.name === "Check out Homebrew tap"
    );
    const tokenIndex = steps.findIndex(
      (step) => step.name === "Verify tap token"
    );
    const pullRequest = steps.find(
      (step) => step.name === "Open or update Homebrew tap pull request"
    );

    expect(workflow.on?.release?.types).toEqual(["published"]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).toHaveProperty("workflow_call");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(validateIndex).toBeGreaterThan(-1);
    expect(renderIndex).toBeGreaterThan(validateIndex);
    expect(tokenIndex).toBeGreaterThan(renderIndex);
    expect(tapIndex).toBeGreaterThan(tokenIndex);
    expect(steps[validateIndex]?.run).toContain("validate-release");
    expect(steps[validateIndex]?.run).toContain("gh release download");
    expect(steps[tapIndex]?.with?.repository).toBe(
      "outfitter-dev/homebrew-tap"
    );
    expect(steps[tapIndex]?.with?.token).toBe(homebrewTapToken);
    expect(pullRequest?.with?.token).toBe(homebrewTapToken);
    expect(pullRequest?.uses).toMatch(
      /^peter-evans\/create-pull-request@[a-f0-9]{40}$/u
    );
    expect(JSON.stringify(workflow)).not.toContain("gh pr merge");
  });
});
