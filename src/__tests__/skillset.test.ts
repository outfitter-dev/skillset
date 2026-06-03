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
    ".skillset/plugins/alpha/agents/reviewer.md": `
# Reviewer

Review carefully.
`,
    ".skillset/plugins/alpha/hooks/hooks.json": `
{
  "hooks": {
    "PreToolUse": []
  }
}
`,
    ".skillset/plugins/alpha/hooks.json": `
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
  expect(claudeManifest).toContain(`"agents": "./agents"`);
  expect(claudeManifest).toContain(`"hooks": "./hooks/hooks.json"`);
  expect(codexManifest).not.toContain(`"agents"`);
  expect(codexManifest).toContain(`"hooks": "./hooks/hooks.json"`);
  expect(await exists(join(root, "plugins-claude/plugins/alpha/agents/reviewer.md"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/agents/reviewer.md"))).toBe(false);
  // SET-2: Codex hooks emit at the documented hooks/hooks.json path; the legacy
  // root hooks.json source keeps target-specific content (SessionStart here).
  expect(await exists(join(root, "plugins-codex/plugins/alpha/hooks.json"))).toBe(false);
  const codexHook = await readFile(join(root, "plugins-codex/plugins/alpha/hooks/hooks.json"), "utf8");
  expect(codexHook).toContain(`"hooks"`);
  expect(codexHook).toContain("SessionStart");
  expect(codexHook).not.toContain("PreToolUse");
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
    ".skillset/plugins/alpha/hooks.json": `
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

test("rules refuse unmanaged AGENTS collisions", async () => {
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

  await expect(buildSkillset(root)).rejects.toThrow("refusing to overwrite unmanaged workspace file AGENTS.md");
  expect(await exists(join(root, ".claude/rules/root.md"))).toBe(false);
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
    "unknown rule variable {{skillset.nope}} in .skillset/instructions/root.md"
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

function normalizeFixture(content: string): string {
  return `${content.trimStart().trimEnd()}\n`;
}
