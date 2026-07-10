import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Workflow = {
  jobs?: Record<string, {
    permissions?: Record<string, string>;
    steps?: Array<{ name?: string; run?: string }>;
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
  test("CI exposes an explicit dispatch path for bot-authored release heads", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow.on?.workflow_dispatch).toEqual({});
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
