import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import { explainPath, listGeneratedEntries } from "../authoring";
import { buildSkillset, buildSkillsetResult, checkSkillset, diffSkillset } from "../build";
import { importSource } from "../import";
import { inspectSkillset, lintSkillset } from "../lint";
import { loadBuildGraph } from "../resolver";
import { renderValidatedToml } from "../structured-output";

test("resolves target inheritance, booleans, objects, and false opt-out", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex:
  color: "#B06DFF"
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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

test("root compile targets narrow providers while lower-level toggles can opt back in", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  targets:
    - codex
claude:
  skills:
    path: skills-claude
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/inherit/SKILL.md": `
---
name: inherit
description: Inherits root targets.
---

Inherited.
`,
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
claude: true
`,
    ".skillset/plugins/beta/skills/opt-in/SKILL.md": `
---
name: opt-in
description: Opts Claude back in.
---

Opt in.
`,
  });

  const graph = await loadBuildGraph(root);
  const alpha = graph.plugins.find((plugin) => plugin.id === "alpha");
  const beta = graph.plugins.find((plugin) => plugin.id === "beta");

  expect(graph.root.targets.claude.enabled).toBe(false);
  expect(graph.root.targets.codex.enabled).toBe(true);
  expect(graph.root.compile.targets).toEqual(["codex"]);
  expect(alpha?.targets.claude.enabled).toBe(false);
  expect(alpha?.targets.codex.enabled).toBe(true);
  expect(alpha?.skills[0]?.targets.claude.enabled).toBe(false);
  expect(alpha?.skills[0]?.targets.codex.enabled).toBe(true);
  expect(beta?.targets.claude.enabled).toBe(true);
  expect(beta?.targets.codex.enabled).toBe(true);

  await buildSkillset(root);

  expect(await exists(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"))).toBe(false);
  expect(await exists(join(root, "plugins-claude/plugins/beta/.claude-plugin/plugin.json"))).toBe(true);
});

test("target adapter config and defaults normalize through provider blocks", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  build: all
  skillset:
    metadata: false
defaults:
  codex:
    plugins:
      frontmatter:
        plugin-only: root-plugin-default
    skills:
      frontmatter:
        custom-default: shorthand
      model: gpt-5
claude:
  projectRoot: .claude
  userRoot: ~/.claude
  defaults:
    skills:
      frontmatter:
        claude-default: canonical
      model: sonnet
codex:
  projectRoot: .codex
  userRoot: ~/.codex
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
codex:
  defaults:
    plugins:
      frontmatter:
        plugin-only: plugin-default
    skills:
      frontmatter:
        custom-default: plugin
        plugin-default: yes
`,
    ".skillset/plugins/alpha/skills/defaulted/SKILL.md": `
---
name: defaulted
description: Uses defaults.
codex:
  frontmatter:
    custom-default: file
    file-default: yes
---

Defaulted.
`,
  });

  const graph = await loadBuildGraph(root);
  const plugin = graph.plugins[0];
  const skill = plugin?.skills[0];

  expect(graph.root.compile).toMatchObject({
    build: "all",
    skillset: { metadata: false },
    targets: ["claude", "codex"],
    unsupported: "error",
  });
  expect(graph.root.targets.claude.options.projectRoot).toBe(".claude");
  expect(graph.root.targets.claude.options.userRoot).toBe("~/.claude");
  expect(graph.root.targets.codex.options.projectRoot).toBe(".codex");
  expect(graph.root.targets.codex.options.userRoot).toBe("~/.codex");
  expect(plugin?.targets.codex.options.frontmatter).toEqual({
    "plugin-only": "plugin-default",
  });
  expect(skill?.targets.claude.options.model).toBe("sonnet");
  expect(skill?.targets.codex.options.model).toBe("gpt-5");
  expect(skill?.targets.codex.options.frontmatter).toEqual({
    "custom-default": "file",
    "file-default": "yes",
    "plugin-default": "yes",
  });
  expect(skill?.targets.codex.options.frontmatter).not.toHaveProperty("plugin-only");
  expect(skill?.targets.claude.options.frontmatter).toEqual({
    "claude-default": "canonical",
  });
});

test("compile build mode rejects invalid values", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  build: partial
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("expected one of: updated, all");
});

test("target defaults reject file frontmatter and unknown surfaces", async () => {
  const fileDefaultsRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
defaults:
  codex:
    skills:
      model: gpt-5
---

Bad.
`,
  });

  await expect(loadBuildGraph(fileDefaultsRoot)).rejects.toThrow(
    "uses unsupported defaults key"
  );

  const fileTargetDefaultsRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
codex:
  defaults:
    skills:
      model: gpt-5
---

Bad.
`,
  });

  await expect(loadBuildGraph(fileTargetDefaultsRoot)).rejects.toThrow(
    ".codex.defaults is only supported in root or plugin config"
  );

  const shorthandSurfaceRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
defaults:
  codex:
    skill:
      model: gpt-5
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(shorthandSurfaceRoot)).rejects.toThrow(
    "unsupported defaults surface \"skill\""
  );

  const providerSurfaceRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  defaults:
    skill:
      model: sonnet
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(providerSurfaceRoot)).rejects.toThrow(
    "unsupported defaults surface \"skill\""
  );
});

test("compile skillset metadata suppression omits generated skill metadata and records lock provenance", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  targets: [codex]
  build: all
  skillset:
    metadata: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/plain/SKILL.md": `
---
name: plain
description: Plain skill.
---

Plain.
`,
  });

  await buildSkillset(root);

  const skill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/plain/SKILL.md"),
    "utf8"
  );
  expect(skill).not.toContain("generated: skillset");
  expect(skill).not.toContain("version:");

  const lock = JSON.parse(await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8"));
  expect(lock.buildMode).toBe("all");
  expect(lock.selectedTargets).toEqual(["codex"]);
  expect(lock.skillsetMetadata).toBe(false);
});

test("metadata suppression still leaves version-only changes visible through check", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  skillset:
    metadata: false
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/plain/SKILL.md": `
---
name: plain
description: Plain skill.
version: 1.0.0
---

Plain.
`,
  });

  await buildSkillset(root);
  await writeFile(
    join(root, ".skillset/plugins/alpha/skills/plain/SKILL.md"),
    normalizeFixture(`
---
name: plain
description: Plain skill.
version: 1.1.0
---

Plain.
`)
  );

  await expect(checkSkillset(root)).rejects.toThrow("stale generated file");
});

test("top-level model warns unless active target defaults or overrides handle it", async () => {
  const warnsRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/modelish/SKILL.md": `
---
name: modelish
description: Has a portable-looking model.
model: gpt-5
---

Modelish.
`,
  });

  const warnsGraph = await loadBuildGraph(warnsRoot);
  expect(warnsGraph.warnings).toContain(
    ".skillset/plugins/alpha/skills/modelish/SKILL.md uses top-level model, which is not portable in Skillset v1; use claude.model, codex.model, or target defaults for claude, codex."
  );

  const handledRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  defaults:
    skills:
      model: sonnet
codex:
  defaults:
    skills:
      model: gpt-5
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/modelish/SKILL.md": `
---
name: modelish
description: Has handled target models.
model: portable-ish
---

