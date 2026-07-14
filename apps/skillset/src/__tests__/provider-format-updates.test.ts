import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

import { buildSkillset } from "@skillset/core";
import { ciSkillset } from "../ci";
import {
  renderProviderFormatUpdateReport,
  runProviderFormatUpdates,
} from "../provider-format-updates";

const CODEX_PLUGIN_MANIFEST = "plugins/alpha/codex/.codex-plugin/plugin.json";
const CODEX_AGENT = ".codex/agents/reviewer.toml";

test("SET-195: check preview reports user-facing safe destination-format diagnostics", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const report = await runProviderFormatUpdates(root, "check");

  expect(report.wrote).toBe(false);
  expect(report.safeUpdates.map((action) => action.id)).toEqual([
    "codex-plugin-component-paths-adapter-update",
  ]);
  expect(report.safeUpdates[0]?.affectedPaths).toEqual([CODEX_PLUGIN_MANIFEST]);
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);
  expect(renderProviderFormatUpdateReport(report)).toMatchSnapshot();
});

test("SET-278: check write modes leave provider-format updates to update", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const local = await runSkillsetCli("check", "--write", "--root", root);
  const ci = await runSkillsetCli("check", "--ci", "--fix", "--since", "HEAD", "--root", root);

  expect(local.exitCode).toBe(1);
  expect(local.stdout).toContain(`provider-format update ${CODEX_PLUGIN_MANIFEST}`);
  expect(local.stdout).toContain("run skillset update");
  expect(ci.exitCode).toBe(1);
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);
});

test("SET-278: check writes provider-backed drift caused by source changes", async () => {
  const root = await builtFixture(pluginFixture());
  const sourcePath = join(root, ".skillset/plugins/alpha/skillset.yaml");
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  await writeFile(
    sourcePath,
    (await readFile(sourcePath, "utf8")).replace("  name: alpha", "  name: alpha\n  description: Updated plugin."),
    "utf8"
  );

  const checked = await runSkillsetCli("check", "--write", "--root", root);

  expect(checked.exitCode).toBe(0);
  expect(checked.stdout).not.toContain("provider-format update");
  expect(await readFile(manifestPath, "utf8")).toContain("Updated plugin.");
});

test("SET-278: update ignores ordinary source-driven drift", async () => {
  const root = await builtFixture(pluginFixture());
  const sourcePath = join(root, ".skillset/plugins/alpha/skillset.yaml");
  await writeFile(
    sourcePath,
    (await readFile(sourcePath, "utf8")).replace("  name: alpha", "  name: alpha\n  description: Updated plugin."),
    "utf8"
  );

  const report = await runProviderFormatUpdates(root, "update");

  expect(report.blocked).toBe(false);
  expect(report.sourceDriftPaths).toContain(CODEX_PLUGIN_MANIFEST);
  expect(report.unplannedDriftPaths).toEqual([]);
});

test("SET-278: update does not write source drift alongside provider updates", async () => {
  const root = await builtFixture({
    ...pluginFixture(),
    ".skillset/skills/other/SKILL.md": "---\nname: other\ndescription: Original.\n---\n\nBody.\n",
  });
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const generatedSkillPath = join(root, ".agents/skills/other/SKILL.md");
  const originalManifest = await readFile(manifestPath, "utf8");
  const originalSkill = await readFile(generatedSkillPath, "utf8");
  await writeFile(manifestPath, `${originalManifest}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);
  const sourcePath = join(root, ".skillset/skills/other/SKILL.md");
  await writeFile(
    sourcePath,
    (await readFile(sourcePath, "utf8")).replace("Original.", "Updated."),
    "utf8"
  );

  const updated = await runSkillsetCli("update", "--yes", "--root", root);

  expect(updated.exitCode).toBe(1);
  expect(updated.stdout).toContain("source drift must be written separately");
  expect(await readFile(manifestPath, "utf8")).not.toBe(originalManifest);
  expect(await readFile(generatedSkillPath, "utf8")).toBe(originalSkill);
});

test("SET-278: missing managed output stays target drift when its source also changes", async () => {
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: missing-target\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Original.\n---\n\nBody.\n",
  });
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await rm(join(root, generatedPath));
  await writeFile(
    sourcePath,
    (await readFile(sourcePath, "utf8")).replace("Original.", "Updated."),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.providerUpdatePaths).toContain(generatedPath);
  expect(await Bun.file(join(root, generatedPath)).exists()).toBe(false);
});

test("SET-278: check writes generated drift caused by target defaults", async () => {
  const root = await builtFixture({
    "skillset.yaml": `
skillset:
  name: config-drift
defaults:
  codex:
    skills:
      frontmatter:
        review-state: initial
claude: false
codex: true
`,
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });
  const configPath = join(root, "skillset.yaml");
  const generatedPath = ".agents/skills/demo/SKILL.md";
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace("review-state: initial", "review-state: updated"),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(generatedPath);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("review-state: updated");
});

test("SET-278: check writes skill drift caused by root metadata toggles", async () => {
  const root = await builtFixture({
    "skillset.yaml": `
skillset:
  name: metadata-drift
compile:
  skillset:
    metadata: false
claude: false
codex: true
`,
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });
  const configPath = join(root, "skillset.yaml");
  const generatedPath = ".agents/skills/demo/SKILL.md";
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace("metadata: false", "metadata: true"),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(generatedPath);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("generated: skillset");
});

test("SET-278: check writes project-agent drift caused by target defaults", async () => {
  const root = await builtFixture({
    ...agentFixture(),
    "skillset.yaml": agentFixture()["skillset.yaml"]?.replace(
      "codex: true",
      "defaults:\n  codex:\n    agents:\n      model: gpt-5\ncodex: true"
    ) ?? "",
  });
  const configPath = join(root, "skillset.yaml");
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace("model: gpt-5", "model: gpt-5.1"),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(CODEX_AGENT);
  expect(await readFile(join(root, CODEX_AGENT), "utf8")).toContain('model = "gpt-5.1"');
});

test("SET-278: check writes project-agent drift caused by adaptive hooks", async () => {
  const generatedPath = ".claude/agents/reviewer.md";
  const hookPath = ".skillset/agents/reviewer/hooks/session.json";
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: agent-hook-drift\nclaude: true\ncodex: false\ncursor: false\n",
    ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
hooks:
  SessionStart:
    - session
---

Review code.
`,
    [hookPath]: JSON.stringify({
      events: ["SessionStart"],
      run: { command: "echo initial" },
    }),
  });
  await writeFile(
    join(root, hookPath),
    JSON.stringify({ events: ["SessionStart"], run: { command: "echo updated" } }),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(generatedPath);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("echo updated");
});

