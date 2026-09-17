/* eslint-disable func-style, no-await-in-loop, no-use-before-define, sort-keys -- Fixture setup stays adjacent to each move scenario. */
/* eslint-disable unicorn/import-style -- Named path helpers keep fixture assertions compact. */

import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { explainPath } from "../authoring";
import { buildSkillset } from "../build";
import { readAppliedChangeRecords } from "../change-history";
import { moveSource, planSourceMove, SourceMovePlanError } from "../source-move";

describe("SET-588 source collection move", () => {
  test("keeps the planner and apply transaction free of Git shell execution", async () => {
    for (const file of [
      "source-move.ts",
      "source-rename-apply.ts",
      "workspace-transaction.ts",
    ]) {
      const source = await readFile(join(import.meta.dir, "..", file), "utf8");
      expect(source).not.toMatch(
        /Bun\.spawn|spawnSync|execFile|execa|node:child_process/u
      );
    }
  });

  test("moves workspace to plugin and back with draft, references, outputs, and history intact", async () => {
    const rootConfig = `skillset:\n  name: move-fixture\ncompile:\n  targets: [ claude ]\ndistributions:\n  docs:\n    from:\n      selector: skill:demo\n      target: claude\n    to:\n      kind: local\n      path: dist/demo.md\n`;
    const agent = `---\ndescription: Reviewer\nskills:\n  - demo\n---\n\nReview.\n`;
    const pluginConfig = `skillset:\n  name: tools\n`;
    const root = await fixture({
      ".skillset/changes/history.jsonl": `${JSON.stringify({ evidence: [{ scope: "skill:demo", sourceHash: `sha256:${"a".repeat(64)}` }], id: "old-demo", reason: "Existing history", scope: "skill:demo" })}\n`,
      ".skillset/plugins/tools/skillset.yaml": pluginConfig,
      ".skillset/skills/_drafts/demo/SKILL.md": skill("demo", "Draft demo."),
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      ".skillset/subagents/reviewer.md": agent,
      "skillset.yaml": rootConfig,
    });

    await buildSkillset(root);
    const baseline = {
      agent: await readFile(join(root, ".skillset/subagents/reviewer.md")),
      config: await readFile(join(root, "skillset.yaml")),
      generated: await readFile(join(root, ".claude/skills/demo/SKILL.md")),
      lock: await readFile(join(root, ".claude/skills/skillset.lock")),
      pluginConfig: await readFile(join(root, ".skillset/plugins/tools/skillset.yaml")),
    };

    const outward = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    const outwardPlan = await planSourceMove(outward);
    expect(outwardPlan.kind).toBe("workspace-to-plugin");
    await moveSource({ ...outward, expectedPlanHash: outwardPlan.planHash });
    await buildSkillset(root);

    await expect(access(join(root, outward.from))).rejects.toThrow();
    expect(await readFile(join(root, outward.to, "SKILL.md"), "utf8")).toContain("name: demo");
    await expect(access(join(root, ".skillset/skills/_drafts/demo"))).rejects.toThrow();
    expect(await readFile(join(root, ".skillset/plugins/tools/skills/_drafts/demo/SKILL.md"), "utf8")).toContain("Draft demo");
    expect(await readFile(join(root, ".skillset/subagents/reviewer.md"), "utf8")).toContain("plugin.tools.skill:demo");
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("selector: plugin.tools.skill:demo");
    expect((await readAppliedChangeRecords(root))[0]?.scopes).toEqual(["plugin.tools.skill:demo"]);
    await expect(access(join(root, ".claude/skills/demo/SKILL.md"))).rejects.toThrow();
    expect(await readFile(join(root, "plugins/tools/claude/skills/demo/SKILL.md"), "utf8")).toContain("name: demo");
    expect(
      await explainPath(root, "plugins/tools/claude/skills/demo/SKILL.md")
    ).toMatchObject({
      entries: [
        expect.objectContaining({
          role: "bundle",
          sourcePath: ".skillset/plugins/tools/skills/demo/SKILL.md",
        }),
      ],
      kind: "generated",
      renderResults: [
        expect.objectContaining({
          sourceUnit: "plugin.tools.skill:demo",
          status: "rendered",
        }),
      ],
    });

    const homeward = {
      from: outward.to,
      rootPath: root,
      to: outward.from,
    };
    const homewardPlan = await planSourceMove(homeward);
    expect(homewardPlan.kind).toBe("plugin-to-workspace");
    await moveSource({ ...homeward, expectedPlanHash: homewardPlan.planHash });
    await buildSkillset(root);

    expect(await readFile(join(root, outward.from, "SKILL.md"), "utf8")).toContain("name: demo");
    await expect(access(join(root, outward.to))).rejects.toThrow();
    expect((await readAppliedChangeRecords(root))[0]?.scopes).toEqual(["skill:demo"]);
    expect(await readFile(join(root, ".skillset/subagents/reviewer.md"))).toEqual(baseline.agent);
    expect(await readFile(join(root, "skillset.yaml"))).toEqual(baseline.config);
    expect(await readFile(join(root, ".skillset/plugins/tools/skillset.yaml"))).toEqual(baseline.pluginConfig);
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"))).toEqual(baseline.generated);
    expect(await readFile(join(root, ".claude/skills/skillset.lock"))).toEqual(baseline.lock);
    await expect(access(join(root, "plugins/tools/claude/skills/demo/SKILL.md"))).rejects.toThrow();
  });

  test("removes plugin internal-use selection with a visible notice", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skills/demo/SKILL.md": skill("demo", "Demo."),
      ".skillset/plugins/tools/skills/keep/SKILL.md": skill("keep", "Keep."),
      ".skillset/plugins/tools/skillset.yaml": `skillset:\n  name: tools\n`,
      "skillset.yaml": `skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\nplugins:\n  internal_use:\n    skills:\n      tools: [demo, keep]\n`,
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/plugins/tools/skills/demo",
      rootPath: root,
      to: ".skillset/skills/demo",
    };
    const plan = await planSourceMove(request);
    expect(plan.notices).toEqual([
      "removed plugins.internal_use selection for plugin.tools.skill:demo; workspace skills are not selected implicitly",
    ]);
    await moveSource({ ...request, expectedPlanHash: plan.planHash });
    const config = await readFile(join(root, "skillset.yaml"), "utf8");
    expect(config).toContain("tools:\n        - keep");
    expect(config).not.toContain("tools:\n        - demo");
    expect(config).not.toContain("skill:demo");
  });

  test("refuses stale hashes and rolls back every move effect after a late write failure", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      ".skillset/subagents/reviewer.md": `---\ndescription: Reviewer\nskills: [demo]\n---\n\nReview.\n`,
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    const preview = await planSourceMove(request);
    await expect(moveSource({ ...request, expectedPlanHash: "stale" })).rejects.toThrow("plan changed since preview");
    await expect(
      moveSource({
        ...request,
        expectedPlanHash: preview.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: (operation) => {
              if (operation.kind === "write" && operation.path.includes("plugins/tools/claude/skills/demo/SKILL.md")) {
                throw new Error("injected move output failure");
              }
            },
          },
        },
      })
    ).rejects.toThrow("injected move output failure");
    expect(await readFile(join(root, request.from, "SKILL.md"), "utf8")).toContain("name: demo");
    await expect(access(join(root, request.to))).rejects.toThrow();
    expect(await readFile(join(root, ".skillset/subagents/reviewer.md"), "utf8")).toContain("skills: [demo]");
    await expect(access(join(root, ".skillset/changes/ledger.jsonl"))).rejects.toThrow();
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("name: demo");
  });

  test("refuses invalid sources, destinations, leaf changes, and collisions without writes", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skills/demo/SKILL.md": skill("demo", "Collision."),
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/shared/input.txt": "input\n",
      ".skillset/skills/_drafts/draft-only/SKILL.md": skill("draft-only", "Draft."),
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      "skillset.yaml": "skillset:\n  name: move-fixture\n",
    });
    const sourceBefore = await readFile(join(root, ".skillset/skills/demo/SKILL.md"));
    for (const [from, to, message] of [
      [".skillset/shared/input.txt", ".skillset/plugins/tools/skills/input.txt", "source must be a complete shipped skill directory"],
      [".skillset/skills/_drafts/draft-only", ".skillset/plugins/tools/skills/draft-only", "source is a draft"],
      [".skillset/skills/demo", ".skillset/plugins/tools/skills/renamed", "destination must preserve skill leaf"],
      [".skillset/skills/demo", ".skillset/plugins/tools/shared/demo", "destination must be inside a known plugin skill collection"],
      [".skillset/skills/demo", ".skillset/plugins/tools/skills/demo", "destination leaf already exists"],
      [".skillset/skills/demo", "../demo", "must stay inside the workspace"],
    ] as const) {
      await expect(planSourceMove({ from, rootPath: root, to })).rejects.toBeInstanceOf(SourceMovePlanError);
      await expect(planSourceMove({ from, rootPath: root, to })).rejects.toThrow(message);
    }
    expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"))).toEqual(sourceBefore);
    await expect(access(join(root, ".skillset/changes/ledger.jsonl"))).rejects.toThrow();
  });

  test("refuses an unmanaged generated destination without creating mutation authority", async () => {
    const root = await fixture({
      "plugins/tools/claude/skills/demo/SKILL.md": "unmanaged\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    });
    const request = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    await expect(planSourceMove(request)).rejects.toThrow("generated destination is unmanaged");
    expect(await readFile(join(root, request.from, "SKILL.md"), "utf8")).toContain("name: demo");
    await expect(access(join(root, request.to))).rejects.toThrow();
    await expect(access(join(root, ".skillset/changes/ledger.jsonl"))).rejects.toThrow();
  });
});

function skill(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`;
}

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-source-move-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}
