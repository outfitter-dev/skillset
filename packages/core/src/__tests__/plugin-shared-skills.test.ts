import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult } from "../build";
import { parseMarkdown } from "../yaml";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("shared plugin skills", () => {
  it("emits one skill and unions compatible provider-only keys", async () => {
    const root = await fixture(`
claude:
  frontmatter:
    claude-only: true
cursor:
  frontmatter:
    cursor-only: true
`);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(
      result.data.filter((file) => file.path.endsWith("/skills/review/SKILL.md"))
        .map((file) => file.path)
    ).toEqual(["plugins/demo/skills/review/SKILL.md"]);
    const parsed = parseMarkdown(
      await readFile(join(root, "plugins/demo/skills/review/SKILL.md"), "utf8"),
      "shared skill"
    );
    expect(parsed.frontmatter).toMatchObject({
      "claude-only": true,
      "cursor-only": true,
      description: "Review changes.",
      name: "review",
    });
  });

  it("rejects the first conflicting provider field", async () => {
    const root = await fixture(`
claude:
  frontmatter:
    shared: claude
cursor:
  frontmatter:
    shared: cursor
`);

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "plugin demo skill review provider cursor conflicts at shared"
    );
  });

  it("rejects provider-specific body bytes after newline normalization", async () => {
    const root = await fixture("", "Use {{$ARGUMENTS}} to review changes.");

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "plugin demo skill review provider claude conflicts at body"
    );
  });
});

async function fixture(
  targetFrontmatter: string,
  body = "Review changes."
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-shared-plugin-skill-"));
  roots.push(root);
  const files = normalizeSkillsetFixtureFiles({
    ".skillset/plugins/demo/skills/review/SKILL.md": `---
name: review
description: Review changes.
${targetFrontmatter.trim()}
---

${body}
`,
    ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  license: none
`,
    "skillset.yaml": `
skillset:
  name: shared-plugin-skill
  license: none
claude: true
codex: true
cursor: true
`,
  });
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      Bun.write(join(root, path), content)
    )
  );
  return root;
}