test("SET-278: check writes skill drift caused by inherited adaptive hooks", async () => {
  const generatedPath = ".claude/skills/reviewer/SKILL.md";
  const hookPath = ".skillset/hooks/session.json";
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: skill-hook-drift\nclaude: true\ncodex: false\ncursor: false\n",
    ".skillset/skills/reviewer/SKILL.md": `
---
name: reviewer
description: Reviews code.
hooks:
  SessionStart:
    - session
---

Review code.
`,
    [hookPath]: JSON.stringify({
      events: ["SessionStart"],
      run: { command: "echo initial" },
    }),
  });
  await writeFile(
    join(root, hookPath),
    JSON.stringify({ events: ["SessionStart"], run: { command: "echo updated" } }),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(generatedPath);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("echo updated");
});

test("SET-278: check writes version-only source drift", async () => {
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: version-drift\n  version: 1.0.0\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });
  const configPath = join(root, "skillset.yaml");
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace("version: 1.0.0", "version: 2.0.0"),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(generatedPath);
  expect(await readFile(join(root, generatedPath), "utf8")).toContain("version: 2.0.0");
});

test("SET-278: check propagates source drift to secondary generated files", async () => {
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: secondary-source-drift\nclaude: true\ncodex: false\n",
    ".skillset/shared/references/guide.md": "# Initial guide\n",
    ".skillset/skills/demo/SKILL.md": `---
name: demo
description: Demo.
resources:
  references:
    - shared:references/guide.md
---

Initial body.
`,
  });
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const generatedPath = ".claude/skills/demo/references/guide.md";
  await writeFile(
    sourcePath,
    (await readFile(sourcePath, "utf8")).replace("Initial body.", "Updated body."),
    "utf8"
  );
  await writeFile(join(root, ".skillset/shared/references/guide.md"), "# Updated guide\n", "utf8");

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(generatedPath);
  expect(await readFile(join(root, generatedPath), "utf8")).toBe("# Updated guide\n");
});

