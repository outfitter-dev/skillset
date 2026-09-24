/* eslint-disable func-style -- Resource fixtures stay adjacent to their focused assertions. */

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import {
  createEffectiveSkillResourcePlanner,
  findUndeclaredResourceLinks,
  readSkillResources,
  type ResourceContext,
} from "../resources";

describe("effective skill resources", () => {
  let context: ResourceContext;
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await createTestFixtureRoot("skillset-effective-resources-");
    context = {
      label: ".skillset/plugins/demo/skills/example/SKILL.md",
      pluginSharedPath: join(rootPath, ".skillset/plugins/demo/shared"),
      sharedPath: join(rootPath, ".skillset/shared"),
      sourceRootPath: join(rootPath, ".skillset"),
    };
  });

  test("plans both scopes and all four implied resource groups", async () => {
    await files(rootPath, {
      ".skillset/plugins/demo/shared/references/plugin.md": "Plugin guide",
      ".skillset/shared/assets/logo.svg": "<svg />",
      ".skillset/shared/references/guide.md": "Guide",
      ".skillset/shared/scripts/run.sh": "#!/bin/sh",
      ".skillset/shared/templates/report.txt": "Report",
    });
    const planner = createEffectiveSkillResourcePlanner([], context);

    await expect(
      Promise.all([
        planner.resolveReference("shared:references/guide.md"),
        planner.resolveReference("shared:scripts/run.sh"),
        planner.resolveReference("shared:assets/logo.svg"),
        planner.resolveReference("shared:templates/report.txt"),
        planner.resolveReference("plugin:references/plugin.md"),
      ])
    ).resolves.toEqual([
      "references/guide.md",
      "scripts/run.sh",
      "assets/logo.svg",
      "templates/report.txt",
      "references/plugin.md",
    ]);
    expect(planner.resources().map(({ from, targetPath }) => ({ from, targetPath }))).toEqual([
      { from: "shared:assets/logo.svg", targetPath: "assets/logo.svg" },
      { from: "shared:references/guide.md", targetPath: "references/guide.md" },
      { from: "plugin:references/plugin.md", targetPath: "references/plugin.md" },
      { from: "shared:scripts/run.sh", targetPath: "scripts/run.sh" },
      { from: "shared:templates/report.txt", targetPath: "templates/report.txt" },
    ]);
  });

  test("lets declared exact and directory remaps win and dedupes repeated links", async () => {
    await files(rootPath, {
      ".skillset/shared/references/common.md": "Common",
      ".skillset/shared/references/guides/child.md": "Child",
    });
    const declared = await readSkillResources(
      {
        references: [
          { from: "shared:references/common.md", to: "docs/common.md" },
          { from: "shared:references/guides", to: "docs/guides" },
        ],
      },
      context
    );
    const planner = createEffectiveSkillResourcePlanner(declared, context);

    await expect(
      planner.resolveReference("shared:references/common.md")
    ).resolves.toBe("docs/common.md");
    await expect(
      planner.resolveReference("shared:references/guides/child.md")
    ).resolves.toBe("docs/guides/child.md");
    await expect(
      planner.resolveReference("shared:references/common.md")
    ).resolves.toBe("docs/common.md");
    expect(planner.resources()).toEqual(declared);
  });

  test("rejects invalid groups, missing files, target collisions, and escaping symlinks", async () => {
    await files(rootPath, {
      ".skillset/plugins/demo/shared/references/common.md": "Plugin",
      ".skillset/shared/references/common.md": "Workspace",
      "outside.md": "Outside",
    });
    const planner = createEffectiveSkillResourcePlanner([], context);

    await expect(
      planner.resolveReference("shared:docs/guide.md")
    ).rejects.toThrow("references, scripts, assets, templates");
    await expect(
      planner.resolveReference("shared:references/missing.md")
    ).rejects.toThrow("resources source not found");
    await expect(
      planner.resolveReference("shared:references/common.md")
    ).resolves.toBe("references/common.md");
    await expect(
      planner.resolveReference("plugin:references/common.md")
    ).rejects.toThrow("maps to references/common.md, already used by shared:references/common.md");

    await symlink(
      join(rootPath, "outside.md"),
      join(rootPath, ".skillset/shared/references/escaped.md")
    );
    await expect(
      planner.resolveReference("shared:references/escaped.md")
    ).rejects.toThrow("resources source resolves outside the source root");
  });

  test("rejects a plugin shared root aliased to a sibling owner", async () => {
    const pluginSharedPath = join(rootPath, ".skillset/plugins/demo/shared");
    await files(rootPath, {
      ".skillset/plugins/other/shared/references/secret.md": "Other plugin",
    });
    await mkdir(dirname(pluginSharedPath), { recursive: true });
    await symlink(
      join(rootPath, ".skillset/plugins/other/shared"),
      pluginSharedPath,
      "dir"
    );

    await expect(
      readSkillResources(
        { references: ["plugin:references/secret.md"] },
        context
      )
    ).rejects.toThrow("resources source resolves outside its source owner");
    await expect(
      createEffectiveSkillResourcePlanner([], context).resolveReference(
        "plugin:references/secret.md"
      )
    ).rejects.toThrow("resources source resolves outside its source owner");
  });

  test("rejects a workspace shared root aliased to a plugin owner", async () => {
    await files(rootPath, {
      ".skillset/plugins/other/shared/references/secret.md": "Other plugin",
    });
    await symlink(
      join(rootPath, ".skillset/plugins/other/shared"),
      context.sharedPath,
      "dir"
    );

    await expect(
      readSkillResources(
        { references: ["shared:references/secret.md"] },
        context
      )
    ).rejects.toThrow("resources source resolves outside its source owner");
    await expect(
      createEffectiveSkillResourcePlanner([], context).resolveReference(
        "shared:references/secret.md"
      )
    ).rejects.toThrow("resources source resolves outside its source owner");
  });

  test("keeps ordinary Markdown resource links declared-only with current guidance", () => {
    expect(
      findUndeclaredResourceLinks(
        "Read [the guide](shared:references/guide.md).",
        []
      )
    ).toEqual([
      {
        reference: "shared:references/guide.md",
        suggestion:
          "use @{{shared:references/guide.md}} to link and copy it; " +
          "use resources for directories, unlinked files, or to: remaps",
      },
    ]);
  });
});

async function files(
  rootPath: string,
  entries: Readonly<Record<string, string>>
): Promise<void> {
  await Promise.all(
    Object.entries(entries).map(async ([path, content]) => {
      const absolutePath = join(rootPath, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    })
  );
}
