import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";

import { seedReleaseBaselines } from "../adoption";
import { explainPath, listGeneratedEntries } from "../authoring";
import { buildSkillset, buildSkillsetResult, verifySkillset, diffSkillset } from "../build";
import { changeStatus, collectSourceInventory } from "../change-status";
import { addChangeEntry, readChangeHistory } from "../change-workflow";
import { gitSafeEnv } from "../git-env";
import { importSource } from "../import";
import { inspectSkillset, lintSkillset } from "../lint";
import { applyRelease } from "../release";
import { writeReleaseState } from "../release-state";
import { loadBuildGraph } from "../resolver";
import { renderValidatedToml } from "../structured-output";
import { runSkillsetTest } from "../test-runner";

test("loads ordinary 1.0 workspace from skillset.yaml and .skillset", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: ordinary-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo ordinary workspace skill.
---

Demo ordinary workspace skill.
`,
  });

  const graph = await loadBuildGraph(root);

  expect(graph.rootConfigPath).toBe(join(root, "skillset.yaml"));
  expect(graph.rootManifestPath).toBe(join(root, "skillset.yaml"));
  expect(graph.sourceDir).toBe(".skillset");
  expect(graph.sourceRoot).toBe(".skillset");
  expect(graph.sourceRootPath).toBe(join(root, ".skillset"));
  expect(graph.standaloneSkills.map((skill) => skill.id)).toEqual(["demo"]);

  await buildSkillset(root);

  expect(await exists(join(root, ".claude/skills/demo/SKILL.md"))).toBe(true);
  expect(await exists(join(root, ".agents/skills/demo/SKILL.md"))).toBe(true);
});

test("loads plugin-only workspace from root skillset.yaml and .skillset/plugins", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: plugin-only-root
claude: true
codex: true
`,
    ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
    ".skillset/plugins/demo/skills/child/SKILL.md": `
---
name: child
description: Demo plugin skill.
---

Demo plugin skill.
`,
  });

  const graph = await loadBuildGraph(root);

  expect(graph.rootConfigPath).toBe(join(root, "skillset.yaml"));
  expect(graph.rootManifestPath).toBe(join(root, "skillset.yaml"));
  expect(graph.sourceDir).toBe(".skillset");
  expect(graph.sourceRoot).toBe(".skillset");
  expect(graph.sourceRootPath).toBe(join(root, ".skillset"));
  expect(graph.plugins.map((plugin) => plugin.id)).toEqual(["demo"]);

  await buildSkillset(root);

  expect(await exists(join(root, "plugins-claude/plugins/demo/skills/child/SKILL.md"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/demo/skills/child/SKILL.md"))).toBe(true);
});

test("rejects custom source directories after workspace layout cutover", async () => {
  const root = await fixture({
    "authoring/skillset.yaml": `
skillset:
  name: custom-root
claude: true
codex: false
`,
    "authoring/src/skills/demo/SKILL.md": `
---
name: demo
description: Demo custom ordinary workspace skill.
---

Demo custom ordinary workspace skill.
`,
  });

  await expect(loadBuildGraph(root, { sourceDir: "authoring" })).rejects.toThrow(
    "--source authoring uses a retired source layout"
  );
});

test("SET-133: workspace config loads marketplace catalog source", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
compile:
  targets: [claude, codex]
marketplaces:
  outfitter:
    title: Outfitter
    description: Curated Outfitter plugins.
    targets: [claude, codex]
    plugins:
      - plugin: local-tools
      - id: trails
        plugin: trails-review
        repo: github:outfitter-dev/trails
        channel: latest
      - plugin: skillset
        repo: https://github.com/outfitter-dev/skillset.git
        ref: main
        targets: [claude]
`,
    ".skillset/plugins/local-tools/skillset.yaml": `
skillset:
  name: local-tools
`,
  });

  const graph = await loadBuildGraph(root);

  expect(graph.root.marketplaces.outfitter).toEqual({
    description: "Curated Outfitter plugins.",
    plugins: [
      { id: "local-tools", plugin: "local-tools" },
      { channel: "latest", id: "trails", plugin: "trails-review", repo: "github:outfitter-dev/trails" },
      { id: "skillset", plugin: "skillset", ref: "main", repo: "https://github.com/outfitter-dev/skillset.git", targets: ["claude"] },
    ],
    targets: ["claude", "codex"],
    title: "Outfitter",
  });
});

test("SET-133: marketplace catalog source rejects filesystem repo references", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    plugins:
      - plugin: trails-review
        repo: ../trails
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("marketplace plugin repo must be a remote repo reference");
});

test("workspace ignores unrelated top-level directories", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
---

Demo dedicated workspace skill.
`,
    "skills/unrelated.txt": "not skillset source\n",
    "plugins/README.md": "not skillset source\n",
    "shared/data.txt": "not skillset source\n",
  });

  await expect(loadBuildGraph(root)).resolves.toMatchObject({
    sourceDir: ".skillset",
    sourceRoot: ".skillset",
  });
});

test("dedicated 1.0 change status reads release state from .skillset/changes/state.json", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Demo dedicated workspace skill.
`,
  });

  await buildSkillset(root);
  await commitFixture(root);
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Changed after the generated lock was written.
`,
    "utf8"
  );
  const inventory = await collectSourceInventory(root);
  const demo = inventory.units.find((unit) => unit.id === "skill:demo");
  if (demo === undefined) throw new Error("expected demo source unit");
  await writeReleaseState(
    root,
    {
      scopes: {
        "skill:demo": {
          sourceHash: demo.hash,
          version: "0.1.0",
        },
      },
    },
    { sourceDir: ".skillset" }
  );

  const status = await changeStatus(root);

  expect(status.baseline).toMatchObject({
    kind: "source-inventory",
    label: ".skillset/changes/state.json",
  });
  expect(status.sourceChanges.map((change) => change.id)).not.toContain("skill:demo");
});

