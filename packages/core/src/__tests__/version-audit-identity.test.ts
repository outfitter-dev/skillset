import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";
import { writeReleaseState } from "../release-state";
import { auditVersions } from "../version-audit";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture(config = "compile:\n  targets: [claude, codex]\n") {
  const root = await createTestFixtureRoot("version-audit-identity-");
  roots.push(root);
  for (const [path, text] of Object.entries({
    "skillset.yaml": config,
    ".skillset/plugins/alpha/skillset.yaml":
      "skillset:\n  name: alpha\n  version: 1.2.3\n",
    ".skillset/plugins/alpha/skills/(group)/folder/SKILL.md":
      "---\nname: demo\ndescription: Plugin child.\n---\nPlugin body.\n",
    ".skillset/skills/(group)/standalone/SKILL.md":
      "---\nname: demo\ndescription: Standalone.\n---\nStandalone body.\n",
  }))
    await Bun.write(join(root, path), text);
  await writeReleaseState(root, {
    scopes: {
      "plugin:alpha": { version: "2.0.0" },
      "plugin.alpha.skill:demo": { version: "3.0.0" },
    },
  });
  await buildSkillset(root);
  return root;
}

test("audits both shared manifests and plugin child release authority", async () => {
  const root = await fixture();
  const report = await auditVersions(root);
  for (const [path, target] of [
    ["plugins/alpha/.claude-plugin/plugin.json", "claude"],
    ["plugins/alpha/plugin.json", "codex"],
  ])
    expect(report.loci.find((locus) => locus.path === path)).toMatchObject({
      scope: "plugin:alpha",
      target,
      authority: "release-state",
      expectedVersion: "2.0.0",
      status: "in-sync",
    });
  expect(
    report.loci.find(
      (locus) => locus.path === "plugins/alpha/skills/demo/SKILL.md"
    )
  ).toMatchObject({
    scope: "plugin.alpha.skill:demo",
    authority: "release-state",
    expectedVersion: "3.0.0",
    status: "in-sync",
  });
  expect(
    report.loci.find((locus) => locus.path === ".claude/skills/demo/SKILL.md")
  ).toMatchObject({
    scope: "skill:demo",
    authority: "source",
    status: "in-sync",
  });
});

test("reports Claude manifest and child drift without modifying either file", async () => {
  const root = await fixture();
  const manifestPath = "plugins/alpha/.claude-plugin/plugin.json";
  const childPath = "plugins/alpha/skills/demo/SKILL.md";
  const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  manifest.version = "0.0.1";
  const text = JSON.stringify(manifest);
  await writeFile(join(root, manifestPath), text);
  const child = (await readFile(join(root, childPath), "utf8")).replace(
    "3.0.0",
    "0.0.2"
  );
  await writeFile(join(root, childPath), child);
  const report = await auditVersions(root);
  expect(
    report.issues.find((locus) => locus.path === manifestPath)
  ).toMatchObject({
    scope: "plugin:alpha",
    status: "stale-generated",
    actualVersion: "0.0.1",
  });
  expect(report.issues.find((locus) => locus.path === childPath)).toMatchObject(
    {
      scope: "plugin.alpha.skill:demo",
      authority: "release-state",
      status: "stale-generated",
      actualVersion: "0.0.2",
    }
  );
  expect(await readFile(join(root, manifestPath), "utf8")).toBe(text);
  expect(await readFile(join(root, childPath), "utf8")).toBe(child);
});

test("allocated project-use copies retain the plugin child release scope", async () => {
  const root = await fixture(
    "compile:\n  targets: [claude, codex]\nplugins:\n  internal_use:\n    skills:\n      alpha: true\n"
  );
  const report = await auditVersions(root);
  expect(
    report.loci.find(
      (locus) => locus.path === ".claude/skills/alpha-demo/SKILL.md"
    )
  ).toMatchObject({
    scope: "plugin.alpha.skill:demo",
    authority: "release-state",
    expectedVersion: "3.0.0",
    status: "in-sync",
  });
});

test("Cursor-specific manifests and skills remain outside the audit boundary", async () => {
  const root = await fixture("compile:\n  targets: [claude, codex, cursor]\n");
  expect(
    await Bun.file(
      join(root, "plugins/alpha/.cursor-plugin/plugin.json")
    ).exists()
  ).toBe(true);
  expect(
    await Bun.file(join(root, ".cursor/skills/demo/SKILL.md")).exists()
  ).toBe(true);
  const report = await auditVersions(root);
  expect(report.loci.some((locus) => locus.path.includes(".cursor"))).toBe(
    false
  );
  expect(
    report.loci.some((locus) => locus.scope === "plugin.alpha.skill:demo")
  ).toBe(true);
});

test("missing and malformed current manifests are reported", async () => {
  const root = await fixture();
  await rm(join(root, "plugins/alpha/.claude-plugin/plugin.json"));
  await writeFile(join(root, "plugins/alpha/plugin.json"), "not JSON");
  const report = await auditVersions(root);
  expect(
    report.issues.find(
      (locus) => locus.path === "plugins/alpha/.claude-plugin/plugin.json"
    )
  ).toMatchObject({ scope: "plugin:alpha", status: "missing" });
  expect(
    report.issues.find((locus) => locus.path === "plugins/alpha/plugin.json")
  ).toMatchObject({ scope: "plugin:alpha", status: "malformed" });
});

test("workspace and selected plugin drafts retain version audit authority", async () => {
  const root = await fixture(
    "compile:\n  targets: [claude, codex]\nplugins:\n  internal_use:\n    drafts:\n      alpha: true\n"
  );
  for (const path of [
    ".skillset/skills/_drafts/review/SKILL.md",
    ".skillset/plugins/alpha/skills/_drafts/review/SKILL.md",
  ])
    await Bun.write(
      join(root, path),
      "---\nname: review\ndescription: Draft review.\n---\nDraft body.\n"
    );
  await writeReleaseState(root, {
    scopes: {
      "skill:review": { version: "4.0.0" },
      "plugin.alpha.skill:review": { version: "5.0.0" },
    },
  });
  await buildSkillset(root);
  const clean = await auditVersions(root);
  for (const [scope, version] of [
    ["skill:review", "4.0.0"],
    ["plugin.alpha.skill:review", "5.0.0"],
  ]) {
    const loci = clean.loci.filter((locus) => locus.scope === scope);
    expect(loci.length).toBeGreaterThan(0);
    for (const locus of loci) {
      expect(locus).toMatchObject({
        authority: "release-state",
        expectedVersion: version,
        status: "in-sync",
      });
      expect(locus.path).toContain("draft-review");
      await rm(join(root, locus.path));
    }
  }
  const missing = await auditVersions(root);
  expect(
    missing.issues.some(
      (locus) => locus.scope === "skill:review" && locus.status === "missing"
    )
  ).toBe(true);
  expect(
    missing.issues.some(
      (locus) =>
        locus.scope === "plugin.alpha.skill:review" &&
        locus.status === "missing"
    )
  ).toBe(true);
});
