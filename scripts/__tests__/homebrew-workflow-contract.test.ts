import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

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
  needs?: string | string[];
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
  test("allows a skipped alternate publisher but requires a successful stable release", async () => {
    const workflow = await readWorkflow("release.yml");
    const homebrew = workflow.jobs?.homebrew;
    const condition = homebrew?.if?.replace(/^\$\{\{\s*|\s*\}\}$/gu, "");

    // An explicit status function prevents the deliberately skipped manual or
    // automatic publisher from propagating an implicit success() skip here.
    expect(condition?.split(/\s*&&\s*/u)).toEqual([
      "!cancelled()",
      "needs.github-release.result == 'success'",
      "needs.publish-plan.result == 'success'",
      "needs.publish-plan.outputs.tag == 'latest'",
      "(needs.publish-auto.result == 'success' || needs.publish.result == 'success')",
    ]);
    expect(homebrew?.needs).toEqual([
      "github-release", "publish-plan", "publish-auto", "publish",
    ]);
  });

  test("runs only after a successful stable publisher and release", async () => {
    const workflow = await readWorkflow("release.yml");
    // This workflow condition uses JS-compatible boolean operators. Evaluate
    // the actual YAML expression with only its job evidence and status function.
    const condition = workflow.jobs?.homebrew?.if
      ?.replace(/^\$\{\{\s*|\s*\}\}$/gu, "")
      .replace(/needs\.([\w-]+)/gu, 'needs["$1"]');
    expect(condition).toBeDefined();
    const baseline = {
      auto: "skipped", manual: "success", plan: "success",
      release: "success", tag: "latest", cancelled: false,
    };
    const scenarios = [
      ["manual publication", {}, true],
      ["automatic publication", { auto: "success", manual: "skipped" }, true],
      ["already-published reconciliation", { manual: "skipped" }, false],
      ["failed manual publication", { manual: "failure" }, false],
      ["failed automatic publication", { auto: "failure", manual: "skipped" }, false],
      ["cancelled publisher", { manual: "cancelled" }, false],
      ["failed release", { release: "failure" }, false],
      ["skipped release", { release: "skipped" }, false],
      ["failed plan", { plan: "failure" }, false],
      ["prerelease", { tag: "beta" }, false],
      ["cancelled run", { cancelled: true }, false],
    ] as const;
    for (const [scenario, overrides, expected] of scenarios) {
      const state = { ...baseline, ...overrides };
      const allowed: unknown = runInNewContext(condition ?? "false", {
        cancelled: () => state.cancelled,
        needs: {
          "github-release": { result: state.release },
          "publish-plan": { result: state.plan, outputs: { tag: state.tag } },
          "publish-auto": { result: state.auto },
          publish: { result: state.manual },
        },
      }, { timeout: 100 });
      expect({ scenario, allowed }).toEqual({ scenario, allowed: expected });
    }
  });

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
    expect(homebrew?.needs).toEqual([
      "github-release", "publish-plan", "publish-auto", "publish",
    ]);
    expect(homebrew?.if).toContain(
      "needs.publish-plan.outputs.tag == 'latest'"
    );
    expect(homebrew?.if).not.toContain("outputs.channel");
    expect(homebrew?.uses).toBe("./.github/workflows/publish-homebrew.yml");
    expect(homebrew?.permissions).toEqual({
      attestations: "read",
      contents: "read",
    });
    expect(homebrew?.with?.tag).toBe(releaseTag);
    expect(homebrew?.secrets).toEqual({ HOMEBREW_TAP_TOKEN: homebrewTapToken });
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
    expect(workflow.on?.workflow_call?.secrets).toEqual({
      HOMEBREW_TAP_TOKEN: {
        description: "Token for opening the verified Homebrew tap update",
        required: true,
      },
    });
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
