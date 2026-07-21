import { describe, expect, it } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillsetResult,
  diffSkillsetResult,
  getSkillsetFeature,
  inspectOutputBackups,
  restoreOutputBackup,
} from "@skillset/core";

const DEMO_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: core-build-root
claude: true
codex: false
cursor: false
`,
  ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
};

describe("buildSkillsetResult", () => {
  it("reports actual writes and deletions instead of planned managed paths", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/skills/stale/SKILL.md": `
---
name: stale
description: Stale skill.
---

Stale.
`,
    });
    const expectedOutput = ".claude/skills/demo/SKILL.md";
    const staleOutput = ".claude/skills/stale/SKILL.md";

    const first = await buildSkillsetResult(root);

    expect(first.writes.writtenPaths).toContain(expectedOutput);
    expect(first.writes.deletedPaths).toEqual([]);
    expect(first.writes.paths).toEqual(first.writes.writtenPaths);

    const second = await buildSkillsetResult(root);

    expect(second.writes).toEqual({
      deletedPaths: [],
      mode: "write",
      paths: [],
      writtenPaths: [],
    });

    await rm(join(root, ".skillset/skills/stale/SKILL.md"));
    const third = await buildSkillsetResult(root);

    expect(third.writes.writtenPaths).toEqual([".claude/skills/skillset.lock"]);
    expect(third.writes.deletedPaths).toEqual([staleOutput]);
    expect(third.writes.paths).toEqual([".claude/skills/skillset.lock", staleOutput]);
  });

  it("backs up unmanaged collisions and restores the original safely", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: unmanaged-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": `
# Generated Instructions
`,
      "AGENTS.md": `
