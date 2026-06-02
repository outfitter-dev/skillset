import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import { buildSkillset, checkSkillset } from "../build";
import { importSource } from "../import";
import { lintSkillset } from "../lint";
import { loadBuildGraph } from "../resolver";

test("resolves target inheritance, booleans, objects, and false opt-out", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex:
  color: "#B06DFF"
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
codex:
  color: "#123456"
`,
    ".skillset/plugins/alpha/skills/inherit/SKILL.md": `
---
name: inherit
description: Inherits both targets.
---

Inherited.
`,
    ".skillset/plugins/alpha/skills/codex-off/SKILL.md": `
---
name: codex-off
description: Claude only.
codex: false
---

Claude only.
`,
    ".skillset/plugins/alpha/skills/claude-off/SKILL.md": `
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

test("build preserves plugin boundaries, strips source metadata, and writes locks", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  version: 1.0.0
  marketplace:
    name: test-market
claude: true
codex: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
  version: 2.0.0
  manifest:
    name: alpha-manifest
codex:
  color: "#B06DFF"
`,
    ".skillset/plugins/alpha/commands/.gitkeep": `
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
metadata:
  author: fixture
skillset:
  name: alpha-skill
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
    ".skillset/plugins/beta/config.yaml": `
skillset:
  name: beta
  description: Beta plugin.
  version: 3.0.0
claude: false
codex: true
`,
    ".skillset/plugins/beta/skills/beta-skill/SKILL.md": `
---
name: beta-skill
description: Beta skill.
---

Beta body.
`,
  });

  await buildSkillset(root);

  expect(await exists(join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/beta/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/beta/.claude-plugin/plugin.json"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/config.yaml"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/.skillset.lock"))).toBe(true);

  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/alpha-skill/SKILL.md"),
    "utf8"
  );
  const claudeManifest = await readFile(
    join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"),
    "utf8"
  );
  const marketplace = await readFile(
    join(root, "plugins-claude/.claude-plugin/marketplace.json"),
    "utf8"
  );
  const lock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");

  expect(marketplace).toContain(`"name": "test-market"`);
  expect(claudeManifest).not.toContain("commands");
  expect(claudeManifest).toContain(`"name": "alpha-manifest"`);
  expect(codexSkill).not.toContain("skillset:");
  expect(codexSkill).not.toContain("codex:");
  expect(codexSkill).not.toContain("agents:");
  expect(codexSkill).toContain("description: Codex alpha description.");
  expect(codexSkill).toContain(`metadata:
  author: fixture
  generated: skillset@0.1.0
  version: 2.1.0`);
  expect(codexSkill).toContain("Alpha body.");
  expect(lock).toContain(`"sourceHash": "sha256:`);
  expect(lock).toContain(`"outputHash": "sha256:`);
  expect(lock).toContain(`"outputPath": "plugins/alpha/skills/alpha-skill/SKILL.md"`);

  const betaSkill = await readFile(
    join(root, "plugins-codex/plugins/beta/skills/beta-skill/SKILL.md"),
    "utf8"
  );
  expect(betaSkill).toContain(`metadata:
  generated: skillset@0.1.0
  version: 3.0.0`);
});

