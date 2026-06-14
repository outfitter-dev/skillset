import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";
import { planDistributions } from "@skillset/core";

import { buildSkillset, buildSkillsetResult, checkSkillset, diffSkillset, diffSkillsetResult } from "../build";
import { changeStatus, collectSourceInventory } from "../change-status";
import { doctorSkillset, explainPath } from "../authoring";
import { importSource, importSources } from "../import";
import { lintSkillset } from "../lint";
import { readReleaseState } from "../release-state";
import { loadBuildGraph } from "../resolver";
import { createSkillset, initSkillset } from "../setup";
import { gitSafeEnv } from "../git-env";
import { sourceUnitDisplay } from "../source-unit-selector";

test("SET-52: source-unit selectors render conventional display labels", () => {
  const cases: Array<[string, string]> = [
    ["skill:demo", "skill: demo"],
    ["plugin.alpha.skill:child", "skill(plugin:alpha): child"],
    ["plugin.alpha.feature:mcp", "feature(plugin:alpha): mcp"],
    ["codex.rules:rules/deny.rules", "codex.rules: rules/deny.rules"],
    ["plugin.alpha.codex.app:.app.json", "codex.app(plugin:alpha): .app.json"],
  ];

  for (const [selector, display] of cases) {
    expect(sourceUnitDisplay(selector)).toBe(display);
  }
});

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

test("SET-3/SET-5: an empty rules dir beside instructions is ignored", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: empty-rules
claude: true
codex: true
`,
    ".skillset/instructions/global.md": `
# Global

- Be tidy.
`,
    // Present but empty (no markdown) old dir must not trigger migration errors.
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

// SET-4: identity derives from directory names; skillset.name is the explicit
// override and legacy skillset.id fails loudly.

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

test("SET-4: skillset.id is rejected before public release", async () => {
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

  await expect(loadBuildGraph(root)).rejects.toThrow("uses unsupported skillset.id; use skillset.name");
});

test("SET-4: root skillset.id is rejected even beside skillset.name", async () => {
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

  await expect(loadBuildGraph(root)).rejects.toThrow("uses unsupported skillset.id; use skillset.name");
});

test("SET-4: skill-local skillset.name is rejected", async () => {
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

  await expect(loadBuildGraph(root)).rejects.toThrow("uses unsupported skillset.name; use top-level name");
});

test("SET-4: skill-local skillset.version is rejected", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: id-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo with old version metadata.
skillset:
  version: 1.2.3
---

Body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("uses unsupported skillset.version; use top-level version");
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

// SET-5: canonical source instructions live in .skillset/instructions/. Claude
// lowers to .claude/rules, and Codex lowers to AGENTS.md.

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

test("SET-5: .skillset/rules with markdown is rejected", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: old-rules-root
claude: true
codex: true
`,
    ".skillset/rules/global.md": `
# Global

- Be tidy.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow(".skillset/rules is not supported");
});

test("SET-5: instructions and rules dirs both with content fail on the old directory", async () => {
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

  await expect(loadBuildGraph(root)).rejects.toThrow(".skillset/rules is not supported");
});

// SET-6: tool_intent is the canonical portable tool-policy key; legacy tools
// fails loudly instead of being ignored.

test("SET-6: tool_intent lowers to Claude allowed-tools", async () => {
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

test("SET-6: the legacy tools key is rejected", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    ".skillset/skills/legacy/SKILL.md": `
---
name: legacy
description: Uses the old tools key.
tools:
  allow:
    write: true
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses unsupported tools; use tool_intent");
});

