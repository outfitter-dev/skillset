import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";
import { findPluginRootScriptLinks, findUndeclaredResourceLinks, rewriteResourceLinks } from "../resources";
import type { SourceResource } from "../types";

const reference = "shared:references/a.md";
const resource: SourceResource = { from: reference, kind: "file", sourcePath: "/unused/a.md", targetPath: "references/copied.md" };
const link = `[example](${reference})`;
const literalCases: readonly [string, (value: string) => string][] = [
  ["inline code", (value) => `Use \`${value}\` literally.`],
  ["backtick fence", (value) => `\`\`\`md\n${value}\n\`\`\``],
  ["tilde fence", (value) => `~~~md\n${value}\n~~~`],
  ["unclosed fence", (value) => `\`\`\`md\n${value}`],
  ["indented code", (value) => `Example:\n\n    ${value}`],
  ["HTML comment", (value) => `<!--\n${value}\n-->`],
  ["unclosed HTML comment", (value) => `<!-- ${value}`],
  ["escaped opening bracket", (value) => `\\${value}`],
  ["escaped closing bracket", (value) => value.replace("](", "\\](")],
];

describe("literal resource-link examples", () => {
  for (const [label, wrap] of literalCases) {
    test(`preserves ${label} in rewriting and dependency diagnostics`, () => {
      const body = wrap(link);
      expect(rewriteResourceLinks(body, [resource], "demo")).toBe(body);
      expect(rewriteResourceLinks(body, [], "demo")).toBe(body);
      expect(findUndeclaredResourceLinks(body, [])).toEqual([]);
      expect(findPluginRootScriptLinks(wrap("[run](${CLAUDE_PLUGIN_ROOT}/run.sh)"))).toEqual([]);
      expect(findPluginRootScriptLinks(wrap("[run](../scripts/run.sh)"))).toEqual([]);
    });
  }

  test("retains genuine links, image links, inline-code labels and even escape parity", () => {
    for (const prefix of ["", "!", "\\!", "\\\\"]) {
      expect(rewriteResourceLinks(`${prefix}${link}`, [resource], "demo")).toBe(`${prefix}[example](references/copied.md)`);
    }
    expect(rewriteResourceLinks("[`code`](shared:references/a.md)", [resource], "demo")).toBe("[`code`](references/copied.md)");
    expect(findUndeclaredResourceLinks(link, [])).toHaveLength(1);
    expect(findPluginRootScriptLinks("[run](../scripts/run.sh)")).toEqual(["../scripts/run.sh"]);
  });

  test("a commented or quoted comment opener does not suppress later active links", () => {
    const body = `\`<!--\`\n\n${link}\n\n<!-- \` -->\n\n${link}`;
    expect(rewriteResourceLinks(body, [resource], "demo")).toBe(body.replaceAll(link, "[example](references/copied.md)"));
  });

  test("build preserves examples while projecting declared prose links and marked controls", async () => {
    const examples = literalCases.map(([, wrap]) => wrap(link)).filter((value) => !value.startsWith("<!-- ") && value !== `\`\`\`md\n${link}`).join("\n\n");
    const body = `Prose ${link}\n\nProse @{{${reference}}}\n\n${examples}\n\n\`@{{${reference}}}\`\n`;
    const root = await fixture(body, true);
    const source = await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8");
    await buildSkillset(root);
    for (const path of [".agents/skills/demo/SKILL.md", ".claude/skills/demo/SKILL.md"]) {
      const generated = await readFile(join(root, path), "utf8");
      expect(generated).toContain("Prose [example](references/copied.md)");
      expect(generated).toContain("Prose @references/copied.md");
      expect(generated).toContain(examples);
      expect(generated).toContain(`\`@{{${reference}}}\``);
    }
    expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toBe(source);
  });

  test("code and comment examples build without declaring their nonexistent resource", async () => {
    const body = `\`${link}\`\n\n~~~md\n${link}\n~~~\n\n<!-- ${link} -->\n\n\\${link}\n`;
    const root = await fixture(body, false);
    await buildSkillset(root);
    expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")).toContain(body.trim());
  });
});

async function fixture(body: string, declared: boolean): Promise<string> {
  const root = await createTestFixtureRoot("resource-link-literals-");
  const files = {
    "skillset.yaml": "skillset:\n  name: resource-test\ncompile:\n  targets: [claude]\n",
    ".skillset/skills/demo/SKILL.md": `---\nname: demo\ndescription: Demo.\n${declared ? "resources:\n  - from: shared:references/a.md\n    to: references/copied.md\n" : ""}---\n\n${body}`,
    ...(declared ? { ".skillset/shared/references/a.md": "Original resource.\n" } : {}),
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
