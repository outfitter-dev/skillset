import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createOperationalPathContext, planDistributions, resolveOperationalPath } from "@skillset/core";

import { buildSkillset, buildSkillsetResult, verifySkillset, verifySkillsetResult, diffSkillset, diffSkillsetResult, targetNames } from "@skillset/core";
import {
  changeStatus,
  collectSourceInventory,
  pluginTargetOptionsForSourceHash,
} from "../change-status";
import { doctorSkillset, explainPath, suggestSource } from "@skillset/core/internal/authoring";
import { importSource, importSources, normalizeCopiedImportPath } from "../import";
import { inspectSkillset, lintSkillset } from "@skillset/core";
import { readReleaseState } from "@skillset/core/internal/release-state";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import { createSkillset, initSkillset } from "../setup";
import { gitSafeEnv } from "../git-env";
import { sourceUnitDisplay } from "@skillset/core/internal/source-unit-selector";

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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
skillset:
  name: schema-strip
claude: true
codex: false
cursor: false
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

test("SET-3/SET-5: root rules dir is accepted as canonical", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: empty-rules
claude: true
codex: true
`,
    ".skillset/rules/global.md": `
# Global

- Be tidy.
`,
    ".skillset/rules/.gitkeep": "",
  });

  await expect(loadBuildGraph(root)).resolves.toMatchObject({ instructionsDir: "rules" });
});

test("SET-3: a semver-style skillset.schema is rejected, not confused with version", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  await expectFeatureDiagnosticError(loadBuildGraph(root), {
    code: "plugin-manifest-invalid",
    featureId: "plugin-manifests",
    message: expect.stringContaining("does not match skillset.name"),
    path: ".skillset/plugins/real-dir/skillset.yaml",
  });
});

// SET-5: canonical source instructions live in .skillset/rules/. Claude
// lowers to .claude/rules, and Codex lowers to AGENTS.md.

test("SET-5: canonical instructions lower to Claude rules and Codex AGENTS.md", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: instr-root
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
  expect(graph.warnings).toEqual([]);

  await buildSkillset(root);
  expect(await readFile(join(root, ".claude/rules/global.md"), "utf8")).toContain("Be tidy.");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Be tidy.");
});

test("SET-5: .skillset/rules with markdown is canonical", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const graph = await loadBuildGraph(root);
  expect(graph.rules.map((rule) => rule.sourcePath)).toEqual([join(root, ".skillset/rules/global.md")]);
});

test("SET-5: multiple root rules load from the canonical directory", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ambiguous-root
claude: true
codex: true
`,
    ".skillset/rules/global.md": `
# Global
`,
    ".skillset/rules/legacy.md": `
# Legacy
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.rules.map((rule) => rule.sourcePath).sort()).toEqual([
    join(root, ".skillset/rules/global.md"),
    join(root, ".skillset/rules/legacy.md"),
  ]);
});

// SET-6: tools is the canonical portable tool-policy key; retired tool_intent
// fails loudly instead of being ignored.

test("SET-6: tools lowers to Claude allowed-tools", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/intent/SKILL.md": `
---
name: intent
description: Declares a portable read and search policy.
tools:
  read: true
  search: true
---

Body.
`,
  });

  await buildSkillset(root);
  const skill = await readFile(join(root, ".claude/skills/intent/SKILL.md"), "utf8");
  expect(skill).toContain("allowed-tools");
  expect(skill).toContain("Read");
  expect(skill).toContain("Grep");
  expect(skill).toContain("Glob");
  // Source key is stripped from generated frontmatter.
  expect(skill).not.toContain("\ntools:");
});

test("SET-6: the retired tool_intent key is rejected", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/legacy/SKILL.md": `
---
name: legacy
description: Uses the retired tool_intent key.
tool_intent:
  allow:
    write: true
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("tool_intent is retired");
});

test("SET-6: the retired tool_intent key is rejected in project agents", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
cursor: false
`,
    ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Uses the retired tool_intent key.
tool_intent:
  allow:
    write: true
---

Review code.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses retired tool_intent; use tools");
});

test("SET-6: the retired tool_intent key is rejected in Codex-only project agents", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: false
codex: true
`,
    ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Uses the retired tool_intent key.
tool_intent:
  allow:
    write: true
---

Review code.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses retired tool_intent; use tools");
});

test("SET-6: the retired tool_intent key is rejected in target-native Markdown islands", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
cursor: false
`,
    ".skillset/_claude/agents/reviewer.md": `
---
name: reviewer
description: Uses the retired tool_intent key.
tool_intent:
  allow:
    write: true
---

Review code.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("uses retired tool_intent; use tools");
});

test("SET-6: unknown portable tool keys fail", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/unknown/SKILL.md": `
---
name: unknown
description: Uses an unknown tool key.
tools:
  teleport: true
---

Body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("unsupported key teleport");
});

test("SET-257: tools MCP policy lowers Claude wildcards using provider-native glob syntax", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: ti-root
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/mcp/SKILL.md": `
---
name: mcp
description: Declares MCP policy.
tools:
  mcp:
    github: true
    linear:
      - get_*
  claude:
    mcp: false
---

Body.
`,
  });

  await buildSkillset(root);
  const skill = await readFile(join(root, ".claude/skills/mcp/SKILL.md"), "utf8");
  expect(skill).toContain("mcp__*");
  expect(skill).not.toContain("mcp__.*");
});

// SET-2: Codex plugin hooks emit at the documented hooks/hooks.json path with a
// top-level "hooks" object. A canonical hooks/hooks.json is shared by both
// targets.

test("SET-2: a shared hooks/hooks.json emits to both Claude and Codex hook paths", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  const claudeHook = await readFile(join(root, "plugins/alpha/claude/hooks/hooks.json"), "utf8");
  const codexHook = await readFile(join(root, "plugins/alpha/codex/hooks/hooks.json"), "utf8");
  expect(claudeHook).toContain("SessionStart");
  expect(codexHook).toContain("SessionStart");
  expect(codexHook).toContain(`"hooks"`);
  const codexManifest = await readFile(join(root, "plugins/alpha/codex/.codex-plugin/plugin.json"), "utf8");
  expect(codexManifest).toContain(`"hooks": "./hooks/hooks.json"`);
});

test("SET-2: old root hooks.json is rejected for any enabled target", async () => {
  for (const targetConfig of [
    "claude: false\ncodex: true",
    "claude: true\ncodex: false",
  ]) {
    const root = await contractFixture({
      "skillset.yaml": `
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

    await expectFeatureDiagnosticError(loadBuildGraph(root), {
      code: "plugin-root-hooks-unsupported",
      featureId: "plugin-hooks",
      message: expect.stringContaining("uses unsupported root hooks.json"),
      path: ".skillset/plugins/alpha/hooks.json",
    });
  }
});

test("plugin manifest validation errors carry feature diagnostic metadata", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: manifest-errors
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
commands: {}
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  await expectFeatureDiagnosticError(loadBuildGraph(root), {
    code: "plugin-manifest-invalid",
    featureId: "plugin-manifests",
    message: expect.stringContaining("unsupported top-level key commands"),
    path: ".skillset/plugins/alpha/skillset.yaml",
  });

  const doctorJson = await runSkillsetCli("status", "--root", root, "--json");
  expect(doctorJson.exitCode).toBe(1);
  const doctorReport = (JSON.parse(doctorJson.stdout) as {
    readonly data: { buildDiagnostics: readonly { code: string; featureId: string; path?: string }[] };
  }).data;
  expect(doctorReport.buildDiagnostics).toContainEqual(expect.objectContaining({
    code: "plugin-manifest-invalid",
    featureId: "plugin-manifests",
    path: ".skillset/plugins/alpha/skillset.yaml",
  }));
});

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

function cachePath(root: string, logicalPath: string): string {
  return resolveOperationalPath(createOperationalPathContext(root), logicalPath);
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

// SET-14: golden manifest tests pin the target-surface shapes the evidence
// matrix (docs/target-surfaces.md) claims. Casing drift fails loudly here.

test("SET-14: Codex plugin manifest interface uses documented camelCase fields", async () => {
  const root = await goldenPluginFixture();
  await buildSkillset(root);
  const manifest = JSON.parse(
    await readFile(join(root, "plugins/widget/codex/.codex-plugin/plugin.json"), "utf8")
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
    "skillset.yaml": `
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
    await readFile(join(root, "plugins/plain/codex/.codex-plugin/plugin.json"), "utf8")
  ) as { interface: { brandColor?: string } };
  expect(manifest.interface.brandColor).toBe("#B06DFF");
});

test("SET-14: Claude plugin manifest emits the documented top-level fields", async () => {
  const root = await goldenPluginFixture();
  await buildSkillset(root);
  const manifest = JSON.parse(
    await readFile(join(root, "plugins/widget/claude/.claude-plugin/plugin.json"), "utf8")
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
  expect(report.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "tools-policy",
      sourcePath: ".skillset/skills/myskill/SKILL.md",
      sourceUnit: "skill:myskill",
      status: "target_native",
      target: "claude",
    })
  );
  expect(report.nextChecks).toContain("skillset check");
  expect(report.nextChecks).toContain("skillset check --only outputs");

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
  await Bun.write(join(root, "skillset.yaml"), "claude: true\ncodex: false\n");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: roundtrip-root\n");

  await importSource({ kind: "plugin", rootPath: root, sourcePath: join(external, "roundtrip") });
  await buildSkillset(root);

  const generated = JSON.parse(
    await readFile(join(root, "plugins/roundtrip/claude/.claude-plugin/plugin.json"), "utf8")
  ) as Record<string, unknown>;
  for (const [key, value] of Object.entries(originalManifest)) {
    expect(generated[key]).toEqual(value);
  }
});

test("SET-10: plugin import reports native hook lift diagnostics without rewriting hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(join(external, "native-hooks/.claude-plugin/plugin.json"), JSON.stringify({
    name: "native-hooks",
    version: "1.0.0",
  }));
  await Bun.write(join(external, "native-hooks/.codex-plugin/plugin.json"), JSON.stringify({
    name: "native-hooks",
    version: "1.0.0",
  }));
  const hooks = {
    hooks: {
      Notification: [
        {
          hooks: [{ command: "echo notify", type: "command" }],
        },
      ],
      PreToolUse: [
        {
          hooks: [{ command: "echo tool", type: "command" }],
          matcher: "Bash",
        },
      ],
    },
  };
  await Bun.write(join(external, "native-hooks/hooks/hooks.json"), JSON.stringify(hooks, null, 2));

  const report = await importSource({
    kind: "plugin",
    rootPath: root,
    sourcePath: join(external, "native-hooks"),
  });

  expect(report.copiedFiles).toContain("hooks/hooks.json");
  expect(report.renderResults).toContainEqual(expect.objectContaining({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: "import-native-hook-lift-candidate",
        message: expect.stringContaining("provider-scoped-adaptive for claude"),
        path: ".skillset/plugins/native-hooks/hooks/hooks.json#/Notification/0",
      }),
    ]),
    featureId: "plugin-hooks",
    sourceUnit: "plugin.native-hooks.feature:hooks",
    status: "target_native",
    target: "claude",
  }));
  expect(report.renderResults).toContainEqual(expect.objectContaining({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: "import-native-hook-unsupported",
        message: "Codex does not support adaptive hook event Notification.",
        path: ".skillset/plugins/native-hooks/hooks/hooks.json#/Notification/0",
      }),
    ]),
    featureId: "plugin-hooks",
    sourceUnit: "plugin.native-hooks.feature:hooks",
    status: "target_native",
    target: "codex",
  }));
  expect(JSON.parse(await readFile(join(report.targetPath, "hooks/hooks.json"), "utf8"))).toEqual(hooks);
});

test("SET-250: plugin import detects Cursor manifests and native hook lift diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-import-root-"));
  const external = await mkdtemp(join(tmpdir(), "skillset-import-src-"));
  await Bun.write(join(external, "cursor-hooks/.cursor-plugin/plugin.json"), JSON.stringify({
    description: "Cursor hooks.",
    name: "cursor-hooks",
    version: "1.0.0",
  }));
  const hooks = {
    hooks: {
      sessionStart: [
        {
          hooks: [{ command: "echo session", type: "command" }],
        },
      ],
    },
  };
  await Bun.write(join(external, "cursor-hooks/hooks/hooks.json"), JSON.stringify(hooks, null, 2));

  const report = await importSource({
    kind: "plugin",
    rootPath: root,
    sourcePath: join(external, "cursor-hooks"),
  });

  expect(report.name).toBe("cursor-hooks");
  expect(report.copiedFiles).toContain(".cursor-plugin/plugin.json");
  expect(report.renderResults).toContainEqual(expect.objectContaining({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: "import-native-hook-lift-candidate",
        message: expect.stringContaining("provider-scoped-adaptive for cursor"),
        path: ".skillset/plugins/cursor-hooks/hooks/hooks.json#/sessionStart/0",
      }),
    ]),
    featureId: "plugin-hooks",
    sourceUnit: "plugin.cursor-hooks.feature:hooks",
    status: "target_native",
    target: "cursor",
  }));
  expect(JSON.parse(await readFile(join(report.targetPath, "hooks/hooks.json"), "utf8"))).toEqual(hooks);
});

test("SET-10: copied import paths normalize native separators before hook lift checks", () => {
  expect(normalizeCopiedImportPath("hooks\\hooks.json")).toBe("hooks/hooks.json");
  expect(normalizeCopiedImportPath("hooks/hooks.json")).toBe("hooks/hooks.json");
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
  await Bun.write(join(root, "skillset.yaml"), "\n");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: import-root\n");
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
    "skillset.yaml": `
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

test("SET-25: build CLI is plan-first and retired preview flags fail", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const retiredPreviewFlag = await runSkillsetCli("build", "--root", root, "--dry-run");
  expect(retiredPreviewFlag.exitCode).toBe(1);
  expect(retiredPreviewFlag.stderr).toContain("unknown option");
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
    "skillset.yaml": `
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
  expect(planned.stdout).toContain("add: plugins/alpha/codex/.codex-plugin/plugin.json -> bundles/alpha/.codex-plugin/plugin.json");
  expect(planned.stdout).toContain("ownership: file:generated");
  expect(planned.stdout).toContain("destination-owned");
  const json = await runSkillsetCli("distribute", "plan", "codex-marketplace", "--json", "--root", root);
  expect(json).toMatchObject({ exitCode: 0, stderr: "" });
  const jsonResult = JSON.parse(json.stdout) as { readonly data: Record<string, unknown> };
  expect(jsonResult).toMatchObject({
    command: "distribute.plan",
    kind: "plan",
    schemaVersion: "skillset.cli.result@1",
  });
  expect(jsonResult.data.rootPath).toBeUndefined();
  expect(json.stdout).not.toContain(root);
  expect(await fileExists(join(root, "plugins/alpha/codex/.codex-plugin/plugin.json"))).toBe(false);
  expect(await fileExists(join(destination, "bundles/alpha/.codex-plugin/plugin.json"))).toBe(false);
});

test("SET-110: distribute plan reports destination-owned fields from destination manifests", async () => {
  const destination = await mkdtemp(join(tmpdir(), "skillset-distribution-dest-"));
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
      "skillset.yaml": `
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
  expect(rootHelp.stdout).toContain("skillset <command> [options]");
  expect(rootHelp.stdout).toContain("build   Preview or write generated provider outputs.");
  expect(rootHelp.stdout).not.toContain("--claude-setting-sources");

  const exhaustiveHelp = await runSkillsetCli("--help", "--all");
  expect(exhaustiveHelp.exitCode).toBe(0);
  expect(exhaustiveHelp.stderr).toBe("");
  expect(exhaustiveHelp.stdout).toContain("skillset check [--write|--only outputs|--ci [--fix]");
  expect(exhaustiveHelp.stdout).toContain("skillset update [--yes] [--json] [--root <path>]");
  expect(exhaustiveHelp.stdout).toContain("skillset dev [--write] [--jsonl] [--root <path>]");
  expect(exhaustiveHelp.stdout).toContain("skillset list [--details] [--json] [--scope <scope>] [--root <path>]");
  expect(exhaustiveHelp.stdout).toContain("skillset change check [@ref|--ref <ref>] [--since <ref>] [--staged] [--json]");
  expect(exhaustiveHelp.stdout).toContain("skillset change ignore <@ref> [--ref <ref>] [--yes] [--json]");
  expect(exhaustiveHelp.stdout).toContain("skillset change refresh [@ref] [--ref <ref>] [--since <ref>] [--yes] [--json]");
  expect(exhaustiveHelp.stdout).not.toContain("skillset list [--updated|--all]");
  expect(exhaustiveHelp.stdout).not.toContain("skillset verify");
  expect(exhaustiveHelp.stdout).not.toContain("skillset lint");
  expect(exhaustiveHelp.stdout).not.toContain("skillset providers");

  const shortHelp = await runSkillsetCli("-h");
  expect(shortHelp.exitCode).toBe(0);
  expect(shortHelp.stderr).toBe("");
  expect(shortHelp.stdout).toContain("skillset <command> [options]");

  const buildHelp = await runSkillsetCli("build", "--help");
  expect(buildHelp.exitCode).toBe(0);
  expect(buildHelp.stderr).toBe("");
  expect(buildHelp.stdout).toContain("skillset build [--yes]");
  expect(buildHelp.stdout).toContain("--updated");
  expect(buildHelp.stdout).not.toContain("skillset release plan");
  expect(buildHelp.stdout).not.toContain("skillset distribute plan");

  const explainHelp = await runSkillsetCli("explain", "--help");
  expect(explainHelp.exitCode).toBe(0);
  expect(explainHelp.stderr).toBe("");
  expect(explainHelp.stdout).toContain("skillset explain <path>");
  expect(explainHelp.stderr).not.toContain("expected a path to explain");
});

test("SET-281: providers is not a public CLI command", async () => {
  const removed = await runSkillsetCli("providers", "check");
  expect(removed.exitCode).toBe(1);
  expect(removed.stderr).toContain("expected command");
  expect(removed.stderr).not.toContain("skillset providers");
});

test("SET-278: check rejects destination flags and retired check commands are removed", async () => {
  const checkScope = await runSkillsetCli("check", "--scope", "repo");
  expect(checkScope.exitCode).toBe(1);
  expect(checkScope.stderr).toContain("skillset check does not support --scope");

  const checkUpdated = await runSkillsetCli("check", "--updated");
  expect(checkUpdated.exitCode).toBe(1);
  expect(checkUpdated.stderr).toContain("skillset check does not support --updated or --all");

  for (const command of ["lint", "verify", "ci"]) {
    const retired = await runSkillsetCli(command);
    expect(retired.exitCode).toBe(1);
    expect(retired.stderr).toContain("expected command");
    expect(retired.stderr).not.toContain(`skillset ${command} [`);
  }
});

test("SET-285: list rejects build-mode flags", async () => {
  for (const flag of ["--updated", "--all"]) {
    const result = await runSkillsetCli("list", flag, "--json");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "list",
      diagnostics: [expect.objectContaining({ message: "skillset: --updated and --all are not supported with list" })],
      exitCode: 2,
      ok: false,
    });
  }
});

test("SET-278: check is comprehensive and --only outputs is the narrow drift check", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: check-root
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
  const cleanCheck = await runSkillsetCli("check", "--root", root);
  expect(cleanCheck.exitCode).toBe(0);
  expect(cleanCheck.stderr).toBe("");
  expect(cleanCheck.stdout).toContain("skillset: check passed");

  await writeFile(join(root, ".claude/skills/demo/SKILL.md"), "stale generated output\n", "utf8");

  const driftCaught = await runSkillsetCli("check", "--root", root);
  expect(driftCaught.exitCode).toBe(1);
  expect(driftCaught.stdout).toContain("generated-output drift");

  const outputs = await runSkillsetCli("check", "--only", "outputs", "--root", root);
  expect(outputs.exitCode).toBe(1);
  expect(outputs.stderr).toContain(".claude/skills/demo/SKILL.md");
  expect(outputs.stderr).toContain("version drift");

  const scopedOutputs = await runSkillsetCli(
    "check",
    "--only",
    "outputs",
    "--scope",
    "repo",
    "--updated",
    "--dist",
    "generated",
    "--root",
    root
  );
  expect(scopedOutputs.stderr).not.toContain("does not support --scope");
  expect(scopedOutputs.stderr).not.toContain("does not support --updated");
  expect(scopedOutputs.stderr).not.toContain("does not support --dist");

  for (const mode of ["--ci", "--write"] as const) {
    const comprehensive = await runSkillsetCli(
      "check",
      mode,
      "--dist",
      "generated",
      "--root",
      root
    );
    expect(comprehensive.stderr).not.toContain("does not support --dist");
  }
});

