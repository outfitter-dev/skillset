import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

import { buildSkillset, verifySkillset } from "../build";
import { inspectSkillset, lintSkillset } from "../lint";
import { compareStrings } from "../path";
import { loadBuildGraph } from "../resolver";

const KITCHEN_SINK_FIXTURE = join(import.meta.dir, "..", "..", "..", "..", "fixtures", "kitchen-sink");

test("kitchen-sink fixture builds every implemented surface and stays current", async () => {
  const root = await kitchenSink();

  await buildSkillset(root);

  // Plugin-local + root shared resources copied beside SKILL.md.
  expect(
    await readFile(join(root, "plugins-claude/plugins/kitchen/skills/sink/references/shared-ref.md"), "utf8")
  ).toContain("Shared Reference");
  expect(
    await readFile(join(root, "plugins-codex/plugins/kitchen/skills/sink/references/plugin-ref.md"), "utf8")
  ).toContain("Plugin Reference");

  // Custom from/to mapping emits at the remapped path...
  expect(
    await readFile(join(root, "plugins-claude/plugins/kitchen/skills/sink/docs/report.md"), "utf8")
  ).toContain("Report Template");

  // ...and prose links through that mapping are rewritten to the emitted path.
  const codexSkill = await readFile(
    join(root, "plugins-codex/plugins/kitchen/skills/sink/SKILL.md"),
    "utf8"
  );
  expect(codexSkill).toContain("[report template](docs/report.md)");
  expect(codexSkill).toContain("[shared reference](references/shared-ref.md)");
  expect(codexSkill).toContain("[plugin reference](references/plugin-ref.md#usage)");
  expect(codexSkill).not.toContain("shared:");
  expect(codexSkill).not.toContain("plugin:");

  // Target-native companion surfaces.
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/commands/review.md"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/hooks/hooks.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/.mcp.json"))).toBe(true);
  // SET-2: Codex hooks emit at the documented hooks/hooks.json path.
  expect(await exists(join(root, "plugins-codex/plugins/kitchen/hooks.json"))).toBe(false);
  const codexKitchenHook = await readFile(
    join(root, "plugins-codex/plugins/kitchen/hooks/hooks.json"),
    "utf8"
  );
  expect(codexKitchenHook).toContain(`"hooks"`);
  expect(codexKitchenHook).toContain("SessionStart");
  expect(await exists(join(root, "plugins-codex/plugins/kitchen/.app.json"))).toBe(true);
  expect(await exists(join(root, "plugins-codex/plugins/kitchen/.mcp.json"))).toBe(true);
  // SET-8: Claude-native pass-through surfaces are copied and declared in the manifest.
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/.lsp.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/output-styles/concise.md"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/themes/midnight.json"))).toBe(true);
  expect(await exists(join(root, "plugins-claude/plugins/kitchen/monitors/monitors.json"))).toBe(true);
  const claudeKitchenManifest = await readFile(
    join(root, "plugins-claude/plugins/kitchen/.claude-plugin/plugin.json"),
    "utf8"
  );
  expect(claudeKitchenManifest).toContain(`"lspServers": "./.lsp.json"`);
  expect(claudeKitchenManifest).toContain(`"outputStyles": "./output-styles/"`);
  expect(claudeKitchenManifest).toContain(`"themes": "./themes/"`);
  expect(claudeKitchenManifest).toContain(`"monitors": "./monitors/monitors.json"`);
  // SET-8: these Claude-native surfaces are not copied into Codex output.
  expect(await exists(join(root, "plugins-codex/plugins/kitchen/.lsp.json"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/kitchen/themes/midnight.json"))).toBe(false);
  // Claude agents/ surface absent from Codex output (none declared here either).
  expect(await exists(join(root, "plugins-codex/plugins/kitchen/commands/review.md"))).toBe(false);

  // Rules lower to Claude rules and Codex AGENTS.md, with build-time variables.
  expect(await readFile(join(root, ".claude/rules/global.md"), "utf8")).toContain("Global Rule");
  const docsRule = await readFile(join(root, ".claude/rules/docs/writing.md"), "utf8");
  expect(docsRule).toContain("paths:");
  expect(docsRule).toContain(".claude/rules/docs");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Build from . and inspect");
  expect(await readFile(join(root, "docs/AGENTS.md"), "utf8")).toContain("lives under docs");

  // Generated output is internally consistent and lint-clean.
  expect((await verifySkillset(root)).checkedFiles).toBeGreaterThan(0);
  await expect(lintSkillset(root)).resolves.toBeDefined();
});

test("custom resources.to rejects an ambiguous bare link to the source path", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/shared/templates/report.md": `
# Report
`,
    ".skillset/src/plugins/alpha/skills/remap/SKILL.md": `
---
name: remap
description: Remaps a resource and links the bare source path.
resources:
  templates:
    - from: plugin:templates/report.md
      to: docs/report.md
---

Use the [report](templates/report.md) before writing.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("a declared resource remaps");
});

test("custom resources.to rejects ambiguous bare links under remapped directories", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/shared/templates/report.md": `
# Report
`,
    ".skillset/src/plugins/alpha/skills/remap/SKILL.md": `
---
name: remap
description: Remaps a resource directory and links the bare source path.
resources:
  templates:
    - from: plugin:templates
      to: docs
---

Use the [report](templates/report.md) before writing.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("link to docs/report.md");
});

