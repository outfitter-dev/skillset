import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { renderBuildGraph } from "../render";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type { BuildGraph, RenderedFile } from "../types";

const textDecoder = new TextDecoder();

describe("Agent Instructions rendering", () => {
  test("preserves the candidate-era Codex projection", async () => {
    const graph = await fixtureGraph(`
compile:
  agents: true
  targets: [codex]
`);

    const rendered = await renderBuildGraph(graph);
    const item = instructionItems(rendered, "AGENTS.md")[0];

    expect(rendered.filter((file) => file.path === "AGENTS.md")).toHaveLength(
      1
    );
    expect(item).toMatchObject({
      consumers: [{ phase: "delta", target: "codex" }],
      owner: { target: "codex" },
      outputPath: "AGENTS.md",
    });
    expect(instructionResults(graph, rendered)).toEqual([
      expect.objectContaining({
        sourceUnit: "instruction:AGENTS.md",
        status: "transformed",
        target: "codex",
      }),
      expect.objectContaining({
        sourceUnit: "instruction:docs/AGENTS.md",
        status: "transformed",
        target: "codex",
      }),
    ]);
  });

  test("coalesces adopted root and nested standards output with Codex", async () => {
    const graph = adopted(
      await fixtureGraph(`
compile:
  agents: true
  targets: [codex]
`)
    );

    const rendered = await renderBuildGraph(graph);
    const items = instructionItems(rendered);

    expect(rendered.filter(isAgentsFile).map((file) => file.path)).toEqual([
      "AGENTS.md",
      "docs/AGENTS.md",
    ]);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({
        consumers: [
          { phase: "baseline", standardProfile: "agent-instructions" },
          { phase: "delta", target: "codex" },
        ],
        owner: { standardProfile: "agent-instructions" },
      });
    }

    const results = instructionResults(graph, rendered);
    expect(results).toHaveLength(4);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUnit: "instruction:AGENTS.md",
          standardProfile: "agent-instructions",
        }),
        expect.objectContaining({
          sourceUnit: "instruction:AGENTS.md",
          target: "codex",
        }),
        expect.objectContaining({
          sourceUnit: "instruction:docs/AGENTS.md",
          standardProfile: "agent-instructions",
        }),
        expect.objectContaining({
          sourceUnit: "instruction:docs/AGENTS.md",
          target: "codex",
        }),
      ])
    );
  });

  test("preserves instruction and non-Codex provider bytes across adoption", async () => {
    const graph = await fixtureGraph(`
compile:
  agents: true
  targets: [claude, codex, cursor]
`);

    const beforeAdoption = await renderBuildGraph(graph);
    const afterAdoption = await renderBuildGraph(adopted(graph));

    expect(fileBytes(beforeAdoption, isAgentsFile)).toEqual(
      fileBytes(afterAdoption, isAgentsFile)
    );
    expect(fileBytes(beforeAdoption, isIndependentProviderFile)).toEqual(
      fileBytes(afterAdoption, isIndependentProviderFile)
    );
  });

  test("retains adopted standards output after removing the Codex consumer", async () => {
    const graph = adopted(
      await fixtureGraph(`
compile:
  agents: true
  targets: []
`)
    );

    const rendered = await renderBuildGraph(graph);
    const items = instructionItems(rendered);

    expect(rendered.filter(isAgentsFile).map((file) => file.path)).toEqual([
      "AGENTS.md",
      "docs/AGENTS.md",
    ]);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({
        consumers: [
          { phase: "baseline", standardProfile: "agent-instructions" },
        ],
        owner: { standardProfile: "agent-instructions" },
      });
    }
    expect(instructionResults(graph, rendered)).toEqual([
      expect.objectContaining({
        sourceUnit: "instruction:AGENTS.md",
        standardProfile: "agent-instructions",
      }),
      expect.objectContaining({
        sourceUnit: "instruction:docs/AGENTS.md",
        standardProfile: "agent-instructions",
      }),
    ]);
  });

  test.each([
    ["family", "agents: false"],
    ["instructions", "agents:\n    instructions: false"],
  ])(
    "honors the explicit %s opt-out with Codex enabled",
    async (_label, agents) => {
      const graph = adopted(
        await fixtureGraph(`
compile:
  ${agents}
  targets: [codex]
`)
      );

      const rendered = await renderBuildGraph(graph);

      expect(rendered.filter(isAgentsFile)).toEqual([]);
      expect(instructionItems(rendered)).toEqual([]);
      expect(instructionResults(graph, rendered)).toEqual([]);
    }
  );
});

function adopted(graph: BuildGraph): BuildGraph {
  return {
    ...graph,
    standardProjections: {
      adopted: ["agent-instructions"],
      explicitNonAdopted: [],
    },
  };
}

function instructionResults(
  graph: BuildGraph,
  rendered: readonly RenderedFile[]
) {
  return collectRenderResults(graph, rendered, {
    claudeMarketplacePlugins: [],
    includedPaths: new Set(rendered.map((file) => file.path)),
  }).filter((result) => result.featureId === "project-instructions");
}

function instructionItems(
  rendered: readonly RenderedFile[],
  outputPath?: string
): Array<Record<string, unknown>> {
  const lockFile = rendered.find((file) => file.path === "skillset.lock");
  if (lockFile === undefined) return [];
  const lock = JSON.parse(textDecoder.decode(lockFile.content)) as {
    items: Array<Record<string, unknown>>;
  };
  return lock.items.filter(
    (item) =>
      item.kind === "rule" &&
      (outputPath === undefined || item.outputPath === outputPath)
  );
}

function isAgentsFile(file: RenderedFile): boolean {
  return file.path === "AGENTS.md" || file.path.endsWith("/AGENTS.md");
}

function isIndependentProviderFile(file: RenderedFile): boolean {
  return (
    !file.path.endsWith("skillset.lock") &&
    (file.path.startsWith(".claude/") || file.path.startsWith(".cursor/"))
  );
}

function fileBytes(
  rendered: readonly RenderedFile[],
  predicate: (file: RenderedFile) => boolean
): Array<[string, string]> {
  return rendered
    .filter(predicate)
    .map((file) => [file.path, textDecoder.decode(file.content)]);
}

async function fixtureGraph(compile: string): Promise<BuildGraph> {
  const root = await mkdtemp(join(tmpdir(), "skillset-agent-instructions-"));
  const files = normalizeSkillsetFixtureFiles({
    "skillset.yaml": `
skillset:
  name: agent-instructions-fixture
${compile}
`,
    ".skillset/rules/root.md": "# Root instructions\n",
    ".skillset/rules/docs.md": `
---
paths:
  - docs/**/*.md
---

# Documentation instructions
`,
    "docs/guide.md": "# Guide\n",
  });
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return loadBuildGraph(root);
}