test("SET-154: check fails on source authoring diagnostics", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: check-source-error
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

See [Guide](shared:references/guide.md).
`,
  });

  const checked = await runSkillsetCli("check", "--root", root);
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("resource-undeclared-link");
  expect(checked.stdout).toContain("shared:references/guide.md");
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
    expect(printed.stdout).not.toContain("skillset check --only outputs");
    expect(printed.stdout).not.toContain("skillset status");
    if (runner === "pre-commit") expect(printed.stdout).toContain("entry: sh -c");
  }
});

test("SET-41: hooks print emits target runtime suggestions without installing", async () => {
  const claude = await runSkillsetCli("hooks", "print", "--target", "claude", "--agent-runtime");
  expect(claude.exitCode).toBe(0);
  expect(claude.stdout).toContain(".claude/settings.local.json");
  expect(claude.stdout).toContain("PostToolUse");
  expect(claude.stdout).toContain("Stop");
  expect(claude.stdout).toContain("skillset hooks run post-tool-use");
  expect(claude.stdout).toContain("skillset hooks run stop");
  expect(claude.stdout).not.toContain("skillset status");
  expect(claude.stdout).toContain("Skillset does not install or trust hooks");

  const codex = await runSkillsetCli("hooks", "print", "--target", "codex", "--agent-runtime");
  expect(codex.exitCode).toBe(0);
  expect(codex.stdout).toContain(".codex/hooks/hooks.json");
  expect(codex.stdout).toContain("PostToolUse");
  expect(codex.stdout).toContain("Stop");
  expect(codex.stdout).toContain("skillset hooks run post-tool-use");
  expect(codex.stdout).toContain("skillset hooks run stop");

  const cursor = await runSkillsetCli("hooks", "print", "--target", "cursor", "--agent-runtime");
  expect(cursor.exitCode).toBe(1);
  expect(cursor.stderr).toContain("only supports --target claude or --target codex");

  const cursorWithoutRuntime = await runSkillsetCli("hooks", "print", "--target", "cursor");
  expect(cursorWithoutRuntime.exitCode).toBe(1);
  expect(cursorWithoutRuntime.stderr).toContain("--target is only supported with --agent-runtime");

  const invalid = await runSkillsetCli("hooks", "print", "--runner", "git", "--agent-runtime");
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("cannot be combined");

  const invalidRun = await runSkillsetCliWithInput("", "hooks", "run", "bogus");
  expect(invalidRun.exitCode).toBe(1);
  expect(invalidRun.stderr).toContain("expected hooks run event post-tool-use or stop");

  const runWithPrintFlag = await runSkillsetCliWithInput("", "hooks", "run", "stop", "--agent-runtime");
  expect(runWithPrintFlag.exitCode).toBe(1);
  expect(runWithPrintFlag.stderr).toContain("hook options are only supported with hooks print");

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

test("SET-228: hooks context emits helper-backed runtime context", async () => {
  const env = await runSkillsetCliWithEnv(
    { CODEX_SESSION_ID: "session-1", SKILLSET_PROVIDER: "codex" },
    "hooks",
    "context",
    "--event",
    "Stop",
    "--format",
    "env",
    "--context-fields",
    "provider,hook.event,session.id"
  );
  expect(env.exitCode).toBe(0);
  expect(env.stderr).toBe("");
  expect(env.stdout).toBe([
    "export SKILLSET_PROVIDER=codex",
    "export SKILLSET_HOOK_EVENT=Stop",
    "export SKILLSET_SESSION_ID=session-1",
    "",
  ].join("\n"));

  const json = await runSkillsetCliWithEnv(
    { CLAUDE_SESSION_ID: "session-2", SKILLSET_PROVIDER: "claude" },
    "hooks",
    "context",
    "--event",
    "PreToolUse",
    "--format",
    "json",
    "--context-fields",
    "provider,hook.event"
  );
  expect(json.exitCode).toBe(0);
  expect(json.stderr).toBe("");
  expect(JSON.parse(json.stdout)).toEqual(expect.objectContaining({
    hook: { event: "PreToolUse" },
    provider: "claude",
    schemaVersion: 1,
  }));

  const missingEvent = await runSkillsetCli("hooks", "context", "--format", "env");
  expect(missingEvent.exitCode).toBe(1);
  expect(missingEvent.stderr).toContain("hooks context requires --event");

  const printWithContextFlag = await runSkillsetCli("hooks", "print", "--runner", "git", "--context-fields", "provider");
  expect(printWithContextFlag.exitCode).toBe(1);
  expect(printWithContextFlag.stderr).toContain("hook context options are only supported with hooks context");

  const cliPath = shellQuote(join(import.meta.dir, "..", "cli.ts"));
  const stdinPreserved = await runShell(`printf payload | (eval "$(bun ${cliPath} hooks context --event Stop --format env --context-fields provider)" && cat)`);
  expect(stdinPreserved.exitCode).toBe(0);
  expect(stdinPreserved.stdout).toBe("payload");
});

test("SET-55: hooks run is a CLI-owned runtime entrypoint", async () => {
  const cleanRoot = await contractFixture({ "README.md": "clean\n" });
  await commitFixture(cleanRoot);

  const clean = await runSkillsetCli("hooks", "run", "stop", "--root", cleanRoot);
  expect(clean.exitCode).toBe(0);
  expect(clean.stdout).toBe("");
  expect(clean.stderr).toBe("");

  const missingGitRoot = await contractFixture({ "README.md": "not a git repo\n" });
  const failed = await runSkillsetCli("hooks", "run", "stop", "--root", missingGitRoot);
  expect(failed.exitCode).not.toBe(0);
  expect(failed.stdout).toBe("");
  expect(failed.stderr).toContain("could not inspect Skillset source changes");
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

test("SET-176: change status normalizes retired baseline test declarations", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: retired-tests-baseline
tests:
  self:
    source: repo:.
    assertions:
      - build
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Baseline body.
`,
  });
  await commitFixture(root);

  await writeFile(join(root, "skillset.yaml"), `
skillset:
  name: retired-tests-baseline
claude: true
codex: false
`);
  await writeFile(join(root, ".skillset/tests.yaml"), `
self:
  select:
    skills:
      primary: ["demo"]
  checks:
    projection: true
`);

  const status = await runSkillsetCli("change", "status", "--root", root, "--since", "HEAD");

  if (status.exitCode !== 0) throw new Error(`change status failed\nstderr:\n${status.stderr}\nstdout:\n${status.stdout}`);
  expect(status.exitCode).toBe(0);
  expect(status.stderr).toBe("");
});

test("SET-176: skillset test reports retired workspace test declarations", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: retired-tests-workspace
tests:
  self:
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

  const result = await runSkillsetCli("test", "self", "--root", root);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("skillset.yaml.tests is retired");
  expect(result.stderr).toContain(".skillset/tests.yaml");
  expect(result.stderr).not.toContain("unsupported top-level key tests");
});

test("SET-177: skillset test rejects source-root assertions declarations", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: retired-assertions-source-root
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
self:
  select:
    skills:
      primary: ["demo"]
  assertions:
    - build
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
  expect(result.stderr).toContain(".skillset/tests.yaml.self.assertions is retired");
  expect(result.stderr).toContain("use .skillset/tests.yaml.self.checks");
});

test("SET-280: test lifecycle words are reserved declaration names", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reserved-test-name\nclaude: true\ncodex: false\n",
    ".skillset/tests.yaml": "status:\n  select:\n    skills:\n      primary: [demo]\n  checks:\n    projection: true\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });

  const result = await runSkillsetCli("test", "--root", root);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("test name status is reserved for the retained-run lifecycle");
});

test("SET-50: skillset test runs an isolated projection and refreshes latest", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
cursor: false
`,
    ".skillset/tests.yaml": `
self:
  select:
    skills:
      primary: ["demo"]
  checks:
    projection: true
    files:
      - path: .claude/skills/demo/SKILL.md
      - path: .claude/skills/demo/SKILL.md
        contains: Demo body.
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
  expect(first.stdout).toContain("pass: projection");

  const firstLatest = JSON.parse(await readFile(cachePath(root, ".skillset/cache/tests/latest.json"), "utf8")) as {
    runId: string;
    runPath: string;
    schemaVersion: number;
    workspacePath: string;
  };
  expect(firstLatest.runId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  expect(firstLatest.schemaVersion).toBe(3);
  expect(await fileExists(cachePath(root, join(firstLatest.runPath, "report.json")))).toBe(true);
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/report.json"))).toBe(true);
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/workspace/.claude/skills/demo/SKILL.md"))).toBe(true);
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/workspace/.agents/skills/demo/SKILL.md"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/build/tests"))).toBe(false);
  expect(await fileExists(join(root, ".claude/skills/demo/SKILL.md"))).toBe(false);
  const firstReport = JSON.parse(await readFile(cachePath(root, join(firstLatest.runPath, "report.json")), "utf8")) as {
    schemaVersion: number;
    targets: readonly string[];
  };
  expect(firstReport.schemaVersion).toBe(3);
  expect(firstReport.targets).toEqual(["claude"]);

  const structured = await runSkillsetCli("test", "self", "--root", root, "--json");
  expect(structured.exitCode).toBe(0);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "test",
    data: { name: "self", ok: true },
    exitCode: 0,
    kind: "test",
    ok: true,
  });

  const mixed = await runSkillsetCli("test", "self", "--target", "claude", "--root", root);
  expect(mixed.exitCode).toBe(1);
  expect(mixed.stderr).toContain("declared test self cannot be combined with ad hoc test flags");

  const second = await runSkillsetCli("test", "self", "--root", root);
  expect(second.exitCode).toBe(0);
  const secondLatest = JSON.parse(await readFile(cachePath(root, ".skillset/cache/tests/latest.json"), "utf8")) as {
    runId: string;
    runPath: string;
  };
  expect(secondLatest.runId).not.toBe(firstLatest.runId);
  expect(await fileExists(cachePath(root, join(firstLatest.runPath, "report.json")))).toBe(true);
  expect(await fileExists(cachePath(root, join(secondLatest.runPath, "report.md")))).toBe(true);
});

test("SET-112: skillset test compiles activation probes into run and latest assets", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: activation-root
claude: true
codex: true
`,
    ".skillset/tests/activation.yaml": `
select:
  skills:
    primary: ["demo"]
targets:
  - claude
  - codex
activation:
  - name: fixture guidance
    prompt: Help me inspect this Skillset fixture setup.
    expect:
      skill: demo
checks:
  projection: true
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
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/activation/claude/fixture-guidance.md"))).toBe(true);
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/activation/codex/fixture-guidance.md"))).toBe(true);
  const claudeProbe = await readFile(cachePath(root, ".skillset/cache/tests/latest/activation/claude/fixture-guidance.md"), "utf8");
  expect(claudeProbe).toContain("Manual Claude activation probe");
  expect(claudeProbe).toContain("Status: manual-native");
  expect(claudeProbe).toContain("- skill: demo");
  const codexProbe = await readFile(cachePath(root, ".skillset/cache/tests/latest/activation/codex/probes.json"), "utf8");
  expect(codexProbe).toContain("manual-shimmed");
  expect(codexProbe).toContain("Manual Codex activation probe");
  expect(codexProbe).toContain("fixture-guidance");
});

test("SET-132: activation probes handle Cursor as native project-agent output", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: activation-cursor-root
cursor: true
`,
    ".skillset/tests/activation.yaml": `
select:
  agents:
    - reviewer
  skills:
    primary:
      - helper
targets:
  - cursor
activation:
  - name: cursor helper skill
    prompt: Help me inspect this Skillset helper.
    expect:
      skill: helper
  - name: cursor project agent
    prompt: Ask the reviewer to inspect this workspace.
    expect:
      agent: reviewer
checks:
  projection: true
`,
    ".skillset/agents/reviewer.md": `
---
name: Reviewer
description: Reviews Cursor workspaces.
---

Review the workspace.
`,
    ".skillset/skills/helper/SKILL.md": `
---
name: helper
description: Helper.
---

Helper body.
`,
  });

  const result = await runSkillsetCli("test", "activation", "--root", root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("selection: agents reviewer; primary skills helper");
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/activation/cursor/cursor-helper-skill.md"))).toBe(true);
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/activation/cursor/cursor-project-agent.md"))).toBe(true);
  const probes = await readFile(cachePath(root, ".skillset/cache/tests/latest/activation/cursor/probes.json"), "utf8");
  expect(probes).toContain("manual-native");
  expect(probes).toContain("Manual Cursor activation probe");
  expect(probes).not.toContain("Manual Codex activation probe");
  expect(probes).not.toContain("manual-shimmed");
  const report = JSON.parse(await readFile(cachePath(root, ".skillset/cache/tests/latest/report.json"), "utf8")) as {
    selection: { agents: string[]; primarySkills: string[] };
  };
  expect(report.selection.agents).toEqual(["reviewer"]);
  expect(report.selection.primarySkills).toEqual(["helper"]);
});

test("SET-134: project-agent orchestration activation proof distinguishes Claude native skills from Codex shim", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: activation-orchestration-root
claude: true
codex: true
`,
    ".skillset/tests/orchestration.yaml": `
select:
  agents:
    - reviewer
  skills:
    primary:
      - helper
targets:
  - claude
  - codex
activation:
  - name: reviewer helper delegation
    prompt: Ask the reviewer to use the helper guidance before reviewing.
    expect:
      agent: reviewer
checks:
  projection: true
  files:
    - path: .claude/agents/reviewer.md
      contains: "skills:"
    - path: .claude/agents/reviewer.md
      contains: "- helper"
    - path: .codex/agents/reviewer.toml
      contains: "Load the following skills first"
    - path: .codex/agents/reviewer.toml
      contains: "- helper"
`,
    ".skillset/agents/reviewer.md": `
---
name: Reviewer
description: Reviews with helper guidance.
skills:
  - helper
---

Review the workspace after loading helper guidance.
`,
    ".skillset/skills/helper/SKILL.md": `
---
name: helper
description: Helper.
---

Helper body.
`,
  });

  const result = await runSkillsetCli("test", "orchestration", "--root", root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("selection: agents reviewer; primary skills helper");
  expect(result.stdout).toContain("activation probes: 1");
  const claudeProbe = await readFile(cachePath(root, ".skillset/cache/tests/latest/activation/claude/reviewer-helper-delegation.md"), "utf8");
  expect(claudeProbe).toContain("Manual Claude activation probe");
  const codexProbe = await readFile(cachePath(root, ".skillset/cache/tests/latest/activation/codex/probes.json"), "utf8");
  expect(codexProbe).toContain("manual-shimmed");
  expect(codexProbe).toContain("reviewer-helper-delegation");
});

