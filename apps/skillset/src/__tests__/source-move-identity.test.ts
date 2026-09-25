import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildSkillset, moveSource, planSourceMove } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { initializeTestGitRepository } from "../../../../scripts/test-helpers/git-remote";

import type { ChangeLedgerEvent } from "@skillset/core/internal/change-ledger";

import { changeCheck, movedAwaySourceChanges, readPendingChangeEntries } from "../change-entries";
import { planRelease } from "../release";
import { addChangeEntry, readAppliedChangeRecords, refreshChangeEvidence } from "../change-workflow";

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