test("dedicated 1.0 release baseline seeding writes to .skillset/changes/state.json", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Demo dedicated workspace skill.
`,
  });

  const report = await seedReleaseBaselines(root, {}, { write: true });

  expect(report.path).toBe(".skillset/changes/state.json");
  expect(report.entries.map((entry) => entry.scope)).toContain("skill:demo");
  expect(await exists(join(root, ".skillset/changes/state.json"))).toBe(true);
});

test("release baseline seeding fails loudly for malformed workspace metadata", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: malformed\n  version: nope\nclaude: true\n",
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
version: 0.1.0
---

Demo skill.
`,
  });

  await expect(seedReleaseBaselines(root, {}, { write: true })).rejects.toThrow("skillset.yaml.skillset.version");
});

test("dedicated 1.0 output roots cannot point at source changes state", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
  outputs:
    skills:
      claude: .skillset/changes
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
---

Demo dedicated workspace skill.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("must not point inside change state .skillset/changes");
});

test("dedicated 1.0 change add writes pending entries to source changes directory", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Demo dedicated workspace skill.
`,
  });

  await buildSkillset(root);
  await commitFixture(root);
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Changed after the generated lock was written.
`,
    "utf8"
  );

  const report = await addChangeEntry(root, {
    bump: "patch",
    reason: {
      kind: "inline",
      value: "Document the dedicated workspace source change with enough detail for validation.",
    },
    scopes: ["skill:demo"],
  });

  expect(report.entry.path).toMatch(/^\.skillset\/changes\/[0-9a-f]{12}\.md$/);
  expect(await exists(join(root, report.entry.path))).toBe(true);
  expect(await exists(join(root, "skillset/changes"))).toBe(false);
});

test("dedicated 1.0 release apply writes history and releases to source changes directory", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Demo dedicated workspace skill.
`,
  });

  await buildSkillset(root);
  await commitFixture(root);
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo dedicated workspace skill.
version: 0.1.0
---

Changed before applying a dedicated workspace release.
`,
    "utf8"
  );
  const added = await addChangeEntry(root, {
    bump: "patch",
    reason: {
      kind: "inline",
      value: "Release the dedicated workspace source change with enough detail for validation.",
    },
    scopes: ["skill:demo"],
  });

  const report = await applyRelease(root);

  expect(report.files).toContain(".skillset/changes/history.jsonl");
  expect(report.files).toContain(".skillset/changes/releases.jsonl");
  expect(report.files).toContain(".skillset/changes/state.json");
  expect(await exists(join(root, ".skillset/changes/history.jsonl"))).toBe(true);
  expect(await exists(join(root, ".skillset/changes/releases.jsonl"))).toBe(true);
  expect(await exists(join(root, ".skillset/changes/state.json"))).toBe(true);
  expect(await exists(join(root, added.entry.path))).toBe(false);
  expect(await exists(join(root, "skillset/changes/history.jsonl"))).toBe(false);
});

test("dedicated 1.0 change history can read records while source units are absent", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: false
`,
  });
  await mkdir(join(root, ".skillset/changes"), { recursive: true });
  await writeFile(
    join(root, ".skillset/changes/history.jsonl"),
    `${JSON.stringify({
      appliedAt: "2026-06-19T00:00:00.000Z",
      bump: "patch",
      id: "0123456789ab",
      reason: "A historical entry can be inspected while source is temporarily unavailable.",
      scopes: ["skill:demo"],
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }],
    })}\n`,
    "utf8"
  );

  const history = await readChangeHistory(root);

  expect(history.entries.map((entry) => entry.path)).toEqual([".skillset/changes/history.jsonl:1"]);
});

test("rejects retired workspace layout markers", async () => {
  const retiredNestedSource = await fixture({
    "skillset.yaml": "skillset:\n  name: workspace-root\nclaude: true\n",
    ".skillset/src/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo skill.
`,
  });

  await expect(loadBuildGraph(retiredNestedSource)).rejects.toThrow(".skillset/src uses a retired source layout");

  const retiredWorkspaceManifest = await fixture({
    ".skillset/skillset.yaml": "skillset:\n  name: old-root\nclaude: true\n",
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo skill.
`,
  });

  await expect(loadBuildGraph(retiredWorkspaceManifest)).rejects.toThrow(
    ".skillset/skillset.yaml uses a retired source layout"
  );
});

test("root skillset.yaml configures the canonical workspace", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: ordinary-root\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo ordinary workspace skill.
---

Demo ordinary workspace skill.
`,
  });

  const graph = await loadBuildGraph(root);

  expect(graph.rootConfigPath).toBe(join(root, "skillset.yaml"));
  expect(graph.sourceDir).toBe(".skillset");
  expect(graph.sourceRoot).toBe(".skillset");
});

test("root skillset directory is a retired source marker", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: ordinary-root\nclaude: true\ncodex: false\n",
    "skillset/README.md": "This is not Skillset source.\n",
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo ordinary workspace skill.
---

Demo ordinary workspace skill.
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("skillset uses a retired source layout");
});

test("workspace provider source file is canonical source", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: ordinary-root\nclaude: true\ncodex: false\n",
    ".skillset/_codex/settings.json": "{}\n",
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo ordinary workspace skill.
---

Demo ordinary workspace skill.
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.projectIslands.map((island) => island.sourcePath)).toContain(join(root, ".skillset/_codex/settings.json"));
});