Modelish.
`,
  });

  const handledGraph = await loadBuildGraph(handledRoot);
  expect(handledGraph.warnings).toEqual([]);
});

test("build preserves plugin boundaries, strips source metadata, and writes locks", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  version: 1.0.0
  marketplace:
    name: test-market
claude:
  plugins: true
  skills: true
codex:
  plugins: true
  skills: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
  summary: Alpha tools.
  version: 2.0.0
  presentation:
    color: "#B06DFF"
codex:
  color: "#B06DFF"
`,
    ".skillset/plugins/alpha/commands/.gitkeep": `
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
title: Alpha Skill
summary: Portable alpha summary.
description: Alpha skill.
version: 2.1.0
metadata:
  author: fixture
skillset:
  schema: 1
codex:
  frontmatter:
    description: Codex alpha description.
agents: true
---

Alpha body.
`,
    ".skillset/plugins/beta/skillset.yaml": `
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
  expect(await exists(join(root, "plugins-codex/plugins/alpha/skillset.yaml"))).toBe(false);
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
  expect(claudeManifest).toContain(`"name": "alpha"`);
  expect(codexSkill).not.toContain("skillset:");
  expect(codexSkill).not.toContain("codex:");
  expect(codexSkill).not.toContain("agents:");
  expect(codexSkill).not.toContain("summary:");
  expect(codexSkill).not.toContain("title: Alpha Skill");
  expect(codexSkill).toContain("description: Codex alpha description.");
  expect(codexSkill).toContain(`metadata:
  author: fixture
  generated: skillset@0.1.0
  version: 2.1.0`);
  expect(codexSkill).toContain("Alpha body.");
  expect(lock).toContain(`"sourceHash": "sha256:`);
  expect(lock).toContain(`"outputHash": "sha256:`);
  expect(lock).toContain(`"kind": "plugin"`);
  expect(lock).toContain(`"targetState": "sync"`);
  expect(lock).toContain(`"includedSkills": [`);
  expect(lock).toContain(`"alpha-skill@2.1.0"`);
  expect(lock).toContain(`"outputPath": "plugins/alpha/skills/alpha-skill/SKILL.md"`);

  const betaSkill = await readFile(
    join(root, "plugins-codex/plugins/beta/skills/beta-skill/SKILL.md"),
    "utf8"
  );
  expect(betaSkill).toContain(`metadata:
  generated: skillset@0.1.0
  version: 3.0.0`);
});

test("plugin manifests keep agent and hook surfaces target-specific", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  marketplace:
    name: test-market
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
`,
    ".skillset/plugins/alpha/hooks/hooks.json": `
{
  "hooks": {
    "SessionStart": []
  }
}
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
  description: Beta plugin.
codex: false
`,
    ".skillset/plugins/beta/agents/reviewer.md": `
# Reviewer

Review carefully.
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

  const marketplace = await readFile(join(root, "plugins-claude/.claude-plugin/marketplace.json"), "utf8");
  const claudeManifest = await readFile(
    join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"),
    "utf8"
  );
  const codexManifest = await readFile(
    join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"),
    "utf8"
  );

  expect(marketplace).toContain(`"source": "./plugins/alpha"`);
  expect(marketplace).toContain(`"source": "./plugins/beta"`);
  expect(claudeManifest).toContain(`"hooks": "./hooks/hooks.json"`);
  expect(codexManifest).not.toContain(`"agents"`);
  expect(codexManifest).toContain(`"hooks": "./hooks/hooks.json"`);
  const betaClaudeManifest = await readFile(
    join(root, "plugins-claude/plugins/beta/.claude-plugin/plugin.json"),
    "utf8"
  );
  expect(betaClaudeManifest).toContain(`"agents": "./agents"`);
  expect(await exists(join(root, "plugins-claude/plugins/beta/agents/reviewer.md"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/agents/reviewer.md"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/beta/agents/reviewer.md"))).toBe(false);
  // SET-2: Codex hooks emit at the documented hooks/hooks.json path.
  expect(await exists(join(root, "plugins-codex/plugins/alpha/hooks.json"))).toBe(false);
  const codexHook = await readFile(join(root, "plugins-codex/plugins/alpha/hooks/hooks.json"), "utf8");
  expect(codexHook).toContain(`"hooks"`);
  expect(codexHook).toContain("SessionStart");
});

test("portable project agents lower to Claude Markdown and Codex TOML with provenance", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
defaults:
  codex:
    agents:
      skillsPrefaceTemplate: "Required skills:\\n{{skills}}"
claude: true
codex: true
`,
    ".skillset/shared/templates/body.md": `
Use the shared review checklist.
`,
    ".skillset/shared/templates/prompt.md": `
smallest complete review
`,
    ".skillset/src/agents/reviewer.md": `
---
name: Code Reviewer
description: Reviews project changes.
skills:
  - skillset-codex-development
initialPrompt: "Start with the {{> shared:templates/prompt.md }}"
codex:
  model: gpt-5-codex
  description: Reviews changes through Codex.
claude:
  color: blue
---

Review diffs and call out correctness risks.
{{> shared:templates/body.md }}
`,
  });

  await buildSkillset(root);

  const claudeAgent = await readFile(join(root, ".claude/agents/code-reviewer.md"), "utf8");
  expect(claudeAgent).toContain(`name: Code Reviewer`);
  expect(claudeAgent).toContain(`description: Reviews project changes.`);
  expect(claudeAgent).toContain(`color: blue`);
  expect(claudeAgent).toContain(`generated: skillset@0.1.0`);
  expect(claudeAgent).toContain("Review diffs and call out correctness risks.");
  expect(claudeAgent).toContain("Use the shared review checklist.");

  const codexAgent = await readFile(join(root, ".codex/agents/code-reviewer.toml"), "utf8");
  expect(codexAgent).toContain(`name = "Code Reviewer"`);
  expect(codexAgent).toContain(`description = "Reviews changes through Codex."`);
  expect(codexAgent).toContain(`model = "gpt-5-codex"`);
  expect(codexAgent).toContain(`developer_instructions = `);
  expect(codexAgent).toContain("Required skills:");
  expect(codexAgent).toContain("- skillset-codex-development");
  expect(codexAgent).toContain("Review diffs and call out correctness risks.");
  expect(codexAgent).toContain("Use the shared review checklist.");
  expect(codexAgent).toContain("<initial_prompt>");
  expect(codexAgent).toContain("Start with the smallest complete review");
  expect(codexAgent).toContain("[metadata.skillset]");
  expect(codexAgent.indexOf("Required skills:")).toBeLessThan(codexAgent.indexOf("Review diffs"));
  expect(codexAgent.indexOf("Review diffs")).toBeLessThan(codexAgent.indexOf("<initial_prompt>"));

  const lock = await readFile(join(root, ".skillset.lock"), "utf8");
  expect(lock).toContain(`"kind": "project-agent"`);
  expect(lock).toContain(`"sourcePath": ".skillset/src/agents/reviewer.md"`);
  expect(lock).toContain(`"outputPath": ".claude/agents/code-reviewer.md"`);
  expect(lock).toContain(`".codex/agents/code-reviewer.toml"`);

  const explained = await explainPath(root, ".skillset/src/agents/reviewer.md");
  expect(explained.kind).toBe("source-project-agent");
  expect(explained.entries[0]?.kind).toBe("project-agent");
  expect(explained.entries[0]?.validation).toBe("structured");
  for (const entry of explained.entries) {
    expect(entry.preprocessDependencies).toContain(".skillset/shared/templates/body.md");
  }
  expect(explained.notes[0]).toContain("Project-scoped portable agent");

  const explainedCodexOutput = await explainPath(root, ".codex/agents/code-reviewer.toml");
  expect(explainedCodexOutput.kind).toBe("generated");
  expect(explainedCodexOutput.entries[0]?.kind).toBe("project-agent");
  expect(explainedCodexOutput.entries[0]?.outputPath).toBe(".codex/agents/code-reviewer.toml");
  expect(explainedCodexOutput.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/prompt.md");

  const entries = await listGeneratedEntries(root);
  expect(entries.some((entry) => entry.kind === "project-agent" && entry.outputPath === ".claude/agents/code-reviewer.md")).toBe(true);
  expect(entries.some((entry) => entry.kind === "project-agent" && entry.outputPath === ".codex/agents/code-reviewer.toml")).toBe(true);
});

test("portable project agents support metadata suppression, warnings, and validation", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  skillset:
    metadata: false
claude: true
codex: true
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Reviews project changes.
model: opus
codex:
  developer_instructions: Use Codex-specific review steps.
---

Review diffs.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.warnings).toContain(
    ".skillset/src/agents/reviewer.md uses top-level model, which is not portable in Skillset v1; use claude.model, codex.model, or target defaults for claude, codex."
  );

  await buildSkillset(root);
  const claudeAgent = await readFile(join(root, ".claude/agents/reviewer.md"), "utf8");
  const codexAgent = await readFile(join(root, ".codex/agents/reviewer.toml"), "utf8");
  expect(claudeAgent).not.toContain("metadata:");
  expect(codexAgent).not.toContain("[metadata.skillset]");
  expect(codexAgent).toContain("Use Codex-specific review steps.");

  const closingTagRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
  userRoot: ~/.claude
codex:
  projectRoot: project-codex
  userRoot: ~/.codex
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Invalid prompt.
initialPrompt: "</initial_prompt>"
---

Review.
`,
  });
  await expect(loadBuildGraph(closingTagRoot)).rejects.toThrow("initialPrompt must not contain </initial_prompt>");

  const preprocessedClosingTagRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
  userRoot: ~/.claude
