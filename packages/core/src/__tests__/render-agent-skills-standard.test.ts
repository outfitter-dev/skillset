import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getStandardProfile,
  type StandardProfileId,
} from "@skillset/registry";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { renderBuildGraph } from "../render";
import {
  agentSkillStandardProjectionIssues,
  classifyAgentSkillStandard,
} from "../render-agent-skills-standard";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type { BuildGraph, RenderedFile, SourceSkill } from "../types";
import { parseMarkdown } from "../yaml";

const decoder = new TextDecoder();

describe("Agent Skills standard rendering", () => {
  test("renders the whitelisted baseline, resources, and inherited license in root and package projections", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: standard-skills
  license: MIT
compile:
  skillset:
    metadata: true
codex: false
`,
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
compatibility: Requires Git.
metadata:
  team: core
allowed_tools:
  agents: [Read, Search]
tools:
  read: true
supports:
  packages: []
---

Read references/guide.md.
`,
        ".skillset/shared/guide.md": "# Guide\n",
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex: false
`,
        ".skillset/plugins/demo/skills/helper/SKILL.md": `
---
name: helper
description: Help with the repository.
resources:
  references:
    - shared:guide.md
---

Use references/guide.md.
`,
      }),
      ["agent-plugins-1.0", "agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(paths(rendered)).toEqual(
      expect.arrayContaining([
        ".agents/skills/review/SKILL.md",
        ".agents/skills/review/LICENSE.txt",
        ".agents/skills/helper/SKILL.md",
        ".agents/skills/helper/references/guide.md",
        "plugins/demo/agents/skills/helper/SKILL.md",
        "plugins/demo/agents/skills/helper/references/guide.md",
      ])
    );
    expect(paths(rendered)).not.toContain(
      ".agents/skills/review/agents/openai.yaml"
    );
    expect(paths(rendered)).not.toContain(
      ".agents/skills/review/.skillset.tools.yaml"
    );

    const markdown = parseMarkdown(
      text(rendered, ".agents/skills/review/SKILL.md"),
      "rendered review skill"
    );
    expect(markdown.frontmatter).toEqual({
      name: "review",
      description: "Review a change.",
      license: "MIT",
      compatibility: "Requires Git.",
      metadata: {
        team: "core",
        version: expect.any(String),
        "skillset.schema": expect.any(String),
      },
      "allowed-tools": "Read Search",
    });
    expect(markdown.frontmatter).not.toHaveProperty("tools");
    expect(markdown.frontmatter).not.toHaveProperty("supports");

    const rootItems = lockItems(rendered, ".agents/skills/skillset.lock");
    expect(rootItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumers: [{ phase: "baseline", standardProfile: "agent-skills" }],
          kind: "standalone-skill",
          name: "review",
          owner: { standardProfile: "agent-skills" },
        }),
        expect.objectContaining({
          consumers: [{ phase: "baseline", standardProfile: "agent-skills" }],
          kind: "plugin-skill",
          name: "helper",
          owner: { standardProfile: "agent-skills" },
          plugin: "demo",
        }),
      ])
    );
    expect(lockItems(rendered, "plugins/skillset.lock")).toContainEqual(
      expect.objectContaining({
        consumers: [
          { phase: "baseline", standardProfile: "agent-plugins-1.0" },
        ],
        kind: "plugin-skill",
        name: "helper",
        owner: { standardProfile: "agent-plugins-1.0" },
        plugin: "demo",
      })
    );
  });

  test("uses the resolved license for both frontmatter and the bundled notice", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: resolved-license
  license: MIT
codex: false
`,
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
license: Apache-2.0
---

Review the change.
`,
      }),
      ["agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(
      parseMarkdown(
        text(rendered, ".agents/skills/review/SKILL.md"),
        "rendered review skill"
      ).frontmatter.license
    ).toBe("MIT");
    expect(text(rendered, ".agents/skills/review/LICENSE.txt")).toContain(
      "SPDX-License-Identifier: MIT"
    );
    expect(text(rendered, ".agents/skills/review/LICENSE.txt")).not.toContain(
      "Apache-2.0"
    );
  });

  test("keeps authored metadata but does not synthesize metadata or allowed-tools when disabled", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: minimal-standard-metadata
compile:
  skillset:
    metadata: false
claude: false
codex: false
cursor: false
`,
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
metadata:
  team: core
allowed_tools: [Read]
tools:
  read: true
---

Review the change.
`,
      }),
      ["agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    const frontmatter = parseMarkdown(
      text(rendered, ".agents/skills/review/SKILL.md"),
      "rendered review skill"
    ).frontmatter;
    expect(frontmatter.metadata).toEqual({ team: "core" });
    expect(frontmatter).not.toHaveProperty("allowed-tools");
    expect(frontmatter).not.toHaveProperty("tools");
  });

  test("coalesces the standard baseline with Codex and keeps sidecars Codex-owned", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: coalesced-skills
claude: false
codex: true
cursor: false
`,
        ".skillset/skills/guide/SKILL.md": `
---
name: guide
description: Guide the task.
implicit_invocation:
  codex: true
allowed_tools:
  agents: [Read]
tools:
  read: true
---

Guide the task.
`,
      }),
      ["agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(
      rendered.filter((file) => file.path === ".agents/skills/guide/SKILL.md")
    ).toHaveLength(1);
    expect(paths(rendered)).toEqual(
      expect.arrayContaining([
        ".agents/skills/guide/SKILL.md",
        ".agents/skills/guide/agents/openai.yaml",
        ".agents/skills/guide/.skillset.tools.yaml",
      ])
    );

    const items = lockItems(rendered, ".agents/skills/skillset.lock").filter(
      (item) => item.name === "guide"
    );
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(
      expect.objectContaining({
        consumers: [
          { phase: "baseline", standardProfile: "agent-skills" },
          { phase: "delta", target: "codex" },
        ],
        files: expect.arrayContaining(["guide/SKILL.md"]),
        owner: { standardProfile: "agent-skills" },
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        consumers: [{ phase: "delta", target: "codex" }],
        files: ["guide/.skillset.tools.yaml", "guide/agents/openai.yaml"],
        owner: { target: "codex" },
      })
    );

    const results = collectRenderResults(graph, rendered, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(paths(rendered)),
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        sourceUnit: "skill:guide",
        standardProfile: "agent-skills",
        status: "rendered",
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        sourceUnit: "skill:guide",
        target: "codex",
      })
    );
    const guideResults = results.filter(
      (result) =>
        result.featureId === "standalone-skills" &&
        result.sourceUnit === "skill:guide"
    );
    expect(guideResults).toHaveLength(2);
    expect(
      guideResults.find((result) => result.target === "codex")?.outputs
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ".agents/skills/guide/SKILL.md" }),
        expect.objectContaining({
          path: ".agents/skills/guide/agents/openai.yaml",
        }),
        expect.objectContaining({
          path: ".agents/skills/guide/.skillset.tools.yaml",
        }),
      ])
    );
  });

  test("adds Codex sidecars to a plugin-owned flattened skill only for its logical consumer", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: plugin-skill-consumer
claude: false
codex: true
cursor: false
`,
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex: true
`,
        ".skillset/plugins/demo/skills/helper/SKILL.md": `
---
name: helper
description: Help with the repository.
implicit_invocation:
  codex: true
tools:
  read: true
---

Help with the repository.
`,
      }),
      ["agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(paths(rendered)).toEqual(
      expect.arrayContaining([
        ".agents/skills/helper/SKILL.md",
        ".agents/skills/helper/agents/openai.yaml",
        ".agents/skills/helper/.skillset.tools.yaml",
      ])
    );
    expect(
      lockItems(rendered, ".agents/skills/skillset.lock").filter(
        (item) => item.name === "helper"
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consumers: [
            { phase: "baseline", standardProfile: "agent-skills" },
            { phase: "delta", target: "codex" },
          ],
          owner: { standardProfile: "agent-skills" },
        }),
        expect.objectContaining({
          consumers: [{ phase: "delta", target: "codex" }],
          owner: { target: "codex" },
        }),
      ])
    );
  });

  test("keeps a custom Codex skill root independent from the standard projection", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: custom-codex-root
claude: false
codex:
  skills:
    path: generated/codex-skills
cursor: false
`,
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
codex:
  frontmatter:
    provider-only: true
---

Review the change.
`,
      }),
      ["agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(paths(rendered)).toEqual(
      expect.arrayContaining([
        ".agents/skills/review/SKILL.md",
        "generated/codex-skills/review/SKILL.md",
      ])
    );
    expect(
      parseMarkdown(
        text(rendered, ".agents/skills/review/SKILL.md"),
        "standard skill"
      ).frontmatter
    ).not.toHaveProperty("provider-only");
    expect(
      parseMarkdown(
        text(rendered, "generated/codex-skills/review/SKILL.md"),
        "Codex skill"
      ).frontmatter
    ).toHaveProperty("provider-only", true);
  });

  test.each([
    [
      "Codex frontmatter",
      `
codex:
  frontmatter:
    provider-only: true
`,
      "Review the change.",
    ],
    ["Codex prompt-argument guidance", "", "Run {{$ARGUMENTS}}."],
    [
      "Claude-dialect translation",
      "dialect: claude",
      "Read CLAUDE.md and .claude/skills/review before continuing.",
    ],
  ])(
    "fails coalescing when %s requires incompatible SKILL.md bytes",
    async (_name, extraFrontmatter, body) => {
      const graph = adopted(
        await fixtureGraph({
          "skillset.yaml": `
skillset:
  name: incompatible-codex-delta
claude: false
codex: true
cursor: false
`,
          ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
${extraFrontmatter}
---

${body}
`,
        }),
        ["agent-skills"]
      );

      await expect(renderBuildGraph(graph)).rejects.toThrow(
        "requires incompatible bytes"
      );
    }
  );

  test("keeps standard-invalid source available to a provider and reports only the standard projection unsupported", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: invalid-standard-skill
claude: false
codex: true
cursor: false
`,
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
metadata:
  score: 1
---

Review the change.
`,
      }),
      ["agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    const item = lockItems(rendered, ".agents/skills/skillset.lock").find(
      (candidate) => candidate.name === "review"
    );
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("consumers");
    expect(item).not.toHaveProperty("owner");

    const results = collectRenderResults(graph, rendered, {
      claudeMarketplacePlugins: [],
      includedPaths: new Set(paths(rendered)),
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({ code: "agent-skills-metadata-string" }),
        ],
        featureId: "standalone-skills",
        policy: "unsupported:error",
        sourceUnit: "skill:review",
        standardProfile: "agent-skills",
        status: "unsupported",
      })
    );
    const standard = results.find(
      (result) =>
        result.sourceUnit === "skill:review" &&
        result.standardProfile === "agent-skills"
    );
    const profile = getStandardProfile("agent-skills");
    expect(
      standard?.evidence?.map((evidence) => ({
        ref: evidence.ref,
        verifiedAt: evidence.verifiedAt,
      }))
    ).toEqual(
      profile.provenance.snapshots.map((snapshot) => ({
        ref: snapshot.url,
        verifiedAt: profile.provenance.observedAt,
      }))
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        sourceUnit: "skill:review",
        status: "rendered",
        target: "codex",
      })
    );
  });

  test("rejects hidden package skill layouts without rejecting their root flattening", async () => {
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: nested-package-skill
codex: false
`,
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex: false
`,
        ".skillset/plugins/demo/skills/nested/helper/SKILL.md": `
---
name: helper
description: Help with the repository.
---

Help.
`,
      }),
      ["agent-plugins-1.0", "agent-skills"]
    );

    const rendered = await renderBuildGraph(graph);
    expect(paths(rendered)).toContain(".agents/skills/helper/SKILL.md");
    expect(paths(rendered)).not.toContain(
      "plugins/demo/agents/skills/helper/SKILL.md"
    );
    expect(agentSkillStandardProjectionIssues(graph, undefined)).toContainEqual(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "agent-plugins-skill-immediate-child",
          }),
        ],
        standardProfile: "agent-plugins-1.0",
      })
    );
  });

  test("rejects cross-source flattened identity collisions even when bytes match", async () => {
    const skill = `
---
name: shared
description: Shared skill.
---

Same body.
`;
    const graph = adopted(
      await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: duplicate-skill
codex: false
`,
        ".skillset/skills/shared/SKILL.md": skill,
        ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
codex: false
`,
        ".skillset/plugins/demo/skills/shared/SKILL.md": skill,
      }),
      ["agent-skills"]
    );

    await expect(renderBuildGraph(graph)).rejects.toThrow(
      "conflicting source identities"
    );
  });

  test.each([
    [
      "name length",
      (skill: SourceSkill) => ({
        ...skill,
        frontmatter: { ...skill.frontmatter, name: "a".repeat(65) },
      }),
      "agent-skills-name-limit",
    ],
    [
      "name shape",
      (skill: SourceSkill) => ({
        ...skill,
        frontmatter: { ...skill.frontmatter, name: "Bad--Name" },
      }),
      "agent-skills-name-shape",
    ],
    [
      "name-directory mismatch",
      (skill: SourceSkill) => ({
        ...skill,
        metadata: { ...skill.metadata, name: "other" },
      }),
      "agent-skills-name-directory",
    ],
    [
      "description length",
      (skill: SourceSkill) => ({
        ...skill,
        frontmatter: {
          ...skill.frontmatter,
          description: "x".repeat(1025),
        },
      }),
      "agent-skills-description-limit",
    ],
    [
      "compatibility length",
      (skill: SourceSkill) => ({
        ...skill,
        frontmatter: {
          ...skill.frontmatter,
          compatibility: "😀".repeat(501),
        },
      }),
      "agent-skills-compatibility-limit",
    ],
  ])(
    "classifies invalid standard %s without throwing",
    async (_name, mutate, code) => {
      const graph = await fixtureGraph({
        "skillset.yaml": `
skillset:
  name: classification
codex: false
`,
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review changes.
---

Review.
`,
      });
      const skill = mutate(graph.standaloneSkills[0] as SourceSkill);
      expect(classifyAgentSkillStandard(graph, undefined, skill)).toEqual(
        expect.objectContaining({
          issue: expect.objectContaining({ code }),
          status: "unsupported",
        })
      );
    }
  );

  test.each(["file", "directory"])(
    "rejects a declared resource whose %s symlink escapes the source root",
    async (kind) => {
      const root = await fixtureRoot({
        "skillset.yaml": `
skillset:
  name: resource-containment
codex: false
`,
        ".skillset/shared/.keep": "keep",
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
resources:
  references:
    - shared:escaped
---

Review the change.
`,
      });
      const outside = await mkdtemp(
        join(tmpdir(), "skillset-outside-resource-")
      );
      const target =
        kind === "file" ? join(outside, "secret.txt") : join(outside, "secret");
      if (kind === "file") {
        await Bun.write(target, "outside-secret\n");
      } else {
        await Bun.write(join(target, "secret.txt"), "outside-secret\n");
      }
      await symlink(target, join(root, ".skillset/shared/escaped"));

      await expect(loadBuildGraph(root)).rejects.toThrow(
        "resources source resolves outside the source root"
      );
    }
  );

  test.each(["file", "directory"])(
    "rejects a declared resource whose %s symlink escapes its shared namespace",
    async (kind) => {
      const root = await fixtureRoot({
        "skillset.yaml": `
skillset:
  name: resource-namespace-containment
codex: false
`,
        ".skillset/shared/.keep": "keep",
        ".skillset/rules/private.md": "private-rules",
        ".skillset/rules/private/secret.md": "private-directory",
        ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
resources:
  references:
    - shared:escaped
---

Review the change.
`,
      });
      const target =
        kind === "file"
          ? join(root, ".skillset/rules/private.md")
          : join(root, ".skillset/rules/private");
      await symlink(target, join(root, ".skillset/shared/escaped"));

      await expect(loadBuildGraph(root)).rejects.toThrow(
        "resources source resolves outside the source root"
      );
    }
  );
});

function adopted(
  graph: BuildGraph,
  profiles: readonly StandardProfileId[]
): BuildGraph {
  return {
    ...graph,
    standardProjections: {
      adopted: profiles,
      explicitNonAdopted: [],
    },
  };
}

function paths(rendered: readonly RenderedFile[]): readonly string[] {
  return rendered.map((file) => file.path);
}

function text(rendered: readonly RenderedFile[], path: string): string {
  const file = rendered.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`missing rendered file ${path}`);
  return decoder.decode(file.content);
}

function lockItems(
  rendered: readonly RenderedFile[],
  path: string
): Array<Record<string, unknown>> {
  const lock = JSON.parse(text(rendered, path)) as {
    items: Array<Record<string, unknown>>;
  };
  return lock.items;
}

async function fixtureGraph(
  files: Record<string, string>
): Promise<BuildGraph> {
  return loadBuildGraph(await fixtureRoot(files));
}

async function fixtureRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-agent-skills-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