test("skillset test reads ordinary 1.0 workspace tests from the source root", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: ordinary-root
claude: true
codex: false
`,
    ".skillset/tests.yaml": `
self:
  select:
    skills:
      primary: ["demo"]
  output:
    kind: isolated
  checks:
    projection: true
    files:
      - path: .claude/skills/demo/SKILL.md
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo ordinary workspace skill.
---

Demo ordinary workspace skill.
`,
    ".skillset/snapshots/recovery/git/config": "do not retain me\n",
  });

  const report = await runSkillsetTest(root, "self");

  expect(report.ok).toBe(true);
  expect(report.source).toBe("repo:.skillset");
  expect(await exists(cachePath(root, ".skillset/cache/tests/latest/workspace/.claude/skills/demo/SKILL.md"))).toBe(true);
  expect(await exists(cachePath(root, ".skillset/cache/tests/latest/workspace/.skillset/snapshots/recovery/git/config"))).toBe(false);
});

test("skillset test stages dedicated workspace source without copying unrelated repo files", async () => {
  const root = await fixture({
    "package.json": "{\"private\":true}\n",
    "skillset.yaml": `
skillset:
  name: dedicated-root
claude: true
codex: false
`,
    ".skillset/tests/self.yaml": `
select:
  skills:
    primary: ["demo"]
output:
  kind: isolated
checks:
  projection: true
  files:
    - path: .claude/skills/demo/SKILL.md
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo dedicated workspace skill.
---

Demo dedicated workspace skill.
`,
  });

  const report = await runSkillsetTest(root, "self");

  expect(report.ok).toBe(true);
  expect(report.source).toBe("repo:.skillset");
  expect(await exists(cachePath(root, ".skillset/cache/tests/latest/workspace/skillset.yaml"))).toBe(true);
  expect(await exists(cachePath(root, ".skillset/cache/tests/latest/workspace/.claude/skills/demo/SKILL.md"))).toBe(true);
  expect(await exists(cachePath(root, ".skillset/cache/tests/latest/workspace/package.json"))).toBe(false);
});

test("skillset test rejects duplicate source-root declaration names", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: duplicate-tests
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
`,
    ".skillset/tests/self.yaml": `
select:
  skills:
    primary: ["demo"]
checks:
  projection: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo ordinary workspace skill.
---

Demo ordinary workspace skill.
`,
  });

  await expect(runSkillsetTest(root, "self")).rejects.toThrow(
    "duplicate test self in .skillset/tests.yaml.self and .skillset/tests/self.yaml"
  );
});

test("change status compares current dedicated workspace against legacy git baselines", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: migrating-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Legacy workspace body.
`,
  });
  await commitFixture(root);
  await rm(join(root, ".skillset"), { force: true, recursive: true });
  await Bun.write(
    join(root, "skillset.yaml"),
    `skillset:
  name: migrating-root
claude: true
codex: false
`
  );
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Dedicated workspace body.
`
  );

  const status = await changeStatus(root, { since: "HEAD" });

  expect(status.baseline).toMatchObject({ kind: "git-ref", ref: "HEAD" });
  expect(status.sourceChanges.map((change) => change.id)).toContain("skill:demo");
});

test("change status normalizes legacy source baselines with existing workspace sentinels", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: migrating-root
claude: true
codex: false
`,
    ".skillset/.gitignore": "cache/*\n!cache/.gitignore\nsnapshots/*\n!snapshots/.gitignore\n",
    ".skillset/cache/.gitignore": "*\n!.gitignore\n",
    ".skillset/snapshots/.gitignore": "*\n!.gitignore\n",
    "skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Legacy workspace body.
`,
  });
  await commitFixture(root);
  await rm(join(root, "skillset"), { force: true, recursive: true });
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Dedicated workspace body.
`
  );

  const status = await changeStatus(root, { since: "HEAD" });

  expect(status.baseline).toMatchObject({ kind: "git-ref", ref: "HEAD" });
  expect(status.sourceChanges.map((change) => change.id)).toContain("skill:demo");
});

test("change status explicit dedicated source compares against legacy git baselines", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: migrating-root
claude: true
codex: false
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Legacy workspace body.
`,
  });
  await commitFixture(root);
  await rm(join(root, ".skillset"), { force: true, recursive: true });
  await Bun.write(
    join(root, "skillset.yaml"),
    `skillset:
  name: migrating-root
claude: true
codex: false
`
  );
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo migrated skill.
version: 0.1.0
---

Dedicated workspace body.
`
  );

  const status = await changeStatus(root, { since: "HEAD", sourceDir: ".skillset" });

  expect(status.baseline).toMatchObject({ kind: "git-ref", ref: "HEAD" });
  expect(status.sourceChanges.map((change) => change.id)).toContain("skill:demo");
});

test("legacy split source manifest is rejected", async () => {
  const root = await fixture({
    "skillset.yaml": `
claude: true
codex: false
`,
    ".skillset/src/skillset.yaml": `
skillset:
  name: legacy-root
  outputs:
    plugins:
      claude: stale-source-output
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo plugin skill.
---

Demo plugin skill.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(".skillset/src uses a retired source layout");
});

test("resolves target inheritance, booleans, objects, and false opt-out", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    features: { promptArguments: true },
    skillset: { metadata: false },
    targets: ["claude", "codex"],
    unsupportedDestination: "error",
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
    "skillset.yaml": `
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

test("compile features validate prompt argument placeholder configuration", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  features:
    promptArguments: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  const graph = await loadBuildGraph(root);
  expect(graph.root.compile.features).toEqual({ promptArguments: false });

  const invalidRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  features:
    promptArguments: maybe
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(invalidRoot)).rejects.toThrow(
    "compile.features.promptArguments to be a boolean"
  );
});

test("target defaults reject file frontmatter and unknown surfaces", async () => {
  const fileDefaultsRoot = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  const lock = JSON.parse(await readFile(join(root, "plugins-codex/skillset.lock"), "utf8"));
  expect(lock.buildMode).toBe("all");
  expect(lock.selectedTargets).toEqual(["codex"]);
  expect(lock.skillsetMetadata).toBe(false);
});

test("metadata suppression still leaves version-only changes visible through generated-output verification", async () => {
  const root = await fixture({
    "skillset.yaml": `
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

  await expect(verifySkillset(root)).rejects.toThrow("stale generated file");
});