# Hand Authored Instructions
`,
    });

    const result = await buildSkillsetResult(root);
    const backupRunId = result.writes.backupRunId;

    expect(backupRunId).toBeString();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unmanaged-output-collision",
      featureId: "output-safety",
      outputPath: "AGENTS.md",
      severity: "warning",
    }));
    expectKnownDiagnosticFeatureIds(result.diagnostics);
    expect(result.writes.backupManifestPath).toBe(`.skillset/snapshots/${backupRunId}/manifest.json`);
    expect(result.writes.backupRecords).toContainEqual(expect.objectContaining({
      action: "overwrite",
      backupPath: "files/AGENTS.md",
      reason: "unmanaged-collision",
      targetPath: "AGENTS.md",
    }));
    const manifest = JSON.parse(await readFile(join(root, `.skillset/snapshots/${backupRunId}/manifest.json`), "utf8")) as {
      readonly schemaVersion?: number;
      readonly storage?: { readonly commit?: string; readonly gitDir?: string; readonly kind?: string };
    };
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.storage).toEqual(expect.objectContaining({
      commit: expect.stringMatching(/^[a-f0-9]{40,64}$/),
      gitDir: `.skillset/snapshots/${backupRunId}/git`,
      kind: "git",
    }));
    expect(await Bun.file(join(root, `.skillset/snapshots/${backupRunId}/git/config`)).exists()).toBe(true);
    expect(await Bun.file(join(root, `.skillset/snapshots/${backupRunId}/files/AGENTS.md`)).exists()).toBe(false);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Generated Instructions");

    const preview = await restoreOutputBackup(root, backupRunId ?? "");
    expect(preview.write).toBe(false);
    expect(preview.restoredPaths).toEqual(["AGENTS.md"]);

    const restored = await restoreOutputBackup(root, backupRunId ?? "", { write: true });
    expect(restored.write).toBe(true);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Hand Authored Instructions");
  });

  it("lists no backups without creating the missing snapshot root", async () => {
    const root = await fixture(DEMO_FIXTURE);

    expect(await inspectOutputBackups(root)).toEqual({ runs: [] });
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
  });

  it("lists valid backups and records in deterministic order", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: ordered-backups
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Generated Instructions\n",
      "AGENTS.md": "# First hand-authored instructions\n",
    });
    const first = await buildSkillsetResult(root);
    await Bun.write(join(root, "AGENTS.md"), "# Second hand-authored instructions\n");
    const second = await buildSkillsetResult(root);

    const inspection = await inspectOutputBackups(root);
    const expectedRunIds = [first.writes.backupRunId, second.writes.backupRunId]
      .filter((runId): runId is string => runId !== undefined)
      .toSorted();

    expect(inspection.runs.map((run) => run.runId)).toEqual(expectedRunIds);
    expect(inspection.runs).toEqual(expect.arrayContaining(expectedRunIds.map((runId) => expect.objectContaining({
      manifestPath: `.skillset/snapshots/${runId}/manifest.json`,
      records: [expect.objectContaining({
        action: "overwrite",
        state: "restorable-now",
        targetPath: "AGENTS.md",
      })],
      state: "restorable-now",
    }))));
    const selected = inspection.runs.find((run) => run.state === "restorable-now");
    expect(selected).toBeDefined();
    await expect(restoreOutputBackup(root, selected?.runId ?? "")).resolves.toMatchObject({
      runId: selected?.runId,
      write: false,
    });
  });

  it("blocks overwrite and delete backups whose targets have reappeared or changed", async () => {
    const overwriteRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: blocked-overwrite
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Generated Instructions\n",
      "AGENTS.md": "# Hand Authored Instructions\n",
    });
    const overwrite = await buildSkillsetResult(overwriteRoot);
    await Bun.write(join(overwriteRoot, "AGENTS.md"), "# Changed after backup\n");

    const overwriteInspection = await inspectOutputBackups(overwriteRoot);
    expect(overwriteInspection.runs).toContainEqual(expect.objectContaining({
      runId: overwrite.writes.backupRunId,
      records: [expect.objectContaining({
        state: "blocked-by-current-target",
        targetPath: "AGENTS.md",
      })],
      state: "blocked-by-current-target",
    }));

    const deleteRoot = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/skills/stale/SKILL.md": "---\nname: stale\ndescription: Stale skill.\n---\n\nStale.\n",
    });
    await buildSkillsetResult(deleteRoot);
    await Bun.write(join(deleteRoot, ".claude/skills/stale/SKILL.md"), "hand edit\n");
    await rm(join(deleteRoot, ".skillset/skills/stale/SKILL.md"));
    const deletion = await buildSkillsetResult(deleteRoot);
    await Bun.write(join(deleteRoot, ".claude/skills/stale/SKILL.md"), "reappeared\n");

    const deleteInspection = await inspectOutputBackups(deleteRoot);
    expect(deleteInspection.runs).toContainEqual(expect.objectContaining({
      runId: deletion.writes.backupRunId,
      records: [expect.objectContaining({
        action: "delete",
        state: "blocked-by-current-target",
        targetPath: ".claude/skills/stale/SKILL.md",
      })],
      state: "blocked-by-current-target",
    }));
  });

  it("isolates corrupt sibling backups and reports malformed manifests, missing stores, and invalid payload hashes", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: corrupt-backups
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Generated Instructions\n",
      "AGENTS.md": "# Hand Authored Instructions\n",
    });
    const valid = await buildSkillsetResult(root);
    const validRunId = valid.writes.backupRunId ?? "";
    await mkdir(join(root, ".skillset/snapshots/badbeef1"), { recursive: true });
    await Bun.write(join(root, ".skillset/snapshots/badbeef1/manifest.json"), "{}\n");

    const malformedInspection = await inspectOutputBackups(root);
    expect(malformedInspection.runs).toContainEqual(expect.objectContaining({
      runId: validRunId,
      state: "restorable-now",
    }));
    expect(malformedInspection.runs).toContainEqual(expect.objectContaining({
      runId: "badbeef1",
      records: [],
      state: "corrupt-or-unavailable",
    }));

    const validManifestPath = join(root, `.skillset/snapshots/${validRunId}/manifest.json`);
    const validManifest = JSON.parse(await readFile(validManifestPath, "utf8")) as { records: unknown[] };
    validManifest.records.push({});
    await Bun.write(validManifestPath, `${JSON.stringify(validManifest)}\n`);
    const malformedSiblingInspection = await inspectOutputBackups(root);
    expect(malformedSiblingInspection.runs).toContainEqual(expect.objectContaining({
      runId: validRunId,
      records: expect.arrayContaining([
        expect.objectContaining({ state: "restorable-now", targetPath: "AGENTS.md" }),
        expect.objectContaining({ state: "corrupt-or-unavailable" }),
      ]),
      state: "corrupt-or-unavailable",
    }));

    await rm(join(root, `.skillset/snapshots/${validRunId}/git`), { force: true, recursive: true });
    const missingStoreInspection = await inspectOutputBackups(root);
    expect(missingStoreInspection.runs).toContainEqual(expect.objectContaining({
      runId: validRunId,
      detail: expect.stringContaining("backup git store is missing"),
      records: expect.arrayContaining([expect.objectContaining({
        action: "overwrite",
        state: "corrupt-or-unavailable",
        targetPath: "AGENTS.md",
      })]),
      state: "corrupt-or-unavailable",
    }));

    const emptyRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: empty-backup
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Generated Instructions\n",
      "AGENTS.md": "# Hand Authored Instructions\n",
    });
    const emptyBackup = await buildSkillsetResult(emptyRoot);
    const emptyRunId = emptyBackup.writes.backupRunId ?? "";
    const emptyManifestPath = join(emptyRoot, `.skillset/snapshots/${emptyRunId}/manifest.json`);
    const emptyManifest = JSON.parse(await readFile(emptyManifestPath, "utf8")) as {
      generatedBy: string;
      records: unknown[];
    };
    emptyManifest.generatedBy = "foreign@1.0.0";
    await Bun.write(emptyManifestPath, `${JSON.stringify(emptyManifest)}\n`);
    const foreignInspection = await inspectOutputBackups(emptyRoot);
    expect(foreignInspection.runs).toContainEqual(expect.objectContaining({
      detail: expect.stringContaining("invalid generatedBy binding"),
      records: [],
      runId: emptyRunId,
      state: "corrupt-or-unavailable",
    }));

    emptyManifest.generatedBy = "skillset@0.1.0";
    emptyManifest.records = [];
    await Bun.write(emptyManifestPath, `${JSON.stringify(emptyManifest)}\n`);

    const emptyInspection = await inspectOutputBackups(emptyRoot);
    expect(emptyInspection.runs).toContainEqual(expect.objectContaining({
      detail: expect.stringContaining("has no records"),
      records: [],
      runId: emptyRunId,
      state: "corrupt-or-unavailable",
    }));

    const hashRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-payload-hash
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Generated Instructions\n",
      "AGENTS.md": "# Hand Authored Instructions\n",
    });
    const hashBackup = await buildSkillsetResult(hashRoot);
    const hashRunId = hashBackup.writes.backupRunId ?? "";
    const manifestPath = join(hashRoot, `.skillset/snapshots/${hashRunId}/manifest.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { records: Array<{ originalHash: string }> };
    manifest.records[0]!.originalHash = `sha256:${"0".repeat(64)}`;
    await Bun.write(manifestPath, `${JSON.stringify(manifest)}\n`);

    const hashInspection = await inspectOutputBackups(hashRoot);
    expect(hashInspection.runs).toContainEqual(expect.objectContaining({
      runId: hashRunId,
      records: [expect.objectContaining({
        detail: expect.stringContaining("backup payload hash changed"),
        state: "corrupt-or-unavailable",
      })],
      state: "corrupt-or-unavailable",
    }));
  });

  it("reports unmanaged collisions before writing backups", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: unmanaged-preview-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": `
# Generated Instructions
`,
      "AGENTS.md": `
# Hand Authored Instructions
`,
    });

    const preview = await diffSkillsetResult(root);

    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "unmanaged-output-collision",
      featureId: "output-safety",
      message: expect.stringContaining("will be backed up"),
      outputPath: "AGENTS.md",
      severity: "warning",
    }));
    expectKnownDiagnosticFeatureIds(preview.diagnostics);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Hand Authored Instructions");
  });

  it("backs up target-side edits before replacing managed output", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const outputPath = ".claude/skills/demo/SKILL.md";

    await buildSkillsetResult(root);
    await Bun.write(join(root, outputPath), "hand edit\n");

    const result = await buildSkillsetResult(root);
    const backupRunId = result.writes.backupRunId;

    expect(backupRunId).toBeString();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      featureId: "output-safety",
      outputPath,
      severity: "warning",
    }));
    expect(result.writes.backupRecords).toContainEqual(expect.objectContaining({
      action: "overwrite",
      backupPath: `files/${outputPath}`,
      reason: "managed-target-edit",
      sourcePath: ".skillset/skills/demo/SKILL.md",
      targetPath: outputPath,
    }));

    const manifest = JSON.parse(await readFile(join(root, `.skillset/snapshots/${backupRunId}/manifest.json`), "utf8")) as {
      readonly records: readonly unknown[];
    };
    expect(manifest.records).toContainEqual(expect.objectContaining({
      backupPath: `files/${outputPath}`,
      sourcePath: ".skillset/skills/demo/SKILL.md",
      targetPath: outputPath,
    }));
    expect(await inspectOutputBackups(root)).toEqual(expect.objectContaining({
      runs: expect.arrayContaining([expect.objectContaining({
        records: expect.arrayContaining([expect.objectContaining({
          state: "restorable-now",
          targetPath: outputPath,
        })]),
        runId: backupRunId,
        state: "restorable-now",
      })]),
    }));
    await expect(restoreOutputBackup(root, backupRunId ?? "")).resolves.toMatchObject({
      restoredPaths: [outputPath],
      write: false,
    });

    await restoreOutputBackup(root, backupRunId ?? "", { write: true });
    expect(await readFile(join(root, outputPath), "utf8")).toBe("hand edit\n");
  });

  it("rejects platform-specific and escaping backup manifest record paths", async () => {
    const root = await fixture(DEMO_FIXTURE);
    const outputPath = ".claude/skills/demo/SKILL.md";

    await buildSkillsetResult(root);
    await Bun.write(join(root, outputPath), "hand edit\n");
    const backup = await buildSkillsetResult(root);
    const backupRunId = backup.writes.backupRunId ?? "";
    const manifestPath = join(root, `.skillset/snapshots/${backupRunId}/manifest.json`);
    const original = JSON.parse(await readFile(manifestPath, "utf8")) as {
      records: Array<{ backupPath: string; sourcePath?: string; targetPath: string }>;
    };
    const unsafePaths = ["C:/escape", "//server/share", "nested\\file.md", "nested/../file.md"];

    for (const unsafePath of unsafePaths) {
      const manifest = structuredClone(original);
      manifest.records[0]!.backupPath = `files/${unsafePath}`;
      manifest.records[0]!.targetPath = unsafePath;
      await Bun.write(manifestPath, `${JSON.stringify(manifest)}\n`);
      const inspection = await inspectOutputBackups(root);
      expect(inspection.runs).toContainEqual(expect.objectContaining({
        runId: backupRunId,
        state: "corrupt-or-unavailable",
      }));
    }

    for (const unsafePath of unsafePaths) {
      const manifest = structuredClone(original);
      manifest.records[0]!.sourcePath = unsafePath;
      await Bun.write(manifestPath, `${JSON.stringify(manifest)}\n`);
      const inspection = await inspectOutputBackups(root);
      expect(inspection.runs).toContainEqual(expect.objectContaining({
        runId: backupRunId,
        state: "corrupt-or-unavailable",
      }));
    }
  });

  it("backs up edited multi-file outputs even when a sibling output is missing", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: multi-file-root
claude: true
codex: false
`,
      ".skillset/shared/references/common.md": `
# Common Reference
`,
      ".skillset/skills/resourceful/SKILL.md": `
---
name: resourceful
description: Resourceful skill.
resources:
  references:
    - shared:references/common.md
---

Read [common](shared:references/common.md).
`,
    });
    const outputPath = ".claude/skills/resourceful/SKILL.md";
    const siblingPath = ".claude/skills/resourceful/references/common.md";

    await buildSkillsetResult(root);
    await Bun.write(join(root, outputPath), "hand edit\n");
    await rm(join(root, siblingPath));

    const result = await buildSkillsetResult(root);
    const backupRunId = result.writes.backupRunId;

    expect(backupRunId).toBeString();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath,
      severity: "warning",
    }));
    expect(result.writes.backupRecords).toContainEqual(expect.objectContaining({
      action: "overwrite",
      reason: "managed-target-edit",
      targetPath: outputPath,
    }));

    await restoreOutputBackup(root, backupRunId ?? "", { write: true });
    expect(await readFile(join(root, outputPath), "utf8")).toBe("hand edit\n");
  });

  it("leaves unrelated unmanaged files inside output roots alone", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      "skillset.yaml": `
skillset:
  name: core-build-root
compile:
  build: all
claude: true
codex: false
`,
    });
    const unmanagedPath = ".claude/skills/notes.txt";
    await Bun.write(join(root, unmanagedPath), "keep me\n");

    await buildSkillsetResult(root);

    expect(await readFile(join(root, unmanagedPath), "utf8")).toBe("keep me\n");
  });

  it("validates skill, agent, and instruction frontmatter with the shared schemas", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: shared-frontmatter-root
claude: true
codex: true
`,
      ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews project changes.
skills:
  - demo
codex:
  model: gpt-5-codex
claude:
  model: sonnet
---

Review the change.
`,
      ".skillset/rules/root.md": `
---
name: root
dialect: claude
claude:
  paths:
    - src/**
---

# Project Instructions
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
dependencies:
  plugins:
    - plugin:base
metadata:
  generated: skillset@0.1.0
  version: 1.0.0
supports:
  packages: []
codex:
  model: gpt-5-codex
---

Body.
`,
    });

    const result = await buildSkillsetResult(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.writes.writtenPaths).toEqual(expect.arrayContaining([
      ".agents/skills/demo/SKILL.md",
      ".claude/agents/reviewer.md",
      ".claude/rules/root.md",
      ".codex/agents/reviewer.toml",
      "AGENTS.md",
    ]));
  });

  it("rejects invalid workspace config metadata through the shared schema", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-workspace-metadata
  origin:
    repo: outfitter-dev/skillset
claude: true
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow("skillset.yaml.skillset.origin.path must be a non-empty string");
  });

  it("rejects invalid plugin config metadata through the shared schema", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-plugin-metadata-root
claude: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  preprocess: sometimes
`,
      ".skillset/plugins/demo/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(".skillset/plugins/demo/skillset.yaml.skillset.preprocess must be a boolean");
  });

  it("rejects invalid skill frontmatter through the shared schema", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
metadata: generated-by-hand
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow("frontmatter failed schema validation");
    await expect(buildSkillsetResult(root)).rejects.toThrow("metadata must be an object");
  });

  it("rejects invalid agent frontmatter through the shared schema", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-agent-frontmatter
claude: true
`,
      ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews project changes.
skills: demo
---

Review the change.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow("frontmatter failed schema validation");
    await expect(buildSkillsetResult(root)).rejects.toThrow("skills must be a string array");
  });

  it("rejects invalid instruction frontmatter through the shared schema", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-instruction-frontmatter
codex: true
`,
      ".skillset/rules/root.md": `
---
paths:
  - 1
---

# Project Instructions
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow("frontmatter failed schema validation");
    await expect(buildSkillsetResult(root)).rejects.toThrow("paths entries must be strings");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-core-build-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

function expectKnownDiagnosticFeatureIds(
  diagnostics: readonly { readonly featureId?: string }[]
): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.featureId !== undefined) {
      expect(getSkillsetFeature(diagnostic.featureId)?.id).toBe(diagnostic.featureId);
    }
  }
}