test("SET-112: activation probes reject empty prompts and duplicate output names", async () => {
  const emptyPromptRoot = await contractFixture({
    "skillset.yaml": `
skillset:
  name: empty-prompt-root
claude: true
codex: false
`,
    ".skillset/tests/activation.yaml": `
select:
  skills:
    primary: ["demo"]
activation:
  - prompt: " "
    expect:
      skill: demo
checks:
  projection: true
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
    "skillset.yaml": `
skillset:
  name: duplicate-probe-root
claude: true
codex: false
`,
    ".skillset/tests/activation.yaml": `
select:
  skills:
    primary:
      - first
      - second
activation:
  - name: Demo probe
    prompt: First prompt.
    expect:
      skill: first
  - name: demo-probe
    prompt: Second prompt.
    expect:
      skill: second
checks:
  projection: true
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
  expect(await fileExists(join(duplicateRoot, ".skillset/cache/tests/runs"))).toBe(false);

  const emptyTargetsRoot = await contractFixture({
    "skillset.yaml": `
skillset:
  name: empty-targets-root
claude: true
codex: false
`,
    ".skillset/tests/activation.yaml": `
select:
  skills:
    primary: ["demo"]
activation:
  - name: empty targets
    prompt: Probe prompt.
    targets: []
    expect:
      skill: demo
checks:
  projection: true
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
  expect(await fileExists(join(emptyTargetsRoot, ".skillset/cache/tests/runs"))).toBe(false);
});

test("SET-112: activation probes require expected units to be emitted for the target", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: missing-activation-root
claude: true
codex: false
`,
    ".skillset/tests/activation.yaml": `
select:
  skills:
    primary: ["demo"]
targets:
  - claude
activation:
  - name: missing skill
    prompt: Probe prompt.
    expect:
      skill: missing
checks:
  projection: true
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
  expect(await fileExists(join(root, ".skillset/cache/tests/runs"))).toBe(false);
});

test("SET-112: test declarations are active source-root owned", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: root-owned-tests
claude: true
codex: false
`,
    ".skillset/plugins/alpha/tests.yaml": `
ignored:
  select:
    plugins: ["alpha"]
  checks:
    projection: true
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

Demo body.
`,
  });

  const result = await runSkillsetCli("test", "ignored", "--root", root);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(".skillset must include tests.yaml or tests/*.yaml for skillset test");
});

test("SET-176: source selectors prune unrelated source before isolated builds", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: selected-source-root
claude: true
codex: true
`,
    ".skillset/tests.yaml": `
self:
  select:
    skills:
      primary:
        - demo
  checks:
    projection: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
    ".skillset/plugins/bad/skillset.yaml": `
skillset:
  name: bad
`,
    ".skillset/plugins/bad/agents/worker.md": `
---
name: worker
description: Unsupported Codex plugin agent.
---

Worker body.
`,
  });

  const result = await runSkillsetCli("test", "self", "--root", root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("pass: projection");
  expect(result.stdout).toContain("selection: primary skills demo");
  expect(
    await fileExists(cachePath(root, ".skillset/cache/tests/latest/workspace/plugins/bad/codex/.codex-plugin/plugin.json"))
  ).toBe(false);
});

test("SET-176: plugin skill selectors prune plugin-owned companion source", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: selected-plugin-skill-root
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
self:
  select:
    plugins:
      include:
        - alpha
      skills:
        - demo
  checks:
    projection: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
resources:
  scripts:
    - plugin:scripts/check.sh
---

Demo body.
`,
    ".skillset/plugins/alpha/shared/scripts/check.sh": `
#!/usr/bin/env bash
echo shared
`,
    ".skillset/plugins/alpha/commands/run.md": `
COMMAND_EMITTED=yes
`,
  });

  const result = await runSkillsetCli("test", "self", "--root", root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("pass: projection");
  expect(
    await fileExists(cachePath(root, ".skillset/cache/tests/latest/workspace/plugins/alpha/claude/skills/demo/scripts/check.sh"))
  ).toBe(true);
  expect(await fileExists(cachePath(root, ".skillset/cache/tests/latest/workspace/plugins/alpha/claude/commands/run.md"))).toBe(false);
});

test("SET-178: source selectors cover all plugins and all skills", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: broad-selector-root
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
all-plugins:
  select:
    plugins: true
  checks:
    projection: true
all-skills:
  select:
    skills: true
  checks:
    projection: true
`,
    ".skillset/skills/primary/SKILL.md": `
---
name: primary
description: Primary skill.
---

Primary body.
`,
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
`,
    ".skillset/plugins/beta/skills/two/SKILL.md": `
---
name: two
description: Second plugin skill.
---

Beta skill body.
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/one/SKILL.md": `
---
name: one
description: First plugin skill.
---

Alpha skill body.
`,
  });

  const plugins = await runSkillsetCli("test", "all-plugins", "--root", root);
  expect(plugins.exitCode).toBe(0);
  expect(plugins.stdout).toContain("selection: plugins alpha, beta");

  const skills = await runSkillsetCli("test", "all-skills", "--root", root);
  expect(skills.exitCode).toBe(0);
  expect(skills.stdout).toContain("selection: primary skills primary; plugin skills alpha/one, beta/two");
});

test("SET-179: plugin manifest checks derive selected provider manifests", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: manifest-root
  version: 2.3.4
claude: true
codex: true
`,
    ".skillset/tests.yaml": `
plugin-manifests:
  select:
    plugins:
      - alpha
  checks:
    projection: true
    pluginManifests: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  summary: Alpha plugin.
  license: MIT
  keywords:
    - alpha
claude:
  manifest:
    name: alpha-claude
codex:
  manifest:
    name: alpha-codex
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  const result = await runSkillsetCli("test", "plugin-manifests", "--root", root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("pass: projection");
  expect(result.stdout).toContain("pass: pluginManifests");
  expect(result.stdout).toContain("selection: plugins alpha");

  const report = JSON.parse(await readFile(cachePath(root, ".skillset/cache/tests/latest/report.json"), "utf8")) as {
    selection: { plugins: string[] };
  };
  expect(report.selection.plugins).toEqual(["alpha"]);
  const latest = JSON.parse(await readFile(cachePath(root, ".skillset/cache/tests/latest.json"), "utf8")) as {
    selection: { plugins: string[] };
  };
  expect(latest.selection).toEqual(report.selection);
  const markdown = await readFile(cachePath(root, ".skillset/cache/tests/latest/report.md"), "utf8");
  expect(markdown).toContain("Selection: plugins alpha");
  const claudeManifest = JSON.parse(
    await readFile(cachePath(root, ".skillset/cache/tests/latest/workspace/plugins/alpha/claude/.claude-plugin/plugin.json"), "utf8")
  ) as { keywords?: string[]; license?: string; name?: string; version?: string };
  const codexManifest = JSON.parse(
    await readFile(cachePath(root, ".skillset/cache/tests/latest/workspace/plugins/alpha/codex/.codex-plugin/plugin.json"), "utf8")
  ) as { keywords?: string[]; license?: string; name?: string; version?: string };
  expect(claudeManifest.name).toBe("alpha-claude");
  expect(claudeManifest.version).toBe("2.3.4");
  expect(claudeManifest.license).toBe("MIT");
  expect(claudeManifest.keywords).toEqual(["alpha"]);
  expect(codexManifest.name).toBe("alpha-codex");
  expect(codexManifest.version).toBe("2.3.4");
  expect(codexManifest.license).toBe("MIT");
  expect(codexManifest.keywords).toEqual(["alpha"]);
});

test("SET-179: plugin manifest checks fail when selected plugins emit no manifests", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: manifest-missing-root
compile:
  targets:
    - claude
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
plugin-manifests:
  select:
    plugins:
      - alpha
  checks:
    pluginManifests: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
claude:
  enabled: false
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Demo body.
`,
  });

  const result = await runSkillsetCli("test", "plugin-manifests", "--root", root);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("fail: pluginManifests (no selected plugin manifests were emitted)");
  expect(result.stderr).toBe("");
});

test("SET-178: source selectors reject missing and ambiguous plugin skills", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: selector-root
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
missing-plugin:
  select:
    plugins:
      - missing
  checks:
    projection: true
ambiguous-plugin-skill:
  select:
    skills:
      plugin:
        - shared
  checks:
    projection: true
empty:
  select: {}
  checks:
    projection: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/shared/SKILL.md": `
---
name: shared
description: Shared alpha.
---

Alpha body.
`,
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
`,
    ".skillset/plugins/beta/skills/shared/SKILL.md": `
---
name: shared
description: Shared beta.
---

Beta body.
`,
  });

  const missing = await runSkillsetCli("test", "missing-plugin", "--root", root);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain('unknown plugin "missing"');

  const ambiguous = await runSkillsetCli("test", "ambiguous-plugin-skill", "--root", root);
  expect(ambiguous.exitCode).toBe(1);
  expect(ambiguous.stderr).toContain('plugin skill "shared"');
  expect(ambiguous.stderr).toContain("is ambiguous across plugins alpha, beta");

  const empty = await runSkillsetCli("test", "empty", "--root", root);
  expect(empty.exitCode).toBe(1);
  expect(empty.stderr).toContain(".skillset/tests.yaml.empty.select must select at least one source unit");
});

test("SET-50: skillset test reports failed checks without touching live outputs", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: failing-test-root
compile:
  targets:
    - claude
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
self:
  select:
    skills:
      primary: ["demo"]
  checks:
    projection: true
    files:
      - path: missing/generated.txt
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

  const report = JSON.parse(await readFile(cachePath(root, ".skillset/cache/tests/latest/report.json"), "utf8")) as {
    ok: boolean;
    checks: Array<{ detail?: string; kind: string; ok: boolean; path?: string }>;
  };
  expect(report.ok).toBe(false);
  expect(report.checks).toContainEqual({ detail: "path does not exist", kind: "exists", ok: false, path: "missing/generated.txt" });
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
    "skillset.yaml": `
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
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  const pendingPath = join(root, ".skillset/changes/demo.md");
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
    "skillset.yaml": `
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
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  const pendingPath = join(root, ".skillset/changes/demo.md");
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
  await writeFile(join(root, "skillset.yaml"), `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  const checked = await runSkillsetCli("check", "--only", "outputs", "--root", root);
  expect(checked.exitCode).toBe(0);
  expect(checked.stderr).toContain("@acme/docs-cli supports >=2.4.0 <3.0.0");
  expect(checked.stderr).toContain("repo:packages/docs-cli/package.json is 3.1.0");

  const readiness = await runSkillsetCli("check", "--root", root);
  expect(readiness.exitCode).toBe(0);
  expect(readiness.stdout).toContain("@acme/docs-cli supports >=2.4.0 <3.0.0");
  expect(readiness.stdout).toContain("repo:packages/docs-cli/package.json is 3.1.0");
  expect(readiness.stdout).toContain("skillset: check passed");
});

test("SET-39: invalid supports ranges fail loudly", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  await expect(loadBuildGraph(root)).rejects.toThrow("supports.packages must be an array");
});

test("SET-39: supports-only changes can use bump none without severity warnings", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "none",
    "--reason",
    "Record the supports metadata compatibility update without changing generated artifact behavior."
  );
  expect(added.exitCode).toBe(0);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("0 warnings");
  expect(checked.stdout).not.toContain("change-bump-lower-than-suggested");
});

test("SET-40: plugin dependencies lower to Claude and Codex fallback notices", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  const claudeManifest = await readFile(join(root, "plugins/audit/claude/.claude-plugin/plugin.json"), "utf8");
  expect(claudeManifest).toContain('"dependencies"');
  expect(claudeManifest).toContain('"name": "native-secrets-vault"');
  expect(claudeManifest).toContain('"range": "=1.2.3"');
  expect(claudeManifest).toContain('"name": "external-tools"');
  expect(claudeManifest).toContain('"marketplace": "acme"');

  const codexSkill = await readFile(join(root, "plugins/audit/codex/skills/audit-skill/SKILL.md"), "utf8");
  expect(codexSkill).toContain("<skillset_plugin_dependencies>");
  expect(codexSkill).toContain("secrets-vault range =1.2.3 internal");
  expect(codexSkill).toContain("external-tools range ^2.1.0 marketplace acme external");
  expect(codexSkill).toContain("Do not install or resolve them yourself");

  const listed = await runSkillsetCli("list", "--details", "--root", root);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout).toContain("deps: external-tools range");
  expect(listed.stdout).toContain("^2.1.0 marketplace acme external");
  const explained = await runSkillsetCli("explain", ".skillset/plugins/audit", "--root", root);
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain("dependencies: external-tools range ^2.1.0 marketplace acme external");
  expect(explained.stdout).toContain("secrets-vault range =1.2.3 internal");

  const auditLockSourceHash = async (): Promise<string> => {
    const lock = JSON.parse(await readFile(join(root, "plugins/skillset.lock"), "utf8")) as {
      items: Array<{ outputPath?: string; sourceHash?: string }>;
    };
    return lock.items.find((item) => item.outputPath === "audit/claude/.claude-plugin/plugin.json")?.sourceHash ?? "";
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
      "skillset.yaml": `
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
    "skillset.yaml": `
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

  await expectFeatureDiagnosticError(loadBuildGraph(root), {
    code: "plugin-dependencies-invalid",
    featureId: "dependencies",
    message: expect.stringContaining("must not depend on itself"),
    path: ".skillset/plugins",
  });
});

test("SET-40: plugin dependencies reject unsupported dependency groups", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
      "skillset.yaml": `
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
    "skillset.yaml": `
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

test("SET-345: plugin aggregate hashes preserve legacy shape and include Cursor options", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const before = await collectSourceInventory(root);
  const beforeGraph = await loadBuildGraph(root);
  const legacyHash = before.units.find((unit) => unit.id === "plugin:alpha")?.hash;
  expect(legacyHash).toBe("sha256:1a3416ee2ebfb3fcf875ed2aa85f53ffffaaed12cb3b35caa8a9ae7f6c844c5a");
  expect(pluginTargetOptionsForSourceHash(beforeGraph.plugins[0]!)).toEqual({ claude: {}, codex: {} });

  await Bun.write(
    join(root, ".skillset/plugins/alpha/skillset.yaml"),
    `
skillset:
  name: alpha
  version: 0.1.0
cursor:
  marketplace:
    displayName: Alpha Cursor Marketplace
`
  );

  const after = await collectSourceInventory(root);
  const afterGraph = await loadBuildGraph(root);
  const targetOptions = pluginTargetOptionsForSourceHash(afterGraph.plugins[0]!);
  expect(afterGraph.plugins[0]!.targets.cursor.options).not.toEqual({});
  expect(targetOptions.cursor).toEqual(afterGraph.plugins[0]!.targets.cursor.options);
  for (const target of targetNames()) {
    if (Object.keys(afterGraph.plugins[0]!.targets[target].options).length > 0) {
      expect(targetOptions).toHaveProperty(target);
    }
  }
  expect(after.units.find((unit) => unit.id === "plugin:alpha")?.hash).not.toBe(legacyHash);
});

test("SET-377: Cursor project-agent prompt partials stay literal and do not drift", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: cursor-agent-hash-root
claude: false
codex: false
cursor: true
`,
    ".skillset/agents/reviewer.md": `
---
description: Reviews Cursor changes.
cursor:
  initialPrompt: "{{shared:templates/cursor-prompt.md }}"
---

Review changes.
`,
    ".skillset/shared/templates/cursor-prompt.md": "Start with Cursor evidence.\n",
  });

  await buildSkillset(root);
  await commitFixture(root);

  const before = await collectSourceInventory(root);
  const beforeAgent = before.units.find((unit) => unit.id === "agent:reviewer");
  expect(beforeAgent?.sourcePaths).not.toContain(".skillset/shared/templates/cursor-prompt.md");
  const generatedPath = join(root, ".cursor/agents/reviewer.md");
  const generated = await readFile(generatedPath, "utf8");
  expect(generated).toContain('initialPrompt: "{{shared:templates/cursor-prompt.md }}"');

  await Bun.write(
    join(root, ".skillset/shared/templates/cursor-prompt.md"),
    "Start with updated Cursor evidence.\n"
  );

  const after = await collectSourceInventory(root);
  expect(after.units.find((unit) => unit.id === "agent:reviewer")?.hash).toBe(beforeAgent?.hash);
  const report = await changeStatus(root, { since: "HEAD" });
  expect(report.sourceChanges.map((change) => change.id)).not.toContain("agent:reviewer");
  expect(report.generatedDrift).toEqual({ added: [], changed: [], missing: [], removed: [] });
  expect(await readFile(generatedPath, "utf8")).toBe(generated);
});