test("top-level model warns unless active target defaults or overrides handle it", async () => {
  const warnsRoot = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  expect(await exists(join(root, "plugins-codex/skillset.lock"))).toBe(true);

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
  const lock = await readFile(join(root, "plugins-codex/skillset.lock"), "utf8");

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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    ".skillset/agents/reviewer.md": `
---
name: Code Reviewer
description: Reviews project changes.
skills:
  - skillset-codex-development
initialPrompt: "Start with the {{shared:templates/prompt.md }}"
codex:
  model: gpt-5-codex
  description: Reviews changes through Codex.
claude:
  color: blue
---

Review diffs and call out correctness risks.
Tree:
{{parent.tree depth:1}}
{{shared:templates/body.md }}
`,
  });

  await buildSkillset(root);

  const claudeAgent = await readFile(join(root, ".claude/agents/code-reviewer.md"), "utf8");
  expect(claudeAgent).toContain(`name: Code Reviewer`);
  expect(claudeAgent).toContain(`description: Reviews project changes.`);
  expect(claudeAgent).toContain(`color: blue`);
  expect(claudeAgent).toContain(`generated: skillset@0.1.0`);
  expect(claudeAgent).toContain("Review diffs and call out correctness risks.");
  expect(claudeAgent).toContain("- reviewer.md");
  expect(claudeAgent).toContain("Use the shared review checklist.");

  const codexAgent = await readFile(join(root, ".codex/agents/code-reviewer.toml"), "utf8");
  expect(codexAgent).toContain(`name = "Code Reviewer"`);
  expect(codexAgent).toContain(`description = "Reviews changes through Codex."`);
  expect(codexAgent).toContain(`model = "gpt-5-codex"`);
  expect(codexAgent).toContain(`developer_instructions = `);
  expect(codexAgent).toContain("Required skills:");
  expect(codexAgent).toContain("- skillset-codex-development");
  expect(codexAgent).toContain("Review diffs and call out correctness risks.");
  expect(codexAgent).toContain("- reviewer.md");
  expect(codexAgent).toContain("Use the shared review checklist.");
  expect(codexAgent).toContain("<initial_prompt>");
  expect(codexAgent).toContain("Start with the smallest complete review");
  expect(codexAgent).toContain("[metadata.skillset]");
  expect(codexAgent.indexOf("Required skills:")).toBeLessThan(codexAgent.indexOf("Review diffs"));
  expect(codexAgent.indexOf("Review diffs")).toBeLessThan(codexAgent.indexOf("<initial_prompt>"));

  const lock = await readFile(join(root, "skillset.lock"), "utf8");
  expect(lock).toContain(`"kind": "project-agent"`);
  expect(lock).toContain(`"sourcePath": ".skillset/agents/reviewer.md"`);
  expect(lock).toContain(`"outputPath": ".claude/agents/code-reviewer.md"`);
  expect(lock).toContain(`".codex/agents/code-reviewer.toml"`);

  const explained = await explainPath(root, ".skillset/agents/reviewer.md");
  expect(explained.kind).toBe("source-project-agent");
  expect(explained.entries[0]?.kind).toBe("project-agent");
  expect(explained.entries[0]?.validation).toBe("structured");
  for (const entry of explained.entries) {
    expect(entry.preprocessDependencies).toContain(".skillset/shared/templates/body.md");
    expect(entry.preprocessDependencies).toContain("tree:.skillset/agents:1");
  }
  expect(explained.notes[0]).toContain("Project-scoped portable agent");

  const explainedCodexOutput = await explainPath(root, ".codex/agents/code-reviewer.toml");
  expect(explainedCodexOutput.kind).toBe("generated");
  expect(explainedCodexOutput.entries[0]?.kind).toBe("project-agent");
  expect(explainedCodexOutput.entries[0]?.outputPath).toBe(".codex/agents/code-reviewer.toml");
  expect(explainedCodexOutput.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/prompt.md");
  expect(explainedCodexOutput.entries[0]?.preprocessDependencies).toContain("tree:.skillset/agents:1");

  const entries = await listGeneratedEntries(root);
  expect(entries.some((entry) => entry.kind === "project-agent" && entry.outputPath === ".claude/agents/code-reviewer.md")).toBe(true);
  expect(entries.some((entry) => entry.kind === "project-agent" && entry.outputPath === ".codex/agents/code-reviewer.toml")).toBe(true);
});

test("portable project agents support metadata suppression, warnings, and validation", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  skillset:
    metadata: false
claude: true
codex: true
`,
    ".skillset/agents/reviewer.md": `
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
    ".skillset/agents/reviewer.md uses top-level model, which is not portable in Skillset v1; use claude.model, codex.model, or target defaults for claude, codex."
  );

  await buildSkillset(root);
  const claudeAgent = await readFile(join(root, ".claude/agents/reviewer.md"), "utf8");
  const codexAgent = await readFile(join(root, ".codex/agents/reviewer.toml"), "utf8");
  expect(claudeAgent).not.toContain("metadata:");
  expect(codexAgent).not.toContain("[metadata.skillset]");
  expect(codexAgent).toContain("Use Codex-specific review steps.");

  const closingTagRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
  userRoot: ~/.claude
codex:
  projectRoot: project-codex
  userRoot: ~/.codex
`,
    ".skillset/agents/reviewer.md": `
---
description: Invalid prompt.
initialPrompt: "</initial_prompt>"
---

Review.
`,
  });
  await expect(loadBuildGraph(closingTagRoot)).rejects.toThrow("initialPrompt must not contain </initial_prompt>");

  const preprocessedClosingTagRoot = await fixture({
    "skillset.yaml": `
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
    ".skillset/agents/reviewer.md": `
---
description: Invalid rendered prompt.
initialPrompt: "{{shared:bad-prompt.md }}"
---

Review.
`,
  });
  await expect(buildSkillset(preprocessedClosingTagRoot)).rejects.toThrow("initialPrompt must not contain </initial_prompt>");

  const collisionRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/agents/reviewer.md": `
---
name: Reviewer
description: Reviews.
---

Review.
`,
    ".skillset/agents/reviewer-copy.md": `
---
name: Reviewer!
description: Reviews too.
---

Review too.
`,
  });
  await expect(loadBuildGraph(collisionRoot)).rejects.toThrow("both generate claude agent reviewer");

  const targetNameCollisionRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/agents/reviewer.md": `
---
name: Reviewer
description: Reviews.
---

Review.
`,
    ".skillset/agents/auditor.md": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
  userRoot: ~/.claude
codex:
  projectRoot: project-codex
  userRoot: ~/.codex
`,
    ".skillset/agents/reviewer.md": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .claude
  skills:
    path: .claude/agents
codex: false
`,
    ".skillset/agents/reviewer.md": `
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
    ".skillset/agents/reviewer.md would write inside active output root outputs.skills.claude (.claude/agents)"
  );
});

test("Codex plugin agent diagnostics honor root plugin output selection", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  const lock = await readFile(join(root, "plugins-codex/skillset.lock"), "utf8");

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
  await expect(verifySkillset(root)).rejects.toThrow("stale generated file");
});