codex:
  projectRoot: project-codex
  userRoot: ~/.codex
`,
    ".skillset/shared/bad-prompt.md": `
</initial_prompt>
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Invalid rendered prompt.
initialPrompt: "{{> shared:bad-prompt.md }}"
---

Review.
`,
  });
  await expect(buildSkillset(preprocessedClosingTagRoot)).rejects.toThrow("initialPrompt must not contain </initial_prompt>");

  const collisionRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/src/agents/reviewer.md": `
---
name: Reviewer
description: Reviews.
---

Review.
`,
    ".skillset/src/agents/reviewer-copy.md": `
---
name: Reviewer!
description: Reviews too.
---

Review too.
`,
  });
  await expect(loadBuildGraph(collisionRoot)).rejects.toThrow("both generate claude agent reviewer");

  const targetNameCollisionRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/src/agents/reviewer.md": `
---
name: Reviewer
description: Reviews.
---

Review.
`,
    ".skillset/src/agents/auditor.md": `
---
name: Auditor
description: Audits.
claude:
  name: Reviewer
---

Audit.
`,
  });
  await expect(loadBuildGraph(targetNameCollisionRoot)).rejects.toThrow("both generate claude agent named Reviewer");
});

test("portable project agents preserve unmanaged target project files", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
  userRoot: ~/.claude
codex:
  projectRoot: project-codex
  userRoot: ~/.codex
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Reviews project changes.
---

Review diffs.
`,
    "project-claude/settings.json": `
{"theme":"dark"}
`,
    "project-codex/config.toml": `
model = "gpt-5"
`,
  });

  await buildSkillset(root);

  expect(await readFile(join(root, "project-claude/settings.json"), "utf8")).toContain(`"theme":"dark"`);
  expect(await readFile(join(root, "project-codex/config.toml"), "utf8")).toContain(`model = "gpt-5"`);

  const claudeAgent = await readFile(join(root, "project-claude/agents/reviewer.md"), "utf8");
  const codexAgent = await readFile(join(root, "project-codex/agents/reviewer.toml"), "utf8");
  expect(claudeAgent).not.toContain("projectRoot");
  expect(claudeAgent).not.toContain("userRoot");
  expect(codexAgent).not.toContain("projectRoot");
  expect(codexAgent).not.toContain("userRoot");
  expect(codexAgent).not.toContain("project-root");
  expect(codexAgent).not.toContain("user-root");
});

test("portable project agents reject active output roots inside project roots", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .claude
  skills:
    path: .claude/agents
codex: false
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Reviews project changes.
---

Review diffs.
`,
    ".skillset/skills/helper/SKILL.md": `
---
description: Helps with project changes.
---

Help.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    ".skillset/src/agents/reviewer.md would write inside active output root outputs.skills.claude (.claude/agents)"
  );
});

test("Codex plugin agent diagnostics honor root plugin output selection", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex:
  plugins:
    - beta
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/agents/reviewer.md": `
# Reviewer

Review carefully.
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
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

  expect(await exists(join(root, "plugins-claude/plugins/alpha/agents/reviewer.md"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/alpha"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/beta/skills/beta-skill/SKILL.md"))).toBe(true);
});

test("Codex-enabled plugin agents fail loudly instead of promoting to project agents", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/agents/reviewer.md": `
# Reviewer

Review carefully.
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("codex plugin-agents unsupported");
  await expect(buildSkillset(root)).rejects.toThrow("Codex plugin documentation does not include a plugin agents component.");
});

test("build copies declared shared resources into generated skill folders", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/shared/references/root.md": `
# Root Reference
`,
    ".skillset/shared/templates/base.md": `
# Base Template
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/scripts/plugin-tool.sh": `
#!/usr/bin/env bash
echo plugin-root
`,
    ".skillset/plugins/alpha/shared/references/plugin.md": `
# Plugin Reference
`,
    ".skillset/plugins/alpha/shared/scripts/check.sh": `
#!/usr/bin/env bash
echo shared
`,
    ".skillset/plugins/alpha/skills/resourceful/SKILL.md": `
---
name: resourceful
description: Uses shared resources.
version: 1.0.0
resources:
  references:
    - from: shared:references/root.md
      to: references/root.md
    - plugin:references/plugin.md
  scripts:
    - plugin:scripts/check.sh
  templates:
    - shared:templates/base.md
---

Read [root](shared:references/root.md) and [plugin](plugin:references/plugin.md#usage).
Run scripts/check.sh when deterministic checks help.
`,
  });

  await buildSkillset(root);

  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/resourceful/SKILL.md"),
    "utf8"
  );
  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/resourceful/SKILL.md"),
    "utf8"
  );
  const lock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");

  expect(claudeSkill).not.toContain("resources:");
  expect(codexSkill).not.toContain("shared:");
  expect(codexSkill).not.toContain("plugin:");
  expect(codexSkill).toContain("[root](references/root.md)");
  expect(codexSkill).toContain("[plugin](references/plugin.md#usage)");
  expect(
    await readFile(
      join(root, "plugins-claude/plugins/alpha/skills/resourceful/references/root.md"),
      "utf8"
    )
  ).toContain("Root Reference");
  expect(
    await readFile(
      join(root, "plugins-codex/plugins/alpha/skills/resourceful/references/plugin.md"),
      "utf8"
    )
  ).toContain("Plugin Reference");
  expect(
    await readFile(
      join(root, "plugins-codex/plugins/alpha/skills/resourceful/scripts/check.sh"),
      "utf8"
    )
  ).toContain("echo shared");
  expect(
    await readFile(
      join(root, "plugins-claude/plugins/alpha/skills/resourceful/templates/base.md"),
      "utf8"
    )
  ).toContain("Base Template");
  expect(
    await exists(join(root, "plugins-claude/plugins/alpha/scripts/plugin-tool.sh"))
  ).toBe(true);
  expect(
    await exists(join(root, "plugins-codex/plugins/alpha/scripts/plugin-tool.sh"))
  ).toBe(true);
  expect(lock).toContain(`"plugins/alpha/skills/resourceful/references/root.md"`);
  expect(lock).toContain(`"plugins/alpha/skills/resourceful/scripts/check.sh"`);

  await writeFile(
    join(root, ".skillset/plugins/alpha/shared/references/plugin.md"),
    "# Changed Plugin Reference\n"
  );
  await expect(checkSkillset(root)).rejects.toThrow("stale generated file");
});

test("preprocessing expands this references and partials in skill markdown and Codex YAML", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/shared/templates/intro.md": `
Shared intro for {{this.description}}.
`,
    ".skillset/shared/templates/openai.md": `
YAML prompt for {{this.description}} with "quotes".
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/preprocessed/agents/openai.yaml": `
notes: "{{this.description}}"
prompt: |
  {{> shared:templates/openai.md}}
`,
    ".skillset/plugins/alpha/skills/preprocessed/SKILL.md": `
---
name: preprocessed
description: Preprocessed skill.
implicit_invocation: true
---

# {{this.description}}

{{> shared:templates/intro.md}}
`,
  });

  await buildSkillset(root);

  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/preprocessed/SKILL.md"),
    "utf8"
  );
  const codexAgent = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/preprocessed/agents/openai.yaml"),
    "utf8"
  );

  expect(claudeSkill).toContain("# Preprocessed skill.");
  expect(claudeSkill).toContain("Shared intro for Preprocessed skill.");
  expect(codexAgent).toContain("notes: Preprocessed skill.");
  expect(codexAgent).toContain("YAML prompt for Preprocessed skill. with \"quotes\".");
});

test("preprocessing opt-out preserves literal variables while stripping source controls", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/literal/SKILL.md": `
---
name: literal
description: Literal skill.
skillset:
  preprocess: false
---

Keep {{this.description}} literal.
`,
  });

  await buildSkillset(root);

  const skill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/literal/SKILL.md"),
    "utf8"
  );
  expect(skill).toContain("Keep {{this.description}} literal.");
  expect(skill).not.toContain("preprocess:");
});

test("preprocessing fails loudly on missing this references", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

Missing {{this.missing}}.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("missing this.missing reference");
});

test("preprocessing rejects partial traversal and plugin partials outside plugins", async () => {
  const sharedTraversal = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/secret.md": `
secret
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> shared:../secret.md}}
`,
  });
  await expect(buildSkillset(sharedTraversal)).rejects.toThrow(
    "must not contain empty, dot, or parent segments"
  );

  const pluginTraversal = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/secret.md": `
