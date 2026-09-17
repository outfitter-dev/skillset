import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";
import { explainPath } from "@skillset/core/internal/authoring";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-project-use-"));
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

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("SET-554 project-use skill copies", () => {
  it("resolves collisions once, marks copies, records provenance, and cleans up deselection", async () => {
    const config = (selection: string) => `
skillset:
  name: project-use
compile:
  unsupportedDestination: warn
claude: true
codex: true
cursor: true
internal_marker: true
plugins:
  internal_use:
    skills:
      alpha: ${selection}
      beta: true
`;
    const root = await fixture({
      "skillset.yaml": config("true"),
      ".skillset/skills/shared/SKILL.md": skill("shared", "Workspace copy"),
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha\n",
      ".skillset/plugins/alpha/skills/(group)/shared/SKILL.md": skill(
        "shared",
        "Alpha copy"
      ),
      ".skillset/plugins/alpha/bin/tool": "#!/bin/sh\nexit 0\n",
      ".skillset/plugins/beta/skillset.yaml": "skillset:\n  name: beta\n",
      ".skillset/plugins/beta/skills/shared/SKILL.md": skill(
        "shared",
        "Beta copy"
      ),
    });
    const result = await buildSkillsetResult(root);
    for (const targetRoot of [
      ".claude/skills",
      ".agents/skills",
      ".cursor/skills",
    ]) {
      expect(
        await Bun.file(join(root, targetRoot, "shared/SKILL.md")).exists()
      ).toBe(true);
      expect(
        await Bun.file(join(root, targetRoot, "alpha-shared/SKILL.md")).exists()
      ).toBe(true);
      expect(
        await Bun.file(join(root, targetRoot, "beta-shared/SKILL.md")).exists()
      ).toBe(true);
      expect(
        await readFile(join(root, targetRoot, "alpha-shared/SKILL.md"), "utf8")
      ).toContain("internal: true");
    }
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({ code: "internal-use-name-conflict" }),
        ],
        sourceUnit: "plugin.alpha.skill:shared",
        target: "codex",
      })
    );
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "bin",
        diagnostics: [
          expect.objectContaining({
            code: "internal-use-component-unsupported",
          }),
        ],
        featureId: "internal-use-components",
        sourceUnit: "plugin.alpha.skill:shared",
        status: "unsupported",
        target: "codex",
      })
    );
    expect(
      await explainPath(root, ".agents/skills/alpha-shared/SKILL.md")
    ).toMatchObject({
      entries: [
        expect.objectContaining({
          effectiveName: "alpha-shared",
          owner: { target: "codex" },
          role: "project-use",
          selectionRule: "plugins.internal_use.skills.alpha: true",
          sourceUnit: "plugin.alpha.skill:shared",
        }),
      ],
    });

    await mkdir(join(root, ".agents/skills/unmanaged"), { recursive: true });
    await writeFile(join(root, ".agents/skills/unmanaged/NOTE.md"), "keep\n");
    await writeFile(join(root, "skillset.yaml"), config("false"));
    await buildSkillsetResult(root);
    expect(
      await Bun.file(
        join(root, ".agents/skills/alpha-shared/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/unmanaged/NOTE.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".agents/skills/beta-shared/SKILL.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".agents/skills/shared/SKILL.md")).exists()
    ).toBe(true);
  });

  it("omits the internal marker when internal_marker is false", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: marker-off\nclaude: false\ncodex: true\ncursor: false\ninternal_marker: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": skill(
        "use-me",
        "Use me"
      ),
    });
    await buildSkillsetResult(root);
    const markdown = await readFile(
      join(root, ".agents/skills/use-me/SKILL.md"),
      "utf8"
    );
    expect(markdown).not.toContain("internal:");
  });
});
