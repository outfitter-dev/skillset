import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withLockProvenance } from "@skillset/core/internal/lock-provenance";

import { sourceInventoryFromLock } from "../change-status";

test("change status reads a provenance-valid v3 source inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-current-lock-reader-"));
  await writeFile(
    join(root, "skillset.lock"),
    JSON.stringify(
      withLockProvenance({
        generatedBy: "skillset@0.1.0",
        items: [],
        outputRoot: ".",
        schemaVersion: 3,
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

test("change status diagnoses pre-v3 workspace state as rebuild-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-current-lock-reader-"));
  await writeFile(
    join(root, "skillset.lock"),
    JSON.stringify({ schemaVersion: 2 }),
    "utf8"
  );

  await expect(sourceInventoryFromLock(root, {})).rejects.toThrow(
    "uses pre-v3 schema 2; this generated state is rebuild-only"
  );
});
