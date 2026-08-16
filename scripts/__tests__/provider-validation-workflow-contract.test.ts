import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Workflow = {
  readonly jobs?: Record<
    string,
    {
      readonly "runs-on"?: string;
      readonly steps?: readonly {
        readonly if?: string;
        readonly run?: string;
        readonly uses?: string;
        readonly with?: Readonly<Record<string, boolean | string>>;
      }[];
    }
  >;
  readonly on?: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
};

describe("SET-463 provider-validation workflow", () => {
  test("is a separate hosted-only, read-only, exact-action workflow", async () => {
    const root = join(import.meta.dir, "../..");
    const source = await readFile(
      join(root, ".github/workflows/provider-validation.yml"),
      "utf8"
    );
    const workflow = Bun.YAML.parse(source) as Workflow;
    const job = workflow.jobs?.validate;
    const commands = (job?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");

    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("push");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job?.["runs-on"]).toBe("ubuntu-24.04");
    expect(commands).toContain("providers:validate:hosted");
    expect(commands).toContain("$RUNNER_TEMP/provider-validation.md");
    expect(commands).not.toMatch(/publish|plugin install|plugin enable|trust/u);
    expect(
      job?.steps?.find((step) => step.uses?.startsWith("actions/setup-node@"))
        ?.with?.["node-version"]
    ).toBe("24.19.0");
    expect(
      job?.steps?.find((step) => step.uses?.startsWith("actions/setup-python@"))
        ?.with?.["python-version"]
    ).toBe("3.12.14");
    expect(
      job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"))
        ?.with?.["persist-credentials"]
    ).toBe(false);
    const setupUv = job?.steps?.find((step) =>
      step.uses?.startsWith("astral-sh/setup-uv@")
    );
    expect(setupUv?.with?.version).toBe("0.12.5");
    expect(setupUv?.with?.checksum).toBe(
      "68a509da24b06b4223a1c0175fb5eb5bc79342b76cbeff0cfe51ac3f5b17b6b2"
    );
    for (const step of job?.steps ?? []) {
      if (step.uses !== undefined) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
    }
  });

  test("ordinary local checks do not invoke hosted validation", async () => {
    const root = join(import.meta.dir, "../..");
    const pkg = JSON.parse(
      await readFile(join(root, "package.json"), "utf8")
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    expect(pkg.scripts["providers:validate:hosted"]).toBe(
      "bun scripts/provider-validation.ts run"
    );
    for (const name of [
      "build",
      "check",
      "check:repo",
      "skillset:build",
      "skillset:check",
      "providers:check",
    ]) {
      expect(pkg.scripts[name]).not.toContain("providers:validate:hosted");
    }
  });
});
