import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildSkillset, moveSource, planSourceMove } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { initializeTestGitRepository } from "../../../../scripts/test-helpers/git-remote";

import { changeCheck, readPendingChangeEntries } from "../change-entries";
import { migratePendingChangeEntries, readAppliedChangeRecords, refreshChangeEvidence } from "../change-workflow";

describe("source move identity epochs", () => {
  test("keeps new evidence at a reused selector separate from pre-move evidence", async () => {
    const oldHash = `sha256:${"a".repeat(64)}`;
    const newHash = `sha256:${"b".repeat(64)}`;
    const oldId = "aaaaaaaaaaaa";
    const newId = "bbbbbbbbbbbb";
    const event = (id: string, type: string, payload: object) => JSON.stringify({
      createdAt: "2026-09-17T00:00:00.000Z",
      id,
      payload,
      schemaVersion: 1,
      type,
    });
    const ledger = [
      event("old-reason", "reason.created", { bump: "minor", reasonId: oldId, sourceUnits: [{ selector: "skill:demo", sourceHash: oldHash }] }),
      event("move", "source.moved", { from: "skill:demo", to: "plugin.tools.skill:demo" }),
      event("new-reason", "reason.created", { bump: "minor", reasonId: newId, sourceUnits: [{ selector: "skill:demo", sourceHash: newHash }] }),
    ];
    const history = [
      { id: oldId, scopes: ["skill:demo"], evidence: [{ scope: "skill:demo", sourceHash: oldHash }] },
      { id: newId, sourceMoveCursor: "move", scopes: ["skill:demo"], evidence: [{ scope: "skill:demo", sourceHash: newHash }] },
    ];
    const root = await createTestFixtureRoot("skillset-move-epochs-");
    for (const [path, content] of Object.entries({
      ".skillset/changes/ledger.jsonl": `${ledger.join("\n")}\n`,
      ".skillset/changes/history.jsonl": `${history.map((record) => JSON.stringify(record)).join("\n")}\n`,
      [`.skillset/changes/${oldId}.md`]: "Old reason.\n",
      [`.skillset/changes/${newId}.md`]: "New reason.\n",
      "skillset.yaml": "skillset:\n  name: move-fixture\n",
    })) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const historyRecords = await readAppliedChangeRecords(root);
    expect(historyRecords.map((record) => [record.id, record.scopes, [...record.sourceHashes]])).toEqual([
      [oldId, ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", [oldHash]]]],
      [newId, ["skill:demo"], [["skill:demo", [newHash]]]],
    ]);
    const pending = await readPendingChangeEntries(root);
    expect(pending.map((entry) => [entry.id, entry.scopes, [...entry.sourceHashes]])).toEqual([
      [oldId, ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", [oldHash]]]],
      [newId, ["skill:demo"], [["skill:demo", [newHash]]]],
    ]);
  });

  test("reads moved frontmatter evidence under the new selector in every evidence shape", async () => {
    const root = await createTestFixtureRoot("skillset-move-evidence-");
    for (const [path, content] of Object.entries({
      ".skillset/changes/aaaaaaaaaaaa.md": "---\nid: aaaaaaaaaaaa\nbump: patch\nscopes: [skill:demo, skill:keep]\nevidence:\n  - scope: skill:demo\n    sourceHash: sha256:array\n  - scope: skill:keep\n    sourceHash: sha256:keep\n---\n\nArray evidence.\n",
      ".skillset/changes/bbbbbbbbbbbb.md": "---\nid: bbbbbbbbbbbb\nbump: patch\nscopes: [skill:demo]\nevidence:\n  skill:demo:\n    hash: sha256:record\n---\n\nRecord map evidence.\n",
      ".skillset/changes/cccccccccccc.md": "---\nid: cccccccccccc\nbump: patch\nscopes: [skill:demo]\nevidence:\n  skill:demo: sha256:string\n---\n\nString map evidence.\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n",
      ".skillset/skills/keep/SKILL.md": "---\nname: keep\ndescription: Keep.\n---\n\nKeep.\n",
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    })) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await buildSkillset(root);
    const request = { from: ".skillset/skills/demo", rootPath: root, to: ".skillset/plugins/tools/skills/demo" };
    await moveSource({ ...request, expectedPlanHash: (await planSourceMove(request)).planHash });

    const pending = await readPendingChangeEntries(root);
    expect(pending.map((entry) => [entry.id, entry.scopes, [...entry.sourceHashes]])).toEqual([
      ["aaaaaaaaaaaa", ["plugin.tools.skill:demo", "skill:keep"], [["plugin.tools.skill:demo", ["sha256:array"]], ["skill:keep", ["sha256:keep"]]]],
      ["bbbbbbbbbbbb", ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", ["sha256:record"]]]],
      ["cccccccccccc", ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", ["sha256:string"]]]],
    ]);
  });

  test("leaves moved frontmatter evidence for migrate and refresh to re-record under the new identity", async () => {
    const disposableRoot = await createTestFixtureRoot("skillset-move-evidence-refresh-");
    const root = await mkdtemp(join(disposableRoot, "repo-"));
    const skill = (body: string): string => `---\nname: demo\ndescription: Demo skill.\n---\n\n${body}\n`;
    for (const [path, content] of Object.entries({
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      ".skillset/skills/demo/SKILL.md": skill("Demo."),
      "skillset.yaml": "skillset:\n  name: move-fixture\ncompile:\n  targets: [claude]\n",
    })) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await buildSkillset(root);
    await initializeTestGitRepository(root, { disposableRoot });
    await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), skill("Demo changed before the move."), "utf8");
    await buildSkillset(root);
    const id = "dddddddddddd";
    const path = `.skillset/changes/${id}.md`;
    const entryErrors = async (): Promise<readonly string[]> =>
      (await changeCheck(root)).issues
        .filter((issue) => issue.path === path && issue.severity === "error")
        .map((issue) => `${issue.code}: ${issue.message}`);
    const premoveHash = (await changeCheck(root)).status.sourceUnits.find((unit) => unit.id === "skill:demo")?.hash;
    if (premoveHash === undefined) throw new Error("expected a pre-move source unit for skill:demo");
    await mkdir(join(root, ".skillset/changes"), { recursive: true });
    await writeFile(
      join(root, path),
      `---\nid: ${id}\nbump: patch\nscopes: [skill:demo]\nevidence:\n  - scope: skill:demo\n    sourceHash: ${premoveHash}\n---\n\nDescribe the demo skill change with enough detail for validation.\n`,
      "utf8"
    );
    expect(await entryErrors()).toEqual([]);

    const request = { from: ".skillset/skills/demo", rootPath: root, to: ".skillset/plugins/tools/skills/demo" };
    const plan = await planSourceMove(request);
    expect(plan.notices).toEqual([
      "migrate frontmatter pending change entries with `skillset change migrate --yes` before `skillset change refresh` re-records their evidence",
      "pending change entries named skill:demo; source hashes bind a unit's identity, so run `skillset change refresh --yes` after the move to re-record their evidence for plugin.tools.skill:demo, or `skillset change refresh --ref <id> --yes` for one entry when unrelated uncovered changes block the workspace-wide refresh",
    ]);
    await moveSource({ ...request, expectedPlanHash: plan.planHash });

    // The pre-move hash stays as the attested evidence; the new identity makes it stale, which refresh repairs.
    expect(await entryErrors()).toEqual(["change-evidence-stale: scope skill(plugin:tools): demo source hash evidence is stale"]);
    await migratePendingChangeEntries(root, { write: true });
    await refreshChangeEvidence(root, { ref: id, write: true });
    expect(await entryErrors()).toEqual([]);
    const [entry] = await readPendingChangeEntries(root);
    expect(entry?.sourceHashes.get("plugin.tools.skill:demo")?.includes(premoveHash)).toBe(true);
    expect(entry?.sourceHashes.get("plugin.tools.skill:demo")?.length).toBe(2);
  });
});
