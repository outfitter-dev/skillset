import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { buildSkillsetResult } from "@skillset/core";
import {
  doctorSkillset,
  explainPath,
} from "@skillset/core/internal/authoring";
import { parseMarkdown } from "@skillset/core/internal/yaml";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-project-drafts-"));
  roots.push(root);
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

function skill(
  name: string,
  description: string,
  options: { readonly status?: "draft" } = {}
): string {
  return `---\nname: ${name}\ndescription: ${description}${
    options.status === undefined ? "" : `\nstatus: ${options.status}`
  }\n---\n\n${name} body.\n`;
}

async function filesBelow(root: string): Promise<readonly string[]> {
  const paths: string[] = [];
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else paths.push(relative(root, child).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return paths.sort();
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("SET-555 side-by-side project drafts", () => {
  it("renders resolved workspace and plugin drafts, records provenance, excludes packages, and cleans up false", async () => {
    const longDescription = "x".repeat(1010);
    const config = (drafts: boolean) => `
skillset:
  name: project-drafts
drafts:
  - skill:configured
claude: true
codex: true
cursor: true
internal_marker: false
plugins:
  internal_use:
    skills:
      demo: true
    drafts:
      demo: ${drafts}
`;
    const root = await fixture({
      "skillset.yaml": config(true),
      ".skillset/skills/paired/SKILL.md": skill("paired", "Shipped workspace skill"),
      ".skillset/skills/_drafts/paired/SKILL.md": skill("paired", "Paired workspace draft"),
      ".skillset/skills/configured/SKILL.md": skill("configured", "Configured workspace draft"),
      ".skillset/skills/statused/SKILL.md": skill("statused", longDescription, {
        status: "draft",
      }),
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/review/SKILL.md": skill("review", "Shipped plugin skill"),
      ".skillset/plugins/demo/skills/_drafts/review/SKILL.md": skill("review", "Paired plugin draft"),
      ".skillset/plugins/demo/skills/future/SKILL.md": skill("future", "Unpaired plugin draft", {
        status: "draft",
      }),
    });

    const result = await buildSkillsetResult(root);
    for (const targetRoot of [
      ".claude/skills",
      ".agents/skills",
      ".cursor/skills",
    ]) {
      for (const name of [
        "draft-configured",
        "draft-paired",
        "draft-statused",
        "draft-review",
        "draft-future",
      ]) {
        const path = join(root, targetRoot, name, "SKILL.md");
        expect(await Bun.file(path).exists()).toBe(true);
        const parsed = parseMarkdown(await readFile(path, "utf8"), path);
        expect(parsed.frontmatter.name).toBe(name);
        expect(parsed.frontmatter.description).toStartWith("[SKILLSET DRAFT] ");
        expect(parsed.frontmatter.metadata).toMatchObject({ internal: true });
      }
    }

    const truncated = parseMarkdown(
      await readFile(
        join(root, ".agents/skills/draft-statused/SKILL.md"),
        "utf8"
      ),
      "draft-statused"
    );
    expect([...String(truncated.frontmatter.description)].length).toBe(1024);
    expect(String(truncated.frontmatter.description)).toEndWith("…");
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "draft-description-truncated" }),
        ]),
        sourceUnit: "skill:statused",
        target: "codex",
      })
    );

    const lock = JSON.parse(
      await readFile(join(root, ".agents/skills/skillset.lock"), "utf8")
    ) as { readonly items: readonly Record<string, unknown>[] };
    expect(lock.items).toContainEqual(
      expect.objectContaining({
        draftOrigin: "_drafts",
        effectiveName: "draft-review",
        owner: { target: "codex" },
        role: "project-use",
        selectionRule: "plugins.internal_use.drafts.demo: true",
        shippedSibling: "plugin.demo.skill:review",
        sourceUnit: "plugin.demo.skill:review",
      })
    );
    expect(
      await explainPath(root, ".agents/skills/draft-review/SKILL.md")
    ).toMatchObject({
      entries: [
        expect.objectContaining({
          draftOrigin: "_drafts",
          effectiveName: "draft-review",
          role: "project-use",
          shippedSibling: "plugin.demo.skill:review",
        }),
      ],
    });
    expect((await doctorSkillset(root)).projectUse).toContainEqual(
      expect.objectContaining({
        draftOrigin: "_drafts",
        effectiveName: "draft-paired",
        role: "bundle",
        shippedSibling: "skill:paired",
        sourceUnit: "skill:paired",
        target: "codex",
      })
    );

    const publishedPaths = await filesBelow(join(root, "plugins"));
    expect(publishedPaths.some((path) => path.includes("draft-"))).toBe(false);
    for (const path of publishedPaths.filter((path) => path.endsWith(".md"))) {
      expect(await readFile(join(root, "plugins", path), "utf8")).not.toContain(
        "[SKILLSET DRAFT]"
      );
    }

    await writeFile(join(root, "skillset.yaml"), config(false));
    await buildSkillsetResult(root);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-review/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-future/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/review/SKILL.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-paired/SKILL.md")).exists()
    ).toBe(true);
  });
});
