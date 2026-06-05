import { chmod, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import { buildSkillset, checkSkillset, diffSkillset } from "../build";
import { doctorSkillset, explainPath } from "../authoring";
import { importSource, importSources } from "../import";
import { lintSkillset } from "../lint";
import { loadBuildGraph } from "../resolver";
import { createSkillset } from "../setup";

// SET-3: skillset.schema separates the source-contract schema from content
// version (skillset.version), generated metadata.version, and lock provenance.

test("SET-3: source builds when skillset.schema is absent (default schema)", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: schema-default
  version: 0.2.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill without an explicit schema.
---

Demo.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.root.metadata.schema).toBeUndefined();
  expect(graph.root.metadata.version).toBe("0.2.0");
});

test("SET-3: source accepts an explicit supported skillset.schema alongside a version", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  schema: 1
  name: schema-explicit
  version: 0.2.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill with an explicit schema.
---

Demo.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.root.metadata.schema).toBe(1);
  expect(graph.root.metadata.version).toBe("0.2.0");
});

test("SET-3: unsupported root skillset.schema fails with a clear diagnostic", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  schema: 2
  name: schema-future
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported source schema 2");
});

test("SET-3: a bare top-level schema key is stripped from generated frontmatter", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: schema-strip
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill with a stray top-level schema key.
schema: 1
---

Demo.
`,
  });

  await buildSkillset(root);
  const skill = await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8");
  expect(skill).not.toContain("schema:");
});

test("SET-3/SET-5: an empty rules dir beside instructions is not a false ambiguity", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: empty-compat
claude: true
codex: true
`,
    ".skillset/instructions/global.md": `
# Global

- Be tidy.
`,
    // Present but empty (no markdown) compat dir must not trigger ambiguity.
    ".skillset/rules/.gitkeep": "",
  });

  const graph = await loadBuildGraph(root);
  expect(graph.instructionsDir).toBe("instructions");
  expect(graph.warnings).toEqual([]);
});

test("SET-3: a semver-style skillset.schema is rejected, not confused with version", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  schema: "1.0.0"
  name: schema-semver
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("skillset.schema is the source schema marker");
});

test("SET-3: unsupported plugin skillset.schema fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: schema-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  schema: 9
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported source schema 9");
});

// SET-4: identity derives from directory names; skillset.name / skillset.id are
// explicit overrides and compatibility aliases with loud conflict diagnostics.

test("SET-4: plugin and skill identity derive from directory names", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/plugins/derived-plugin/skillset.yaml": `
skillset: {}
`,
    ".skillset/plugins/derived-plugin/skills/derived-skill/SKILL.md": `
---
description: A skill whose id comes from its directory.
---

Body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.plugins[0]?.id).toBe("derived-plugin");
  expect(graph.plugins[0]?.skills[0]?.id).toBe("derived-skill");
});

test("SET-4: skillset.id is accepted as a compatibility alias", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/plugins/alias-plugin/skillset.yaml": `
skillset:
  id: alias-plugin
`,
    ".skillset/plugins/alias-plugin/skills/aliased/SKILL.md": `
---
name: aliased
description: Skill using a name.
skillset:
  id: aliased
---

Body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.plugins[0]?.id).toBe("alias-plugin");
  expect(graph.plugins[0]?.skills[0]?.id).toBe("aliased");
});

test("SET-4: conflicting skillset.name and skillset.id fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: conflict-root
  id: different-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("conflicting skillset.name and skillset.id");
});

test("SET-4: a skill top-level name conflicting with skillset.name fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: top-name
description: Demo with conflicting identity.
skillset:
  name: skillset-name
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("conflicting top-level name");
});