test("SET-377: Codex project-agent prompt partials remain source-significant", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: codex-agent-hash-root
claude: false
codex: true
cursor: false
`,
    ".skillset/agents/reviewer.md": `
---
description: Reviews Codex changes.
codex:
  initialPrompt: "{{shared:templates/codex-prompt.md }}"
---

Review changes.
`,
    ".skillset/shared/templates/codex-prompt.md": "Start with Codex evidence.\n",
  });

  await buildSkillset(root);
  await commitFixture(root);

  const before = await collectSourceInventory(root);
  const beforeAgent = before.units.find((unit) => unit.id === "agent:reviewer");
  expect(beforeAgent?.sourcePaths).toContain(".skillset/shared/templates/codex-prompt.md");

  await Bun.write(
    join(root, ".skillset/shared/templates/codex-prompt.md"),
    "Start with updated Codex evidence.\n"
  );

  const report = await changeStatus(root, { since: "HEAD" });
  expect(report.sourceChanges.map((change) => change.id)).toContain("agent:reviewer");
  expect(report.generatedDrift.changed).toContain(".codex/agents/reviewer.toml");
});

test("SET-34: partial dependencies participate in source status hashes", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: partial-status-root
claude: true
codex: false
`,
    ".skillset/shared/common.md": `
Shared partial.
`,
    ".skillset/rules/root.md": `
# Root

{{shared:common.md}}
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

{{shared:common.md}}
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("SET-144: flat pending entries coexist with change ledger JSON files", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: flat-change-root
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
  const changesPath = join(root, ".skillset/changes");
  await mkdir(changesPath, { recursive: true });
  await writeFile(join(changesPath, "state.json"), JSON.stringify({ scopes: {} }), "utf8");
  await writeFile(join(changesPath, "history.jsonl"), "", "utf8");
  await writeFile(join(changesPath, "releases.jsonl"), "", "utf8");
  await writePendingChange(root, "demo.md", `
---
id: aaaabb123456
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Flat pending Markdown entries coexist with JSON ledger files in the same change directory.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("change check passed");

  const listed = await runSkillsetCli("change", "list", "--root", root);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout).toContain("@aaaabb");
  expect(listed.stdout).not.toContain("history.jsonl");
  expect(listed.stdout).not.toContain("state.json");
});

test("SET-114: repeated pending entries can share current evidence for stacked changes", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: stacked-change-root
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

  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nChanged body for stacked entries.\n");
  const report = await changeStatus(root, { since: "HEAD" });
  const demo = report.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();

  await writePendingChange(root, "first.md", `
---
id: 111111abcdef
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
  - scope: skill:demo
    currentHash: sha256:older-supplemental
---

First stacked branch reason keeps its own audit trail for the final source state.
`);
  await writePendingChange(root, "second.md", `
---
id: 222222abcdef
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
  - scope: skill:demo
    currentHash: sha256:older-supplemental
---

Second stacked branch reason also points at the final source state deliberately.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("stacked evidence: skill: demo");
  expect(checked.stdout).toContain("shared by 2 pending entries");
  expect(checked.stdout).toContain(".skillset/changes/first.md, .skillset/changes/second.md");
  expect(checked.stdout).not.toContain("shared by 3 pending entries");
  expect(checked.stdout).not.toContain("sha256:older-supplemental");
  expect(checked.stdout).toContain("change check passed");
});

test("SET-114: repeated pending entries still fail when one carries stale evidence", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: stale-stacked-change-root
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

  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nChanged body for stale stacked evidence.\n");
  const report = await changeStatus(root, { since: "HEAD" });
  const demo = report.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();

  await writePendingChange(root, "current.md", `
---
id: 333333abcdef
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Current branch reason covers the final source state for this stacked example.
`);
  await writePendingChange(root, "stale.md", `
---
id: 444444abcdef
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: sha256:stale
---

Older branch reason must be refreshed instead of silently covered by another entry.
`);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(1);
  expect(checked.stdout).toContain("stale.md: change-evidence-stale");
  expect(checked.stdout).toContain("change check found 1 error");
});

test("SET-35: change check rejects invalid pending entry shape, reason, and evidence", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "none",
    "--reason",
    "The dependency was removed from the skill and should still be visible as release-relevant setup drift."
  );
  expect(added.exitCode).toBe(0);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).toContain("change-bump-lower-than-suggested");
  expect(checked.stdout).toContain("1 warning");
});

test("SET-35: ambiguous change refs fail with candidates", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  const pendingFiles = (await readdir(join(root, ".skillset/changes"))).filter((file) => file.endsWith(".md"));
  expect(pendingFiles).toHaveLength(1);
  const pending = await readFile(join(root, ".skillset/changes", pendingFiles[0] ?? ""), "utf8");
  expect(pending).not.toContain("---");
  expect(pending).not.toContain("id:");
  expect(pending).toContain("Bump: patch");
  expect(pending).toContain("Group: linear:SET-36");
  expect(pending).toContain("Scope: skill:demo");
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).toContain('"type":"reason.created"');
  expect(ledger).toContain('"type":"change.covered"');
  expect(ledger).toContain('"hashSchema":"skillset-source-unit-v2"');

  const structuredAdd = await runSkillsetCli(
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
    "Recorded the structured mutation paths so automation can audit both files written by change add.",
    "--json"
  );
  expect(structuredAdd.exitCode).toBe(0);
  const structuredData = (JSON.parse(structuredAdd.stdout) as {
    data: { report: { entry: { path: string; ref: string; sourceHashes: Record<string, string[]> }; ledgerPath: string }; writes: string[] };
  }).data;
  expect(structuredData.writes).toEqual([
    structuredData.report.entry.path,
    structuredData.report.ledgerPath,
  ]);
  expect(structuredData.report.ledgerPath).toBe(".skillset/changes/ledger.jsonl");
  expect(Object.keys(structuredData.report.entry.sourceHashes)).not.toHaveLength(0);

  const structuredReason = await runSkillsetCli(
    "change",
    "reason",
    structuredData.report.entry.ref,
    "--root",
    root,
    "--reason",
    "Clarified the structured change reason while preserving a complete mutation path audit.",
    "--json"
  );
  expect(structuredReason.exitCode).toBe(0);
  expect((JSON.parse(structuredReason.stdout) as { data: { writes: string[] } }).data.writes).toEqual([
    structuredData.report.entry.path,
    ".skillset/changes/ledger.jsonl",
  ]);

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
});

test("SET-36: change reason appends stdin without changing the generated id", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const files = (await readdir(join(root, ".skillset/changes"))).filter((file) => file.endsWith(".md"));
  expect(files).toHaveLength(1);
  const pending = await readFile(join(root, ".skillset/changes", files[0] ?? ""), "utf8");
  const fullId = files[0]?.replace(/\.md$/, "") ?? "";
  expect(fullId.startsWith(id)).toBe(true);
  expect(pending).not.toContain("---");
  expect(pending).not.toContain("id:");
  expect(pending).toContain("Bump: patch");
  expect(pending).toContain("Scope: skill:demo");
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).toContain('"type":"reason.created"');
  expect(ledger).toContain('"type":"reason.updated"');
  expect(ledger).toContain(`"reasonId":"${fullId}"`);
});

test("SET-368: legacy change reason keeps frontmatter verbatim", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: legacy-change-reason-root
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
  const status = await changeStatus(root, { since: "HEAD" });
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  const pendingPath = join(root, ".skillset/changes/legacy-order.md");
  const frontmatter = [
    "---",
    "# preserve compatibility metadata bytes",
    "scope: skill:demo",
    "id: abcdef123456",
    "bump: patch",
    "evidence:",
    "  - scope: skill:demo # preserve evidence comment",
    `    currentHash: ${demo?.currentHash}`,
    "---",
    "",
  ].join("\n");
  await writePendingChange(
    root,
    "legacy-order.md",
    `${frontmatter}Initial compatibility reason with enough detail to pass validation.\n`
  );

  const updated = await runSkillsetCli(
    "change",
    "reason",
    "@abcdef123456",
    "--root",
    root,
    "--reason",
    "Updated compatibility reason while retaining the exact authored frontmatter block."
  );

  expect(updated.exitCode).toBe(0);
  const source = await readFile(pendingPath, "utf8");
  expect(source.startsWith(frontmatter)).toBe(true);
  expect(source).toContain("Updated compatibility reason while retaining");
});

test("SET-241: change migrate converts frontmatter entries to reason-only ledger entries", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: change-migrate-root
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
  const status = await changeStatus(root, { since: "HEAD" });
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();
  await writePendingChange(root, "legacy-name.md", `
---
id: abcdef123456
bump: patch
ignored: true
group:
  provider: linear
  id: SET-241
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Migrate this compatibility frontmatter entry without losing the release reason or its evidence.
`);

  const compatibilityCheck = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(compatibilityCheck.exitCode).toBe(0);
  expect(compatibilityCheck.stdout).toContain("change-frontmatter-compatibility");
  expect(compatibilityCheck.stdout).toContain("skillset change migrate --yes");

  const preview = await runSkillsetCli("change", "migrate", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("would migrate: .skillset/changes/legacy-name.md -> .skillset/changes/abcdef123456.md");
  expect(preview.stdout).toContain("previewed 1 frontmatter pending entry");
  expect(await Bun.file(join(root, ".skillset/changes/legacy-name.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);

  const migrated = await runSkillsetCli("change", "migrate", "--yes", "--root", root);
  expect(migrated.exitCode).toBe(0);
  expect(migrated.stdout).toContain("migrated: .skillset/changes/legacy-name.md -> .skillset/changes/abcdef123456.md");
  expect(migrated.stdout).toContain("ledger: .skillset/changes/ledger.jsonl");
  expect(await Bun.file(join(root, ".skillset/changes/legacy-name.md")).exists()).toBe(false);

  const pending = await readFile(join(root, ".skillset/changes/abcdef123456.md"), "utf8");
  expect(pending).not.toContain("---");
  expect(pending).not.toContain("id:");
  expect(pending).toContain("Migrate this compatibility frontmatter entry");
  expect(pending).toContain("Bump: patch");
  expect(pending).toContain("Group: linear:SET-241");
  expect(pending).toContain("Ignored: true");
  expect(pending).toContain("Scope: skill:demo");

  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).toContain('"type":"reason.created"');
  expect(ledger).toContain('"type":"change.ignored"');
  expect(ledger).toContain('"reasonId":"abcdef123456"');
  expect(ledger).toContain(demo?.currentHash ?? "missing-hash");

  const checked = await runSkillsetCli("change", "check", "--root", root, "--since", "HEAD");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).not.toContain("change-frontmatter-compatibility");
  expect(checked.stdout).toContain("0 warnings");
});

test("SET-241: change migrate rejects frontmatter entries with incomplete source evidence", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: change-migrate-evidence-root
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
  const status = await changeStatus(root, { since: "HEAD" });
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  expect(demo?.currentHash).toBeDefined();
  await writePendingChange(root, "missing-evidence.md", `
---
id: abcdef654321
bump: patch
scopes:
  - skill:demo
  - config:root
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Migrate should preserve evidence for every declared scope before rewriting this pending entry.
`);

  const migrated = await runSkillsetCli("change", "migrate", "--yes", "--root", root);
  expect(migrated.exitCode).toBe(1);
  expect(migrated.stderr).toContain("cannot migrate invalid frontmatter pending entries");
  expect(migrated.stderr).toContain("missing source hash evidence for config: root");
  expect(await Bun.file(join(root, ".skillset/changes/missing-evidence.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/changes/ledger.jsonl")).exists()).toBe(false);
});

test("SET-241: change write flags are scoped to explicit migration", async () => {
  const add = await runSkillsetCli("change", "add", "--yes");
  expect(add.exitCode).toBe(1);
  expect(add.stderr).toContain(
    "--yes is only supported with change ignore, change migrate, or change refresh"
  );

  const conflicting = await runSkillsetCli("change", "migrate", "--dry-run");
  expect(conflicting.exitCode).toBe(1);
  expect(conflicting.stderr).toContain("unknown option --dry-run");
});

test("SET-36: change show prefers pending refs and history reads applied records", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("SET-149: change amend appends correction records for applied history", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: change-amend-root
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
  await writeHistory(root, [
    {
      id: "123456abcdef",
      bump: "patch",
      scope: "skill:demo",
      reason: "Original applied history reason before the wording correction.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:history" }],
    },
  ]);

  const amended = await runSkillsetCli(
    "change",
    "amend",
    "@123456",
    "--root",
    root,
    "--reason",
    "Corrected applied history reason that should drive generated changelog wording."
  );
  expect(amended.exitCode).toBe(0);
  expect(amended.stdout).toContain("skillset: amended change @123456");
  expect(amended.stdout).toContain("changes/amendments.jsonl");
  expect(amended.stdout).toContain("Corrected applied history reason");

  const history = await runSkillsetCli("change", "history", "@123456", "--root", root);
  expect(history.exitCode).toBe(0);
  expect(history.stdout).toContain("Corrected applied history reason");
  expect(history.stdout).not.toContain("Original applied history reason");

  const historyJsonl = await readFile(join(root, ".skillset/changes/history.jsonl"), "utf8");
  expect(historyJsonl).toContain("Original applied history reason");
  const amendmentsJsonl = await readFile(join(root, ".skillset/changes/amendments.jsonl"), "utf8");
  expect(amendmentsJsonl).toContain("previousReason");
  expect(amendmentsJsonl).toContain("Corrected applied history reason");
});

test("SET-149: change amend refuses pending refs", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: pending-amend-root
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

Pending reason should use the pre-release correction command.
`);

  const amended = await runSkillsetCli(
    "change",
    "amend",
    "@abcdef",
    "--root",
    root,
    "--reason",
    "Attempted correction with enough detail to pass the reason validator."
  );
  expect(amended.exitCode).toBe(1);
  expect(amended.stderr).toContain("is pending; use skillset change reason before release");
});

test("SET-37: applied history generates standalone changelog projections without pending churn", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
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

  const lock = await readFile(join(root, "skillset.lock"), "utf8");
  expect(lock).toContain(`"kind": "changelog"`);
  expect(lock).toContain(`".skillset/skills/demo/CHANGELOG.md"`);
});

test("SET-149: amended change history regenerates changelog wording", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: amended-changelog-root
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
  await writeHistory(root, [
    {
      id: "111111aaaaaa",
      bump: "patch",
      scope: "skill:demo",
      reason: "Original wording before the applied correction.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:one" }],
    },
  ]);

  const amended = await runSkillsetCli(
    "change",
    "amend",
    "@111111",
    "--root",
    root,
    "--reason",
    "Amended changelog wording rendered from the source-side correction ledger."
  );
  expect(amended.exitCode).toBe(0);

  await buildSkillset(root);
  const changelog = await readFile(join(root, ".skillset/skills/demo/CHANGELOG.md"), "utf8");
  expect(changelog).toContain("Amended changelog wording rendered");
  expect(changelog).not.toContain("Original wording before");
});

test("SET-146: generated changelog drift points back to change reasons", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: changelog-drift-root
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
  await writeHistory(root, [
    {
      id: "111111aaaaaa",
      bump: "patch",
      scope: "skill:demo",
      reason: "Clarified the standalone skill behavior for applied history.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:one" }],
    },
  ]);
  await buildSkillset(root);
  await commitFixture(root);

  const changelogPath = join(root, ".skillset/skills/demo/CHANGELOG.md");
  await writeFile(changelogPath, `${await readFile(changelogPath, "utf8")}\nHand-edited generated changelog text.\n`);

  const status = await runSkillsetCli("change", "status", "--root", root, "--since", "HEAD");
  expect(status.exitCode).toBe(0);
  expect(status.stdout).toContain("generated ~ .skillset/skills/demo/CHANGELOG.md");
  expect(status.stdout).toContain("generated CHANGELOG.md files are managed projections");
  expect(status.stdout).toContain("skillset change reason <@ref>");
  expect(status.stdout).toContain("skillset change amend <@ref>");
  expect(status.stdout).toContain("skillset release amend <@ref>");

  const diff = await runSkillsetCli("diff", "--root", root);
  expect(diff.exitCode).toBe(0);
  expect(diff.stdout).toContain("~ .skillset/skills/demo/CHANGELOG.md");
  expect(diff.stdout).toContain("generated CHANGELOG.md files are managed projections");
});

