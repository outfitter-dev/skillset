import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSkillsetResult, checkAdapterConformance } from "@skillset/core";
import type { AdapterConformanceCase } from "@skillset/core";

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
    disable-model-invocation: false`
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

  const policy = async (target: "claude" | "cursor", name: string) =>
    parseMarkdown(
      await readFile(
        path.join(root, `plugins/policy/${target}/skills/${name}/SKILL.md`),
        "utf-8"
      ),
      `${target}:${name}`
    ).frontmatter["disable-model-invocation"];
  const codexPolicy = async (name: string) =>
    parseMarkdown(
      await readFile(
        path.join(root, `plugins/policy/codex/skills/${name}/SKILL.md`),
        "utf-8"
      ),
      `codex:${name}`
    ).frontmatter;
  const codexAgentPolicy = (name: string) =>
    readFile(
      path.join(root, `plugins/policy/codex/skills/${name}/agents/openai.yaml`),
      "utf-8"
    );

  expect(await policy("claude", "absent")).toBeUndefined();
  expect(await policy("cursor", "absent")).toBeUndefined();
  expect(await codexPolicy("absent")).not.toHaveProperty("implicit_invocation");

  expect(await policy("claude", "shared-true")).toBe(false);
  expect(await policy("cursor", "shared-true")).toBe(false);
  expect(await codexAgentPolicy("shared-true")).toContain(
    "allow_implicit_invocation: true"
  );

  expect(await policy("claude", "shared-false")).toBe(true);
  expect(await policy("cursor", "shared-false")).toBe(true);
  expect(await codexAgentPolicy("shared-false")).toContain(
    "allow_implicit_invocation: false"
  );

  expect(await policy("claude", "targeted")).toBe(true);
  expect(await policy("cursor", "targeted")).toBe(true);
  expect(await codexAgentPolicy("targeted")).toContain(
    "allow_implicit_invocation: true"
  );

  expect(await policy("claude", "cursor-only")).toBeUndefined();
  expect(await policy("cursor", "cursor-only")).toBe(true);
  expect(
    await Bun.file(
      path.join(
        root,
        "plugins/policy/codex/skills/cursor-only/agents/openai.yaml"
      )
    ).exists()
  ).toBe(false);

  expect(await policy("claude", "native-only")).toBeUndefined();
  expect(await policy("cursor", "native-only")).toBe(true);
  expect(await policy("cursor", "native-override")).toBe(false);
  expect(await policy("claude", "native-override")).toBe(true);

  const standaloneCursor = parseMarkdown(
    await readFile(
      path.join(root, ".cursor/skills/standalone/SKILL.md"),
      "utf-8"
    ),
    "cursor:standalone"
  );
  expect(standaloneCursor.frontmatter["disable-model-invocation"]).toBe(true);

  const invocationOutcomes = build.renderResults.filter(
    (outcome) => outcome.featureId === "skill-invocation-policy"
  );
  const invocationOutcome = (name: string, target: string) =>
    invocationOutcomes.find(
      (outcome) =>
        outcome.sourceUnit === `plugin.policy.skill:${name}` &&
        outcome.target === target
    );
  const targets = ["claude", "codex", "cursor"] as const;

  expect(targets.map((target) => invocationOutcome("absent", target))).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(
    targets.map((target) => invocationOutcome("shared-false", target)?.status)
  ).toEqual(["transformed", "transformed", "transformed"]);
  expect(
    targets.map((target) => invocationOutcome("targeted", target)?.status)
  ).toEqual(["transformed", "transformed", "transformed"]);
  expect(invocationOutcome("cursor-only", "claude")).toBeUndefined();
  expect(invocationOutcome("cursor-only", "codex")).toBeUndefined();
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
