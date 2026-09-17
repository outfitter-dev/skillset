import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSkillsetResult, checkAdapterConformance } from "@skillset/core";
import type { AdapterConformanceCase } from "@skillset/core";

import { renderBuildGraph } from "../render";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import { parseMarkdown } from "../yaml";

const skill = (name: string, policy = ""): string => `
---
name: ${name}
description: ${name} invocation policy.
${policy}
---

Use ${name}.
`;

const fixture = async (files: Record<string, string>): Promise<string> => {
  const root = await mkdtemp(
    path.join(tmpdir(), "skillset-invocation-policy-")
  );
  await Promise.all(
    Object.entries(files).map(([file, content]) =>
      Bun.write(path.join(root, file), `${content.trim()}\n`)
    )
  );
  return root;
};

test("SET-522: lowers canonical invocation policy across provider skill surfaces", async () => {
  const root = await fixture({
    ".skillset/plugins/policy/skills/absent/SKILL.md": skill("absent"),
    ".skillset/plugins/policy/skills/cursor-only/SKILL.md": skill(
      "cursor-only",
      `implicit_invocation:
  cursor: false`
    ),
    ".skillset/plugins/policy/skills/native-only/SKILL.md": skill(
      "native-only",
      `cursor:
  frontmatter:
    disable-model-invocation: true`
    ),
    ".skillset/plugins/policy/skills/native-override/SKILL.md": skill(
      "native-override",
      `implicit_invocation: false
cursor:
  frontmatter:
    disable-model-invocation: true`
    ),
    ".skillset/plugins/policy/skills/shared-false/SKILL.md": skill(
      "shared-false",
      "implicit_invocation: false"
    ),
    ".skillset/plugins/policy/skills/shared-true/SKILL.md": skill(
      "shared-true",
      "implicit_invocation: true"
    ),
    ".skillset/plugins/policy/skills/targeted/SKILL.md": skill(
      "targeted",
      `implicit_invocation:
  claude: false
  codex: true
  cursor: false`
    ),
    ".skillset/plugins/policy/skillset.yaml": `
skillset:
  name: policy
codex: false
`,
    ".skillset/skills/standalone/SKILL.md": skill(
      "standalone",
      "implicit_invocation: false"
    ),
    "skillset.yaml": `
skillset:
  name: invocation-policy
claude: true
codex: true
cursor: true
`,
  });

  const build = await buildSkillsetResult(root);

  const policy = async (name: string) =>
    parseMarkdown(
      await readFile(
        path.join(root, `plugins/policy/skills/${name}/SKILL.md`),
        "utf-8"
      ),
      name
    ).frontmatter["disable-model-invocation"];
  expect(await policy("absent")).toBeUndefined();

  expect(await policy("shared-true")).toBe(false);

  expect(await policy("shared-false")).toBe(true);

  expect(await policy("targeted")).toBe(true);

  expect(await policy("cursor-only")).toBe(true);

  expect(await policy("native-only")).toBe(true);
  expect(await policy("native-override")).toBe(true);

  const standaloneCursor = parseMarkdown(
    await readFile(
      path.join(root, ".cursor/skills/standalone/SKILL.md"),
      "utf-8"
    ),
    "cursor:standalone"
  );
  expect(standaloneCursor.frontmatter["disable-model-invocation"]).toBe(true);
  expect(
    await readFile(
      path.join(root, ".agents/skills/standalone/agents/openai.yaml"),
      "utf-8"
    )
  ).toContain("allow_implicit_invocation: false");

  const invocationOutcomes = build.renderResults.filter(
    (outcome) => outcome.featureId === "skill-invocation-policy"
  );
  const invocationOutcome = (name: string, target: string) =>
    invocationOutcomes.find(
      (outcome) =>
        outcome.sourceUnit === `plugin.policy.skill:${name}` &&
        outcome.target === target
    );
  const targets = ["claude", "cursor"] as const;

  expect(targets.map((target) => invocationOutcome("absent", target))).toEqual([
    undefined,
    undefined,
  ]);
  expect(
    targets.map((target) => invocationOutcome("shared-false", target)?.status)
  ).toEqual(["transformed", "transformed"]);
  expect(
    targets.map((target) => invocationOutcome("targeted", target)?.status)
  ).toEqual(["transformed", "transformed"]);
  expect(invocationOutcome("cursor-only", "claude")).toBeUndefined();
  expect(invocationOutcome("cursor-only", "cursor")?.status).toBe(
    "transformed"
  );
  expect(
    invocationOutcome("native-override", "cursor")?.diagnostics
  ).toContainEqual(
    expect.objectContaining({
      code: "skill-invocation-policy-native-override",
    })
  );
  expect(
    build.renderResults.filter(
      (outcome) =>
        outcome.featureId === "tools-policy" &&
        outcome.sourceUnit.startsWith("plugin.policy.skill:")
    )
  ).toEqual([]);

  const conformanceCases: readonly AdapterConformanceCase[] = [
    ...targets.map((target) => ({
      featureId: "skill-invocation-policy",
      sourceUnit: "plugin.policy.skill:shared-false",
      target,
    })),
    ...targets.map((target) => ({
      featureId: "skill-invocation-policy",
      sourceUnit: "plugin.policy.skill:targeted",
      target,
    })),
    {
      featureId: "skill-invocation-policy",
      sourceUnit: "plugin.policy.skill:cursor-only",
      target: "cursor",
    },
    {
      featureId: "skill-invocation-policy",
      sourceUnit: "plugin.policy.skill:native-override",
      target: "cursor",
    },
  ];
  expect(checkAdapterConformance(invocationOutcomes, conformanceCases)).toEqual(
    { issues: [], ok: true }
  );
});

