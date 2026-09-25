/* eslint-disable func-style, no-await-in-loop, no-use-before-define, sort-keys -- Fixture setup stays adjacent to each move scenario. */
/* eslint-disable unicorn/import-style -- Named path helpers keep fixture assertions compact. */

import { describe, expect, test } from "bun:test";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { explainPath } from "../authoring";
import { buildSkillset } from "../build";
import { readAppliedChangeRecords } from "../change-history";
import { planDistributions } from "../distribution";
import { moveSource, planSourceMove, SourceMovePlanError } from "../source-move";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

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
    const rootConfig = `skillset:\n  name: move-fixture\ncompile:\n  targets: [ claude ]\n`;
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
    expect((await readAppliedChangeRecords(root))[0]?.scopes).toEqual(["plugin.tools.skill:demo"]);
    await expect(access(join(root, ".claude/skills/demo/SKILL.md"))).rejects.toThrow();
    expect(await readFile(join(root, "plugins/tools/skills/demo/SKILL.md"), "utf8")).toContain("name: demo");
    const explained = await explainPath(root, "plugins/tools/skills/demo/SKILL.md");
    expect(explained).toMatchObject({
      entries: [
        expect.objectContaining({
          role: "standard",
          sourcePath: ".skillset/plugins/tools/skills/demo/SKILL.md",
        }),
      ],
      kind: "generated",
    });
    expect(explained.renderResults).toContainEqual(expect.objectContaining({
      sourceUnit: "plugin.tools.skill:demo",
      status: "rendered",
    }));

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
    await expect(access(join(root, "plugins/tools/skills/demo/SKILL.md"))).rejects.toThrow();
  });

  test("refuses a move whose rewritten distribution selector the field does not accept, without writes", async () => {
    const config = `skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\ndistributions:\n  docs:\n    from:\n      selector: skill:demo\n      target: claude\n    to:\n      kind: local\n      path: dist/demo.md\n`;
    const root = await fixture({
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      "skillset.yaml": config,
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    const reason = "cannot rewrite distributions.docs.from.selector from skill:demo to plugin.tools.skill:demo; workspace-config does not accept that selector there";
    await expect(planSourceMove(request)).rejects.toBeInstanceOf(SourceMovePlanError);
    await expect(planSourceMove(request)).rejects.toThrow(reason);
    await expect(moveSource({ ...request, expectedPlanHash: "any" })).rejects.toThrow(reason);
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
    expect(await readFile(join(root, request.from, "SKILL.md"), "utf8")).toContain("name: demo");
    await expect(access(join(root, request.to))).rejects.toThrow();
    await expect(access(join(root, ".skillset/changes/ledger.jsonl"))).rejects.toThrow();
    // The distribution acceptor refuses the selector the move would have written, by name.
    await writeFile(join(root, "skillset.yaml"), config.replace("skill:demo", "plugin.tools.skill:demo"), "utf8");
    await expect(planDistributions(root)).rejects.toThrow('from.selector "plugin.tools.skill:demo" must be plugins, plugin:<id>, or skill:<id>');
  });

  test("rewrites pending change scopes in both entry formats and leaves history streams alone", async () => {
    const history = `${JSON.stringify({ id: "old-demo", reason: "Existing history", scope: "skill:demo" })}\n`;
    const root = await fixture({
      ".skillset/changes/aaaaaaaaaaaa.md": "Reason-only demo change.\n\nBump: patch\nScopes: skill:keep, skill:demo\n",
      ".skillset/changes/bbbbbbbbbbbb.md": "---\nid: bbbbbbbbbbbb\nbump: patch\nscopes:\n  - skill:demo\n---\n\nScope: skill:demo stays prose in a frontmatter entry.\n",
      ".skillset/changes/cccccccccccc.md": "Unrelated change.\n\nScope: skill:keep\n",
      ".skillset/changes/dddddddddddd.md": "---\n---\nEmpty frontmatter reads as reason-only.\n\nScope: skill:demo\n",
      ".skillset/changes/history.jsonl": history,
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      ".skillset/skills/keep/SKILL.md": skill("keep", "Keep."),
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    const plan = await planSourceMove(request);
    await moveSource({ ...request, expectedPlanHash: plan.planHash });
    const changes = join(root, ".skillset/changes");
    expect(await readFile(join(changes, "aaaaaaaaaaaa.md"), "utf8")).toBe("Reason-only demo change.\n\nBump: patch\nScopes: skill:keep, plugin.tools.skill:demo\n");
    expect(await readFile(join(changes, "bbbbbbbbbbbb.md"), "utf8")).toBe("---\nid: bbbbbbbbbbbb\nbump: patch\nscopes:\n  - plugin.tools.skill:demo\n---\n\nScope: skill:demo stays prose in a frontmatter entry.\n");
    expect(await readFile(join(changes, "cccccccccccc.md"), "utf8")).toBe("Unrelated change.\n\nScope: skill:keep\n");
    expect(await readFile(join(changes, "dddddddddddd.md"), "utf8")).toBe("---\n---\nEmpty frontmatter reads as reason-only.\n\nScope: plugin.tools.skill:demo\n");
    expect(await readFile(join(changes, "history.jsonl"), "utf8")).toBe(history);
  });

  test("names a malformed pending change entry as a move plan error", async () => {
    const root = await fixture({
      ".skillset/changes/eeeeeeeeeeee.md": "---\nscopes: [skill:demo\n---\n\nBroken.\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    });
    const request = { from: ".skillset/skills/demo", rootPath: root, to: ".skillset/plugins/tools/skills/demo" };
    await expect(planSourceMove(request)).rejects.toBeInstanceOf(SourceMovePlanError);
    await expect(planSourceMove(request)).rejects.toThrow("cannot rewrite pending change entry .skillset/changes/eeeeeeeeeeee.md");
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

  test("does not carry an unrelated plugin draft with a workspace skill", async () => {
    const root = await fixture({
      ".skillset/plugins/other/skills/_drafts/demo/SKILL.md": skill("demo", "Other draft."),
      ".skillset/plugins/other/skills/demo/SKILL.md": skill("demo", "Other shipped."),
      ".skillset/plugins/other/skillset.yaml": "skillset:\n  name: other\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Workspace shipped."),
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    });
    const request = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    await buildSkillset(root);
    const plan = await planSourceMove(request);
    expect(plan.operations.filter((operation) => operation.kind === "move").map((operation) => operation.from)).toEqual([request.from]);
    await moveSource({ ...request, expectedPlanHash: plan.planHash });
    expect(await readFile(join(root, ".skillset/plugins/other/skills/_drafts/demo/SKILL.md"), "utf8")).toContain("Other draft.");
    await expect(access(join(root, ".skillset/plugins/tools/skills/_drafts/demo"))).rejects.toThrow();
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
              if (operation.kind === "write" && operation.path.includes("plugins/tools/skills/demo/SKILL.md")) {
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
      "plugins/tools/skills/demo/SKILL.md": "unmanaged\n",
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
  const root = await createTestFixtureRoot("skillset-source-move-");
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}
