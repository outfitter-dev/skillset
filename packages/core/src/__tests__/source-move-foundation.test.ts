/* eslint-disable func-style, no-await-in-loop, no-use-before-define, sort-keys -- Focused source-move fixtures stay adjacent to their scenarios. */
/* eslint-disable unicorn/import-style -- Named path helpers keep fixture setup concise. */

import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChangeLedgerEvent } from "../change-ledger";
import { readAppliedChangeRecords } from "../change-history";
import {
  currentSourceHashEvidence,
  currentSourceIdentities,
  sourceIdentityMappings,
} from "../source-identity-mapping";
import { readReleaseState, writeReleaseState } from "../release-state";
import { planSourceMove } from "../source-move";
import { rewriteSourceMoveConfig } from "../source-move-rewrite";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

describe("source move foundations", () => {
  test("folds append-only identity mappings through history scopes and evidence", () => {
    const mappings = sourceIdentityMappings([
      moved("skill:demo", "plugin.tools.skill:demo"),
      moved("plugin.tools.skill:demo", "skill:demo"),
    ]);
    expect(currentSourceIdentities(["skill:demo"], mappings)).toEqual([
      "skill:demo",
    ]);
    expect(
      currentSourceHashEvidence(
        new Map([["plugin.tools.skill:demo", ["sha256:old"]]]),
        mappings
      )
    ).toEqual(new Map([["skill:demo", ["sha256:old"]]]));
  });

  test("resolves pre-move release state through chained current identities", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const ledger = [
      {
        createdAt: "2026-09-17T00:00:00.000Z",
        id: "release",
        payload: {
          releaseId: "release-1",
          reasonIds: ["change-1"],
          scopes: [
            {
              bump: "minor",
              entries: ["change-1"],
              selector: "skill:demo",
              sourceHash: digest,
              version: "1.0.0",
            },
          ],
        },
        schemaVersion: 1,
        type: "release.applied",
      },
      {
        createdAt: "2026-09-17T00:00:00.001Z",
        id: "outward",
        payload: { from: "skill:demo", to: "plugin.tools.skill:demo" },
        schemaVersion: 1,
        type: "source.moved",
      },
      {
        createdAt: "2026-09-17T00:00:00.002Z",
        id: "homeward",
        payload: { from: "plugin.tools.skill:demo", to: "skill:demo" },
        schemaVersion: 1,
        type: "source.moved",
      },
    ].map((event) => JSON.stringify(event)).join("\n");
    const root = await fixture({
      ".skillset/changes/ledger.jsonl": `${ledger}\n`,
    });

    expect(await readReleaseState(root)).toEqual({
      scopes: {
        "skill:demo": {
          sourceHash: digest,
          updatedAt: "2026-09-17T00:00:00.000Z",
          version: "1.0.0",
        },
      },
    });
  });

  test("keeps a reused selector's later release separate from the moved skill", async () => {
    const oldHash = `sha256:${"a".repeat(64)}`;
    const newHash = `sha256:${"b".repeat(64)}`;
    const events = [
      release("old-release", "skill:demo", oldHash, "1.0.0", "2026-09-17T00:00:00.000Z"),
      {
        createdAt: "2026-09-17T00:00:00.001Z",
        id: "move",
        payload: { from: "skill:demo", to: "plugin.tools.skill:demo" },
        schemaVersion: 1,
        type: "source.moved",
      },
      release("new-release", "skill:demo", newHash, "1.0.0", "2026-09-17T00:00:00.002Z"),
    ];
    const root = await fixture({
      ".skillset/changes/ledger.jsonl": `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
    expect(await readReleaseState(root)).toEqual({
      scopes: {
        "plugin.tools.skill:demo": {
          sourceHash: oldHash,
          updatedAt: "2026-09-17T00:00:00.000Z",
          version: "1.0.0",
        },
        "skill:demo": {
          sourceHash: newHash,
          updatedAt: "2026-09-17T00:00:00.002Z",
          version: "1.0.0",
        },
      },
    });
  });

  test("keeps pre-move and post-move history separate after selector reuse", async () => {
    const oldHash = `sha256:${"a".repeat(64)}`;
    const newHash = `sha256:${"b".repeat(64)}`;
    const history = [
      { id: "old", scopes: ["skill:demo"], evidence: [{ scope: "skill:demo", sourceHash: oldHash }] },
      { id: "new", sourceMoveCursor: "move", scopes: ["skill:demo"], evidence: [{ scope: "skill:demo", sourceHash: newHash }] },
    ];
    const root = await fixture({
      ".skillset/changes/history.jsonl": `${history.map((record) => JSON.stringify(record)).join("\n")}\n`,
      ".skillset/changes/ledger.jsonl": `${JSON.stringify({ createdAt: "2026-09-17T00:00:00.001Z", id: "move", payload: { from: "skill:demo", to: "plugin.tools.skill:demo" }, schemaVersion: 1, type: "source.moved" })}\n`,
    });
    const records = await readAppliedChangeRecords(root);
    expect(records.map((record) => [record.id, record.scopes, [...record.sourceHashes]])).toEqual([
      ["new", ["skill:demo"], [["skill:demo", [newHash]]]],
      ["old", ["plugin.tools.skill:demo"], [["plugin.tools.skill:demo", [oldHash]]]],
    ]);
    const unknown = await fixture({
      ".skillset/changes/history.jsonl": `${JSON.stringify({ id: "new", sourceMoveCursor: "missing", scopes: ["skill:demo"] })}\n`,
      ".skillset/changes/ledger.jsonl": `${JSON.stringify({ createdAt: "2026-09-17T00:00:00.001Z", id: "move", payload: { from: "skill:demo", to: "plugin.tools.skill:demo" }, schemaVersion: 1, type: "source.moved" })}\n`,
    });
    await expect(readAppliedChangeRecords(unknown)).rejects.toThrow("unknown source move cursor missing");
  });

  test("remaps legacy cache but respects the move cursor of a later snapshot", async () => {
    const old = { version: "1.0.0" };
    const newer = { version: "2.0.0" };
    const ledger = `${JSON.stringify({ createdAt: "2026-09-17T00:00:00.001Z", id: "move", payload: { from: "skill:demo", to: "plugin.tools.skill:demo" }, schemaVersion: 1, type: "source.moved" })}\n`;
    const legacy = await fixture({
      ".skillset/changes/ledger.jsonl": ledger,
      ".skillset/changes/state.json": JSON.stringify({ schemaVersion: 1, scopes: { "skill:demo": old } }),
    });
    expect(await readReleaseState(legacy)).toEqual({ scopes: { "plugin.tools.skill:demo": old } });

    const current = await fixture({ ".skillset/changes/ledger.jsonl": ledger });
    await writeReleaseState(current, { scopes: { "plugin.tools.skill:demo": old, "skill:demo": newer } });
    expect(JSON.parse(await Bun.file(join(current, ".skillset/changes/state.json")).text())).toMatchObject({
      schemaVersion: 2,
      sourceMoveCursor: "move",
    });
    expect(await readReleaseState(current)).toEqual({ scopes: { "plugin.tools.skill:demo": old, "skill:demo": newer } });
    const unknown = await fixture({
      ".skillset/changes/ledger.jsonl": ledger,
      ".skillset/changes/state.json": JSON.stringify({ schemaVersion: 2, sourceMoveCursor: "missing", scopes: { "skill:demo": newer } }),
    });
    await expect(readReleaseState(unknown)).rejects.toThrow("unknown source move cursor missing");
  });

  test("follows a second move without absorbing a reused original selector", async () => {
    const events = [
      release("old-release", "skill:demo", `sha256:${"a".repeat(64)}`, "1.0.0", "2026-09-17T00:00:00.000Z"),
      { createdAt: "2026-09-17T00:00:00.001Z", id: "move-1", payload: { from: "skill:demo", to: "plugin.tools.skill:demo" }, schemaVersion: 1, type: "source.moved" },
      release("new-release", "skill:demo", `sha256:${"b".repeat(64)}`, "2.0.0", "2026-09-17T00:00:00.002Z"),
      { createdAt: "2026-09-17T00:00:00.003Z", id: "move-2", payload: { from: "plugin.tools.skill:demo", to: "plugin.other.skill:demo" }, schemaVersion: 1, type: "source.moved" },
    ];
    const root = await fixture({
      ".skillset/changes/ledger.jsonl": `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    });
    expect(await readReleaseState(root)).toMatchObject({
      scopes: {
        "plugin.other.skill:demo": { version: "1.0.0" },
        "skill:demo": { version: "2.0.0" },
      },
    });
  });

  test("a later move overwrites stale cached state at its destination", async () => {
    const events = [
      { createdAt: "2026-09-17T00:00:00.001Z", id: "move-1", payload: { from: "skill:demo", to: "plugin.tools.skill:demo" }, schemaVersion: 1, type: "source.moved" },
      { createdAt: "2026-09-17T00:00:00.002Z", id: "move-2", payload: { from: "plugin.tools.skill:demo", to: "skill:demo" }, schemaVersion: 1, type: "source.moved" },
    ];
    const root = await fixture({
      ".skillset/changes/ledger.jsonl": `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      ".skillset/changes/state.json": JSON.stringify({
        schemaVersion: 2,
        sourceMoveCursor: "move-1",
        scopes: {
          "plugin.tools.skill:demo": { version: "1.0.0" },
          "skill:demo": { version: "2.0.0" },
        },
      }),
    });
    expect(await readReleaseState(root)).toEqual({ scopes: { "skill:demo": { version: "1.0.0" } } });
  });

  test("rewrites root selectors and removes explicit internal-use selections", () => {
    const source = `drafts:\n  - plugin.tools.skill:demo\ndistributions:\n  docs:\n    from:\n      selector: plugin.tools.skill:demo\n      target: codex\n    to:\n      kind: local\nplugins:\n  internal_use:\n    skills:\n      tools: [demo, keep]\n    drafts:\n      tools: [\"!demo\"]\n`;
    const result = rewriteSourceMoveConfig(source, "skillset.yaml", {
      fromSelector: "plugin.tools.skill:demo",
      internalUsePluginId: "tools",
      leaf: "demo",
      rootDocument: true,
      sourcePluginDocument: false,
      toSelector: "skill:demo",
    });
    expect(result.removedInternalUse).toBe(true);
    expect(result.content).toContain("- skill:demo");
    expect(result.content).toContain("selector: skill:demo");
    expect(result.content).toContain("tools:\n        - keep");
    expect(result.content).not.toContain("!demo");
  });

  test("plans a workspace-to-plugin move with paired draft and identity history without writes", async () => {
    const root = await fixture({
      ".skillset/subagents/reviewer.md": `---\nname: reviewer\ndescription: Review.\nskills: [demo]\n---\n\nReview.\n`,
      ".skillset/plugins/tools/skillset.yaml": `skillset:\n  name: tools\n`,
      ".skillset/skills/_drafts/demo/SKILL.md": skill("demo", "Draft demo."),
      ".skillset/skills/demo/SKILL.md": skill("demo", "Demo."),
      "skillset.yaml": `skillset:\n  name: move-fixture\ncompile:\n  targets: [codex]\n`,
    });

    const plan = await planSourceMove({
      from: ".skillset/skills/demo",
      rootPath: root,
      to: ".skillset/plugins/tools/skills/demo",
    });

    expect(plan.kind).toBe("workspace-to-plugin");
    expect(plan.operations).toContainEqual({
      from: ".skillset/skills/demo",
      kind: "move",
      to: ".skillset/plugins/tools/skills/demo",
    });
    expect(plan.operations).toContainEqual({
      from: ".skillset/skills/_drafts/demo",
      kind: "move",
      to: ".skillset/plugins/tools/skills/_drafts/demo",
    });
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining("plugin.tools.skill:demo"),
        kind: "update",
        path: ".skillset/subagents/reviewer.md",
      })
    );
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('"type":"source.moved"'),
        kind: "update",
        path: ".skillset/changes/ledger.jsonl",
      })
    );
    expect(
      await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".skillset/skills/demo/SKILL.md")).exists()
    ).toBe(true);
  });
});

function moved(from: string, to: string): ChangeLedgerEvent {
  return {
    createdAt: "2026-09-17T00:00:00.000Z",
    id: `${from}->${to}`,
    line: 1,
    path: ".skillset/changes/ledger.jsonl",
    payload: { from, to },
    schemaVersion: 1,
    sourceUnits: [],
    type: "source.moved",
  };
}

function release(id: string, selector: string, sourceHash: string, version: string, createdAt: string) {
  return {
    createdAt,
    id,
    payload: {
      releaseId: id,
      reasonIds: [id],
      scopes: [{ bump: "minor", entries: [id], selector, sourceHash, version }],
    },
    schemaVersion: 1,
    type: "release.applied",
  };
}

function skill(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`;
}

async function fixture(
  files: Readonly<Record<string, string>>
): Promise<string> {
  const root = await createTestFixtureRoot("skillset-source-move-");
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
  return root;
}