test("preprocessing expands this references and partials in skill markdown and Codex YAML", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/shared/templates/intro.md": `
Shared intro for {{this.description}} at {{skillset.source_path}}.
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
config: {{this.metadata.config}}
prompt: |
  {{shared:templates/openai.md}}
`,
    ".skillset/plugins/alpha/skills/preprocessed/SKILL.md": `
---
name: preprocessed
description: Preprocessed skill.
enabled: true
implicit_invocation: true
metadata:
  config:
    retries: 2
    modes:
      - fast
      - safe
  nested:
    label: Nested Label
priority: 7
---

# {{this.description}}

Nested: {{this.metadata.nested.label}}
Priority: {{this.priority}}
Enabled: {{this.enabled}}
Escaped: {{{this.description}}}
Config:
{{this.metadata.config}}
Existing JSON fence:
~~~json
{{this.metadata.config}}
~~~
Long fence:
~~~~
~~~json
{{this.metadata.config}}
~~~
~~~~
Long same-length info fence:
~~~~
~~~~json
{{this.metadata.config}}
~~~~
Parent: {{parent.name}} {{parent.dir}}
Tree:
{{parent.tree depth:1}}

{{shared:templates/intro.md}}
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
  expect(claudeSkill).toContain("Nested: Nested Label");
  expect(claudeSkill).toContain("Priority: 7");
  expect(claudeSkill).toContain("Enabled: true");
  expect(claudeSkill).toContain("Escaped: {{this.description}}");
  expect(claudeSkill).toContain('Config:\n```json\n{\n  "retries": 2,');
  expect(claudeSkill).toContain('  "modes": [\n    "fast",\n    "safe"\n  ]');
  expect(claudeSkill).toContain('Existing JSON fence:\n~~~json\n{\n  "retries": 2,');
  expect(claudeSkill).toContain('Long fence:\n~~~~\n~~~json\n{\n  "retries": 2,');
  expect(claudeSkill).toContain('Long same-length info fence:\n~~~~\n~~~~json\n{\n  "retries": 2,');
  expect(claudeSkill).not.toContain("```json\n```json");
  expect(claudeSkill).toContain("Parent: preprocessed .skillset/plugins/alpha/skills/preprocessed");
  expect(claudeSkill).toContain("- SKILL.md");
  expect(claudeSkill).toContain("- agents/");
  expect(claudeSkill).toContain(
    "Shared intro for Preprocessed skill. at .skillset/plugins/alpha/skills/preprocessed/SKILL.md."
  );
  expect(codexAgent).toContain("notes: Preprocessed skill.");
  expect(codexAgent).toContain("config:");
  expect(codexAgent).toContain("  retries: 2");
  expect(codexAgent).toContain("  - fast");
  expect(codexAgent).not.toContain("```json");
  expect(codexAgent).toContain("YAML prompt for Preprocessed skill. with \"quotes\".");

  const explainedClaude = await explainPath(root, "plugins-claude/plugins/alpha/skills/preprocessed/SKILL.md");
  expect(explainedClaude.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/intro.md");
  expect(explainedClaude.entries[0]?.preprocessDependencies).not.toContain(".skillset/shared/templates/openai.md");

  const explainedCodex = await explainPath(root, "plugins-codex/plugins/alpha/skills/preprocessed/SKILL.md");
  expect(explainedCodex.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/intro.md");
  expect(explainedCodex.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/openai.md");

  await writeFile(join(root, ".skillset/shared/templates/openai.md"), "Changed YAML prompt.\n");
  await expect(verifySkillset(root)).rejects.toThrow("stale generated file");
});

test("preprocessing adapts prompt argument placeholders for Claude and shims Codex", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/skills/argument-runner/SKILL.md": `
---
name: argument-runner
description: Runs a command with prompt arguments.
---

Run:

\`docs-cli search "{{$ARGUMENTS[0]}}" "{{$ARGUMENTS[1]}}" --limit {{$ARGUMENTS.limit}}\`

All args: {{$ARGUMENTS}}
Literal marker: {{{ $ARGUMENTS }}}
`,
  });

  await expect(lintSkillset(root)).resolves.toMatchObject({ issues: [] });
  await buildSkillset(root);

  const claudeSkill = await readFile(join(root, ".claude/skills/argument-runner/SKILL.md"), "utf8");
  expect(claudeSkill).toContain('docs-cli search "$ARGUMENTS[0]" "$ARGUMENTS[1]" --limit $ARGUMENTS.limit');
  expect(claudeSkill).toContain("All args: $ARGUMENTS");
  expect(claudeSkill).toContain("Literal marker: {{$ARGUMENTS}}");
  expect(claudeSkill).not.toContain("Before using commands");

  const codexSkill = await readFile(join(root, ".agents/skills/argument-runner/SKILL.md"), "utf8");
  expect(codexSkill).toContain(
    "Before using commands, replace `{{$ARGUMENTS...}}` placeholders with the user's supplied arguments."
  );
  expect(codexSkill).toContain('docs-cli search "{{$ARGUMENTS[0]}}" "{{$ARGUMENTS[1]}}" --limit {{$ARGUMENTS.limit}}');
  expect(codexSkill).toContain("All args: {{$ARGUMENTS}}");
  expect(codexSkill).toContain("Literal marker: {{$ARGUMENTS}}");
});

test("preprocessing rejects prompt argument placeholders when the feature is disabled", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  features:
    promptArguments: false
claude: true
codex: true
`,
    ".skillset/skills/argument-runner/SKILL.md": `
---
name: argument-runner
description: Runs a command with prompt arguments.
---

Run \`docs-cli search "{{$ARGUMENTS[1]}}"\`.
`,
  });

  await expect(lintSkillset(root)).rejects.toThrow("compile.features.promptArguments is false");
  await expect(buildSkillset(root)).rejects.toThrow("requires compile.features.promptArguments");
});