test("SET-6: the legacy tools key is rejected in project agents", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    ".skillset/src/agents/reviewer.md": `
---
name: reviewer
description: Uses the old tools key.
tools:
  allow:
    write: true
---

Review code.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses unsupported tools; use tool_intent");
});

test("SET-6: the legacy tools key is rejected in Codex-only project agents", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: false
codex: true
`,
    ".skillset/src/agents/reviewer.md": `
---
name: reviewer
description: Uses the old tools key.
tools:
  allow:
    write: true
---

Review code.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses unsupported tools; use tool_intent");
});

test("SET-6: the legacy tools key is rejected in target-native Markdown islands", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
`,
    ".skillset/src/claude/agents/reviewer.md": `
---
name: reviewer
description: Uses the old tools key.
tools:
  allow:
    write: true
---

Review code.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses unsupported tools; use tool_intent");
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

// SET-2: Codex plugin hooks emit at the documented hooks/hooks.json path with a
// top-level "hooks" object. A canonical hooks/hooks.json is shared by both
// targets.

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

test("SET-2: old root hooks.json is rejected for any enabled target", async () => {
  for (const targetConfig of [
    "claude: false\ncodex: true",
    "claude: true\ncodex: false",
  ]) {
    const root = await contractFixture({
      ".skillset/config.yaml": `
skillset:
  name: hook-root
${targetConfig}
`,
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
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

    await expect(loadBuildGraph(root)).rejects.toThrow("uses unsupported root hooks.json");
  }
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

test("SET-58: imported plugin manifests round-trip metadata fields through build", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  const originalManifest = {
    name: "roundtrip",
    version: "2.4.6",
    description: "Round-trip fidelity plugin.",
    author: { name: "Author Name", email: "author@example.com", url: "https://example.com/author" },
    homepage: "https://example.com/home",
    repository: "https://github.com/example/roundtrip",
    license: "MIT",
    keywords: ["alpha", "beta"],
  };
  await Bun.write(join(external, "roundtrip/.claude-plugin/plugin.json"), JSON.stringify(originalManifest));
  await Bun.write(
    join(external, "roundtrip/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n"
  );
  await Bun.write(join(root, ".skillset/config.yaml"), "skillset:\n  name: roundtrip-root\nclaude: true\ncodex: false\n");

  await importSource({ kind: "plugin", rootPath: root, sourcePath: join(external, "roundtrip") });
  await buildSkillset(root);

  const generated = JSON.parse(
    await readFile(join(root, "plugins-claude/plugins/roundtrip/.claude-plugin/plugin.json"), "utf8")
  ) as Record<string, unknown>;
  for (const [key, value] of Object.entries(originalManifest)) {
    expect(generated[key]).toEqual(value);
  }
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

  const unchanged = await runSkillsetCli("build", "--root", root, "--yes");
  expect(unchanged.exitCode).toBe(0);
  expect(unchanged.stdout).toContain("wrote 0 generated files");
});

test("SET-109: distribute plan previews plugin distribution without writing", async () => {
  const destination = await mkdtemp(join(tmpdir(), "skillset-distribution-dest-"));
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: distribution-root
compile:
  targets: [codex]
distributions:
  codex-marketplace:
    from:
      target: codex
      runtime: codex-cli
      selector: plugin:alpha
    to:
      kind: local
      path: ${destination}
      subdirectory: bundles/alpha
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const planned = await runSkillsetCli("distribute", "plan", "codex-marketplace", "--root", root);
  expect(planned.exitCode).toBe(0);
  expect(planned.stderr).toBe("");
  expect(planned.stdout).toContain("skillset: distribution codex-marketplace planned");
  expect(planned.stdout).toContain("from: codex plugin:alpha");
  expect(planned.stdout).toContain("runtime: codex-cli");
  expect(planned.stdout).toContain(`to: local ${destination}`);
  expect(planned.stdout).toContain("add: plugins-codex/plugins/alpha/.codex-plugin/plugin.json -> bundles/alpha/.codex-plugin/plugin.json");
  expect(planned.stdout).toContain("ownership: file:generated");
  expect(planned.stdout).toContain("destination-owned");
  expect(await fileExists(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"))).toBe(false);
  expect(await fileExists(join(destination, "bundles/alpha/.codex-plugin/plugin.json"))).toBe(false);
});

test("SET-110: distribute plan reports destination-owned fields from destination manifests", async () => {
  const destination = await mkdtemp(join(tmpdir(), "skillset-distribution-dest-"));
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: distribution-root
compile:
  targets: [codex]
distributions:
  codex-marketplace:
    from:
      target: codex
      runtime: codex-cli
      selector: plugin:alpha
    to:
      kind: local
      path: ${destination}
      subdirectory: bundles/alpha
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await mkdir(join(destination, "bundles/alpha/.codex-plugin"), { recursive: true });
  await writeFile(join(destination, "bundles/alpha/.codex-plugin/plugin.json"), `${JSON.stringify({
    interface: {
      displayName: "Destination Alpha",
    },
    name: "alpha",
    version: "9.9.9",
    xMarketplaceReviewId: "review-123",
  })}\n`);

  const report = await planDistributions(root, { name: "codex-marketplace" });
  const manifest = report.plans[0]?.files.find((file) => file.destinationPath === "bundles/alpha/.codex-plugin/plugin.json");
  expect(manifest?.status).toBe("change");
  expect(manifest?.ownership.fields).toContainEqual(expect.objectContaining({
    owner: "destination-owned",
    selector: "plugin.json#/xMarketplaceReviewId",
  }));
});

test("SET-109: distribute plan rejects write flags and unknown distributions", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: distribution-root
compile:
  targets: [codex]
distributions:
  codex-marketplace:
    from:
      target: codex
      selector: plugin:alpha
    to:
      kind: git
      repo: git@example.com:acme/skillset-codex.git
      branch: main
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const writeFlag = await runSkillsetCli("distribute", "plan", "--root", root, "--yes");
  expect(writeFlag.exitCode).toBe(1);
  expect(writeFlag.stderr).toContain("build/write options are not supported with distribute plan");

  const unknown = await runSkillsetCli("distribute", "plan", "missing", "--root", root);
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr).toContain("unknown distribution missing");
});

test("SET-109: distribute plan rejects unsafe and ambiguous distribution config", async () => {
  async function planWith(distribution: string) {
    const root = await contractFixture({
      ".skillset/config.yaml": `
skillset:
  name: distribution-root
compile:
  targets: [codex]
distributions:
${distribution}
`,
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
      ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
    });
    return runSkillsetCli("distribute", "plan", "codex-marketplace", "--root", root);
  }

  const traversal = await planWith(`
  codex-marketplace:
    from:
      target: codex
      selector: plugin:alpha
    to:
      kind: local
      path: ./dist
      subdirectory: bundles/..
`);
  expect(traversal.exitCode).toBe(1);
  expect(traversal.stderr).toContain("unsafe distribution subdirectory");

  const typoRuntime = await planWith(`
  codex-marketplace:
    from:
      target: codex
      runtime: codex-clli
      selector: plugin:alpha
    to:
      kind: local
      path: ./dist
`);
  expect(typoRuntime.exitCode).toBe(1);
  expect(typoRuntime.stderr).toContain("unsupported");
  expect(typoRuntime.stderr).toContain("codex-clli");

  const mismatchedRuntime = await planWith(`
  codex-marketplace:
    from:
      target: codex
      runtime: claude-code
      selector: plugin:alpha
    to:
      kind: local
      path: ./dist
`);
  expect(mismatchedRuntime.exitCode).toBe(1);
  expect(mismatchedRuntime.stderr).toContain("not compatible with target codex");

  const localWithRepo = await planWith(`
  codex-marketplace:
    from:
      target: codex
      selector: plugin:alpha
    to:
      kind: local
      path: ./dist
      repo: git@example.com:acme/skillset-codex.git
`);
  expect(localWithRepo.exitCode).toBe(1);
  expect(localWithRepo.stderr).toContain("repo is only supported for git distributions");

  const gitWithPath = await planWith(`
  codex-marketplace:
    from:
      target: codex
      selector: plugin:alpha
    to:
      kind: git
      repo: git@example.com:acme/skillset-codex.git
      path: ./dist
`);
  expect(gitWithPath.exitCode).toBe(1);
  expect(gitWithPath.stderr).toContain("path is only supported for local distributions");
});

test("SET-25: CLI help succeeds before command validation", async () => {
  const rootHelp = await runSkillsetCli("--help");
  expect(rootHelp.exitCode).toBe(0);
  expect(rootHelp.stderr).toBe("");
  expect(rootHelp.stdout).toContain("usage: skillset build");
  expect(rootHelp.stdout).toContain("skillset change status [--since <ref>] [--root <path>]");
  expect(rootHelp.stdout).toContain("skillset change check [@ref|--ref <ref>] [--since <ref>] [--root <path>]");
  expect(rootHelp.stdout).not.toContain("skillset change status [--since <ref>] [--scope <scope>]");
  expect(rootHelp.stdout).not.toContain("skillset change check [@ref|--ref <ref>] [--since <ref>] [--scope <scope>]");
  expect(rootHelp.stdout).toContain("skillset explain <path>");
  expect(rootHelp.stdout).toContain("skillset import <path> [--kind <skill|skills|plugin|plugins>]");
  expect(rootHelp.stdout).toContain("skillset distribute plan [name]");

  const shortHelp = await runSkillsetCli("-h");
  expect(shortHelp.exitCode).toBe(0);
  expect(shortHelp.stderr).toBe("");
  expect(shortHelp.stdout).toContain("usage: skillset build");

  const buildHelp = await runSkillsetCli("build", "--help");
  expect(buildHelp.exitCode).toBe(0);
  expect(buildHelp.stderr).toBe("");
  expect(buildHelp.stdout).toContain("skillset build [--yes|--dry-run]");
  expect(buildHelp.stdout).toContain("skillset release plan");
  expect(buildHelp.stdout).toContain("skillset distribute plan");

  const explainHelp = await runSkillsetCli("explain", "--help");
  expect(explainHelp.exitCode).toBe(0);
  expect(explainHelp.stderr).toBe("");
  expect(explainHelp.stdout).toContain("skillset explain <path>");
  expect(explainHelp.stderr).not.toContain("expected a path to explain");
});

test("SET-41: hooks print emits additive runner snippets", async () => {
  for (const [runner, marker] of [
    ["lefthook", "lefthook.yml"],
    ["husky", ".husky/pre-commit"],
    ["pre-commit", ".pre-commit-config.yaml"],
    ["git", ".git/hooks/pre-commit"],
  ] as const) {
    const printed = await runSkillsetCli("hooks", "print", "--runner", runner, "--pre-commit", "--pre-push");
    expect(printed.exitCode).toBe(0);
    expect(printed.stderr).toBe("");
    expect(printed.stdout).toContain(marker);
    expect(printed.stdout).toContain("skillset change check --staged");
    expect(printed.stdout).toContain("skillset change check --since origin/main");
    expect(printed.stdout).toContain("skillset check");
    expect(printed.stdout).toContain("skillset doctor");
    if (runner === "pre-commit") expect(printed.stdout).toContain("entry: sh -c");
  }
});

test("SET-41: hooks print emits target runtime suggestions without installing", async () => {
  const claude = await runSkillsetCli("hooks", "print", "--target", "claude", "--agent-runtime");
  expect(claude.exitCode).toBe(0);
  expect(claude.stdout).toContain(".claude/settings.local.json");
  expect(claude.stdout).toContain("PostToolUse");
  expect(claude.stdout).toContain("Stop");
  expect(claude.stdout).toContain("git status --porcelain=v1 --untracked-files=all");
  expect(claude.stdout).toContain(".skillset/src");
  expect(claude.stdout).toContain(".skillset/shared");
  expect(claude.stdout).toContain(".skillset/changes/pending");
  expect(claude.stdout).not.toContain("skillset doctor");
  expect(claude.stdout).toContain("Skillset does not install or trust hooks");

  const codex = await runSkillsetCli("hooks", "print", "--target", "codex", "--agent-runtime");
  expect(codex.exitCode).toBe(0);
  expect(codex.stdout).toContain(".codex/hooks/hooks.json");
  expect(codex.stdout).toContain("PostToolUse");
  expect(codex.stdout).toContain("Stop");
  expect(codex.stdout).toContain("git status --porcelain=v1 --untracked-files=all");

  const invalid = await runSkillsetCli("hooks", "print", "--runner", "git", "--agent-runtime");
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("cannot be combined");

  const scoped = await runSkillsetCli("hooks", "print", "--runner", "git", "--scope", "repo");
  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("non-hook options are not supported");

  const updated = await runSkillsetCli("hooks", "print", "--runner", "git", "--updated");
  expect(updated.exitCode).toBe(1);
  expect(updated.stderr).toContain("non-hook options are not supported");

  const since = await runSkillsetCli("hooks", "print", "--runner", "git", "--since", "HEAD");
  expect(since.exitCode).toBe(1);
  expect(since.stderr).toContain("non-hook options are not supported");

  const named = await runSkillsetCli("hooks", "print", "--runner", "git", "--name", "demo");
  expect(named.exitCode).toBe(1);
  expect(named.stderr).toContain("non-hook options are not supported");

  const importKind = await runSkillsetCli("hooks", "print", "--runner", "git", "--kind", "skill");
  expect(importKind.exitCode).toBe(1);
  expect(importKind.stderr).toContain("non-hook options are not supported");
});

test("SET-44: change status and check reject scoped source coverage", async () => {
  const status = await runSkillsetCli("change", "status", "--scope", "repo");
  expect(status.exitCode).toBe(1);
  expect(status.stderr).toContain("change status is a whole-source command");
  expect(status.stderr).toContain("--scope is not supported");

  const check = await runSkillsetCli("change", "check", "--scope", "repo");
  expect(check.exitCode).toBe(1);
  expect(check.stderr).toContain("change check is a whole-source command");
  expect(check.stderr).toContain("--scope is not supported");
});

test("SET-50: skillset test runs an isolated projection and refreshes latest", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
tests:
  self:
    source: repo:.skillset
    output:
      kind: isolated
    assertions:
      - build
      - exists: .claude/skills/demo/SKILL.md
      - contains:
          path: .claude/skills/demo/SKILL.md
          text: Demo body.
      - noDrift
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  const first = await runSkillsetCli("test", "self", "--root", root);
  expect(first.exitCode).toBe(0);
  expect(first.stderr).toBe("");
  expect(first.stdout).toContain("skillset: test self passed");
  expect(first.stdout).toContain("pass: build");
  expect(first.stdout).toContain("pass: noDrift");

  const firstLatest = JSON.parse(await readFile(join(root, ".skillset/build/tests/latest.json"), "utf8")) as {
    runId: string;
    runPath: string;
    workspacePath: string;
  };
  expect(firstLatest.runId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  expect(await fileExists(join(root, firstLatest.runPath, "report.json"))).toBe(true);
  expect(await fileExists(join(root, ".skillset/build/tests/latest/report.json"))).toBe(true);
  expect(await fileExists(join(root, ".skillset/build/tests/latest/workspace/.claude/skills/demo/SKILL.md"))).toBe(true);
  expect(await fileExists(join(root, ".skillset/build/tests/latest/workspace/.agents/skills/demo/SKILL.md"))).toBe(false);
  expect(await fileExists(join(root, ".claude/skills/demo/SKILL.md"))).toBe(false);
  const firstReport = JSON.parse(await readFile(join(root, firstLatest.runPath, "report.json"), "utf8")) as {
    targets: readonly string[];
  };
  expect(firstReport.targets).toEqual(["claude"]);

  const second = await runSkillsetCli("test", "self", "--root", root);
  expect(second.exitCode).toBe(0);
  const secondLatest = JSON.parse(await readFile(join(root, ".skillset/build/tests/latest.json"), "utf8")) as {
    runId: string;
    runPath: string;
  };
  expect(secondLatest.runId).not.toBe(firstLatest.runId);
  expect(await fileExists(join(root, firstLatest.runPath, "report.json"))).toBe(true);
  expect(await fileExists(join(root, secondLatest.runPath, "report.md"))).toBe(true);
});

test("SET-112: skillset test compiles activation probes into run and latest assets", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: activation-root
tests:
  activation:
    source: repo:.skillset
    targets:
      - claude
      - codex
    activation:
      - name: fixture guidance
        prompt: Help me inspect this Skillset fixture setup.
        expect:
          skill: demo
    assertions:
      - build
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  const result = await runSkillsetCli("test", "activation", "--root", root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("activation probes: 1");
  expect(result.stdout).toContain("activation:");
  expect(await fileExists(join(root, ".skillset/build/tests/latest/activation/claude/fixture-guidance.md"))).toBe(true);
  expect(await fileExists(join(root, ".skillset/build/tests/latest/activation/codex/fixture-guidance.md"))).toBe(true);
  const claudeProbe = await readFile(join(root, ".skillset/build/tests/latest/activation/claude/fixture-guidance.md"), "utf8");
  expect(claudeProbe).toContain("Manual Claude activation probe");
  expect(claudeProbe).toContain("- skill: demo");
  const codexProbe = await readFile(join(root, ".skillset/build/tests/latest/activation/codex/probes.json"), "utf8");
  expect(codexProbe).toContain("manual-shimmed");
  expect(codexProbe).toContain("fixture-guidance");
});

test("SET-112: activation probes reject empty prompts and duplicate output names", async () => {
  const emptyPromptRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: empty-prompt-root
tests:
  activation:
    source: repo:.skillset
    activation:
      - prompt: " "
        expect:
          skill: demo
    assertions:
      - build
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });
  const emptyPrompt = await runSkillsetCli("test", "activation", "--root", emptyPromptRoot);
  expect(emptyPrompt.exitCode).toBe(1);
  expect(emptyPrompt.stderr).toContain("prompt is required");

  const duplicateRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: duplicate-probe-root
tests:
  activation:
    source: repo:.skillset
    activation:
      - name: Demo probe
        prompt: First prompt.
        expect:
          skill: first
      - name: demo-probe
        prompt: Second prompt.
        expect:
          skill: second
    assertions:
      - build
claude: true
codex: false
`,
    ".skillset/skills/first/SKILL.md": `
---
name: first
description: First.
---

First body.
`,
    ".skillset/skills/second/SKILL.md": `
---
name: second
description: Second.
---

Second body.
`,
  });
  const duplicate = await runSkillsetCli("test", "activation", "--root", duplicateRoot);
  expect(duplicate.exitCode).toBe(1);
  expect(duplicate.stderr).toContain("duplicate activation probe output name");
  expect(await fileExists(join(duplicateRoot, ".skillset/build/tests/runs"))).toBe(false);

  const emptyTargetsRoot = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: empty-targets-root
