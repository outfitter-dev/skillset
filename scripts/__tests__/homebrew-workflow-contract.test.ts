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
  environment?: string;
  if?: string;
  needs?: string;
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  secrets?: Record<string, string>;
  steps?: Step[];
  uses?: string;
  with?: Record<string, string>;
}

interface Workflow {
  concurrency?: { "cancel-in-progress"?: boolean; group?: string };
  jobs?: Record<string, Job>;
  on?: {
    release?: { types?: string[] };
    workflow_call?: { inputs?: unknown; secrets?: unknown };
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
}

const root = path.join(import.meta.dir, "..", "..");
const homebrewTapToken = `\${{ secrets.HOMEBREW_TAP_TOKEN }}`;
const releaseOutputTag = `\${{ steps.release.outputs.tag }}`;
const releaseTag = `\${{ needs.github-release.outputs.tag }}`;

const readWorkflow = async (name: string): Promise<Workflow> =>
  Bun.YAML.parse(
    await readFile(path.join(root, ".github", "workflows", name), "utf-8")
  ) as Workflow;

describe("SET-422 release workflow contract", () => {
  test("calls the reusable handoff with the reconciled release tag", async () => {
    const workflow = await readWorkflow("release.yml");
    const release = workflow.jobs?.["github-release"];
    const releaseStep = release?.steps?.find(
      (step) =>
        step.name === "Create or reconcile tag and GitHub release assets"
    );
    const homebrew = workflow.jobs?.homebrew;

    expect(release?.outputs?.channel).toBe(
      `\${{ steps.release.outputs.channel }}`
    );
    expect(release?.outputs?.tag).toBe(releaseOutputTag);
    expect(releaseStep?.run).toContain(
      'echo "channel=$DIST_TAG" >> "$GITHUB_OUTPUT"'
    );
    expect(releaseStep?.run).toContain('echo "tag=$tag" >> "$GITHUB_OUTPUT"');
    expect(homebrew?.needs).toBe("github-release");
    expect(homebrew?.if).toContain(
      "needs.github-release.outputs.channel == 'latest'"
    );
    expect(homebrew?.uses).toBe("./.github/workflows/publish-homebrew.yml");
    expect(homebrew?.permissions).toEqual({
      attestations: "read",
      contents: "read",
    });
    expect(homebrew?.with?.tag).toBe(releaseTag);
    expect(homebrew?.secrets).toBeUndefined();
  });

  test("validates a published release and renders before checking out the tap", async () => {
    const workflow = await readWorkflow("publish-homebrew.yml");
    const jobs = workflow.jobs as Record<string, Job>;
    const handoff = jobs.handoff as Job;
    const steps = handoff.steps ?? [];
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
    expect(workflow.permissions).toEqual({
      attestations: "read",
      contents: "read",
    });
    expect(workflow.concurrency).toEqual({
      "cancel-in-progress": false,
      group: "homebrew-skillset",
    });
    expect(workflow.on?.workflow_call?.secrets).toBeUndefined();
    expect(handoff.environment).toBe("homebrew");
    expect(handoff.if).toContain("github.event.release.prerelease == false");
    expect(validateIndex).toBeGreaterThan(-1);
    expect(renderIndex).toBeGreaterThan(validateIndex);
    expect(tokenIndex).toBeGreaterThan(renderIndex);
    expect(tapIndex).toBeGreaterThan(tokenIndex);
    const validateStep = steps[validateIndex] as Step;
    const tapStep = steps[tapIndex] as Step;
    expect(validateStep.run).toContain("validate-release");
    expect(validateStep.run).toContain("gh release download");
    expect(validateStep.run).toContain(
      'gh api "repos/$GH_REPO/releases/latest"'
    );
    expect(validateStep.run).toContain("release:assets -- verify");
    expect(validateStep.run).toContain("gh attestation verify");
    expect(tapStep.with?.repository).toBe("outfitter-dev/homebrew-tap");
    expect(tapStep.with?.token).toBe(homebrewTapToken);
    const pullRequestStep = pullRequest as Step;
    expect(pullRequestStep.with?.token).toBe(homebrewTapToken);
    expect(pullRequestStep.with?.branch).toBe("release/skillset");
    expect(pullRequestStep.with?.["add-paths"]).toContain("README.md");
    expect(pullRequestStep.uses).toMatch(
      /^peter-evans\/create-pull-request@[a-f0-9]{40}$/u
    );
    expect(JSON.stringify(workflow)).not.toContain("gh pr merge");
  });
});