test("SET-4: a plugin directory that disagrees with skillset.name fails", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/plugins/real-dir/skillset.yaml": `
skillset:
  name: other-name
`,
    ".skillset/plugins/real-dir/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("does not match skillset.name");
});

// SET-5: canonical source instructions live in .skillset/instructions/;
// .skillset/rules/ remains a compatibility alias. Claude lowers to .claude/rules,
// Codex lowers to AGENTS.md, regardless of the source directory name.

test("SET-5: canonical instructions lower to Claude rules and Codex AGENTS.md", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: instr-root
claude: true
codex: true
`,
    ".skillset/instructions/global.md": `
# Global

- Be tidy.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.instructionsDir).toBe("instructions");
  expect(graph.warnings).toEqual([]);

  await buildSkillset(root);
  expect(await readFile(join(root, ".claude/rules/global.md"), "utf8")).toContain("Be tidy.");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Be tidy.");
});

test("SET-5: .skillset/rules remains a compatibility alias with a deprecation warning", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: compat-root
claude: true
codex: true
`,
    ".skillset/rules/global.md": `
# Global

- Be tidy.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.instructionsDir).toBe("rules");
  expect(graph.warnings.join("\n")).toContain("compatibility alias");

  // The compat path still produces identical native output.
  await buildSkillset(root);
  expect(await readFile(join(root, ".claude/rules/global.md"), "utf8")).toContain("Be tidy.");
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("Be tidy.");
  expect(agents).toContain(".skillset/rules");
});

test("SET-5: instructions and rules dirs both with content fail as ambiguous", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ambiguous-root
claude: true
codex: true
`,
    ".skillset/instructions/global.md": `
# Global
`,
    ".skillset/rules/legacy.md": `
# Legacy
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("both contain instruction files");
});

// SET-6: tool_intent is the canonical portable tool-policy key; tools is a
// compatibility alias. Both keys lower identically; setting both is a conflict.

test("SET-6: tool_intent lowers to Claude allowed-tools like the tools alias", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    ".skillset/skills/intent/SKILL.md": `
---
name: intent
description: Declares a portable read and search policy.
tool_intent:
  allow:
    read: true
    web_search: true
---

Body.
`,
  });

  await buildSkillset(root);
  const skill = await readFile(join(root, ".claude/skills/intent/SKILL.md"), "utf8");
  expect(skill).toContain("allowed-tools");
  expect(skill).toContain("Read");
  expect(skill).toContain("WebSearch");
  // Source key is stripped from generated frontmatter.
  expect(skill).not.toContain("tool_intent");
});

test("SET-6: the tools alias still works and produces identical lowering", async () => {
  const intent = await buildIntentSkill("tool_intent");
  const alias = await buildIntentSkill("tools");
  expect(alias).toBe(intent);
});

test("SET-6: setting both tool_intent and tools fails as a conflict", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    ".skillset/skills/conflict/SKILL.md": `
---
name: conflict
description: Sets both keys.
tool_intent:
  allow:
    read: true
tools:
  allow:
    write: true
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("both tool_intent and the tools compatibility alias");
});

test("SET-6: unknown portable tool keys fail", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    ".skillset/skills/unknown/SKILL.md": `
---
name: unknown
description: Uses an unknown tool key.
tool_intent:
  allow:
    teleport: true
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("unknown portable tool key teleport");
});

async function buildIntentSkill(key: string): Promise<string> {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    [`.skillset/skills/intent/SKILL.md`]: `
---
name: intent
description: Tool intent skill.
${key}:
  allow:
    read: true
    shell:
      - git status
---

Body.
`,
  });

  await buildSkillset(root);
  return readFile(join(root, ".claude/skills/intent/SKILL.md"), "utf8");
}

// SET-2: Codex plugin hooks emit at the documented hooks/hooks.json path with a
// top-level "hooks" object. A canonical hooks/hooks.json is shared by both
// targets; a legacy root hooks.json is a Codex compatibility source.

test("SET-2: a shared hooks/hooks.json emits to both Claude and Codex hook paths", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: hook-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/hooks/hooks.json": `
{
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "./scripts/run.sh" } ] } ]
  }
}
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.warnings).toEqual([]);

  await buildSkillset(root);
  const claudeHook = await readFile(join(root, "plugins-claude/plugins/alpha/hooks/hooks.json"), "utf8");
  const codexHook = await readFile(join(root, "plugins-codex/plugins/alpha/hooks/hooks.json"), "utf8");
  expect(claudeHook).toContain("SessionStart");
  expect(codexHook).toContain("SessionStart");
  expect(codexHook).toContain(`"hooks"`);
  const codexManifest = await readFile(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"), "utf8");
  expect(codexManifest).toContain(`"hooks": "./hooks/hooks.json"`);
});

test("SET-2: a legacy root hooks.json is a Codex compat source, warned and normalized", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: hook-root
claude: false
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    // Flat event map (legacy shape) at the root path.
    ".skillset/plugins/alpha/hooks.json": `
{
  "SessionStart": [ { "hooks": [ { "type": "command", "command": "./scripts/run.sh" } ] } ]
}
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.warnings.join("\n")).toContain("root hooks.json");

  await buildSkillset(root);
  // Emits at the canonical path, wrapped into a top-level "hooks" object.
  expect(await fileExists(join(root, "plugins-codex/plugins/alpha/hooks.json"))).toBe(false);
  const codexHook = await readFile(join(root, "plugins-codex/plugins/alpha/hooks/hooks.json"), "utf8");
  const parsed = JSON.parse(codexHook) as { hooks?: Record<string, unknown> };
  expect(parsed.hooks).toBeDefined();
  expect(parsed.hooks?.SessionStart).toBeDefined();
});

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

// SET-14: golden manifest tests pin the target-surface shapes the evidence
// matrix (docs/target-surfaces.md) claims. Casing drift fails loudly here.

test("SET-14: Codex plugin manifest interface uses documented camelCase fields", async () => {
  const root = await goldenPluginFixture();
  await buildSkillset(root);
  const manifest = JSON.parse(
    await readFile(join(root, "plugins-codex/plugins/widget/.codex-plugin/plugin.json"), "utf8")
  ) as { name: string; version: string; interface: Record<string, unknown> };

  expect(manifest.name).toBe("widget");
  expect(manifest.version).toBe("1.2.3");
  const ui = manifest.interface;
  expect(ui.displayName).toBe("Widget Pro");
  expect(ui.shortDescription).toBe("A widget plugin.");
  expect(ui.longDescription).toBe("A longer widget description.");
  expect(ui.developerName).toBe("Ada Lovelace");
  expect(ui.category).toBe("Productivity");
  expect(ui.capabilities).toEqual(["Read", "Write"]);
  expect(ui.defaultPrompt).toEqual(["Do the widget thing"]);
  expect(ui.brandColor).toBe("#123456");
  expect(ui.websiteURL).toBe("https://example.com");
  // Guard against snake_case drift.
  expect(ui.display_name).toBeUndefined();
  expect(ui.short_description).toBeUndefined();
  expect(ui.brand_color).toBeUndefined();
});

test("SET-14: Codex interface brandColor falls back to the default color", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: gold-root
claude: false
codex: true
`,
    ".skillset/plugins/plain/skillset.yaml": `
skillset:
  name: plain
  summary: Plain plugin.
`,
    ".skillset/plugins/plain/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);
  const manifest = JSON.parse(
    await readFile(join(root, "plugins-codex/plugins/plain/.codex-plugin/plugin.json"), "utf8")
  ) as { interface: { brandColor?: string } };
  expect(manifest.interface.brandColor).toBe("#B06DFF");
});

