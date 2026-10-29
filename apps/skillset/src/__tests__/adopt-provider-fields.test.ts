import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperationalPathContext, ISOLATED_OUT_ROOT, resolveOperationalPath } from "@skillset/core";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";
import { importSource } from "../import";

const policies = { "allowed-tools": ["Read"], "disallowed-tools": ["Bash"], "user-invocable": false };
const skill = "---\nname: native\ndescription: Native policies.\nallowed-tools:\n  - Read\ndisallowed-tools:\n  - Bash\nuser-invocable: false\n---\n\nAuthored body.\n";

test("Claude adoption keeps native tool and user invocation policy inside the Claude boundary", async () => {
  const root = await createTestFixtureRoot("skillset-adopt-provider-fields-");
  const original = join(root, ".claude/skills/native/SKILL.md");
  await Bun.write(original, skill);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const imported = parseMarkdown(await readFile(join(root, ".skillset/skills/native/SKILL.md"), "utf8"), "imported").frontmatter;
  expect(imported.claude).toMatchObject({ frontmatter: policies });
  for (const key of Object.keys(policies)) expect(imported).not.toHaveProperty(key);
  const context = createOperationalPathContext(root);
  for (const [directory, expected] of [[".claude", true], [".cursor", false], [".agents", false]] as const) {
    const output = resolveOperationalPath(context, `${ISOLATED_OUT_ROOT}/${directory}/skills/native/SKILL.md`);
    const frontmatter = parseMarkdown(await readFile(output, "utf8"), output).frontmatter;
    for (const [key, value] of Object.entries(policies)) {
      if (expected) expect(frontmatter[key]).toEqual(value);
      else expect(frontmatter).not.toHaveProperty(key);
    }
  }
  expect(report.imports[0]?.warnings.join("\n")).toContain("claude.frontmatter");
  expect(await readFile(original, "utf8")).toBe(skill);
});

test("explicit Claude plugin imports scope each skill policy and preserve original bytes", async () => {
  const root = await createTestFixtureRoot("skillset-import-plugin-fields-");
  const source = join(root, "external");
  await Bun.write(join(source, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-plugin" }));
  await Bun.write(join(source, "skills/native/SKILL.md"), skill);
  const report = await importSource({ kind: "plugin", provider: "claude", rootPath: root, sourcePath: source });
  const imported = parseMarkdown(await readFile(join(report.targetPath, "skills/native/SKILL.md"), "utf8"), "plugin skill").frontmatter;
  expect(imported.claude).toMatchObject({ frontmatter: policies });
  for (const key of Object.keys(policies)) expect(imported).not.toHaveProperty(key);
  expect(await readFile(join(source, "skills/native/SKILL.md"), "utf8")).toBe(skill);
});

test("a conflicting explicit provider policy fails before claiming imported source", async () => {
  const root = await createTestFixtureRoot("skillset-import-conflict-fields-");
  const source = join(root, "external");
  const conflicting = skill.replace("user-invocable: false", "user-invocable: false\nclaude:\n  frontmatter:\n    user-invocable: true");
  await Bun.write(join(source, "SKILL.md"), conflicting);
  await expect(importSource({ kind: "skill", provider: "claude", rootPath: root, sourcePath: source })).rejects.toThrow("conflicting");
  expect(await Bun.file(join(root, ".skillset/skills/native/SKILL.md")).exists()).toBe(false);
  expect(await readFile(join(source, "SKILL.md"), "utf8")).toBe(conflicting);
});

test("unknown import provenance does not fabricate a Claude policy boundary", async () => {
  const root = await createTestFixtureRoot("skillset-import-unknown-fields-");
  const source = join(root, "external");
  await Bun.write(join(source, "SKILL.md"), skill);
  const report = await importSource({ kind: "skill", rootPath: root, sourcePath: source });
  const imported = parseMarkdown(await readFile(join(report.targetPath, "SKILL.md"), "utf8"), "unknown").frontmatter;
  expect(imported).toMatchObject(policies);
  expect(imported).not.toHaveProperty("claude");
  expect(report.warnings.join("\n")).toContain("verbatim");
});

test("matching provider declarations retain other explicit provider metadata", async () => {
  const root = await createTestFixtureRoot("skillset-import-matching-fields-");
  const source = join(root, "external");
  const matching = skill.replace("user-invocable: false", "user-invocable: false\nclaude:\n  frontmatter:\n    user-invocable: false\n    model: authored-model");
  await Bun.write(join(source, "SKILL.md"), matching);
  const report = await importSource({ kind: "skill", provider: "claude", rootPath: root, sourcePath: source });
  const imported = parseMarkdown(await readFile(join(report.targetPath, "SKILL.md"), "utf8"), "matching").frontmatter;
  expect(imported.claude).toMatchObject({ frontmatter: { ...policies, model: "authored-model" } });
  expect(await readFile(join(source, "SKILL.md"), "utf8")).toBe(matching);
});