test("preprocessing opt-out preserves literal variables while stripping source controls", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("preprocessing rejects invalid parent tree arguments", async () => {
  for (const token of ["{{parent.tree depth:1 format:markdown}}", "{{parent.tree depth:1 depth:2}}"]) {
    const root = await fixture({
      "skillset.yaml": `
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

${token}
`,
    });

    await expect(buildSkillset(root)).rejects.toThrow("supports only depth:<0-8>");
  }
});

test("preprocessing rejects partial traversal and plugin partials outside plugins", async () => {
  const sharedTraversal = await fixture({
    "skillset.yaml": `
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

{{shared:../secret.md}}
`,
  });
  await expect(buildSkillset(sharedTraversal)).rejects.toThrow(
    "must not contain empty, dot, or parent segments"
  );

  const pluginTraversal = await fixture({
    "skillset.yaml": `
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

{{plugin:../secret.md}}
`,
  });
  await expect(buildSkillset(pluginTraversal)).rejects.toThrow(
    "must not contain empty, dot, or parent segments"
  );

  const relativeTraversal = await fixture({
    "skillset.yaml": `
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

{{../secret.md}}
`,
  });
  await expect(buildSkillset(relativeTraversal)).rejects.toThrow(
    "must not contain empty, dot, or parent segments"
  );

  const absolutePartial = await fixture({
    "skillset.yaml": `
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

{{/tmp/secret.md}}
`,
  });
  await expect(buildSkillset(absolutePartial)).rejects.toThrow("must be a relative path");

  const standalonePluginPartial = await fixture({
    "skillset.yaml": `
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

{{plugin:templates/standalone.md}}
`,
  });
  await expect(buildSkillset(standalonePluginPartial)).rejects.toThrow(
    "requires a plugin-bound source"
  );
});

test("preprocessing expands named partials recursively with workspace and plugin lookup", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/partials/intro.md": `
Workspace intro for {{this.description}}.
{{> detail}}
`,
    ".skillset/partials/nested/detail.md": `
Workspace detail.
`,
    ".skillset/partials/preferred.md": `
Workspace preferred.
`,
    ".skillset/plugins/alpha/partials/preferred.md": `
Plugin preferred.
`,
    ".skillset/plugins/alpha/partials/plugin-only.md": `
Plugin only for {{this.name}}.
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/good/SKILL.md": `
---
name: good
description: Good skill.
---

{{> intro}}
{{> preferred}}
{{> plugin-only}}
{{> alpha.plugin-only}}
`,
  });

  await buildSkillset(root);

  const skill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/good/SKILL.md"),
    "utf8"
  );
  expect(skill).toContain("Workspace intro for Good skill.");
  expect(skill).toContain("Workspace detail.");
  expect(skill).toContain("Workspace preferred.");
  expect(skill).not.toContain("Plugin preferred.");
  expect(skill).toContain("Plugin only for good.");
  expect(skill.match(/Plugin only for good\./g)?.length).toBe(2);

  const explained = await explainPath(root, "plugins-claude/plugins/alpha/skills/good/SKILL.md");
  expect(explained.entries[0]?.preprocessDependencies).toContain(".skillset/partials/intro.md");
  expect(explained.entries[0]?.preprocessDependencies).toContain(".skillset/partials/nested/detail.md");
  expect(explained.entries[0]?.preprocessDependencies).toContain(".skillset/partials/preferred.md");
  expect(explained.entries[0]?.preprocessDependencies).toContain(".skillset/plugins/alpha/partials/plugin-only.md");
});

test("preprocessing reports named partial ambiguity, cycles, and cross-plugin references", async () => {
  const ambiguousRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/partials/one/intro.md": `
One.
`,
    ".skillset/partials/two/intro.md": `
Two.
`,
    ".skillset/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> intro}}
`,
  });
  await expect(buildSkillset(ambiguousRoot)).rejects.toThrow(
    "workspace named partial intro"
  );
  await expect(buildSkillset(ambiguousRoot)).rejects.toThrow("is ambiguous");

  const cycleRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/partials/a.md": `
A {{> b}}
`,
    ".skillset/partials/b.md": `
B {{> a}}
`,
    ".skillset/skills/bad/SKILL.md": `
---
name: bad
description: Bad skill.
---

{{> a}}
`,
  });
  await expect(buildSkillset(cycleRoot)).rejects.toThrow("creates a cycle");

  const crossPluginRoot = await fixture({
    "skillset.yaml": `
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

{{> beta.secret}}
`,
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
`,
    ".skillset/plugins/beta/partials/secret.md": `
Nope.
`,
  });
  await expect(buildSkillset(crossPluginRoot)).rejects.toThrow(
    "cannot reference another plugin"
  );

  const invalidRoot = await fixture({
    "skillset.yaml": `
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

{{> shared:templates/intro.md}}
`,
  });
  await expect(buildSkillset(invalidRoot)).rejects.toThrow(
    "must use dot-separated name segments"
  );
});

test("preprocessing expands this references and partials in instruction markdown", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/shared/templates/rule.md": `
Rule partial for {{this.title}}.
`,
    ".skillset/rules/docs/rule.md": `
---
title: Docs Rule
paths:
  - docs/**/*.md
---

Use {{this.title}} from {{skillset.source_rule}}.
Tree:
{{parent.tree depth:1}}

{{shared:templates/rule.md}}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(root);

  const claudeRule = await readFile(join(root, ".claude/rules/docs/rule.md"), "utf8");
  const codexAgents = await readFile(join(root, "docs/AGENTS.md"), "utf8");
  expect(claudeRule).toContain("Use Docs Rule from .skillset/rules/docs/rule.md.");
  expect(claudeRule).toContain("- rule.md");
  expect(claudeRule).toContain("Rule partial for Docs Rule.");
  expect(codexAgents).toContain("Use Docs Rule from .skillset/rules/docs/rule.md.");
  expect(codexAgents).toContain("- rule.md");
  expect(codexAgents).toContain("Rule partial for Docs Rule.");
  const explainedRule = await explainPath(root, ".skillset/rules/docs/rule.md");
  for (const entry of explainedRule.entries) {
    expect(entry.preprocessDependencies).toContain("tree:.skillset/rules/docs:1");
  }
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: project-claude
codex:
  projectRoot: project-codex
`,
    ".skillset/_codex/rules/deny.rules": `
match = "rm -rf"
decision = "deny"
`,
    ".skillset/_codex/config.json": `
{"note":"codex"}
`,
    ".skillset/_claude/agents/reviewer.md": `
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
  const codexLock = await readFile(join(root, "skillset.lock"), "utf8");
  expect(codexLock).toContain(`"kind": "island"`);
  expect(codexLock).toContain(`"outputPath": "project-codex/rules/deny.rules"`);
});

