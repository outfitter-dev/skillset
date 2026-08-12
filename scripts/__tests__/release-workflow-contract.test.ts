import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { RELEASE_NPM_VERSION } from "../release-packages";

type Workflow = {
  jobs?: Record<string, {
    needs?: string | string[];
    permissions?: Record<string, string>;
    uses?: string;
    steps?: Array<{
      env?: Record<string, string>;
      if?: string;
      name?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;
    with?: Record<string, unknown>;
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
  test("repository checks fetch the Git history required by documentation validation", async () => {
    const workflow = await readWorkflow("ci.yml");
    const steps = workflow.jobs?.check?.steps ?? [];
    const checkout = steps.find((step) => step.uses === "actions/checkout@v5");

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

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

  test("release publication waits for five-host native evidence and exact artifact attestations", async () => {
    const workflow = await readWorkflow("release.yml");
    const native = workflow.jobs?.["native-evidence"];
    const attest = workflow.jobs?.["attest-native"];
    const attestStep = attest?.steps?.find(
      (step) =>
        step.uses === "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6"
    );

    expect(native?.uses).toBe("./.github/workflows/native.yml");
    expect(native?.with?.["artifact-name"]).toBe(
      "skillset-native-${{ needs.publish-plan.outputs.version_commit }}"
    );
    expect(native?.with?.["source-sha"]).toBe(
      "${{ needs.publish-plan.outputs.version_commit }}"
    );
    expect(attest?.needs).toEqual([
      "publish-plan",
      "publish-policy",
      "native-evidence",
    ]);
    expect(attest?.permissions?.["id-token"]).toBe("write");
    expect(attest?.permissions?.attestations).toBe("write");
    expect(attestStep?.with?.["subject-path"]).toBe(
      "${{ runner.temp }}/release-assets/skillset-v*"
    );
    expect(
      attest?.steps?.find(
        (step) => step.name === "Verify required attestations"
      )?.run
    ).toContain("gh attestation verify");
  });

  test("both npm routes preflight the same artifacts and publish only after attestation", async () => {
    const workflow = await readWorkflow("release.yml");
    for (const name of ["publish-auto", "publish"] as const) {
      const job = workflow.jobs?.[name];
      expect(job?.needs).toContain("attest-native");
      expect(job?.permissions?.["id-token"]).toBe("write");
      expect(job?.permissions?.attestations).toBe("read");
      expect(job?.steps?.map((step) => step.run)).toContain(
        `npm install --location=global npm@${RELEASE_NPM_VERSION}`
      );
      expect(
        job?.steps?.find(
          (step) => step.name === "Validate coordinated release before publish"
        )?.run
      ).toContain("publish:release-check");
      expect(
        job?.steps?.find((step) => step.name === "Publish package set")?.run
      ).toContain("--native-out-dir");
    }
  });

  test("GitHub release recovery verifies signing, registry, attestations, and exact assets", async () => {
    const workflow = await readWorkflow("release.yml");
    const release = workflow.jobs?.["github-release"];
    const joined = (release?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");

    expect(release?.needs).toContain("attest-native");
    expect(release?.permissions?.attestations).toBe("read");
    expect(joined).toContain("release:signing-check");
    expect(joined).toContain("publish:registry-check:published");
    expect(joined).toContain("gh attestation verify");
    expect(joined).toContain("release:assets");
    expect(joined).toContain(
      "gh release view \"$tag\" --json assets --jq '.assets | length'"
    );
  });
});
