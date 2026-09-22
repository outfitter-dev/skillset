import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withLockProvenance } from "@skillset/core/internal/lock-provenance";
import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";

import { sourceInventoryFromLock } from "../change-status";

test("change status reads a provenance-valid v4 source inventory", async () => {
  const root = await createTestGitFixtureRoot("skillset-current-lock-reader-");
  await writeFile(
    join(root, "skillset.lock"),
    JSON.stringify(
      withLockProvenance({
        generatedBy: "skillset@0.1.0",
        items: [],
        outputRoot: ".",
        schemaVersion: 4,
        standardProfileEvidence: {},
        selectedStandards: [],
        selectedTargets: [],
        sourceInventory: {
          hashSchema: "skillset-source-unit-v3",
          units: [
            {
              hash: "sha256:source",
              id: "skill:demo",
              kind: "standalone-skill",
              sourcePath: ".skillset/skills/demo/SKILL.md",
            },
          ],
        },
        target: "workspace",
      })
    ),
    "utf8"
  );

  await expect(sourceInventoryFromLock(root, {})).resolves.toMatchObject({
    inventory: {
      hashSchema: "skillset-source-unit-v3",
      units: [
        {
          hash: "sha256:source",
          id: "skill:demo",
          kind: "standalone-skill",
          sourcePath: ".skillset/skills/demo/SKILL.md",
        },
      ],
    },
  });
});

test("change status diagnoses pre-v4 workspace state as rebuild-only", async () => {
  const root = await createTestGitFixtureRoot("skillset-current-lock-reader-");
  await writeFile(
    join(root, "skillset.lock"),
    JSON.stringify({ schemaVersion: 2 }),
    "utf8"
  );

  await expect(sourceInventoryFromLock(root, {})).rejects.toThrow(
    "workspace lock skillset.lock cannot guard generated state because uses pre-v4 schema 2; this generated state is rebuild-only"
  );
});

test("change status fails closed on corrupt workspace lock JSON", async () => {
  const root = await createTestGitFixtureRoot("skillset-current-lock-reader-");
  await writeFile(join(root, "skillset.lock"), "{ not valid json", "utf8");

  await expect(sourceInventoryFromLock(root, {})).rejects.toThrow(
    "workspace lock skillset.lock cannot guard generated state because it is not valid JSON"
  );
});
