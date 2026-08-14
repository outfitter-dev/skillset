import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
