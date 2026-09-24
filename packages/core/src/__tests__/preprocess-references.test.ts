/* eslint-disable func-style -- Focused fixture helpers keep grammar cases compact. */

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import {
  type PreprocessContext,
  preprocessText,
  resolveMarkedPathReferences,
} from "../preprocess";

describe("preprocess reference grammar", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await createTestFixtureRoot("skillset-preprocess-references-");
  });

  test("uses {{> X}} for inline references and @{{X}} for links", async () => {
    await files(rootPath, {
      ".skillset/plugins/demo/shared/partials/intro.md": "Plugin introduction",
      ".skillset/plugins/demo/shared/partials/writing/tone.md": "Plugin tone",
      ".skillset/plugins/demo/shared/references/LICENSE": "Plugin terms",
      ".skillset/plugins/demo/shared/references/plugin.md": "Plugin reference",
      ".skillset/shared/partials/intro.md": "Shared introduction",
      ".skillset/shared/partials/writing/tone.md": "Shared tone",
      ".skillset/shared/references/common.md": "Common reference",
    });
    const context = preprocessContext(rootPath, true);

    await expect(
      preprocessText(
        [
          "{{> intro}}",
          "{{> writing/tone}}",
          "{{> plugin:intro}}",
          "{{> plugin:writing/tone}}",
          "{{> shared:references/common.md}}",
          "{{> shared:partials/intro.md}}",
          "{{> plugin:references/plugin.md}}",
          "{{> plugin:references/LICENSE}}",
          "@{{shared:references/common.md}}",
          "@{{plugin:references/plugin.md}}",
        ].join("\n"),
        context
      )
    ).resolves.toBe(
      [
        "Shared introduction",
        "Shared tone",
        "Plugin introduction",
        "Plugin tone",
        "Common reference",
        "Shared introduction",
        "Plugin reference",
        "Plugin terms",
        "@shared:references/common.md",
        "@plugin:references/plugin.md",
      ].join("\n")
    );
  });

  test("resolves named partials to one exact scope and path", async () => {
    await files(rootPath, {
      ".skillset/plugins/demo/shared/partials/plugin-only.md": "Plugin only",
      ".skillset/shared/partials/nested/intro.md": "Nested basename",
    });

    await expect(
      preprocessText("{{> intro}}", preprocessContext(rootPath, true))
    ).rejects.toThrow(
      /workspace named partial intro.*was not found at \.skillset\/shared\/partials\/intro\.md/u
    );
    await expect(
      preprocessText("{{> plugin-only}}", preprocessContext(rootPath, true))
    ).rejects.toThrow(
      /workspace named partial plugin-only.*was not found at \.skillset\/shared\/partials\/plugin-only\.md/u
    );
    await expect(
      preprocessText("{{> plugin:missing}}", preprocessContext(rootPath, true))
    ).rejects.toThrow(
      /plugin named partial plugin:missing.*was not found at \.skillset\/plugins\/demo\/shared\/partials\/missing\.md/u
    );
    await expect(
      preprocessText("{{> plugin:plugin-only}}", preprocessContext(rootPath))
    ).rejects.toThrow(/requires a plugin-bound source/u);
    await expect(
      preprocessText(
        "{{> shared:references/missing.md}}",
        preprocessContext(rootPath)
      )
    ).rejects.toThrow(
      /workspace path reference shared:references\/missing\.md.*was not found at \.skillset\/shared\/references\/missing\.md/u
    );
    await expect(
      preprocessText(
        "@{{plugin:references/missing.md}}",
        preprocessContext(rootPath, true)
      )
    ).rejects.toThrow(
      /plugin path reference plugin:references\/missing\.md.*was not found at \.skillset\/plugins\/demo\/shared\/references\/missing\.md/u
    );
  });

  test("records exact named-partial dependencies and expands recursively", async () => {
    await files(rootPath, {
      ".skillset/shared/partials/intro.md": "Intro {{> writing/tone}}",
      ".skillset/shared/partials/writing/tone.md": "Tone",
    });
    const dependencies = new Set<string>();

    await expect(
      preprocessText("{{> intro}}", {
        ...preprocessContext(rootPath),
        preprocessDependencies: dependencies,
      })
    ).resolves.toBe("Intro Tone");
    expect([...dependencies]).toEqual([
      join(rootPath, ".skillset/shared/partials/intro.md"),
      join(rootPath, ".skillset/shared/partials/writing/tone.md"),
    ]);
  });

  test("preserves cycle and traversal rejection for exact named partials", async () => {
    await files(rootPath, {
      ".skillset/shared/partials/a.md": "A {{> b}}",
      ".skillset/shared/partials/b.md": "B {{> a}}",
    });

    await expect(
      preprocessText("{{> a}}", preprocessContext(rootPath))
    ).rejects.toThrow(/creates a cycle/u);
    await expect(
      preprocessText("{{> writing/../tone}}", preprocessContext(rootPath))
    ).rejects.toThrow(/must use slash-separated name segments/u);
  });

  test("rejects shared partial and link symlinks outside the source root", async () => {
    await files(rootPath, {
      "outside.md": "PRIVATE_MARKER",
    });
    const partialRoot = join(rootPath, ".skillset/shared/partials");
    await mkdir(partialRoot, { recursive: true });
    await symlink(join(rootPath, "outside.md"), join(partialRoot, "outside.md"));

    await expect(
      preprocessText("{{> outside}}", preprocessContext(rootPath))
    ).rejects.toThrow(/resolves outside its partial root/u);
    await expect(
      preprocessText(
        "{{> shared:partials/outside.md}}",
        preprocessContext(rootPath)
      )
    ).rejects.toThrow(/resolves outside its partial root/u);
    await expect(
      preprocessText(
        "@{{shared:partials/outside.md}}",
        preprocessContext(rootPath)
      )
    ).rejects.toThrow(/resolves outside its partial root/u);

    const pluginPartialRoot = join(
      rootPath,
      ".skillset/plugins/demo/shared/partials"
    );
    await mkdir(pluginPartialRoot, { recursive: true });
    await symlink(
      join(rootPath, "outside.md"),
      join(pluginPartialRoot, "outside.md")
    );
    await expect(
      preprocessText("{{> plugin:outside}}", preprocessContext(rootPath, true))
    ).rejects.toThrow(/resolves outside its partial root/u);
  });

  test("allows a symlink whose target stays inside its partial root", async () => {
    await files(rootPath, {
      ".skillset/shared/partials/target.md": "Shared target",
    });
    const partialRoot = join(rootPath, ".skillset/shared/partials");
    await symlink(join(partialRoot, "target.md"), join(partialRoot, "alias.md"));

    await expect(
      preprocessText("{{> alias}}", preprocessContext(rootPath))
    ).resolves.toBe("Shared target");
  });

  test("rejects shared-root aliases into a sibling plugin", async () => {
    await files(rootPath, {
      ".skillset/plugins/other/shared/partials/secret.md": "SIBLING_MARKER",
      ".skillset/plugins/other/shared/references/secret.md": "SIBLING_MARKER",
    });
    const pluginRoot = join(rootPath, ".skillset/plugins/demo");
    await mkdir(pluginRoot, { recursive: true });
    await symlink(
      join(rootPath, ".skillset/plugins/other/shared"),
      join(pluginRoot, "shared")
    );

    for (const reference of [
      "{{> plugin:secret}}",
      "{{> plugin:references/secret.md}}",
      "@{{plugin:references/secret.md}}",
    ]) {
      await expect(
        preprocessText(reference, preprocessContext(rootPath, true))
      ).rejects.toThrow(/resolves outside its partial root/u);
    }
  });

  test("rejects workspace partial-root aliases into a plugin", async () => {
    await files(rootPath, {
      ".skillset/plugins/other/shared/partials/secret.md": "SIBLING_MARKER",
    });
    const workspaceSharedRoot = join(rootPath, ".skillset/shared");
    await mkdir(workspaceSharedRoot, { recursive: true });
    await symlink(
      join(rootPath, ".skillset/plugins/other/shared/partials"),
      join(workspaceSharedRoot, "partials")
    );

    await expect(
      preprocessText("{{> secret}}", preprocessContext(rootPath))
    ).rejects.toThrow(/resolves outside its partial root/u);
  });

  test("rejects plugin partial-root aliases into a sibling plugin", async () => {
    await files(rootPath, {
      ".skillset/plugins/other/shared/partials/secret.md": "SIBLING_MARKER",
    });
    const pluginSharedRoot = join(rootPath, ".skillset/plugins/demo/shared");
    await mkdir(pluginSharedRoot, { recursive: true });
    await symlink(
      join(rootPath, ".skillset/plugins/other/shared/partials"),
      join(pluginSharedRoot, "partials")
    );

    await expect(
      preprocessText("{{> plugin:secret}}", preprocessContext(rootPath, true))
    ).rejects.toThrow(/resolves outside its partial root/u);
  });

  test.each([
    "{{shared:references/common.md}}",
    "{{plugin:references/plugin.md}}",
    "{{@shared:references/common.md}}",
    "{{root:references/common.md}}",
    "{{> root:references/common.md}}",
    "@{{root:references/common.md}}",
    "@{{references/common.md}}",
    "{{references/common.md}}",
    "{{> demo.intro}}",
  ])("rejects retired reference syntax: %s", async (reference) => {
    await expect(preprocessText(reference, preprocessContext(rootPath, true))).rejects.toThrow(
      /unsupported reference syntax.*use \{\{> X\}\} to inline or @\{\{X\}\} to link/u
    );
  });

  test("preserves references in Markdown code spans and fences", async () => {
    const content = [
      "`{{> intro}}` and `@{{references/common.md}}`",
      "```md",
      "{{> intro}}",
      "{{shared:references/common.md}}",
      "@{{shared:references/common.md}}",
      "```",
      "~~~",
      "{{@shared:references/common.md}}",
      "~~~",
    ].join("\n");

    await expect(preprocessText(content, preprocessContext(rootPath))).resolves.toBe(content);
  });

  test("preserves triple-brace escapes and unrelated brace expressions", async () => {
    const content = [
      "{{{> intro}}}",
      "@{{{shared:references/common.md}}}",
      "{{component.props}}",
      "{{ value + 1 }}",
      "{ordinary braces}",
    ].join("\n");

    await expect(preprocessText(content, preprocessContext(rootPath))).resolves.toBe(
      [
        "{{> intro}}",
        "@{{shared:references/common.md}}",
        "{{component.props}}",
        "{{ value + 1 }}",
        "{ordinary braces}",
      ].join("\n")
    );
  });

  test("rejects a retired bare relative file partial", async () => {
    await files(rootPath, {
      ".skillset/skills/example/local.md": "Local partial",
    });

    await expect(
      preprocessText("{{local.md}}", preprocessContext(rootPath))
    ).rejects.toThrow(/unsupported reference syntax/u);
  });

  test("preserves current and retired forms when preprocessing is disabled", async () => {
    const content = [
      "{{> intro}}",
      "@{{shared:references/common.md}}",
      "{{shared:references/common.md}}",
      "{{@shared:references/common.md}}",
      "@{{references/common.md}}",
      "{{references/common.md}}",
      "{{local.md}}",
      "{{> root:references/common.md}}",
      "{{> demo.intro}}",
    ].join("\n");

    await expect(
      preprocessText(content, {
        ...preprocessContext(rootPath, true),
        frontmatter: { skillset: { preprocess: false } },
      })
    ).resolves.toBe(content);
  });

  test("uses the same current link grammar for marked path fields", async () => {
    await files(rootPath, {
      ".skillset/shared/references/common.md": "Common reference\n",
    });

    await expect(
      resolveMarkedPathReferences(
        "Read @{{shared:references/common.md}}.",
        preprocessContext(rootPath)
      )
    ).resolves.toBe("Read @shared:references/common.md.");
    await expect(
      resolveMarkedPathReferences(
        "Read {{@shared:references/common.md}}.",
        preprocessContext(rootPath)
      )
    ).rejects.toThrow(/unsupported reference syntax/u);
  });
});

function preprocessContext(rootPath: string, plugin = false): PreprocessContext {
  return {
    frontmatter: {},
    ...(plugin ? { pluginPath: join(rootPath, ".skillset/plugins/demo") } : {}),
    renderPathReference: ({ specifier }) => specifier,
    rootPath,
    sourcePath: join(
      rootPath,
      plugin ? ".skillset/plugins/demo/skills/example/SKILL.md" : ".skillset/skills/example/SKILL.md"
    ),
    sourceRoot: ".skillset",
  };
}

async function files(rootPath: string, entries: Readonly<Record<string, string>>): Promise<void> {
  await Promise.all(
    Object.entries(entries).map(async ([path, content]) => {
      const absolutePath = join(rootPath, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    })
  );
}
