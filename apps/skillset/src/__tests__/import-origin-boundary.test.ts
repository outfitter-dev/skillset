import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { readMigrationState } from "@skillset/core/internal/migration-state";
import { parseMarkdown } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";
import { importSource } from "../import";

for (const companion of [
  "---\r\nname: literal-template\r\n---\r\n{{raw}} @alice\r\n",
  "---\nnot: [valid yaml\n---\nRuntime template.\n",
]) {
  test(`adoption preserves opaque SKILL.md runtime bytes (${companion.includes("valid yaml") ? "malformed" : "valid"})`, async () => {
    const root = await createTestFixtureRoot("skillset-adopt-opaque-skill-origin-");
    await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
    await Bun.write(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "native-hooks", hooks: "./config/extra.json" }));
    await Bun.write(join(root, "config/extra.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'cat "$CLAUDE_PLUGIN_ROOT/config/SKILL.md"' }] }] } }));
    await Bun.write(join(root, "config/SKILL.md"), companion);
    await Bun.write(join(root, "skills/team/demo/SKILL.md"), "---\nname: demo\ndescription: Primary skill.\n---\nBody.\n");

    const report = await adoptSkillset(root, { write: true });
    expect(report.ok).toBe(true);
    expect(await readFile(join(root, ".skillset/plugins/native-hooks/_claude/config/SKILL.md"), "utf8")).toBe(companion);
    const primary = join(root, ".skillset/plugins/native-hooks/skills/team/demo/SKILL.md");
    expect(parseMarkdown(await readFile(primary, "utf8"), primary).frontmatter).toHaveProperty("skillset.origin.path", "skills/team/demo/SKILL.md");
    const flags = (await readMigrationState(root)).state.flags;
    expect(flags.some((flag) => flag.origin?.path === "config/extra.json")).toBe(true);
    expect(flags.some((flag) => flag.source.path.endsWith("config/SKILL.md"))).toBe(false);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const output = join(root, "plugins/native-hooks/config/SKILL.md");
    expect(await readFile(output, "utf8")).toBe(companion);
    expect(await readFile(join(root, "config/SKILL.md"), "utf8")).toBe(companion);
  });
}

for (const kind of ["skill", "plugin"] as const) {
  test(`${kind} import stamps primary skills without interpreting nested SKILL.md companions`, async () => {
    const root = await createTestFixtureRoot("skillset-import-primary-origin-");
    const sourcePath = join(root, "original");
    const primaryPath = kind === "skill" ? "SKILL.md" : "skills/team/demo/SKILL.md";
    const resourcePath = kind === "skill" ? "references/SKILL.md" : "skills/team/demo/references/SKILL.md";
    const companion = "---\nnot: [valid yaml\n---\nLiteral companion.\n";
    if (kind === "plugin") await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"native-plugin"}');
    await Bun.write(join(sourcePath, primaryPath), "---\nname: demo\ndescription: Primary.\n---\nBody.\n");
    await Bun.write(join(sourcePath, resourcePath), companion);
    const report = await importSource({ rootPath: root, sourcePath, kind, provider: "claude", sourceOrigin: (_path, file) => ({ path: file ?? "original" }) });
    const imported = join(report.targetPath, primaryPath);
    expect(parseMarkdown(await readFile(imported, "utf8"), imported).frontmatter).toHaveProperty("skillset.origin.path", primaryPath);
    expect(await readFile(join(report.targetPath, resourcePath), "utf8")).toBe(companion);
    expect(await readFile(join(sourcePath, resourcePath), "utf8")).toBe(companion);
  });
}
