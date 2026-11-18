import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildSkillsetResult, diffSkillsetResult, explainPath } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { targetNames } from "../targets";
import type { SkillsetRenderResult } from "../render-result";

const output = "plugins/demo/.cursor-plugin/hooks.json";
const definition = ".skillset/plugins/demo/hooks/prompt.json";
const attachment = ".skillset/plugins/demo/skillset.yaml";
const code = "hook-status-omitted";

function omissions(results: readonly SkillsetRenderResult[]) {
  return results.filter((result) => result.diagnostics?.some((item) => item.code === code));
}

async function fixture(options: { definitionStatus?: string; attachmentStatus?: string; cursor?: boolean } = {}) {
  const root = await createTestFixtureRoot("skillset-hook-status-");
  const files = normalizeSkillsetFixtureFiles({
    "skillset.yaml": `skillset:\n  name: hook-status\n${targetNames().map((target) => `${target}: ${target !== "cursor" || options.cursor !== false}`).join("\n")}\n`,
    [attachment]: `skillset:\n  name: demo\nhooks:\n  UserPromptSubmit:\n    - hook: prompt\n${options.attachmentStatus === undefined ? "" : `      status: ${JSON.stringify(options.attachmentStatus)}\n`}`,
    [definition]: JSON.stringify({ events: ["UserPromptSubmit"], run: { command: "echo ok" }, ...(options.definitionStatus === undefined ? {} : { status: options.definitionStatus }) }),
  });
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}

describe("adaptive hook status provenance", () => {
  for (const overridden of [false, true]) {
    test(`records ${overridden ? "attachment" : "definition"} status omission in build, lock, and explain`, async () => {
      const root = await fixture({ definitionStatus: "Definition text", ...(overridden ? { attachmentStatus: "Override text" } : {}) });
      const result = await buildSkillsetResult(root);
      expect(result.ok).toBe(true);
      const records = omissions(result.renderResults);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        destination: "hooks", featureId: "adaptive-hooks", sourcePath: overridden ? attachment : definition,
        sourceUnit: "plugin.demo.feature:hooks", status: "degraded", target: "cursor",
        outputs: [{ kind: "adaptive-hook", path: output }],
      });
      expect(JSON.stringify(records)).not.toContain("Definition text");
      expect(JSON.stringify(records)).not.toContain("Override text");
      const cursor = await Bun.file(join(root, output)).json();
      expect(cursor.hooks.beforeSubmitPrompt[0]).not.toHaveProperty("statusMessage");
      const shared = await Bun.file(join(root, "plugins/demo/hooks/hooks.json")).json();
      expect(shared.hooks.UserPromptSubmit[0].statusMessage).toBe(overridden ? "Override text" : "Definition text");
      const lock = await Bun.file(join(root, "plugins/skillset.lock")).text();
      expect(lock).toContain(code);
      const explained = await explainPath(root, output);
      expect(JSON.stringify(explained)).toContain(code);
    });
  }

  test("does not report omitted status when none was authored", async () => {
    const result = await buildSkillsetResult(await fixture());
    expect(omissions(result.renderResults)).toEqual([]);
  });

  test("does not report omission for a disabled Cursor target", async () => {
    const result = await buildSkillsetResult(await fixture({ definitionStatus: "Checking", cursor: false }));
    expect(omissions(result.renderResults)).toEqual([]);
  });

  test("excludes the omission diagnostic when the plugin output is outside scope", async () => {
    const root = await fixture({ definitionStatus: "Checking" });
    const scoped = await diffSkillsetResult(root, { scopes: ["repo"] });
    expect(omissions(scoped.renderResults)).toEqual([]);
    expect(scoped.renderResults).toContainEqual(expect.objectContaining({
      sourcePath: definition, target: "cursor", status: "intentionally_skipped", policy: "scope:excluded",
    }));
  });
});