tests:
  activation:
    source: repo:.skillset
    activation:
      - name: empty targets
        prompt: Probe prompt.
        targets: []
        expect:
          skill: demo
    assertions:
      - build
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });
  const emptyTargets = await runSkillsetCli("test", "activation", "--root", emptyTargetsRoot);
  expect(emptyTargets.exitCode).toBe(1);
  expect(emptyTargets.stderr).toContain("targets to include at least one target");
  expect(await fileExists(join(emptyTargetsRoot, ".skillset/build/tests/runs"))).toBe(false);
});

test("SET-112: activation probes require expected units to be emitted for the target", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: missing-activation-root
tests:
  activation:
    source: repo:.skillset
    targets:
      - claude
    activation:
      - name: missing skill
        prompt: Probe prompt.
        expect:
          skill: missing
    assertions:
      - build
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  const result = await runSkillsetCli("test", "activation", "--root", root);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("activation expected skill missing was not emitted for target claude");
  expect(await fileExists(join(root, ".skillset/build/tests/runs"))).toBe(false);
});

test("SET-112: test declarations are root-owned and rejected in plugin config", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: root-owned-tests
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
tests:
  ignored:
    source: repo:.skillset
    assertions:
      - build
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("unsupported top-level key tests");
});

test("SET-50: skillset test reports failed assertions without touching live outputs", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: failing-test-root
compile:
  targets:
    - claude
tests:
  self:
    source: repo:.skillset
    assertions:
      - build
      - exists: missing/generated.txt
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  const result = await runSkillsetCli("test", "self", "--root", root);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("fail: exists missing/generated.txt");
  expect(result.stdout).toContain("skillset: test self failed");

  const report = JSON.parse(await readFile(join(root, ".skillset/build/tests/latest/report.json"), "utf8")) as {
    ok: boolean;
    assertions: Array<{ detail?: string; kind: string; ok: boolean; path?: string }>;
  };
  expect(report.ok).toBe(false);
  expect(report.assertions).toContainEqual({ detail: "path does not exist", kind: "exists", ok: false, path: "missing/generated.txt" });
  expect(await fileExists(join(root, ".claude/skills/demo/SKILL.md"))).toBe(false);
});

test("SET-50: skillset test rejects build scope and write flags", async () => {
  const scoped = await runSkillsetCli("test", "--scope", "repo");
  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("build/write options are not supported with test");

  const write = await runSkillsetCli("test", "--yes");
  expect(write.exitCode).toBe(1);
  expect(write.stderr).toContain("build/write options are not supported with test");
});

test("SET-41: change status --staged reads the Git index", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: staged-root
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
  await commitFixture(root);
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), `
---
name: demo
description: Demo changed.
---

Changed body.
`);
  await mkdir(join(root, ".skillset/skills/unstaged"), { recursive: true });
  await writeFile(join(root, ".skillset/skills/unstaged/SKILL.md"), `
---
name: unstaged
description: Unstaged.
---

Unstaged body.
`);
  await runGit(root, "add", ".skillset/skills/demo/SKILL.md");

  const status = await runSkillsetCli("change", "status", "--staged", "--root", root);
  expect(status.exitCode).toBe(0);
  expect(status.stdout).toContain("baseline git ref HEAD");
  expect(status.stdout).toContain("skill: demo");
  expect(status.stdout).not.toContain("unstaged");

  const stagedStatus = await changeStatus(root, { staged: true });
  const demoHash = stagedStatus.sourceChanges.find((change) => change.id === "skill:demo")?.currentHash;
  expect(demoHash).toBeDefined();
  await mkdir(join(root, ".skillset/changes/pending"), { recursive: true });
  const pendingPath = join(root, ".skillset/changes/pending/demo.md");
  await writeFile(pendingPath, `---
id: abcdef123456
scope: skill:demo
bump: patch
evidence:
  sourceHash: ${demoHash}
---

short
`);
  await runGit(root, "add", pendingPath);
  await writeFile(pendingPath, `---
id: abcdef123456
scope: skill:demo
bump: patch
evidence:
  sourceHash: ${demoHash}
---

This working-tree reason is long enough to pass, but it has not been staged.
`);

  const checked = await runSkillsetCli("change", "check", "--staged", "--root", root);
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("reason must be at least");
});

test("SET-41: change check --staged reads staged reason policy", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: staged-policy-root
changes:
  reason:
    minLength: 10
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
  await commitFixture(root);
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), `
---
name: demo
description: Demo changed.
---

Changed body.
`);
  await runGit(root, "add", ".skillset/skills/demo/SKILL.md");
  const stagedStatus = await changeStatus(root, { staged: true });
  const demoHash = stagedStatus.sourceChanges.find((change) => change.id === "skill:demo")?.currentHash;
  expect(demoHash).toBeDefined();
  await mkdir(join(root, ".skillset/changes/pending"), { recursive: true });
  const pendingPath = join(root, ".skillset/changes/pending/demo.md");
  await writeFile(pendingPath, `---
id: abcdef123456
scope: skill:demo
bump: patch
evidence:
  sourceHash: ${demoHash}
---

Staged reason ok.
`);
  await runGit(root, "add", pendingPath);
  await writeFile(join(root, ".skillset/config.yaml"), `
skillset:
  name: staged-policy-root
changes:
  reason:
    minLength: 100
claude: true
codex: false
`);

  const checked = await runSkillsetCli("change", "check", "--staged", "--root", root);
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("change check passed");
});

test("SET-34: source change status is read-only and deterministic for unchanged source", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: status-root
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
  await commitFixture(root);

  const first = await changeStatus(root, { since: "HEAD" });
  const second = await changeStatus(root, { since: "HEAD" });

  expect(first.hashSchema).toBe("skillset-source-unit-v2");
  expect(first.sourceChanges).toEqual([]);
  expect(
    first.sourceUnits.map((unit) => ({ hash: unit.hash, id: unit.id, kind: unit.kind }))
  ).toEqual(second.sourceUnits.map((unit) => ({ hash: unit.hash, id: unit.id, kind: unit.kind })));
  expect(await Bun.file(join(root, ".claude/skills/demo/SKILL.md")).exists()).toBe(false);
});

test("SET-34: change status reports body changes and generated drift separately", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: status-drift-root
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
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nChanged body.\n"
  );

  const status = await runSkillsetCli("change", "status", "--root", root, "--since", "HEAD");
  expect(status.exitCode).toBe(0);
  expect(status.stdout).toContain("source hash schema skillset-source-unit-v2");
  expect(status.stdout).toContain("~ skill: demo");
  expect(status.stdout).toContain("source change(s) needing entries");
  expect(status.stdout).toContain("generated-output drift");
  expect(status.stdout).toContain("generated ~ .claude/skills/demo/SKILL.md");
  expect(await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("Body.");
});

test("SET-34: support and dependency metadata are source-significant without frontmatter leakage", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: status-metadata-root
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
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo.
supports:
  - "@acme/docs-cli >=2.4.0 <3.0.0"
dependencies:
  plugins:
    - acme-docs
---

Body.
`
  );

  const report = await changeStatus(root, { since: "HEAD" });
  expect(report.sourceChanges.map((change) => change.id)).toContain("skill:demo");
  const unit = report.sourceUnits.find((item) => item.id === "skill:demo");
  expect(unit?.regions).toEqual([
    { name: "dependencies", severityBearing: true },
    { name: "supports", severityBearing: false },
  ]);

  await buildSkillset(root);
  const generated = await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8");
  expect(generated).not.toContain("supports:");
  expect(generated).not.toContain("dependencies:");
});

test("SET-39: supports validate ranges and warn on repo package mismatches", async () => {
  const root = await contractFixture({
    "packages/docs-cli/package.json": `
{
  "name": "@acme/docs-cli",
  "version": "3.1.0"
}
`,
    ".skillset/config.yaml": `
skillset:
  name: supports-root
supports:
  packages:
    - name: "@acme/docs-cli"
      range: ">=2.4.0 <3.0.0"
      source: repo:packages/docs-cli/package.json
      onMismatch: warn
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
supports:
  - "@acme/docs-cli@^2.4.0"
  - "eslint@~9.0.0"
---

Body.
`,
  });

  await buildSkillset(root);
  const checked = await runSkillsetCli("check", "--root", root);
  expect(checked.exitCode).toBe(0);
  expect(checked.stderr).toContain("@acme/docs-cli supports >=2.4.0 <3.0.0");
  expect(checked.stderr).toContain("repo:packages/docs-cli/package.json is 3.1.0");
});

test("SET-39: invalid supports ranges fail loudly", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: invalid-supports-root
supports:
  - "@acme/docs-cli >=2 || <3"
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

  await expect(loadBuildGraph(root)).rejects.toThrow("OR ranges are not supported in v1");
});

test("SET-39: supports repo sources validate package names before ranges", async () => {
  const root = await contractFixture({
    "packages/wrong/package.json": `
{
  "name": "@wrong/pkg",
  "version": "2.5.0"
}
`,
    ".skillset/config.yaml": `
skillset:
  name: wrong-package-root
supports:
  packages:
    - name: "@acme/docs-cli"
      range: ">=2.4.0 <3.0.0"
      source: repo:packages/wrong/package.json
      onMismatch: error
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

  await expect(loadBuildGraph(root)).rejects.toThrow("expected @acme/docs-cli");
});

test("SET-39: supports objects must use explicit package collections", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: unsupported-supports-root
supports:
  name: eslint
  range: "^9.0.0"
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

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported");
  await expect(loadBuildGraph(root)).rejects.toThrow("v1 supports packages");
});

test("SET-39: supports-only changes can use bump none without severity warnings", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: supports-change-root
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
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo.
supports:
  packages:
    - name: "@acme/docs-cli"
      range: "^2.4.0"
---

Body.
`
  );
  const status = await changeStatus(root, { since: "HEAD" });
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();
  expect(demo?.currentRegions).toContainEqual({ name: "supports", severityBearing: false });
  await writePendingChange(root, "supports.md", `
---
id: 888888ffffff
bump: none
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Record the supports metadata compatibility update without changing generated artifact behavior.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("0 warnings");
  expect(checked.stdout).not.toContain("change-bump-lower-than-suggested");
});