test("target-native islands reject frontmatter target escapes", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/_claude/agents/bad.md": `
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
    "skillset.yaml": `
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
  await Bun.write(join(root, ".skillset/_claude/assets/image.bin"), bytes);

  await buildSkillset(root);

  const copied = new Uint8Array(await Bun.file(join(root, ".claude/assets/image.bin")).arrayBuffer());
  expect([...copied]).toEqual([...bytes]);
});

test("project target-native islands are workspace-managed files without claiming target roots", async () => {
  const root = await fixture({
    ".codex/config.toml": `
model = "local"
`,
    "skillset.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/_codex/rules/deny.rules": `
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
  const workspaceLock = await readFile(join(root, "skillset.lock"), "utf8");
  expect(workspaceLock).toContain(`"kind": "island"`);
  expect(workspaceLock).toContain(`"outputPath": ".codex/rules/deny.rules"`);
  expect(await exists(join(root, ".codex/skillset.lock"))).toBe(false);
});

test("project target-native islands back up unmanaged destination collisions", async () => {
  const root = await fixture({
    ".codex/rules/deny.rules": `
match = "existing"
`,
    "skillset.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/_codex/rules/deny.rules": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .skillset/generated-claude
codex: false
`,
    ".skillset/_claude/settings.json": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: plugins-claude/project
codex: false
`,
    ".skillset/_claude/settings.json": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .claude
  plugins:
    path: .claude/plugins
codex: false
`,
    ".skillset/_claude/plugins/alpha/settings.json": `
{"note":"project island under plugin root"}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    ".skillset/_claude/plugins/alpha/settings.json would write inside active output root outputs.plugins.claude (.claude/plugins)"
  );
});

test("plugin-local target-native islands mirror to matching plugin output only", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/_claude/commands/review.md": `
# Claude command
`,
    ".skillset/plugins/alpha/_codex/config.json": `
{"codex": true}
`,
  });

  await buildSkillset(root);

  expect(await exists(join(root, "plugins-claude/plugins/alpha/commands/review.md"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/commands/review.md"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/alpha/config.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/alpha/config.json"))).toBe(false);
});

test("plugin-local provider source requires a plugin manifest", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alhpa/_claude/commands/review.md": `
# Typo island
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("expected plugin config skillset.yaml");
});

test("Codex plugin rules islands fail while portable src rules do not become Codex command policy", async () => {
  const portableRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/portable.rules": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/_codex/rules/plugin.rules": `
deny all
`,
  });

  await expectFeatureDiagnosticError(buildSkillset(pluginRulesRoot), {
    code: "target-native-island-unsupported",
    featureId: "target-native-islands",
    message: expect.stringContaining("Codex plugin .rules"),
    path: ".skillset/plugins/alpha/_codex/rules/plugin.rules",
  });
});

test("Codex project rules islands are only accepted under rules/", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/_codex/agents/bad.rules": `
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
    message: expect.stringContaining("Codex .rules outside .skillset/_codex/rules/"),
    path: ".skillset/_codex/agents/bad.rules",
  });
});

test("target-native island locks include partial provenance and explain/list visibility", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/shared/templates/tail.md": `
Tail.
`,
    ".skillset/_claude/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Use {{this.description}}.
{{shared:templates/tail.md}}
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await buildSkillset(root);

  const explained = await explainPath(root, ".skillset/_claude/agents/reviewer.md");
  expect(explained.kind).toBe("source-island");
  expect(explained.entries[0]?.validation).toBe("structured");
  expect(explained.entries[0]?.preprocessDependencies).toContain(".skillset/shared/templates/tail.md");
  const entries = await listGeneratedEntries(root);
  expect(entries.some((entry) => entry.kind === "island" && entry.outputPath === ".claude/agents/reviewer.md")).toBe(true);

  await writeFile(join(root, ".skillset/shared/templates/tail.md"), "Changed.\n");
  const diff = await diffSkillset(root);
  expect(diff.changed).toContain(".claude/agents/reviewer.md");
  expect(diff.changed).toContain("skillset.lock");
});

test("shared resource mappings reject unsafe and colliding output paths", async () => {
  const colliding = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  expect(await exists(join(root, "skills-claude/skillset.lock"))).toBe(true);
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
    "skillset.yaml": `
skillset:
  name: test-root
  version: 1.0.0
claude: true
codex: true
`,
    ".skillset/rules/docs/writing.md": `
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
    ".skillset/rules/typescript.md": `
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
  const codexLock = await readFile(join(root, "skillset.lock"), "utf8");
  const claudeLock = await readFile(join(root, ".claude/rules/skillset.lock"), "utf8");

  expect(claudeRule).toContain(`paths:
  - docs/**/*.md`);
  expect(claudeRule).not.toContain("title:");
  expect(claudeRule).not.toContain("skillset:");
  expect(claudeRule).toContain("# Docs Writing");
  expect(claudeRule).toContain("- Root: ../../..");
  expect(claudeRule).toContain("- Output dir: .claude/rules/docs");
  expect(claudeRule).toContain("- Source rule: .skillset/rules/docs/writing.md");
  expect(docsAgents).toContain("Generated by skillset@0.1.0");
  expect(docsAgents).toContain("# Docs Writing");
  expect(docsAgents).toContain("- Root: ..");
  expect(docsAgents).toContain("- Output dir: docs");
  expect(docsAgents).toContain("- Source rule: .skillset/rules/docs/writing.md");
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
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/root.md": `
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
  expect(rootAgents).toContain("- Source rule: .skillset/rules/root.md");
  expect(claudeRule).toContain("- Root: ../..");
  expect(claudeRule).toContain("- Output dir: .claude/rules");
  expect(claudeRule).toContain("- Source rule: .skillset/rules/root.md");
});

test("rules concatenate Codex AGENTS output and honor target opt-outs", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/docs/first.md": `
---
paths:
  - docs/**/*.md
claude: false
---

# First Docs Rule
`,
    ".skillset/rules/docs/second.md": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/root.md": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/root.md": `
# Root Rule

- Unknown: {{skillset.nope}}
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow(
    "unknown preprocess variable {{skillset.nope}} in .skillset/rules/root.md"
  );
});