test("standalone skills emit without plugin manifests", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  outputs:
    skills:
      claude: skills-claude
      codex: skills-agents
claude: true
codex: true
`,
    ".skillset/skills/draft/SKILL.md": `
---
name: draft
description: Draft standalone skill.
skillset:
  name: draft
  version: 0.2.0
codex: false
---

Draft body.
`,
  });

  await buildSkillset(root);

  expect(await exists(join(root, "skills-claude/draft/SKILL.md"))).toBe(true);
  expect(await exists(join(root, "skills-claude/.skillset.lock"))).toBe(true);
  expect(await exists(join(root, "skills-agents/draft/SKILL.md"))).toBe(false);
  expect(await exists(join(root, "plugins-claude/.claude-plugin/marketplace.json"))).toBe(false);

  const skill = await readFile(join(root, "skills-claude/draft/SKILL.md"), "utf8");
  expect(skill).not.toContain("skillset:");
  expect(skill).toContain(`metadata:
  generated: skillset@0.1.0
  version: 0.2.0`);
});

test("check mode catches stale generated output", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await buildSkillset(root);
  await writeFile(join(root, "plugins-codex/plugins/alpha/stale.txt"), "stale\n");

  await expect(checkSkillset(root)).rejects.toThrow("stale generated file");
});

test("output roots cannot overlap source or each other", async () => {
  const sourceOverlapRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  outputs:
    plugins:
      claude: .skillset/generated
claude: true
codex: false
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(sourceOverlapRoot)).rejects.toThrow("must not point inside source root");
  expect(await exists(join(sourceOverlapRoot, ".skillset/plugins/alpha/config.yaml"))).toBe(true);

  const duplicateRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  outputs:
    plugins:
      claude: generated-plugins
      codex: ./generated-plugins
claude: true
codex: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(duplicateRoot)).rejects.toThrow("reuses output root");
});

test("targets key is rejected in config and frontmatter", async () => {
  const configRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
targets:
  codex: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(configRoot)).rejects.toThrow("unsupported targets key");

  const frontmatterRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
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
    ".skillset/config.yaml": `
skillset:
  name: test-root
surprise: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported top-level key");
});

test("skillset.id remains a compatibility alias but conflicts are rejected", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  id: test-root
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  id: alpha
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
skillset:
  id: alpha-skill
---

Alpha body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.plugins[0]?.id).toBe("alpha");

  const conflictRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
  id: other
`,
  });

  await expect(loadBuildGraph(conflictRoot)).rejects.toThrow("conflicting skillset.name and skillset.id");
});

test("lint rejects Claude dynamic context in Codex-enabled skills", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/dynamic/SKILL.md": `
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
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/dynamic/SKILL.md": `
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

test("imports existing standalone skills into source layout", async () => {
  const root = await fixture({
    "external/SKILL.md": `
---
name: imported-skill
description: Existing skill.
---

Imported body.
`,
  });

  const result = await importSource({
    kind: "skill",
    rootPath: root,
    sourcePath: join(root, "external"),
  });

  expect(result.name).toBe("imported-skill");
  expect(await exists(join(root, ".skillset/skills/imported-skill/SKILL.md"))).toBe(true);
});

test("imports existing plugins into source layout", async () => {
  const root = await fixture({
    "external-plugin/skillset.yaml": `
skillset:
  name: imported-plugin
  version: 0.4.0
`,
    "external-plugin/skills/imported-skill/SKILL.md": `
---
name: imported-skill
description: Existing plugin skill.
---

Plugin skill body.
`,
  });

  const result = await importSource({
    kind: "plugin",
    rootPath: root,
    sourcePath: join(root, "external-plugin"),
  });

  expect(result.name).toBe("imported-plugin");
  expect(await exists(join(root, ".skillset/plugins/imported-plugin/config.yaml"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/imported-plugin/skillset.yaml"))).toBe(false);
  expect(await exists(join(root, ".skillset/plugins/imported-plugin/skills/imported-skill/SKILL.md"))).toBe(true);
});

test("import command copies existing skills into source layout", async () => {
  const root = await fixture({
    "external/SKILL.md": `
---
name: cli-imported
description: Existing skill.
---

Imported body.
`,
  });

  const proc = Bun.spawn(
    ["bun", join(import.meta.dir, "../cli.ts"), "import", "skill", join(root, "external"), "--root", root],
    { stderr: "pipe", stdout: "pipe" }
  );
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(await exists(join(root, ".skillset/skills/cli-imported/SKILL.md"))).toBe(true);
});

test("import refuses to overwrite existing source", async () => {
  const root = await fixture({
    ".skillset/skills/imported-skill/SKILL.md": `
---
name: imported-skill
description: Existing source skill.
---

Existing body.
`,
    "external/SKILL.md": `
---
name: imported-skill
description: External skill.
---

External body.
`,
  });

  await expect(
    importSource({
      kind: "skill",
      rootPath: root,
      sourcePath: join(root, "external"),
    })
  ).rejects.toThrow("import target already exists");
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
