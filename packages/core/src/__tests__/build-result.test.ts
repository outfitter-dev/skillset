import { describe, expect, it } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillsetResult, diffSkillsetResult, getSkillsetFeature, restoreOutputBackup } from "@skillset/core";

const DEMO_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: core-build-root
claude: true
codex: false
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
      reason: "unmanaged-collision",
      targetPath: "AGENTS.md",
    }));
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Generated Instructions");

    const preview = await restoreOutputBackup(root, backupRunId ?? "");
    expect(preview.write).toBe(false);
    expect(preview.restoredPaths).toEqual(["AGENTS.md"]);

    const restored = await restoreOutputBackup(root, backupRunId ?? "", { write: true });
    expect(restored.write).toBe(true);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Hand Authored Instructions");
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
      reason: "managed-target-edit",
      targetPath: outputPath,
    }));

    await restoreOutputBackup(root, backupRunId ?? "", { write: true });
    expect(await readFile(join(root, outputPath), "utf8")).toBe("hand edit\n");
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