test("SET-282: reconcile previews and applies output-wins skill edits", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: source-suggestion-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Original source body.
`,
  });
  await buildSkillset(root);

  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  await writeFile(
    generatedAbsolute,
    (await readFile(generatedAbsolute, "utf8")).replace(
      "Original source body.",
      "Edited generated body."
    ),
    "utf8"
  );

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: available");
  expect(preview.stdout).toContain("source wins: available");
  expect(preview.stdout).toContain("source: .skillset/skills/demo/SKILL.md");
  expect(preview.stdout).toContain("rerun with --use output --yes to apply");
  expect(preview.stdout).not.toContain("--use undefined");
  await expect(readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).resolves.toContain("Original source body.");

  const written = await runSkillsetCli("reconcile", generatedPath, "--use", "output", "--yes", "--root", root);
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("reconciled using output");
  expect(written.stdout).not.toContain("recovery: skillset restore");
  const source = await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8");
  expect(source).toContain("Edited generated body.");
  expect(source).not.toContain("metadata:");

  const removed = await runSkillsetCli("suggest-source", generatedPath, "--root", root);
  expect(removed.exitCode).toBe(1);
  expect(removed.stderr).toContain("expected command");
});

test("SET-322: reconcile preserves provider-rendered frontmatter for body-only edits", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-provider-frontmatter
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
implicit_invocation: false
---

Original source body.
`,
  });
  await buildSkillset(root);

  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const sourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const sourceBefore = await readFile(sourceAbsolute, "utf8");
  const frontmatterBefore = sourceBefore.slice(0, sourceBefore.indexOf("Original source body."));
  const expected = await readFile(generatedAbsolute, "utf8");
  expect(expected).toContain("disable-model-invocation: true");
  await writeFile(
    generatedAbsolute,
    expected
      .replace("Original source body.", "Edited generated body.")
      .replaceAll("\n", "\r\n"),
    "utf8"
  );

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: available");

  const written = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(written.exitCode).toBe(0);
  const sourceAfter = await readFile(sourceAbsolute, "utf8");
  expect(sourceAfter).toContain("Edited generated body.");
  expect(sourceAfter.slice(0, sourceAfter.indexOf("Edited generated body."))).toBe(
    frontmatterBefore
  );
});

test("SET-322: reconcile refuses generated frontmatter divergence before writes", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-frontmatter-divergence
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Original source body.
`,
  });
  await buildSkillset(root);

  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const originalSource = await readFile(sourcePath, "utf8");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const editedGenerated = (await readFile(generatedAbsolute, "utf8"))
    .replace("---\n", "---\n# generated-only frontmatter comment\n")
    .replace("Original source body.", "Edited generated body.");
  await writeFile(generatedAbsolute, editedGenerated, "utf8");

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );
  expect(preview.stdout).toContain(
    `skillset reconcile ${generatedPath} --use source --yes`
  );

  const structured = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--json",
    "--root",
    root
  );
  expect(structured.exitCode).toBe(0);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: {
        outputResolution: {
          nextSteps: expect.arrayContaining([
            `Run \`skillset reconcile ${generatedPath} --use source --yes\` to restore the generated output.`,
          ]),
          status: "refused",
          wouldWrite: false,
          wrote: false,
        },
      },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );
  expect(await readFile(sourcePath, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(editedGenerated);
});

test("SET-322: reconcile refuses output absent from the current render", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-removed-target
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Source body.
`,
  });
  await buildSkillset(root);

  const sourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const originalGenerated = await readFile(generatedAbsolute, "utf8");
  await writeFile(
    sourceAbsolute,
    "---\nname: demo\ndescription: Demo.\nclaude: false\n---\n\nSource body.\n",
    "utf8"
  );
  const originalSource = await readFile(sourceAbsolute, "utf8");

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain("managed path is absent from the current rendered output");

  const structured = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--json",
    "--root",
    root
  );
  expect(structured.exitCode).toBe(0);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: {
        outputResolution: {
          nextSteps: ["Update the adaptive source manually, then run `skillset build --yes`."],
          status: "refused",
          wouldWrite: false,
          wrote: false,
        },
      },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("managed path is absent from the current rendered output");
  expect(await readFile(sourceAbsolute, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(originalGenerated);
});

test("SET-322: output resolution refuses stale ownership after a path remap", async () => {
  const staleSourcePath = ".stale/skills/demo/SKILL.md";
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-ownership-remap
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Current source.
---

Current source body.
`,
    [staleSourcePath]: `
---
name: demo
description: Stale source.
---

Stale source body.
`,
  });
  await buildSkillset(root);

  const currentSourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const staleSourceAbsolute = join(root, staleSourcePath);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const originalCurrentSource = await readFile(currentSourceAbsolute, "utf8");
  const originalStaleSource = await readFile(staleSourceAbsolute, "utf8");
  const originalGenerated = await readFile(generatedAbsolute, "utf8");
  const ownershipEntries = [{
    files: [generatedPath],
    kind: "standalone-skill",
    outputPath: generatedPath,
    outputRoot: ".claude/skills",
    sourcePath: staleSourcePath,
    target: "claude",
  }] as const;

  const preview = await suggestSource(root, generatedPath, { ownershipEntries });
  expect(preview).toMatchObject({
    message: "Current rendered ownership differs from the selected lock ownership; output resolution was refused.",
    sourcePath: staleSourcePath,
    status: "refused",
    wouldWrite: false,
    wrote: false,
  });

  const refusedWrite = await suggestSource(root, generatedPath, {
    ownershipEntries,
    write: true,
  });
  expect(refusedWrite).toMatchObject({
    status: "refused",
    wouldWrite: false,
    wrote: false,
  });
  expect(await readFile(currentSourceAbsolute, "utf8")).toBe(originalCurrentSource);
  expect(await readFile(staleSourceAbsolute, "utf8")).toBe(originalStaleSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(originalGenerated);
});

test("SET-295: output resolution preserves the canonical ambiguous-ownership refusal", async () => {
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const ownershipEntries = [
    {
      files: [generatedPath],
      kind: "standalone-skill",
      outputPath: generatedPath,
      outputRoot: ".claude/skills",
      sourcePath: ".skillset/skills/alpha/SKILL.md",
      target: "claude",
    },
    {
      files: [generatedPath],
      kind: "standalone-skill",
      outputPath: generatedPath,
      outputRoot: ".claude/skills",
      sourcePath: ".skillset/skills/beta/SKILL.md",
      target: "claude",
    },
  ] as const;

  const preview = await suggestSource("/workspace", generatedPath, {
    ownershipEntries,
  });

  expect(preview).toMatchObject({
    message: "Generated path has multiple source owners.",
    status: "refused",
    wouldWrite: false,
    wrote: false,
  });
});

test("SET-322: reconcile structurally refuses unclosed generated frontmatter", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-unclosed-frontmatter
claude: true
codex: false
cursor: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Source body.
`,
  });
  await buildSkillset(root);

  const sourceAbsolute = join(root, ".skillset/skills/demo/SKILL.md");
  const originalSource = await readFile(sourceAbsolute, "utf8");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const malformedGenerated = "---\nname: demo\ndescription: Unclosed generated frontmatter.\n";
  await writeFile(generatedAbsolute, malformedGenerated, "utf8");

  const preview = await runSkillsetCli("reconcile", generatedPath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );

  const structured = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--json",
    "--root",
    root
  );
  expect(structured.exitCode).toBe(0);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: {
        outputResolution: {
          status: "refused",
          wouldWrite: false,
          wrote: false,
        },
      },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain(
    "Generated frontmatter differs from the expected rendered frontmatter"
  );
  expect(await readFile(sourceAbsolute, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(malformedGenerated);
});

test("SET-322: reconcile keeps provider-native skill islands out of output resolution", async () => {
  const sourcePath = ".skillset/_claude/skills/native/SKILL.md";
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: reconcile-provider-native
claude: true
codex: false
`,
    [sourcePath]: `
---
name: native
description: Provider-native skill.
---

Provider-native source body.
`,
  });
  await buildSkillset(root);

  const sourceAbsolute = join(root, sourcePath);
  const originalSource = await readFile(sourceAbsolute, "utf8");
  const generatedPath = ".claude/skills/native/SKILL.md";
  const generatedAbsolute = join(root, generatedPath);
  const editedGenerated = (await readFile(generatedAbsolute, "utf8")).replace(
    "Provider-native source body.",
    "Edited generated body."
  );
  await writeFile(generatedAbsolute, editedGenerated, "utf8");

  const refused = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Only generated skill Markdown body edits are suggestible in v1");
  expect(await readFile(sourceAbsolute, "utf8")).toBe(originalSource);
  expect(await readFile(generatedAbsolute, "utf8")).toBe(editedGenerated);
});

test("SET-282: reconcile rejects adaptive source paths before writing", async () => {
  const sourcePath = ".skillset/skills/demo/SKILL.md";
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-source-path\nclaude: true\ncodex: false\n",
    [sourcePath]: "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);

  const result = await runSkillsetCli(
    "reconcile",
    sourcePath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("reconcile requires a managed generated path");
  expect(result.stderr).toContain(`${sourcePath} is source`);
});

test("SET-282: reconcile applies source-wins with output backup safety", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-source\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await writeFile(join(root, generatedPath), "---\nname: demo\ndescription: Demo.\n---\n\nOutput edit.\n", "utf8");

  const result = await runSkillsetCli("reconcile", `./${generatedPath}`, "--use", "source", "--yes", "--root", root);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("reconciled using source");
  expect(result.stdout).not.toContain("output next:");
  expect(result.stdout).toContain("recovery: skillset restore ");
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("Source body.");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).not.toContain("Output edit.");

  await rm(join(root, generatedPath));
  const rebuilt = await runSkillsetCli("reconcile", generatedPath, "--use", "source", "--yes", "--root", root);
  expect(rebuilt.exitCode).toBe(0);
  expect(rebuilt.stdout).toContain("reconciled using source");
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("Source body.");

  await writeFile(
    join(root, generatedPath),
    "---\nname: demo\ndescription: Broken output without a closing fence.\n",
    "utf8"
  );
  const recovered = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );
  expect(recovered.exitCode).toBe(0);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("Source body.");

  const structured = await runSkillsetCli("reconcile", generatedPath, "--root", root, "--json");
  expect(structured.exitCode).toBe(0);
  expect(structured.stderr).toBe("");
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "reconcile",
    data: {
      report: { generatedPath, sourceResolutionAvailable: true },
      state: "planned",
      writes: [],
    },
    kind: "data",
    ok: true,
  });
});

test("SET-282: failed output-wins reconciliation restores source", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-invalid-output\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nOriginal source body.\n",
  });
  await buildSkillset(root);
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const originalSource = await readFile(sourcePath, "utf8");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedSource = await readFile(join(root, generatedPath), "utf8");
  await writeFile(
    join(root, generatedPath),
    generatedSource.replace("Original source body.", "See [missing](shared:references/missing.md)."),
    "utf8"
  );

  const result = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("links to undeclared shared resource");
  expect(await readFile(sourcePath, "utf8")).toBe(originalSource);
});

test("SET-282: source-wins removes edited output after its source is deleted", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-removed-source\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
    ".skillset/skills/keep/SKILL.md": "---\nname: keep\ndescription: Keep.\n---\n\nKeep body.\n",
  });
  await buildSkillset(root);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await writeFile(join(root, generatedPath), "Edited managed output.\n", "utf8");
  await rm(join(root, ".skillset/skills/demo"), { recursive: true });

  const result = await runSkillsetCli(
    "reconcile",
    generatedPath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("reconciled using source");
  expect(result.stdout).not.toContain("output next:");
  expect(await Bun.file(join(root, generatedPath)).exists()).toBe(false);
});

test("SET-282: reconcile refuses to overwrite unrelated generated drift", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-scope\nclaude: true\ncodex: false\n",
    ".skillset/skills/alpha/SKILL.md":
      "---\nname: alpha\ndescription: Alpha.\n---\n\nAlpha source.\n",
    ".skillset/skills/beta/SKILL.md":
      "---\nname: beta\ndescription: Beta.\n---\n\nBeta source.\n",
  });
  await buildSkillset(root);
  const alphaPath = ".claude/skills/alpha/SKILL.md";
  const betaPath = ".claude/skills/beta/SKILL.md";
  await writeFile(join(root, alphaPath), "---\nname: alpha\n---\n\nAlpha output edit.\n", "utf8");
  await writeFile(join(root, betaPath), "---\nname: beta\n---\n\nBeta output edit.\n", "utf8");

  const preview = await runSkillsetCli("reconcile", alphaPath, "--root", root);
  expect(preview.exitCode).toBe(1);
  expect(preview.stderr).toContain(betaPath);

  const result = await runSkillsetCli(
    "reconcile",
    alphaPath,
    "--use",
    "source",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unrelated generated drift exists");
  expect(result.stderr).toContain(betaPath);
  expect(await readFile(join(root, alphaPath), "utf8")).toContain("Alpha output edit.");
  expect(await readFile(join(root, betaPath), "utf8")).toContain("Beta output edit.");
});

test("SET-282: reconcile refuses sibling target drift from the same source", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-siblings\nclaude: true\ncodex: true\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);
  const claudePath = ".claude/skills/demo/SKILL.md";
  const codexPath = ".agents/skills/demo/SKILL.md";
  await writeFile(join(root, claudePath), "---\nname: demo\n---\n\nClaude edit.\n", "utf8");
  await writeFile(join(root, codexPath), "---\nname: demo\n---\n\nCodex edit.\n", "utf8");

  const preview = await runSkillsetCli("reconcile", claudePath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("source wins: available");
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(codexPath);
  expect(preview.stdout).not.toContain("rerun with --use output --yes");

  const result = await runSkillsetCli(
    "reconcile", claudePath, "--use", "output", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(codexPath);
  expect(await readFile(join(root, claudePath), "utf8")).toContain("Claude edit.");
  expect(await readFile(join(root, codexPath), "utf8")).toContain("Codex edit.");
});

test("SET-282: output-wins normalizes equivalent selected paths", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-normalized\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nSource body.\n",
  });
  await buildSkillset(root);
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const generatedSource = await readFile(join(root, generatedPath), "utf8");
  await writeFile(
    join(root, generatedPath),
    generatedSource.replace("Source body.", "Output edit."),
    "utf8"
  );

  const result = await runSkillsetCli(
    "reconcile",
    resolve(root, generatedPath),
    "--use",
    "output",
    "--yes",
    "--root",
    root
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("reconciled using output");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Output edit.");
});

test("SET-282: source-wins rebuilds sibling target drift", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-source-siblings\nclaude: true\ncodex: true\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nInitial source.\n",
  });
  await buildSkillset(root);
  const claudePath = ".claude/skills/demo/SKILL.md";
  const codexPath = ".agents/skills/demo/SKILL.md";
  await writeFile(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n\nUpdated source.\n", "utf8");
  await writeFile(join(root, claudePath), "---\nname: demo\n---\n\nClaude edit.\n", "utf8");

  const preview = await runSkillsetCli("reconcile", claudePath, "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("source wins: available");

  const result = await runSkillsetCli(
    "reconcile", claudePath, "--use", "source", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(root, claudePath), "utf8")).toContain("Updated source.");
  expect(await readFile(join(root, codexPath), "utf8")).toContain("Updated source.");
});

test("SET-282: source-wins deletes stale sibling outputs", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-stale-sibling\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Source body.
`,
  });
  await buildSkillset(root);
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const skillPath = ".claude/skills/demo/SKILL.md";
  const staleSiblingPath = ".claude/skills/demo/references/guide.md";
  await writeFile(
    sourcePath,
    "---\nname: demo\ndescription: Demo.\n---\n\nSource body without the reference.\n",
    "utf8"
  );

  const result = await runSkillsetCli(
    "reconcile", skillPath, "--use", "source", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(0);
  expect(await Bun.file(join(root, staleSiblingPath)).exists()).toBe(false);
  expect(await readFile(join(root, skillPath), "utf8")).toContain("without the reference");
});

test("SET-282: reconcile refuses sibling resource drift from the same output", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-resources\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Source guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Source body.
`,
  });
  await buildSkillset(root);
  const skillPath = ".claude/skills/demo/SKILL.md";
  const guidePath = ".claude/skills/demo/references/guide.md";
  await writeFile(join(root, skillPath), "---\nname: demo\n---\n\nOutput edit.\n", "utf8");
  await writeFile(join(root, guidePath), "# Output guide edit\n", "utf8");

  const preview = await runSkillsetCli(
    "reconcile", skillPath, "--use", "output", "--root", root
  );
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain(guidePath);

  const result = await runSkillsetCli(
    "reconcile", skillPath, "--use", "output", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unrelated generated drift exists");
  expect(result.stderr).toContain(guidePath);
  expect(await readFile(join(root, skillPath), "utf8")).toContain("Output edit.");
  expect(await readFile(join(root, guidePath), "utf8")).toBe("# Output guide edit\n");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Source body.");
});