test("SET-40: plugin dependencies lower to Claude and Codex fallback notices", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: dependency-root
compile:
  targets: [claude, codex]
`,
    ".skillset/plugins/secrets-vault/skillset.yaml": `
skillset:
  name: secrets-vault
  version: 1.2.3
  manifest:
    name: native-secrets-vault
`,
    ".skillset/plugins/secrets-vault/skills/secret/SKILL.md": `
---
name: secret
description: Secret helper.
---

Secret body.
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
  version: 0.4.0
dependencies:
  plugins:
    - name: external-tools
      range: "^2.1.0"
      marketplace: acme
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
dependencies:
  plugins:
    - plugin:secrets-vault
---

Audit body.
`,
  });

  await buildSkillset(root);
  const claudeManifest = await readFile(join(root, "plugins-claude/plugins/audit/.claude-plugin/plugin.json"), "utf8");
  expect(claudeManifest).toContain('"dependencies"');
  expect(claudeManifest).toContain('"name": "native-secrets-vault"');
  expect(claudeManifest).toContain('"range": "=1.2.3"');
  expect(claudeManifest).toContain('"name": "external-tools"');
  expect(claudeManifest).toContain('"marketplace": "acme"');

  const codexSkill = await readFile(join(root, "plugins-codex/plugins/audit/skills/audit-skill/SKILL.md"), "utf8");
  expect(codexSkill).toContain("<skillset_plugin_dependencies>");
  expect(codexSkill).toContain("secrets-vault range =1.2.3 internal");
  expect(codexSkill).toContain("external-tools range ^2.1.0 marketplace acme external");
  expect(codexSkill).toContain("Do not install or resolve them yourself");

  const listed = await runSkillsetCli("list", "--root", root);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout).toContain("deps:external-tools range ^2.1.0 marketplace acme external");
  const explained = await runSkillsetCli("explain", ".skillset/plugins/audit", "--root", root);
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain("dependencies: external-tools range ^2.1.0 marketplace acme external");
  expect(explained.stdout).toContain("secrets-vault range =1.2.3 internal");

  const auditLockSourceHash = async (): Promise<string> => {
    const lock = JSON.parse(await readFile(join(root, "plugins-claude/.skillset.lock"), "utf8")) as {
      items: Array<{ outputPath?: string; sourceHash?: string }>;
    };
    return lock.items.find((item) => item.outputPath === "plugins/audit/.claude-plugin/plugin.json")?.sourceHash ?? "";
  };
  const originalHash = await auditLockSourceHash();
  await writeFile(join(root, ".skillset/plugins/secrets-vault/skillset.yaml"), `
skillset:
  name: secrets-vault
  version: 1.2.3
  manifest:
    name: renamed-native-secrets-vault
`);
  await buildSkillset(root);
  expect(await auditLockSourceHash()).not.toBe(originalHash);
});

test("SET-40: internal plugin dependencies must resolve", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: missing-dependency-root
claude: true
codex: false
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - plugin:missing
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unknown plugin missing");
});

test("SET-40: external plugin dependencies require ranges unless explicit", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: invalid-external-dependency-root
claude: true
codex: false
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - name: external-tools
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("requires range or unversioned: true");
});

test("SET-40: plugin dependency entries reject ambiguous shapes", async () => {
  for (const [name, dependencyYaml, expected] of [
    [
      "internal-range",
      `
    - plugin: secrets-vault
      range: "^1.0.0"
`,
      "must not include range",
    ],
    [
      "external-range-unversioned",
      `
    - name: external-tools
      range: "^2.1.0"
      unversioned: true
`,
      "must not combine range with unversioned",
    ],
    [
      "internal-unversioned",
      `
    - plugin: secrets-vault
      unversioned: false
`,
      "must not include range",
    ],
    [
      "external-or-range",
      `
    - name: external-tools
      range: "^1.0.0 || ^2.0.0"
`,
      "OR ranges are not supported",
    ],
    [
      "unsupported-entry-key",
      `
    - name: external-tools
      range: "^1.0.0"
      install: automatic
`,
      "unsupported",
    ],
  ] as const) {
    const root = await contractFixture({
      ".skillset/config.yaml": `
skillset:
  name: ${name}
claude: true
codex: false
`,
      ".skillset/plugins/secrets-vault/skillset.yaml": `
skillset:
  name: secrets-vault
  version: 1.2.3
`,
      ".skillset/plugins/secrets-vault/skills/secret/SKILL.md": `
---
name: secret
description: Secret helper.
---

Secret body.
`,
      ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
${dependencyYaml}
`,
      ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
    });

    await expect(loadBuildGraph(root)).rejects.toThrow(expected);
  }
});

test("SET-40: plugin dependency graph rejects self-dependencies", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: self-dependency-root
claude: true
codex: false
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - plugin: audit
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("must not depend on itself");
});

test("SET-40: plugin dependencies reject unsupported dependency groups", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: unsupported-dependency-root
claude: true
codex: false
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  tools: []
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported");
});

test("SET-40: Claude manifest overrides must not clobber generated dependencies", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: dependency-override-root
compile:
  targets: [claude]
`,
    ".skillset/plugins/secrets-vault/skillset.yaml": `
skillset:
  name: secrets-vault
  version: 1.2.3
`,
    ".skillset/plugins/secrets-vault/skills/secret/SKILL.md": `
---
name: secret
description: Secret helper.
---

Secret body.
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - plugin: secrets-vault
claude:
  manifest:
    dependencies:
      plugins:
        - name: manual-only
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("would overwrite generated dependency metadata");
});

test("SET-40: Codex dependencies need an enabled skill notice surface", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: codex-dependency-notice-root
compile:
  targets: [codex]
`,
    ".skillset/plugins/secrets-vault/skillset.yaml": `
skillset:
  name: secrets-vault
  version: 1.2.3
`,
    ".skillset/plugins/secrets-vault/skills/secret/SKILL.md": `
---
name: secret
description: Secret helper.
---

Secret body.
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - plugin: secrets-vault
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
codex: false
---

Audit body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("has no enabled Codex skills to carry the dependency notice");
});

test("SET-40: internal plugin dependencies must be emitted for the target", async () => {
  for (const [target, disabledTarget] of [
    ["claude", "claude"],
    ["codex", "codex"],
  ] as const) {
    const root = await contractFixture({
      ".skillset/config.yaml": `
skillset:
  name: target-dependency-root
compile:
  targets: [${target}]
`,
      ".skillset/plugins/secrets-vault/skillset.yaml": `
skillset:
  name: secrets-vault
  version: 1.2.3
${disabledTarget}: false
`,
      ".skillset/plugins/secrets-vault/skills/secret/SKILL.md": `
---
name: secret
description: Secret helper.
---

Secret body.
`,
      ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - plugin: secrets-vault
`,
      ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
    });

    await expect(buildSkillset(root)).rejects.toThrow("is not emitted for");
  }
});

test("SET-34: plugin aggregate hashes consume child content hashes before versions", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: aggregate-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 0.1.0
`,
    ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
version: 0.1.0
---

Plugin body.
`,
  });
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md"),
    "---\nname: plugin-skill\ndescription: Plugin skill.\nversion: 0.1.0\n---\n\nChanged plugin body.\n"
  );

  const report = await changeStatus(root, { since: "HEAD" });
  expect(report.sourceChanges.map((change) => change.id)).toEqual(
    expect.arrayContaining(["plugin.alpha.skill:plugin-skill", "plugin:alpha"])
  );
});

test("SET-34: partial dependencies participate in source status hashes", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: partial-status-root
claude: true
codex: false
`,
    ".skillset/shared/common.md": `
Shared partial.
`,
    ".skillset/instructions/root.md": `
# Root

{{> shared:common.md}}
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

{{> shared:common.md}}
`,
  });
  await buildSkillset(root);
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/shared/common.md"), "Changed partial.\n");

  const report = await changeStatus(root, { since: "HEAD" });
  const changedIds = report.sourceChanges.map((change) => change.id);
  expect(changedIds).toContain("instruction:root");
  expect(changedIds).toContain("skill:demo");
  const instruction = report.sourceUnits.find((unit) => unit.id === "instruction:root");
  expect(instruction?.sourcePaths).toContain(".skillset/shared/common.md");
  expect(report.generatedDrift.changed).toContain(".claude/rules/root.md");
  expect(report.generatedDrift.changed).toContain(".claude/skills/demo/SKILL.md");
});

test("SET-35: change check fails when source changes lack pending entries", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: missing-change-root
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
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nChanged body.\n"
  );

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("change-uncovered");
  expect(checked.stdout).toContain("skill: demo");
});

test("SET-35: valid pending entries cover multiple scopes with group and ignored metadata", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: valid-change-root
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
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/skills/one/SKILL.md"), "---\nname: one\ndescription: One.\n---\n\nOne changed.\n");
  await Bun.write(join(root, ".skillset/skills/two/SKILL.md"), "---\nname: two\ndescription: Two.\n---\n\nTwo changed.\n");
  const report = await changeStatus(root, { since: "HEAD" });
  const one = report.sourceChanges.find((change) => change.id === "skill:one");
  const two = report.sourceChanges.find((change) => change.id === "skill:two");
  expect(one?.currentHash).toBeDefined();
  expect(two?.currentHash).toBeDefined();

  await writePendingChange(root, "combined.md", `
---
id: abcdef123456
bump: none
ignored: true
group:
  provider: linear
  id: SET-35
scopes:
  - skill:one
  - skill:two
evidence:
  - scope: skill:one
    currentHash: ${one?.currentHash}
  - scope: skill:two
    currentHash: ${two?.currentHash}
---

Grouped documentation-only edits are intentionally ignored for release planning while preserving an audit reason.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("change check passed");
});

test("SET-35: change check rejects invalid pending entry shape, reason, and evidence", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: invalid-change-root
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
  await commitFixture(root);

  await writePendingChange(root, "invalid.md", `
---
id: not-hex
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: sha256:stale
group:
  provider: linear
external:
  linear: SET-35
---

TODO
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("change-id-invalid");
  expect(checked.stdout).toContain("change-bump-missing");
  expect(checked.stdout).toContain("change-external-unsupported");
  expect(checked.stdout).toContain("change-group-invalid");
  expect(checked.stdout).toContain("change-reason-placeholder");
  expect(checked.stdout).toContain("change-evidence-stale");
});

