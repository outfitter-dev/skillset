import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { doctorSkillset } from "../authoring";
import {
  buildSkillset,
  buildSkillsetResult,
  diffSkillsetResult,
  SkillsetBuildBlockedError,
  verifySkillsetResult,
} from "../build";
import { SkillsetFeatureDiagnosticError } from "../operation-result";
import {
  classifySkillsetOutputFailure,
  classifySkillsetOutputState,
} from "../output-state";
import { checkSkillsetSourceReadiness } from "../source-readiness";

describe("output-state evidence classifier", () => {
  it.each([
    {
      expected: "blocked",
      input: {
        blockers: [{ code: "unmanaged-output-collision", path: "AGENTS.md" }],
        hasBaseline: true,
        outputChanges: ["managed.md"],
        sourceChanges: ["new.md"],
      },
    },
    {
      expected: "output-diverged",
      input: {
        hasBaseline: true,
        outputChanges: ["managed.md"],
        sourceChanges: ["new.md"],
      },
    },
    {
      expected: "source-ahead",
      input: { hasBaseline: true, sourceChanges: ["new.md"] },
    },
    {
      expected: "current",
      input: { hasBaseline: true },
    },
    {
      expected: "no-output-baseline",
      input: { hasBaseline: false, sourceChanges: ["new.md"] },
    },
    {
      expected: "no-output-baseline",
      input: { hasBaseline: false },
    },
  ] as const)(
    "classifies $expected with the pinned precedence",
    ({ expected, input }) => {
      expect(classifySkillsetOutputState(input).state).toBe(expected);
    }
  );

  it("returns deterministic, deduplicated evidence", () => {
    expect(
      classifySkillsetOutputState({
        blockers: [
          { code: "z", path: "b" },
          { code: "a", path: "c" },
          { code: "z", path: "b" },
        ],
        hasBaseline: true,
        outputChanges: ["z", "a", "z"],
        sourceChanges: ["b", "a", "b"],
      })
    ).toEqual({
      blockers: [
        { code: "a", path: "c" },
        { code: "z", path: "b" },
      ],
      hasBaseline: true,
      outputChanges: ["a", "z"],
      sourceChanges: ["a", "b"],
      state: "blocked",
    });
  });

  it("preserves exact derivation diagnostic evidence", () => {
    expect(
      classifySkillsetOutputFailure(
        new SkillsetFeatureDiagnosticError({
          code: "invalid-source-field",
          featureId: "skill-frontmatter",
          message: "invalid source field",
          path: ".skillset/skills/demo/SKILL.md",
        }),
        true
      )
    ).toEqual({
      blockers: [{
        code: "invalid-source-field",
        path: ".skillset/skills/demo/SKILL.md",
      }],
      hasBaseline: true,
      outputChanges: [],
      sourceChanges: [],
      state: "blocked",
    });
  });

  it("shares truthful evidence across build, diff, check, and status", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: output-state-root
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
    });
    const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
    const outputPath = join(root, ".claude/skills/demo/SKILL.md");

    const preview = await diffSkillsetResult(root);
    expect(preview.outputState).toMatchObject({
      hasBaseline: false,
      state: "no-output-baseline",
    });
    expect((await buildSkillsetResult(root)).outputState.state).toBe(
      "no-output-baseline"
    );

    expect((await diffSkillsetResult(root)).outputState.state).toBe("current");
    expect((await verifySkillsetResult(root)).outputState.state).toBe(
      "current"
    );
    expect(
      (await checkSkillsetSourceReadiness(root)).data.outputState.state
    ).toBe("current");
    expect((await doctorSkillset(root)).outputState.state).toBe("current");

    await Bun.write(
      sourcePath,
      `${await Bun.file(sourcePath).text()}\nChanged.\n`
    );
    expect((await diffSkillsetResult(root)).outputState).toMatchObject({
      outputChanges: [],
      state: "source-ahead",
    });

    await buildSkillsetResult(root);
    await Bun.write(
      outputPath,
      `${await Bun.file(outputPath).text()}\nEdited.\n`
    );
    expect((await diffSkillsetResult(root)).outputState).toMatchObject({
      outputChanges: [".claude/skills/demo/SKILL.md"],
      state: "output-diverged",
    });

    await buildSkillsetResult(root);
    await rm(outputPath);
    expect((await diffSkillsetResult(root)).outputState).toMatchObject({
      outputChanges: [".claude/skills/demo/SKILL.md"],
      state: "output-diverged",
    });
  });

  it.each([
    ["malformed", "{ not valid json"],
    ["invalid provenance", JSON.stringify({ generatedBy: "other@1.0.0" })],
  ])("reports a %s managed lock as blocked doctor evidence", async (_case, lock) => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: corrupt-lock-root
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
    });
    await buildSkillsetResult(root);
    await writeFile(join(root, "skillset.lock"), lock, "utf8");

    const report = await doctorSkillset(root);

    expect(report.ok).toBe(false);
    expect(report.buildError).toContain("workspace lock skillset.lock cannot guard generated state");
    expect(report.outputState).toEqual({
      blockers: [{ code: "output-derivation-failed" }],
      hasBaseline: false,
      outputChanges: [],
      sourceChanges: [],
      state: "blocked",
    });
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(lock);
  });

  it("preserves a trustworthy managed baseline when later derivation fails", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: baseline-failure-root
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
    });
    await buildSkillsetResult(root);
    await writeFile(
      join(root, ".skillset/skills/demo/SKILL.md"),
      `---
name: demo
description: Demo with an undeclared resource link.
---

See the [guide](shared:references/guide.md).
`,
      "utf8"
    );

    const report = await doctorSkillset(root);

    expect(report.ok).toBe(false);
    expect(report.buildError).toContain("undeclared shared resource");
    expect(report.outputState).toMatchObject({
      hasBaseline: true,
      state: "blocked",
    });
  });

  it("preserves an independently readable workspace baseline when graph loading fails", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: graph-failure-baseline-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    await writeFile(
      join(root, ".skillset/rules/root.md"),
      "---\npaths: [\n---\nBroken instructions.\n",
      "utf8"
    );

    const status = await doctorSkillset(root);
    const pluginStatus = await doctorSkillset(root, { scopes: ["plugins"] });
    const projectReadiness = await checkSkillsetSourceReadiness(root, {
      scopes: ["project"],
    });

    expect(status.ok).toBe(false);
    expect(status.buildError).toContain("Flow sequence in block collection");
    expect(status.outputState).toMatchObject({
      hasBaseline: true,
      state: "blocked",
    });
    expect(pluginStatus.buildError).toBe(status.buildError);
    expect(pluginStatus.outputState).toMatchObject({
      hasBaseline: false,
      state: "blocked",
    });
    expect(projectReadiness.data.outputState).toMatchObject({
      hasBaseline: true,
      state: "blocked",
    });
  });

  it("preserves a configured plugin baseline when graph loading fails", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: plugin-graph-failure-root
claude:
  plugins:
    path: generated/claude
codex: false
cursor: false
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
      ".skillset/plugins/tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo plugin skill.
---

Body.
`,
    });
    const baseline = await buildSkillsetResult(root, { scopes: ["plugins"] });
    expect(baseline.ok).toBe(true);
    expect(baseline.writes.paths).toContain("generated/claude/skillset.lock");
    await writeFile(
      join(root, "skillset.yaml"),
      `
skillset:
  name: plugin-graph-failure-root
claude:
  enabled: false
  plugins:
    path: generated/claude
codex: true
cursor: false
`,
      "utf8"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/skills/demo/SKILL.md"),
      "---\nname: demo\ndescription: [\n---\nBroken plugin skill.\n",
      "utf8"
    );

    const status = await doctorSkillset(root, { scopes: ["plugins"] });
    const readiness = await checkSkillsetSourceReadiness(root, {
      scopes: ["plugins"],
    });

    expect(status.ok).toBe(false);
    expect(status.outputState).toMatchObject({
      hasBaseline: true,
      state: "blocked",
    });
    expect(readiness.data.outputState).toMatchObject({
      hasBaseline: true,
      state: "blocked",
    });
  });

  it("scopes status and readiness baseline evidence when plugin rendering fails", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: scoped-failure-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    const baseline = await buildSkillsetResult(root, { scopes: ["project"] });
    expect(baseline.ok).toBe(true);
    expect(baseline.writes.paths).toContain("AGENTS.md");
    expect(baseline.writes.paths).toContain("skillset.lock");
    await writeFile(join(root, "AGENTS.md"), "stale project output\n", "utf8");
    await mkdir(join(root, ".skillset/plugins/tools/skills/broken"), {
      recursive: true,
    });
    await writeFile(
      join(root, ".skillset/plugins/tools/skillset.yaml"),
      "skillset:\n  name: tools\n",
      "utf8"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/skills/broken/SKILL.md"),
      `---
name: broken
description: Broken plugin skill.
---

See the [guide](shared:references/missing.md).
`,
      "utf8"
    );

    const status = await doctorSkillset(root, { scopes: ["plugins"] });
    const readiness = await checkSkillsetSourceReadiness(root, {
      scopes: ["plugins"],
    });

    expect(status.buildError).toContain("undeclared shared resource");
    expect(status.drift).toEqual({
      added: [],
      changed: [],
      missing: [],
      removed: [],
    });
    expect(status.outputState).toMatchObject({
      hasBaseline: false,
      outputChanges: [],
      state: "blocked",
    });
    expect(readiness.data.managedOutputPaths).toEqual([]);
    expect(readiness.data.checks.managedOutputs.checkedFiles).toBe(0);
    expect(readiness.data.outputState).toMatchObject({
      hasBaseline: false,
      outputChanges: [],
      state: "blocked",
    });
  });

  it("classifies an unmanaged collision from explicit safety evidence", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: collision-root
claude: false
codex: true
cursor: false
`,
      ".skillset/rules/root.md": "# Generated instructions\n",
      "AGENTS.md": "# Unmanaged instructions\n",
    });

    const result = await diffSkillsetResult(root);
    expect(result.outputState).toEqual({
      blockers: [{ code: "unmanaged-output-collision", path: "AGENTS.md" }],
      hasBaseline: false,
      outputChanges: [],
      sourceChanges: ["skillset.lock"],
      state: "blocked",
    });

    const before = await Bun.file(join(root, "AGENTS.md")).text();
    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(false);
    expect(applied.outputState).toEqual(result.outputState);
    expect(applied.writes.paths).toEqual([]);
    expect(await Bun.file(join(root, "AGENTS.md")).text()).toBe(before);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
  });

  it("re-inspects at the Core write owner when a collision appears after preview", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: late-collision-root
claude: false
codex: true
cursor: false
`,
      ".skillset/rules/root.md": "# Generated instructions\n",
    });

    const preview = await diffSkillsetResult(root);
    expect(preview.ok).toBe(true);
    await Bun.write(join(root, "AGENTS.md"), "# Appeared after preview\n");

    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(false);
    expect(applied.outputState).toMatchObject({
      blockers: [{ code: "unmanaged-output-collision", path: "AGENTS.md" }],
      state: "blocked",
    });
    expect(applied.writes.paths).toEqual([]);
    expect(await Bun.file(join(root, "AGENTS.md")).text()).toBe("# Appeared after preview\n");
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
  });

  it("aborts when write-owner safety finds an unmanaged collision after plan inspection", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: write-owner-race-root
claude: false
codex: true
cursor: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
    });
    await buildSkillsetResult(root);
    await mkdir(join(root, ".skillset/rules"), { recursive: true });
    await writeFile(
      join(root, ".skillset/rules/root.md"),
      "# Generated root instructions\n",
      "utf8"
    );
    await mkdir(join(root, ".skillset/rules/docs"), { recursive: true });
    await writeFile(
      join(root, ".skillset/rules/docs/writing.md"),
      "---\npaths:\n  - docs/**/*.md\n---\n\n# Generated docs instructions\n",
      "utf8"
    );
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "# Allowed source-driven file\n", "utf8");

    const latePath = join(root, "docs/AGENTS.md");
    const sourceDrivenOutputPaths = new Proxy(["AGENTS.md"], {
      get(target, property, receiver) {
        if (property !== "includes") return Reflect.get(target, property, receiver);
        return (path: string) => {
          // The first blocker-policy check occurs after plan preflight and
          // before the write owner re-inspects destinations.
          writeFileSync(latePath, "# Appeared during the build\n");
          return target.includes(path);
        };
      },
    });

    const result = await buildSkillsetResult(root, {}, {
      sourceDrivenOutputPaths,
    });

    expect(result.ok).toBe(false);
    expect(result.outputState).toMatchObject({
      blockers: [{
        code: "unmanaged-output-collision",
        path: "docs/AGENTS.md",
      }],
      state: "blocked",
    });
    expect(result.writes.paths).toEqual([]);
    expect(result.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "unmanaged-collision",
      targetPath: "docs/AGENTS.md",
    }));
    expect(await Bun.file(join(root, "AGENTS.md")).text()).toBe("# Allowed source-driven file\n");
    expect(await Bun.file(latePath).text()).toBe("# Appeared during the build\n");
  });

  it("classifies edited lock provenance as output divergence and backs it up", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: edited-lock-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      generatedBy: string;
    };
    lock.generatedBy = "skillset@9.9.9";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["skillset.lock"],
      sourceChanges: [],
      state: "output-diverged",
    });
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath: "skillset.lock",
    }));

    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(true);
    expect(applied.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "managed-target-edit",
      targetPath: "skillset.lock",
    }));
    expect(await Bun.file(lockPath).text()).toContain('"generatedBy": "skillset@0.1.0"');
  });

  it("classifies unknown top-level lock fields as output divergence and backs them up", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: unknown-lock-field-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as Record<
      string,
      unknown
    >;
    lock.unknownField = "untrusted";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["skillset.lock"],
      sourceChanges: [],
      state: "output-diverged",
    });
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath: "skillset.lock",
    }));

    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(true);
    expect(applied.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "managed-target-edit",
      targetPath: "skillset.lock",
    }));
    expect(await Bun.file(lockPath).text()).not.toContain("unknownField");
  });

  it("classifies unknown feature fields as output divergence and backs them up", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: unknown-lock-feature-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      features: Record<string, unknown>;
    };
    lock.features.unknownField = true;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["skillset.lock"],
      sourceChanges: [],
      state: "output-diverged",
    });
    const applied = await buildSkillsetResult(root);
    expect(applied.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "managed-target-edit",
      targetPath: "skillset.lock",
    }));
  });

  it("does not let source drift excuse unknown item fields", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: unknown-lock-item-root
claude: false
codex: true
cursor: false
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      items: Array<Record<string, unknown>>;
    };
    lock.items[0]!.unknownField = true;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await writeFile(
      join(root, ".skillset/rules/root.md"),
      "# Updated project instructions\n",
      "utf8"
    );

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["skillset.lock"],
      sourceChanges: ["AGENTS.md"],
      state: "output-diverged",
    });
    const applied = await buildSkillsetResult(root);
    expect(applied.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "managed-target-edit",
      targetPath: "skillset.lock",
    }));
  });

  it("does not mistake a schema-downgraded v2 lock for a legacy migration", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: schema-downgrade-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      schemaVersion: number;
    };
    lock.schemaVersion = 1;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["skillset.lock"],
      state: "output-diverged",
    });
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath: "skillset.lock",
    }));

    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(true);
    expect(applied.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "managed-target-edit",
      targetPath: "skillset.lock",
    }));
  });

  it("does not trust edited item provenance when tracked payloads are unchanged", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: edited-lock-item-root
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      items: Array<{ sourceHash: string }>;
    };
    lock.items[0]!.sourceHash = `sha256:${"0".repeat(64)}`;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["skillset.lock"],
      sourceChanges: [],
      state: "output-diverged",
    });
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath: "skillset.lock",
    }));

    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(true);
    expect(applied.writes.backupRecords).toContainEqual(expect.objectContaining({
      reason: "managed-target-edit",
      targetPath: "skillset.lock",
    }));
  });

  it("does not let another item's source drift excuse edited lock provenance", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: edited-multi-item-lock-root
claude: false
codex: true
cursor: false
`,
      ".skillset/rules/docs.md": `
---
paths:
  - docs/**/*.md
---

# Docs instructions
`,
      ".skillset/rules/typescript.md": `
---
paths:
  - src/**/*.ts
---

# TypeScript instructions
`,
      "docs/guide.md": "# Guide\n",
      "src/index.ts": "export const value = 1;\n",
    });
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      items: Array<{ outputPath: string; sourceHash: string }>;
    };
    const docsItem = lock.items.find((item) => item.outputPath === "docs/AGENTS.md");
    if (docsItem === undefined) throw new Error("missing docs lock item");
    docsItem.sourceHash = `sha256:${"0".repeat(64)}`;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await writeFile(join(root, "docs/AGENTS.md"), "# Edited docs output\n", "utf8");
    await writeFile(
      join(root, ".skillset/rules/typescript.md"),
      `${await readFile(join(root, ".skillset/rules/typescript.md"), "utf8")}\nUpdated source.\n`,
      "utf8"
    );

    const preview = await diffSkillsetResult(root);

    expect(preview.outputState).toMatchObject({
      outputChanges: ["docs/AGENTS.md", "skillset.lock"],
      sourceChanges: ["src/AGENTS.md"],
      state: "output-diverged",
    });
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath: "skillset.lock",
    }));
  });

  it("keeps a legitimate config-only lock refresh source-ahead", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: lock-only-source-root
compile:
  build: updated
claude: false
codex: true
`,
      ".skillset/rules/root.md": "# Project instructions\n",
    });
    await buildSkillsetResult(root);
    const configPath = join(root, "skillset.yaml");
    await writeFile(
      configPath,
      (await readFile(configPath, "utf8")).replace("build: updated", "build: all"),
      "utf8"
    );

    const preview = await diffSkillsetResult(root);

    expect(preview.data.changed).toContain("skillset.lock");
    expect(preview.outputState).toMatchObject({
      outputChanges: [],
      state: "source-ahead",
    });
    expect(preview.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "managed-output-edited",
      outputPath: "skillset.lock",
    }));

    const applied = await buildSkillsetResult(root);
    expect(applied.ok).toBe(true);
    expect(applied.writes.backupRecords).toBeUndefined();
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
  });

  it.each([
    ["claude", ".claude-plugin/marketplace.json"],
    ["cursor", ".cursor-plugin/marketplace.json"],
  ] as const)("blocks a first-build handwritten %s marketplace index", async (target, path) => {
    const root = await marketplaceFixture(target, { [path]: "handwritten index\n" });

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(false);
    expect(result.outputState).toMatchObject({
      blockers: [{ code: "unmanaged-output-collision", path }],
      state: "blocked",
    });
    expect(result.writes.paths).toEqual([]);
    expect(await Bun.file(join(root, path)).text()).toBe("handwritten index\n");
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
    await expect(buildSkillset(root)).rejects.toBeInstanceOf(SkillsetBuildBlockedError);
    expect((await verifySkillsetResult(root)).ok).toBe(false);
  });

  it("retains established-workspace source-driven marketplace refreshes", async () => {
    const root = await marketplaceFixture("cursor");
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    await Bun.write(
      join(root, ".skillset/plugins/local-tools/skillset.yaml"),
      "skillset:\n  name: local-tools\n  description: Updated plugin.\n"
    );

    const rebuilt = await buildSkillsetResult(root, {}, {
      sourceDrivenOutputPaths: [".cursor-plugin/marketplace.json"],
    });
    expect(rebuilt.ok).toBe(true);
    expect(rebuilt.outputState.state).toBe("source-ahead");
    expect(await Bun.file(join(root, ".cursor-plugin/marketplace.json")).text()).toContain("Updated plugin.");
  });

  it("blocks a destination-only marketplace edit in an established workspace", async () => {
    const root = await marketplaceFixture("cursor");
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const marketplacePath = join(root, ".cursor-plugin/marketplace.json");
    const handwritten = `${await Bun.file(marketplacePath).text()}\nhandwritten destination edit\n`;
    await Bun.write(marketplacePath, handwritten);

    const rebuilt = await buildSkillsetResult(root);
    expect(rebuilt.ok).toBe(false);
    expect(rebuilt.outputState).toMatchObject({
      blockers: [{
        code: "unmanaged-output-collision",
        path: ".cursor-plugin/marketplace.json",
      }],
      state: "blocked",
    });
    expect(rebuilt.writes.paths).toEqual([]);
    expect(await Bun.file(marketplacePath).text()).toBe(handwritten);
    expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
  });

  it("does not mark a scoped graph stale for excluded source changes", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: scoped-output-state
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Repo body.
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
---

Plugin body.
`,
    });
    await buildSkillsetResult(root);
    const pluginSource = join(
      root,
      ".skillset/plugins/demo/skills/plugin-skill/SKILL.md"
    );
    await Bun.write(
      pluginSource,
      `${await Bun.file(pluginSource).text()}\nPlugin change.\n`
    );

    const repoOnly = await diffSkillsetResult(root, { scopes: ["repo"] });
    expect(repoOnly.outputState.state).toBe("current");
    expect(repoOnly.outputState.sourceChanges).toEqual([]);
    expect(repoOnly.renderResults).toContainEqual(
      expect.objectContaining({
        policy: "scope:excluded",
        sourceUnit: "plugin.demo.skill:plugin-skill",
      })
    );
    expect((await diffSkillsetResult(root)).outputState.state).toBe(
      "source-ahead"
    );
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-output-state-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function marketplaceFixture(
  target: "claude" | "cursor",
  extra: Record<string, string> = {}
): Promise<string> {
  return fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-output-state
compile:
  targets: [${target}]
marketplaces:
  outfitter:
    targets: [${target}]
    plugins:
      - plugin: local-tools
`,
    ".skillset/plugins/local-tools/skillset.yaml": "skillset:\n  name: local-tools\n",
    ".skillset/plugins/local-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo body.
`,
    ...extra,
  });
}
