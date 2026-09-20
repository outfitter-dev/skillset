import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { explainPath } from "../authoring";
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
    nested:
      claude-only: true
      shared:
        list: [one, two]
        scalar: same
cursor:
  frontmatter:
    cursor-only: true
    nested:
      cursor-only: true
      shared:
        list: [one, two]
        scalar: same
`);

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(
      result.data.filter((file) => file.path.endsWith("/skills/review/SKILL.md"))
        .map((file) => file.path)
    ).toEqual(["plugins/demo/skills/review/SKILL.md"]);
    expect(result.data.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "plugins/demo/.claude-plugin/plugin.json",
        "plugins/demo/.cursor-plugin/plugin.json",
        "plugins/demo/plugin.json",
      ])
    );
    expect(
      result.data.some((file) =>
        /plugins\/demo\/(?:agents|chatgpt|claude|cursor)\//u.test(file.path)
      )
    ).toBe(false);
    expect(result.data.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "plugins/demo/assets/logo.svg",
        "plugins/demo/skills/review/assets/common.txt",
        "plugins/demo/skills/review/assets/local.txt",
      ])
    );
    const parsed = parseMarkdown(
      await readFile(join(root, "plugins/demo/skills/review/SKILL.md"), "utf8"),
      "shared skill"
    );
    expect(parsed.frontmatter).toMatchObject({
      "claude-only": true,
      "cursor-only": true,
      description: "Review changes.",
      name: "review",
      nested: {
        "claude-only": true,
        "cursor-only": true,
        shared: { list: ["one", "two"], scalar: "same" },
      },
    });
    const claudeManifest = JSON.parse(
      await readFile(
        join(root, "plugins/demo/.claude-plugin/plugin.json"),
        "utf8"
      )
    ) as { readonly skills?: string | readonly string[] };
    expect(claudeManifest.skills).toBe("./skills/review");

    const secondSkill = join(
      root,
      ".skillset/plugins/demo/skills/write/SKILL.md"
    );
    await mkdir(dirname(secondSkill), { recursive: true });
    await Bun.write(
      secondSkill,
      "---\nname: write\ndescription: Write changes.\n---\n\nWrite changes.\n"
    );
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const expandedManifest = JSON.parse(
      await readFile(
        join(root, "plugins/demo/.claude-plugin/plugin.json"),
        "utf8"
      )
    ) as { readonly skills?: string | readonly string[] };
    expect(expandedManifest.skills).toEqual([
      "./skills/review",
      "./skills/write",
    ]);

    const lock = JSON.parse(
      await readFile(join(root, "plugins/skillset.lock"), "utf8")
    ) as {
      readonly items: readonly {
        readonly consumers?: readonly unknown[];
        readonly outputPath?: string;
      }[];
    };
    const sharedSkill = lock.items.find(
      (item) => item.outputPath === "demo/skills/review/SKILL.md"
    );
    expect(sharedSkill?.consumers).toEqual([
      { phase: "baseline", standardProfile: "agent-plugins-1.0" },
      { phase: "delta", target: "claude" },
      { phase: "delta", target: "codex" },
      { phase: "delta", target: "cursor" },
    ]);
    const explanation = await explainPath(
      root,
      "plugins/demo/skills/review/SKILL.md"
    );
    expect(explanation).toMatchObject({
      entries: [
        expect.objectContaining({
          consumers: sharedSkill?.consumers,
          outputPath: "plugins/demo/skills/review/SKILL.md",
        }),
      ],
      kind: "generated",
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

  it("rejects the first conflicting nested provider field", async () => {
    const root = await fixture(`
claude:
  frontmatter:
    shared:
      nested:
        value: claude
cursor:
  frontmatter:
    shared:
      nested:
        value: cursor
`);

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "plugin demo skill review provider cursor conflicts at shared.nested.value"
    );
  });

  it("rejects provider-specific body bytes after newline normalization", async () => {
    const root = await fixture("", "Use {{$ARGUMENTS}} to review changes.");

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "plugin demo skill review provider claude conflicts at body"
    );
  });

  it("emits shared resources once across compatible provider renderings", async () => {
    const root = await fixture("");

    const result = await buildSkillsetResult(root);

    expect(result.ok).toBe(true);
    expect(
      result.data.filter((file) =>
        file.path.endsWith("/skills/review/assets/common.txt")
      ).map((file) => file.path)
    ).toEqual(["plugins/demo/skills/review/assets/common.txt"]);
  });

  it("flattens grouping directories and names both colliding sources", async () => {
    const root = await fixture(
      "",
      "Review changes.",
      ".skillset/plugins/demo/skills/(engineering)/review/SKILL.md"
    );
    const result = await buildSkillsetResult(root);
    expect(result.data.map((file) => file.path)).toContain(
      "plugins/demo/skills/review/SKILL.md"
    );
    expect(
      result.data.some((file) => file.path.includes("(engineering)"))
    ).toBe(false);

    const second = join(
      root,
      ".skillset/plugins/demo/skills/(writing)/proof/SKILL.md"
    );
    await mkdir(dirname(second), { recursive: true });
    await Bun.write(
      second,
      "---\nname: review\ndescription: Duplicate.\n---\n\nDuplicate.\n"
    );
    await expect(buildSkillsetResult(root)).rejects.toThrow(
      ".skillset/plugins/demo/skills/(engineering)/review/SKILL.md and .skillset/plugins/demo/skills/(writing)/proof/SKILL.md"
    );
  });

  it("rejects incompatible same-package writers before write", async () => {
    const root = await fixture("");
    const hooksPath = join(
      root,
      ".skillset/plugins/demo/hooks/hooks.json"
    );
    await mkdir(dirname(hooksPath), { recursive: true });
    await Bun.write(
      hooksPath,
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "echo check", type: "command" }] }] } })
    );
    await expect(buildSkillsetResult(root)).rejects.toThrow(
      "plugin demo package path plugins/demo/hooks/hooks.json has conflicting writers"
    );
  });

  it("coalesces identical target hook bytes into one package file", async () => {
    const root = await fixture("");
    await Bun.write(
      join(root, "skillset.yaml"),
      `skillset:
  name: shared-plugin-skill
  license: none
compile:
  unsupportedDestination: warn
claude: true
codex: true
cursor: true
`
    );
    const hooksPath = join(
      root,
      ".skillset/plugins/demo/hooks/hooks.json"
    );
    await mkdir(dirname(hooksPath), { recursive: true });
    await Bun.write(hooksPath, JSON.stringify({ hooks: {}, version: 1 }));

    const result = await buildSkillsetResult(root);
    expect(
      result.data.filter(
        (file) => file.path === "plugins/demo/hooks/hooks.json"
      )
    ).toHaveLength(1);
  });
});

async function fixture(
  targetFrontmatter: string,
  body = "Review changes.",
  skillPath = ".skillset/plugins/demo/skills/review/SKILL.md"
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-shared-plugin-skill-"));
  roots.push(root);
  const files = normalizeSkillsetFixtureFiles({
    [skillPath]: `---
name: review
description: Review changes.
${targetFrontmatter.trim()}
resources:
  assets:
    - plugin:assets/common.txt
---

${body}
`,
    ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  license: none
`,
    ".skillset/plugins/demo/assets/logo.svg": "<svg/>\n",
    ".skillset/plugins/demo/shared/assets/common.txt": "common\n",
    [`${dirname(skillPath)}/assets/local.txt`]: "local\n",
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