test("SET-35: duplicate pending change ids fail full check", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: duplicate-change-root
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
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nChanged body.\n");
  const report = await changeStatus(root, { since: "HEAD" });
  const demo = report.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();

  for (const filename of ["one.md", "two.md"]) {
    await writePendingChange(root, filename, `
---
id: abcdef123456
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

This pending entry intentionally duplicates an id so the checker can reject unstable refs.
`);
  }

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("change-id-duplicate");
});

test("SET-35: bump warnings include removed severity-bearing regions", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: severity-removal-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
dependencies:
  plugins:
    - acme-docs
---

Body.
`,
  });
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n");
  const report = await changeStatus(root, { since: "HEAD" });
  const demo = report.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();
  expect(demo?.baselineRegions).toContainEqual({ name: "dependencies", severityBearing: true });

  await writePendingChange(root, "dependency-removal.md", `
---
id: abcdef123456
bump: none
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

The dependency was removed from the skill and should still be visible as release-relevant setup drift.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("change-bump-lower-than-suggested");
  expect(checked.stdout).toContain("1 warning");
});

test("SET-35: ambiguous change refs fail with candidates", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: ambiguous-change-root
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
  await commitFixture(root);
  const report = await changeStatus(root, { since: "HEAD" });
  const demo = report.sourceUnits.find((unit) => unit.id === "skill:demo");
  expect(demo?.hash).toBeDefined();

  for (const id of ["abcdef111111", "abcdef222222"]) {
    await writePendingChange(root, `${id}.md`, `
---
id: ${id}
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.hash}
---

This pending entry exists only to exercise ambiguous short ref resolution in the CLI.
`);
  }

  const checked = await runSkillsetCli("change", "check", "@abcdef", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(1);
  expect(checked.stderr).toContain("ambiguous change ref @abcdef");
  expect(checked.stderr).toContain("@abcdef111111");
  expect(checked.stderr).toContain("@abcdef222222");

  const tooShort = await runSkillsetCli("change", "check", "@abcde", "--root", root, "--since", "HEAD");
  expect(tooShort.exitCode).toBe(1);
  expect(tooShort.stderr).toContain("at least 6 hex characters");
});

test("SET-36: change add writes a pending entry from reason-file and exposes list/show/check", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: change-add-root
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
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nChanged body.\n");
  const reasonPath = join(root, "reason.md");
  await writeFile(reasonPath, "Clarified the demo skill behavior and documented why this source edit needs a patch entry.\n", "utf8");

  const added = await runSkillsetCli(
    "change",
    "add",
    "--root",
    root,
    "--since",
    "HEAD",
    "--scope",
    "skill:demo",
    "--bump",
    "patch",
    "--group",
    "linear:SET-36",
    "--reason-file",
    reasonPath
  );
  expect(added.exitCode).toBe(0);
  const ref = extractChangeRef(added.stdout);
  expect(added.stdout).toContain("skill: demo");

  const list = await runSkillsetCli("change", "list", "--root", root, "--group", "linear:SET-36");
  expect(list.exitCode).toBe(0);
  expect(list.stdout).toContain(ref);
  expect(list.stdout).toContain("linear:SET-36");
  expect(list.stdout).toContain("skill: demo");

  const show = await runSkillsetCli("change", "show", ref, "--root", root);
  expect(show.exitCode).toBe(0);
  expect(show.stdout).toContain("Clarified the demo skill behavior");
  expect(show.stdout).toContain("group: linear:SET-36");
  expect(show.stdout).toContain("source hash:");

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
});

test("SET-36: change reason appends stdin without changing the generated id", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: change-reason-root
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
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nChanged body.\n");
  const added = await runSkillsetCli(
    "change",
    "add",
    "--root",
    root,
    "--since",
    "HEAD",
    "--scope",
    "skill:demo",
    "--bump",
    "patch",
    "--reason",
    "Initial reason describing the source change with enough detail to pass validation."
  );
  expect(added.exitCode).toBe(0);
  const ref = extractChangeRef(added.stdout);
  const id = ref.slice(1);

  const updated = await runSkillsetCliWithInput(
    "Also documented the fallback build path for non-interactive agent workflows.\n",
    "change",
    "reason",
    ref,
    "--root",
    root,
    "--append",
    "--reason",
    "-"
  );
  expect(updated.exitCode).toBe(0);
  expect(updated.stdout).toContain(ref);

  const show = await runSkillsetCli("change", "show", ref, "--root", root);
  expect(show.exitCode).toBe(0);
  expect(show.stdout).toContain("Initial reason describing");
  expect(show.stdout).toContain("Also documented the fallback build path");

  const files = await readdir(join(root, ".skillset/changes/pending"));
  expect(files).toHaveLength(1);
  const pending = await readFile(join(root, ".skillset/changes/pending", files[0] ?? ""), "utf8");
  expect(pending).toMatch(new RegExp(`id: "?${id}`));
});

test("SET-36: change show prefers pending refs and history reads applied records", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: change-history-root
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
  await writePendingChange(root, "abcdef123456.md", `
---
id: abcdef123456
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    sourceHash: sha256:pending
---

Pending reason wins when the same ref also exists in applied history.
`);
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/history.jsonl"),
    [
      JSON.stringify({
        id: "abcdef123456",
        bump: "minor",
        scope: "skill:demo",
        reason: "Applied record with the same id should not win change show.",
        evidence: [{ scope: "skill:demo", sourceHash: "sha256:history" }],
      }),
      JSON.stringify({
        id: "123456abcdef",
        bump: "patch",
        scope: "skill:demo",
        reason: "Applied history remains inspectable through the history command.",
        evidence: [{ scope: "skill:demo", sourceHash: "sha256:applied" }],
      }),
    ].join("\n") + "\n",
    "utf8"
  );

  const show = await runSkillsetCli("change", "show", "@abcdef", "--root", root);
  expect(show.exitCode).toBe(0);
  expect(show.stdout).toContain("status: pending");
  expect(show.stdout).toContain("Pending reason wins");
  expect(show.stdout).not.toContain("Applied record with the same id");

  const history = await runSkillsetCli("change", "history", "@123456", "--root", root);
  expect(history.exitCode).toBe(0);
  expect(history.stdout).toContain("status: history");
  expect(history.stdout).toContain("Applied history remains inspectable");

  const pendingHistory = await runSkillsetCli("change", "history", "@abcdef", "--root", root);
  expect(pendingHistory.exitCode).toBe(1);
  expect(pendingHistory.stderr).toContain("is pending; no applied history entry");
});

test("SET-36: pending and history refs are ambiguous across stores", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: cross-store-ref-root
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
  await writePendingChange(root, "abcdef111111.md", `
---
id: abcdef111111
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    sourceHash: sha256:pending
---

Pending entry has a colliding prefix with an applied history entry.
`);
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/history.jsonl"),
    `${JSON.stringify({
      id: "abcdef222222",
      bump: "patch",
      scope: "skill:demo",
      reason: "History entry has a colliding prefix with a pending entry.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:history" }],
    })}\n`,
    "utf8"
  );

  const show = await runSkillsetCli("change", "show", "@abcdef", "--root", root);
  expect(show.exitCode).toBe(1);
  expect(show.stderr).toContain("ambiguous change ref @abcdef");
  expect(show.stderr).toContain("@abcdef1");
  expect(show.stderr).toContain("@abcdef2");

  const history = await runSkillsetCli("change", "history", "@abcdef", "--root", root);
  expect(history.exitCode).toBe(1);
  expect(history.stderr).toContain("ambiguous change ref @abcdef");
});

test("SET-37: applied history generates standalone changelog projections without pending churn", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: changelog-root
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
  await mkdir(join(root, ".skillset/changes/pending"), { recursive: true });
  await writePendingChange(root, "abcdef123456.md", `
---
id: abcdef123456
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    sourceHash: sha256:pending
---

Pending changes stay out of committed changelog projections.
`);
  await writeHistory(root, [
    {
      id: "111111aaaaaa",
      bump: "patch",
      scope: "skill:demo",
      reason: "Clarified the standalone skill behavior for applied history.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:one" }],
    },
    {
      id: "222222bbbbbb",
      bump: "none",
      scope: "skill:demo",
      reason: "Recorded an audit-only correction that should still appear in history.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:two" }],
    },
  ]);

  await buildSkillset(root);
  const changelog = await readFile(join(root, ".skillset/skills/demo/CHANGELOG.md"), "utf8");
  expect(changelog).toContain("generated: skillset@0.1.0");
  expect(changelog).toContain("## 222222bbbbbb");
  expect(changelog).toContain("bump: none");
  expect(changelog).toContain("## 111111aaaaaa");
  expect(changelog.indexOf("222222bbbbbb")).toBeLessThan(changelog.indexOf("111111aaaaaa"));
  expect(changelog).not.toContain("Pending changes stay out");

  const diff = await runSkillsetCli("diff", "--root", root);
  expect(diff.exitCode).toBe(0);
  expect(diff.stdout).toContain("no generated changes");

  const lock = await readFile(join(root, ".skillset.lock"), "utf8");
  expect(lock).toContain(`"kind": "changelog"`);
  expect(lock).toContain(`".skillset/skills/demo/CHANGELOG.md"`);
});

test("SET-37: plugin changelog aggregates child skill applied records", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: plugin-changelog-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 0.1.0
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });
  await writeHistory(root, [
    {
      id: "333333cccccc",
      bump: "minor",
      scope: "plugin.alpha.skill:demo",
      reason: "Updated the plugin child skill and projected it into the plugin changelog.",
      evidence: [{ scope: "plugin.alpha.skill:demo", sourceHash: "sha256:child" }],
    },
  ]);

  await buildSkillset(root);
  const pluginChangelog = await readFile(join(root, ".skillset/plugins/alpha/CHANGELOG.md"), "utf8");
  expect(pluginChangelog).toContain("target: plugin:alpha");
  expect(pluginChangelog).toContain("## 333333cccccc");
  expect(pluginChangelog).toContain("scopes: skill(plugin:alpha): demo");
  expect(pluginChangelog).toContain("Updated the plugin child skill");
});

test("SET-53: legacy source-unit scopes are rejected", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: legacy-selector-rejection-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 0.1.0
---

Original body.
`,
  });
  await commitFixture(root);
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\nversion: 0.1.0\n---\n\nChanged body.\n"
  );
  const status = await changeStatus(root);
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();
  await writePendingChange(root, "legacy.md", `
---
id: 222222bbbbbb
bump: patch
scope: standalone-skill:demo
evidence:
  - scope: standalone-skill:demo
    currentHash: ${demo?.currentHash}
---

Legacy pending scope syntax should fail because Skillset is pre-public and has cut over to canonical selectors.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root);
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("scope standalone-skill:demo does not match a known source unit");

  const added = await runSkillsetCli(
    "change",
    "add",
    "--root",
    root,
    "--scope",
    "standalone-skill:demo",
    "--bump",
    "patch",
    "--reason",
    "Old source-unit identifiers should be rejected instead of translated after the pre-public clean cutover."
  );
  expect(added.exitCode).toBe(1);
  expect(added.stderr).toContain("unknown change scope standalone-skill:demo");
});