secret
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> plugin:../secret.md}}
`,
  });
  await expect(buildSkillset(pluginTraversal)).rejects.toThrow(
    "must not contain empty, dot, or parent segments"
  );

  const relativeTraversal = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/secret.md": `
secret
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> ../secret.md}}
`,
  });
  await expect(buildSkillset(relativeTraversal)).rejects.toThrow(
    "must not contain empty, dot, or parent segments"
  );

  const absolutePartial = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> /tmp/secret.md}}
`,
  });
  await expect(buildSkillset(absolutePartial)).rejects.toThrow("must be a relative path");

  const standalonePluginPartial = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> plugin:templates/standalone.md}}
`,
  });
  await expect(buildSkillset(standalonePluginPartial)).rejects.toThrow(
    "requires a plugin-bound source"
  );
});

test("preprocessing expands this references and partials in instruction markdown", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/shared/templates/rule.md": `
Rule partial for {{this.title}}.
`,
    ".skillset/instructions/docs/rule.md": `
---
title: Docs Rule
paths:
  - docs/**/*.md
---

Use {{this.title}} from {{skillset.source_rule}}.

{{> shared:templates/rule.md}}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(root);

  const claudeRule = await readFile(join(root, ".claude/rules/docs/rule.md"), "utf8");
  const codexAgents = await readFile(join(root, "docs/AGENTS.md"), "utf8");
  expect(claudeRule).toContain("Use Docs Rule from .skillset/instructions/docs/rule.md.");
  expect(claudeRule).toContain("Rule partial for Docs Rule.");
  expect(codexAgents).toContain("Use Docs Rule from .skillset/instructions/docs/rule.md.");
  expect(codexAgents).toContain("Rule partial for Docs Rule.");
});

test("TOML serializer preserves multiline prompts, quotes, braces, and code fences", () => {
  const toml = renderValidatedToml(
    {
      description: "Agent with \"quotes\" and {{ braces }}.",
      developer_instructions: "Line one.\n```ts\nconst value = \"quoted\";\n```\nLine two.",
      initialPrompt: ["First line\nsecond line", "Use {{this.description}} literally."],
      name: "safe-agent",
    },
    "test agent TOML"
  );

  const parsed = Bun.TOML.parse(toml) as Record<string, unknown>;
  expect(parsed.name).toBe("safe-agent");
  expect(parsed.description).toBe("Agent with \"quotes\" and {{ braces }}.");
  expect(String(parsed.developer_instructions)).toContain("```ts");
  expect(parsed.initialPrompt).toEqual([
    "First line\nsecond line",
    "Use {{this.description}} literally.",
  ]);
});

test("project target-native islands mirror to configured target roots", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
codex:
  projectRoot: project-codex
`,
    ".skillset/src/codex/rules/deny.rules": `
match = "rm -rf"
decision = "deny"
`,
    ".skillset/src/codex/config.json": `
{"note":"codex"}
`,
    ".skillset/src/claude/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Use {{this.description}}.
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(root);

  expect(await readFile(join(root, "project-codex/rules/deny.rules"), "utf8")).toContain(
    `decision = "deny"`
  );
  expect(await readFile(join(root, "project-codex/config.json"), "utf8")).toContain("codex");
  expect(await readFile(join(root, "project-claude/agents/reviewer.md"), "utf8")).toContain(
    "Use Reviews code."
  );
  expect(await exists(join(root, "project-codex/agents/reviewer.md"))).toBe(false);
  expect(await exists(join(root, "project-claude/rules/deny.rules"))).toBe(false);
  const codexLock = await readFile(join(root, ".skillset.lock"), "utf8");
  expect(codexLock).toContain(`"kind": "island"`);
  expect(codexLock).toContain(`"outputPath": "project-codex/rules/deny.rules"`);
});

test("target-native islands reject frontmatter target escapes", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/src/claude/agents/bad.md": `
---
codex: true
---

Bad.
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("remove target override frontmatter");
});

test("target-native islands copy binary files byte-for-byte", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });
  const bytes = new Uint8Array([0, 255, 10, 20, 30]);
  await Bun.write(join(root, ".skillset/src/claude/assets/image.bin"), bytes);

  await buildSkillset(root);

  const copied = new Uint8Array(await Bun.file(join(root, ".claude/assets/image.bin")).arrayBuffer());
  expect([...copied]).toEqual([...bytes]);
});

test("project target-native islands are workspace-managed files without claiming target roots", async () => {
  const root = await fixture({
    ".codex/config.toml": `
model = "local"
`,
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/codex/rules/deny.rules": `
match = "rm -rf"
decision = "deny"
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(root);

  expect(await readFile(join(root, ".codex/config.toml"), "utf8")).toContain(`model = "local"`);
  const workspaceLock = await readFile(join(root, ".skillset.lock"), "utf8");
  expect(workspaceLock).toContain(`"kind": "island"`);
  expect(workspaceLock).toContain(`"outputPath": ".codex/rules/deny.rules"`);
  expect(await exists(join(root, ".codex/.skillset.lock"))).toBe(false);
});

test("project target-native islands back up unmanaged destination collisions", async () => {
  const root = await fixture({
    ".codex/rules/deny.rules": `
match = "existing"
`,
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/codex/rules/deny.rules": `
match = "rm -rf"
decision = "deny"
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  const result = await buildSkillsetResult(root);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "unmanaged-output-collision",
    outputPath: ".codex/rules/deny.rules",
  }));
  expect(result.writes.backupRecords).toContainEqual(expect.objectContaining({
    action: "overwrite",
    reason: "unmanaged-collision",
    targetPath: ".codex/rules/deny.rules",
  }));
});

test("project target-native islands reject project roots inside source root", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .skillset/generated-claude
codex: false
`,
    ".skillset/src/claude/settings.json": `
{"note":"claude"}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("claude.projectRoot must not point inside source root .skillset");
});

test("project target-native islands reject project roots inside active output roots", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: plugins-claude/project
codex: false
`,
    ".skillset/src/claude/settings.json": `
{"note":"claude"}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    "claude.projectRoot must not overlap active output root outputs.plugins.claude (plugins-claude)"
  );
});

test("project target-native islands reject active output roots inside project roots", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .claude
  plugins:
    path: .claude/plugins
codex: false
`,
    ".skillset/src/claude/plugins/alpha/settings.json": `
{"note":"project island under plugin root"}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    ".skillset/src/claude/plugins/alpha/settings.json would write inside active output root outputs.plugins.claude (.claude/plugins)"
  );
});

test("plugin-local target-native islands mirror to matching plugin output only", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/claude/commands/review.md": `
# Claude command
`,
    ".skillset/src/plugins/alpha/codex/config.json": `
{"codex": true}
`,
  });

  await buildSkillset(root);

  expect(await exists(join(root, "plugins-claude/plugins/alpha/commands/review.md"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/commands/review.md"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/config.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/alpha/config.json"))).toBe(false);
});

test("plugin-local target-native islands reject unknown plugin owners", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alhpa/claude/commands/review.md": `
# Typo island
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    ".skillset/src/plugins/alhpa has target-native island source for unknown plugin alhpa"
  );
});

