import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";
import { buildSkillset } from "@skillset/core";
import { changeStatus, collectSourceInventory } from "../change-status";
import { readReleaseState } from "@skillset/core/internal/release-state";

import {
  commitFixture,
  contractFixture,
  runGit,
  runSkillsetCli,
  sourceInventoryUnit,
  writeHistory,
  writePendingChange,
} from "./contract-test-helpers";

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

  const manifestPath = join(root, "plugins/alpha/plugin.json");
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
  expect(await readFile(join(root, "plugins/alpha/.claude-plugin/plugin.json"), "utf8")).toContain('"version": "0.2.0"');
  expect(await readFile(join(root, "plugins/alpha/skills/child/SKILL.md"), "utf8")).toContain("version: 0.2.0");
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
claude: false
codex: false
cursor: false
`,
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  version: 0.1.0
`,
    ".skillset/plugins/alpha/.mcp.json": `
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "alpha": { "command": "node", "type": "stdio" }
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