test("SET-37: generated changelogs do not perturb source inventory hashes", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: changelog-inventory-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Standalone body.
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 0.1.0
`,
    ".skillset/plugins/alpha/skills/child/SKILL.md": `
---
name: child
description: Child.
---

Plugin child body.
`,
  });
  await writeHistory(root, [
    {
      id: "444444dddddd",
      bump: "patch",
      scope: "skill:demo",
      reason: "Applied standalone skill change.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:standalone" }],
    },
    {
      id: "555555eeeeee",
      bump: "minor",
      scope: "plugin.alpha.skill:child",
      reason: "Applied plugin child skill change.",
      evidence: [{ scope: "plugin.alpha.skill:child", sourceHash: "sha256:child" }],
    },
  ]);

  const before = await collectSourceInventory(root);
  await buildSkillset(root);
  const after = await collectSourceInventory(root);

  for (const id of ["skill:demo", "plugin.alpha.skill:child", "plugin:alpha"]) {
    expect(sourceInventoryUnit(after, id)).toEqual(sourceInventoryUnit(before, id));
  }
});

test("SET-38: release apply creates state, history, changelog, and generated versions", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: release-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 0.1.0
---

Body.
`,
  });
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\nversion: 0.1.0\n---\n\nChanged body.\n"
  );
  const status = await changeStatus(root, { since: "HEAD" });
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();
  await writePendingChange(root, "demo.md", `
---
id: aaaabbbbcccc
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Release the standalone skill body update with a patch version and generated changelog entry.
`);

  const plan = await runSkillsetCli("release", "plan", "--root", root);
  expect(plan.exitCode).toBe(0);
  expect(plan.stdout).toContain("@aaaabb pending patch skill: demo");
  expect(plan.stdout).toContain("skill: demo: 0.1.0 -> 0.1.1 (patch)");
  expect(await Bun.file(join(root, ".skillset/changes/state.json")).exists()).toBe(false);

  const dryRun = await runSkillsetCli("release", "apply", "--dry-run", "--root", root);
  expect(dryRun.exitCode).toBe(0);
  expect(dryRun.stdout).toContain("dry run wrote no files");
  expect(await Bun.file(join(root, ".skillset/changes/state.json")).exists()).toBe(false);

  const applied = await runSkillsetCli("release", "apply", "--yes", "--root", root);
  expect(applied.exitCode).toBe(0);
  expect(applied.stdout).toContain("skillset: applied release");
  expect(await Bun.file(join(root, ".skillset/changes/pending/demo.md")).exists()).toBe(false);

  const state = JSON.parse(await readFile(join(root, ".skillset/changes/state.json"), "utf8")) as {
    scopes: Record<string, { version: string; sourceHash: string }>;
  };
  expect(state.scopes["skill:demo"]?.version).toBe("0.1.1");
  expect(state.scopes["skill:demo"]?.sourceHash).toBe(demo?.currentHash);
  const history = await readFile(join(root, ".skillset/changes/history.jsonl"), "utf8");
  expect(history).toContain("aaaabbbbcccc");
  const releases = await readFile(join(root, ".skillset/changes/releases.jsonl"), "utf8");
  expect(releases).toContain("skill:demo");
  const changelog = await readFile(join(root, ".skillset/skills/demo/CHANGELOG.md"), "utf8");
  expect(changelog).toContain("## aaaabbbbcccc");
  const generatedSkill = await readFile(join(root, ".claude/skills/demo/SKILL.md"), "utf8");
  expect(generatedSkill).toContain("version: 0.1.1");

  const second = await runSkillsetCli("release", "apply", "--yes", "--root", root);
  expect(second.exitCode).toBe(0);
  expect(second.stdout).toContain("no pending changes to release");
  expect(await readFile(join(root, ".skillset/changes/history.jsonl"), "utf8")).toBe(history);

  const releasedStatus = await changeStatus(root);
  expect(releasedStatus.sourceChanges.map((change) => change.id)).not.toContain("skill:demo");
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", "release demo");
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\nversion: 0.1.0\n---\n\nChanged again after release.\n"
  );
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", "unreleased demo change");
  const unreleasedStatus = await changeStatus(root);
  expect(unreleasedStatus.sourceChanges.map((change) => change.id)).toContain("skill:demo");
});

test("SET-111: release audit reports generated version drift without writing", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: version-audit-root
compile:
  targets: [codex]
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 1.2.3
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
  const clean = await runSkillsetCli("release", "audit", "--root", root);
  expect(clean.exitCode).toBe(0);
  expect(clean.stdout).toContain("skillset: version audit passed");
  expect(clean.stdout).toContain("in-sync: [codex] plugin:alpha");
  expect(clean.stdout).toContain("expected 1.2.3");

  const manifestPath = join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json");
  await rm(manifestPath);
  const missing = await runSkillsetCli("release", "audit", "--root", root);
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout).toContain("missing: [codex] plugin:alpha");

  await buildSkillset(root);
  await writeFile(manifestPath, "{ nope\n", "utf8");
  const malformed = await runSkillsetCli("release", "audit", "--root", root);
  expect(malformed.exitCode).toBe(1);
  expect(malformed.stdout).toContain("malformed: [codex] plugin:alpha");

  await buildSkillset(root);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.version = "9.9.9";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const drift = await runSkillsetCli("release", "audit", "--root", root);
  expect(drift.exitCode).toBe(1);
  expect(drift.stdout).toContain("stale-generated: [codex] plugin:alpha");
  expect(drift.stdout).toContain("actual 9.9.9 expected 1.2.3");
  expect(await readFile(manifestPath, "utf8")).toContain(`"version": "9.9.9"`);

  const yesFlag = await runSkillsetCli("release", "audit", "--yes", "--root", root);
  expect(yesFlag.exitCode).toBe(1);
  expect(yesFlag.stderr).toContain("--yes and --dry-run are only supported with release apply");

  const dryRun = await runSkillsetCli("release", "audit", "--dry-run", "--root", root);
  expect(dryRun.exitCode).toBe(1);
  expect(dryRun.stderr).toContain("--yes and --dry-run are only supported with release apply");
});

test("SET-111: release audit reports Claude marketplace plugin version drift", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: marketplace-audit-root
compile:
  targets: [claude]
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 1.2.3
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
  const marketplacePath = join(root, "plugins-claude/.claude-plugin/marketplace.json");
  const clean = await runSkillsetCli("release", "audit", "--root", root);
  expect(clean.exitCode).toBe(0);
  expect(clean.stdout).toContain("in-sync: [claude] plugin:alpha");
  expect(clean.stdout).toContain("plugins.alpha.version");

  const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
    plugins: Array<{ name: string; version: string }>;
  };
  const [pluginEntry] = marketplace.plugins;
  if (pluginEntry === undefined) throw new Error("expected marketplace plugin entry");
  marketplace.plugins[0] = { ...pluginEntry, version: "9.9.9" };
  await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");

  const drift = await runSkillsetCli("release", "audit", "--root", root);
  expect(drift.exitCode).toBe(1);
  expect(drift.stdout).toContain("stale-generated: [claude] plugin:alpha");
  expect(drift.stdout).toContain("plugins.alpha.version actual 9.9.9 expected 1.2.3");
});

test("SET-38: plugin child release bumps the plugin aggregate by default", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: plugin-release-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 0.1.0
`,
    ".skillset/plugins/alpha/skills/child/SKILL.md": `
---
name: child
description: Child.
---

Child body.
`,
  });
  await commitFixture(root);

  await Bun.write(
    join(root, ".skillset/plugins/alpha/skills/child/SKILL.md"),
    "---\nname: child\ndescription: Child.\n---\n\nChanged child body.\n"
  );
  const status = await changeStatus(root, { since: "HEAD" });
  const child = status.sourceChanges.find((change) => change.id === "plugin.alpha.skill:child");
  expect(child?.currentHash).toBeDefined();
  await writePendingChange(root, "child.md", `
---
id: dddd11112222
bump: minor
scope: plugin.alpha.skill:child
evidence:
  - scope: plugin.alpha.skill:child
    currentHash: ${child?.currentHash}
---

Release the plugin child skill behavior as a minor update to the containing plugin.
`);

  const plan = await runSkillsetCli("release", "plan", "--root", root);
  expect(plan.exitCode).toBe(0);
  expect(plan.stdout).toContain("skill(plugin:alpha): child: 0.1.0 -> 0.2.0 (minor)");
  expect(plan.stdout).toContain("plugin: alpha: 0.1.0 -> 0.2.0 (minor)");

  const applied = await runSkillsetCli("release", "apply", "--yes", "--root", root);
  expect(applied.exitCode).toBe(0);
  const state = JSON.parse(await readFile(join(root, ".skillset/changes/state.json"), "utf8")) as {
    scopes: Record<string, { version: string }>;
  };
  expect(state.scopes["plugin.alpha.skill:child"]?.version).toBe("0.2.0");
  expect(state.scopes["plugin:alpha"]?.version).toBe("0.2.0");
  expect(await readFile(join(root, ".skillset/plugins/alpha/CHANGELOG.md"), "utf8")).toContain("## dddd11112222");
  expect(await readFile(join(root, "plugins-claude/plugins/alpha/.claude-plugin/plugin.json"), "utf8")).toContain('"version": "0.2.0"');
  expect(await readFile(join(root, "plugins-claude/plugins/alpha/skills/child/SKILL.md"), "utf8")).toContain("version: 0.2.0");
});

test("SET-38: bump none releases audit entries while ignored entries stay out of changelogs", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: audit-release-root
claude: true
codex: false
`,
    ".skillset/skills/audit/SKILL.md": `
---
name: audit
description: Audit.
version: 0.1.0
---

Audit body.
`,
    ".skillset/skills/ignored/SKILL.md": `
---
name: ignored
description: Ignored.
version: 0.1.0
---

Ignored body.
`,
  });
  await commitFixture(root);

  await Bun.write(join(root, ".skillset/skills/audit/SKILL.md"), "---\nname: audit\ndescription: Audit.\nversion: 0.1.0\n---\n\nAudit-only change.\n");
  await Bun.write(join(root, ".skillset/skills/ignored/SKILL.md"), "---\nname: ignored\ndescription: Ignored.\nversion: 0.1.0\n---\n\nIgnored change.\n");
  const status = await changeStatus(root, { since: "HEAD" });
  const audit = status.sourceChanges.find((change) => change.id === "skill:audit");
  const ignored = status.sourceChanges.find((change) => change.id === "skill:ignored");
  expect(audit?.currentHash).toBeDefined();
  expect(ignored?.currentHash).toBeDefined();
  await writePendingChange(root, "audit.md", `
---
id: 333333ffffff
bump: none
scope: skill:audit
evidence:
  - scope: skill:audit
    currentHash: ${audit?.currentHash}
---

Record the audit-only source correction without changing the published semantic version.
`);
  await writePendingChange(root, "ignored.md", `
---
id: 444444ffffff
bump: patch
ignored: true
scope: skill:ignored
evidence:
  - scope: skill:ignored
    currentHash: ${ignored?.currentHash}
---

Preserve this ignored audit reason in history while keeping it out of release planning.
`);

  const plan = await runSkillsetCli("release", "plan", "--root", root);
  expect(plan.exitCode).toBe(0);
  expect(plan.stdout).toContain("@333333 pending none skill: audit");
  expect(plan.stdout).toContain("@444444 ignored patch skill: ignored");
  expect(plan.stdout).toContain("skill: audit: 0.1.0 -> 0.1.0 (none)");
  expect(plan.stdout).not.toContain("skill: ignored: 0.1.0 -> 0.1.1");

  const applied = await runSkillsetCli("release", "apply", "--yes", "--root", root);
  expect(applied.exitCode).toBe(0);
  const history = await readFile(join(root, ".skillset/changes/history.jsonl"), "utf8");
  expect(history).toContain("333333ffffff");
  expect(history).toContain("444444ffffff");
  const state = JSON.parse(await readFile(join(root, ".skillset/changes/state.json"), "utf8")) as {
    scopes: Record<string, { sourceHash?: string; version: string }>;
  };
  expect(state.scopes["skill:audit"]?.version).toBe("0.1.0");
  expect(state.scopes["skill:ignored"]?.version).toBe("0.1.0");
  expect(state.scopes["skill:ignored"]?.sourceHash).toBe(ignored?.currentHash);
  expect(await readFile(join(root, ".skillset/skills/audit/CHANGELOG.md"), "utf8")).toContain("## 333333ffffff");
  expect(await Bun.file(join(root, ".skillset/skills/ignored/CHANGELOG.md")).exists()).toBe(false);

  const releasedStatus = await changeStatus(root);
  expect(releasedStatus.sourceChanges.map((change) => change.id)).not.toContain("skill:ignored");
});

