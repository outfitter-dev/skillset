import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTIVATION_READINESS_SCHEMA,
  activationRequirementId,
  deriveActivationSubjects,
  planActivationReadiness,
  summarizeActivationReadiness,
  targetRecord,
} from "@skillset/core";
import type {
  ActivationRequirement,
  SkillsetRenderResult,
} from "@skillset/core";
import { listProviderActivationDescriptors } from "../activation-policy";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { loadBuildGraph } from "../resolver";
import type { BuildGraph, SourcePlugin, TargetName } from "../types";

describe("SET-390 activation readiness", () => {
  it("derives and merges canonical dependency, MCP, and app subjects", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          dependencies: [
            {
              kind: "external",
              marketplace: "outfitter",
              name: "github",
              range: "^1.0.0",
              sourceLabel: ".skillset/plugins/tools/skillset.yaml",
              unversioned: false,
            },
          ],
          features: [
            {
              key: "mcp",
              origin: "conventional",
              sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
              subjects: ["github", "linear"],
              targetPath: ".mcp.json",
            },
          ],
          id: "tools",
        }),
      ],
      projectIslands: [
        {
          plugin: "tools",
          relativePath: ".app.json",
          sourcePath: "/repo/.skillset/plugins/tools/_codex/.app.json",
          target: "codex",
        },
      ],
    });

    const subjects = deriveActivationSubjects(graph);
    expect(
      subjects.map((subject) => [
        subject.target,
        subject.capability,
        subject.subject,
      ])
    ).toEqual([
      ["claude", "mcp-server", "github"],
      ["claude", "mcp-server", "linear"],
      ["claude", "plugin-dependency", "outfitter/github"],
      ["codex", "app", "tools"],
      ["codex", "mcp-server", "github"],
      ["codex", "mcp-server", "linear"],
      ["codex", "plugin-dependency", "outfitter/github"],
      ["cursor", "mcp-server", "github"],
      ["cursor", "mcp-server", "linear"],
      ["cursor", "plugin-dependency", "outfitter/github"],
    ]);
    expect(subjects.flatMap((subject) => subject.sourcePaths)).not.toContain(
      "/repo/.skillset/plugins/tools/.mcp.json"
    );
  });

  it("does not invent an MCP server subject for an empty source", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          features: [
            {
              key: "mcp",
              origin: "conventional",
              sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
              subjects: [],
              targetPath: ".mcp.json",
            },
          ],
          id: "tools",
        }),
      ],
    });

    expect(deriveActivationSubjects(graph)).toEqual([]);
  });

  it("preserves every dependency declaration as readiness provenance", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
dependencies:
  plugins:
    - name: github
      range: ^1.0.0
`,
      ".skillset/plugins/tools/skills/review/SKILL.md": `
---
description: Review repository changes.
dependencies:
  plugins:
    - name: github
      range: ^1.0.0
---

Review the change.
`,
      "skillset.yaml": `
skillset:
  name: runtime-readiness
compile:
  targets: [codex]
`,
    });

    const graph = await loadBuildGraph(root);
    const dependency = deriveActivationSubjects(graph).find(
      (subject) =>
        subject.target === "codex" &&
        subject.capability === "plugin-dependency" &&
        subject.subject === "github"
    );
    expect(dependency).toMatchObject({
      sourcePaths: [
        ".skillset/plugins/tools/skills/review/SKILL.md",
        ".skillset/plugins/tools/skillset.yaml",
      ],
      sourceUnits: [
        "plugin.tools.feature:dependencies",
        "plugin.tools.skill:review",
      ],
    });
  });

  it("restricts target-native app subjects to Codex islands", () => {
    const graph = graphFixture({
      plugins: [pluginFixture({ id: "tools" })],
      projectIslands: (["claude", "codex", "cursor"] as const).map(
        (target) => ({
          plugin: "tools",
          relativePath: ".app.json",
          sourcePath: `/repo/.skillset/plugins/tools/_${target}/.app.json`,
          target,
        })
      ),
    });

    expect(
      deriveActivationSubjects(graph).filter(
        (subject) => subject.capability === "app"
      )
    ).toEqual([
      {
        capability: "app",
        origin: "source",
        required: true,
        sourcePaths: [".skillset/plugins/tools/_codex/.app.json"],
        sourceUnits: ["plugin.tools.codex.app:.app.json"],
        subject: "tools",
        target: "codex",
      },
    ]);
  });

  it("omits a workspace-disabled target even when a plugin enables it", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          dependencies: [
            {
              kind: "external",
              name: "github",
              sourceLabel: ".skillset/plugins/tools/skillset.yaml",
              unversioned: true,
            },
          ],
          id: "tools",
        }),
      ],
      rootTargets: targetRecord((target) => ({
        enabled: target !== "codex",
        options: {},
      })),
    });

    const report = planActivationReadiness({ graph, renderResults: [] });
    expect(report.enabledTargets).toEqual(["claude", "cursor"]);
    expect(
      report.requirements.some((requirement) => requirement.target === "codex")
    ).toBe(false);
  });

  it("omits subjects for plugins excluded from target outputs", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          dependencies: [
            {
              kind: "external",
              name: "github",
              sourceLabel: ".skillset/plugins/tools/skillset.yaml",
              unversioned: true,
            },
          ],
          features: [
            {
              key: "mcp",
              origin: "conventional",
              sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
              subjects: ["github"],
              targetPath: ".mcp.json",
            },
          ],
          id: "tools",
        }),
      ],
      projectIslands: [
        {
          plugin: "tools",
          relativePath: ".app.json",
          sourcePath: "/repo/.skillset/plugins/tools/_codex/.app.json",
          target: "codex",
        },
      ],
      targetOutputs: targetRecord((target) => ({
        plugins: target === "claude" ? false : ["other"],
        skills: true,
      })),
    });

    expect(deriveActivationSubjects(graph)).toEqual([]);
  });

  it("combines static render facts with no optimistic runtime inference", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          dependencies: [
            {
              kind: "internal",
              name: "shared",
              sourceLabel: ".skillset/plugins/tools/skillset.yaml",
              unversioned: false,
            },
          ],
          id: "tools",
        }),
        pluginFixture({ id: "shared" }),
      ],
    });
    const renderResults: readonly SkillsetRenderResult[] = [
      renderResult({
        featureId: "dependencies",
        sourceUnit: "plugin.tools.feature:dependencies",
        status: "rendered",
        target: "claude",
      }),
      renderResult({
        featureId: "dependencies",
        sourceUnit: "plugin.tools.feature:dependencies",
        status: "degraded",
        target: "codex",
      }),
      renderResult({
        featureId: "dependencies",
        reason: "Cursor dependency projection is unavailable.",
        sourceUnit: "plugin.tools.feature:dependencies",
        status: "unsupported",
        target: "cursor",
      }),
    ];

    const report = planActivationReadiness({
      graph,
      renderResults,
    });

    expect(report.schema).toBe(ACTIVATION_READINESS_SCHEMA);
    expect(report.summary).toBe("blocked");
    expect(
      requirement(report, "claude", "plugin-dependency", "shared", "declared")
        .state
    ).toBe("satisfied");
    expect(
      requirement(report, "claude", "plugin-dependency", "shared", "rendered")
        .state
    ).toBe("satisfied");
    expect(
      requirement(
        report,
        "claude",
        "plugin-dependency",
        "shared",
        "discoverable"
      ).state
    ).toBe("unverified");
    expect(
      requirement(report, "codex", "plugin-dependency", "shared", "rendered")
        .state
    ).toBe("satisfied");
    expect(
      requirement(report, "cursor", "plugin-dependency", "shared", "rendered")
        .state
    ).toBe("blocked");
    expect(
      requirement(report, "claude", "plugin-dependency", "shared", "proven")
        .required
    ).toBe(false);
  });

  it("does not satisfy rendered requirements from stale generated output", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          dependencies: [
            {
              kind: "internal",
              name: "shared",
              sourceLabel: ".skillset/plugins/tools/skillset.yaml",
              unversioned: false,
            },
          ],
          id: "tools",
        }),
        pluginFixture({ id: "shared" }),
      ],
    });
    const outputPath = "plugins/tools/claude/.claude-plugin/plugin.json";
    const report = planActivationReadiness({
      graph,
      renderResults: [
        renderResult({
          featureId: "dependencies",
          outputs: [{ path: outputPath }],
          sourceUnit: "plugin.tools.feature:dependencies",
          status: "rendered",
          target: "claude",
        }),
      ],
      untrustedOutputPaths: [`./${outputPath}`],
    });

    expect(
      requirement(report, "claude", "plugin-dependency", "shared", "rendered")
    ).toMatchObject({
      reason: "generated output for this requirement is missing or stale",
      state: "missing",
    });
    expect(report.summary).toBe("attention");
  });

  it("uses matching observations only and preserves their effect", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          dependencies: [
            {
              kind: "internal",
              name: "shared",
              sourceLabel: ".skillset/plugins/tools/skillset.yaml",
              unversioned: false,
            },
          ],
          id: "tools",
        }),
        pluginFixture({ id: "shared" }),
      ],
    });
    const renderResults = (["claude", "codex", "cursor"] as const).map(
      (target) =>
        renderResult({
          featureId: "dependencies",
          sourceUnit: "plugin.tools.feature:dependencies",
          status: "rendered",
          target,
        })
    );

    const report = planActivationReadiness({
      graph,
      observations: [
        {
          capability: "plugin-dependency",
          claim: "enabled",
          inspectorId: "codex.plugin.list",
          observationEffect: "passive",
          origin: "observed",
          stage: "enabled",
          state: "satisfied",
          subject: "shared",
          target: "codex",
        },
      ],
      renderResults,
    });

    expect(report.summary).toBe("ready_unverified");
    expect(
      requirement(report, "codex", "plugin-dependency", "shared", "enabled")
    ).toMatchObject({
      observationEffect: "passive",
      origin: "observed",
      state: "satisfied",
    });
    expect(
      requirement(report, "claude", "plugin-dependency", "shared", "enabled")
        .state
    ).toBe("unverified");
  });

  it("rejects observations outside registry claim and effect boundaries", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          features: [
            {
              key: "mcp",
              origin: "conventional",
              sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
              subjects: ["github"],
              targetPath: ".mcp.json",
            },
          ],
          id: "tools",
        }),
      ],
    });

    expect(() =>
      planActivationReadiness({
        graph,
        observations: [
          {
            capability: "mcp-server",
            claim: "connected",
            inspectorId: "codex.mcp.list",
            observationEffect: "passive",
            origin: "observed",
            stage: "connected",
            state: "satisfied",
            subject: "github",
            target: "codex",
          },
        ],
        renderResults: [],
      })
    ).toThrow("codex.mcp.list cannot claim connected");

    expect(() =>
      planActivationReadiness({
        graph,
        observations: [
          {
            capability: "mcp-server",
            claim: "discoverable",
            inspectorId: "codex.mcp.list",
            observationEffect: "active",
            origin: "observed",
            stage: "discoverable",
            state: "satisfied",
            subject: "github",
            target: "codex",
          },
        ],
        renderResults: [],
      })
    ).toThrow("codex.mcp.list requires passive effect");
  });

  it("rejects duplicate observations independent of input order", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          features: [
            {
              key: "mcp",
              origin: "conventional",
              sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
              subjects: ["github"],
              targetPath: ".mcp.json",
            },
          ],
          id: "tools",
        }),
      ],
    });
    const observations = [
      {
        capability: "mcp-server",
        claim: "discoverable",
        inspectorId: "codex.mcp.list",
        observationEffect: "passive",
        origin: "observed",
        stage: "discoverable",
        state: "satisfied",
        subject: "github",
        target: "codex",
      },
      {
        capability: "mcp-server",
        claim: "discoverable",
        inspectorId: "codex.mcp.list",
        observationEffect: "passive",
        origin: "observed",
        reasonCode: "codex.mcp.not-discoverable",
        stage: "discoverable",
        state: "missing",
        subject: "github",
        target: "codex",
      },
    ] as const;

    for (const candidate of [observations, observations.toReversed()]) {
      expect(() =>
        planActivationReadiness({
          graph,
          observations: candidate,
          renderResults: [],
        })
      ).toThrow(
        "duplicate activation observation activation:codex:mcp-server:github:discoverable"
      );
    }
  });

  it("derives fallback reasons and actions from the provider registry", () => {
    const graph = graphFixture({
      plugins: [
        pluginFixture({
          features: [
            {
              key: "mcp",
              origin: "conventional",
              sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
              subjects: ["github"],
              targetPath: ".mcp.json",
            },
          ],
          id: "tools",
        }),
      ],
    });

    expect(
      requirement(
        planActivationReadiness({ graph, renderResults: [] }),
        "codex",
        "mcp-server",
        "github",
        "discoverable"
      )
    ).toMatchObject({
      nextActions: [
        {
          id: "codex.mcp.configure",
          label: "Configure the MCP server in Codex",
          mutates: true,
          url: "https://developers.openai.com/codex/mcp",
        },
      ],
      observationEffect: "none",
      reason: "Codex did not report the required MCP server as configured.",
      state: "unverified",
    });
  });

  it("rejects incomplete injected provider descriptor sets", () => {
    expect(() =>
      planActivationReadiness({
        descriptors: listProviderActivationDescriptors().slice(1),
        graph: graphFixture(),
        renderResults: [],
      })
    ).toThrow("missing provider activation descriptor claude:app");
  });

  it("applies the total summary precedence and ignores optional findings", () => {
    expect(summarizeActivationReadiness([])).toBe("ready");
    expect(
      summarizeActivationReadiness([
        requirementFixture({ required: true, state: "unverified" }),
      ])
    ).toBe("ready_unverified");
    expect(
      summarizeActivationReadiness([
        requirementFixture({ required: true, state: "stale" }),
        requirementFixture({ required: false, state: "blocked" }),
      ])
    ).toBe("attention");
    expect(
      summarizeActivationReadiness([
        requirementFixture({ required: true, state: "missing" }),
        requirementFixture({ required: true, state: "blocked" }),
      ])
    ).toBe("blocked");
    expect(
      summarizeActivationReadiness([
        requirementFixture({ required: false, state: "blocked" }),
        requirementFixture({ required: true, state: "satisfied" }),
      ])
    ).toBe("ready");
  });

  it("creates injective requirement ids for delimiter-bearing subjects", () => {
    expect(
      activationRequirementId({
        capability: "mcp-server",
        stage: "connected",
        subject: "github:read/write",
        target: "claude",
      })
    ).toBe("activation:claude:mcp-server:github%3Aread%2Fwrite:connected");
  });

  it("discovers canonical MCP server subjects while resolving source", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/.mcp.json": `{
  "mcpServers": {
    "linear": { "command": "linear-mcp" },
    "github": { "command": "github-mcp" }
  }
}`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
mcp: true
`,
      "skillset.yaml": `
skillset:
  name: runtime-readiness
compile:
  targets: [claude, codex, cursor]
`,
    });

    const graph = await loadBuildGraph(root);
    expect(graph.plugins[0]?.features[0]?.subjects).toEqual([
      "github",
      "linear",
    ]);
    expect(
      deriveActivationSubjects(graph)
        .filter(
          (subject) =>
            subject.capability === "mcp-server" && subject.target === "codex"
        )
        .map((subject) => subject.subject)
    ).toEqual(["github", "linear"]);
  });

  it("discovers a conventional plugin app from the resolved graph", async () => {
    const root = await fixture({
      ".skillset/plugins/tools/.app.json": `{
  "name": "tools"
}`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
      "skillset.yaml": `
skillset:
  name: runtime-readiness
compile:
  targets: [claude, codex, cursor]
`,
    });

    const graph = await loadBuildGraph(root);
    expect(graph.plugins[0]?.features).toEqual([
      expect.objectContaining({
        key: "app",
        origin: "conventional",
        targetPath: ".app.json",
      }),
    ]);
    expect(
      deriveActivationSubjects(graph).filter(
        (subject) => subject.capability === "app"
      )
    ).toEqual([
      {
        capability: "app",
        origin: "source",
        required: true,
        sourcePaths: [".skillset/plugins/tools/.app.json"],
        sourceUnits: ["plugin.tools.feature:app"],
        subject: "tools",
        target: "codex",
      },
    ]);
  });
});

