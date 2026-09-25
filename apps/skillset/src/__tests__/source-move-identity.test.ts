import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildSkillset, moveSource, planSourceMove } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { initializeTestGitRepository } from "../../../../scripts/test-helpers/git-remote";

import type { ChangeLedgerEvent } from "@skillset/core/internal/change-ledger";

import { changeCheck, movedAwaySourceChanges, readPendingChangeEntries } from "../change-entries";
import { planRelease } from "../release";
import { addChangeEntry, migratePendingChangeEntries, readAppliedChangeRecords, refreshChangeEvidence } from "../change-workflow";

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

  test("rewrites an authored pending change scope when its skill moves into a plugin", async () => {
    const skill = (body: string): string => `---\nname: demo\ndescription: Demo skill.\n---\n\n${body}\n`;
    const disposableRoot = await createTestFixtureRoot("skillset-move-pending-scope-");
    const root = await mkdtemp(join(disposableRoot, "repo-"));
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
    const added = await addChangeEntry(root, {
      bump: "patch",
      reason: { kind: "inline", value: "Describe the demo skill change with enough detail for validation." },
      scopes: ["skill:demo"],
    });
    expect(await readFile(join(root, added.entry.path), "utf8")).toContain("Scope: skill:demo");

    const request = { from: ".skillset/skills/demo", rootPath: root, to: ".skillset/plugins/tools/skills/demo" };
    const plan = await planSourceMove(request);
    await moveSource({ ...request, expectedPlanHash: plan.planHash });

    expect(await readFile(join(root, added.entry.path), "utf8")).toContain("Scope: plugin.tools.skill:demo");
    // Source hashes bind the unit's id and paths, so moved evidence needs the ordinary refresh.
    await refreshChangeEvidence(root, { ref: added.entry.id, write: true });
    const report = await changeCheck(root);
    expect(report.entries.map((entry) => entry.scopes)).toEqual([["plugin.tools.skill:demo"]]);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
    // Releasing the reason retires the moved-away selector too, so it does not resurface as removed.
    const release = await planRelease(root);
    expect(release.scopes.map((scope) => [scope.scope, scope.removed])).toEqual([
      ["plugin.tools.skill:demo", false],
      ["plugin:tools", false],
      ["skill:demo", true],
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
    // The notice's workspace-wide refresh works once the moved-away selector counts as covered.
    await refreshChangeEvidence(root, { write: true });
    expect(await entryErrors()).toEqual([]);
    const [entry] = await readPendingChangeEntries(root);
    expect(entry?.sourceHashes.get("plugin.tools.skill:demo")?.includes(premoveHash)).toBe(true);
    expect(entry?.sourceHashes.get("plugin.tools.skill:demo")?.length).toBe(2);
    expect((await changeCheck(root)).ok).toBe(true);
  });

  describe("moved-away coverage for a reused selector", () => {
    let line = 0;
    const move = (from: string, to: string): ChangeLedgerEvent => ({
      createdAt: "2026-09-17T00:00:00.000Z",
      id: `move-${++line}`,
      line,
      path: ".skillset/changes/ledger.jsonl",
      payload: { from, to },
      schemaVersion: 1,
      sourceUnits: [],
      type: "source.moved",
    });
    const release = (): ChangeLedgerEvent => ({
      createdAt: "2026-09-17T00:00:00.000Z",
      id: `release-${++line}`,
      line,
      path: ".skillset/changes/ledger.jsonl",
      payload: { changeIds: [], releaseId: `release-${line}`, scopes: [], sourceUnits: [] },
      schemaVersion: 1,
      sourceUnits: [],
      type: "release.applied",
    });

    test("follows the latest move of the removed selector", () => {
      const events = [move("skill:demo", "plugin.a.skill:demo"), move("skill:demo", "plugin.b.skill:demo")];
      const changes = [
        { id: "plugin.b.skill:demo", status: "added" },
        { id: "skill:demo", status: "removed" },
      ];
      expect(movedAwaySourceChanges(changes, ["plugin.b.skill:demo"], events)).toEqual([{ id: "skill:demo", status: "removed" }]);
      expect(movedAwaySourceChanges(changes, ["plugin.a.skill:demo"], events)).toEqual([]);
    });

    test("does not let a released move cover the removal of a unit that reused its name", () => {
      const events = [move("skill:demo", "plugin.a.skill:demo"), release()];
      const changes = [
        { id: "plugin.a.skill:demo", status: "changed" },
        { id: "skill:demo", status: "removed" },
      ];
      expect(movedAwaySourceChanges(changes, ["plugin.a.skill:demo"], events)).toEqual([]);
    });

    test("does not cover a removal when the move target is not newly added", () => {
      const events = [move("skill:demo", "plugin.a.skill:demo")];
      const changes = [
        { id: "plugin.a.skill:demo", status: "changed" },
        { id: "skill:demo", status: "removed" },
      ];
      expect(movedAwaySourceChanges(changes, ["plugin.a.skill:demo"], events)).toEqual([]);
    });

    test("follows a chain of moves inside the window", () => {
      const events = [move("skill:demo", "plugin.a.skill:demo"), move("plugin.a.skill:demo", "plugin.b.skill:demo")];
      const changes = [
        { id: "plugin.b.skill:demo", status: "added" },
        { id: "skill:demo", status: "removed" },
      ];
      expect(movedAwaySourceChanges(changes, ["plugin.b.skill:demo"], events)).toEqual([{ id: "skill:demo", status: "removed" }]);
      expect(movedAwaySourceChanges(changes, ["plugin.a.skill:demo"], events)).toEqual([]);
    });
  });
});
