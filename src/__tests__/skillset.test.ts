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
tools:
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
  tools:
    _allow:
      - "NewClaudeTool(project:*)"
      - rule: "Bash(newcli safe *)"
        reason: New Claude tool surface.
codex:
  tools:
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
tools:
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
  tools:
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
tools:
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
  tools:
    allow:
      read:
        - docs/**
---

Bad target tools body.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("skill-tools-invalid");
  await expect(buildSkillset(root)).rejects.toThrow("target tools to contain only _allow and _deny keys");
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
tools:
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
  tools:
    _allow: false
codex:
  tools:
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

test("skillset.id remains a compatibility alias but conflicts are rejected", async () => {
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

  const graph = await loadBuildGraph(root);
  expect(graph.plugins[0]?.id).toBe("alpha");

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