function graphFixture(
  overrides: {
    readonly plugins?: readonly SourcePlugin[];
    readonly projectIslands?: BuildGraph["projectIslands"];
    readonly rootTargets?: BuildGraph["root"]["targets"];
    readonly targetOutputs?: BuildGraph["root"]["outputs"]["targetOutputs"];
  } = {}
): BuildGraph {
  return {
    plugins: overrides.plugins ?? [],
    projectIslands: overrides.projectIslands ?? [],
    root: {
      outputs: {
        plugins: targetRecord((target) => `plugins/{plugin}/${target}`),
        skills: targetRecord((target) => `.${target}/skills`),
        targetOutputs:
          overrides.targetOutputs ??
          targetRecord(() => ({ plugins: true, skills: true })),
      },
      targets:
        overrides.rootTargets ??
        targetRecord(() => ({ enabled: true, options: {} })),
    },
    rootPath: "/repo",
  } as unknown as BuildGraph;
}

function pluginFixture(overrides: {
  readonly dependencies?: SourcePlugin["dependencies"];
  readonly features?: SourcePlugin["features"];
  readonly id: string;
}): SourcePlugin {
  return {
    adaptiveHooks: [],
    configPath: `/repo/.skillset/plugins/${overrides.id}/skillset.yaml`,
    dependencies: overrides.dependencies ?? [],
    features: overrides.features ?? [],
    hookAttachments: [],
    id: overrides.id,
    metadata: {},
    path: `/repo/.skillset/plugins/${overrides.id}`,
    skills: [],
    targets: targetRecord(() => ({ enabled: true, options: {} })),
  };
}

