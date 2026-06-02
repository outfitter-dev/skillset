import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import { buildSkillset, checkSkillset } from "../build";
import { lintSkillset } from "../lint";
import { loadBuildGraph } from "../resolver";

test("resolves target inheritance, booleans, objects, and false opt-out", async () => {
  const root = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
claude: true
codex:
  color: "#B06DFF"
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
codex:
  color: "#123456"
`,
    "src/alpha/skills/inherit/SKILL.md": `
---
name: inherit
description: Inherits both targets.
---

Inherited.
`,
    "src/alpha/skills/codex-off/SKILL.md": `
---
name: codex-off
description: Claude only.
codex: false
---

Claude only.
`,
    "src/alpha/skills/claude-off/SKILL.md": `
---
name: claude-off
description: Codex only.
claude:
  enabled: false
codex:
  frontmatter:
    description: Codex override.
---

Codex only.
`,
  });

  const graph = await loadBuildGraph(root);
  const plugin = graph.plugins[0];
  expect(plugin?.targets.codex.enabled).toBe(true);
  expect(plugin?.targets.codex.options.color).toBe("#123456");

  const inherit = plugin?.skills.find((skill) => skill.id === "inherit");
  const codexOff = plugin?.skills.find((skill) => skill.id === "codex-off");
  const claudeOff = plugin?.skills.find((skill) => skill.id === "claude-off");

  expect(inherit?.targets.claude.enabled).toBe(true);
  expect(inherit?.targets.codex.enabled).toBe(true);
  expect(codexOff?.targets.claude.enabled).toBe(true);
  expect(codexOff?.targets.codex.enabled).toBe(false);
  expect(claudeOff?.targets.claude.enabled).toBe(false);
  expect(claudeOff?.targets.codex.enabled).toBe(true);
  expect(claudeOff?.targets.codex.options.frontmatter).toEqual({
    description: "Codex override.",
  });
});

test("build preserves plugin boundaries and strips source-only metadata", async () => {
  const root = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
claude: true
codex: true
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
  description: Alpha plugin.
  version: 2.0.0
codex:
  color: "#B06DFF"
`,
    "src/alpha/commands/.gitkeep": `
`,
    "src/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
metadata:
  author: fixture
skillset:
  id: alpha-skill
  title: Alpha Skill
  description: Portable alpha description.
  version: 2.1.0
codex:
  frontmatter:
    description: Codex alpha description.
agents: true
---

Alpha body.
`,
    "src/beta/skillset.yaml": `
skillset:
  id: beta
  description: Beta plugin.
  version: 3.0.0
claude: false
codex: true
`,
    "src/beta/skills/beta-skill/SKILL.md": `
---
name: beta-skill
description: Beta skill.
---

Beta body.
`,
  });

  await buildSkillset(root);

  expect(await exists(join(root, "dist/claude/plugins/alpha/.claude-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "dist/codex/plugins/alpha/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "dist/codex/plugins/beta/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "dist/claude/plugins/beta/.claude-plugin/plugin.json"))).toBe(false);
  expect(await exists(join(root, "dist/codex/plugins/alpha/skillset.yaml"))).toBe(false);

  const codexSkill = await readFile(
    join(root, "dist/codex/plugins/alpha/skills/alpha-skill/SKILL.md"),
    "utf8"
  );
  const claudeManifest = await readFile(
    join(root, "dist/claude/plugins/alpha/.claude-plugin/plugin.json"),
    "utf8"
  );

  expect(claudeManifest).not.toContain("commands");
  expect(codexSkill).not.toContain("skillset:");
  expect(codexSkill).not.toContain("codex:");
  expect(codexSkill).not.toContain("agents:");
  expect(codexSkill).toContain("description: Codex alpha description.");
  expect(codexSkill).toContain(`metadata:
  author: fixture
  version: 2.1.0`);
  expect(codexSkill).toContain("Alpha body.");

  const betaSkill = await readFile(
    join(root, "dist/codex/plugins/beta/skills/beta-skill/SKILL.md"),
    "utf8"
  );
  expect(betaSkill).toContain(`metadata:
  version: 3.0.0`);
});

test("check mode catches stale generated output", async () => {
  const root = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
claude: true
codex: true
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
  description: Alpha plugin.
`,
    "src/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await buildSkillset(root);
  await writeFile(join(root, "dist/codex/plugins/alpha/stale.txt"), "stale\n");

  await expect(checkSkillset(root)).rejects.toThrow("stale generated file");
});

test("targets key is rejected in config and frontmatter", async () => {
  const configRoot = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
targets:
  codex: true
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
`,
  });

  await expect(loadBuildGraph(configRoot)).rejects.toThrow("unsupported targets key");

  const frontmatterRoot = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
`,
    "src/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
targets:
  codex: true
---

Bad.
`,
  });

  await expect(loadBuildGraph(frontmatterRoot)).rejects.toThrow("unsupported targets key");
});

test("unknown top-level skillset config keys are rejected", async () => {
  const root = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
surprise: true
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported top-level key");
});

test("lint rejects Claude dynamic context in Codex-enabled skills", async () => {
  const root = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
claude: true
codex: true
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
`,
    "src/alpha/skills/dynamic/SKILL.md": `
---
name: dynamic
description: Uses Claude arguments.
---

Use $ARGUMENTS and ${"${CLAUDE_SKILL_DIR}"} to prepare context.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("codex-claude-dynamic-context");
});

test("lint allows Claude dynamic context when Codex is disabled", async () => {
  const root = await fixture({
    "src/skillset.yaml": `
skillset:
  id: test-root
claude: true
codex: true
`,
    "src/alpha/skillset.yaml": `
skillset:
  id: alpha
`,
    "src/alpha/skills/dynamic/SKILL.md": `
---
name: dynamic
description: Uses Claude arguments.
codex: false
---

Use $1 with !\`pwd\` before rendering Claude context.
`,
  });

  const result = await lintSkillset(root);
  expect(result.checkedSkills).toBe(1);
  expect(result.issues).toEqual([]);
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-test-"));

  for (const [path, content] of Object.entries(files)) {
    const outputPath = join(root, path);
    await Bun.write(outputPath, normalizeFixture(content));
  }

  return root;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

function normalizeFixture(content: string): string {
  return `${content.trimStart().trimEnd()}\n`;
}
