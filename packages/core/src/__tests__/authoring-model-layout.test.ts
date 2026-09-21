import { afterEach, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillset, buildSkillsetResult } from "@skillset/core";
import {
  doctorSkillset,
  explainPath,
  listSourceSkills,
} from "@skillset/core/internal/authoring";
import { loadBuildGraph } from "@skillset/core/internal/resolver";

const roots: string[] = [];

async function authoringFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-authoring-model-"));
  roots.push(root);
  await cp(join(process.cwd(), "fixtures/authoring-model"), root, {
    recursive: true,
  });
  return root;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-layout-"));
  roots.push(root);
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

const exists = (path: string): Promise<boolean> => Bun.file(path).exists();

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function lockItems(
  root: string,
  lockPath: string
): Promise<readonly Record<string, unknown>[]> {
  const items = (await json(join(root, lockPath))).items;
  if (!Array.isArray(items)) throw new Error(`expected lock items in ${lockPath}`);
  return items as readonly Record<string, unknown>[];
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("SET-551/585 current authoring model", () => {
  it("recognizes grouped skills and excludes _drafts from projections", async () => {
    const root = await authoringFixture();
    const graph = await loadBuildGraph(root);
    const plugin = graph.plugins.find((candidate) => candidate.id === "mg-skills");
    if (plugin === undefined) throw new Error("expected mg-skills plugin");

    expect(plugin.skills.map((skill) => skill.id)).toEqual([
      "tdd",
      "proofread",
      "package-proof",
    ]);
    expect(plugin.discoveredSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          draftOrigin: "_drafts",
          groupPath: ["(engineering)"],
          id: "tdd-draft",
          status: "draft",
        }),
        expect.objectContaining({
          groupPath: ["(engineering)"],
          id: "tdd",
          status: "live",
        }),
        expect.objectContaining({
          groupPath: ["(writing)"],
          id: "proofread",
          status: "live",
        }),
      ])
    );
    const result = await buildSkillsetResult(root);
    expect(
      await exists(
        join(
          root,
          "plugins/mg-skills/skills/(engineering)/_drafts/tdd/SKILL.md"
        )
      )
    ).toBe(false);
    expect(
      await exists(
        join(
          root,
          "plugins/mg-skills/skills/tdd/SKILL.md"
        )
      )
    ).toBe(true);
    expect(
      await exists(
        join(
          root,
          "plugins/mg-skills/skills/package-proof/SKILL.md"
        )
      )
    ).toBe(true);
    expect(
      await exists(join(root, ".agents/skills/package-proof/SKILL.md"))
    ).toBe(false);
    for (const skillId of ["tdd", "proofread"] as const) {
      expect(
        await exists(
          join(root, `plugins/mg-skills/skills/${skillId}/SKILL.md`)
        )
      ).toBe(true);
      expect(
        await exists(join(root, `.agents/skills/${skillId}/SKILL.md`))
      ).toBe(false);
      expect(result.renderResults).toContainEqual(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({
              path: `plugins/mg-skills/skills/${skillId}/SKILL.md`,
            }),
          ]),
          sourceUnit: `plugin.mg-skills.skill:${skillId}`,
          standardProfile: "agent-plugins-1.0",
          status: "rendered",
        })
      );
    }

    const packageItems = await lockItems(root, "plugins/skillset.lock");
    expect(packageItems).toContainEqual(
      expect.objectContaining({
        kind: "plugin-skill",
        name: "package-proof",
        outputPath: "mg-skills/skills/package-proof/SKILL.md",
        owner: { standardProfile: "agent-plugins-1.0" },
        plugin: "mg-skills",
        role: "standard",
      })
    );
    expect(packageItems).not.toContainEqual(
      expect.objectContaining({ role: "project-use" })
    );

    const rootItems = await lockItems(root, ".agents/skills/skillset.lock");
    expect(rootItems).toContainEqual(
      expect.objectContaining({
        kind: "standalone-skill",
        name: "repo-helper",
        owner: { standardProfile: "agent-skills" },
        role: "standard",
      })
    );
    expect(rootItems).not.toContainEqual(
      expect.objectContaining({
        kind: "plugin-skill",
        name: "package-proof",
      })
    );
    expect(rootItems).not.toContainEqual(
      expect.objectContaining({ role: "project-use" })
    );
    expect(
      await explainPath(
        root,
        "plugins/mg-skills/skills/package-proof/SKILL.md"
      )
    ).toMatchObject({
      entries: [expect.objectContaining({ role: "standard" })],
      kind: "generated",
    });

    const sourceSkills = await listSourceSkills(root);
    expect(sourceSkills).toContainEqual(
      expect.objectContaining({
        container: "mg-skills",
        draftOrigin: "_drafts",
        groupPath: ["(engineering)"],
        id: "tdd-draft",
        status: "draft",
      })
    );
    expect(sourceSkills).toContainEqual(
      expect.objectContaining({
        container: "mg-skills",
        groupPath: ["(engineering)"],
        id: "tdd",
        status: "live",
      })
    );
    const explained = await explainPath(
      root,
      ".skillset/plugins/mg-skills/skills/(engineering)/_drafts/tdd/SKILL.md"
    );
    expect(explained).toMatchObject({
      entries: [],
      kind: "source-skill",
      sourceSkill: {
        container: "mg-skills",
        draftOrigin: "_drafts",
        groupPath: ["(engineering)"],
        id: "tdd-draft",
        status: "draft",
      },
    });
    const explainedLive = await explainPath(
      root,
      ".skillset/plugins/mg-skills/skills/(engineering)/tdd/SKILL.md"
    );
    expect(explainedLive).toMatchObject({
      kind: "source-skill",
      sourceSkill: {
        container: "mg-skills",
        groupPath: ["(engineering)"],
        id: "tdd",
        internalUse: {
          rule:
            "plugins.internal_use.skills.mg-skills: all except exclusions",
          selected: true,
        },
        status: "live",
      },
    });
    expect(
      await explainPath(
        root,
        ".skillset/plugins/mg-skills/skills/(writing)/proofread/SKILL.md"
      )
    ).toMatchObject({
      sourceSkill: {
        id: "proofread",
        internalUse: {
          rule: "plugins.internal_use.skills.mg-skills: !proofread",
          selected: false,
        },
      },
    });
    expect(graph.pluginPlan?.packagePaths).toEqual({
      claude: { "mg-skills": "plugins/mg-skills/" },
      codex: { "mg-skills": "plugins/mg-skills/" },
      cursor: { "mg-skills": "plugins/mg-skills/" },
    });
    expect((await doctorSkillset(root)).pluginPlan).toMatchObject({
      internalUse: {
        skills: expect.arrayContaining([
          { pluginId: "mg-skills", skillId: "tdd" },
        ]),
      },
      packagePaths: {
        codex: { "mg-skills": "plugins/mg-skills/" },
      },
    });
  });

  it("marks configured draft selectors and rejects absent units", async () => {
    const draftRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: configured-draft
drafts:
  - skill:future
  - plugin.demo.skill:root-plugin-draft
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/future/SKILL.md": `---
name: future
description: Future skill.
---

Future.
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
drafts:
  - skill:plugin-local-draft
`,
      ".skillset/plugins/demo/skills/root-plugin-draft/SKILL.md": `---
name: root-plugin-draft
description: Root-configured plugin draft.
---

Root plugin draft.
`,
      ".skillset/plugins/demo/skills/plugin-local-draft/SKILL.md": `---
name: plugin-local-draft
description: Plugin-configured draft.
---

Plugin-local draft.
`,
    });
    const graph = await loadBuildGraph(draftRoot);
    expect(graph.standaloneSkills).toEqual([]);
    expect(graph.discoveredSkills).toContainEqual(
      expect.objectContaining({
        draftOrigin: "config",
        id: "future",
        status: "draft",
      })
    );
    expect(
      await explainPath(draftRoot, ".skillset/skills/future/SKILL.md")
    ).toMatchObject({
      sourceSkill: {
        draftOrigin: "config",
        id: "future",
        status: "draft",
      },
    });
    expect(graph.plugins[0]?.discoveredSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          draftOrigin: "config",
          id: "root-plugin-draft",
          status: "draft",
        }),
        expect.objectContaining({
          draftOrigin: "config",
          id: "plugin-local-draft",
          status: "draft",
        }),
      ])
    );

    await writeFile(
      join(draftRoot, "skillset.yaml"),
      `
skillset:
  name: configured-draft
drafts:
  - skill:missing
claude: true
codex: false
cursor: false
`
    );
    await expect(loadBuildGraph(draftRoot)).rejects.toThrow(
      "drafts names absent unit \"skill:missing\"; known ids: future"
    );

    await writeFile(
      join(draftRoot, "skillset.yaml"),
      `
skillset:
  name: configured-draft
drafts:
  - plugin:demo
claude: true
codex: false
cursor: false
`
    );
    await expect(loadBuildGraph(draftRoot)).rejects.toThrow(
      "drafts entries must select skills in the current config scope"
    );

    await writeFile(
      join(draftRoot, "skillset.yaml"),
      `
skillset:
  name: configured-draft
drafts:
  - skill:future
claude: true
codex: false
cursor: false
`
    );
    await writeFile(
      join(draftRoot, ".skillset/plugins/demo/skillset.yaml"),
      `
skillset:
  name: demo
drafts:
  - plugin.demo.skill:plugin-local-draft
`
    );
    await expect(loadBuildGraph(draftRoot)).rejects.toThrow(
      "drafts entries must select skills in the current config scope"
    );
  });

  it("rejects unsupported package output semantics without source plugins", async () => {
    const standaloneSkill = `---
name: live
description: Live skill.
---

Live.
`;
    const config = (output: string): Record<string, string> => ({
      "skillset.yaml": `
skillset:
  name: package-output
claude: true
codex: false
cursor: false
${output}`,
      ".skillset/skills/live/SKILL.md": standaloneSkill,
    });

    for (const [output, diagnostic] of [
      ["plugins:\n  output:\n    path: dist/[name]\n", "SET-561"],
      [
        "plugins:\n  output:\n    codex:\n      path: dist/[name]\n",
        "SET-561",
      ],
      [
        "plugins:\n  output:\n    codex:\n      name: combined\n",
        "plugins.output.codex.name",
      ],
      [
        "plugins:\n  output:\n    codex:\n      combine: true\n",
        "plugins.output.codex.combine",
      ],
    ] as const) {
      await expect(loadBuildGraph(await fixture(config(output)))).rejects.toThrow(
        diagnostic
      );
    }

    await expect(loadBuildGraph(await fixture(config("")))).resolves.toBeDefined();
    await expect(
      loadBuildGraph(
        await fixture(config("plugins:\n  output:\n    path: plugins/\n"))
      )
    ).resolves.toBeDefined();

    const pluginRoot = await fixture({
      ...config("plugins:\n  output:\n    path: dist/[name]\n"),
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/skills/review/SKILL.md": `---
name: review
description: Review skill.
---

Review.
`,
    });
    await expect(loadBuildGraph(pluginRoot)).rejects.toThrow("SET-561");
  });

  it("recognizes status: draft and rejects duplicate leaves across groups", async () => {
    const draftRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: status-draft
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/(ideas)/future/SKILL.md": `---
name: future
description: Future skill.
status: draft
---

Future.
`,
    });
    const graph = await loadBuildGraph(draftRoot);
    expect(graph.standaloneSkills).toEqual([]);
    expect(graph.discoveredSkills).toContainEqual(
      expect.objectContaining({
        draftOrigin: "status",
        groupPath: ["(ideas)"],
        id: "future",
        status: "draft",
      })
    );
    expect(
      await explainPath(
        draftRoot,
        ".skillset/skills/(ideas)/future/SKILL.md"
      )
    ).toMatchObject({
      entries: [],
      kind: "source-skill",
      sourceSkill: {
        container: "workspace",
        draftOrigin: "status",
        groupPath: ["(ideas)"],
        id: "future",
        status: "draft",
      },
    });
    await buildSkillset(draftRoot);
    expect(
      await exists(join(draftRoot, ".claude/skills/(ideas)/future/SKILL.md"))
    ).toBe(false);

    const plainGroupRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: plain-group
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/engineering/tdd/SKILL.md": `---
name: tdd
description: Test-driven development.
---

TDD.
`,
    });
    const plainGroup = await loadBuildGraph(plainGroupRoot);
    expect(plainGroup.standaloneSkills).toContainEqual(
      expect.objectContaining({
        groupPath: ["engineering"],
        id: "tdd",
        status: "live",
      })
    );
    await buildSkillset(plainGroupRoot);
    expect(
      await exists(
        join(plainGroupRoot, ".claude/skills/engineering/tdd/SKILL.md")
      )
    ).toBe(true);

    const duplicateRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: duplicate-leaves
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/(one)/same/SKILL.md": `---
name: first
description: First skill.
---

First.
`,
      ".skillset/skills/(two)/same/SKILL.md": `---
name: second
description: Second skill.
---

Second.
`,
    });
    await expect(loadBuildGraph(duplicateRoot)).rejects.toThrow(
      "duplicate skill leaf same"
    );
    await expect(loadBuildGraph(duplicateRoot)).rejects.toThrow(
      ".skillset/skills/(one)/same/SKILL.md"
    );
    await expect(loadBuildGraph(duplicateRoot)).rejects.toThrow(
      ".skillset/skills/(two)/same/SKILL.md"
    );
  });

  it("classifies only exact reserved rule segments and preserves literal paths", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: rule-segments
claude: true
codex: false
cursor: true
`,
      ".skillset/rules/apps/[.]/one.md": "One level.\n",
      ".skillset/rules/apps/[...]/any.md": "Any depth.\n",
      ".skillset/rules/app/[...slug]/catchall.md": "Literal catchall.\n",
      ".skillset/rules/app/[slug]/routing.md": "Literal slug.\n",
      ".skillset/rules/app/(marketing)/copy.md": "Literal group.\n",
    });
    const graph = await loadBuildGraph(root);
    const byId = new Map(graph.rules.map((rule) => [rule.id, rule.segments]));
    expect(byId.get("apps/[.]/one")).toEqual([
      { classification: "literal", value: "apps" },
      { classification: "one-level", value: "[.]" },
    ]);
    expect(byId.get("apps/[...]/any")).toEqual([
      { classification: "literal", value: "apps" },
      { classification: "any-depth", value: "[...]" },
    ]);
    expect(byId.get("app/[...slug]/catchall")?.at(-1)).toEqual({
      classification: "literal",
      value: "[...slug]",
    });
    expect(byId.get("app/[slug]/routing")?.at(-1)).toEqual({
      classification: "literal",
      value: "[slug]",
    });
    expect(byId.get("app/(marketing)/copy")?.at(-1)).toEqual({
      classification: "literal",
      value: "(marketing)",
    });

    await buildSkillset(root);
    expect(
      await exists(join(root, ".claude/rules/app/[slug]/routing.md"))
    ).toBe(true);
    expect(
      await exists(join(root, ".cursor/rules/app/(marketing)/copy.mdc"))
    ).toBe(true);
    expect(
      await exists(join(root, ".claude/rules/apps/[...]/any.md"))
    ).toBe(true);
    expect(
      await exists(join(root, ".cursor/rules/app/[...slug]/catchall.mdc"))
    ).toBe(true);
  });

  it("rejects the Unicode ellipsis rule segment with the exact rename", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: unicode-rule-segment
claude: true
codex: false
cursor: false
`,
      ".skillset/rules/apps/[…]/bad.md": "Bad scope.\n",
    });
    await expect(loadBuildGraph(root)).rejects.toThrow(
      ".skillset/rules/apps/[…]/bad.md"
    );
    await expect(loadBuildGraph(root)).rejects.toThrow("rename it to [...]");
  });
  it("builds RULES.md, workspace subagents, plugin subagents, and relocated partials", async () => {
    const root = await authoringFixture();
    const result = await buildSkillsetResult(root);

    expect(await exists(join(root, ".claude/agents/reviewer.md"))).toBe(true);
    expect(await exists(join(root, ".codex/agents/reviewer.toml"))).toBe(true);
    expect(await exists(join(root, ".cursor/agents/reviewer.md"))).toBe(true);
    expect(
      await exists(join(root, "plugins/mg-skills/agents/editor.md"))
    ).toBe(true);
    expect(
      await exists(join(root, "plugins/mg-skills/agents/editor.md"))
    ).toBe(true);

    const claudeManifest = await json(
      join(root, "plugins/mg-skills/.claude-plugin/plugin.json")
    );
    const cursorManifest = await json(
      join(root, "plugins/mg-skills/.cursor-plugin/plugin.json")
    );
    expect(claudeManifest.agents).toBe("./agents/");
    expect(cursorManifest.agents).toBe("./agents/");

    const skillRoot = join(root, "plugins/mg-skills/skills/proofread");
    const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
    expect(skill).toContain("Use the shared repository guidance.");
    expect(skill).toContain("Use the plugin writing guidance.");
    expect(skill).toContain("@references/common.md");
    expect(skill).toContain("@references/checklist.md");
    expect(skill).toContain("`@{{shared:references/literal.md}}`");
    expect(
      await readFile(join(skillRoot, "references/common.md"), "utf8")
    ).toContain("Common reference");
    expect(
      await readFile(join(skillRoot, "references/checklist.md"), "utf8")
    ).toContain("Proofreading Checklist");
    expect(await exists(join(skillRoot, "references/literal.md"))).toBe(false);
    for (const provider of ["claude", "chatgpt", "cursor"]) {
      expect(await exists(join(
        root,
        "plugins/mg-skills",
        provider,
        "skills/proofread/SKILL.md"
      ))).toBe(false);
    }
    expect(
      await exists(join(root, ".agents/skills/(writing)/proofread/SKILL.md"))
    ).toBe(false);

    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Authoring model\n\nKeep source ownership explicit.")).toBe(true);
    expect(agents.startsWith("<!-- Generated by")).toBe(false);
    expect(await exists(join(root, ".claude/rules/RULES.md"))).toBe(false);
    expect(await exists(join(root, ".cursor/rules/RULES.mdc"))).toBe(false);
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "cursor-agents-md-root",
        sourcePath: ".skillset/RULES.md",
        status: "unsupported",
        target: "cursor",
      })
    );
  });

  it("keeps Cursor native-only agents on the registry native path", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: cursor-native-agents
claude: false
codex: false
cursor:
  plugins: true
  skills: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  description: Demo plugin.
`,
      ".skillset/plugins/demo/_cursor/agents/native.md": "Native Cursor agent.\n",
    });

    await buildSkillset(root);

    const manifest = await json(
      join(root, "plugins/demo/.cursor-plugin/plugin.json")
    );
    expect(manifest.agents).toBe("./agents/");
    expect(
      await exists(join(root, "plugins/demo/agents/native.md"))
    ).toBe(true);
  });

  it("omits an agents manifest field when neither authored nor native source exists", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: no-agents
claude: true
codex: false
cursor: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  description: Demo plugin.
`,
    });

    await buildSkillset(root);
    expect(
      await json(join(root, "plugins/demo/.claude-plugin/plugin.json"))
    ).not.toHaveProperty("agents");
    expect(
      await json(join(root, "plugins/demo/.cursor-plugin/plugin.json"))
    ).not.toHaveProperty("agents");
  });

  it.each([
    [".skillset/agents/reviewer.md", ".skillset/subagents"],
    [".skillset/partials/intro.md", ".skillset/shared/partials"],
    [".skillset/rules/RULES.md", ".skillset/RULES.md"],
    [".skillset/plugins/demo/agents/reviewer.md", ".skillset/plugins/demo/subagents"],
    [".skillset/plugins/demo/partials/intro.md", ".skillset/plugins/demo/shared/partials"],
  ])("rejects retired source %s and names %s", async (path, replacement) => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: retired-layout
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
      ...(path.includes("plugins/demo/")
        ? {
            ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  description: Demo plugin.
`,
          }
        : {}),
      [path]: "Retired source.\n",
    });

    await expect(buildSkillset(root)).rejects.toThrow(replacement);
  });

  it.each([
    ["{{root:value.md}}", "unsupported reference syntax {{root:value.md}}"],
    [
      "{{shared:value.md}}",
      "unsupported reference syntax {{shared:value.md}}",
    ],
  ])("rejects retired reference syntax %s", async (expression, message) => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: root-reference
claude: true
codex: false
cursor: false
`,
      ".skillset/shared/value.md": "Shared value.\n",
      ".skillset/skills/retired/SKILL.md": `
---
name: retired
description: Retired reference.
---

${expression}
`,
    });

    await expect(buildSkillset(root)).rejects.toThrow(message);
  });

  it("records authored plugin subagents as unsupported for Codex", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: codex-subagents
compile:
  unsupportedDestination: warn
claude: false
codex:
  plugins: true
  skills: false
cursor: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  description: Demo plugin.
`,
      ".skillset/plugins/demo/subagents/reviewer.md": "Review changes.\n",
    });

    const result = await buildSkillsetResult(root);
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "agents",
        featureId: "plugin-agents",
        sourcePath: ".skillset/plugins/demo/subagents",
        sourceUnit: "plugin.demo.feature:agents",
        status: "unsupported",
        target: "codex",
      })
    );
  });

  it("preflights an authored root AGENTS.md recovery and points its author to RULES.md", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: root-instructions-collision
claude: false
codex: true
cursor: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
    });

    await buildSkillset(root);
    await writeFile(
      join(root, ".skillset/RULES.md"),
      "# Generated instructions\n"
    );
    await writeFile(join(root, "AGENTS.md"), "# Authored instructions\n");
    const result = await buildSkillsetResult(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unmanaged-output-collision",
        message: expect.stringContaining(
          "move authored root instructions to .skillset/RULES.md"
        ),
        outputPath: "AGENTS.md",
      })
    );
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(
      "# Authored instructions\n"
    );
  });

  it("reserves unrelated underscore skill directories while recognizing _drafts", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: reserved-skills
claude: true
codex: false
cursor: false
`,
      ".skillset/skills/_typo/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
    });

    await expect(buildSkillset(root)).rejects.toThrow(
      "only _drafts is allowed"
    );
  });
});