test("SET-14: Claude plugin manifest emits the documented top-level fields", async () => {
  const root = await goldenPluginFixture();
  await buildSkillset(root);
  const manifest = JSON.parse(
    await readFile(join(root, "plugins-claude/plugins/widget/.claude-plugin/plugin.json"), "utf8")
  ) as Record<string, unknown>;

  expect(manifest.name).toBe("widget");
  expect(manifest.version).toBe("1.2.3");
  expect(manifest.description).toBe("A widget plugin.");
  expect(manifest.skills).toBe("./skills/");
  // Claude manifest carries no Codex interface block.
  expect(manifest.interface).toBeUndefined();
});

// SET-10: import returns a report and preserves target-native fields verbatim.

test("SET-10: skill import reports copied files and classifies frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(
    join(external, "myskill/SKILL.md"),
    [
      "---",
      "name: myskill",
      "description: An imported skill.",
      "allowed-tools:",
      "  - Read",
      "disable-model-invocation: true",
      "frobnicate: maybe",
      "---",
      "",
      "Body.",
      "",
    ].join("\n")
  );

  const report = await importSource({
    kind: "skill",
    rootPath: root,
    sourcePath: join(external, "myskill"),
  });

  expect(report.kind).toBe("skill");
  expect(report.name).toBe("myskill");
  expect(report.copiedFiles).toContain("SKILL.md");
  expect(report.files).toBe(1);
  expect(report.inferredSourceFields).toContain("name");
  expect(report.inferredSourceFields).toContain("description");
  expect(report.preservedTargetNativeFields).toContain("allowed-tools");
  expect(report.preservedTargetNativeFields).toContain("disable-model-invocation");
  expect(report.unsupportedFields).toEqual(["frobnicate"]);
  expect(report.warnings.join("\n")).toContain("target-native");
  expect(report.warnings.join("\n")).toContain("unrecognized");
  expect(report.nextChecks).toContain("skillset lint");

  // Target-native and unknown fields are preserved verbatim in the copied source.
  const copied = await readFile(join(report.targetPath, "SKILL.md"), "utf8");
  expect(copied).toContain("allowed-tools");
  expect(copied).toContain("frobnicate: maybe");
});

test("SET-10: importing a SKILL.md path copies the full skill directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(
    join(external, "full-skill/SKILL.md"),
    "---\nname: full-skill\ndescription: Full skill.\n---\n\nSee references/notes.md.\n"
  );
  await Bun.write(join(external, "full-skill/references/notes.md"), "Imported reference.\n");
  await Bun.write(join(external, "full-skill/scripts/run.sh"), "#!/usr/bin/env bash\n");

  const report = await importSource({
    kind: "skill",
    rootPath: root,
    sourcePath: join(external, "full-skill/SKILL.md"),
  });

  expect(report.name).toBe("full-skill");
  expect(report.copiedFiles).toContain("SKILL.md");
  expect(report.copiedFiles).toContain(join("references", "notes.md"));
  expect(report.copiedFiles).toContain(join("scripts", "run.sh"));
  expect(await Bun.file(join(root, ".skillset/skills/full-skill/references/notes.md")).exists()).toBe(true);
});

test("SET-10: inferred skills-root import copies each skill and dedupes symlinked directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(join(external, "skills/other/SKILL.md"), "---\nname: other\ndescription: Other.\n---\n\nOther.\n");
  await Bun.write(
    join(external, "skills/shared/SKILL.md"),
    "---\nname: shared\ndescription: Shared.\n---\n\nShared.\n"
  );
  await symlink(join(external, "skills/shared"), join(external, "skills/shared-alias"), "dir");

  const report = await importSources({
    rootPath: root,
    sourcePath: join(external, "skills"),
  });

  expect(report.kind).toBe("skills");
  expect(report.imports.map((entry) => entry.name).sort()).toEqual(["other", "shared"]);
  expect(await Bun.file(join(root, ".skillset/skills/other/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/skills/shared/SKILL.md")).exists()).toBe(true);
});

