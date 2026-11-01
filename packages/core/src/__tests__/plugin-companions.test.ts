import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { chmod, rm, stat } from "node:fs/promises";
import { checkAdapterConformance, createAdapterConformanceCoverageReport } from "@skillset/core";

import { buildSkillsetResult, diffSkillsetResult } from "../build";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

// Valid as a Skillset plugin slug, but past the Agent Plugins 1.0 name limit.
const LONG_PLUGIN_ID = `long-${"x".repeat(65)}`;

describe("plugin companions", () => {
  it("conforms to the standard envelope while preserving authored companion bytes and modes [SET-675]", async () => {
    const root = await fixture("claude", "demo");
    if (process.platform !== "win32") await chmod(join(root, ".skillset/plugins/demo/scripts/setup.sh"), 0o755);
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const cases = companionCases();
    const outcomes = result.renderResults.filter((outcome) =>
      cases.some(({ featureId }) => featureId === outcome.featureId)
    );
    expect(outcomes).toHaveLength(4);
    expect(checkAdapterConformance(outcomes, cases)).toEqual({ issues: [], ok: true });
    for (const [feature, path] of Object.entries(COMPANION_PATHS)) {
      const source = join(root, ".skillset/plugins/demo", path);
      const output = join(root, "plugins/demo", path);
      expect(await Bun.file(output).text()).toBe(await Bun.file(source).text());
      expect((await stat(output)).mode & 0o777).toBe((await stat(source)).mode & 0o777);
      const outcome = outcomes.find(({ featureId }) => featureId === feature);
      expect(outcome).toMatchObject({
        standardProfile: "agent-plugins-1.0", status: "rendered",
        outputs: [expect.objectContaining({ path: `plugins/demo/${path}` })],
      });
      expect(outcome?.target).toBeUndefined();
    }
    const coverage = createAdapterConformanceCoverageReport(cases);
    expect(coverage.entries.filter((entry) =>
      "standardProfile" in entry && entry.standardProfile === "agent-plugins-1.0" &&
      cases.some(({ featureId }) => featureId === entry.featureId)
    ).map(({ coverage }) => coverage)).toEqual(["covered", "covered", "covered", "covered"]);
  });

  it("rejects false status and evidence claims for each standard companion", async () => {
    const root = await fixture("claude", "demo");
    const { renderResults } = await diffSkillsetResult(root);
    for (const item of companionCases()) {
      const outcome = renderResults.find(({ featureId }) => featureId === item.featureId)!;
      expect(checkAdapterConformance([{ ...outcome, status: "unsupported" }], [item]).issues.map(({ code }) => code))
        .toEqual(["status-mismatch"]);
      expect(checkAdapterConformance([{ ...outcome, evidence: [{ kind: "test", ref: "unrelated" }] }], [item]).issues.map(({ code }) => code))
        .toEqual(["standard-profile-evidence-mismatch"]);
      expect(checkAdapterConformance([], [item]).issues.map(({ code }) => code)).toEqual(["missing-outcome"]);
    }
  });

  it("does not require absent optional companions or invent their render results", async () => {
    const root = await fixture("claude", "demo");
    for (const path of ["README.md", "assets", "scripts", "src"]) {
      await rm(join(root, ".skillset/plugins/demo", path), { recursive: true });
    }
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(result.renderResults.filter(({ featureId }) => featureId in COMPANION_PATHS)).toEqual([]);
    for (const path of Object.values(COMPANION_PATHS)) {
      expect(await Bun.file(join(root, "plugins/demo", path)).exists()).toBe(false);
    }
  });

  it("does not emit companions outside the plugin build scope", async () => {
    const root = await fixture("claude", "demo");
    const result = await buildSkillsetResult(root, { scopes: ["repo"] });
    expect(result.ok).toBe(true);
    const outcomes = result.renderResults.filter(({ featureId }) => featureId in COMPANION_PATHS);
    expect(outcomes).toHaveLength(4);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ status: "intentionally_skipped", policy: "scope:excluded" });
      expect(outcome.outputs ?? []).toEqual([]);
    }

    for (const path of Object.values(COMPANION_PATHS)) {
      expect(await Bun.file(join(root, "plugins/demo", path)).exists()).toBe(false);
    }
  });

  it("keeps claude companions when the Agent Plugins baseline is unsupported", async () => {
    const root = await fixture("claude", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
    }
  });

  it("keeps cursor README, scripts, and src companions when the Agent Plugins baseline is unsupported [SET-699]", async () => {
    const root = await fixture("cursor", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
    }
    expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, "assets/icon.svg")).exists()).toBe(false);
    const { renderResults } = await diffSkillsetResult(root);
    expect(
      renderResults
        .filter((outcome) =>
          ["plugin-assets", "plugin-readme", "plugin-scripts", "plugin-src"].includes(outcome.featureId)
        )
        .map((outcome) => outcome.featureId)
        .sort()
    ).toEqual(["plugin-readme", "plugin-scripts", "plugin-src"]);
  });

  it("changes the fallback plugin source hash when a copied README changes", async () => {
    const root = await fixture("claude", LONG_PLUGIN_ID);

    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const before = await pluginSourceHash(root, LONG_PLUGIN_ID);
    await Bun.write(join(root, ".skillset/plugins", LONG_PLUGIN_ID, "README.md"), "# Companion plugin, revised\n");
    expect((await buildSkillsetResult(root)).ok).toBe(true);

    expect(await pluginSourceHash(root, LONG_PLUGIN_ID)).not.toBe(before);
  });

  it("keeps codex assets when the Agent Plugins baseline is unsupported", async () => {
    const root = await fixture("codex", LONG_PLUGIN_ID);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    for (const path of ["README.md", "assets/icon.svg", "scripts/setup.sh", "src/index.js"]) {
      expect(await Bun.file(join(root, "plugins", LONG_PLUGIN_ID, path)).exists()).toBe(true);
    }
  });

  it("reports a standard-owned baseline companion as rendered for its standard profile", async () => {
    const root = await fixture("claude", "demo");

    const { renderResults } = await diffSkillsetResult(root);
    const iconResults = renderResults.filter((result) =>
      result.outputs?.some((output) => output.path === "plugins/demo/assets/icon.svg")
    );
    expect(iconResults).toEqual([
      expect.objectContaining({
        featureId: "plugin-assets",
        sourceUnit: "plugin.demo.feature:assets",
        standardProfile: "agent-plugins-1.0",
        status: "rendered",
      }),
    ]);
    expect(iconResults[0]?.target).toBeUndefined();
  });

  it("keeps provider-owned fallback companions target native", async () => {
    const root = await fixture("codex", LONG_PLUGIN_ID);

    const { renderResults } = await diffSkillsetResult(root);
    const iconResults = renderResults.filter((result) =>
      result.outputs?.some((output) => output.path === `plugins/${LONG_PLUGIN_ID}/assets/icon.svg`)
    );
    expect(iconResults).toEqual([
      expect.objectContaining({ featureId: "plugin-assets", status: "target_native", target: "codex" }),
    ]);
  });
});