test("SET-282: reconcile accepts a selected secondary lock file", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: reconcile-secondary\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Source guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Read the guide.
`,
  });
  await buildSkillset(root);
  const secondaryPath = ".claude/skills/demo/references/guide.md";
  await writeFile(join(root, secondaryPath), "# Edited guide\n", "utf8");

  const result = await runSkillsetCli(
    "reconcile", secondaryPath, "--use", "source", "--yes", "--root", root
  );

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(root, secondaryPath), "utf8")).toBe("# Source guide\n");

  await writeFile(join(root, secondaryPath), "# Edited guide again\n", "utf8");
  const refused = await runSkillsetCli(
    "reconcile", secondaryPath, "--use", "output", "--yes", "--root", root
  );

  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Auxiliary skill outputs cannot replace the owning SKILL.md source body");
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Read the guide.");
  expect(await readFile(join(root, ".skillset/shared/references/guide.md"), "utf8")).toBe("# Source guide\n");
});

test("SET-282: --write is rejected outside check", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: write-route\nclaude: true\ncodex: false\n",
  });
  for (const args of [
    ["build", "--write", "--root", root],
    ["reconcile", "missing", "--write", "--root", root],
  ]) {
    const result = await runSkillsetCli(...args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--write is only supported with check");
  }
});

test("SET-282: reconcile rejects retired source and output root options", async () => {
  for (const flag of ["--source", "--dist"]) {
    const result = await runSkillsetCli("reconcile", "missing", flag, "alternate");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`unknown option ${flag}`);
  }
});

test("SET-282: reconcile refuses output-wins generated changelog edits", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: changelog-source-suggestion-root
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
  await writeHistory(root, [
    {
      id: "111111aaaaaa",
      bump: "patch",
      scope: "skill:demo",
      reason: "Generated changelog content comes from applied history.",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:one" }],
    },
  ]);
  await buildSkillset(root);

  const preview = await runSkillsetCli("reconcile", ".skillset/skills/demo/CHANGELOG.md", "--use", "output", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("output wins: refused");
  expect(preview.stdout).toContain("rerun with --use source --yes to apply");
  expect(preview.stdout).not.toContain("choose --use source or --use output");
  expect(preview.stdout).not.toContain("rerun with --use output --yes");

  const refused = await runSkillsetCli("reconcile", ".skillset/skills/demo/CHANGELOG.md", "--use", "output", "--yes", "--root", root);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("Generated changelogs are managed projections");
});

test("SET-37: plugin changelog aggregates child skill applied records", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    ".skillset/skills/untouched/SKILL.md": `
---
name: untouched
description: Unchanged release neighbor.
version: 0.1.0
---

Unchanged body.
`,
  });
  await buildSkillset(root);
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
  const planJson = await runSkillsetCli("release", "plan", "--json", "--root", root);
  expect(planJson.exitCode).toBe(0);
  expect(JSON.parse(planJson.stdout)).toMatchObject({
    command: "release.plan",
    data: { entries: [expect.objectContaining({ id: "aaaabbbbcccc" })] },
    schemaVersion: "skillset.cli.result@1",
  });

  const preview = await runSkillsetCli("release", "apply", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("rerun release apply with --yes to write release state");
  expect(await Bun.file(join(root, ".skillset/changes/state.json")).exists()).toBe(false);

  await writeFile(join(root, ".claude/skills/demo/SKILL.md"), "hand edit\n", "utf8");

  const applied = await runSkillsetCli("release", "apply", "--yes", "--json", "--root", root);
  expect(applied.exitCode).toBe(0);
  const appliedEnvelope = JSON.parse(applied.stdout) as {
    data: { result: { files: string[] }; writes: string[] };
  };
  expect(appliedEnvelope.data.writes).toContain(".claude/skills/demo/SKILL.md");
  expect(appliedEnvelope.data.writes).not.toContain(".claude/skills/untouched/SKILL.md");
  const backupManifest = appliedEnvelope.data.writes.find((path) =>
    /^\.skillset\/snapshots\/[^/]+\/manifest\.json$/u.test(path)
  );
  expect(backupManifest).toBeDefined();
  expect(appliedEnvelope.data.result.files).toContain(backupManifest!);
  expect(await Bun.file(join(root, backupManifest!)).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/changes/demo.md")).exists()).toBe(false);

  const state = JSON.parse(await readFile(join(root, ".skillset/changes/state.json"), "utf8")) as {
    scopes: Record<string, { version: string; sourceHash: string }>;
  };
  expect(state.scopes["skill:demo"]?.version).toBe("0.1.1");
  expect(state.scopes["skill:demo"]?.sourceHash).toBe(demo?.currentHash);
  const ledger = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
  expect(ledger).toContain('"type":"release.applied"');
  expect(ledger).toContain('"selector":"skill:demo"');
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

  const noOpJson = await runSkillsetCli("release", "apply", "--yes", "--json", "--root", root);
  expect(noOpJson.exitCode).toBe(0);
  expect(JSON.parse(noOpJson.stdout)).toMatchObject({
    command: "release.apply",
    data: {
      result: { files: [] },
      state: "planned",
      writes: [],
    },
    schemaVersion: "skillset.cli.result@1",
  });

  await writeFile(join(root, ".skillset/changes/state.json"), "{nope\n", "utf8");
  const derivedState = await readReleaseState(root);
  expect(derivedState.scopes["skill:demo"]?.version).toBe("0.1.1");
  expect(derivedState.scopes["skill:demo"]?.sourceHash).toBe(demo?.currentHash);
  await rm(join(root, ".skillset/changes/state.json"));
  const ledgerOnlyState = await readReleaseState(root);
  expect(ledgerOnlyState.scopes["skill:demo"]?.version).toBe("0.1.1");
  expect(ledgerOnlyState.scopes["skill:demo"]?.sourceHash).toBe(demo?.currentHash);
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

test("SET-150: release amend appends release metadata corrections", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: release-amend-root
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
    "---\nname: demo\ndescription: Demo.\nversion: 0.1.0\n---\n\nChanged body for release amend.\n"
  );
  const status = await changeStatus(root, { since: "HEAD" });
  const demo = status.sourceChanges.find((change) => change.id === "skill:demo");
  await writePendingChange(root, "demo.md", `
---
id: bbbbccccdddd
bump: patch
scope: skill:demo
evidence:
  - scope: skill:demo
    currentHash: ${demo?.currentHash}
---

Release the standalone skill body update before correcting release-event notes.
`);

  const applied = await runSkillsetCli("release", "apply", "--yes", "--root", root);
  expect(applied.exitCode).toBe(0);
  const [releaseRecord] = (await readFile(join(root, ".skillset/changes/releases.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { id: string });
  expect(releaseRecord?.id).toBeDefined();
  const ref = `@${releaseRecord!.id.slice(0, 6)}`;

  const amended = await runSkillsetCli(
    "release",
    "amend",
    ref,
    "--root",
    root,
    "--reason",
    "Corrected release-event notes after reviewing the generated changelog projection.",
    "--json"
  );
  expect(amended.exitCode).toBe(0);
  expect(JSON.parse(amended.stdout)).toMatchObject({
    command: "release.amend",
    data: {
      report: {
        amendmentPath: ".skillset/changes/release-amendments.jsonl",
        release: { ref },
      },
      state: "written",
      writes: [".skillset/changes/release-amendments.jsonl"],
    },
    schemaVersion: "skillset.cli.result@1",
  });

  const amendments = await readFile(join(root, ".skillset/changes/release-amendments.jsonl"), "utf8");
  expect(amendments).toContain(releaseRecord!.id);
  expect(amendments).toContain("Corrected release-event notes");
});

test("SET-150: release amend rejects short release refs", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: short-release-ref-root
claude: true
codex: false
`,
  });

  const amended = await runSkillsetCli(
    "release",
    "amend",
    "@abc",
    "--root",
    root,
    "--reason",
    "Attempted release metadata correction with a ref that is intentionally too short."
  );
  expect(amended.exitCode).toBe(1);
  expect(amended.stderr).toContain("must include at least 6 characters");
});

test("SET-111: release audit reports generated version drift without writing", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  const cleanJson = await runSkillsetCli("release", "audit", "--json", "--root", root);
  expect(cleanJson.exitCode).toBe(0);
  expect(JSON.parse(cleanJson.stdout)).toMatchObject({
    command: "release.audit",
    data: { issues: [] },
    schemaVersion: "skillset.cli.result@1",
  });

  const manifestPath = join(root, "plugins/alpha/codex/.codex-plugin/plugin.json");
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
  expect(yesFlag.stderr).toContain("--yes is only supported with release apply");

  const dryRun = await runSkillsetCli("release", "audit", "--dry-run", "--root", root);
  expect(dryRun.exitCode).toBe(1);
  expect(dryRun.stderr).toContain("unknown option --dry-run");
});

test("SET-111: release audit reports Claude marketplace plugin version drift", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  const marketplacePath = join(root, ".claude-plugin/marketplace.json");
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
    "skillset.yaml": `
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
  expect(await readFile(join(root, "plugins/alpha/claude/.claude-plugin/plugin.json"), "utf8")).toContain('"version": "0.2.0"');
  expect(await readFile(join(root, "plugins/alpha/claude/skills/child/SKILL.md"), "utf8")).toContain("version: 0.2.0");
});

test("SET-38: bump none releases audit entries while ignored entries stay out of changelogs", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  const checked = await runSkillsetCli("check", "--only", "outputs", "--root", root);
  expect(checked.exitCode).toBe(1);
  expect(checked.stderr).toContain("release state scope skill:demo.version");
  expect(checked.stderr).toContain("semantic version");
});

test("SET-25: diff reports missing managed outputs separately", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  await expect(verifySkillset(root)).rejects.toThrow("missing managed generated file: .claude/skills/demo/SKILL.md");
});

test("SET-19: CLI restores backed up unmanaged output collisions", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: restore-root
claude: false
codex: true
`,
    ".skillset/rules/root.md": `
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
	  expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);
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

  const structuredPreview = await runSkillsetCli("restore", backupId, "--root", root, "--json");
  expect(structuredPreview.exitCode).toBe(0);
  expect(structuredPreview.stderr).toBe("");
  expect(JSON.parse(structuredPreview.stdout)).toMatchObject({
    command: "restore",
    data: { state: "planned", writes: [] },
    ok: true,
  });

  const restored = await runSkillsetCli("restore", backupId, "--root", root, "--yes");
  expect(restored.exitCode).toBe(0);
  expect(restored.stdout).toContain("restored 1 file");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Existing Instructions");
});

test("SET-331: CLI lists integrity-checked output backups without writing", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: restore-list-root
claude: false
codex: true
`,
    ".skillset/rules/root.md": `
# Generated Instructions
`,
    "AGENTS.md": `
# Existing Instructions
`,
  });

  const empty = await runSkillsetCli("restore", "--list", "--root", root);
  expect(empty.exitCode).toBe(0);
  expect(empty.stdout).toBe("skillset: no output backups found\n");
  expect(await Bun.file(join(root, ".skillset/snapshots")).exists()).toBe(false);

  const build = await runSkillsetCli("build", "--root", root, "--yes");
  expect(build.exitCode).toBe(0);
  const backupId = extractBackupId(build.stderr);
  const manifestPath = `.skillset/snapshots/${backupId}/manifest.json`;
  const manifestBefore = await readFile(join(root, manifestPath), "utf8");

  const listed = await runSkillsetCli("restore", "--list", "--root", root);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout).toContain(`restorable-now: ${backupId}`);
  expect(listed.stdout).toContain(`manifest: ${manifestPath}`);
  expect(listed.stdout).toContain("restorable-now: overwrite unmanaged-collision AGENTS.md");
  expect(listed.stdout).toContain(`restore: skillset restore ${backupId} --yes`);
  expect(await readFile(join(root, manifestPath), "utf8")).toBe(manifestBefore);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Generated Instructions");

  const structured = await runSkillsetCli("restore", "--list", "--root", root, "--json");
  expect(structured.exitCode).toBe(0);
  expect(structured.stderr).toBe("");
  expect(structured.stdout.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(structured.stdout)).toMatchObject({
    command: "restore",
    data: {
      report: {
        runs: [{
          manifestPath,
          records: [{
            action: "overwrite",
            reason: "unmanaged-collision",
            state: "restorable-now",
            targetPath: "AGENTS.md",
          }],
          runId: backupId,
          state: "restorable-now",
        }],
      },
      state: "planned",
      writes: [],
    },
    ok: true,
  });

  const restored = await runSkillsetCli("restore", backupId, "--root", root, "--yes");
  expect(restored.exitCode).toBe(0);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("# Existing Instructions");
});

test("SET-25: CLI parses build mode and scope flags", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const scoped = await runSkillsetCli("build", "--root", root, "--scope", "repo,plugins", "--all");
  expect(scoped.exitCode).toBe(0);
  expect(scoped.stdout).toContain("write confirmation required");

  const scopedWrite = await runSkillsetCli("build", "--root", root, "--scope", "repo", "--yes");
  expect(scopedWrite.exitCode).toBe(0);
  expect(scopedWrite.stdout).toContain("wrote");

  const conflicting = await runSkillsetCli("build", "--root", root, "--updated", "--all");
  expect(conflicting.exitCode).toBe(1);
  expect(conflicting.stderr).toContain("conflicting build mode flags");

  const unknownScope = await runSkillsetCli("build", "--root", root, "--scope", "nope");
  expect(unknownScope.exitCode).toBe(1);
  expect(unknownScope.stderr).toContain("expected --scope");
});

test("SET-25: scope filters build, diff, and list output", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  expect(await Bun.file(join(root, "plugins/alpha/claude/skills/plugin-skill/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".claude/skills/repo-skill/SKILL.md")).exists()).toBe(false);

  const repoDiff = await runSkillsetCli("diff", "--root", root, "--scope", "repo");
  expect(repoDiff.exitCode).toBe(0);
  expect(repoDiff.stdout).toContain(".claude/skills/repo-skill/SKILL.md");
  expect(repoDiff.stdout).not.toContain("plugins/alpha/claude");

  const pluginList = await runSkillsetCli("list", "--details", "--root", root, "--scope", "plugins");
  expect(pluginList.exitCode).toBe(0);
  expect(pluginList.stdout).toContain("plugins/alpha/claude");
  expect(pluginList.stdout).not.toContain(".claude/skills/repo-skill");
});

test("SET-25: scoped commands ignore corrupt locks outside the selected scope", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  await writeFile(join(root, "plugins/skillset.lock"), "{ not valid json", "utf8");

  await expect(diffSkillset(root, { scopes: ["repo"] })).resolves.toEqual({
    added: [],
    changed: [],
    missing: [],
    removed: [],
  });
  await expect(verifySkillset(root, { scopes: ["repo"] })).resolves.toBeDefined();
  await expect(buildSkillset(root, { scopes: ["repo"] })).resolves.toBeDefined();

  const explained = await runSkillsetCli("explain", ".claude/skills/repo-skill/SKILL.md", "--root", root, "--scope", "repo");
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain(".skillset/skills/repo-skill/SKILL.md");
});

test("SET-25: updated mode skips unchanged files while all mode rewrites", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  const claudeManifest = await readFile(join(root, "plugins/alpha/claude/.claude-plugin/plugin.json"), "utf8");
  const codexManifest = await readFile(join(root, "plugins/alpha/codex/.codex-plugin/plugin.json"), "utf8");
  const claudeMcp = await readFile(join(root, "plugins/alpha/claude/.mcp.json"), "utf8");
  const lock = await readFile(join(root, "plugins/skillset.lock"), "utf8");
  expect(claudeManifest).toContain(`"mcpServers": "./.mcp.json"`);
  expect(codexManifest).toContain(`"mcpServers": "./.mcp.json"`);
  expect(claudeMcp).toContain(`"alpha"`);
  expect(lock).toContain(`"kind": "plugin-feature"`);
  expect(lock).toContain(`"feature": "mcp"`);
  expect(lock).toContain(`"origin": "explicit"`);
  expect(lock).toContain(`"sourcePointer": "repo:integrations/alpha-mcp.json"`);

  const listed = await runSkillsetCli("list", "--details", "--root", root, "--scope", "plugins");
  expect(listed.stdout).toContain("plugin-feature mcp (explicit)");

  const explained = await runSkillsetCli("explain", "plugins/alpha/claude/.mcp.json", "--root", root);
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain("feature: mcp");
  expect(explained.stdout).toContain("origin: explicit");
  expect(explained.stdout).toContain("source pointer: repo:integrations/alpha-mcp.json");
});

test("SET-26: false disables conventional mcp discovery", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const manifest = await readFile(join(root, "plugins/alpha/claude/.claude-plugin/plugin.json"), "utf8");
  expect(manifest).not.toContain("mcpServers");
  expect(await fileExists(join(root, "plugins/alpha/claude/.mcp.json"))).toBe(false);
  expect(await fileExists(join(root, "plugins/alpha/codex/.mcp.json"))).toBe(false);
});

test("SET-26: mcp true requires and copies the conventional source", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  expect(await fileExists(join(root, "plugins/alpha/claude/.mcp.json"))).toBe(true);
  expect(await fileExists(join(root, "plugins/alpha/codex/.mcp.json"))).toBe(true);
  const lock = await readFile(join(root, "plugins/skillset.lock"), "utf8");
  expect(lock).toContain(`"feature": "mcp"`);
  expect(lock).toContain(`"origin": "conventional"`);
});