test("SET-38: release apply tombstones deleted source units as released", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: deletion-release-root
claude: true
codex: false
`,
    ".skillset/skills/deleted/SKILL.md": `
---
name: deleted
description: Deleted.
version: 1.2.3
---

Deleted body.
`,
    ".skillset/skills/kept/SKILL.md": `
---
name: kept
description: Kept.
version: 0.1.0
---

Kept body.
`,
  });
  await commitFixture(root);
  const initialInventory = await collectSourceInventory(root);
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(join(root, ".skillset/changes/state.json"), JSON.stringify({
    schemaVersion: 1,
    scopes: {
      "skill:deleted": {
        sourceHash: sourceInventoryUnit(initialInventory, "skill:deleted").hash,
        version: "1.2.3",
      },
    },
  }, null, 2), "utf8");

  await rm(join(root, ".skillset/skills/deleted/SKILL.md"));
  const status = await changeStatus(root, { since: "HEAD" });
  const deleted = status.sourceChanges.find((change) => change.id === "skill:deleted");
  expect(deleted?.baselineHash).toBeDefined();
  expect(deleted?.status).toBe("removed");
  await writePendingChange(root, "deleted.md", `
---
id: 777777ffffff
bump: patch
scope: skill:deleted
evidence:
  - scope: skill:deleted
    sourceHash: ${deleted?.baselineHash}
---

Release the removal of the deleted standalone skill so default status treats the missing source as intentional.
`);

  const applied = await runSkillsetCli("release", "apply", "--yes", "--root", root);
  expect(applied.exitCode).toBe(0);
  const state = JSON.parse(await readFile(join(root, ".skillset/changes/state.json"), "utf8")) as {
    scopes: Record<string, { removed?: boolean; version: string }>;
  };
  expect(state.scopes["skill:deleted"]?.removed).toBe(true);
  expect(state.scopes["skill:deleted"]?.version).toBe("1.2.4");

  const releasedStatus = await changeStatus(root);
  expect(releasedStatus.sourceChanges.map((change) => change.id)).not.toContain("skill:deleted");

  await Bun.write(
    join(root, ".skillset/skills/deleted/SKILL.md"),
    "---\nname: deleted\ndescription: Deleted.\nversion: 1.2.3\n---\n\nRestored body.\n"
  );
  await buildSkillset(root);
  const restoredSkill = await readFile(join(root, ".claude/skills/deleted/SKILL.md"), "utf8");
  expect(restoredSkill).toContain("version: 1.2.3");
});

test("SET-38: release commands reject build scopes until scoped release selection exists", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: scoped-release-root
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

  const scoped = await runSkillsetCli("release", "apply", "--yes", "--scope", "plugins", "--root", root);
  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("--scope is not supported with release commands yet");
});

test("SET-38: plugin feature history projects into plugin changelogs", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: feature-changelog-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 0.1.0
`,
    ".skillset/plugins/alpha/.mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
  });
  await writeHistory(root, [
    {
      id: "666666ffffff",
      bump: "patch",
      scope: "plugin.alpha.feature:mcp",
      reason: "Released the plugin MCP server definition so setup requirements appear in the plugin changelog.",
      evidence: [{ scope: "plugin.alpha.feature:mcp", sourceHash: "sha256:feature" }],
    },
  ]);

  await buildSkillset(root);
  const changelog = await readFile(join(root, ".skillset/plugins/alpha/CHANGELOG.md"), "utf8");
  expect(changelog).toContain("## 666666ffffff");
  expect(changelog).toContain("feature(plugin:alpha): mcp");
});

test("SET-38: malformed release state fails loudly before version lowering", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: invalid-release-state-root
claude: true
codex: false
`,
    ".skillset/changes/state.json": `
{
  "schemaVersion": 1,
  "scopes": {
    "skill:demo": { "version": "next" }
  }
}
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const checked = await runSkillsetCli("check", "--root", root);
  expect(checked.exitCode).toBe(1);
  expect(checked.stderr).toContain("release state scope skill:demo.version");
  expect(checked.stderr).toContain("semantic version");
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

test("SET-19: CLI restores backed up unmanaged output collisions", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: restore-root
claude: false
codex: true
`,
    ".skillset/instructions/root.md": `
# Generated Instructions
`,
    "AGENTS.md": `
# Existing Instructions
`,
	  });

	  const previewBuild = await runSkillsetCli("build", "--root", root);
	  expect(previewBuild.exitCode).toBe(0);
	  expect(previewBuild.stderr).toContain("existing file is not owned by Skillset");
	  expect(previewBuild.stderr).toContain("will be backed up");
	  expect(previewBuild.stdout).toContain("rerun with --yes");
	  expect(await Bun.file(join(root, ".skillset/build/backups")).exists()).toBe(false);
	  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Existing Instructions");

	  const build = await runSkillsetCli("build", "--root", root, "--yes");
	  expect(build.exitCode).toBe(0);
	  expect(build.stderr).toContain("existing file is not owned by Skillset");
  const backupId = extractBackupId(build.stderr);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Generated Instructions");

  const preview = await runSkillsetCli("restore", backupId, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("restore preview 1 file");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Generated Instructions");

  const restored = await runSkillsetCli("restore", backupId, "--root", root, "--yes");
  expect(restored.exitCode).toBe(0);
  expect(restored.stdout).toContain("restored 1 file");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Existing Instructions");
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

test("SET-27: init detects marketplace plugin sources as import candidates", async () => {
  const root = await contractFixture({
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "demo-marketplace",
      plugins: [
        { name: "alpha", source: "./plugins/alpha" },
        { name: "beta", source: "plugins/beta" },
        { name: "escape", source: "../outside" },
        { name: "missing", source: "./plugins/missing" },
        { name: "self", source: "." },
      ],
    }),
    "plugins/alpha/.claude-plugin/plugin.json": JSON.stringify({ name: "alpha" }),
    "plugins/beta/.claude-plugin/plugin.json": JSON.stringify({ name: "beta" }),
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([
    { kind: "plugin", path: "plugins/alpha" },
    { kind: "plugin", path: "plugins/beta" },
  ]);
});

test("SET-27: init ignores malformed marketplace manifests", async () => {
  const root = await contractFixture({
    ".claude-plugin/marketplace.json": "not json {",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([]);
});

test("SET-62: init detects nested plugins without a marketplace manifest", async () => {
  const root = await contractFixture({
    "plugins/alpha/.claude-plugin/plugin.json": JSON.stringify({ name: "alpha" }),
    "plugins/beta/.codex-plugin/plugin.json": JSON.stringify({ name: "beta" }),
    "plugins/managed/.claude-plugin/plugin.json": JSON.stringify({ name: "managed" }),
    "plugins/managed/.skillset.lock": "{}",
    "plugins/not-a-plugin/README.md": "no manifest here",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([
    { kind: "plugin", path: "plugins/alpha" },
    { kind: "plugin", path: "plugins/beta" },
  ]);
});

test("SET-62: nested plugin scan dedupes marketplace sources and guards containment", async () => {
  const root = await contractFixture({
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "demo-marketplace",
      plugins: [{ name: "alpha", source: "./plugins/alpha" }],
    }),
    "plugins/alpha/.claude-plugin/plugin.json": JSON.stringify({ name: "alpha" }),
  });
  const outside = await mkdtemp(join(tmpdir(), "skillset-contract-outside-"));
  await Bun.write(join(outside, ".claude-plugin/plugin.json"), JSON.stringify({ name: "escape" }));
  await symlink(outside, join(root, "plugins/escape"), "dir");

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  // alpha appears once despite being found by both the marketplace manifest
  // and the nested scan; the symlink escaping the repo is not a candidate.
  expect(report.importCandidates).toEqual([{ kind: "plugin", path: "plugins/alpha" }]);
});

test("SET-62: init surfaces handwritten root instruction files as candidates", async () => {
  const root = await contractFixture({
    "AGENTS.md": "# Agents\n\nHandwritten guidance.",
    "CLAUDE.md": "# Claude\n\nHandwritten guidance.",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([
    { kind: "instructions", path: "AGENTS.md" },
    { kind: "instructions", path: "CLAUDE.md" },
  ]);
});

test("SET-62: init never suggests importing skillset-generated instruction files", async () => {
  const root = await contractFixture({
    "AGENTS.md":
      "<!-- Generated by skillset@0.1.0 from .skillset/instructions. Do not edit directly. -->\n\n# Agents",
    "CLAUDE.md": "# Claude\n\nHandwritten guidance.",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([{ kind: "instructions", path: "CLAUDE.md" }]);
});

test("SET-62: already-adopted repos suppress instruction candidates", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: adopted
compile:
  targets:
    - claude
`,
    "AGENTS.md": "# Agents\n\nHandwritten guidance.",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([]);
});

