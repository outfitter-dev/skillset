import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult, ISOLATED_OUT_ROOT } from "../build";
import { EmptySourceGraphError } from "../empty-source-graph";
import { createOperationalPathContext, resolveOperationalPath } from "../operational-cache";
import { loadBuildGraph } from "../resolver";
import type { BuildScope } from "../types";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await createTestFixtureRoot("instruction-only-build-");
  for (const [path, content] of Object.entries({
    "skillset.yaml": "skillset:\n  name: instruction-only\ncompile:\n  targets: []\n",
    "unrelated.txt": "Keep authored bytes.\n",
    ...files,
  })) await Bun.write(join(root, path), content);
  return root;
}

const cases: { name: string; files: Record<string, string>; outputs: string[] }[] = [
  { name: "root", files: { ".skillset/RULES.md": "# Root guidance\n" }, outputs: ["AGENTS.md"] },
  { name: "nested", files: { ".skillset/rules/team/guidance.md": "# Team guidance\n" }, outputs: ["team/AGENTS.md"] },
  { name: "both", files: { ".skillset/RULES.md": "# Root guidance\n", ".skillset/rules/team/guidance.md": "# Team guidance\n" }, outputs: ["AGENTS.md", "team/AGENTS.md"] },
];

describe("instruction-only standard operations", () => {
  for (const example of cases) for (const isolated of [false, true]) {
    for (const scopes of [undefined, ["project"]] as const) {
      test(`${example.name}, isolated=${isolated}, scope=${scopes?.join() ?? "all"}`, async () => {
        const root = await fixture(example.files);
        const options = { isolated, ...(scopes === undefined ? {} : { scopes }) };
        const graph = await loadBuildGraph(root);
        expect(graph.outputRoots).toEqual([]);
        const output = (path: string) => resolveOperationalPath(createOperationalPathContext(root), isolated ? join(ISOLATED_OUT_ROOT, path) : path);
        expect((await diffSkillsetResult(root, options)).ok).toBe(true);
        for (const path of [...example.outputs, "skillset.lock"]) expect(await Bun.file(output(path)).exists()).toBe(false);
        expect((await buildSkillsetResult(root, options)).ok).toBe(true);
        for (const path of example.outputs) expect(await Bun.file(output(path)).text()).toContain("guidance");
        const lock = await Bun.file(output("skillset.lock")).json();
        expect(lock.items.map((item: { outputPath: string }) => item.outputPath).sort()).toEqual([...example.outputs].sort());
        for (const item of lock.items) {
          expect(item.owner).toEqual({ standardProfile: "agent-instructions" });
          expect(item.consumers).toEqual([{ phase: "baseline", standardProfile: "agent-instructions" }]);
        }
        expect((await verifySkillsetResult(root, options)).ok).toBe(true);
        expect((await diffSkillsetResult(root, options)).ok).toBe(true);
        expect(await Bun.file(join(root, "unrelated.txt")).text()).toBe("Keep authored bytes.\n");
        if (isolated) expect(await Bun.file(join(root, "skillset.lock")).exists()).toBe(false);
      });
    }
  }

  test("mixed standard directory and instruction outputs retain scope routing", async () => {
    const root = await fixture({
      ".skillset/RULES.md": "# Root guidance\n",
      ".skillset/skills/review/SKILL.md": "---\nname: review\ndescription: Review changes.\n---\nReview changes.\n",
    });
    expect((await buildSkillsetResult(root, { scopes: ["repo"] })).ok).toBe(true);
    expect(await Bun.file(join(root, ".agents/skills/review/SKILL.md")).exists()).toBe(true);
    expect(await Bun.file(join(root, "AGENTS.md")).exists()).toBe(false);
    expect((await buildSkillsetResult(root, { scopes: ["project"] })).ok).toBe(true);
    expect((await verifySkillsetResult(root, { scopes: ["project"] })).ok).toBe(true);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
  });

  test("scope exclusions reject without writes", async () => {
    const root = await fixture({ ".skillset/RULES.md": "# Guidance\n" });
    for (const scopes of [[], ["repo"], ["plugins"], ["user"]] as readonly BuildScope[][]) {
      for (const operation of [buildSkillsetResult, diffSkillsetResult, verifySkillsetResult]) {
        await expect(operation(root, { scopes })).rejects.toThrow("no eligible build projection");
      }
    }
    expect(await Bun.file(join(root, "AGENTS.md")).exists()).toBe(false);
    expect(await Bun.file(join(root, "skillset.lock")).exists()).toBe(false);
  });

  test("native-only and wildcard-only rules do not invent an emitted standard", async () => {
    for (const files of [
      { "AGENTS.md": "# Native authored guidance\n", "skillset.yaml": "compile:\n  targets: []\nworkspace:\n  nativeAgents: true\n" },
      { ".skillset/rules/src/[...]/guidance.md": "# Wildcard guidance\n" },
    ] as Record<string, string>[]) {
      const root = await fixture(files);
      for (const operation of [buildSkillsetResult, diffSkillsetResult, verifySkillsetResult]) {
        await expect(operation(root)).rejects.toThrow("no eligible build projection");
      }
      expect(await Bun.file(join(root, "skillset.lock")).exists()).toBe(false);
      if ("AGENTS.md" in files) expect(await Bun.file(join(root, "AGENTS.md")).text()).toBe(files["AGENTS.md"]);
    }
  });

  test("empty source retains its source diagnostic", async () => {
    const root = await fixture({ ".skillset/.gitkeep": "" });
    for (const operation of [buildSkillsetResult, diffSkillsetResult, verifySkillsetResult]) {
      await expect(operation(root)).rejects.toBeInstanceOf(EmptySourceGraphError);
    }
  });
});