test("rules generated-output verification catches stale managed AGENTS output", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/docs/writing.md": `
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
  await verifySkillset(root);
  await writeFile(join(root, "docs/AGENTS.md"), "stale\n");

  await expect(verifySkillset(root)).rejects.toThrow("stale generated file: docs/AGENTS.md");
});

test("rules reject Codex symlink mode until target-clean symlinks are designed", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/rules/docs/writing.md": `
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
    "skillset.yaml": `
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
  const lock = await readFile(join(root, "plugins-codex/skillset.lock"), "utf8");

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
    "skillset.yaml": `
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
  const lock = await readFile(join(root, "plugins-codex/skillset.lock"), "utf8");

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
    "skillset.yaml": `
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
  const lock = await readFile(join(root, "plugins-codex/skillset.lock"), "utf8");

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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("allowed_tools arrays must not be empty", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/tools/SKILL.md": `
---
name: tools
description: Empty allowed tools.
allowed_tools: []
---

Tools body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("allowed_tools to be false, a string, a string array, or target map");
});

test("target-scoped policy maps reject unknown target keys", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "plugins-claude/skillset.lock": `
{
  "generatedBy": "skillset@0.1.0"
}
`,
    "plugins-claude/stale.txt": `
stale
`,
  });

  await expect(verifySkillset(root)).rejects.toThrow("stale generated file");
  await buildSkillset(root);
  expect(await exists(join(root, "plugins-claude/skillset.lock"))).toBe(false);
  expect(await exists(join(root, "plugins-claude/stale.txt"))).toBe(false);
});

test("generated-output verification catches stale generated output", async () => {
  const root = await fixture({
    "skillset.yaml": `
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

  await expect(verifySkillset(root)).rejects.toThrow("stale generated file");
});

test("generated-output verification reports stale generated skill and plugin versions", async () => {
  const root = await fixture({
    "skillset.yaml": `
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

  await expect(verifySkillset(root)).rejects.toThrow(
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

  await expect(verifySkillset(root)).rejects.toThrow(
    "version drift: plugins-claude/plugins/alpha/.claude-plugin/plugin.json version is 1.0.0, expected 1.1.0"
  );
});

test("source versions override target-native version overrides", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  await expect(loadBuildGraph(invalidRoot)).rejects.toThrow("skillset.yaml.skillset.version to be a semantic version");

  const invalidPlugin = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
  const skippedCodexLock = await readFile(join(root, "plugins-codex/skillset.lock"), "utf8");
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
    "skillset.yaml": `
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
    "skillset.yaml": `
skillset:
  name: test-root
claude:
  projectRoot: .skillset/generated-agents
codex: false
`,
    ".skillset/agents/reviewer.md": `
---
description: Reviews code.
---

Review carefully.
`,
  });

  await expect(buildSkillset(claudeProjectRootOverlap)).rejects.toThrow("must not point inside source root");

  const codexProjectRootOverlap = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: false
codex:
  projectRoot: .skillset/generated-agents
`,
    ".skillset/agents/reviewer.md": `
---
description: Reviews code.
---

Review carefully.
`,
  });

  await expect(buildSkillset(codexProjectRootOverlap)).rejects.toThrow("must not point inside source root");

  const projectRootOutputRootOverlap = await fixture({
    "skillset.yaml": `
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
    ".skillset/agents/reviewer.md": `
---
description: Reviews code.
---

Review carefully.
`,
  });

  await expect(buildSkillset(projectRootOutputRootOverlap)).rejects.toThrow("must not overlap active output root");

  const duplicateRoot = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
      "skillset.yaml": `
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

test("compile.unsupportedDestination defaults to error and accepts explicit error", async () => {
  const defaultRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  const explicitRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  unsupportedDestination: error
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(defaultRoot)).resolves.toMatchObject({
    root: { compile: { targets: ["claude", "codex"], unsupportedDestination: "error" } },
  });
  await expect(loadBuildGraph(explicitRoot)).resolves.toMatchObject({
    root: { compile: { targets: ["claude", "codex"], unsupportedDestination: "error" } },
  });
});

test("compile.unsupportedDestination rejects malformed, unknown, and deferred policies", async () => {
  const basePlugin = {
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  };
  const malformedRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile: true
`,
    ...basePlugin,
  });

  await expect(loadBuildGraph(malformedRoot)).rejects.toThrow(".compile to be an object");

  const unknownRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  unsupportedDestination: maybe
`,
    ...basePlugin,
  });

  await expect(loadBuildGraph(unknownRoot)).rejects.toThrow("expected one of: error, warn, skip, force");

  const warnRoot = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
compile:
  unsupportedDestination: warn
`,
    ...basePlugin,
  });

  await expect(loadBuildGraph(warnRoot)).rejects.toThrow("reserved but not supported yet");
});

test("unknown top-level skillset config keys are rejected", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
surprise: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
  });

  await expect(loadBuildGraph(root)).rejects.toThrow("unsupported top-level key surprise");
});

test("plugin-local config.yaml is rejected after workspace layout cutover", async () => {
  const root = await fixture({
    "skillset.yaml": `
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

  await expect(loadBuildGraph(root)).rejects.toThrow("uses retired plugin config.yaml");
});

test("skillset.id is rejected before public release", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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
    "skillset.yaml": `
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

test("lint ignores prose prices that look like positional arguments", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: test-root
claude: true
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/pricing/SKILL.md": `
---
name: pricing
description: Mentions a normal price.
---

This workflow can save about $200 when the cleanup is automated.
Small runs can also save $5, $9.99, or $1.99 in normal prose.
`,
  });

  await expect(lintSkillset(root)).resolves.toMatchObject({ issues: [] });
});

test("lint checks Codex-enabled standalone skills", async () => {
  const root = await fixture({
    "skillset.yaml": `
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
    "skillset.yaml": `
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

  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    const outputPath = join(root, path);
    await Bun.write(outputPath, normalizeFixture(content));
  }

  return root;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

function cachePath(root: string, logicalPath: string): string {
  return resolveOperationalPath(createOperationalPathContext(root), logicalPath);
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