async function pluginSourceHash(root: string, pluginId: string): Promise<string | undefined> {
  const lock: unknown = await Bun.file(join(root, "plugins/skillset.lock")).json();
  if (typeof lock !== "object" || lock === null || !("items" in lock) || !Array.isArray(lock.items)) return undefined;
  for (const item of lock.items) {
    if (typeof item !== "object" || item === null) continue;
    if ("kind" in item && item.kind === "plugin" && "name" in item && item.name === pluginId && "sourceHash" in item) {
      return typeof item.sourceHash === "string" ? item.sourceHash : undefined;
    }
  }
  return undefined;
}

async function fixture(target: "claude" | "codex" | "cursor", pluginId: string): Promise<string> {
  const root = await createTestFixtureRoot("skillset-plugin-companions-");
  const files: Record<string, string> = {
    "skillset.yaml": `skillset:\n  name: companions\ncompile:\n  unsupportedDestination: warn\nclaude: ${target === "claude"}\ncodex: ${target === "codex"}\ncursor: ${target === "cursor"}\n`,
    [`.skillset/plugins/${pluginId}/skillset.yaml`]: `skillset:\n  name: ${pluginId}\n  description: Companion plugin.\n`,
    [`.skillset/plugins/${pluginId}/README.md`]: "# Companion plugin\n",
    [`.skillset/plugins/${pluginId}/assets/icon.svg`]: "<svg/>\n",
    [`.skillset/plugins/${pluginId}/scripts/setup.sh`]: "echo setup\n",
    [`.skillset/plugins/${pluginId}/src/index.js`]: "export {};\n",
    [`.skillset/plugins/${pluginId}/skills/demo/SKILL.md`]: "---\nname: demo\ndescription: Demo skill.\n---\n\nBody.\n",
  };
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}

const COMPANION_PATHS = {
  "plugin-readme": "README.md",
  "plugin-assets": "assets/icon.svg",
  "plugin-scripts": "scripts/setup.sh",
  "plugin-src": "src/index.js",
};

function companionCases() {
  return Object.keys(COMPANION_PATHS).map((featureId) => ({
    featureId,
    fixtureRef: "packages/core/src/__tests__/plugin-companions.test.ts",
    standardProfile: "agent-plugins-1.0" as const,
    sourceUnit: `plugin.demo.feature:${featureId.slice("plugin-".length)}`,
  }));
}
