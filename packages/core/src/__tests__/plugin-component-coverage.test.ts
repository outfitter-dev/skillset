import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult } from "../build";

describe("provider-only plugin component coverage", () => {
  test("keeps supported provider components while recording unavailable destinations", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: coverage\n",
      ".skillset/plugins/demo/bin/run": "#!/bin/sh\nexit 0\n",
      ".skillset/plugins/demo/subagents/reviewer.md": "Review.\n",
    });
    const built = await buildSkillsetResult(root);
    expect(built.ok).toBe(true);
    for (const [target, featureId] of [["codex", "plugin-bin"], ["cursor", "plugin-bin"], ["codex", "plugin-agents"]]) {
      const outcome = built.renderResults.find((result) => result.target === target && result.featureId === featureId);
      expect(outcome).toMatchObject({ status: "intentionally_skipped", policy: "default", reason: expect.any(String) });
      expect(outcome?.outputs).toBeUndefined();
    }
    expect(await Bun.file(join(root, "plugins/demo/bin/run")).exists()).toBe(true);
    expect(await Bun.file(join(root, "plugins/demo/agents/reviewer.md")).exists()).toBe(true);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
  });

  test("keeps a workspace hook attachment with uncovered standard provenance", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: coverage\ncompile:\n  targets: [claude]\n",
      ".skillset/hooks/shared.json": '{"events":["SessionStart"],"run":{"command":"echo shared"}}',
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\nhooks:\n  SessionStart:\n    - shared\n",
    });
    const built = await buildSkillsetResult(root);
    expect(built.ok).toBe(true);
    expect(built.renderResults).toContainEqual(expect.objectContaining({
      featureId: "plugin-hooks", standardProfile: "agent-plugins-1.0", status: "intentionally_skipped",
    }));
    expect(await Bun.file(join(root, "plugins/demo/hooks/hooks.json")).text()).toContain("echo shared");
  });

  test("builds Claude commands, hooks and agents under the default policy", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: coverage\ncompile:\n  targets: [claude]\n",
      ".skillset/plugins/demo/commands/run.md": "Run the task.\n",
      ".skillset/plugins/demo/subagents/reviewer.md": "Review the task.\n",
      ".skillset/plugins/demo/hooks/hooks.json": '{"hooks":{"Stop":[]}}',
    });

    const preview = await diffSkillsetResult(root);
    const built = await buildSkillsetResult(root);
    expect(built.ok).toBe(true);
    for (const featureId of ["plugin-commands", "plugin-hooks", "plugin-agents"]) {
      const expected = expect.objectContaining({
        featureId,
        standardProfile: "agent-plugins-1.0",
        status: "intentionally_skipped",
        policy: "default",
        reason: expect.any(String),
      });
      expect(preview.renderResults).toContainEqual(expected);
      expect(built.renderResults).toContainEqual(expected);
    }
    for (const path of ["commands/run.md", "agents/reviewer.md", "hooks/hooks.json"]) {
      expect(await Bun.file(join(root, "plugins/demo", path)).exists()).toBe(true);
    }
    expect((await verifySkillsetResult(root)).ok).toBe(true);
    expect((await buildSkillsetResult(root)).writes.writtenPaths).toEqual([]);
  });

  test.each([
    ["commands/run.md", "Run.\n", "plugin-commands", ""],
    ["subagents/reviewer.md", "Review.\n", "plugin-agents", ""],
    ["hooks/hooks.json", '{"hooks":{"Stop":[]}}', "plugin-hooks", ""],
    ["rules/review.md", "Review.\n", "plugin-rules", ""],
    [".lsp.json", "{}", "plugin-lsp-servers", ""],
    ["settings.json", "{}", "future-companion-source-pointers", ""],
    ["themes/theme.json", "{}", "plugin-themes", ""],
    ["monitors/watch.md", "Watch.\n", "plugin-monitors", ""],
    ["output-styles/plain.md", "Be plain.\n", "plugin-output-styles", ""],
    ["bin/run", "#!/bin/sh\nexit 0\n", "plugin-bin", "bin: true\n"],
    [".app.json", '{"apps":{"demo":{"id":"demo"}}}', "plugin-apps", ""],
  ])("records %s without blocking a minimal standard package", async (path, content, featureId, config) => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: coverage\nclaude: false\ncodex: false\ncursor: false\n",
      ".skillset/plugins/demo/skillset.yaml": `skillset:\n  name: demo\n${config}`,
      [`.skillset/plugins/demo/${path}`]: content,
    });
    const built = await buildSkillsetResult(root);
    const outcome = built.renderResults.find((result) => result.featureId === featureId && result.standardProfile === "agent-plugins-1.0");
    expect(built.ok).toBe(true);
    expect(outcome).toMatchObject({ status: "intentionally_skipped", policy: "default", reason: expect.any(String) });
    expect(outcome?.outputs).toBeUndefined();
    expect(await Bun.file(join(root, "plugins/demo/plugin.json")).exists()).toBe(true);
    expect(await Bun.file(join(root, "plugins/demo", path)).exists()).toBe(false);
    const lock = await Bun.file(join(root, "plugins/skillset.lock")).text();
    expect(lock).toContain('"intentionally_skipped"');
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-plugin-coverage-");
  const normalized = normalizeSkillsetFixtureFiles({
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ...files,
  });
  for (const [path, content] of Object.entries(normalized)) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