test("SET-26: conventional bin discovery copies Claude-only feature with provenance", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
cursor: false
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

  expect(await fileExists(join(root, "plugins/alpha/claude/bin/tool"))).toBe(true);
  const manifest = await readFile(join(root, "plugins/alpha/claude/.claude-plugin/plugin.json"), "utf8");
  expect(manifest).not.toContain("bin");
  const lock = await readFile(join(root, "plugins/skillset.lock"), "utf8");
  expect(lock).toContain(`"feature": "bin"`);
  expect(lock).toContain(`"origin": "conventional"`);
  expect(lock).toContain(`"targetState": "target-native"`);
});

test("SET-26: explicit bin source pointer copies Claude-only feature with provenance", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
cursor: false
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

  expect(await fileExists(join(root, "plugins/alpha/claude/bin/tool"))).toBe(true);
  const lock = await readFile(join(root, "plugins/skillset.lock"), "utf8");
  expect(lock).toContain(`"feature": "bin"`);
  expect(lock).toContain(`"origin": "explicit"`);
  expect(lock).toContain(`"sourcePointer": "repo:tools/alpha"`);
});

test("SET-26: bin fails loudly for enabled Codex plugin output", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  await expect(buildSkillset(root)).rejects.toThrow("codex plugin-bin unsupported");
  await expect(buildSkillset(root)).rejects.toThrow("Codex plugins do not expose a documented plugin-local bin contract.");
});

test("SET-26: repo source pointers reject escapes, generated roots, and missing paths", async () => {
  const escapeRoot = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
skillset:
  name: feature-root
claude: true
codex: false
`,
    "plugins/alpha/claude/alpha-mcp.json": `
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
  source: repo:plugins/alpha/claude/alpha-mcp.json
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
    "skillset.yaml": `
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
  await expectFeatureDiagnosticError(buildSkillset(missingRoot), {
    code: "plugin-mcp-invalid",
    featureId: "plugin-mcp",
    message: expect.stringContaining("points to missing path repo:missing/mcp.json"),
    path: ".skillset/plugins/alpha/skillset.yaml",
  });
});

test("SET-26: plugin feature source type mismatches fail loudly", async () => {
  const mcpDirectoryRoot = await contractFixture({
    "skillset.yaml": `
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
  await expectFeatureDiagnosticError(buildSkillset(mcpDirectoryRoot), {
    code: "plugin-mcp-invalid",
    featureId: "plugin-mcp",
    message: expect.stringContaining("feature mcp source must be a file"),
    path: ".skillset/plugins/alpha/skillset.yaml",
  });

  const binFileRoot = await contractFixture({
    "skillset.yaml": `
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
  await expectFeatureDiagnosticError(buildSkillset(binFileRoot), {
    code: "plugin-bin-invalid",
    featureId: "plugin-bin",
    message: expect.stringContaining("feature bin source must be a directory"),
    path: ".skillset/plugins/alpha/skillset.yaml",
  });
});

test("SET-26: mcp feature sources are validated as JSON", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    ".skillset/plugins/alpha/_claude/.mcp.json": `
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
    "plugins/managed/skillset.lock": "{}",
    "plugins/not-a-plugin/README.md": "no manifest here",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([
    { kind: "plugin", path: "plugins/alpha" },
    { kind: "plugin", path: "plugins/beta" },
  ]);
});

test("SET-256: init ignores retired provider-first generated plugin roots", async () => {
  const root = await contractFixture({
    "plugins-claude/plugins/alpha/.claude-plugin/plugin.json": JSON.stringify({ name: "alpha" }),
    "plugins-codex/plugins/beta/.codex-plugin/plugin.json": JSON.stringify({ name: "beta" }),
    "plugins/authored/.claude-plugin/plugin.json": JSON.stringify({ name: "authored" }),
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([{ kind: "plugin", path: "plugins/authored" }]);
});

test("SET-255: shared plugin lock does not hide authored plugin import candidates", async () => {
  const root = await contractFixture({
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "demo-marketplace",
      plugins: [
        { name: "authored", source: "./plugins/authored" },
        { name: "generated-claude", source: "./plugins/generated/claude" },
        { name: "generated-codex", source: "./plugins/generated/codex" },
        { name: "generated-cursor", source: "./plugins/generated/cursor" },
      ],
    }),
    "plugins/skillset.lock": "{}",
    "plugins/authored/.claude-plugin/plugin.json": JSON.stringify({ name: "authored" }),
    "plugins/generated/claude/.claude-plugin/plugin.json": JSON.stringify({ name: "generated-claude" }),
    "plugins/generated/codex/.codex-plugin/plugin.json": JSON.stringify({ name: "generated-codex" }),
    "plugins/generated/cursor/.cursor-plugin/plugin.json": JSON.stringify({ name: "generated-cursor" }),
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([{ kind: "plugin", path: "plugins/authored" }]);
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
      "<!-- Generated by skillset@0.1.0 from .skillset/rules. Do not edit directly. -->\n\n# Agents",
    "CLAUDE.md": "# Claude\n\nHandwritten guidance.",
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([{ kind: "instructions", path: "CLAUDE.md" }]);
});

test("SET-62: already-adopted repos suppress instruction candidates", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

test("SET-250: init accepts Cursor as an explicit setup target", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-cursor-"));

  const written = await runSkillsetCli("init", "--root", root, "--targets", "cursor", "--yes");

  expect(written.exitCode).toBe(0);
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("    - cursor");
});

test("SET-62: recognized-but-unimportable surfaces become structured survey skips", async () => {
  const root = await contractFixture({
    ".claude/commands/release.md": "Run the release.",
    ".gemini-plugin/plugin.json": JSON.stringify({ name: "foreign" }),
  });

  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });

  expect(report.importCandidates).toEqual([]);
  expect(report.surveySkips).toEqual([
    expect.objectContaining({
      renderResult: expect.objectContaining({
        featureId: "target-native-islands",
        sourceUnit: "claude.commands:commands",
        status: "intentionally_skipped",
        target: "claude",
      }),
      path: ".claude/commands",
      reason:
        "project-level commands have no portable source home yet; adopt will represent them as provider source in the transform milestone",
      surface: "commands",
    }),
    expect.objectContaining({
      renderResult: expect.objectContaining({
        featureId: "runtime-adapters",
        sourceUnit: "runtime-adapter:gemini",
        status: "intentionally_skipped",
      }),
      path: ".gemini-plugin",
      reason:
        "plugin manifest for an unsupported target; skillset can only represent claude, codex, cursor surfaces",
      surface: "foreign-manifest",
    }),
  ]);
});

test("SET-27: init previews by default and writes only with confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-init-"));

  const preview = await runSkillsetCli("init", "--root", root, "--targets", "claude");
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("write confirmation required");
  expect(preview.stdout).toContain("+ skillset.yaml");
  expect(await fileExists(join(root, "skillset.yaml"))).toBe(false);

  const written = await runSkillsetCli("init", "--root", root, "--targets", "claude", "--yes");
  expect(written.exitCode).toBe(0);
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  expect(config).toStartWith("# yaml-language-server: $schema=https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/workspace-config.schema.json\n");
  expect(config).toContain("name:");
  expect(config).toContain("compile:");
  expect(config).toContain("    - claude");
  expect(config).not.toContain("    - codex");
  expect(await fileExists(join(root, ".skillset/.gitkeep"))).toBe(true);
  for (const directory of ["agents", "hooks", "plugins", "rules", "shared", "skills", "_claude", "_codex"]) {
    expect(await fileExists(join(root, `.skillset/${directory}/.gitkeep`))).toBe(true);
  }
  expect(await fileExists(join(root, ".skillset/changes/.gitkeep"))).toBe(true);
  expect(await readFile(join(root, ".skillset/snapshots/.gitignore"), "utf8")).toBe("*\n!.gitignore\n");
  expect(await fileExists(join(root, ".skillset/cache/.gitignore"))).toBe(false);
  expect(await readFile(join(root, ".skillset/.gitignore"), "utf8")).toBe("cache/\nsnapshots/*\n!snapshots/.gitignore\n");
  expect(await fileExists(join(root, ".claude"))).toBe(false);
  expect(await fileExists(join(root, ".codex"))).toBe(false);
  expect(await fileExists(join(root, ".agents"))).toBe(false);
});

test("SET-209: init rejects retired layout flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-root-layout-"));

  const preview = await runSkillsetCli("init", "--root", root, "--layout", "root");
  expect(preview.exitCode).toBe(1);
  expect(preview.stderr).toContain("unknown option --layout");
  expect(await fileExists(join(root, "skillset.yaml"))).toBe(false);
});

test("SET-209: init layout flags stay retired in existing workspaces", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: ordinary\n",
  });

  for (const layout of ["root", "nested"]) {
    const result = await runSkillsetCli("init", "--root", root, "--layout", layout);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown option --layout");
  }
});

test("SET-27: init scaffolds optional CI only when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-setup-shaped-"));

  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(root, ".skillset/agents/.gitkeep"))).toBe(true);
  expect(await fileExists(join(root, ".github/workflows/skillset-ci.yml"))).toBe(false);

  const shaped = await mkdtemp(join(tmpdir(), "skillset-setup-shaped-"));
  await expect(
    runSkillsetCli("init", "--root", shaped, "--include", "ci", "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });
  expect(await fileExists(join(shaped, ".skillset/agents/.gitkeep"))).toBe(true);
  expect(await fileExists(join(shaped, ".github/workflows/skillset-ci.yml"))).toBe(true);
});

test("SET-143: init validates dedicated workspace roots instead of creating ordinary mode", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: dedicated-init
compile:
  targets:
    - claude
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
  });

  const preview = await runSkillsetCli("init", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("= skillset.yaml");
  expect(preview.stdout).toContain("+ .skillset/changes/.gitkeep");
  expect(preview.stdout).not.toContain("+ .skillset/cache/.gitignore");
  expect(preview.stdout).toContain("+ .skillset/snapshots/.gitignore");
  expect(await fileExists(join(root, "skillset.yaml"))).toBe(true);

  const written = await runSkillsetCli("init", "--root", root, "--yes");
  expect(written.exitCode).toBe(0);
  expect(await fileExists(join(root, ".skillset/changes/.gitkeep"))).toBe(true);
  expect(await fileExists(join(root, ".skillset/cache/.gitignore"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/snapshots/.gitignore"))).toBe(true);
  expect(await fileExists(join(root, "skillset.yaml"))).toBe(true);
});

test("SET-143: init accepts the canonical root config plus .skillset workspace", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: canonical\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });

  const initialized = await runSkillsetCli("init", "--root", root);
  expect(initialized.exitCode).toBe(0);
  expect(initialized.stdout).toContain("= skillset.yaml");
});

test("SET-312: create makes a named child under an explicit parent", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-create-"));

  const preview = await runSkillsetCli("create", "my-skillset", "--root", parent);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("my-skillset");
  expect(preview.stdout).toContain("+ README.md");
  expect(preview.stdout).toContain("+ AGENTS.md");
  expect(preview.stdout).toContain("+ .git");
  expect(preview.stdout).toContain("+ skillset.yaml");
  expect(await fileExists(join(parent, "my-skillset/skillset.yaml"))).toBe(false);
  expect(await fileExists(join(parent, "my-skillset/.git/config"))).toBe(false);

  const written = await runSkillsetCli("create", "my-skillset", "--root", parent, "--yes");
  expect(written.exitCode).toBe(0);
  const config = await readFile(join(parent, "my-skillset/skillset.yaml"), "utf8");
  const readme = await readFile(join(parent, "my-skillset/README.md"), "utf8");
  const agents = await readFile(join(parent, "my-skillset/AGENTS.md"), "utf8");
  const gitignore = await readFile(join(parent, "my-skillset/.gitignore"), "utf8");
  const lock = await readFile(join(parent, "my-skillset/skillset.lock"), "utf8");
  const createdRoot = join(parent, "my-skillset");
  expect(config).toStartWith("# yaml-language-server: $schema=https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/workspace-config.schema.json\n");
  expect(config).toContain("name: my-skillset");
  expect(config).toContain("compile:");
  for (const directory of ["agents", "hooks", "plugins", "rules", "shared", "skills", "_claude", "_codex"]) {
    expect(await fileExists(join(parent, `my-skillset/.skillset/${directory}/.gitkeep`))).toBe(true);
  }
  expect(await fileExists(join(parent, "my-skillset/.skillset/changes/.gitkeep"))).toBe(true);
  expect(await readFile(join(parent, "my-skillset/.skillset/.gitignore"), "utf8")).toBe("cache/\nsnapshots/*\n!snapshots/.gitignore\n");
  expect(await fileExists(join(parent, "my-skillset/.skillset/cache/.gitignore"))).toBe(false);
  expect(await readFile(join(parent, "my-skillset/.skillset/snapshots/.gitignore"), "utf8")).toBe("*\n!.gitignore\n");
  expect(gitignore).toBe(".skillset/cache/\n.skillset/snapshots/*\n!.skillset/snapshots/.gitignore\n");
  expect(JSON.parse(lock)).toEqual({
    generatedBy: "skillset@0.1.0",
    items: [],
    outputRoot: ".",
    schemaVersion: 1,
    target: "workspace",
  });
  expect(readme).toContain("# my-skillset");
  expect(readme).toContain("skillset build");
  expect(agents).toContain("Treat `.skillset/` as editable Skillset source");
  expect(await fileExists(join(createdRoot, ".git/config"))).toBe(true);
  await mkdir(join(createdRoot, ".skillset/cache"), { recursive: true });
  await writeFile(join(createdRoot, ".skillset/cache/runtime.txt"), "ignored\n");
  await runGit(createdRoot, "check-ignore", ".skillset/cache/runtime.txt");
  await runGit(createdRoot, "add", ".");
  await expect(runGit(createdRoot, "ls-files", "--error-unmatch", ".skillset/cache/.gitignore")).rejects.toThrow();
  await runGit(createdRoot, "ls-files", "--error-unmatch", ".skillset/snapshots/.gitignore");
});

test("SET-312: create uses its normalized name as directory and identity", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-create-custom-"));

  const written = await runSkillsetCli(
    "create",
    "Acme Loadout",
    "--root",
    parent,
    "--targets",
    "claude",
    "--yes"
  );
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("acme-loadout");
  expect(written.stdout).toContain("+ .git");

  const config = await readFile(join(parent, "acme-loadout/skillset.yaml"), "utf8");
  const readme = await readFile(join(parent, "acme-loadout/README.md"), "utf8");
  expect(config).toContain("name: acme-loadout");
  expect(config).toContain("    - claude");
  expect(config).not.toContain("    - codex");
  expect(readme).toContain("# acme-loadout");
  expect(readme).toContain("Default compile targets: claude.");
  expect(await fileExists(join(parent, "acme-loadout/.git/config"))).toBe(true);
});

test("SET-312: init refuses missing directories and create refuses collisions", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-boundaries-"));
  const missing = await runSkillsetCli("init", "missing", "--root", parent);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain("init directory does not exist");

  await mkdir(join(parent, "occupied"));
  await writeFile(join(parent, "occupied/README.md"), "existing\n");
  const occupied = await runSkillsetCli(
    "create",
    "occupied",
    "--root",
    parent,
    "--yes"
  );
  expect(occupied.exitCode).toBe(1);
  expect(occupied.stderr).toContain("create target must be empty");
  expect(await readFile(join(parent, "occupied/README.md"), "utf8")).toBe(
    "existing\n"
  );
});

test("SET-312: create JSON remains prompt-free and plan-first", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-json-"));
  const preview = await runSkillsetCli(
    "create",
    "json-demo",
    "--root",
    parent,
    "--json"
  );
  expect(preview.exitCode).toBe(0);
  const result = JSON.parse(preview.stdout);
  expect(result.command).toBe("create");
  expect(result.data.state).toBe("planned");
  expect(result.data.writes).toEqual([]);
  expect(result.data.report.rootPath).toBe(join(parent, "json-demo"));
  expect(await fileExists(join(parent, "json-demo"))).toBe(false);
});

test("SET-27: create supports global source path without touching runtime config", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillset-setup-home-"));

  const report = await createSkillset({ global: true, homeDir: home, write: true });

  expect(report.rootPath).toBe(join(home, ".skillset/source"));
  expect(await fileExists(join(home, ".skillset/source/skillset.yaml"))).toBe(true);
  expect(await fileExists(join(home, ".skillset/source/.skillset/hooks/.gitkeep"))).toBe(true);
  expect(await fileExists(join(home, ".skillset/source/README.md"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/AGENTS.md"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/.git/config"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/.skillset/.gitignore"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/.skillset/cache/.gitignore"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/.skillset/snapshots/.gitignore"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/.skillset/cache"))).toBe(false);
  expect(await fileExists(join(home, ".skillset/source/.skillset/snapshots"))).toBe(false);
  expect(await fileExists(join(home, ".claude"))).toBe(false);
  expect(await fileExists(join(home, ".codex"))).toBe(false);

  const removedCreate = await runSkillsetCli("create", "--global", "--root", home);
  expect(removedCreate.exitCode).toBe(1);
  expect(removedCreate.stderr).toContain("unknown option --global");

  await expect(createSkillset({ global: true, homeDir: home, include: ["ci"], write: false }))
    .rejects.toThrow("global setup does not support optional scaffold includes");
});