function renderResult(overrides: {
  readonly featureId: string;
  readonly outputs?: NonNullable<SkillsetRenderResult["outputs"]>;
  readonly reason?: string;
  readonly sourceUnit: string;
  readonly status: SkillsetRenderResult["status"];
  readonly target: TargetName;
}): SkillsetRenderResult {
  return {
    schema: "skillset-render-result@1",
    ...overrides,
  };
}

function requirement(
  report: ReturnType<typeof planActivationReadiness>,
  target: TargetName,
  capability: ActivationRequirement["capability"],
  subject: string,
  stage: ActivationRequirement["stage"]
): ActivationRequirement {
  const found = report.requirements.find(
    (candidate) =>
      candidate.target === target &&
      candidate.capability === capability &&
      candidate.subject === subject &&
      candidate.stage === stage
  );
  if (found === undefined) {
    throw new Error("missing activation requirement fixture");
  }
  return found;
}

function requirementFixture(
  overrides: Partial<ActivationRequirement>
): ActivationRequirement {
  return {
    capability: "plugin-dependency",
    id: "activation:claude:plugin-dependency:demo:declared",
    nextActions: [],
    observationEffect: "none",
    origin: "derived",
    reason: "fixture",
    required: true,
    sourcePaths: [],
    sourceUnits: [],
    stage: "declared",
    state: "satisfied",
    subject: "demo",
    target: "claude",
    ...overrides,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-runtime-readiness-"));
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