test("SET-10: plugin import reports the config and copied files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(
    join(external, "widget/skillset.yaml"),
    "skillset:\n  name: widget\nclaude: true\ncodex: true\n"
  );
  await Bun.write(
    join(external, "widget/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n"
  );

  const report = await importSource({
    kind: "plugin",
    rootPath: root,
    sourcePath: join(external, "widget"),
  });

  expect(report.kind).toBe("plugin");
  expect(report.name).toBe("widget");
  expect(report.copiedFiles).toContain("skillset.yaml");
  expect(report.copiedFiles).toContain(join("skills", "demo", "SKILL.md"));
  expect(report.inferredSourceFields).toEqual(expect.arrayContaining(["claude", "codex", "skillset"]));
  expect(report.unsupportedFields).toEqual([]);
});

test("SET-10: inferred plugin-root import writes source config for native plugin manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(join(root, ".skillset/config.yaml"), "skillset:\n  name: import-root\n");
  await Bun.write(
    join(external, "plugins/widget/.claude-plugin/plugin.json"),
    JSON.stringify({ name: "Widget", version: "0.8.0", description: "Native widget plugin." })
  );
  await Bun.write(
    join(external, "plugins/widget/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n"
  );

  const report = await importSources({
    rootPath: root,
    sourcePath: external,
  });

  expect(report.kind).toBe("plugins");
  expect(report.imports).toHaveLength(1);
  expect(report.imports[0]?.name).toBe("widget");
  const config = await readFile(join(root, ".skillset/plugins/widget/skillset.yaml"), "utf8");
  expect(config).toContain("name: widget");
  expect(config).toContain("version: 0.8.0");
  expect(config).toContain("description: Native widget plugin.");
  expect(await Bun.file(join(root, ".skillset/plugins/widget/.claude-plugin/plugin.json")).exists()).toBe(true);
  expect((await loadBuildGraph(root)).plugins[0]?.id).toBe("widget");
});

test("SET-10: import never overwrites an existing source", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(join(external, "dup/SKILL.md"), "---\nname: dup\ndescription: Dup.\n---\n\nBody.\n");

  await importSource({ kind: "skill", rootPath: root, sourcePath: join(external, "dup") });
  await expect(
    importSource({ kind: "skill", rootPath: root, sourcePath: join(external, "dup") })
  ).rejects.toThrow("Import never overwrites");
});

test("SET-10: failed imports do not leave source target directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(
    join(external, "not-a-skill.md"),
    "---\nname: partial-import\ndescription: Invalid import source.\n---\n\nBody.\n"
  );

  await expect(
    importSource({ kind: "skill", rootPath: root, sourcePath: join(external, "not-a-skill.md") })
  ).rejects.toThrow("importing a file is only supported");

  expect(await Bun.file(join(root, ".skillset/skills/partial-import")).exists()).toBe(false);
  expect(await readdir(join(root, ".skillset/skills"))).toEqual([]);
});

// SET-9: explain, diff, and doctor authoring commands (local-only, read-only).

test("SET-9: diff reports generated changes without writing", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: diff-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);
  expect(await diffSkillset(root)).toEqual({ added: [], changed: [], missing: [], removed: [] });

  // Change source without rebuilding; diff must show the stale output, and must
  // not have written anything.
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo changed.\n---\n\nNew body.\n"
  );
  const diff = await diffSkillset(root);
  expect(diff.changed).toContain(".claude/skills/demo/SKILL.md");
  // diff is read-only: the on-disk output is still the old build.
  expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("Body.");
});

test("SET-25: build CLI is plan-first and --dry-run wins over --yes", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: plan-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const planned = await runSkillsetCli("build", "--root", root);
  expect(planned.exitCode).toBe(0);
  expect(planned.stdout).toContain("write confirmation required");
  expect(planned.stdout).toContain("rerun with --yes");
  expect(await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()).toBe(false);

  const dryRun = await runSkillsetCli("build", "--root", root, "--yes", "--dry-run");
  expect(dryRun.exitCode).toBe(0);
  expect(dryRun.stdout).toContain("dry run");
  expect(await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()).toBe(false);

  const written = await runSkillsetCli("build", "--root", root, "--yes");
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("wrote");
  expect(await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()).toBe(true);
});

test("SET-25: diff reports missing managed outputs separately", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: missing-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);
  await rm(join(root, ".claude/skills/demo/SKILL.md"));

  const diff = await diffSkillset(root);
  expect(diff.added).not.toContain(".claude/skills/demo/SKILL.md");
  expect(diff.missing).toContain(".claude/skills/demo/SKILL.md");

  await expect(checkSkillset(root)).rejects.toThrow("missing managed generated file: .claude/skills/demo/SKILL.md");
});

