import { describe, expect, it } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillsetResult,
  diffSkillsetResult,
  getSkillsetFeature,
  inspectOutputBackups,
  restoreOutputBackup,
} from "@skillset/core";
import { assertCasePortableRenderedPaths } from "../render";

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
  it("rolls back writes, modes, and stale deletions after a late transaction failure", async () => {
    if (process.platform === "win32") return;
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/scripts/run.sh": "#!/bin/sh\necho before\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  scripts:
    - shared:scripts/run.sh
---

Before.
`,
      ".skillset/skills/stale/SKILL.md": `
---
name: stale
description: Stale skill.
---

Stale.
`,
    });
    const sourceScript = join(root, ".skillset/shared/scripts/run.sh");
    const demoOutput = join(root, ".claude/skills/demo/SKILL.md");
    const scriptOutput = join(root, ".claude/skills/demo/scripts/run.sh");
    const staleOutput = join(root, ".claude/skills/stale/SKILL.md");
    await chmod(sourceScript, 0o755);
    await buildSkillsetResult(root);
    const before = {
      demo: await readFile(demoOutput),
      script: await readFile(scriptOutput),
      scriptMode: (await stat(scriptOutput)).mode & 0o777,
      stale: await readFile(staleOutput),
    };

    await Bun.write(
      join(root, ".skillset/skills/demo/SKILL.md"),
      `
---
name: demo
description: Demo skill.
resources:
  scripts:
    - shared:scripts/run.sh
---

After.
`
    );
    await chmod(sourceScript, 0o644);
    await rm(join(root, ".skillset/skills/stale/SKILL.md"));

    await expect(buildSkillsetResult(root, {}, {
      transactionOptions: {
        testHooks: {
          beforeApply: (operation) => {
            if (operation.kind === "delete") {
              throw new Error("injected failure before stale deletion commit");
            }
          },
        },
      },
    })).rejects.toThrow("injected failure before stale deletion commit");

    expect(await readFile(demoOutput)).toEqual(before.demo);
    expect(await readFile(scriptOutput)).toEqual(before.script);
    expect((await stat(scriptOutput)).mode & 0o777).toBe(before.scriptMode);
    expect(await readFile(staleOutput)).toEqual(before.stale);
    expect((await readdir(root)).filter((entry) =>
      entry.startsWith(".skillset-workspace-transaction-")
    )).toEqual([]);
  });

  it("applies case-only resource destination renames transactionally", async () => {
    if (process.platform === "win32") return;
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide.md": "Original guide.\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  references:
    - from: shared:references/guide.md
      to: references/Guide.md
---

Body.
`,
    });
    const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
    const sourceResourcePath = join(
      root,
      ".skillset/shared/references/guide.md"
    );
    const resourceDirectory = join(root, ".claude/skills/demo/references");
    const originalOutputPath = join(resourceDirectory, "Guide.md");
    await chmod(sourceResourcePath, 0o644);
    await buildSkillsetResult(root);
    expect(await readdir(resourceDirectory)).toEqual(["Guide.md"]);
    expect((await stat(originalOutputPath)).mode & 0o777).toBe(0o644);

    await Bun.write(
      sourcePath,
      (await readFile(sourcePath, "utf8")).replace(
        "to: references/Guide.md",
        "to: references/guide.md"
      )
    );
    await Bun.write(sourceResourcePath, "Updated guide.\n");
    await chmod(sourceResourcePath, 0o755);

    await expect(buildSkillsetResult(root, {}, {
      transactionOptions: {
        testHooks: {
          beforeApply: (operation) => {
            if (
              operation.kind === "write" &&
              operation.path === ".claude/skills/skillset.lock"
            ) {
              throw new Error(
                "injected failure after case-only replacement write"
              );
            }
          },
        },
      },
    })).rejects.toThrow(
      "injected failure after case-only replacement write"
    );
    expect(await readdir(resourceDirectory)).toEqual(["Guide.md"]);
    expect(await readFile(originalOutputPath, "utf8")).toBe(
      "Original guide.\n"
    );
    expect((await stat(originalOutputPath)).mode & 0o777).toBe(0o644);

    const result = await buildSkillsetResult(root);

    expect(await readdir(resourceDirectory)).toEqual(["guide.md"]);
    expect(
      await readFile(join(resourceDirectory, "guide.md"), "utf8")
    ).toBe("Updated guide.\n");
    expect(
      (await stat(join(resourceDirectory, "guide.md"))).mode & 0o777
    ).toBe(0o755);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "unmanaged-output-collision",
    }));
    expect(result.writes.deletedPaths).toContain(
      ".claude/skills/demo/references/Guide.md"
    );
    expect(result.writes.writtenPaths).toContain(
      ".claude/skills/demo/references/guide.md"
    );
    expect((await readdir(root)).filter((entry) =>
      entry.startsWith(".skillset-workspace-transaction-")
    )).toEqual([]);
  });

  it("rejects case-only ambiguous destinations before writing output", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide-a.md": "First guide.\n",
      ".skillset/shared/references/guide-b.md": "Second guide.\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  references:
    - from: shared:references/guide-a.md
      to: references/Guide.md
    - from: shared:references/guide-b.md
      to: references/guide.md
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "skillset: generated output destinations use case-conflicting paths and are not portable: " +
        ".claude/skills/demo/references/Guide.md and " +
        ".claude/skills/demo/references/guide.md " +
        "(prefixes .claude/skills/demo/references/Guide.md and " +
        ".claude/skills/demo/references/guide.md); rename one source destination"
    );

    expect(await Bun.file(join(root, ".claude")).exists()).toBe(false);
    expect((await readdir(root)).filter((entry) =>
      entry.startsWith(".skillset-workspace-transaction-")
    )).toEqual([]);
  });

  it("rejects case-only ambiguous directory components before writing output", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide-a.md": "First guide.\n",
      ".skillset/shared/references/guide-b.md": "Second guide.\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  references:
    - from: shared:references/guide-a.md
      to: references/Guide/a.md
    - from: shared:references/guide-b.md
      to: references/guide/b.md
---

Body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "skillset: generated output destinations use case-conflicting paths and are not portable: " +
        ".claude/skills/demo/references/Guide/a.md and " +
        ".claude/skills/demo/references/guide/b.md " +
        "(prefixes .claude/skills/demo/references/Guide and " +
        ".claude/skills/demo/references/guide); rename one source destination"
    );

    expect(await Bun.file(join(root, ".claude")).exists()).toBe(false);
    expect((await readdir(root)).filter((entry) =>
      entry.startsWith(".skillset-workspace-transaction-")
    )).toEqual([]);
  });

  it("detects case-only ambiguous Windows-style directory components", () => {
    expect(() => assertCasePortableRenderedPaths([
      ".claude\\skills\\demo\\references\\Guide\\a.md",
      ".claude\\skills\\demo\\references\\guide\\b.md",
    ])).toThrow(
      "skillset: generated output destinations use case-conflicting paths and are not portable: " +
        ".claude/skills/demo/references/Guide/a.md and " +
        ".claude/skills/demo/references/guide/b.md " +
        "(prefixes .claude/skills/demo/references/Guide and " +
        ".claude/skills/demo/references/guide); rename one source destination"
    );
  });

  it("applies managed file and directory output transitions transactionally", async () => {
    if (process.platform === "win32") return;
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide.md": "Original guide.\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  references:
    - from: shared:references/guide.md
      to: references/guide
---

Body.
`,
    });
    const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
    const sourceResourcePath = join(
      root,
      ".skillset/shared/references/guide.md"
    );
    const outputPath = join(
      root,
      ".claude/skills/demo/references/guide"
    );
    await chmod(sourceResourcePath, 0o644);
    await buildSkillsetResult(root);
    expect(await readFile(outputPath, "utf8")).toBe("Original guide.\n");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    await Bun.write(
      sourcePath,
      (await readFile(sourcePath, "utf8")).replace(
        "to: references/guide",
        "to: references/guide/page.md"
      )
    );
    await Bun.write(sourceResourcePath, "Nested guide.\n");
    await chmod(sourceResourcePath, 0o755);

    await expect(buildSkillsetResult(root, {}, {
      transactionOptions: {
        testHooks: {
          beforeApply: (operation) => {
            if (
              operation.kind === "write" &&
              operation.path === ".claude/skills/skillset.lock"
            ) {
              throw new Error("injected failure after file-to-directory write");
            }
          },
        },
      },
    })).rejects.toThrow("injected failure after file-to-directory write");
    expect(await readFile(outputPath, "utf8")).toBe("Original guide.\n");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    const nested = await buildSkillsetResult(root);
    const nestedOutputPath = join(outputPath, "page.md");
    expect(await readFile(nestedOutputPath, "utf8")).toBe("Nested guide.\n");
    expect((await stat(nestedOutputPath)).mode & 0o777).toBe(0o755);
    expect(nested.writes.deletedPaths).toContain(
      ".claude/skills/demo/references/guide"
    );
    expect(nested.writes.writtenPaths).toContain(
      ".claude/skills/demo/references/guide/page.md"
    );

    await Bun.write(
      sourcePath,
      (await readFile(sourcePath, "utf8")).replace(
        "to: references/guide/page.md",
        "to: references/guide"
      )
    );
    await Bun.write(sourceResourcePath, "Flat guide.\n");
    await chmod(sourceResourcePath, 0o644);

    await expect(buildSkillsetResult(root, {}, {
      transactionOptions: {
        testHooks: {
          beforeApply: (operation) => {
            if (
              operation.kind === "write" &&
              operation.path === ".claude/skills/skillset.lock"
            ) {
              throw new Error("injected failure after directory-to-file write");
            }
          },
        },
      },
    })).rejects.toThrow("injected failure after directory-to-file write");
    expect(await readFile(nestedOutputPath, "utf8")).toBe("Nested guide.\n");
    expect((await stat(nestedOutputPath)).mode & 0o777).toBe(0o755);

    const flat = await buildSkillsetResult(root);
    expect(await readFile(outputPath, "utf8")).toBe("Flat guide.\n");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);
    expect(flat.writes.deletedPaths).toContain(
      ".claude/skills/demo/references/guide/page.md"
    );
    expect(flat.writes.writtenPaths).toContain(
      ".claude/skills/demo/references/guide"
    );
    expect((await readdir(root)).filter((entry) =>
      entry.startsWith(".skillset-workspace-transaction-")
    )).toEqual([]);
  });

  it("refuses to replace a managed output directory containing unmanaged files", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide.md": "Nested guide.\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  references:
    - from: shared:references/guide.md
      to: references/guide/page.md
---

Body.
`,
    });
    const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
    const outputDirectory = join(
      root,
      ".claude/skills/demo/references/guide"
    );
    await buildSkillsetResult(root);
    await Bun.write(join(outputDirectory, "unmanaged.txt"), "Keep me.\n");
    await Bun.write(
      sourcePath,
      (await readFile(sourcePath, "utf8")).replace(
        "to: references/guide/page.md",
        "to: references/guide"
      )
    );

    const result = await buildSkillsetResult(root);

    expect(result.ok).toBe(false);
    expect(result.outputState.state).toBe("blocked");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unmanaged-output-collision",
      outputPath:
        ".claude/skills/demo/references/guide/unmanaged.txt",
    }));
    expect(await readFile(join(outputDirectory, "page.md"), "utf8")).toBe(
      "Nested guide.\n"
    );
    expect(
      await readFile(join(outputDirectory, "unmanaged.txt"), "utf8")
    ).toBe("Keep me.\n");
  });

  it("blocks a distinct equal unmanaged case-variant resource destination", async () => {
    const root = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide.md": "Managed guide.\n",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  references:
    - from: shared:references/guide.md
      to: references/Guide.md
---

Body.
`,
    });
    if (!(await supportsDistinctCasePaths(root))) return;

    const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
    const resourceDirectory = join(root, ".claude/skills/demo/references");
    await buildSkillsetResult(root);
    const managedPath = join(resourceDirectory, "Guide.md");
    const unmanagedPath = join(resourceDirectory, "guide.md");
    const managedMode = (await stat(managedPath)).mode & 0o777;
    await Bun.write(
      sourcePath,
      (await readFile(sourcePath, "utf8")).replace(
        "to: references/Guide.md",
        "to: references/guide.md"
      )
    );
    await Bun.write(unmanagedPath, "Managed guide.\n");
    await chmod(unmanagedPath, managedMode);
    expect(await readFile(unmanagedPath, "utf8")).toBe(
      await readFile(managedPath, "utf8")
    );
    expect((await stat(unmanagedPath)).mode & 0o777).toBe(managedMode);

    const result = await buildSkillsetResult(root);

    expect(result.ok).toBe(false);
    expect(result.outputState.state).toBe("blocked");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unmanaged-output-collision",
      outputPath: ".claude/skills/demo/references/guide.md",
    }));
    expect(result.writes).toEqual({
      deletedPaths: [],
      mode: "read",
      paths: [],
      writtenPaths: [],
    });
    expect((await readdir(resourceDirectory)).toSorted()).toEqual([
      "Guide.md",
      "guide.md",
    ]);
    expect(
      await readFile(managedPath, "utf8")
    ).toBe("Managed guide.\n");
    expect(
      await readFile(unmanagedPath, "utf8")
    ).toBe("Managed guide.\n");
    expect((await stat(managedPath)).mode & 0o777).toBe(managedMode);
    expect((await stat(unmanagedPath)).mode & 0o777).toBe(managedMode);
  });

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

  it("backs up managed target edits and restores the original safely", async () => {
    const { root, result } = await managedEditedBackup("# Hand Authored Skill\n");
    const backupRunId = result.writes.backupRunId;

    expect(backupRunId).toBeString();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      featureId: "output-safety",
      outputPath: ".claude/skills/demo/SKILL.md",
      severity: "warning",
    }));
    expectKnownDiagnosticFeatureIds(result.diagnostics);
    expect(result.writes.backupManifestPath).toBe(`.skillset/snapshots/${backupRunId}/manifest.json`);
    expect(result.writes.backupRecords).toContainEqual(expect.objectContaining({
      action: "overwrite",
      backupPath: "files/.claude/skills/demo/SKILL.md",
      reason: "managed-target-edit",
      targetPath: ".claude/skills/demo/SKILL.md",
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
    expect(await Bun.file(join(root, `.skillset/snapshots/${backupRunId}/files/.claude/skills/demo/SKILL.md`)).exists()).toBe(false);
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("Body.");

    const preview = await restoreOutputBackup(root, backupRunId ?? "");
    expect(preview.write).toBe(false);
    expect(preview.restoredPaths).toEqual([".claude/skills/demo/SKILL.md"]);

    const restored = await restoreOutputBackup(root, backupRunId ?? "", { write: true });
    expect(restored.write).toBe(true);
    expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("# Hand Authored Skill");
  });

  it("lists no backups without creating the missing snapshot root", async () => {
    const root = await fixture(DEMO_FIXTURE);

    expect(await inspectOutputBackups(root)).toEqual({ runs: [] });
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
  });

  it("lists valid backups and records in deterministic order", async () => {
    const { root, result: first } = await managedEditedBackup("# First target edit\n");
    await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), "# Second target edit\n");
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
        targetPath: ".claude/skills/demo/SKILL.md",
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
    const { root: overwriteRoot, result: overwrite } = await managedEditedBackup("# Target edit\n");
    await Bun.write(join(overwriteRoot, ".claude/skills/demo/SKILL.md"), "# Changed after backup\n");

    const overwriteInspection = await inspectOutputBackups(overwriteRoot);
    expect(overwriteInspection.runs).toContainEqual(expect.objectContaining({
      runId: overwrite.writes.backupRunId,
      records: [expect.objectContaining({
        state: "blocked-by-current-target",
        targetPath: ".claude/skills/demo/SKILL.md",
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
    const { root, result: valid } = await managedEditedBackup("# Target edit\n");
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
        expect.objectContaining({ state: "restorable-now", targetPath: ".claude/skills/demo/SKILL.md" }),
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
        targetPath: ".claude/skills/demo/SKILL.md",
      })]),
      state: "corrupt-or-unavailable",
    }));

    const { root: emptyRoot, result: emptyBackup } = await managedEditedBackup("# Target edit\n");
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

    const { root: hashRoot, result: hashBackup } = await managedEditedBackup("# Target edit\n");
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

  it("renders and records target-scoped provider-native project-agent skills", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: provider-native-agent-skill-root
claude: true
codex: true
cursor: true
`,
      ".skillset/agents/clark.md": `
---
name: clark
description: Architectural conscience.
claude:
  model: fable
  skills:
    - be-clark
    - native: trails
codex:
  skills:
    - be-clark
    - native: trails
cursor:
  skills:
    - be-clark
    - native: trails
---

Review the architecture.
`,
      ".skillset/skills/be-clark/SKILL.md": `
---
name: be-clark
description: Clark identity.
---

Apply Clark's identity.
`,
    });

    await buildSkillsetResult(root);

    const outputPaths = [
      ".claude/agents/clark.md",
      ".codex/agents/clark.toml",
      ".cursor/agents/clark.md",
    ] as const;
    const [claudeOutput, codexOutput, cursorOutput] = await Promise.all(
      outputPaths.map((outputPath) =>
        readFile(join(root, outputPath), "utf8")
      )
    );
    expect(claudeOutput).toContain("model: fable");
    expect(claudeOutput).toContain("skills:\n  - be-clark\n  - trails");
    expect(codexOutput).toContain("- be-clark\\n- trails");
    expect(cursorOutput).toContain("skills:\n  - be-clark\n  - trails");

    const lock = JSON.parse(
      await readFile(join(root, "skillset.lock"), "utf8")
    ) as {
      readonly items: readonly {
        readonly outputPath: string;
        readonly skillReferences?: readonly unknown[];
      }[];
    };
    const expectedReferences = [
      {
        authored: "be-clark",
        ownership: "managed",
        rendered: "be-clark",
      },
      {
        authored: "trails",
        ownership: "provider-native",
        rendered: "trails",
      },
    ];
    for (const outputPath of outputPaths) {
      expect(
        lock.items.find((item) => item.outputPath === outputPath)
          ?.skillReferences
      ).toEqual(expectedReferences);
    }

    const outputPath = outputPaths[0];
    await Bun.write(join(root, outputPath), `${claudeOutput}\n# drift\n`);
    const drift = await diffSkillsetResult(root);
    expect(drift.data.changed).toContain(outputPath);
  });

  it("resolves marked path references for bundles and source-backed project surfaces", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: path-reference-root
claude: true
codex: true
cursor: true
`,
      ".skillset/shared/references/shared.md": "Shared guide.",
      ".skillset/skills/guide/SKILL.md": `
---
name: guide
description: Guide skill.
resources:
  references:
    - from: shared:references/shared.md
      to: references/shared-guide.md
---

Read {{@references/local.md}} and {{@shared:references/shared.md}}.
`,
      ".skillset/skills/guide/references/local.md": "Local guide.",
      ".skillset/skills/guide/agents/openai.yaml": `
interface:
  display_name: Guide
  short_description: Read {{@shared:references/shared.md}}.
`,
      ".skillset/rules/root.md": `
Read {{@references/rule.md}}.
`,
      ".skillset/rules/references/rule.md": "Rule guide.",
      ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews project changes.
initialPrompt: Start with {{@references/agent.md}}.
---

Read {{@references/agent.md}}.
`,
      ".skillset/agents/references/agent.md": "Agent guide.",
    });

    await buildSkillsetResult(root);

    expect(
      await readFile(join(root, ".claude/skills/guide/SKILL.md"), "utf8")
    ).toContain("Read references/local.md and references/shared-guide.md.");
    expect(
      await readFile(
        join(root, ".agents/skills/guide/agents/openai.yaml"),
        "utf8"
      )
    ).toContain("Read references/shared-guide.md.");
    expect(
      await readFile(join(root, ".claude/rules/root.md"), "utf8")
    ).toContain("../../.skillset/rules/references/rule.md");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(
      ".skillset/rules/references/rule.md"
    );
    expect(
      await readFile(join(root, ".cursor/rules/root.mdc"), "utf8")
    ).toContain("../../.skillset/rules/references/rule.md");
    for (const path of [
      ".claude/agents/reviewer.md",
      ".codex/agents/reviewer.toml",
      ".cursor/agents/reviewer.md",
    ]) {
      const generated = await readFile(join(root, path), "utf8");
      expect(generated).toContain(
        "../../.skillset/agents/references/agent.md"
      );
      expect(generated).not.toContain("{{@references/agent.md}}");
    }
  });

  it("rejects missing and undeclared marked path references before writing", async () => {
    const missing = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Read {{@references/missing.md}}.
`,
    });
    await expect(buildSkillsetResult(missing)).rejects.toThrow(
      "failed to resolve path reference references/missing.md"
    );

    const undeclared = await fixture({
      ...DEMO_FIXTURE,
      ".skillset/shared/references/guide.md": "Guide.",
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Read {{@shared:references/guide.md}}.
`,
    });
    await expect(buildSkillsetResult(undeclared)).rejects.toThrow(
      "references undeclared shared resource shared:references/guide.md"
    );
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

async function supportsDistinctCasePaths(root: string): Promise<boolean> {
  const probeDirectory = join(root, ".skillset-case-probe");
  await mkdir(probeDirectory);
  try {
    await Bun.write(join(probeDirectory, "Probe"), "upper\n");
    await Bun.write(join(probeDirectory, "probe"), "lower\n");
    const entries = await readdir(probeDirectory);
    return entries.includes("Probe") && entries.includes("probe");
  } finally {
    await rm(probeDirectory, { force: true, recursive: true });
  }
}

async function managedEditedBackup(content: string): Promise<{
  readonly result: Awaited<ReturnType<typeof buildSkillsetResult>>;
  readonly root: string;
}> {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillsetResult(root);
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), content);
  return { result: await buildSkillsetResult(root), root };
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
