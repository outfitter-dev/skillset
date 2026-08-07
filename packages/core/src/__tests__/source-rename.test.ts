/* eslint-disable func-style, no-await-in-loop, no-use-before-define, sort-keys -- Fixture setup stays adjacent to each rename scenario. */
/* eslint-disable unicorn/import-style -- Named path helpers keep fixture assertions compact. */

import { describe, expect, test } from "bun:test";
import { access, chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSkillset } from "../build";
import {
  planSourceRename,
  renameSource,
  SourceRenamePlanError,
} from "../source-rename";

const SKILL = `---
name: demo
description: Demo skill.
resources:
  - from: shared:references/old.txt
    to: stable.txt
hooks:
  SessionStart:
    - hook: old-hook
---

Use {{@shared:references/old.txt}} and {{> old}}.
`;

describe("source rename planner", () => {
  test("plans a deterministic, read-only file rename with safe reference updates", async () => {
    const root = await fixture({
      ".skillset/_claude/legacy.md":
        "Provider-native shared:references/old.txt\n",
      ".skillset/hooks/old-hook.json": JSON.stringify({
        events: ["SessionStart"],
        run: { command: "echo ok" },
      }),
      ".skillset/partials/old.md": "Partial\n",
      ".skillset/shared/references/old.txt": "old\n",
      ".skillset/skills/demo/SKILL.md": SKILL,
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });

    const first = await planSourceRename({
      from: ".skillset/shared/references/old.txt",
      rootPath: root,
      to: ".skillset/shared/references/new.txt",
    });
    const second = await planSourceRename({
      from: ".skillset/shared/references/old.txt",
      rootPath: root,
      to: ".skillset/shared/references/new.txt",
    });

    expect(first).toEqual(second);
    expect(first.operations).toContainEqual({
      from: ".skillset/shared/references/old.txt",
      kind: "move",
      to: ".skillset/shared/references/new.txt",
    });
    const skillUpdate = first.operations.find(
      (item) =>
        item.kind === "update" && item.path === ".skillset/skills/demo/SKILL.md"
    );
    expect(skillUpdate).toEqual({
      content: [
        "---",
        "name: demo",
        "description: Demo skill.",
        "resources:",
        "  - from: shared:references/new.txt",
        "    to: stable.txt",
        "hooks:",
        "  SessionStart:",
        "    - hook: old-hook",
        "---",
        "",
        "Use {{@shared:references/new.txt}} and {{> old}}.",
        "",
      ].join("\n"),
      kind: "update",
      path: ".skillset/skills/demo/SKILL.md",
    });
    expect(first.warnings).toContain(
      "preserved generated resource destination in .skillset/skills/demo/SKILL.md"
    );
    expect(
      first.operations.some(
        (item) => item.kind === "update" && item.path.includes("_claude")
      )
    ).toBe(false);
    expect(
      await readFile(join(root, ".skillset/shared/references/old.txt"), "utf-8")
    ).toBe("old\n");
    expect(
      await Bun.file(join(root, ".skillset/shared/references/new.txt")).exists()
    ).toBe(false);
  });

  test("hashes identical source plans identically across workspace paths", async () => {
    const files = {
      ".skillset/shared/old.txt": "old\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\nresources:\n  - shared:old.txt\n---\n\n{{@shared:old.txt}}\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    };
    const [firstRoot, secondRoot] = await Promise.all([
      fixture(files),
      fixture(files),
    ]);
    const first = await planSourceRename({
      from: ".skillset/shared/old.txt",
      rootPath: firstRoot,
      to: ".skillset/shared/new.txt",
    });
    const second = await planSourceRename({
      from: ".skillset/shared/old.txt",
      rootPath: secondRoot,
      to: ".skillset/shared/new.txt",
    });
    expect(first.planHash).toBe(second.planHash);
  });

  test("rewrites named partial references only when the named partial moves", async () => {
    const root = await fixture({
      ".skillset/partials/old.md": "Partial\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\n{{> old}}\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    const plan = await planSourceRename({
      from: ".skillset/partials/old.md",
      rootPath: root,
      to: ".skillset/partials/new.md",
    });
    const update = plan.operations.find(
      (item) => item.kind === "update" && item.path.endsWith("SKILL.md")
    );
    expect(update).toEqual({
      content: "---\nname: demo\ndescription: Demo\n---\n\n{{> new}}\n",
      kind: "update",
      path: ".skillset/skills/demo/SKILL.md",
    });
  });

  test("renames a file that rewrites its own structured reference", async () => {
    const root = await fixture({
      ".skillset/partials/old.md": "Self: {{> old}}\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\nDemo\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);
    const preview = await planSourceRename({
      from: ".skillset/partials/old.md",
      rootPath: root,
      to: ".skillset/partials/new.md",
    });
    expect(preview.operations).toContainEqual({
      content: "Self: {{> new}}\n",
      kind: "update",
      path: ".skillset/partials/new.md",
    });

    await renameSource({
      expectedPlanHash: preview.planHash,
      from: ".skillset/partials/old.md",
      rootPath: root,
      to: ".skillset/partials/new.md",
    });
    await expect(
      access(join(root, ".skillset/partials/old.md"))
    ).rejects.toThrow();
    expect(
      await readFile(join(root, ".skillset/partials/new.md"), "utf-8")
    ).toBe("Self: {{> new}}\n");
  });

  test("rewrites skill identity references and eval declarations for a skill-root move", async () => {
    const root = await fixture({
      ".skillset/agents/reviewer.md":
        "---\ndescription: Reviewer\nskills: [old]\nclaude:\n  skills: [old, { native: old }]\n---\n\nReview\n",
      ".skillset/skills/old/SKILL.md":
        "---\nname: old\ndescription: Old\n---\n\nOld\n",
      ".skillset/skills/old/evals/evals.json": JSON.stringify({
        skill_name: "old",
        evals: [{ expected_output: "ok", files: [], id: 1, prompt: "Run" }],
      }),
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    const plan = await planSourceRename({
      from: ".skillset/skills/old",
      rootPath: root,
      to: ".skillset/skills/new",
    });
    expect(plan.kind).toBe("standalone-skill");
    expect(plan.operations).toContainEqual({
      from: ".skillset/skills/old",
      kind: "move",
      to: ".skillset/skills/new",
    });
    expect(
      plan.operations.find(
        (item) =>
          item.kind === "update" && item.path.endsWith("agents/reviewer.md")
      )
    ).toEqual({
      content:
        "---\ndescription: Reviewer\nskills:\n  - new\nclaude:\n  skills:\n    - new\n    - native: old\n---\n\nReview\n",
      kind: "update",
      path: ".skillset/agents/reviewer.md",
    });
    expect(
      plan.operations.find(
        (item) =>
          item.kind === "update" && item.path.endsWith("evals/evals.json")
      )
    ).toEqual({
      content: `${JSON.stringify(
        {
          skill_name: "new",
          evals: [{ expected_output: "ok", files: [], id: 1, prompt: "Run" }],
        },
        null,
        2
      )}\n`,
      kind: "update",
      path: ".skillset/skills/new/evals/evals.json",
    });
  });

  test("keeps same-named skills isolated by standalone and plugin ownership", async () => {
    const root = await fixture({
      ".skillset/agents/reviewer.md":
        "---\ndescription: Reviewer\nskills: [old, plugin.tools.skill:old]\n---\n\nReview\n",
      ".skillset/plugins/tools/skills/old/SKILL.md":
        "---\nname: old\ndescription: Plugin old\n---\n\nPlugin\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/old/SKILL.md":
        "---\nname: old\ndescription: Standalone old\n---\n\nStandalone\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });

    const plan = await planSourceRename({
      from: ".skillset/plugins/tools/skills/old",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/new",
    });

    expect(
      plan.operations.some(
        (operation) =>
          operation.kind === "update" &&
          operation.path === ".skillset/skills/old/SKILL.md"
      )
    ).toBe(false);
    expect(
      plan.operations.find(
        (operation) =>
          operation.kind === "update" &&
          operation.path === ".skillset/agents/reviewer.md"
      )
    ).toEqual({
      content:
        "---\ndescription: Reviewer\nskills:\n  - old\n  - plugin.tools.skill:new\n---\n\nReview\n",
      kind: "update",
      path: ".skillset/agents/reviewer.md",
    });
  });

  test("rewrites hook identities and script paths without formatting unrelated hook files", async () => {
    const root = await fixture({
      ".skillset/hooks/old-hook.json": JSON.stringify({
        events: ["SessionStart"],
        run: { command: "echo ok" },
      }),
      ".skillset/hooks/scripted.json": JSON.stringify({
        events: ["Stop"],
        run: { script: "{{scripts.dir}}/old.js" },
      }),
      ".skillset/scripts/old.js": "console.log('old');\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\nhooks:\n  SessionStart:\n    - hook: old-hook\n---\n\nDemo\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });

    const hookPlan = await planSourceRename({
      from: ".skillset/hooks/old-hook.json",
      rootPath: root,
      to: ".skillset/hooks/new-hook.json",
    });
    expect(hookPlan.operations).toContainEqual({
      content:
        "---\nname: demo\ndescription: Demo\nhooks:\n  SessionStart:\n    - hook: new-hook\n---\n\nDemo\n",
      kind: "update",
      path: ".skillset/skills/demo/SKILL.md",
    });
    expect(
      hookPlan.operations.some(
        (item) => item.kind === "update" && item.path.endsWith("scripted.json")
      )
    ).toBe(false);

    const scriptPlan = await planSourceRename({
      from: ".skillset/scripts/old.js",
      rootPath: root,
      to: ".skillset/scripts/new.js",
    });
    expect(scriptPlan.operations).toContainEqual({
      content: `${JSON.stringify({ events: ["Stop"], run: { script: "{{scripts.dir}}/new.js" } }, null, 2)}\n`,
      kind: "update",
      path: ".skillset/hooks/scripted.json",
    });
  });

  test("rewrites skill-local eval files and reports unmarked prose without touching it", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\nMention old.txt in prose.\n",
      ".skillset/skills/demo/evals/evals.json": JSON.stringify({
        skill_name: "demo",
        evals: [
          {
            expected_output: "ok",
            files: ["evals/files/old.txt"],
            id: 1,
            prompt: "Run",
          },
        ],
      }),
      ".skillset/skills/demo/evals/files/old.txt": "old\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    const plan = await planSourceRename({
      from: ".skillset/skills/demo/evals/files/old.txt",
      rootPath: root,
      to: ".skillset/skills/demo/evals/files/new.txt",
    });
    expect(plan.operations).toContainEqual({
      content: `${JSON.stringify(
        {
          skill_name: "demo",
          evals: [
            {
              expected_output: "ok",
              files: ["evals/files/new.txt"],
              id: 1,
              prompt: "Run",
            },
          ],
        },
        null,
        2
      )}\n`,
      kind: "update",
      path: ".skillset/skills/demo/evals/evals.json",
    });
    expect(
      plan.operations.some(
        (item) => item.kind === "update" && item.path.endsWith("SKILL.md")
      )
    ).toBe(false);
    expect(plan.warnings).toContain(
      "unmarked source mention may need manual update in .skillset/skills/demo/SKILL.md"
    );
  });

  test("preserves unrelated eval source bytes and key order", async () => {
    const evalSource =
      '{"skill_name":"demo","evals":[{"id":1,"prompt":"Run","expected_output":"ok","files":[]}]}\n';
    const root = await fixture({
      ".skillset/shared/old.txt": "old\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\nDemo\n",
      ".skillset/skills/demo/evals/evals.json": evalSource,
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });

    const plan = await planSourceRename({
      from: ".skillset/shared/old.txt",
      rootPath: root,
      to: ".skillset/shared/new.txt",
    });
    expect(
      plan.operations.some(
        (operation) =>
          operation.kind === "update" &&
          operation.path.endsWith("evals/evals.json")
      )
    ).toBe(false);
    expect(
      await readFile(
        join(root, ".skillset/skills/demo/evals/evals.json"),
        "utf-8"
      )
    ).toBe(evalSource);
  });

  test("refuses collisions, traversal, and cross-plugin file moves", async () => {
    const root = await fixture({
      ".skillset/plugins/one/shared/a.txt": "a\n",
      ".skillset/plugins/one/skillset.yaml": "skillset:\n  name: one\n",
      ".skillset/plugins/two/skillset.yaml": "skillset:\n  name: two\n",
      ".skillset/shared/new.txt": "new\n",
      ".skillset/shared/old.txt": "old\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\nDemo\n",
      ".skillset/skills/demo/evals/files/input.txt": "input\n",
      ".skillset/skills/other/SKILL.md":
        "---\nname: other\ndescription: Other\n---\n\nOther\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await expect(
      planSourceRename({
        from: ".skillset/shared/old.txt",
        rootPath: root,
        to: ".skillset/shared/new.txt",
      })
    ).rejects.toBeInstanceOf(SourceRenamePlanError);
    await expect(
      planSourceRename({
        from: ".skillset/shared/old.txt",
        rootPath: root,
        to: "../outside.txt",
      })
    ).rejects.toBeInstanceOf(SourceRenamePlanError);
    await expect(
      planSourceRename({
        from: ".skillset/plugins/one/shared/a.txt",
        rootPath: root,
        to: ".skillset/plugins/two/shared/a.txt",
      })
    ).rejects.toBeInstanceOf(SourceRenamePlanError);
    await expect(
      planSourceRename({
        from: ".skillset/skills/demo/evals/files/input.txt",
        rootPath: root,
        to: ".skillset/skills/other/evals/files/input.txt",
      })
    ).rejects.toBeInstanceOf(SourceRenamePlanError);
  });

  test("keeps file renames within their authored semantic surface", async () => {
    const root = await fixture({
      ".skillset/_claude/native.md": "Native\n",
      ".skillset/rules/old.md": "Rule\n",
      ".skillset/shared/old.txt": "Shared\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });

    await expect(
      planSourceRename({
        from: ".skillset/shared/old.txt",
        rootPath: root,
        to: ".skillset/rules/new.txt",
      })
    ).rejects.toThrow("cannot cross authored source surfaces");
    await expect(
      planSourceRename({
        from: ".skillset/_claude/native.md",
        rootPath: root,
        to: ".skillset/_claude/renamed.md",
      })
    ).rejects.toThrow("cannot rename files in preserved _claude source");
  });

  test("atomically renames source and regenerates managed outputs", async () => {
    const root = await fixture({
      ".skillset/shared/old.txt": "old\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\nresources:\n  templates:\n    - shared:old.txt\n---\n\n{{@shared:old.txt}}\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await chmod(join(root, ".skillset/shared/old.txt"), 0o755);
    await buildSkillset(root);
    const preview = await planSourceRename({
      from: ".skillset/shared/old.txt",
      rootPath: root,
      to: ".skillset/shared/new.txt",
    });
    expect(preview.generatedOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "update",
          path: ".claude/skills/demo/SKILL.md",
        }),
      ])
    );
    expect(preview.generatedOperations).toContainEqual(
      expect.objectContaining({
        kind: "create",
        mode: 0o755,
        path: ".claude/skills/demo/templates/new.txt",
      })
    );

    const report = await renameSource({
      expectedPlanHash: preview.planHash,
      from: preview.from,
      rootPath: root,
      to: preview.to,
    });

    expect(report.applied).toBe(true);
    expect(
      await readFile(join(root, ".skillset/shared/new.txt"), "utf-8")
    ).toBe("old\n");
    await expect(
      access(join(root, ".skillset/shared/old.txt"))
    ).rejects.toThrow();
    expect(
      await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf-8")
    ).toContain("templates/new.txt");
    if (process.platform !== "win32") {
      expect(
        (await stat(join(root, ".claude/skills/demo/templates/new.txt"))).mode &
          0o777
      ).toBe(0o755);
    }
  });

  test("rejects stale previews and edited generated output without mutation", async () => {
    const root = await fixture({
      ".skillset/shared/old.txt": "old\n",
      ".skillset/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\nDemo\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/shared/old.txt",
      rootPath: root,
      to: ".skillset/shared/new.txt",
    };
    const preview = await planSourceRename(request);
    await expect(
      renameSource({ ...request, expectedPlanHash: "stale" })
    ).rejects.toThrow("plan changed since preview");

    await writeFile(
      join(root, ".claude/skills/demo/SKILL.md"),
      "locally edited\n"
    );
    await expect(
      renameSource({ ...request, expectedPlanHash: preview.planHash })
    ).rejects.toThrow("generated output is not current");
    expect(
      await readFile(join(root, ".skillset/shared/old.txt"), "utf-8")
    ).toBe("old\n");
    await expect(
      access(join(root, ".skillset/shared/new.txt"))
    ).rejects.toThrow();
  });

  test("rolls back source and generated output after a late failure", async () => {
    const root = await fixture({
      ".skillset/agents/reviewer.md":
        "---\ndescription: Reviewer\nskills: [old]\n---\n\nReview\n",
      ".skillset/skills/old/SKILL.md":
        "---\nname: old\ndescription: Old\n---\n\nOld\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);
    const generatedBefore = await readFile(
      join(root, ".claude/skills/old/SKILL.md")
    );
    const request = {
      from: ".skillset/skills/old",
      rootPath: root,
      to: ".skillset/skills/new",
    };
    const preview = await planSourceRename(request);

    await expect(
      renameSource({
        ...request,
        expectedPlanHash: preview.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: (operation) => {
              if (
                operation.kind === "write" &&
                operation.path === ".claude/skills/new/SKILL.md"
              ) {
                throw new Error("injected generated write failure");
              }
            },
          },
        },
      })
    ).rejects.toThrow("injected generated write failure");

    expect(
      await readFile(join(root, ".skillset/skills/old/SKILL.md"), "utf-8")
    ).toContain("name: old");
    await expect(access(join(root, ".skillset/skills/new"))).rejects.toThrow();
    expect(await readFile(join(root, ".claude/skills/old/SKILL.md"))).toEqual(
      generatedBefore
    );
    await expect(access(join(root, ".claude/skills/new"))).rejects.toThrow();
  });

  test("preview reports generated moves and refuses unmanaged collisions", async () => {
    const root = await fixture({
      ".skillset/skills/old/SKILL.md":
        "---\nname: old\ndescription: Old\n---\n\nOld\n",
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);
    const request = {
      from: ".skillset/skills/old",
      rootPath: root,
      to: ".skillset/skills/new",
    };
    const preview = await planSourceRename(request);
    expect(preview.generatedOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "create",
          path: ".claude/skills/new/SKILL.md",
        }),
        expect.objectContaining({
          kind: "delete",
          path: ".claude/skills/old/SKILL.md",
        }),
      ])
    );

    await mkdir(join(root, ".claude/skills/new"), { recursive: true });
    await writeFile(join(root, ".claude/skills/new/SKILL.md"), "unmanaged\n");
    await expect(planSourceRename(request)).rejects.toThrow(
      "generated destination is unmanaged"
    );
  });

  test("shadow preview includes repo-relative plugin feature sources", async () => {
    const root = await fixture({
      ".skillset/partials/old.md": "Old\n",
      ".skillset/plugins/tools/skills/demo/SKILL.md":
        "---\nname: demo\ndescription: Demo\n---\n\nDemo\n",
      ".skillset/plugins/tools/skillset.yaml":
        "skillset:\n  name: tools\nmcp:\n  source: repo:integrations/tools-mcp.json\n",
      "integrations/tools-mcp.json": '{"mcpServers":{}}\n',
      "skillset.yaml":
        "skillset:\n  name: rename-fixture\ncompile:\n  targets: [claude]\n",
    });
    await buildSkillset(root);

    const plan = await planSourceRename({
      from: ".skillset/partials/old.md",
      rootPath: root,
      to: ".skillset/partials/new.md",
    });

    expect(plan.operations).toContainEqual({
      from: ".skillset/partials/old.md",
      kind: "move",
      to: ".skillset/partials/new.md",
    });
  });
});

async function fixture(
  files: Readonly<Record<string, string>>
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-source-rename-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
  return root;
}