test("SET-278: check writes inherited plugin license metadata drift", async () => {
  const root = await builtFixture({
    ...pluginFixture(),
    "skillset.yaml": pluginFixture()["skillset.yaml"]?.replace(
      "  name: provider-update-root",
      "  name: provider-update-root\n  license: MIT"
    ) ?? "",
  });
  const rootConfigPath = join(root, "skillset.yaml");
  await writeFile(
    rootConfigPath,
    (await readFile(rootConfigPath, "utf8")).replace("license: MIT", "license: Apache-2.0"),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(CODEX_PLUGIN_MANIFEST);
  expect(report.fixedPaths).toContain("plugins/alpha/codex/LICENSE.txt");
});

test("SET-278: check writes root-owner-derived plugin manifest drift", async () => {
  const root = await builtFixture({
    ...pluginFixture(),
    "skillset.yaml": pluginFixture()["skillset.yaml"]?.replace(
      "  name: provider-update-root",
      "  name: provider-update-root\n  owner:\n    name: Original Maintainer"
    ) ?? "",
  });
  const rootConfigPath = join(root, "skillset.yaml");
  await writeFile(
    rootConfigPath,
    (await readFile(rootConfigPath, "utf8")).replace("Original Maintainer", "Updated Maintainer"),
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(CODEX_PLUGIN_MANIFEST);
  expect(await readFile(join(root, CODEX_PLUGIN_MANIFEST), "utf8")).toContain("Updated Maintainer");
});

test("SET-278: check writes plugin manifest drift caused by companion surfaces", async () => {
  const root = await builtFixture({
    ...pluginFixture(),
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp: false
`,
  });
  const configPath = join(root, ".skillset/plugins/alpha/skillset.yaml");
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace("mcp: false", "mcp: true"),
    "utf8"
  );
  await writeFile(
    join(root, ".skillset/plugins/alpha/.mcp.json"),
    '{"mcpServers":{"alpha":{"command":"node"}}}\n',
    "utf8"
  );

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(CODEX_PLUGIN_MANIFEST);
  expect(await readFile(join(root, CODEX_PLUGIN_MANIFEST), "utf8")).toContain('"mcpServers": "./.mcp.json"');
});

test("SET-278: check writes plugin manifest drift caused by native companion paths", async () => {
  const root = await builtFixture(pluginFixture());
  const appPath = ".skillset/plugins/alpha/.app.json";
  await writeFile(join(root, appPath), '{"apps":[]}\n', "utf8");

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(CODEX_PLUGIN_MANIFEST);
  expect(report.fixedPaths).toContain("plugins/alpha/codex/.app.json");
  expect(await readFile(join(root, CODEX_PLUGIN_MANIFEST), "utf8")).toContain(
    '"apps": "./.app.json"'
  );
});

test("SET-278: check writes lock-only source provenance drift", async () => {
  const root = await builtFixture(pluginFixture());
  const lockPath = join(root, "plugins/skillset.lock");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    readonly items: Array<{ kind?: string; sourceHash?: string }>;
  };
  const item = lock.items.find((candidate) => candidate.kind === "plugin");
  if (item === undefined) throw new Error("missing plugin lock item");
  item.sourceHash = `sha256:${"0".repeat(64)}`;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toEqual(["plugins/skillset.lock"]);
});

test("SET-278: check writes first-time provider-backed outputs", async () => {
  const root = await fixture(pluginFixture());

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(await readFile(join(root, CODEX_PLUGIN_MANIFEST), "utf8")).toContain('"name": "alpha"');
});

test("SET-278: check writes stale managed outputs caused by source deletion", async () => {
  const root = await builtFixture({
    ...pluginFixture(),
    ".skillset/skills/keep/SKILL.md": "---\nname: keep\ndescription: Keep.\n---\n\nBody.\n",
  });
  await rm(join(root, ".skillset/plugins/alpha"), { recursive: true });

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.providerUpdatePaths).toEqual([]);
  expect(report.fixedPaths).toContain(CODEX_PLUGIN_MANIFEST);
  expect(await Bun.file(join(root, CODEX_PLUGIN_MANIFEST)).exists()).toBe(false);
});

test("SET-278: check does not rebuild unplanned non-source drift", async () => {
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: unplanned-drift\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });
  const generatedPath = ".claude/skills/demo/SKILL.md";
  await rm(join(root, generatedPath));

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.providerUpdatePaths).toContain(generatedPath);
});

test("SET-278: check blocks lock-clean unplanned destination drift", async () => {
  const root = await builtFixture({
    "skillset.yaml": "skillset:\n  name: lock-clean-unplanned-drift\nclaude: true\ncodex: false\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo.\n---\n\nBody.\n",
  });
  const generatedPath = ".claude/skills/demo/SKILL.md";
  const absolutePath = join(root, generatedPath);
  await writeFile(absolutePath, `${await readFile(absolutePath, "utf8")}\nUnregistered destination change.\n`);
  await markCurrentGeneratedPathAsManaged(root, generatedPath);

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.providerUpdatePaths).toContain(generatedPath);
  expect(await readFile(absolutePath, "utf8")).toContain("Unregistered destination change.");
});

test("SET-194: update previews then writes the same safe provider-format plan", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const preview = await runSkillsetCli("update", "--root", root);

  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("next: run skillset update --yes");
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);

  const written = await runSkillsetCli("update", "--yes", "--root", root);

  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("applied safe destination-format updates");
  expect(await readFile(manifestPath, "utf8")).toBe(original);
});

test("SET-194: arbitrary edits on safe provider paths block writes", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// hand edit\n`, "utf8");

  const blocked = await runSkillsetCli("update", "--yes", "--root", root);

  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toBe("");
  expect(blocked.stdout).toContain("manual review required: Codex plugin");
  expect(blocked.stdout).toContain("differs from its previous skillset.lock hash");
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);
});

test("SET-195: mixed safe and manual drift does not suggest blocked write commands", async () => {
  const root = await builtFixture({ ...pluginFixture(), ...agentFixtureSource() });
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const agentPath = join(root, CODEX_AGENT);
  await writeFile(manifestPath, `${await readFile(manifestPath, "utf8")}\n// stale\n`, "utf8");
  await writeFile(agentPath, `${await readFile(agentPath, "utf8")}\n# stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const report = await runProviderFormatUpdates(root, "check");
  const rendered = renderProviderFormatUpdateReport(report);

  expect(report.blocked).toBe(true);
  expect(report.safeUpdates).toHaveLength(1);
  expect(report.manualReviews).toHaveLength(1);
  expect(rendered).toContain("next: resolve blocking manual review or unplanned drift before applying safe updates");
  expect(rendered).not.toContain("next: run skillset check --fix or skillset update --yes");
});

test("SET-195: unsafe provider-format drift reports user-facing manual review diagnostics", async () => {
  const root = await builtFixture(agentFixture());
  const agentPath = join(root, CODEX_AGENT);
  const original = await readFile(agentPath, "utf8");
  await writeFile(agentPath, `${original}\n# stale\n`, "utf8");

  const blocked = await runSkillsetCli("update", "--yes", "--root", root);

  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toBe("");
  expect(blocked.stdout).toMatchSnapshot();
  expect(blocked.stdout).toContain("destination-format updates require manual review before writing");
  expect(await readFile(agentPath, "utf8")).not.toBe(original);
});

test("SET-278: check write modes block lock-matching manual provider migrations", async () => {
  const root = await builtFixture(agentFixture());
  const agentPath = join(root, CODEX_AGENT);
  const migrated = `${await readFile(agentPath, "utf8")}\n# old provider format\n`;
  await writeFile(agentPath, migrated, "utf8");
  await markCurrentGeneratedPathAsManaged(root, CODEX_AGENT);

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.providerUpdatePaths).toContain(CODEX_AGENT);
  expect(await readFile(agentPath, "utf8")).toBe(migrated);
});

test("SET-278: check --fix requires CI mode and does not replace update", async () => {
  const root = await builtFixture(agentFixture());
  const agentPath = join(root, CODEX_AGENT);
  const original = await readFile(agentPath, "utf8");
  await writeFile(agentPath, `${original}\n# stale\n`, "utf8");

  const blocked = await runSkillsetCli("check", "--fix", "--root", root);

  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toContain("check --fix requires --ci");
  expect(await readFile(agentPath, "utf8")).not.toBe(original);
});

test("SET-194: update rejects scoped writes before safety planning", async () => {
  const root = await builtFixture(pluginFixture());

  const scoped = await runSkillsetCli("update", "--yes", "--scope", "plugins", "--root", root);

  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("update does not support --scope");
});

async function builtFixture(files: Record<string, string>): Promise<string> {
  const root = await fixture(files);
  await buildSkillset(root);
  return root;
}

async function markCurrentPluginManifestAsManaged(root: string): Promise<void> {
  await markCurrentGeneratedPathAsManaged(root, CODEX_PLUGIN_MANIFEST.replace("plugins/", ""));
}

async function markCurrentGeneratedPathAsManaged(root: string, generatedPath: string): Promise<void> {
  const relativeLockPath = generatedPath.startsWith(".codex/")
    ? "skillset.lock"
    : generatedPath.startsWith(".claude/skills/")
      ? ".claude/skills/skillset.lock"
      : "plugins/skillset.lock";
  const lockPath = join(root, relativeLockPath);
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    readonly outputRoot: string;
    readonly items: Array<{
      files?: readonly string[];
      outputHash?: string;
    }>;
  };
  const item = lock.items.find((candidate) => candidate.files?.some((file) =>
    file === generatedPath || join(lock.outputRoot, file) === generatedPath
  ));
  if (item?.files === undefined) throw new Error("missing plugin manifest lock item");
  item.outputHash = await hashLockItem(root, lock.outputRoot, item.files);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function hashLockItem(root: string, outputRoot: string, files: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(root, outputRoot === "." ? file : join(outputRoot, file))));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function pluginFixture(): Record<string, string> {
  return {
    "skillset.yaml": `
skillset:
  name: provider-update-root
claude: false
codex: true
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
  };
}

function agentFixture(): Record<string, string> {
  return {
    "skillset.yaml": `
skillset:
  name: provider-update-root
claude: false
codex: true
`,
    ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Review code.
`,
  };
}

function agentFixtureSource(): Record<string, string> {
  return {
    ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Review code.
`,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-format-updates-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${content.trim()}\n`, "utf8");
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
