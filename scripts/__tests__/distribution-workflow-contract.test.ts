import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Step = { name?: string; run?: string; uses?: string };
type Job = {
  needs?: string;
  steps?: Step[];
  strategy?: {
    matrix?: { include?: Array<Record<string, string>>; runner?: string[] };
  };
};
type Workflow = {
  defaults?: { run?: { shell?: string } };
  jobs?: Record<string, Job>;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
};

const root = join(import.meta.dir, "..", "..");

describe("SET-424 published distribution workflow", () => {
  test("gates exact inventory before five-host channels and two-host Homebrew", async () => {
    const source = await readFile(
      join(root, ".github", "workflows", "distribution-conformance.yml"),
      "utf8"
    );
    const workflow = Bun.YAML.parse(source) as Workflow;
    const inventory = workflow.jobs?.inventory;
    const channels = workflow.jobs?.channels;
    const homebrew = workflow.jobs?.homebrew;
    const inventoryCommands = (inventory?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");
    const channelCommands = (channels?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");
    const homebrewCommands = (homebrew?.steps ?? [])
      .map((step) => step.run ?? "")
      .join("\n");

    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.permissions).toEqual({
      attestations: "read",
      contents: "read",
    });
    expect(workflow.defaults?.run?.shell).toBe("bash");
    expect(
      source.match(/ref: refs\/tags\/\$\{\{ inputs\.tag \}\}/gu)
    ).toHaveLength(3);
    expect(inventoryCommands).toContain("bun run test:distribution");
    expect(inventoryCommands).toContain("validate-release");
    expect(inventoryCommands).toContain("git rev-parse HEAD");
    expect(inventoryCommands).toContain("release:assets -- verify");
    expect(inventoryCommands).toContain("gh attestation verify");
    expect(inventoryCommands).toContain("--signer-workflow");
    expect(inventoryCommands).toContain("--source-digest");
    expect(inventoryCommands).not.toContain("--source-ref");
    expect(inventoryCommands).toContain('--commit "$RELEASE_COMMIT"');
    expect(inventoryCommands).not.toContain('--source-digest "$GITHUB_SHA"');
    expect(inventoryCommands).toContain("hydrate-native-release.ts");
    expect(inventoryCommands).toContain("publish:release-check");
    expect(inventoryCommands).toContain("publish:registry-check:published");
    expect(inventoryCommands).toContain("--stage-dir");
    expect(inventoryCommands).toContain("distribution-size-report.ts");
    expect(inventoryCommands).toContain("without Bun must fail explicitly");
    expect(channels?.needs).toBe("inventory");
    expect(channels?.strategy?.matrix?.include).toEqual([
      { runner: "macos-15", suffix: "darwin-arm64" },
      { runner: "macos-15-intel", suffix: "darwin-x64" },
      { runner: "ubuntu-24.04-arm", suffix: "linux-arm64-glibc" },
      { runner: "ubuntu-24.04", suffix: "linux-x64-glibc" },
      { runner: "windows-2025", suffix: "windows-x64" },
    ]);
    expect(channelCommands).toContain("skillset@$VERSION");
    expect(channelCommands).toContain("@skillset/cli@$VERSION");
    expect(channelCommands).toContain("--bunx-package");
    expect(channelCommands.match(/--exhaustive/gu)).toHaveLength(5);
    expect(channelCommands).toContain(
      "local-project/node_modules/.bin/skillset"
    );
    expect(channelCommands).toContain("--runtime native");
    expect(channelCommands).toContain("--runtime node-launcher");
    expect(channelCommands).toContain("--runtime bun");
    expect(channelCommands).toContain("published-launcher-negatives.ts");
    expect(channelCommands).toContain("npm config get prefix");
    expect(channelCommands).toContain('npm_root="$npm_prefix/lib/node_modules"');
    expect(channelCommands).toContain('npm_root="$npm_prefix/node_modules"');
    expect(homebrew?.needs).toBe("inventory");
    expect(homebrew?.strategy?.matrix?.runner).toEqual([
      "macos-15",
      "macos-15-intel",
    ]);
    expect(homebrewCommands).toContain("bun install --frozen-lockfile");
    expect(homebrewCommands).toContain(
      "brew install outfitter-dev/tap/skillset"
    );
    expect(homebrewCommands).toContain("brew audit --strict");
    expect(homebrewCommands).toContain("brew test");
    expect(homebrewCommands).toContain("--exhaustive");
    expect(source).not.toMatch(/npm publish|gh release create|gh pr merge/u);
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
      }
    }
  });
});