test("SET-25: CLI parses build mode and scope flags", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: scoped-root
compile:
  build: updated
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const scoped = await runSkillsetCli("build", "--root", root, "--scope", "repo,plugins", "--all", "--dry-run");
  expect(scoped.exitCode).toBe(0);
  expect(scoped.stdout).toContain("dry run");

  const scopedWrite = await runSkillsetCli("build", "--root", root, "--scope", "repo", "--yes");
  expect(scopedWrite.exitCode).toBe(0);
  expect(scopedWrite.stdout).toContain("wrote");

  const conflicting = await runSkillsetCli("build", "--root", root, "--updated", "--all", "--dry-run");
  expect(conflicting.exitCode).toBe(1);
  expect(conflicting.stderr).toContain("conflicting build mode flags");

  const unknownScope = await runSkillsetCli("build", "--root", root, "--scope", "nope", "--dry-run");
  expect(unknownScope.exitCode).toBe(1);
  expect(unknownScope.stderr).toContain("expected --scope");
});

test("SET-25: scope filters build, diff, and list output", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: scope-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
---

Plugin body.
`,
    ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Repo body.
`,
  });

  const pluginsOnly = await runSkillsetCli("build", "--root", root, "--scope", "plugins", "--yes");
  expect(pluginsOnly.exitCode).toBe(0);
  expect(await Bun.file(join(root, "plugins-claude/plugins/alpha/skills/plugin-skill/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".claude/skills/repo-skill/SKILL.md")).exists()).toBe(false);

  const repoDiff = await runSkillsetCli("diff", "--root", root, "--scope", "repo");
  expect(repoDiff.exitCode).toBe(0);
  expect(repoDiff.stdout).toContain(".claude/skills/repo-skill/SKILL.md");
  expect(repoDiff.stdout).not.toContain("plugins-claude/plugins/alpha");

  const pluginList = await runSkillsetCli("list", "--root", root, "--scope", "plugins");
  expect(pluginList.exitCode).toBe(0);
  expect(pluginList.stdout).toContain("plugins-claude/plugins/alpha");
  expect(pluginList.stdout).not.toContain(".claude/skills/repo-skill");
});

test("SET-25: scoped commands ignore corrupt locks outside the selected scope", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: scope-lock-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
---

Plugin body.
`,
    ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Repo body.
`,
  });

  await buildSkillset(root);
  await writeFile(join(root, "plugins-claude/.skillset.lock"), "{ not valid json", "utf8");

  await expect(diffSkillset(root, { scopes: ["repo"] })).resolves.toEqual({
    added: [],
    changed: [],
    missing: [],
    removed: [],
  });
  await expect(checkSkillset(root, { scopes: ["repo"] })).resolves.toBeDefined();
  await expect(buildSkillset(root, { scopes: ["repo"] })).resolves.toBeDefined();

  const explained = await runSkillsetCli("explain", ".claude/skills/repo-skill/SKILL.md", "--root", root, "--scope", "repo");
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain(".skillset/skills/repo-skill/SKILL.md");
});

test("SET-25: updated mode skips unchanged files while all mode rewrites", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: updated-root
compile:
  build: updated
claude: true
codex: false
`,
    ".skillset/skills/one/SKILL.md": `
---
name: one
description: One.
---

One body.
`,
    ".skillset/skills/two/SKILL.md": `
---
name: two
description: Two.
---

Two body.
`,
  });

  await buildSkillset(root);
  const unchangedPath = join(root, ".claude/skills/two/SKILL.md");
  const initialMtime = (await stat(unchangedPath)).mtimeMs;

  await sleepForMtime();
  await Bun.write(
    join(root, ".skillset/skills/one/SKILL.md"),
    "---\nname: one\ndescription: One changed.\n---\n\nOne body changed.\n"
  );
  await buildSkillset(root);
  expect((await stat(unchangedPath)).mtimeMs).toBe(initialMtime);

  await sleepForMtime();
  await buildSkillset(root, { buildMode: "all" });
  expect((await stat(unchangedPath)).mtimeMs).toBeGreaterThan(initialMtime);
});

test("SET-26: mcp source pointer copies repo file with manifest and lock provenance", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: true
`,
    "integrations/alpha-mcp.json": `
{
  "mcpServers": {
    "alpha": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp:
  source: repo:integrations/alpha-mcp.json
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);

  const claudeManifest = await readFile(join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"), "utf8");
  const codexManifest = await readFile(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"), "utf8");
  const claudeMcp = await readFile(join(root, "plugins-claude/plugins/alpha/.mcp.json"), "utf8");
  const lock = await readFile(join(root, "plugins-claude/.skillset.lock"), "utf8");
  expect(claudeManifest).toContain(`"mcpServers": "./.mcp.json"`);
  expect(codexManifest).toContain(`"mcpServers": "./.mcp.json"`);
  expect(claudeMcp).toContain(`"alpha"`);
  expect(lock).toContain(`"kind": "plugin-feature"`);
  expect(lock).toContain(`"feature": "mcp"`);
  expect(lock).toContain(`"origin": "explicit"`);
  expect(lock).toContain(`"sourcePointer": "repo:integrations/alpha-mcp.json"`);

  const listed = await runSkillsetCli("list", "--root", root, "--scope", "plugins");
  expect(listed.stdout).toContain("plugin-feature mcp (explicit)");

  const explained = await runSkillsetCli("explain", "plugins-claude/plugins/alpha/.mcp.json", "--root", root);
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain("feature: mcp");
  expect(explained.stdout).toContain("origin: explicit");
  expect(explained.stdout).toContain("source pointer: repo:integrations/alpha-mcp.json");
});

test("SET-26: false disables conventional mcp discovery", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp: false
`,
    ".skillset/plugins/alpha/.mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);

  const manifest = await readFile(join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"), "utf8");
  expect(manifest).not.toContain("mcpServers");
  expect(await fileExists(join(root, "plugins-claude/plugins/alpha/.mcp.json"))).toBe(false);
  expect(await fileExists(join(root, "plugins-codex/plugins/alpha/.mcp.json"))).toBe(false);
});

