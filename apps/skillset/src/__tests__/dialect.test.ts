import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { buildSkillset } from "@skillset/core";
import { registerTransformEntry, transformEntries } from "@skillset/transforms";

const SKILL_BODY = [
  "Skills live in .claude/skills/x and config in ~/.claude/foo.",
  "",
  "Read CLAUDE.md first, then ask @helper to verify.",
  "",
  "Use $ARGUMENTS verbatim.",
].join("\n");

const DIALECT_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: dialect-root
claude: true
codex: true
`,
  ".skillset/skills/x/SKILL.md": `---
name: x
description: Claude-dialect skill.
dialect: claude
---

${SKILL_BODY}
`,
  ".skillset/skills/y/SKILL.md": `---
name: y
description: Portable skill with the same body.
---

${SKILL_BODY}
`,
};

test("dialect preserves ambiguous body text at the shared Agent Skills root", async () => {
  const root = await fixture(DIALECT_FIXTURE);
  await buildSkillset(root);
  for (const name of ["x", "y"]) {
    const output = await readFile(join(root, `.agents/skills/${name}/SKILL.md`), "utf8");
    expect(output).toContain(SKILL_BODY);
  }
});

test("explicit semantic translation still rejects a divergent shared-root delta", async () => {
  const intent = "test.dialect-explicit";
  registerTransformEntry({
    intent,
    description: "Test-only explicit semantic translation.",
    evidence: [{ source: "test-only protocol", verified: "2026-10-29" }],
    lowering: "to-codex",
    forms: {
      claude: { pattern: /source-intent:demo/gu },
      codex: { pattern: /target-intent:demo/gu, render: () => "target-intent:demo" },
    },
  });
  try {
    const root = await fixture({
      ...DIALECT_FIXTURE,
      ".skillset/skills/x/SKILL.md": DIALECT_FIXTURE[".skillset/skills/x/SKILL.md"]!.replace(SKILL_BODY, "source-intent:demo"),
    });
    await expect(buildSkillset(root)).rejects.toThrow(
      "generated output collision at .agents/skills/x/SKILL.md requires incompatible bytes"
    );
  } finally {
    transformEntries.delete(intent);
  }
});

test("unknown dialect values fail the build loudly", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: dialect-bad\nclaude: true\n",
    ".skillset/skills/x/SKILL.md": `---
name: x
description: Bad dialect.
dialect: codex
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    'declares unsupported dialect "codex"; only "claude" is supported'
  );
});

test("dialect: claude instructions preserve ambiguous references in every projection", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dialect-rules
claude: true
codex: true
`,
    ".skillset/rules/conventions.md": `---
dialect: claude
---

Keep CLAUDE.md current; agents live under .claude/agents.
`,
  });
  await buildSkillset(root);

  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("Keep CLAUDE.md current; agents live under .claude/agents.");
  expect(agents).not.toContain(".codex/agents");

  const rule = await readFile(join(root, ".claude/rules/conventions.md"), "utf8");
  expect(rule).toBe("Keep CLAUDE.md current; agents live under .claude/agents.\n");

  const workspaceLock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
    items: readonly { name: string; transforms?: readonly unknown[] }[];
  };
  expect(workspaceLock.items.find((item) => item.name === "AGENTS.md")?.transforms).toBeUndefined();

  const rulesLock = JSON.parse(
    await readFile(join(root, ".claude/rules/skillset.lock"), "utf8")
  ) as { items: readonly { transforms?: readonly unknown[] }[] };
  expect(rulesLock.items.every((item) => item.transforms === undefined)).toBe(true);
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-dialect-");
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
