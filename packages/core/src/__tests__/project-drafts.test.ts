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

async function treeBytes(root: string): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(
    await Promise.all(
      (await filesBelow(root)).map(async (path) => [
        path,
        Buffer.from(await readFile(join(root, path))).toString("base64"),
      ])
    )
  );
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
        expect(parsed.frontmatter).not.toHaveProperty("status");
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
    const publishedBytes = await treeBytes(join(root, "plugins"));
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
    expect(await treeBytes(join(root, "plugins"))).toEqual(publishedBytes);
  });

  it("keeps draft identity and description visible after provider overrides", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: draft-provider-overrides
claude: true
codex: true
cursor: true
internal_marker: false
`,
      ".skillset/skills/_drafts/review/SKILL.md": `---
name: review
description: Source description
status: draft
claude:
  frontmatter:
    name: plain-claude
    description: Claude override
codex:
  frontmatter:
    name: plain-codex
    description: Codex override
cursor:
  frontmatter:
    name: plain-cursor
    description: Cursor override
---

Review body.
`,
    });

    await buildSkillsetResult(root);
    for (const [targetRoot, description] of [
      [".claude/skills", "Claude override"],
      [".agents/skills", "Codex override"],
      [".cursor/skills", "Cursor override"],
    ] as const) {
      const path = join(root, targetRoot, "draft-review/SKILL.md");
      const parsed = parseMarkdown(await readFile(path, "utf8"), path);
      expect(parsed.frontmatter.name).toBe("draft-review");
      expect(parsed.frontmatter.description).toBe(`[SKILLSET DRAFT] ${description}`);
      expect(parsed.frontmatter.metadata).toMatchObject({ internal: true });
      expect(parsed.frontmatter).not.toHaveProperty("status");
    }
  });

  it("reports a provider-overridden draft description truncated by the prefix", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: draft-description\nclaude: false\ncodex: false\ncursor: true\n",
      ".skillset/skills/_drafts/review/SKILL.md": `---
name: review
description: Short source description
cursor:
  frontmatter:
    description: ${"x".repeat(1010)}
---

Review body.
`,
    });

    const result = await buildSkillsetResult(root);
    const path = join(root, ".cursor/skills/draft-review/SKILL.md");
    const parsed = parseMarkdown(await readFile(path, "utf8"), path);
    expect([...String(parsed.frontmatter.description)].length).toBe(1024);
    expect(String(parsed.frontmatter.description)).toStartWith("[SKILLSET DRAFT] ");
    expect(String(parsed.frontmatter.description)).toEndWith("…");
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "draft-description-truncated" }),
        ]),
        sourceUnit: "skill:review",
        target: "cursor",
      })
    );
  });

  it("rejects project draft hooks instead of silently omitting them", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: draft-hooks\nclaude: true\ncodex: false\ncursor: false\n",
      ".skillset/skills/_drafts/review/SKILL.md": `---
name: review
description: Draft with an attached hook
hooks:
  PreToolUse:
    - local-shell
---

Review body.
`,
      ".skillset/skills/_drafts/review/hooks/local-shell.json": JSON.stringify({
        events: ["PreToolUse"],
        run: { command: "node ./local.js" },
      }),
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "project draft review has adaptive hooks that cannot be rendered in its project copy"
    );
  });

  it("rejects unresolved draft hooks instead of silently omitting them", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: draft-hooks-missing\nclaude: true\ncodex: false\ncursor: false\n",
      ".skillset/skills/_drafts/review/SKILL.md": `---
name: review
description: Draft with an unresolved hook
hooks:
  PreToolUse:
    - missing
---

Review body.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "project draft review has adaptive hooks that cannot be rendered in its project copy"
    );
  });

  it("does not reject draft hooks scoped away from the enabled target", async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: draft-hooks-filtered\nclaude: false\ncodex: true\ncursor: false\n",
      ".skillset/skills/_drafts/review/SKILL.md": `---
name: review
description: Draft with a Claude-only hook
hooks:
  PreToolUse:
    - local-shell
---

Review body.
`,
      ".skillset/skills/_drafts/review/hooks/local-shell.json": JSON.stringify({
        events: ["PreToolUse"],
        providers: ["claude"],
        run: { command: "node ./local.js" },
      }),
    });

    await buildSkillsetResult(root);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-review/SKILL.md")).exists()
    ).toBe(true);
  });

  it("inherits paired plugin drafts only after live selection and cleans transitions deterministically", async () => {
    const config = (skills?: string, drafts?: string) => `
skillset:
  name: inherited-project-drafts
claude: false
codex: true
cursor: false
plugins:
  internal_use:
${skills === undefined ? "" : `    skills:\n      demo: ${skills}\n`}
${drafts === undefined ? "" : `    drafts:\n      demo: ${drafts}\n`}`;
    const root = await fixture({
      "skillset.yaml": config("true"),
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/paired/SKILL.md": skill(
        "paired",
        "Shipped pair"
      ),
      ".skillset/plugins/demo/skills/_drafts/paired/SKILL.md": skill(
        "paired",
        "Draft pair"
      ),
      ".skillset/plugins/demo/skills/unpaired/SKILL.md": skill(
        "unpaired",
        "Unpaired draft",
        { status: "draft" }
      ),
    });

    await buildSkillsetResult(root);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-paired/SKILL.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-unpaired/SKILL.md")).exists()
    ).toBe(false);
    expect((await doctorSkillset(root)).projectUse).toContainEqual(
      expect.objectContaining({
        effectiveName: "draft-paired",
        selectionRule: "plugins.internal_use.drafts.demo: omitted (side-by-side)",
        shippedSibling: "plugin.demo.skill:paired",
      })
    );

    await writeFile(join(root, "skillset.yaml"), config(undefined, "true"));
    await buildSkillsetResult(root);
    expect(
      await Bun.file(join(root, ".agents/skills/paired/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-paired/SKILL.md")).exists()
    ).toBe(true);
    expect((await doctorSkillset(root)).projectUse).toContainEqual(
      expect.objectContaining({
        effectiveName: "draft-paired",
        selectionRule: "plugins.internal_use.drafts.demo: true",
      })
    );

    await writeFile(join(root, "skillset.yaml"), config('["!paired"]', "true"));
    await buildSkillsetResult(root);
    expect(
      await Bun.file(join(root, ".agents/skills/paired/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-paired/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/draft-unpaired/SKILL.md")).exists()
    ).toBe(true);

    const first = await treeBytes(join(root, ".agents/skills"));
    await buildSkillsetResult(root);
    expect(await treeBytes(join(root, ".agents/skills"))).toEqual(first);
  });

  it("pairs only inside one container and exposes Cursor as a target owner", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: container-local-pairs
claude: false
codex: false
cursor: true
plugins:
  internal_use:
    drafts:
      demo: true
`,
      ".skillset/skills/shared/SKILL.md": skill("shared", "Workspace live"),
      ".skillset/skills/workspace-only/SKILL.md": skill(
        "workspace-only",
        "Workspace draft",
        { status: "draft" }
      ),
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/workspace-only/SKILL.md": skill(
        "workspace-only",
        "Plugin live"
      ),
      ".skillset/plugins/demo/skills/shared/SKILL.md": skill(
        "shared",
        "Plugin draft",
        { status: "draft" }
      ),
    });

    await buildSkillsetResult(root);
    const report = await doctorSkillset(root);
    expect(report.projectUse).toContainEqual(
      expect.objectContaining({
        effectiveName: "draft-workspace-only",
        owner: { target: "cursor" },
        role: "bundle",
        sourceUnit: "skill:workspace-only",
      })
    );
    expect(report.projectUse).toContainEqual(
      expect.objectContaining({
        effectiveName: "draft-shared",
        owner: { target: "cursor" },
        role: "project-use",
        sourceUnit: "plugin.demo.skill:shared",
      })
    );
    for (const entry of report.projectUse.filter((item) =>
      item.effectiveName === "draft-workspace-only" ||
      item.effectiveName === "draft-shared"
    )) {
      expect(entry).not.toHaveProperty("shippedSibling");
    }
    const cursorDraft = parseMarkdown(
      await readFile(
        join(root, ".cursor/skills/draft-shared/SKILL.md"),
        "utf8"
      ),
      "draft-shared"
    );
    expect(cursorDraft.frontmatter.metadata).toMatchObject({ internal: true });
  });

  it("allocates draft names globally through workspace and plugin second-order collisions", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: draft-name-collisions
claude: false
codex: true
cursor: false
plugins:
  internal_use:
    skills:
      beta: true
      gamma: true
    drafts:
      alpha: true
`,
      ".skillset/skills/alpha-alpha-draft-shared/SKILL.md": skill(
        "alpha-alpha-draft-shared",
        "Workspace second-order reservation"
      ),
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha\n",
      ".skillset/plugins/alpha/skills/shared/SKILL.md": skill(
        "shared",
        "Alpha draft",
        { status: "draft" }
      ),
      ".skillset/plugins/beta/skillset.yaml": "skillset:\n  name: beta\n",
      ".skillset/plugins/beta/skills/draft-shared/SKILL.md": skill(
        "draft-shared",
        "Beta live collision"
      ),
      ".skillset/plugins/gamma/skillset.yaml": "skillset:\n  name: gamma\n",
      ".skillset/plugins/gamma/skills/alpha-draft-shared/SKILL.md": skill(
        "alpha-draft-shared",
        "Gamma second-order collision"
      ),
    });

    const result = await buildSkillsetResult(root);
    for (const name of [
      "alpha-alpha-draft-shared",
      "alpha-alpha-draft-shared-2",
      "beta-draft-shared",
      "gamma-alpha-draft-shared",
    ]) {
      expect(
        await Bun.file(join(root, `.agents/skills/${name}/SKILL.md`)).exists()
      ).toBe(true);
    }
    const diagnostic = result.renderResults.find(
      (outcome) =>
        outcome.sourceUnit === "plugin.alpha.skill:shared" &&
        outcome.target === "codex" &&
        outcome.diagnostics?.some(
          (item) => item.code === "internal-use-name-conflict"
        )
    )?.diagnostics?.find(
      (item) => item.code === "internal-use-name-conflict"
    )?.message ?? "";
    for (const source of [
      "plugin.alpha.skill:shared#draft",
      "plugin.beta.skill:draft-shared",
      "plugin.gamma.skill:alpha-draft-shared",
      "workspace:alpha-alpha-draft-shared",
    ]) {
      expect(diagnostic).toContain(source);
    }
    expect(diagnostic).toContain("emitted as alpha-alpha-draft-shared-2");
  });
});