test("SET-26: mcp true requires and copies the conventional source", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp: true
`,
    ".skillset/plugins/alpha/.mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);

  expect(await fileExists(join(root, "plugins-claude/plugins/alpha/.mcp.json"))).toBe(true);
  expect(await fileExists(join(root, "plugins-codex/plugins/alpha/.mcp.json"))).toBe(true);
  const lock = await readFile(join(root, "plugins-codex/.skillset.lock"), "utf8");
  expect(lock).toContain(`"feature": "mcp"`);
  expect(lock).toContain(`"origin": "conventional"`);
});

test("SET-26: conventional bin discovery copies Claude-only feature with provenance", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/bin/tool": `
#!/usr/bin/env bash
echo alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);

  expect(await fileExists(join(root, "plugins-claude/plugins/alpha/bin/tool"))).toBe(true);
  const manifest = await readFile(join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"), "utf8");
  expect(manifest).not.toContain("bin");
  const lock = await readFile(join(root, "plugins-claude/.skillset.lock"), "utf8");
  expect(lock).toContain(`"feature": "bin"`);
  expect(lock).toContain(`"origin": "conventional"`);
  expect(lock).toContain(`"targetState": "target-native"`);
});

test("SET-26: explicit bin source pointer copies Claude-only feature with provenance", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    "tools/alpha/tool": `
#!/usr/bin/env bash
echo alpha
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
bin:
  source: repo:tools/alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await buildSkillset(root);

  expect(await fileExists(join(root, "plugins-claude/plugins/alpha/bin/tool"))).toBe(true);
  const lock = await readFile(join(root, "plugins-claude/.skillset.lock"), "utf8");
  expect(lock).toContain(`"feature": "bin"`);
  expect(lock).toContain(`"origin": "explicit"`);
  expect(lock).toContain(`"sourcePointer": "repo:tools/alpha"`);
});

test("SET-26: bin fails loudly for enabled Codex plugin output", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
bin: true
`,
    ".skillset/plugins/alpha/bin/tool": `
#!/usr/bin/env bash
echo alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("feature bin is Claude-only");
});

test("SET-26: repo source pointers reject escapes, generated roots, and missing paths", async () => {
  const escapeRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp:
  source: repo:../outside.json
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await expect(buildSkillset(escapeRoot)).rejects.toThrow("outside repo root");

  const generatedRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    "plugins-claude/alpha-mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp:
  source: repo:plugins-claude/alpha-mcp.json
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await expect(buildSkillset(generatedRoot)).rejects.toThrow("inside generated output root outputs.plugins.claude");

  const missingRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp:
  source: repo:missing/mcp.json
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await expect(buildSkillset(missingRoot)).rejects.toThrow("points to missing path repo:missing/mcp.json");
});

test("SET-26: plugin feature source type mismatches fail loudly", async () => {
  const mcpDirectoryRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    "integrations/mcp-dir/.gitkeep": "",
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp:
  source: repo:integrations/mcp-dir
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await expect(buildSkillset(mcpDirectoryRoot)).rejects.toThrow("feature mcp source must be a file");

  const binFileRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    "tools/alpha": "#!/usr/bin/env bash\n",
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
bin:
  source: repo:tools/alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await expect(buildSkillset(binFileRoot)).rejects.toThrow("feature bin source must be a directory");
});

test("SET-26: mcp feature sources are validated as JSON", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp: true
`,
    ".skillset/plugins/alpha/.mcp.json": `
{ "mcpServers":
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("invalid generated output");
});

test("SET-26: divergent feature and island outputs fail with both sources", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    "integrations/alpha-mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp:
  source: repo:integrations/alpha-mcp.json
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
    ".skillset/src/plugins/alpha/claude/.mcp.json": `
{
  "mcpServers": {
    "other": { "command": "node" }
  }
}
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("generated output collision");
});

test("SET-27: init previews by default and writes only with confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-init-"));

  const preview = await runSkillsetCli("init", "--root", root, "--targets", "claude");
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("write confirmation required");
  expect(preview.stdout).toContain("+ .skillset/config.yaml");
  expect(await fileExists(join(root, ".skillset/config.yaml"))).toBe(false);

  const written = await runSkillsetCli("init", "--root", root, "--targets", "claude", "--yes");
  expect(written.exitCode).toBe(0);
  const config = await readFile(join(root, ".skillset/config.yaml"), "utf8");
  expect(config).toContain("compile:");
  expect(config).toContain("    - claude");
  expect(config).not.toContain("    - codex");
  expect(await fileExists(join(root, ".skillset/src/.gitkeep"))).toBe(true);
  expect(await fileExists(join(root, ".claude"))).toBe(false);
  expect(await fileExists(join(root, ".codex"))).toBe(false);
  expect(await fileExists(join(root, ".agents"))).toBe(false);
});