test("declared directory resource URLs rewrite child links through custom to paths", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/shared/templates/report.md": `
# Report
`,
    ".skillset/src/plugins/alpha/skills/remap/SKILL.md": `
---
name: remap
description: Remaps a resource directory and links the resource URL.
resources:
  templates:
    - from: plugin:templates
      to: docs
---

Use the [report](plugin:templates/report.md#intro) before writing.
`,
  });

  await buildSkillset(root);

  const skill = await readFile(
    join(root, "plugins-claude/plugins/alpha/skills/remap/SKILL.md"),
    "utf8"
  );
  expect(skill).toContain("[report](docs/report.md#intro)");
});

test("Codex hooks reject unsupported events", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/hooks/hooks.json": `
{
  "Notification": [
    { "hooks": [ { "type": "command", "command": "./run.sh" } ] }
  ]
}
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("Notification");
  const lintReport = await inspectSkillset(await loadBuildGraph(root));
  expect(lintReport.issues).toContainEqual(expect.objectContaining({
    code: "hook-target-incompatible",
    featureId: "plugin-hooks",
  }));
  await expect(lintSkillset(root)).rejects.toThrow("Codex does not support");
});

test("Codex hooks reject non-command handler types", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/hooks/hooks.json": `
{
  "PreToolUse": [
    { "hooks": [ { "type": "prompt", "prompt": "ask" } ] }
  ]
}
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("only runs type: command hook handlers");
  await expect(lintSkillset(root)).rejects.toThrow("only runs type: command hook handlers");
});

test("Codex hooks reject missing handler types", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/hooks/hooks.json": `
{
  "PreToolUse": [
    { "hooks": [ { "command": "./run.sh" } ] }
  ]
}
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("missing/non-string type");
  await expect(lintSkillset(root)).rejects.toThrow("missing/non-string type");
});

test("hook lint skips hooks for excluded plugin outputs", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex:
  plugins:
    - beta
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/hooks/hooks.json": `
{
  "Notification": [
    { "hooks": [ { "type": "prompt", "prompt": "ask" } ] }
  ]
}
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
    ".skillset/src/plugins/beta/skillset.yaml": `
skillset:
  name: beta
`,
    ".skillset/src/plugins/beta/skills/beta-skill/SKILL.md": `
---
name: beta-skill
description: Beta skill.
---

Beta body.
`,
  });

  await expect(buildSkillset(root)).resolves.toBeDefined();
  await expect(lintSkillset(root)).resolves.toBeDefined();
  expect(await exists(join(root, "plugins-codex/plugins/alpha/.codex-plugin/plugin.json"))).toBe(false);
  expect(await exists(join(root, "plugins-codex/plugins/beta/.codex-plugin/plugin.json"))).toBe(true);
});

test("Codex hooks reject async command handlers because Codex skips them", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: false
codex: true
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/hooks/hooks.json": `
{
  "PreToolUse": [
    { "hooks": [ { "type": "command", "command": "./run.sh", "async": true } ] }
  ]
}
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(root)).rejects.toThrow("async command hooks");
  await expect(lintSkillset(root)).rejects.toThrow("async command hooks");
});

test("Claude hook validation stays broad and accepts Codex-only event names", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    // SessionEnd is Claude-only; PermissionRequest would be Codex-only. Claude
    // accepts both because Claude hook validation is intentionally shape-only.
    ".skillset/src/plugins/alpha/hooks/hooks.json": `
{
  "hooks": {
    "SessionEnd": [ { "hooks": [ { "type": "command", "command": "./run.sh" } ] } ]
  }
}
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await expect(buildSkillset(root)).resolves.toBeDefined();
  await expect(lintSkillset(root)).resolves.toBeDefined();
});

test("corrupt workspace skillset.lock fails loudly instead of disabling guards", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
`,
    ".skillset/src/rules/global.md": `
# Global Rule

- Keep it tidy.
`,
  });

  await buildSkillset(root);
  await writeFile(join(root, "skillset.lock"), "{ not valid json", "utf8");

  await expect(verifySkillset(root)).rejects.toThrow("cannot guard generated state");
  await expect(buildSkillset(root)).rejects.toThrow("cannot guard generated state");
});

test("corrupt generated output skillset.lock fails loudly instead of disabling guards", async () => {
  const root = await fixture({
    ".skillset/config.yaml": `
skillset:
  name: test-root
claude: true
codex: false
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/skills/alpha-skill/SKILL.md": `
---
name: alpha-skill
description: Alpha skill.
---

Alpha body.
`,
  });

  await buildSkillset(root);
  await writeFile(join(root, "plugins-claude/skillset.lock"), "{ not valid json", "utf8");

  await expect(verifySkillset(root)).rejects.toThrow("generated lock plugins-claude/skillset.lock cannot guard generated state");
  await expect(buildSkillset(root)).rejects.toThrow("generated lock plugins-claude/skillset.lock cannot guard generated state");
});

test("compareStrings orders by code unit independent of locale", () => {
  const input = ["b", "A", "a", "-", "B", "Z", "1"];
  const sorted = [...input].sort(compareStrings);
  // Code-unit order: digits < uppercase < lowercase, '-' (0x2D) before digits.
  expect(sorted).toEqual(["-", "1", "A", "B", "Z", "a", "b"]);
});

async function kitchenSink(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-kitchen-"));
  await cp(KITCHEN_SINK_FIXTURE, root, { recursive: true });
  return root;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-hardening-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trimStart().trimEnd()}\n`);
  }
  return root;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
