import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readAppliedChangeRecords as readCoreAppliedChangeRecords } from "@skillset/core/internal/change-history";
import { renderChangelogProjections } from "@skillset/core/internal/changelog";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { addChangeEntry, readAppliedChangeRecords, readChangeHistory, showChangeEntry } from "../change-workflow";

const HASH = `sha256:${"a".repeat(64)}`;

describe("applied change history (SET-652)", () => {
  // Records written before the SET-53 selector cutover keep their original
  // scope strings; reading them normalizes to the current selectors.
  test("reads pre-SET-53 history selectors as current selectors", async () => {
    const root = await fixture({
      ".skillset/changes/history.jsonl": jsonl(
        { appliedAt: "2026-01-01T00:00:00.000Z", id: "aaaaaaaaaaaa", reason: "Root.", scope: "root-config" },
        {
          appliedAt: "2026-01-01T00:00:00.000Z",
          evidence: [{ scope: "standalone-skill:demo", sourceHash: HASH }],
          id: "bbbbbbbbbbbb",
          reason: "Skill.",
          scopes: ["standalone-skill:demo", "plugin-skill:tools/helper"],
        },
        {
          appliedAt: "2026-01-01T00:00:00.000Z",
          id: "cccccccccccc",
          reason: "Components.",
          scopes: ["plugin-config:tools", "plugin-companion:tools/bin/run", "target-native-island:claude:project:notes.md"],
        }
      ),
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      "skillset.yaml": "skillset:\n  name: history-compat\n",
    });

    const records = await readAppliedChangeRecords(root);
    expect(records.map((record) => [record.id, record.scopes])).toEqual([
      ["aaaaaaaaaaaa", ["config:root"]],
      ["bbbbbbbbbbbb", ["plugin.tools.skill:helper", "skill:demo"]],
      ["cccccccccccc", ["claude.notesmd:notes.md", "plugin.tools.companion:bin/run", "plugin.tools.config:root"]],
    ]);
    expect(records.find((record) => record.id === "bbbbbbbbbbbb")?.sourceHashes).toEqual(new Map([["skill:demo", [HASH]]]));
    expect(records).toEqual(await readCoreAppliedChangeRecords(root));
  });

  test("keeps retired selectors invalid for new pending entries", async () => {
    const root = await fixture({
      ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill.\n---\n\nDemo.\n",
      "skillset.yaml": "skillset:\n  name: history-compat\n",
    });

    await expect(addChangeEntry(root, {
      bump: "patch",
      reason: { kind: "inline", value: "A reason long enough to pass validation for this entry." },
      scopes: ["standalone-skill:demo"],
    })).rejects.toThrow();
  });

  test("CLI history and the generated changelog agree after a move and an amendment", async () => {
    const root = await fixture({
      ".skillset/changes/amendments.jsonl": jsonl({
        amendedAt: "2026-01-03T00:00:00.000Z",
        id: "dddddddddddd",
        previousReason: "Original reason.",
        reason: "Amended reason.",
        source: ".skillset/changes/history.jsonl:1",
      }),
      ".skillset/changes/history.jsonl": jsonl({
        appliedAt: "2026-01-01T00:00:00.000Z",
        bump: "patch",
        evidence: [{ scope: "standalone-skill:demo", sourceHash: HASH }],
        id: "dddddddddddd",
        reason: "Original reason.",
        scopes: ["standalone-skill:demo"],
      }),
      ".skillset/changes/ledger.jsonl": jsonl({
        createdAt: "2026-01-02T00:00:00.000Z",
        id: "source-moved-1",
        payload: { from: "skill:demo", to: "plugin.tools.skill:demo" },
        schemaVersion: 1,
        type: "source.moved",
      }),
      ".skillset/plugins/tools/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill.\n---\n\nDemo.\n",
      ".skillset/plugins/tools/skillset.yaml": "skillset:\n  name: tools\n",
      "skillset.yaml": "skillset:\n  name: history-parity\n",
    });

    const shown = (await showChangeEntry(root, { ref: "@dddddd" })).entry;
    expect(shown).toMatchObject({ reason: "Amended reason.", scopes: ["plugin.tools.skill:demo"], status: "history" });
    expect((await readChangeHistory(root)).entries).toEqual([shown]);

    const changelogs = await renderChangelogProjections(await loadBuildGraph(root));
    expect(changelogs.map((changelog) => [changelog.entityKind, changelog.entityId])).toEqual([["plugin", "tools"]]);
    const markdown = new TextDecoder().decode(changelogs[0]?.file.content);
    expect(markdown).toContain("Amended reason.");
    expect(markdown).not.toContain("Original reason.");
  });
});

function jsonl(...records: readonly object[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-history-parity-");
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}
