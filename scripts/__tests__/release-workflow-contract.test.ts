import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Workflow = {
  jobs?: Record<string, {
    permissions?: Record<string, string>;
    steps?: Array<{
      env?: Record<string, string>;
      if?: string;
      name?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;
  }>;
  on?: Record<string, unknown>;
};

const root = join(import.meta.dir, "..", "..");

async function readWorkflow(name: string): Promise<Workflow> {
  return Bun.YAML.parse(
    await readFile(join(root, ".github", "workflows", name), "utf8")
  ) as Workflow;
}

describe("generated release PR workflow contract", () => {
  test("changeset coverage derives the pull request diff from git history", async () => {
    const workflow = await readWorkflow("ci.yml");
    const changeset = workflow.jobs?.changeset;
    const steps = changeset?.steps ?? [];
    const checkout = steps.find((step) => step.uses === "actions/checkout@v5");
    const check = steps.find((step) => step.name === "Check changeset coverage");

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(check?.env?.BASE_SHA).toBe("${{ github.event.pull_request.base.sha }}");
    expect(check?.env?.HEAD_SHA).toBe("${{ github.event.pull_request.head.sha }}");
    expect(check?.run).toContain('git diff --name-status "$BASE_SHA...$HEAD_SHA"');
    expect(check?.run).toContain(
      'bun run changeset:check -- --changed-files "$RUNNER_TEMP/changed-files.txt"'
    );
    expect(steps.map((step) => step.run ?? "").join("\n")).not.toContain("gh api");
    expect(changeset?.permissions?.["pull-requests"]).toBeUndefined();
  });

  test("CI exposes an explicit dispatch path for bot-authored release heads", async () => {
    const workflow = await readWorkflow("ci.yml");
    const steps = workflow.jobs?.["skillset-ci"]?.steps ?? [];
    const releaseCheck = steps.find(
      (step) => step.name === "Check generated release package"
    );
    const sourceCheck = steps.find((step) => step.name === "Run skillset check --ci");

    expect(workflow.on?.workflow_dispatch).toEqual({});
    expect(releaseCheck?.run).toBe("bun scripts/publish.ts check");
    expect(releaseCheck?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(releaseCheck?.if).toContain("refs/heads/changeset-release/main");
    expect(sourceCheck?.if).toContain("github.event_name != 'workflow_dispatch'");
    expect(sourceCheck?.if).toContain("refs/heads/changeset-release/main");
  });

  test("release automation dispatches CI after updating and labeling the version PR", async () => {
    const workflow = await readWorkflow("release.yml");
    const version = workflow.jobs?.version;
    const steps = version?.steps ?? [];
    const labelIndex = steps.findIndex((step) => step.name === "Label version PR");
    const dispatchIndex = steps.findIndex((step) => step.name === "Trigger version PR CI");

    expect(version?.permissions?.actions).toBe("write");
    expect(labelIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(labelIndex);
    expect(steps[dispatchIndex]?.run).toBe(
      "gh workflow run ci.yml --ref changeset-release/main"
    );
  });
});