test("SET-27: init scaffolds project doc, agents, and islands only when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-shaped-"));

  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(root, ".skillset/instructions/project.md"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/src/agents/.gitkeep"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/src/claude/.gitkeep"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/src/codex/rules/.gitkeep"))).toBe(false);

  const shaped = await mkdtemp(join(tmpdir(), "skillset-setup-shaped-"));
  await expect(
    runSkillsetCli(
      "init",
      "--root",
      shaped,
      "--with-project-doc",
      "--with-agents",
      "--with-islands",
      "--yes"
    )
  ).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(shaped, ".skillset/instructions/project.md"))).toBe(true);
  expect(await fileExists(join(shaped, ".skillset/src/agents/.gitkeep"))).toBe(true);
  expect(await fileExists(join(shaped, ".skillset/src/claude/.gitkeep"))).toBe(true);
  expect(await fileExists(join(shaped, ".skillset/src/codex/rules/.gitkeep"))).toBe(true);

  await expect(runSkillsetCli("build", "--root", shaped, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(shaped, "AGENTS.md"))).toBe(true);
  expect(await fileExists(join(shaped, ".claude/rules/project.md"))).toBe(true);
});

test("SET-27: create makes a new source repo with default naming", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-create-"));

  const preview = await runSkillsetCli("create", "--root", parent);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("my-skillset");
  expect(await fileExists(join(parent, "my-skillset/.skillset/config.yaml"))).toBe(false);

  const written = await runSkillsetCli("create", "--root", parent, "--yes");
  expect(written.exitCode).toBe(0);
  const config = await readFile(join(parent, "my-skillset/.skillset/config.yaml"), "utf8");
  expect(config).toContain("name: my-skillset");
  expect(config).toContain("compile:");
});

test("SET-27: create supports global source path without touching runtime config", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillset-setup-home-"));

  const report = await createSkillset({ global: true, homeDir: home, write: true });

  expect(report.rootPath).toBe(join(home, ".skillset/src"));
  expect(await fileExists(join(home, ".skillset/src/.skillset/config.yaml"))).toBe(true);
  expect(await fileExists(join(home, ".skillset/build"))).toBe(false);
  expect(await fileExists(join(home, ".claude"))).toBe(false);
  expect(await fileExists(join(home, ".codex"))).toBe(false);
});

test("SET-27: setup refuses unsafe overwrite", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-overwrite-"));
  await Bun.write(join(parent, "occupied/README.md"), "already here\n");

  const create = await runSkillsetCli("create", "occupied", "--root", parent, "--yes");
  expect(create.exitCode).toBe(1);
  expect(create.stderr).toContain("create target must be empty");

  const initRoot = await mkdtemp(join(tmpdir(), "skillset-setup-overwrite-"));
  await Bun.write(join(initRoot, ".skillset/config.yaml"), "not: skillset\n");
  const init = await runSkillsetCli("init", "--root", initRoot, "--yes");
  expect(init.exitCode).toBe(1);
  expect(init.stderr).toContain("refusing to overwrite existing setup file");
});

test("SET-27: setup-only flags fail loudly outside their setup command", async () => {
  const initGlobal = await runSkillsetCli("init", "--global");
  expect(initGlobal.exitCode).toBe(1);
  expect(initGlobal.stderr).toContain("--global is only supported with create");

  const buildTargets = await runSkillsetCli("build", "--targets", "claude");
  expect(buildTargets.exitCode).toBe(1);
  expect(buildTargets.stderr).toContain("setup options are only supported with init or create");

  const createGlobalPath = await runSkillsetCli("create", "team-loadout", "--global");
  expect(createGlobalPath.exitCode).toBe(1);
  expect(createGlobalPath.stderr).toContain("either a path or --global");
});

test("SET-9: explain resolves source and generated paths via lock provenance", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: explain-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await buildSkillset(root);

  const source = await explainPath(root, ".skillset/skills/demo/SKILL.md");
  expect(source.kind).toBe("source-skill");
  expect(source.entries.length).toBeGreaterThan(0);
  expect(source.notes.join("\n")).toContain("claude");

  const generated = await explainPath(root, ".claude/skills/demo/SKILL.md");
  expect(generated.kind).toBe("generated");
  expect(generated.entries[0]?.sourcePath).toBe(".skillset/skills/demo/SKILL.md");
  expect(generated.entries[0]?.sourceHash).toBeDefined();

  const unknown = await explainPath(root, "nope/missing.md");
  expect(unknown.kind).toBe("unknown");
});