test("Codex plugin rules islands fail while portable src rules do not become Codex command policy", async () => {
  const portableRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/src/rules/portable.rules": `
allow all
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(portableRoot);
  expect(await exists(join(portableRoot, ".codex/rules/portable.rules"))).toBe(false);

  const pluginRulesRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/codex/rules/plugin.rules": `
deny all
`,
  });

  await expectFeatureDiagnosticError(buildSkillset(pluginRulesRoot), {
    code: "target-native-island-unsupported",
    featureId: "target-native-islands",
    message: expect.stringContaining("Codex plugin .rules"),
    path: ".skillset/src/plugins/alpha/codex/rules/plugin.rules",
  });
});

test("Codex project rules islands are only accepted under rules/", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/codex/agents/bad.rules": `
deny all
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expectFeatureDiagnosticError(buildSkillset(root), {
    code: "target-native-island-unsupported",
    featureId: "target-native-islands",
    message: expect.stringContaining("Codex .rules outside .skillset/src/codex/rules/"),
    path: ".skillset/src/codex/agents/bad.rules",
  });
});

test("target-native island locks include partial provenance and explain/list visibility", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/shared/templates/tail.md": `
Tail.
`,
    ".skillset/src/claude/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Use {{this.description}}.
{{> shared:templates/tail.md}}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(root);

  const explained = await explainPath(root, ".skillset/src/claude/agents/reviewer.md");
  expect(explained.kind).toBe("source-island");
  expect(explained.entries[0]?.validation).toBe("structured");
  expect(explained.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/tail.md");
  const entries = await listGeneratedEntries(root);
  expect(entries.some((entry) => entry.kind === "island" && entry.outputPath === ".claude/agents/reviewer.md")).toBe(true);

  await writeFile(join(root, ".skillset/shared/templates/tail.md"), "Changed.\n");
  const diff = await diffSkillset(root);
  expect(diff.changed).toContain(".claude/agents/reviewer.md");
  expect(diff.changed).toContain(".skillset.lock");
});

test("shared resource mappings reject unsafe and colliding output paths", async () => {
  const colliding = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/shared/references/root.md": `
# Root Reference
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/collision/references/root.md": `
# Local Reference
`,
    ".skillset/plugins/alpha/skills/collision/SKILL.md": `
---
name: collision
description: Collides with a local resource.
resources:
  - from: shared:references/root.md
    to: references/root.md
---

Collision body.
`,
  });

  await expect(buildSkillset(colliding)).rejects.toThrow(
    "would overwrite generated skill file references/root.md"
  );

  const unsafe = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/shared/references/root.md": `
# Root Reference
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/unsafe/SKILL.md": `
---
name: unsafe
description: Writes outside the skill.
resources:
  - from: shared:references/root.md
    to: ../root.md
---

Unsafe body.
`,
  });

  await expect(loadBuildGraph(unsafe)).rejects.toThrow("target paths must stay inside the generated skill");

  const standalonePluginReference = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/skills/standalone/SKILL.md": `
---
name: standalone
description: Tries to use plugin resources.
resources:
  - plugin:references/plugin.md
---

Standalone body.
`,
  });

  await expect(loadBuildGraph(standalonePluginReference)).rejects.toThrow(
    "uses plugin: outside a plugin skill"
  );

  const undeclaredLink = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/undeclared/SKILL.md": `
---
name: undeclared
description: Links to an undeclared resource.
---

Read [missing](shared:references/missing.md).
`,
  });

  await expect(buildSkillset(undeclaredLink)).rejects.toThrow(
    "links to undeclared shared resource"
  );
});

test("plugin hook files must be target-native JSON objects", async () => {
  const invalidCodex = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/hooks/hooks.json": `
[]
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(invalidCodex)).rejects.toThrow("must contain a JSON object");

  const invalidClaude = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/hooks/hooks.json": `
not-json
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(invalidClaude)).rejects.toThrow("not valid JSON");
});

test("standalone skills emit without plugin manifests", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  skills:
    path: skills-claude
codex:
  skills:
    path: skills-agents
`,
    ".skillset/skills/draft/SKILL.md": `
---
name: draft
description: Draft standalone skill.
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

test("rules emit Claude rules and path-derived Codex AGENTS files", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  version: 1.0.0
claude: true
codex: true
`,
    ".skillset/instructions/docs/writing.md": `
---
title: Docs Writing
summary: Source-only summary.
version: 0.2.0
paths:
  - docs/**/*.md
skillset:
  name: docs-writing
---

# Docs Writing

- Keep docs concise.
- Root: {{skillset.repo_root}}
- Output dir: {{skillset.output_dir}}
- Source rule: {{skillset.source_rule}}
`,
    ".skillset/instructions/typescript.md": `
---
paths:
  - "**/*.ts"
---

# TypeScript

- Prefer explicit return types for public APIs.
- Root: {{skillset.repo_root}}
- Output dir: {{skillset.output_dir}}
`,
    "docs/guide.md": `
# Guide
`,
    "src/index.ts": `
export const value = 1;
`,
  });

  await buildSkillset(root);

  const claudeRule = await readFile(join(root, ".claude/rules/docs/writing.md"), "utf8");
  const docsAgents = await readFile(join(root, "docs/AGENTS.md"), "utf8");
  const srcAgents = await readFile(join(root, "src/AGENTS.md"), "utf8");
  const codexLock = await readFile(join(root, ".skillset.lock"), "utf8");
  const claudeLock = await readFile(join(root, ".claude/rules/.skillset.lock"), "utf8");

  expect(claudeRule).toContain(`paths:
  - docs/**/*.md`);
  expect(claudeRule).not.toContain("title:");
  expect(claudeRule).not.toContain("skillset:");
  expect(claudeRule).toContain("# Docs Writing");
  expect(claudeRule).toContain("- Root: ../../..");
  expect(claudeRule).toContain("- Output dir: .claude/rules/docs");
  expect(claudeRule).toContain("- Source rule: .skillset/instructions/docs/writing.md");
  expect(docsAgents).toContain("Generated by skillset@0.1.0");
  expect(docsAgents).toContain("# Docs Writing");
  expect(docsAgents).toContain("- Root: ..");
  expect(docsAgents).toContain("- Output dir: docs");
  expect(docsAgents).toContain("- Source rule: .skillset/instructions/docs/writing.md");
  expect(docsAgents).not.toContain("paths:");
  expect(docsAgents).not.toContain("skillset:");
  expect(srcAgents).toContain("# TypeScript");
  expect(srcAgents).toContain("- Root: ..");
  expect(srcAgents).toContain("- Output dir: src");
  expect(codexLock).toContain(`"outputRoot": "."`);
  expect(codexLock).toContain(`"outputPath": "docs/AGENTS.md"`);
  expect(codexLock).toContain(`"outputPath": "src/AGENTS.md"`);
  expect(claudeLock).toContain(`"outputRoot": ".claude/rules"`);
  expect(claudeLock).toContain(`"outputPath": "docs/writing.md"`);
});

test("rules render variables for root instruction outputs", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/instructions/root.md": `
# Root Rule

- Root: {{skillset.repo_root}}
- Output dir: {{skillset.output_dir}}
- Source rule: {{skillset.source_rule}}
`,
  });

  await buildSkillset(root);

  const rootAgents = await readFile(join(root, "AGENTS.md"), "utf8");
  const claudeRule = await readFile(join(root, ".claude/rules/root.md"), "utf8");

  expect(rootAgents).toContain("- Root: .");
  expect(rootAgents).toContain("- Output dir: .");
  expect(rootAgents).toContain("- Source rule: .skillset/instructions/root.md");
  expect(claudeRule).toContain("- Root: ../..");
  expect(claudeRule).toContain("- Output dir: .claude/rules");
  expect(claudeRule).toContain("- Source rule: .skillset/instructions/root.md");
});

test("rules concatenate Codex AGENTS output and honor target opt-outs", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/instructions/docs/first.md": `
---
paths:
  - docs/**/*.md
claude: false
---

# First Docs Rule
`,
    ".skillset/instructions/docs/second.md": `
---
paths:
  - docs/**/*.md
codex: false
---

# Second Docs Rule
`,
    "docs/guide.md": `
# Guide
`,
  });

  await buildSkillset(root);

  const docsAgents = await readFile(join(root, "docs/AGENTS.md"), "utf8");
  expect(docsAgents).toContain("# First Docs Rule");
  expect(docsAgents).not.toContain("# Second Docs Rule");
  expect(await exists(join(root, ".claude/rules/docs/first.md"))).toBe(false);
  expect(await exists(join(root, ".claude/rules/docs/second.md"))).toBe(true);
});

test("rules back up unmanaged AGENTS collisions", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/instructions/root.md": `
# Root Rule
`,
    "AGENTS.md": `
# Existing Instructions
`,
  });

  const result = await buildSkillsetResult(root);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: "unmanaged-output-collision",
    outputPath: "AGENTS.md",
  }));
  expect(result.writes.backupRunId).toBeDefined();
  expect(await exists(join(root, ".claude/rules/root.md"))).toBe(true);
});

test("rules reject unknown skillset variables", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/instructions/root.md": `
# Root Rule

- Unknown: {{skillset.nope}}
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    "unknown preprocess variable {{skillset.nope}} in .skillset/instructions/root.md"
  );
});

