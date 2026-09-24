import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { renderBuildGraph } from "../render";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type { BuildGraph, RenderedFile } from "../types";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const textDecoder = new TextDecoder();

describe("Agent Instructions rendering", () => {
  test("coalesces the adopted standard with the Codex projection", async () => {
    const graph = await fixtureGraph(`
compile:
  targets: [codex]
`);

    const rendered = await renderBuildGraph(graph);
    const item = instructionItems(rendered, "AGENTS.md")[0];

    expect(rendered.filter((file) => file.path === "AGENTS.md")).toHaveLength(
      1
    );
    expect(item).toMatchObject({
      consumers: [
        { phase: "baseline", standardProfile: "agent-instructions" },
        { phase: "delta", target: "codex" },
      ],
      owner: { standardProfile: "agent-instructions" },
      outputPath: "AGENTS.md",
    });
    expect(instructionResults(graph, rendered)).toEqual([
      expect.objectContaining({
        sourceUnit: "rule:AGENTS.md",
        standardProfile: "agent-instructions",
        status: "transformed",
      }),
      expect.objectContaining({
        sourceUnit: "rule:AGENTS.md",
        status: "transformed",
        target: "codex",
      }),
      expect.objectContaining({
        sourceUnit: "rule:docs/AGENTS.md",
        standardProfile: "agent-instructions",
        status: "transformed",
      }),
      expect.objectContaining({
        sourceUnit: "rule:docs/AGENTS.md",
        status: "transformed",
        target: "codex",
      }),
    ]);
  });

  test("coalesces adopted root and nested standards output with Codex", async () => {
    const graph = adopted(
      await fixtureGraph(`
compile:
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
          sourceUnit: "rule:AGENTS.md",
          standardProfile: "agent-instructions",
        }),
        expect.objectContaining({
          sourceUnit: "rule:AGENTS.md",
          target: "codex",
        }),
        expect.objectContaining({
          sourceUnit: "rule:docs/AGENTS.md",
          standardProfile: "agent-instructions",
        }),
        expect.objectContaining({
          sourceUnit: "rule:docs/AGENTS.md",
          target: "codex",
        }),
      ])
    );
  });

  test("preserves instruction and non-Codex provider bytes across adoption", async () => {
    const graph = await fixtureGraph(`
compile:
  targets: [claude, codex, cursor]
`);

    const beforeAdoption = await renderBuildGraph(withoutAdoptedStandard(graph));
    const afterAdoption = await renderBuildGraph(graph);

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
        sourceUnit: "rule:AGENTS.md",
        standardProfile: "agent-instructions",
      }),
      expect.objectContaining({
        sourceUnit: "rule:docs/AGENTS.md",
        standardProfile: "agent-instructions",
      }),
    ]);
  });

  test("renders the adopted standard without a Codex consumer", async () => {
    const graph = await fixtureGraph(`
compile:
  targets: [claude]
`);

    const rendered = await renderBuildGraph(graph);

    expect(rendered.filter(isAgentsFile).map((file) => file.path)).toEqual([
      "AGENTS.md",
      "docs/AGENTS.md",
    ]);
    expect(instructionItems(rendered, "AGENTS.md")).toEqual([
      expect.objectContaining({
        consumers: [
          { phase: "baseline", standardProfile: "agent-instructions" },
        ],
        owner: { standardProfile: "agent-instructions" },
      }),
    ]);
  });
});

function adopted(graph: BuildGraph): BuildGraph {
  return {
    ...graph,
    standardProjections: {
      adopted: ["agent-instructions"],
      adoptionReceiptHashes: {
        "agent-instructions": TEST_RECEIPT_HASH,
      },
    },
  };
}

function withoutAdoptedStandard(graph: BuildGraph): BuildGraph {
  return {
    ...graph,
    standardProjections: { adopted: [], adoptionReceiptHashes: {} },
  };
}

const TEST_RECEIPT_HASH = `sha256:${"a".repeat(64)}` as const;

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
  const root = await createTestFixtureRoot("skillset-agent-instructions-");
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