test("SET-522: rejects divergent provider invocation policy in one shared skill", async () => {
  const root = await fixture({
    ".skillset/plugins/policy/skills/divergent/SKILL.md": skill(
      "divergent",
      `implicit_invocation: false
cursor:
  frontmatter:
    disable-model-invocation: false`
    ),
    ".skillset/plugins/policy/skillset.yaml": `
skillset:
  name: policy
codex: false
`,
    "skillset.yaml": `
skillset:
  name: divergent-invocation-policy
claude: true
codex: false
cursor: true
`,
  });

  await expect(buildSkillsetResult(root)).rejects.toThrow(
    "plugin policy skill divergent provider cursor conflicts at disable-model-invocation"
  );
});

test("SET-402: coalesced Codex Agent Skills projection reports one invocation policy result", async () => {
  const root = await fixture({
    ".skillset/skills/guide/SKILL.md": skill("guide", "implicit_invocation: false"),
    "skillset.yaml": `
skillset:
  name: coalesced-policy
claude: false
codex: true
cursor: false
`,
  });
  const graph = {
    ...(await loadBuildGraph(root)),
    standardProjections: {
      adopted: ["agent-skills" as const],
      adoptionReceiptHashes: { "agent-skills": `sha256:${"a".repeat(64)}` as const },
    },
  };
  const rendered = await renderBuildGraph(graph);
  const results = collectRenderResults(graph, rendered, {
    claudeMarketplacePlugins: [],
    includedPaths: new Set(rendered.map((file) => file.path)),
  });

  const invocationOutcomes = results.filter(
    (outcome) =>
      outcome.featureId === "skill-invocation-policy" &&
      outcome.sourceUnit === "skill:guide" &&
      outcome.target === "codex"
  );
  expect(invocationOutcomes.map((outcome) => outcome.status)).toEqual([
    "transformed",
  ]);
  expect(invocationOutcomes[0]?.outputs).toEqual([
    { kind: "metadata", path: ".agents/skills/guide/agents/openai.yaml" },
  ]);
  expect(
    checkAdapterConformance(invocationOutcomes, [
      {
        featureId: "skill-invocation-policy",
        sourceUnit: "skill:guide",
        target: "codex",
      },
    ])
  ).toEqual({ issues: [], ok: true });
});