test("rules check mode catches stale managed AGENTS output", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/instructions/docs/writing.md": `
---
paths:
  - docs/**/*.md
---

# Docs Writing
`,
    "docs/guide.md": `
# Guide
`,
  });

  await buildSkillset(root);
  await checkSkillset(root);
  await writeFile(join(root, "docs/AGENTS.md"), "stale\n");

  await expect(checkSkillset(root)).rejects.toThrow("stale generated file: docs/AGENTS.md");
});

test("rules reject Codex symlink mode until target-clean symlinks are designed", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/instructions/docs/writing.md": `
---
paths:
  - docs/**/*.md
codex:
  mode: symlink
---

# Docs Writing
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("codex: symlink");
});

test("build lowers normalized skill policy to Claude frontmatter and Codex agent metadata", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/policy/SKILL.md": `
---
title: Policy Skill
description: Uses normalized policy.
version: 0.3.0
implicit_invocation:
  claude: false
  codex: false
allowed_tools:
  claude:
    - Read
    - Grep
  codex: false
---

Policy body.
`,
    ".skillset/plugins/alpha/skills/policy/agents/openai.yaml": `
interface:
  display_name: Policy Skill
`,
    ".skillset/plugins/alpha/skills/shared/SKILL.md": `
---
name: shared
description: Uses shared policy.
implicit_invocation: false
allowed_tools:
  claude:
    - Read
  codex: false
---

Shared policy body.
`,
  });

  await buildSkillset(root);

  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/policy/SKILL.md"),
    "utf8"
  );
  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/policy/SKILL.md"),
    "utf8"
  );
  const codexAgentMetadata = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/policy/agents/openai.yaml"),
    "utf8"
  );
  const sharedClaudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/shared/SKILL.md"),
    "utf8"
  );
  const sharedCodexAgentMetadata = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/shared/agents/openai.yaml"),
    "utf8"
  );
  const lock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");

  expect(claudeSkill).toContain(`allowed-tools:
  - Read
  - Grep`);
  expect(claudeSkill).toContain("disable-model-invocation: true");
  expect(codexSkill).not.toContain("implicit_invocation:");
  expect(codexSkill).not.toContain("allowed_tools:");
  expect(codexSkill).not.toContain("allowed-tools:");
  expect(codexAgentMetadata).toContain("display_name: Policy Skill");
  expect(codexAgentMetadata).toContain(`policy:
  allow_implicit_invocation: false`);
  expect(sharedClaudeSkill).toContain("disable-model-invocation: true");
  expect(sharedCodexAgentMetadata).toContain(`policy:
  allow_implicit_invocation: false`);
  expect(lock).toContain(`"plugins/alpha/skills/policy/agents/openai.yaml"`);
  expect(lock).toContain(`"plugins/alpha/skills/shared/agents/openai.yaml"`);
});

test("build lowers target-native tool escapes to target-specific artifacts", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/escape/SKILL.md": `
---
name: escape
description: Uses target-native tool escapes.
tool_intent:
  _allow:
    claude:
      - Read
    codex:
      mcp:
        linear:
          tools:
            - issues.*
  _deny:
    claude:
      - AskUserQuestion
claude:
  tool_intent:
    _allow:
      - "NewClaudeTool(project:*)"
      - rule: "Bash(newcli safe *)"
        reason: New Claude tool surface.
codex:
  tool_intent:
    _allow:
      mcp:
        linear:
          tools:
            - experimental.*
    _deny:
      mcp:
        linear:
          tools:
            - experimental.delete
---

Escape body.
`,
  });

  await buildSkillset(root);

  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/escape/SKILL.md"),
    "utf8"
  );
  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/escape/SKILL.md"),
    "utf8"
  );
  const codexTools = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/escape/.skillset.tools.yaml"),
    "utf8"
  );
  const lock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");

  expect(claudeSkill).toContain(`allowed-tools:
  - Read
  - NewClaudeTool(project:*)
  - Bash(newcli safe *)`);
  expect(claudeSkill).toContain(`disallowed-tools:
  - AskUserQuestion`);
  expect(codexSkill).not.toContain("tools:");
  expect(codexSkill).not.toContain("_allow:");
  expect(codexSkill).not.toContain("_deny:");
  expect(codexTools).toContain("generated: skillset@0.1.0");
  expect(codexTools).toContain("issues.*");
  expect(codexTools).toContain("experimental.*");
  expect(codexTools).toContain("experimental.delete");
  expect(lock).toContain(`"plugins/alpha/skills/escape/.skillset.tools.yaml"`);
});

test("build lowers strict portable tools registry and preserves Codex metadata", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/tools/SKILL.md": `
---
name: tools
description: Uses portable tool registry.
tool_intent:
  allow:
    read:
      - docs/**
    search: true
    write:
      - generated/**
    shell:
      - git status
      - prefix:
          - bun
          - run
    web_fetch:
      domains:
        - example.com
    web_search: true
    mcp:
      linear:
        tools:
          - issues.*
  deny:
    edit:
      - secrets/**
    mcp:
      linear:
        tools:
          - delete.*
  _allow:
    claude:
      - AskUserQuestion
    codex:
      mcp:
        slack:
          tools:
            - chat.*
---

Tools body.
`,
  });

  await buildSkillset(root);

  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/tools/SKILL.md"),
    "utf8"
  );
  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/tools/SKILL.md"),
    "utf8"
  );
  const codexTools = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/tools/.skillset.tools.yaml"),
    "utf8"
  );
  const lock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");

  expect(claudeSkill).toContain("Read(docs/**)");
  expect(claudeSkill).toContain("Grep");
  expect(claudeSkill).toContain("Glob");
  expect(claudeSkill).toContain("Edit(generated/**)");
  expect(claudeSkill).toContain("Bash(git status)");
  expect(claudeSkill).toContain("Bash(bun run *)");
  expect(claudeSkill).toContain("WebFetch(domain:example.com)");
  expect(claudeSkill).toContain("WebSearch");
  expect(claudeSkill).toContain("mcp__linear__issues.*");
  expect(claudeSkill).toContain("AskUserQuestion");
  expect(claudeSkill).toContain("Edit(secrets/**)");
  expect(claudeSkill).toContain("mcp__linear__delete.*");
  expect(codexSkill).not.toContain("tools:");
  expect(codexTools).toContain("portable:");
  expect(codexTools).toContain("target_native:");
  expect(codexTools).toContain("docs/**");
  expect(codexTools).toContain("issues.*");
  expect(codexTools).toContain("chat.*");
  expect(lock).toContain(`"plugins/alpha/skills/tools/.skillset.tools.yaml"`);
});

test("Claude target-native tool escapes require native rule strings", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad-tools/SKILL.md": `
---
name: bad-tools
description: Has an invalid Claude target-native tool escape.
claude:
  tool_intent:
    _allow:
      - reason: Missing the native rule string.
---

Bad body.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("skill-tools-invalid");
  await expect(buildSkillset(root)).rejects.toThrow("entries for Claude to be strings or objects with rule");
});

test("portable tools registry rejects unknown tool keys", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad-tools/SKILL.md": `
---
name: bad-tools
description: Has an unknown portable tool key.
tool_intent:
  allow:
    browser: true
---

Bad body.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("skill-tools-invalid");
  await expect(buildSkillset(root)).rejects.toThrow("unknown portable tool key browser");
});

test("target-local tools reject portable policy keys instead of ignoring them", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/bad-target-tools/SKILL.md": `
---
name: bad-target-tools
description: Has target-local portable tool policy.
claude:
  tool_intent:
    allow:
      read:
        - docs/**
---

Bad target tools body.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("skill-tools-invalid");
  await expect(buildSkillset(root)).rejects.toThrow("target tool_intent to contain only _allow and _deny keys");
});

test("target-native false escape does not clear portable tools", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/clear-native/SKILL.md": `
---
name: clear-native
description: Keeps portable tools when native escapes are disabled.
tool_intent:
  allow:
    read:
      - docs/**
  _allow:
    claude:
      - AskUserQuestion
    codex:
      mcp:
        linear:
          tools:
            - issues.*
claude:
  tool_intent:
    _allow: false
codex:
  tool_intent:
    _allow: false
---

Clear native body.
`,
  });

  await buildSkillset(root);

  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/clear-native/SKILL.md"),
    "utf8"
  );
  const codexTools = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/clear-native/.skillset.tools.yaml"),
    "utf8"
  );

  expect(claudeSkill).toContain("Read(docs/**)");
  expect(claudeSkill).not.toContain("AskUserQuestion");
  expect(codexTools).toContain("portable:");
  expect(codexTools).not.toContain("target_native:");
  expect(codexTools).not.toContain("issues.*");
});

test("build and lint reject Codex allowed_tools without an explicit Codex opt-out", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/tools/SKILL.md": `
---
name: tools
description: Shares allowed tools.
allowed_tools:
  - Read
---

Tools body.
`,
  });

  const lintReport = await inspectSkillset(await loadBuildGraph(root));
  expect(lintReport.issues).toContainEqual(expect.objectContaining({
    code: "codex-allowed-tools-unsupported",
    featureId: "tool-intent",
  }));
  await expect(lintSkillset(root)).rejects.toThrow("codex-allowed-tools-unsupported");
  await expect(buildSkillset(root)).rejects.toThrow("allowed_tools has no Codex skill-local lowering");
});

test("target-scoped policy maps reject unknown target keys", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/policy/SKILL.md": `
---
name: policy
description: Has a mistyped target map.
implicit_invocation:
  claude: false
  codeex: false
---

Policy body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("target map to contain only claude and codex keys");
});

test("root target outputs can use defaults, booleans, lists, and include objects", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  plugins: false
  skills: true
codex:
  plugins:
    - alpha
  skills:
    path: codex-skills
    include:
      - public-skill
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
`,
    ".skillset/plugins/beta/skills/beta-skill/SKILL.md": `
---
name: beta-skill
description: Beta skill.
---

Beta body.
`,
    ".skillset/skills/public-skill/SKILL.md": `
---
name: public-skill
description: Public skill.
---

Public body.
`,
    ".skillset/skills/private-skill/SKILL.md": `
---
name: private-skill
description: Private skill.
---

Private body.
`,
  });

  await buildSkillset(root);

  expect(await exists(join(root, "plugins-claude/README.md"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/beta/.codex-plugin/plugin.json"))).toBe(false);
  expect(await exists(join(root, ".claude/skills/public-skill/SKILL.md"))).toBe(true);
  expect(await exists(join(root, ".claude/skills/private-skill/SKILL.md"))).toBe(true);
  expect(await exists(join(root, "codex-skills/public-skill/SKILL.md"))).toBe(true);
  expect(await exists(join(root, "codex-skills/private-skill/SKILL.md"))).toBe(false);
});

test("disabled generated roots with skillset locks remain managed", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  plugins: false
  skills: false
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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
    "plugins-claude/.skillset.lock": `
{
  "generatedBy": "skillset@0.1.0"
}
`,
    "plugins-claude/stale.txt": `
stale
`,
  });

  await expect(checkSkillset(root)).rejects.toThrow("stale generated file");
  await buildSkillset(root);
  expect(await exists(join(root, "plugins-claude/.skillset.lock"))).toBe(false);
  expect(await exists(join(root, "plugins-claude/stale.txt"))).toBe(false);
});

test("check mode catches stale generated output", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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
    ".skillset/plugins/alpha/skills/stale-skill/SKILL.md": `
---
name: stale-skill
description: Stale skill.
---

Stale body.
`,
  });

  await buildSkillset(root);
  await rm(join(root, ".skillset/plugins/alpha/skills/stale-skill"), { recursive: true });

  await expect(checkSkillset(root)).rejects.toThrow("stale generated file");
});

test("check mode reports stale generated skill and plugin versions", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 1.0.0
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
version: 1.0.0
---

Alpha body.
`,
  });

  await buildSkillset(root);
  await writeFile(
    join(root, ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md"),
    normalizeFixture(`
---
name: alpha-skill
description: Alpha skill.
version: 1.1.0
---

Alpha body.
`)
  );

  await expect(checkSkillset(root)).rejects.toThrow(
    "version drift: plugins-claude/plugins/alpha/skills/alpha-skill/SKILL.md metadata.version is 1.0.0, expected 1.1.0"
  );

  await buildSkillset(root);
  await writeFile(
    join(root, ".skillset/plugins/alpha/skillset.yaml"),
    normalizeFixture(`
skillset:
  name: alpha
  version: 1.1.0
`)
  );

  await expect(checkSkillset(root)).rejects.toThrow(
    "version drift: plugins-claude/plugins/alpha/.claude-plugin/plugin.json version is 1.0.0, expected 1.1.0"
  );
});

test("source versions override target-native version overrides", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 1.0.0
claude:
  manifest:
    version: 9.9.9
codex:
  manifest:
    version: 9.9.9
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
version: 2.0.0
claude:
  frontmatter:
    metadata:
      generated: manual
      note: keep
      version: 9.9.9
codex:
  frontmatter:
    metadata:
      generated: manual
      note: keep
      version: 9.9.9
---

Alpha body.
`,
  });

  await buildSkillset(root);

  const claudeManifest = await readFile(
    join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"),
    "utf8"
  );
  const codexManifest = await readFile(
    join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"),
    "utf8"
  );
  const claudeSkill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/alpha-skill/SKILL.md"),
    "utf8"
  );
  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/alpha-skill/SKILL.md"),
    "utf8"
  );

  expect(claudeManifest).toContain(`"version": "1.0.0"`);
  expect(codexManifest).toContain(`"version": "1.0.0"`);
  expect(claudeManifest).not.toContain(`"version": "9.9.9"`);
  expect(codexManifest).not.toContain(`"version": "9.9.9"`);
  expect(claudeSkill).toContain(`metadata:
  generated: skillset@0.1.0
  note: keep
  version: 2.0.0`);
  expect(codexSkill).toContain(`metadata:
  generated: skillset@0.1.0
  note: keep
  version: 2.0.0`);
});

test("source version fields must be semantic versions", async () => {
  const invalidRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
  version: next
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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

  await expect(loadBuildGraph(invalidRoot)).rejects.toThrow("config.yaml.skillset.version to be a semantic version");

  const invalidPlugin = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 1.0
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(loadBuildGraph(invalidPlugin)).rejects.toThrow("skillset.version to be a semantic version");

  const invalidSkill = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
version: 2026
---

Alpha body.
`,
  });

  await expect(loadBuildGraph(invalidSkill)).rejects.toThrow("SKILL.md.version to be a semantic version");
});

test("target-specific skill version bumps explain skips and later resync", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 1.0.0
`,
    ".skillset/plugins/alpha/skills/shared/SKILL.md": `
---
name: shared
description: Shared skill.
version: 1.0.0
---

Shared body.
`,
    ".skillset/plugins/alpha/skills/claude-only/SKILL.md": `
---
name: claude-only
description: Claude-only skill.
version: 1.0.0
codex: false
---

Claude-only body.
`,
  });

  await buildSkillset(root);
  const initialCodexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/shared/SKILL.md"),
    "utf8"
  );
  const initialCodexManifest = await readFile(
    join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"),
    "utf8"
  );

  await writeFile(
    join(root, ".skillset/plugins/alpha/skills/claude-only/SKILL.md"),
    normalizeFixture(`
---
name: claude-only
description: Claude-only skill.
version: 1.1.0
codex: false
---

Claude-only body.
`)
  );
  await buildSkillset(root);

  expect(
    await readFile(join(root, "plugins-codex/plugins/alpha/skills/shared/SKILL.md"), "utf8")
  ).toBe(initialCodexSkill);
  expect(
    await readFile(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"), "utf8")
  ).toBe(initialCodexManifest);
  const skippedCodexLock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");
  expect(skippedCodexLock).toContain(`"targetState": "intentionally-skipped"`);
  expect(skippedCodexLock).toContain(`"claude-only@1.1.0"`);

  await writeFile(
    join(root, ".skillset/plugins/alpha/skills/shared/SKILL.md"),
    normalizeFixture(`
---
name: shared
description: Shared skill.
version: 1.1.0
---

Shared body changed.
`)
  );
  await buildSkillset(root);

  const resyncedCodexSkill = await readFile(
    join(root, "plugins-codex/plugins/alpha/skills/shared/SKILL.md"),
    "utf8"
  );
  expect(resyncedCodexSkill).toContain(`version: 1.1.0`);
  expect(resyncedCodexSkill).toContain("Shared body changed.");
});

test("output roots cannot overlap source or each other", async () => {
  const sourceOverlapRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  plugins:
    path: .skillset/generated
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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
  expect(await exists(join(sourceOverlapRoot, ".skillset/plugins/alpha/skillset.yaml"))).toBe(true);

  const claudeProjectRootOverlap = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .skillset/generated-agents
codex: false
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Reviews code.
---

Review carefully.
`,
  });

  await expect(buildSkillset(claudeProjectRootOverlap)).rejects.toThrow("must not point inside source root");

  const codexProjectRootOverlap = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex:
  projectRoot: .skillset/generated-agents
`,
    ".skillset/src/agents/reviewer.md": `
---
description: Reviews code.
---

Review carefully.
`,
  });

  await expect(buildSkillset(codexProjectRootOverlap)).rejects.toThrow("must not point inside source root");

  const projectRootOutputRootOverlap = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: plugins-claude
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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
    ".skillset/src/agents/reviewer.md": `
---
description: Reviews code.
---

Review carefully.
`,
  });

  await expect(buildSkillset(projectRootOutputRootOverlap)).rejects.toThrow("must not overlap active output root");

  const duplicateRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude:
  plugins:
    path: generated-plugins
codex:
  plugins:
    path: ./generated-plugins
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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
    ".skillset/plugins/alpha/skillset.yaml": `
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
    ".skillset/plugins/alpha/skillset.yaml": `
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

test("root compile targets reject invalid target lists", async () => {
  const withCompileTargets = async (targetsYaml: string): Promise<string> =>
    fixture({
      ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  targets: ${targetsYaml}
`,
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    });

  await expect(loadBuildGraph(await withCompileTargets("codex"))).rejects.toThrow(
    "compile.targets to be a string array"
  );
  await expect(loadBuildGraph(await withCompileTargets("[]"))).rejects.toThrow(
    "compile.targets to include at least one target"
  );
  await expect(loadBuildGraph(await withCompileTargets("[codex, agents]"))).rejects.toThrow(
    "unsupported target \"agents\""
  );
  await expect(loadBuildGraph(await withCompileTargets("[codex, codex]"))).rejects.toThrow(
    "duplicate target \"codex\""
  );
});

test("compile.unsupported defaults to error and accepts explicit error", async () => {
  const defaultRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  const explicitRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  unsupported: error
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(defaultRoot)).resolves.toMatchObject({
    root: { compile: { targets: ["claude", "codex"], unsupported: "error" } },
  });
  await expect(loadBuildGraph(explicitRoot)).resolves.toMatchObject({
    root: { compile: { targets: ["claude", "codex"], unsupported: "error" } },
  });
});

test("compile.unsupported rejects malformed, unknown, and deferred policies", async () => {
  const basePlugin = {
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  };
  const malformedRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile: true
`,
    ...basePlugin,
  });

  await expect(loadBuildGraph(malformedRoot)).rejects.toThrow(".compile to be an object");

  const unknownRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  unsupported: maybe
`,
    ...basePlugin,
  });

  await expect(loadBuildGraph(unknownRoot)).rejects.toThrow("expected one of: error, warn, skip, force");

  const warnRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
compile:
  unsupported: warn
`,
    ...basePlugin,
  });

  await expect(loadBuildGraph(warnRoot)).rejects.toThrow("reserved but not supported yet");
});

test("unknown top-level skillset config keys are rejected", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
surprise: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported top-level key");
});

test("plugin-local config.yaml remains a fallback but not alongside skillset.yaml", async () => {
  const fallbackRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
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

  const graph = await loadBuildGraph(fallbackRoot);
  expect(graph.plugins[0]?.id).toBe("alpha");

  const ambiguousRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/config.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(ambiguousRoot)).rejects.toThrow("both skillset.yaml and config.yaml");
});

test("skillset.id is rejected before public release", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  id: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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

  await expect(loadBuildGraph(root)).rejects.toThrow("uses unsupported skillset.id; use skillset.name");

  const conflictRoot = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  id: other
`,
  });

  await expect(loadBuildGraph(conflictRoot)).rejects.toThrow("uses unsupported skillset.id; use skillset.name");
});

test("lint rejects Claude dynamic context in Codex-enabled skills", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
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

test("lint ignores shell positional arguments inside fenced examples", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/shell-example/SKILL.md": `
---
name: shell-example
description: Shows a shell example.
---

Use this shell snippet as an example:

~~~bash
git log --oneline | awk '{print $1}'
~~~
`,
  });

  await expect(lintSkillset(root)).resolves.toMatchObject({ issues: [] });
});

test("lint checks Codex-enabled standalone skills", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/skills/dynamic/SKILL.md": `
---
name: dynamic
description: Uses Claude arguments.
---

Use $ARGUMENTS to prepare context.
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
    ".skillset/plugins/alpha/skillset.yaml": `
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
  expect(await exists(join(root, ".skillset/plugins/imported-plugin/skillset.yaml"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/imported-plugin/config.yaml"))).toBe(false);
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
    ["bun", join(import.meta.dir, "../cli.ts"), "import", join(root, "external"), "--kind", "skill", "--root", root],
    { stderr: "pipe", stdout: "pipe" }
  );
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(await exists(join(root, ".skillset/skills/cli-imported/SKILL.md"))).toBe(true);
});

test("import command infers paths and accepts --kind skills", async () => {
  const root = await fixture({
    "external-skills/first/SKILL.md": `
---
name: first
description: First skill.
---

First body.
`,
    "external-skills/second/SKILL.md": `
---
name: second
description: Second skill.
---

Second body.
`,
  });

  const proc = Bun.spawn(
    ["bun", join(import.meta.dir, "../cli.ts"), "import", join(root, "external-skills"), "--kind", "skills", "--root", root],
    { stderr: "pipe", stdout: "pipe" }
  );
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(await exists(join(root, ".skillset/skills/first/SKILL.md"))).toBe(true);
  expect(await exists(join(root, ".skillset/skills/second/SKILL.md"))).toBe(true);
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

async function expectFeatureDiagnosticError(
  promise: Promise<unknown>,
  expected: Record<string, unknown>
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toEqual(expect.objectContaining(expected));
    return;
  }
  throw new Error("expected feature diagnostic error");
}

function normalizeFixture(content: string): string {
  return `${content.trimStart().trimEnd()}\n`;
}