test("SET-62: recognized-but-unimportable surfaces become structured survey skips", async () => {
  const root = await contractFixture({
    ".claude/commands/release.md": "Run the release.",
    ".cursor-plugin/plugin.json": JSON.stringify({ name: "foreign" }),
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([]);
  expect(report.surveySkips).toEqual([
    {
      path: ".claude/commands",
      reason:
        "project-level commands have no portable source home yet; adopt will lower them to target-native islands in the transform milestone",
      surface: "commands",
    },
    {
      path: ".cursor-plugin",
      reason:
        "plugin manifest for an unsupported target; skillset can only represent claude and codex surfaces",
      surface: "foreign-manifest",
    },
  ]);
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

test("SET-27: init scaffolds optional includes only when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-shaped-"));

  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(root, ".skillset/src/agents/.gitkeep"))).toBe(false);
  expect(await fileExists(join(root, ".github/workflows/skillset-ci.yml"))).toBe(false);

  const shaped = await mkdtemp(join(tmpdir(), "skillset-setup-shaped-"));
  await expect(
    runSkillsetCli("init", "--root", shaped, "--include", "agents,ci", "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(shaped, ".skillset/src/agents/.gitkeep"))).toBe(true);
  expect(await fileExists(join(shaped, ".github/workflows/skillset-ci.yml"))).toBe(true);
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
  expect(init.stderr).toContain("unsupported top-level key not");
});

test("SET-43: init defaults to git root and seeds release baselines", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: adopt-root
  version: 1.2.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 2.3.4
---

Body.
`,
    "nested/.gitkeep": "",
  });
  await commitFixture(root);

  const initialized = await runSkillsetCliIn(join(root, "nested"), "init", "--yes");
  expect(initialized.exitCode).toBe(0);
  expect(initialized.stdout).toContain(`root: ${await realpath(root)}`);
  expect(initialized.stdout).toContain("+ baseline config: root 1.2.0");
  expect(initialized.stdout).toContain("+ baseline skill: demo 2.3.4");

  const inventory = await collectSourceInventory(root);
  const state = await readReleaseState(root);
  expect(state.scopes["config:root"]?.version).toBe("1.2.0");
  expect(state.scopes["config:root"]?.sourceHash).toBe(sourceInventoryUnit(inventory, "config:root").hash);
  expect(state.scopes["skill:demo"]?.version).toBe("2.3.4");
  expect(state.scopes["skill:demo"]?.sourceHash).toBe(sourceInventoryUnit(inventory, "skill:demo").hash);
  expect(await fileExists(join(root, ".skillset/changes/history.jsonl"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/changes/releases.jsonl"))).toBe(false);
});

test("SET-43: init is idempotent for adopted release baselines", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: adopt-idempotent
  version: 0.4.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 0.5.0
---

Body.
`,
  });

  const first = await runSkillsetCli("init", "--root", root, "--yes");
  expect(first.exitCode).toBe(0);
  const firstState = await readFile(join(root, ".skillset/changes/state.json"), "utf8");

  const second = await runSkillsetCli("init", "--root", root, "--yes");
  expect(second.exitCode).toBe(0);
  expect(second.stdout).toContain("= baseline config: root 0.4.0");
  expect(second.stdout).toContain("= baseline skill: demo 0.5.0");
  await expect(readFile(join(root, ".skillset/changes/state.json"), "utf8")).resolves.toBe(firstState);
});

test("SET-43: init treats hashed release state as authoritative", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: adopt-released
  version: 0.4.0
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 0.5.0
---

Body.
`,
  });

  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  const statePath = join(root, ".skillset/changes/state.json");
  const releasedState = JSON.parse(await readFile(statePath, "utf8")) as {
    scopes: Record<string, { version: string }>;
  };
  releasedState.scopes["skill:demo"]!.version = "0.6.0";
  await writeFile(statePath, `${JSON.stringify(releasedState, null, 2)}\n`, "utf8");

  const initialized = await runSkillsetCli("init", "--root", root, "--yes");
  expect(initialized.exitCode).toBe(0);
  expect(initialized.stdout).toContain("= baseline skill: demo 0.6.0");
  await expect(readFile(statePath, "utf8")).resolves.toBe(`${JSON.stringify(releasedState, null, 2)}\n`);
});

test("SET-43: init reports repo-local import candidates", async () => {
  const root = await contractFixture({
    ".claude/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const preview = await runSkillsetCli("init", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("? import candidate skills .claude/skills");
  expect(await fileExists(join(root, ".skillset/config.yaml"))).toBe(false);
});

test("SET-43: init does not report managed output roots as import candidates", async () => {
  const root = await contractFixture({
    ".agents/skills/.skillset.lock": "{}",
    ".agents/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
    "plugins-codex/.skillset.lock": "{}",
    "plugins-codex/plugins/demo/plugin.json": "{}",
  });

  const preview = await runSkillsetCli("init", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).not.toContain("? import candidate skills .agents/skills");
  expect(preview.stdout).not.toContain("? import candidate plugins plugins-codex/plugins");
});

test("SET-43: init rejects version conflicts with existing release state", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: adopt-conflict
  version: 1.0.0
claude: true
codex: true
`,
    ".skillset/changes/state.json": JSON.stringify({
      schemaVersion: 1,
      scopes: {
        "skill:demo": {
          updatedAt: "2026-06-10T00:00:00.000Z",
          version: "9.9.9",
        },
      },
    }),
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 1.0.0
---

Body.
`,
  });

  const initialized = await runSkillsetCli("init", "--root", root, "--yes");
  expect(initialized.exitCode).toBe(1);
  expect(initialized.stderr).toContain("release baseline conflicts with existing release state");
  expect(initialized.stderr).toContain("skill:demo");
});

test("SET-43: import seeds a release baseline for adopted skills", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: import-skill-root
  version: 1.0.0
claude: true
codex: true
`,
  });
  const external = await mkdtemp(join(tmpdir(), "skillset-import-source-"));
  await Bun.write(join(external, "SKILL.md"), `---
name: adopted
description: Adopted skill.
version: 3.4.5
---

Body.
`);

  const report = await importSource({ kind: "skill", rootPath: root, sourcePath: external });
  expect(report.baselines.map((entry) => [entry.scope, entry.status, entry.version])).toEqual([
    ["skill:adopted", "create", "3.4.5"],
  ]);

  const inventory = await collectSourceInventory(root);
  const state = await readReleaseState(root);
  expect(state.scopes["skill:adopted"]?.version).toBe("3.4.5");
  expect(state.scopes["skill:adopted"]?.sourceHash).toBe(sourceInventoryUnit(inventory, "skill:adopted").hash);
  expect(await fileExists(join(root, ".skillset/changes/history.jsonl"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/changes/releases.jsonl"))).toBe(false);
});

test("SET-43: import seeds release baselines for adopted plugins", async () => {
  const root = await contractFixture({
    ".skillset/config.yaml": `
skillset:
  name: import-plugin-root
  version: 1.0.0
claude: true
codex: true
`,
  });
  const external = await mkdtemp(join(tmpdir(), "skillset-import-plugin-"));
  await Bun.write(join(external, "skillset.yaml"), `skillset:
  name: widget
  version: 0.8.0
claude: true
codex: true
`);
  await Bun.write(join(external, "skills/demo/SKILL.md"), `---
name: demo
description: Demo.
---

Body.
`);

  const report = await importSource({ kind: "plugin", rootPath: root, sourcePath: external });
  expect(report.baselines.map((entry) => [entry.scope, entry.status, entry.version])).toEqual([
    ["plugin.widget.config:root", "create", "0.8.0"],
    ["plugin.widget.skill:demo", "create", "0.8.0"],
    ["plugin:widget", "create", "0.8.0"],
  ]);

  const inventory = await collectSourceInventory(root);
  const state = await readReleaseState(root);
  for (const scope of ["plugin.widget.config:root", "plugin.widget.skill:demo", "plugin:widget"]) {
    expect(state.scopes[scope]?.version).toBe("0.8.0");
    expect(state.scopes[scope]?.sourceHash).toBe(sourceInventoryUnit(inventory, scope).hash);
  }
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

test("SET-7: build reports when a generated AGENTS.md exceeds Codex's size limit", async () => {
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

  const result = await buildSkillsetResult(root);
  const warnings = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
  const preview = await diffSkillsetResult(root);
  const previewWarnings = preview.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

  expect(warnings).toContain("project_doc_max_bytes");
  expect(warnings).toContain("AGENTS.md");
  expect(previewWarnings).toContain("project_doc_max_bytes");
  expect(previewWarnings).toContain("AGENTS.md");
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

async function writePendingChange(root: string, filename: string, content: string): Promise<void> {
  const pendingPath = join(root, ".skillset/changes/pending");
  await mkdir(pendingPath, { recursive: true });
  await writeFile(join(pendingPath, filename), `${content.trim()}\n`, "utf8");
}

async function writeHistory(root: string, entries: readonly Record<string, unknown>[]): Promise<void> {
  const changesPath = join(root, ".skillset/changes");
  await mkdir(changesPath, { recursive: true });
  await writeFile(join(changesPath, "history.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function sourceInventoryUnit(
  inventory: Awaited<ReturnType<typeof collectSourceInventory>>,
  id: string
): { readonly hash: string; readonly sourcePaths: readonly string[] } {
  const unit = inventory.units.find((item) => item.id === id);
  if (unit === undefined) throw new Error(`missing source inventory unit ${id}`);
  return { hash: unit.hash, sourcePaths: unit.sourcePaths };
}

function extractChangeRef(stdout: string): string {
  const match = stdout.match(/@[0-9a-f]{6,12}/);
  if (match === null) throw new Error(`missing change ref in stdout:\n${stdout}`);
  return match[0];
}

function extractBackupId(stdout: string): string {
  const match = stdout.match(/\b[0-9a-f]{12}\b/);
  if (match === null) throw new Error(`missing backup id in stdout:\n${stdout}`);
  return match[0];
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

async function runSkillsetCliIn(cwd: string, ...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    cwd,
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

async function runSkillsetCliWithInput(input: string, ...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdin: new Response(input),
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function commitFixture(root: string): Promise<void> {
  await runGit(root, "init", "-q");
  await runGit(root, "config", "user.email", "skillset@example.com");
  await runGit(root, "config", "user.name", "Skillset Test");
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", "baseline");
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", root, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${stdout}${stderr}`);
  }
}

async function sleepForMtime(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