test("SET-9: doctor aggregates lint issues and drift, and passes when clean", async () => {
  const clean = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: doctor-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await buildSkillset(clean);
  const okReport = await doctorSkillset(clean);
  expect(okReport.ok).toBe(true);
  expect(okReport.lintIssues).toEqual([]);

  const problems = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: doctor-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo with an undeclared resource link.
---

See the [guide](shared:references/guide.md).
`,
  });
  // The undeclared link is both a lint issue and a hard render failure; doctor
  // reports the lint issue and surfaces the render failure as a buildError
  // instead of crashing.
  const badReport = await doctorSkillset(problems);
  expect(badReport.ok).toBe(false);
  expect(badReport.lintIssues.some((issue) => issue.code === "resource-undeclared-link")).toBe(true);
  expect(badReport.buildError).toContain("undeclared shared resource");
});

async function goldenPluginFixture(): Promise<string> {
  return contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: gold-root
claude: true
codex: true
`,
    ".skillset/plugins/widget/skillset.yaml": `
skillset:
  name: widget
  version: 1.2.3
  summary: A widget plugin.
  description: A longer widget description.
  author:
    name: Ada Lovelace
  homepage: https://example.com
  category: Productivity
  presentation:
    display_name: Widget Pro
    capabilities: [Read, Write]
    default_prompt: [Do the widget thing]
    color: "#123456"
`,
    ".skillset/plugins/widget/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
}

// SET-7: generated Codex AGENTS.md carries deterministic per-source boundaries
// and the build warns about instruction files over Codex's size limit.

test("SET-7: concatenated AGENTS.md has deterministic per-source boundaries without frontmatter", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: agents-root
claude: false
codex: true
`,
    ".skillset/instructions/beta.md": `
---
paths:
  - "**/*"
---

# Beta

- Second by name.
`,
    ".skillset/instructions/alpha.md": `
# Alpha

- First by name.
`,
  });

  await buildSkillset(root);
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  // Both sources are bounded by a comment naming their path.
  expect(agents).toContain("<!-- source: .skillset/instructions/alpha.md -->");
  expect(agents).toContain("<!-- source: .skillset/instructions/beta.md -->");
  // Deterministic order: alpha before beta.
  expect(agents.indexOf("alpha.md")).toBeLessThan(agents.indexOf("beta.md"));
  // Source-only frontmatter (paths) never leaks into the generated AGENTS.md.
  expect(agents).not.toContain("paths:");
  expect(agents).toContain("First by name.");
  expect(agents).toContain("Second by name.");
});

test("SET-7: build warns when a generated AGENTS.md exceeds Codex's size limit", async () => {
  const big = `# Big\n\n${"- padding line to grow the instruction file\n".repeat(900)}`;
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: big-root
claude: false
codex: true
`,
    ".skillset/instructions/big.md": big,
  });

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await buildSkillset(root);
  } finally {
    console.warn = original;
  }

  expect(warnings.join("\n")).toContain("project_doc_max_bytes");
  expect(warnings.join("\n")).toContain("AGENTS.md");
});

// SET-15: shared-resource and script authoring diagnostics.

test("SET-15: lint flags an undeclared resource link with a suggested entry", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: res-root
claude: true
codex: false
`,
    ".skillset/shared/references/guide.md": `
# Guide
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Links an undeclared shared resource.
---

See the [guide](shared:references/guide.md).
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("links to undeclared resource shared:references/guide.md");
  await expect(lintSkillset(root)).rejects.toThrow("resources: { references: [shared:references/guide.md] }");
});

test("SET-15: a link to a declared directory-resource child lints clean (no false undeclared)", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: res-root
claude: true
codex: false
`,
    ".skillset/shared/references/dir/page.md": `
# Page
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Links a child of a declared directory resource.
resources:
  references:
    - shared:references/dir
---

See the [page](shared:references/dir/page.md) and the [dir](shared:references/dir).
`,
  });

  const result = await lintSkillset(root);
  expect(result.issues).toEqual([]);
});

test("SET-15: lint flags a plugin-root script dependency in a skill body", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: res-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Depends on a plugin-root script path.
---

Run the [checker](\${CLAUDE_PLUGIN_ROOT}/scripts/check.sh) first.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("plugin-root script path");
});

test("SET-15: lint reports a declared script resource that is not executable", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: res-root
claude: true
codex: false
`,
    ".skillset/shared/scripts/run.sh": `
#!/usr/bin/env bash
echo hi
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Declares a non-executable script resource.
resources:
  scripts:
    - shared:scripts/run.sh
---

Body.
`,
  });

  await chmod(join(root, ".skillset/shared/scripts/run.sh"), 0o644);
  await expect(lintSkillset(root)).rejects.toThrow("is not executable");
});

test("SET-15: an executable declared script resource lints clean", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: res-root
claude: true
codex: false
`,
    ".skillset/shared/scripts/run.sh": `
#!/usr/bin/env bash
echo hi
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Declares an executable script resource.
resources:
  scripts:
    - shared:scripts/run.sh
---

Body.
`,
  });

  await chmod(join(root, ".skillset/shared/scripts/run.sh"), 0o755);
  const result = await lintSkillset(root);
  expect(result.issues).toEqual([]);
});

async function contractFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-contract-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function sleepForMtime(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