test("SET-27: setup refuses unsafe overwrite", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-setup-overwrite-"));
  await Bun.write(join(parent, "occupied/README.md"), "already here\n");

  const initOccupied = await runSkillsetCli("init", "occupied", "--root", parent, "--yes");
  expect(initOccupied.exitCode).toBe(0);
  expect(await readFile(join(parent, "occupied/README.md"), "utf8")).toBe("already here\n");

  const initRoot = await mkdtemp(join(tmpdir(), "skillset-setup-overwrite-"));
  await Bun.write(join(initRoot, "skillset.yaml"), "not: skillset\n");
  const init = await runSkillsetCli("init", "--root", initRoot, "--yes");
  expect(init.exitCode).toBe(1);
  expect(init.stderr).toContain("unsupported top-level key not");
});

test("SET-43: init defaults to git root and seeds release baselines", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  expect(await fileExists(join(root, "skillset.yaml"))).toBe(false);

  const scaffoldOnly = await runSkillsetCli("init", "--root", root, "--yes");
  expect(scaffoldOnly.exitCode).toBe(0);
  expect(await fileExists(join(root, ".claude/skills/demo/SKILL.md"))).toBe(true);
  expect(await fileExists(join(root, ".skillset/skills/demo/SKILL.md"))).toBe(false);
});

test("SET-43: init does not report managed output roots as import candidates", async () => {
  const root = await contractFixture({
    ".agents/skills/skillset.lock": "{}",
    ".agents/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
    "plugins/skillset.lock": "{}",
    "plugins/demo/codex/plugin.json": "{}",
  });

  const preview = await runSkillsetCli("init", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).not.toContain("? import candidate skills .agents/skills");
  expect(preview.stdout).not.toContain("? import candidate plugins plugins/");
});

test("SET-43: init rejects version conflicts with existing release state", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("SET-143: import writes into the detected dedicated source root", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: dedicated-import
  version: 1.0.0
compile:
  targets:
    - claude
    - codex
`,
  });
  const external = await mkdtemp(join(tmpdir(), "skillset-import-dedicated-"));
  await Bun.write(join(external, "SKILL.md"), `---
name: adopted
description: Adopted skill.
version: 3.4.5
---

Body.
`);

  const report = await importSource({ kind: "skill", rootPath: root, sourcePath: external });
  expect(report.targetPath).toBe(join(root, ".skillset/skills/adopted"));
  expect(await fileExists(join(root, ".skillset/skills/adopted/SKILL.md"))).toBe(true);
  expect(await fileExists(join(root, "skillset/skills/adopted/SKILL.md"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/changes/state.json"))).toBe(true);
});

test("SET-43: import seeds release baselines for adopted plugins", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  expect(initGlobal.stderr).toContain("unknown option --global");

  const createLayout = await runSkillsetCli("create", "--layout", "nested");
  expect(createLayout.exitCode).toBe(1);
  expect(createLayout.stderr).toContain("unknown option --layout");

  const buildTargets = await runSkillsetCli("build", "--targets", "claude");
  expect(buildTargets.exitCode).toBe(1);
  expect(buildTargets.stderr).toContain("setup options are only supported with init");

  const createGlobalPath = await runSkillsetCli("create", "team-loadout", "--global");
  expect(createGlobalPath.exitCode).toBe(1);
  expect(createGlobalPath.stderr).toContain("unknown option --global");
});

test("SET-9: explain resolves source and generated paths via lock provenance", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
  expect(source.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "standalone-skills",
      status: "rendered",
      target: "claude",
    })
  );
  expect(source.notes.join("\n")).toContain("claude");

  const generated = await explainPath(root, ".claude/skills/demo/SKILL.md");
  expect(generated.kind).toBe("generated");
  expect(generated.entries[0]?.sourcePath).toBe(".skillset/skills/demo/SKILL.md");
  expect(generated.entries[0]?.sourceHash).toBeDefined();
  expect(generated.renderResults[0]?.status).toBe("rendered");

  const unknown = await explainPath(root, "nope/missing.md");
  expect(unknown.kind).toBe("unknown");
  expect(unknown.renderResults).toEqual([]);
});

test("SET-9: doctor aggregates lint issues and drift, and passes when clean", async () => {
  const clean = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("SET-83: explain and doctor surface render results in text and JSON", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: outcome-root
claude: true
codex: true
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
dependencies:
  plugins:
    - name: external-tools
      range: "^2.1.0"
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });
  await buildSkillset(root);

  const explained = await runSkillsetCli(
    "explain",
    "plugins/audit/codex/skills/audit-skill/SKILL.md",
    "--root",
    root
  );
  expect(explained.exitCode).toBe(0);
  expect(explained.stdout).toContain("render [codex] plugin.audit.skill:audit-skill: plugin-skills -> skill rendered");
  expect(explained.stdout).not.toContain("render [claude] plugin.audit.skill:audit-skill");

  const explainedJson = await runSkillsetCli(
    "explain",
    ".skillset/plugins/audit",
    "--root",
    root,
    "--json"
  );
  expect(explainedJson.exitCode).toBe(0);
  const explainReport = (JSON.parse(explainedJson.stdout) as { readonly data: {
    renderResults: readonly { destination?: string; featureId: string; status: string; target?: string }[];
  } }).data;
  expect(explainReport.renderResults).toContainEqual(
    expect.objectContaining({
      destination: "plugin-manifest",
      featureId: "dependencies",
      status: "degraded",
      target: "codex",
    })
  );

  const doctor = await runSkillsetCli("status", "--root", root);
  expect(doctor.exitCode).toBe(0);
  expect(doctor.stdout).toContain("render [codex] plugin.audit.feature:dependencies: dependencies -> plugin-manifest degraded");
  expect(doctor.stdout).toContain("status found 1 render result advisory");

  const doctorJson = await runSkillsetCli("status", "--root", root, "--json");
  expect(doctorJson.exitCode).toBe(0);
  const doctorReport = (JSON.parse(doctorJson.stdout) as { readonly data: {
    renderResults: readonly { destination?: string; featureId: string; status: string; target?: string }[];
    notableRenderResults: readonly { destination?: string; featureId: string; status: string; target?: string }[];
  } }).data;
  expect(doctorReport.renderResults.length).toBeGreaterThan(0);
  expect(doctorReport.notableRenderResults).toEqual([
    expect.objectContaining({
      destination: "plugin-manifest",
      featureId: "dependencies",
      status: "degraded",
      target: "codex",
    }),
  ]);

  const buildJson = await runSkillsetCli("build", "--root", root, "--json");
  expect(buildJson.exitCode).toBe(0);
  expect(buildJson.stderr).toBe("");
  expect(JSON.parse(buildJson.stdout)).toMatchObject({
    data: { state: "planned", writes: [] },
    exitCode: 0,
    ok: true,
    schemaVersion: "skillset.cli.result@1",
  });
});

test("SET-78: feature capability inspection surfaces registry ids in explain, doctor, and features", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: feature-inspect-root
claude: true
codex: true
`,
    ".skillset/shared/references/guide.md": `
# Guide
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo with resources.
resources:
  references:
    - shared:references/guide.md
---

Read [the guide](shared:references/guide.md).
`,
    ".skillset/rules/root.md": `
---
description: Root instructions.
---

Keep output inspectable.
`,
    ".skillset/_codex/rules/deny.rules": `
match = "rm -rf"
decision = "deny"
`,
    ".skillset/plugins/audit/skillset.yaml": `
skillset:
  name: audit
`,
    ".skillset/plugins/audit/skills/audit-skill/SKILL.md": `
---
name: audit-skill
description: Audit skill.
---

Audit body.
`,
  });

  const skillExplain = await runSkillsetCli("explain", ".skillset/skills/demo/SKILL.md", "--root", root, "--json");
  expect(skillExplain.exitCode).toBe(0);
  const skillReport = (JSON.parse(skillExplain.stdout) as { readonly data: {
    features: readonly {
      docs: readonly string[];
      id: string;
      status: string;
      targetSupport: Record<string, { status: string }>;
      title: string;
    }[];
  } }).data;
  const nativeTargetSupport = Object.fromEntries(
    targetNames().map((target) => [target, { status: "native" }])
  );
  expect(skillReport.features).toEqual([
    {
      docs: ["docs/features/resources.md"],
      id: "resources",
      status: "implemented",
      targetSupport: nativeTargetSupport,
      title: "Resources",
    },
    {
      docs: ["docs/features/skills.md"],
      id: "standalone-skills",
      status: "implemented",
      targetSupport: nativeTargetSupport,
      title: "Standalone Skills",
    },
  ]);

  const pluginExplain = await runSkillsetCli("explain", ".skillset/plugins/audit/skillset.yaml", "--root", root, "--json");
  const instructionExplain = await runSkillsetCli("explain", ".skillset/rules/root.md", "--root", root, "--json");
  const islandExplain = await runSkillsetCli("explain", ".skillset/_codex/rules/deny.rules", "--root", root, "--json");
  expect(featureIds(pluginExplain.stdout)).toContain("plugin-manifests");
  expect(featureIds(instructionExplain.stdout)).toContain("project-instructions");
  expect(featureIds(islandExplain.stdout)).toContain("target-native-islands");

  const featureText = await runSkillsetCli("lookup", "features", "plugin-bin");
  expect(featureText.exitCode).toBe(0);
  expect(featureText.stdout).toContain("feature plugin-bin: Plugin Bin");
  for (const target of targetNames()) {
    expect(featureText.stdout).toContain(`${target}:`);
  }

  const featureJson = await runSkillsetCli("lookup", "features", "plugin-bin", "--json");
  expect(featureJson.exitCode).toBe(0);
  expect(JSON.parse(featureJson.stdout)).toMatchObject({ command: "lookup features" });
  const featureReport = (JSON.parse(featureJson.stdout) as { readonly data: {
    features: readonly {
      docs: readonly string[];
      id: string;
      status: string;
      targetSupport: Record<string, { reason?: string; status: string }>;
      title: string;
    }[];
  } }).data;
  expect(featureReport.features).toEqual([
    {
      docs: ["docs/features/executables.md", "docs/features/feature-source-pointers.md"],
      id: "plugin-bin",
      status: "implemented",
      targetSupport: {
        claude: { status: "pass_through" },
        codex: expect.objectContaining({ status: "unsupported" }),
        cursor: expect.objectContaining({ status: "unsupported" }),
      },
      title: "Plugin Bin",
    },
  ]);
  expect(featureReport.features[0]?.targetSupport.codex?.reason ?? "").toContain("Codex plugins");

  const missingFeature = await runSkillsetCli("lookup", "features", "no-such-feature", "--json");
  expect(missingFeature.exitCode).toBe(1);
  expect(JSON.parse(missingFeature.stdout)).toMatchObject({ data: { features: [] }, exitCode: 1, schemaVersion: "skillset.cli.result@1" });

  const doctor = await runSkillsetCli("status", "--root", root);
  expect(doctor.stdout).toContain("features:");
  expect(doctor.stdout).toContain("status implemented");
  for (const target of targetNames()) {
    expect(doctor.stdout).toContain(`feature support: ${target}`);
  }
  const doctorJson = await runSkillsetCli("status", "--root", root, "--json");
  expect(JSON.parse(doctorJson.stdout)).toMatchObject({ command: "status" });
  const doctorReport = (JSON.parse(doctorJson.stdout) as { readonly data: {
    featureCapabilities: {
      byTargetSupport: Record<string, Record<string, number>>;
      featureIds: readonly string[];
      total: number;
    };
  } }).data;
  expect(doctorReport.featureCapabilities.total).toBeGreaterThan(0);
  expect(Object.keys(doctorReport.featureCapabilities.byTargetSupport)).toEqual([...targetNames()]);
  for (const target of targetNames()) {
    expect(doctorReport.featureCapabilities.byTargetSupport[target]?.native).toBeGreaterThan(0);
  }
  expect(doctorReport.featureCapabilities.featureIds).toContain("plugin-bin");

  for (const retired of ["doctor", "features"]) {
    const removed = await runSkillsetCli(retired);
    expect(removed.exitCode).toBe(1);
    expect(removed.stderr).toContain("expected command");
  }
});

test("SET-83: doctor reports render results from unsupported build errors", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: unsupported-outcome-root
claude: false
codex: true
`,
    ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
    ".skillset/plugins/tools/bin/run": "#!/usr/bin/env bash\n",
    ".skillset/plugins/tools/skills/tool/SKILL.md": `
---
name: tool
description: Tool skill.
---

Tool body.
`,
  });

  const report = await doctorSkillset(root);
  expect(report.ok).toBe(false);
  expect(report.buildError).toContain("codex plugin-bin unsupported");
  expect(report.buildError).toContain("Codex plugins do not expose a documented plugin-local bin contract.");
  expect(report.notableRenderResults).toContainEqual(
    expect.objectContaining({
      featureId: "plugin-bin",
      policy: "unsupported:error",
      status: "unsupported",
      target: "codex",
    })
  );

  const explainedUnsupportedFeature = await explainPath(root, ".skillset/plugins/tools/bin");
  expect(explainedUnsupportedFeature.kind).toBe("source-plugin");
  expect(explainedUnsupportedFeature.entries).toEqual([]);
  expect(explainedUnsupportedFeature.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "plugin-bin",
      policy: "unsupported:error",
      status: "unsupported",
      target: "codex",
    })
  );
});

async function goldenPluginFixture(): Promise<string> {
  return contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
skillset:
  name: agents-root
claude: false
codex: true
`,
    ".skillset/rules/beta.md": `
---
paths:
  - "**/*"
---

# Beta

- Second by name.
`,
    ".skillset/rules/alpha.md": `
# Alpha

- First by name.
`,
  });

  await buildSkillset(root);
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  // Both sources are bounded by a comment naming their path.
  expect(agents).toContain("<!-- source: .skillset/rules/alpha.md -->");
  expect(agents).toContain("<!-- source: .skillset/rules/beta.md -->");
  // Deterministic order: alpha before beta.
  expect(agents.indexOf("alpha.md")).toBeLessThan(agents.indexOf("beta.md"));
  // Source-only frontmatter (paths) never leaks into the generated AGENTS.md.
  expect(agents).not.toContain("paths:");
  expect(agents).toContain("First by name.");
  expect(agents).toContain("Second by name.");
});

test("SET-7: build and generated-output verification report when a generated AGENTS.md exceeds Codex's size limit", async () => {
  const big = `# Big\n\n${"- padding line to grow the instruction file\n".repeat(900)}`;
  const root = await contractFixture({
    "skillset.yaml": `
skillset:
  name: big-root
claude: false
codex: true
`,
    ".skillset/rules/big.md": big,
  });

  const result = await buildSkillsetResult(root);
  const warnings = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
  const preview = await diffSkillsetResult(root);
  const previewWarnings = preview.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
  const verified = await verifySkillsetResult(root);
  const verifyWarnings = verified.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

  expect(warnings).toContain("project_doc_max_bytes");
  expect(warnings).toContain("AGENTS.md");
  expect(result.renderResults).toContainEqual(
    expect.objectContaining({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "codex-agents-size",
          path: "AGENTS.md",
        }),
      ]),
      featureId: "project-instructions",
      status: "transformed",
      target: "codex",
    })
  );
  expect(previewWarnings).toContain("project_doc_max_bytes");
  expect(previewWarnings).toContain("AGENTS.md");
  expect(preview.renderResults).toContainEqual(
    expect.objectContaining({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "codex-agents-size",
          path: "AGENTS.md",
        }),
      ]),
      featureId: "project-instructions",
      status: "transformed",
      target: "codex",
    })
  );
  expect(verifyWarnings).toContain("project_doc_max_bytes");
  expect(verifyWarnings).toContain("AGENTS.md");
  expect(verified.renderResults).toContainEqual(
    expect.objectContaining({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "codex-agents-size",
          path: "AGENTS.md",
        }),
      ]),
      featureId: "project-instructions",
      status: "transformed",
      target: "codex",
    })
  );
});

// SET-15: shared-resource and script authoring diagnostics.

test("SET-15: lint flags an undeclared resource link with a suggested entry", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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

  const lintReport = await inspectSkillset(await loadBuildGraph(root));
  expect(lintReport.issues).toContainEqual(expect.objectContaining({
    code: "resource-undeclared-link",
    featureId: "resources",
  }));
  await expect(lintSkillset(root)).rejects.toThrow("links to undeclared resource shared:references/guide.md");
  await expect(lintSkillset(root)).rejects.toThrow("resources: { references: [shared:references/guide.md] }");
});

test("SET-15: a link to a declared directory-resource child lints clean (no false undeclared)", async () => {
  const root = await contractFixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function writePendingChange(root: string, filename: string, content: string): Promise<void> {
  const pendingPath = join(root, ".skillset/changes");
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

function featureIds(stdout: string): readonly string[] {
  const report = (JSON.parse(stdout) as { readonly data: { readonly features?: readonly { readonly id: string }[] } }).data;
  return report.features?.map((feature) => feature.id) ?? [];
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

async function runSkillsetCliWithEnv(env: Record<string, string>, ...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    env: { ...process.env, ...env },
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

async function runShell(command: string): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["sh", "-c", command],
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
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
