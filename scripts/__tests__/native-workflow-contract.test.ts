import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Workflow = {
  on?: {
    pull_request?: {
      paths?: string[];
    };
    workflow_call?: {
      inputs?: Record<string, unknown>;
    };
  };
  jobs?: Record<
    string,
    {
      needs?: string;
      "runs-on"?: string;
      steps?: Array<{
        name?: string;
        run?: string;
        uses?: string;
        with?: Record<string, unknown>;
      }>;
      strategy?: { matrix?: { include?: Array<Record<string, string>> } };
    }
  >;
  permissions?: Record<string, string>;
};

const root = join(import.meta.dir, "..", "..");

describe("SET-419 native workflow contract", () => {
  test("builds the exact required set reproducibly before target-host smoke", async () => {
    const workflow = Bun.YAML.parse(
      await readFile(join(root, ".github", "workflows", "native.yml"), "utf8")
    ) as Workflow;
    const build = workflow.jobs?.build;
    const smoke = workflow.jobs?.smoke;
    const buildStep = build?.steps?.find(
      (step) => step.name === "Build reproducible required artifacts"
    );
    const verifyStep = build?.steps?.find(
      (step) => step.name === "Verify release-shaped artifact contract"
    );

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.on?.workflow_call?.inputs).toHaveProperty("artifact-name");
    expect(workflow.on?.workflow_call?.inputs).toHaveProperty("source-sha");
    expect(workflow.on?.pull_request?.paths).toContain("apps/native-*/**");
    expect(build?.["runs-on"]).toBe("macos-15");
    expect(buildStep?.run).toContain("build:native");
    expect(buildStep?.run).toContain("--required --reproducible");
    expect(verifyStep?.run).toContain("native:check");
    expect(smoke?.needs).toBe("build");
    expect(smoke?.strategy?.matrix?.include).toEqual([
      { runner: "macos-15", suffix: "darwin-arm64" },
      { runner: "macos-15-intel", suffix: "darwin-x64" },
      { runner: "ubuntu-24.04-arm", suffix: "linux-arm64-glibc" },
      { runner: "ubuntu-24.04", suffix: "linux-x64-glibc" },
      { runner: "windows-2025", suffix: "windows-x64" },
    ]);
    expect(
      smoke?.steps?.find(
        (step) => step.name === "Prove atomic no-replace directory rename"
      )?.run
    ).toContain("directory-rename-no-replace.test.ts");
    expect(
      smoke?.steps?.find(
        (step) =>
          step.name ===
          "Run target-host smoke without system Bun in the child PATH"
      )?.run
    ).toContain("native:smoke");
    expect(
      smoke?.steps?.find(
        (step) =>
          step.name ===
          "Prove npm global install, platform selection, and reinstall"
      )?.run
    ).toContain("native:global-smoke");
    expect(JSON.stringify(workflow)).not.toMatch(
      /publish|release create|attest|sign/i
    );
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (step.uses !== undefined) {
          expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        }
      }
    }
  });
});
