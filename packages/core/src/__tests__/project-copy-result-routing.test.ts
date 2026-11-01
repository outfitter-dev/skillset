import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, renderResultsForLock, verifySkillsetResult } from "../build";
import type { BuildScope } from "../types";
import type { SkillsetRenderResult } from "../render-result";

const omission: SkillsetRenderResult = {
  schema: "skillset-render-result@2",
  featureId: "plugin-skills",
  sourceUnit: "plugin.demo.skill:review",
  status: "unsupported",
  target: "codex",
  reason: "Project copy cannot be emitted",
  policy: "unsupported:warn",
};

test("explicit no-output ownership precedes the workspace fallback", () => {
  const explicit = { ...omission, outputRoot: ".agents/skills" };
  const root = { ...omission, outputRoot: "." };
  expect(renderResultsForLock("skillset.lock", { target: "workspace", outputRoot: ".", items: [] }, [explicit, root, omission])).toEqual([root, omission]);
  expect(renderResultsForLock(".agents/skills/skillset.lock", { target: "codex", outputRoot: ".agents/skills", items: [] }, [explicit, root])).toEqual([explicit]);
  expect(renderResultsForLock(".claude/skills/skillset.lock", { target: "claude", outputRoot: ".agents/skills", items: [] }, [explicit])).toEqual([]);
  expect(renderResultsForLock(".skillset/cache/latest/.agents/skills/skillset.lock", { target: "codex", outputRoot: ".agents/skills", items: [] }, [explicit])).toEqual([explicit]);
});

async function fixture(kind: "omitted" | "shared" | "hook") {
  const root = await createTestFixtureRoot("project-copy-result-routing-");
  const files: Record<string, string> = {
    "skillset.yaml": `compile:\n  targets: [claude, codex]\n  unsupportedDestination: warn\n  session_start_hook: off\nplugins:\n  internal_use:\n    ${kind === "omitted" ? "drafts:\n      demo: true" : "plugins: [demo]"}\n`,
    ".skillset/RULES.md": "# Guidance\nKeep changes focused.\n",
    ".skillset/skills/keep/SKILL.md": "---\nname: keep\ndescription: Keep.\n---\nKeep.\n",
    ".skillset/plugins/demo/skillset.yaml": `skillset:\n  name: demo\n${kind === "hook" ? "hooks:\n  SessionStart: [start]\n" : ""}`,
    [`.skillset/plugins/demo/skills/${kind === "omitted" ? "_drafts/" : ""}review/SKILL.md`]: `---\nname: review\ndescription: Review.\n${kind === "omitted" ? "metadata:\n  priority: 3\n" : ""}---\nReview.\n`,
  };
  if (kind === "shared") files[".skillset/plugins/demo/shared/partials/note.md"] = "Shared.\n";
  if (kind === "hook") files[".skillset/hooks/start.json"] = JSON.stringify({ events: ["SessionStart"], run: { command: "echo ready" } });
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}

async function results(root: string, path: string): Promise<SkillsetRenderResult[]> {
  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return [];
  return (await file.json()).renderResults ?? [];
}

for (const kind of ["omitted", "shared", "hook"] as const) {
  for (const scope of [undefined, "repo", "plugins", "project"] as const) {
    test(`${kind} copy provenance stays in the skill root for ${scope ?? "unscoped"} builds`, async () => {
      const root = await fixture(kind);
      const options = scope === undefined ? {} : { scopes: [scope] as BuildScope[] };
      const built = await buildSkillsetResult(root, options);
      const matches = (outcome: SkillsetRenderResult) => outcome.sourceUnit === "plugin.demo.skill:review" && outcome.target === "codex" && (kind === "omitted" ? outcome.featureId === "plugin-skills" && outcome.status === "unsupported" : outcome.featureId === "internal-use-components");
      const selected = scope === undefined || scope === "repo";
      expect(built.renderResults.filter(matches)).toHaveLength(selected ? 1 : 0);
      expect((await results(root, ".agents/skills/skillset.lock")).filter(matches)).toHaveLength(selected ? 1 : 0);
      expect((await results(root, "skillset.lock")).filter(matches)).toHaveLength(0);
      expect((await results(root, "plugins/skillset.lock")).filter(matches)).toHaveLength(0);
      if (selected) expect(await Bun.file(join(root, ".agents/skills", kind === "omitted" ? "draft-review" : "review", "SKILL.md")).exists()).toBe(kind !== "omitted");
      if (scope === undefined) {
        const before = await Bun.file(join(root, ".agents/skills/skillset.lock")).text();
        await buildSkillsetResult(root);
        expect(await Bun.file(join(root, ".agents/skills/skillset.lock")).text()).toBe(before);
        expect((await verifySkillsetResult(root)).ok).toBe(true);
      }
    });
  }
}
