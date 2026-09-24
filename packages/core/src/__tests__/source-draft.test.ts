/* eslint-disable func-style, no-await-in-loop, no-use-before-define, sort-keys -- Lifecycle fixtures stay adjacent to their scenarios. */

import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { buildSkillset } from "../build";
import { readChangeLedger } from "../change-ledger";
import { supportsGeneratedFileModes } from "../generated-file-mode";
import {
  draftSource,
  planSourceDraft,
  planSourcePromotion,
  promoteSource,
  SourceDraftPlanError,
  SourcePromotionPlanError,
} from "../source-draft";
import { moveSource, planSourceMove } from "../source-move";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

describe("SET-587 source draft lifecycle", () => {
  test("plans and atomically copies a shipped skill with fork provenance", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      ".skillset/skills/demo/scripts/tool.sh": "#!/bin/sh\necho demo\n",
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const shippedPath = ".skillset/skills/demo";
    const draftPath = ".skillset/skills/_drafts/demo";
    const before = await treeBytes(join(root, shippedPath));

    const plan = await planSourceDraft({ rootPath: root, shippedPath });

    expect(plan).toMatchObject({
      action: "draft",
      draftSelector: "skill:demo#draft",
      from: shippedPath,
      selector: "skill:demo",
      to: draftPath,
      warnings: [],
    });
    expect(plan.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(plan.operations).toContainEqual({
      from: shippedPath,
      kind: "copy",
      to: draftPath,
    });
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('"type":"source.drafted"'),
        kind: "update",
        path: ".skillset/changes/ledger.jsonl",
      })
    );
    expect(plan.generatedOperations).toContainEqual(
      expect.objectContaining({
        kind: "create",
        path: ".agents/skills/draft-demo/SKILL.md",
      })
    );
    expect(await Bun.file(join(root, draftPath, "SKILL.md")).exists()).toBe(
      false
    );
    expect(
      await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()
    ).toBe(false);

    const report = await draftSource({
      expectedPlanHash: plan.planHash,
      rootPath: root,
      shippedPath,
    });

    expect(report.applied).toBe(true);
    expect(await treeBytes(join(root, shippedPath))).toEqual(before);
    expect(await treeBytes(join(root, draftPath))).toEqual(before);
    expect(await readFile(join(root, draftPath, "SKILL.md"), "utf8")).toContain(
      "name: demo"
    );
    expect(
      await Bun.file(join(root, ".agents/skills/draft-demo/SKILL.md")).exists()
    ).toBe(true);
    const events = await readChangeLedger(root);
    expect(events.at(-1)).toMatchObject({
      payload: {
        draft: "skill:demo#draft",
        shipped: "skill:demo",
        sourceHash: plan.sourceHash,
      },
      type: "source.drafted",
    });
  });

  test("refuses an existing draft sibling without changing it", async () => {
    const draft = skill("demo", "Existing unfinished draft.");
    const root = await fixture({
      ".skillset/skills/_drafts/demo/SKILL.md": draft,
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });

    await expect(
      planSourceDraft({
        rootPath: root,
        shippedPath: ".skillset/skills/demo",
      })
    ).rejects.toBeInstanceOf(SourceDraftPlanError);
    await expect(
      planSourceDraft({
        rootPath: root,
        shippedPath: ".skillset/skills/demo",
      })
    ).rejects.toThrow(
      "draft sibling already exists: .skillset/skills/_drafts/demo"
    );
    expect(
      await readFile(
        join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
        "utf8"
      )
    ).toBe(draft);
    expect(
      await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()
    ).toBe(false);
  });

  test("promotes a paired edited draft and preserves the shipped selector", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      ".skillset/skills/keep/SKILL.md": skill("keep", "Unrelated skill."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const unrelated = await readFile(
      join(root, ".agents/skills/keep/SKILL.md")
    );
    const fork = await planSourceDraft({
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await draftSource({
      expectedPlanHash: fork.planHash,
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    const promoted = skill("demo", "Promoted draft.");
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      promoted
    );
    await buildSkillset(root);

    const plan = await planSourcePromotion({
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    });

    expect(plan).toMatchObject({
      action: "promote",
      baselineSourceHash: fork.sourceHash,
      changedSinceDraft: false,
      draftSelector: "skill:demo#draft",
      from: ".skillset/skills/_drafts/demo",
      kind: "paired",
      selector: "skill:demo",
      to: ".skillset/skills/demo",
      warnings: [],
    });
    expect(plan.diff.join("\n")).toContain("--- shipped/SKILL.md");
    expect(plan.diff.join("\n")).toContain("+++ draft/SKILL.md");
    expect(plan.diff.join("\n")).toContain("+description: Promoted draft.");
    expect(plan.operations).toContainEqual({
      kind: "delete",
      path: ".skillset/skills/demo",
    });

    await promoteSource({
      draftPath: ".skillset/skills/_drafts/demo",
      expectedPlanHash: plan.planHash,
      rootPath: root,
    });

    expect(
      await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")
    ).toBe(promoted);
    await expect(
      access(join(root, ".skillset/skills/_drafts/demo"))
    ).rejects.toThrow();
    expect(
      await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")
    ).toContain("Promoted draft.");
    expect(
      await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")
    ).not.toContain("[SKILLSET DRAFT]");
    expect(await readFile(join(root, ".agents/skills/keep/SKILL.md"))).toEqual(
      unrelated
    );
    await expect(
      access(join(root, ".agents/skills/draft-demo"))
    ).rejects.toThrow();
    const events = await readChangeLedger(root);
    expect(events.map((event) => event.type)).toEqual([
      "source.drafted",
      "source.promoted",
    ]);
    expect(events.at(-1)).toMatchObject({
      payload: {
        draft: "skill:demo#draft",
        draftEventId: events[0]?.id,
        shipped: "skill:demo",
      },
      type: "source.promoted",
    });
    const lock = await readFile(
      join(root, ".agents/skills/skillset.lock"),
      "utf8"
    );
    expect(lock).not.toContain("draft-demo");
    expect(lock).not.toContain('"draftOrigin"');
  });

  test("promotes a moved draft by its fork event without lending the baseline to a reused selector", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Original shipped."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const forkRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(forkRequest);
    await draftSource({ ...forkRequest, expectedPlanHash: fork.planHash });
    const moveRequest = {
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    };
    const move = await planSourceMove(moveRequest);
    await moveSource({ ...moveRequest, expectedPlanHash: move.planHash });

    await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      skill("demo", "Reused shipped.")
    );
    await mkdir(join(root, ".skillset/skills/_drafts/demo"), {
      recursive: true,
    });
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      skill("demo", "Reused draft.")
    );
    const reused = await planSourcePromotion({
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    });
    expect(reused.changedSinceDraft).toBeNull();
    expect(reused).not.toHaveProperty("baselineSourceHash");
    expect(reused).not.toHaveProperty("draftEventId");
    expect(reused.warnings).toContainEqual(
      expect.stringContaining("no recorded fork baseline for skill:demo#draft")
    );
    await buildSkillset(root);

    const movedPromotion = await planSourcePromotion({
      draftPath: ".skillset/plugins/tools/skills/_drafts/demo",
      rootPath: root,
    });
    expect(movedPromotion).toMatchObject({
      baselineSourceHash: fork.sourceHash,
      draftEventId: (await readChangeLedger(root))[0]?.id,
      kind: "paired",
    });
    await promoteSource({
      draftPath: movedPromotion.from,
      expectedPlanHash: movedPromotion.planHash,
      rootPath: root,
    });
  });

  test("forks, renders, and promotes a paired plugin draft without publishing draft bytes", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skills/demo/SKILL.md": skill(
        "demo",
        "Plugin shipped."
      ),
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      "skillset.yaml": `${config()}plugins:\n  internal_use:\n    skills:\n      tools: [demo]\n`,
    });
    await buildSkillset(root);
    const publishedBefore = await treeBytes(join(root, "plugins/tools"));
    const request = {
      rootPath: root,
      shippedPath: ".skillset/plugins/tools/skills/demo",
    };
    const fork = await planSourceDraft(request);
    await draftSource({ ...request, expectedPlanHash: fork.planHash });
    await writeFile(
      join(root, ".skillset/plugins/tools/skills/_drafts/demo/SKILL.md"),
      skill("demo", "Plugin promoted.")
    );
    await buildSkillset(root);

    expect(await treeBytes(join(root, "plugins/tools"))).toEqual(
      publishedBefore
    );
    const renderedDraft = await readFile(
      join(root, ".agents/skills/draft-demo/SKILL.md"),
      "utf8"
    );
    expect(renderedDraft).toContain("[SKILLSET DRAFT] Plugin promoted.");
    expect(renderedDraft).toContain("internal: true");

    const promotion = await planSourcePromotion({
      draftPath: ".skillset/plugins/tools/skills/_drafts/demo",
      rootPath: root,
    });
    expect(promotion).toMatchObject({
      draftSelector: "plugin.tools.skill:demo#draft",
      kind: "paired",
      selector: "plugin.tools.skill:demo",
    });
    await promoteSource({
      draftPath: promotion.from,
      expectedPlanHash: promotion.planHash,
      rootPath: root,
    });

    await expect(
      access(join(root, ".skillset/plugins/tools/skills/_drafts/demo"))
    ).rejects.toThrow();
    expect(
      await readFile(
        join(root, ".skillset/plugins/tools/skills/demo/SKILL.md"),
        "utf8"
      )
    ).toContain("Plugin promoted.");
    const renderedLive = await readFile(
      join(root, ".agents/skills/demo/SKILL.md"),
      "utf8"
    );
    expect(renderedLive).toContain("Plugin promoted.");
    expect(renderedLive).not.toContain("[SKILLSET DRAFT]");
    await expect(
      access(join(root, ".agents/skills/draft-demo"))
    ).rejects.toThrow();
    const packagePaths = await filesBelow(join(root, "plugins/tools"));
    expect(packagePaths.some((path) => path.includes("draft-demo"))).toBe(
      false
    );
  });

  test("warns when the shipped sibling changed after the fork and still applies", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Original shipped."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const fork = await planSourceDraft({
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await draftSource({
      expectedPlanHash: fork.planHash,
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      skill("demo", "Draft edit.")
    );
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      skill("demo", "Concurrent shipped edit.")
    );
    await buildSkillset(root);

    const plan = await planSourcePromotion({
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    });

    expect(plan.changedSinceDraft).toBe(true);
    expect(plan.warnings).toEqual([
      "shipped skill skill:demo changed since the draft was taken; promotion will replace the current authored bytes",
    ]);
    expect(plan.diff.join("\n")).toContain(
      "-description: Concurrent shipped edit."
    );
    await promoteSource({
      draftPath: ".skillset/skills/_drafts/demo",
      expectedPlanHash: plan.planHash,
      rootPath: root,
    });
    expect(
      await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")
    ).toContain("Draft edit.");
  });

  test("reports a shipped-only mode change in the authored promotion diff", async () => {
    if (!supportsGeneratedFileModes()) return;
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const fork = await planSourceDraft({
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await draftSource({
      expectedPlanHash: fork.planHash,
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await chmod(join(root, ".skillset/skills/demo/SKILL.md"), 0o755);
    await buildSkillset(root);

    const plan = await planSourcePromotion({
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    });

    expect(plan.changedSinceDraft).toBe(true);
    expect(plan.diff).toEqual([
      "diff --skillset SKILL.md",
      "old mode 100755",
      "new mode 100644",
    ]);
  });

  test("reports a draft-only mode change in the authored promotion diff", async () => {
    if (!supportsGeneratedFileModes()) return;
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const fork = await planSourceDraft({
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await draftSource({
      expectedPlanHash: fork.planHash,
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    });
    await chmod(join(root, ".skillset/skills/_drafts/demo/SKILL.md"), 0o755);
    await buildSkillset(root);

    const plan = await planSourcePromotion({
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    });

    expect(plan.changedSinceDraft).toBe(false);
    expect(plan.diff).toEqual([
      "diff --skillset SKILL.md",
      "old mode 100644",
      "new mode 100755",
    ]);
  });

  test("promotes an unpaired plugin draft without borrowing a same-leaf workspace baseline", async () => {
    const workspace = skill("future", "Independent workspace skill.");
    const draft = skill("future", "Plugin future draft.");
    const root = await fixture({
      ".skillset/plugins/tools/skills/_drafts/future/SKILL.md": draft,
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/future/SKILL.md": workspace,
      "skillset.yaml": config(),
    });
    await buildSkillset(root);

    const plan = await planSourcePromotion({
      draftPath: ".skillset/plugins/tools/skills/_drafts/future",
      rootPath: root,
    });

    expect(plan).toMatchObject({
      changedSinceDraft: null,
      draftSelector: "plugin.tools.skill:future#draft",
      kind: "unpaired",
      selector: "plugin.tools.skill:future",
      warnings: [],
    });
    expect(plan).not.toHaveProperty("baselineSourceHash");
    await promoteSource({
      draftPath: ".skillset/plugins/tools/skills/_drafts/future",
      expectedPlanHash: plan.planHash,
      rootPath: root,
    });
    expect(
      await readFile(
        join(root, ".skillset/plugins/tools/skills/future/SKILL.md"),
        "utf8"
      )
    ).toBe(draft);
    expect(
      await readFile(join(root, ".skillset/skills/future/SKILL.md"), "utf8")
    ).toBe(workspace);
  });

  test("warns and diffs a manually paired draft without a recorded fork", async () => {
    const root = await fixture({
      ".skillset/skills/_drafts/demo/SKILL.md": skill("demo", "Manual draft."),
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });

    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    expect(plan).toMatchObject({
      changedSinceDraft: null,
      kind: "paired",
      warnings: [
        expect.stringContaining("no recorded fork baseline for skill:demo#draft"),
      ],
    });
    expect(plan).not.toHaveProperty("baselineSourceHash");
    expect(plan).not.toHaveProperty("draftEventId");
    expect(plan.diff.join("\n")).toContain("-description: Shipped demo.");
    expect(plan.diff.join("\n")).toContain("+description: Manual draft.");
    await promoteSource({ ...request, expectedPlanHash: plan.planHash });
    expect(
      await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")
    ).toContain("Manual draft.");
    expect((await readChangeLedger(root)).at(-1)).toMatchObject({
      payload: { draft: "skill:demo#draft", shipped: "skill:demo" },
      type: "source.promoted",
    });
  });

  test("refuses invalid lifecycle sources and blocked generated effects without writes", async () => {
    const root = await fixture({
      ".skillset/shared/not-a-skill/input.txt": "not a skill\n",
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    await expect(
      planSourceDraft({
        rootPath: root,
        shippedPath: ".skillset/shared/not-a-skill",
      })
    ).rejects.toThrow("source must be a complete shipped skill directory");
    await expect(
      planSourcePromotion({
        draftPath: ".skillset/shared/not-a-skill",
        rootPath: root,
      })
    ).rejects.toThrow("source must be an _drafts skill directory");

    await mkdir(join(root, ".agents/skills/draft-demo"), { recursive: true });
    await writeFile(
      join(root, ".agents/skills/draft-demo/SKILL.md"),
      "unmanaged\n"
    );
    await expect(
      planSourceDraft({
        rootPath: root,
        shippedPath: ".skillset/skills/demo",
      })
    ).rejects.toThrow(/unmanaged|collision/u);
    expect(
      await Bun.file(
        join(root, ".skillset/skills/_drafts/demo/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()
    ).toBe(false);
  });

  test("restores an exact paired workspace after an interrupted promotion", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({
      ...draftRequest,
      expectedPlanHash: fork.planHash,
    });
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      skill("demo", "Interrupted promotion.")
    );
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const before = await treeBytes(root);

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: (operation) => {
              if (
                operation.kind === "write" &&
                operation.path === ".skillset/changes/ledger.jsonl"
              ) {
                throw new Error("injected promotion ledger failure");
              }
            },
          },
        },
      })
    ).rejects.toThrow("injected promotion ledger failure");
    expect(await treeBytes(root)).toEqual(before);
  });

  test("rejects stale plans and rolls back a copied draft after a late failure", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const request = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const plan = await planSourceDraft(request);
    await expect(
      draftSource({ ...request, expectedPlanHash: "stale" })
    ).rejects.toThrow("plan changed since preview");
    await expect(
      draftSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: (operation) => {
              if (
                operation.kind === "write" &&
                operation.path === ".skillset/changes/ledger.jsonl"
              ) {
                throw new Error("injected draft ledger failure");
              }
            },
          },
        },
      })
    ).rejects.toThrow("injected draft ledger failure");
    expect(
      await Bun.file(join(root, ".skillset/skills/demo/SKILL.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(
        join(root, ".skillset/skills/_drafts/demo/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()
    ).toBe(false);
  });

  test("refuses a shipped source change after the draft plan is approved", async () => {
    const original = skill("demo", "Shipped demo.");
    const raced = skill("demo", "Raced shipped demo.");
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": original,
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const request = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const plan = await planSourceDraft(request);
    const rendered = await readFile(join(root, ".agents/skills/demo/SKILL.md"));
    const lock = await readFile(join(root, ".agents/skills/skillset.lock"));

    await expect(
      draftSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeInitialInspection: () =>
              writeFile(join(root, ".skillset/skills/demo/SKILL.md"), raced),
          },
        },
      })
    ).rejects.toThrow(
      "source tree changed since planning: .skillset/skills/demo"
    );
    expect(
      await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")
    ).toBe(raced);
    expect(
      await Bun.file(
        join(root, ".skillset/skills/_drafts/demo/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()
    ).toBe(false);
    expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"))).toEqual(
      rendered
    );
    expect(await readFile(join(root, ".agents/skills/skillset.lock"))).toEqual(
      lock
    );
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("refuses a draft source change after the promotion plan is approved", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({ ...draftRequest, expectedPlanHash: fork.planHash });
    const previewed = skill("demo", "Previewed draft.");
    const raced = skill("demo", "Raced draft.");
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      previewed
    );
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"));
    const rendered = await readFile(
      join(root, ".agents/skills/draft-demo/SKILL.md")
    );
    const lock = await readFile(join(root, ".agents/skills/skillset.lock"));

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeInitialInspection: () =>
              writeFile(
                join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
                raced
              ),
          },
        },
      })
    ).rejects.toThrow(
      "source tree changed since planning: .skillset/skills/_drafts/demo"
    );
    expect(
      await readFile(
        join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
        "utf8"
      )
    ).toBe(raced);
    expect(
      await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")
    ).toContain("Shipped demo.");
    expect(
      await readFile(join(root, ".skillset/changes/ledger.jsonl"))
    ).toEqual(ledger);
    expect(
      await readFile(join(root, ".agents/skills/draft-demo/SKILL.md"))
    ).toEqual(rendered);
    expect(await readFile(join(root, ".agents/skills/skillset.lock"))).toEqual(
      lock
    );
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("refuses a paired shipped change after the promotion plan is approved", async () => {
    const original = skill("demo", "Shipped demo.");
    const raced = skill("demo", "Raced paired shipped demo.");
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": original,
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({ ...draftRequest, expectedPlanHash: fork.planHash });
    const previewedDraft = skill("demo", "Previewed draft.");
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      previewedDraft
    );
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"));
    const renderedDraft = await readFile(
      join(root, ".agents/skills/draft-demo/SKILL.md")
    );
    const renderedShipped = await readFile(
      join(root, ".agents/skills/demo/SKILL.md")
    );
    const lock = await readFile(join(root, ".agents/skills/skillset.lock"));

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeInitialInspection: () =>
              writeFile(join(root, ".skillset/skills/demo/SKILL.md"), raced),
          },
        },
      })
    ).rejects.toThrow(
      "source tree changed since planning: .skillset/skills/demo"
    );
    expect(
      await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")
    ).toBe(raced);
    expect(
      await readFile(
        join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
        "utf8"
      )
    ).toBe(previewedDraft);
    expect(
      await readFile(join(root, ".skillset/changes/ledger.jsonl"))
    ).toEqual(ledger);
    expect(
      await readFile(join(root, ".agents/skills/draft-demo/SKILL.md"))
    ).toEqual(renderedDraft);
    expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"))).toEqual(
      renderedShipped
    );
    expect(await readFile(join(root, ".agents/skills/skillset.lock"))).toEqual(
      lock
    );
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("refuses a paired promotion when its staged draft source reappears", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({ ...draftRequest, expectedPlanHash: fork.planHash });
    const previewedDraft = skill("demo", "Previewed paired draft.");
    const racedDraft = skill("demo", "Raced paired draft.");
    const draftPath = join(root, ".skillset/skills/_drafts/demo");
    await writeFile(join(draftPath, "SKILL.md"), previewedDraft);
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const before = await treeBytes(root);

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: async (operation) => {
              if (operation.kind !== "move") return;
              await mkdir(draftPath, { recursive: true });
              await writeFile(join(draftPath, "SKILL.md"), racedDraft);
            },
          },
        },
      })
    ).rejects.toThrow(
      "move source reappeared after preimage staging: " +
        ".skillset/skills/_drafts/demo"
    );
    expect(await treeBytes(root)).toEqual({
      ...before,
      ".skillset/skills/_drafts/demo/SKILL.md": Buffer.from(
        racedDraft
      ).toString("base64"),
    });
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("refuses an unpaired promotion when its staged draft source reappears", async () => {
    const previewedDraft = skill("demo", "Previewed unpaired draft.");
    const racedDraft = skill("demo", "Raced unpaired draft.");
    const root = await fixture({
      ".skillset/skills/_drafts/demo/SKILL.md": previewedDraft,
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const before = await treeBytes(root);
    const draftPath = join(root, request.draftPath);

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: async (operation) => {
              if (operation.kind !== "move") return;
              await mkdir(draftPath, { recursive: true });
              await writeFile(join(draftPath, "SKILL.md"), racedDraft);
            },
          },
        },
      })
    ).rejects.toThrow(
      "move source reappeared after preimage staging: " +
        ".skillset/skills/_drafts/demo"
    );
    expect(await treeBytes(root)).toEqual({
      ...before,
      ".skillset/skills/_drafts/demo/SKILL.md": Buffer.from(
        racedDraft
      ).toString("base64"),
    });
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("preserves a recreated paired shipped target without rollback residue", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({ ...draftRequest, expectedPlanHash: fork.planHash });
    await writeFile(
      join(root, ".skillset/skills/_drafts/demo/SKILL.md"),
      skill("demo", "Previewed paired draft.")
    );
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const before = await treeBytes(root);
    const racedShipped = skill("demo", "Raced paired shipped skill.");
    const shippedPath = join(root, ".skillset/skills/demo");

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeApply: async (operation) => {
              if (operation.kind !== "move") return;
              await mkdir(shippedPath, { recursive: true });
              await writeFile(join(shippedPath, "SKILL.md"), racedShipped);
            },
          },
        },
      })
    ).rejects.toThrow(
      "move target appeared before atomic install: .skillset/skills/demo"
    );
    expect(await treeBytes(root)).toEqual({
      ...before,
      ".skillset/skills/demo/SKILL.md": Buffer.from(racedShipped).toString(
        "base64"
      ),
    });
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("refuses a normalized mode change after the promotion plan is approved", async () => {
    if (!supportsGeneratedFileModes()) return;
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": skill("demo", "Shipped demo."),
      "skillset.yaml": config(),
    });
    await buildSkillset(root);
    const draftRequest = {
      rootPath: root,
      shippedPath: ".skillset/skills/demo",
    };
    const fork = await planSourceDraft(draftRequest);
    await draftSource({ ...draftRequest, expectedPlanHash: fork.planHash });
    await buildSkillset(root);
    const request = {
      draftPath: ".skillset/skills/_drafts/demo",
      rootPath: root,
    };
    const plan = await planSourcePromotion(request);
    const draftPath = join(root, ".skillset/skills/_drafts/demo/SKILL.md");

    await expect(
      promoteSource({
        ...request,
        expectedPlanHash: plan.planHash,
        transactionOptions: {
          testHooks: {
            beforeInitialInspection: () => chmod(draftPath, 0o755),
          },
        },
      })
    ).rejects.toThrow(
      "source tree changed since planning: .skillset/skills/_drafts/demo"
    );
    expect((await stat(draftPath)).mode & 0o777).toBe(0o755);
    expect(
      await Bun.file(join(root, ".skillset/skills/demo/SKILL.md")).exists()
    ).toBe(true);
    expect((await readChangeLedger(root)).map((event) => event.type)).toEqual([
      "source.drafted",
    ]);
    expect(await transactionJournals(root)).toEqual([]);
  });

  test("keeps draft and promotion application free of Git shell execution", async () => {
    for (const file of [
      "source-draft.ts",
      "source-rename-apply.ts",
      "workspace-transaction.ts",
    ]) {
      const source = await readFile(join(import.meta.dir, "..", file), "utf8");
      expect(source).not.toMatch(
        /Bun\.spawn|spawnSync|execFile|execa|node:child_process/u
      );
    }
  });
});

function config(): string {
  return "skillset:\n  name: draft-lifecycle\ncompile:\n  targets: [codex]\n";
}

function skill(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`;
}

async function fixture(
  files: Readonly<Record<string, string>>
): Promise<string> {
  const root = await createTestFixtureRoot("skillset-source-draft-");
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

async function filesBelow(root: string): Promise<readonly string[]> {
  const paths: string[] = [];
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else paths.push(relative(root, child).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return paths.toSorted();
}

async function treeBytes(
  root: string
): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(
    await Promise.all(
      (await filesBelow(root)).map(async (path) => [
        path,
        Buffer.from(await readFile(join(root, path))).toString("base64"),
      ])
    )
  );
}

async function transactionJournals(root: string): Promise<readonly string[]> {
  return (await readdir(root))
    .filter((entry) => entry.startsWith(".skillset-workspace-transaction-"))
    .toSorted();
}
