import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isGeneratedPublicPath,
  scanGeneratedPublicContent,
  scanGeneratedPublicTree,
} from "../public-closure-guard";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-public-closure-"));
  roots.push(root);
  return root;
}

describe("generated public closure guard", () => {
  test("SET-465: scans only generated skillset plugin output", () => {
    expect(
      isGeneratedPublicPath("plugins/skillset/claude/skills/skillset/SKILL.md")
    ).toBe(true);
    expect(
      isGeneratedPublicPath(
        "plugins/another/claude/skills/skillset-dev/SKILL.md"
      )
    ).toBe(false);
    expect(isGeneratedPublicPath(".agents/skills/skillset-dev/SKILL.md")).toBe(
      false
    );
    expect(isGeneratedPublicPath(".claude/skills/skillset-dev/SKILL.md")).toBe(
      false
    );
    expect(isGeneratedPublicPath(".cursor/skills/skillset-dev/SKILL.md")).toBe(
      false
    );
    expect(
      isGeneratedPublicPath(".skillset/skills/skillset-dev/SKILL.md")
    ).toBe(false);
  });

  test("SET-465: rejects contributor routes and repository-only paths", () => {
    const content = [
      "Use the `skillset-dev-schema` skill.",
      "Read docs/development/schema-contracts.md.",
      "Copy fixtures/kitchen-sink before continuing.",
      'import { build } from "@skillset/core/internal/build";',
      'import { render } from "@skillset/core/src/render";',
      "Inspect packages/core/src/render.ts.",
      "Inspect apps/skillset/src/cli.ts.",
      "Run bun scripts/provider-maintenance.ts check.",
      "Load repo:scripts/release-assets.ts.",
      "Read scripts/provider-maintenance.ts.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/provider-maintenance.ts"]
      ).map(({ rule }) => rule)
    ).toEqual([
      "contributor-skill",
      "development-docs",
      "fixture-path",
      "internal-package",
      "internal-package",
      "internal-package",
      "internal-package",
      "internal-script",
      "internal-script",
      "internal-script",
    ]);
  });

  test("SET-465: synthetic public leak fails without scanning contributor surfaces", async () => {
    const root = await fixtureRoot();
    const publicSkill = join(
      root,
      "plugins/skillset/claude/skills/skillset/SKILL.md"
    );
    const contributorSkill = join(root, ".agents/skills/skillset-dev/SKILL.md");
    const internalScript = join(root, "scripts/provider-maintenance.ts");
    await mkdir(join(publicSkill, ".."), { recursive: true });
    await mkdir(join(contributorSkill, ".."), { recursive: true });
    await mkdir(join(internalScript, ".."), { recursive: true });
    await writeFile(
      publicSkill,
      "Route schema work to skillset-dev-schema.\nRead scripts/provider-maintenance.ts.\n"
    );
    await writeFile(
      contributorSkill,
      "Read docs/development/schema-contracts.md.\n"
    );
    await writeFile(internalScript, "export {};\n");

    const result = await scanGeneratedPublicTree(root);

    expect(result.scannedFiles).toBe(1);
    expect(result.violations).toEqual([
      {
        file: "plugins/skillset/claude/skills/skillset/SKILL.md",
        line: 1,
        rule: "contributor-skill",
        text: "Route schema work to skillset-dev-schema.",
      },
      {
        file: "plugins/skillset/claude/skills/skillset/SKILL.md",
        line: 2,
        rule: "internal-script",
        text: "Read scripts/provider-maintenance.ts.",
      },
    ]);
  });

  test("SET-465: allows public product and plugin-local resource references", () => {
    const content = [
      "Use the `skillset` skill and run `skillset check`.",
      "A plugin may contain references/, assets/, and scripts/.",
      "Load plugin:scripts/check.sh when that public plugin owns it.",
      "Read .skillset/plugins/demo/scripts/provider-maintenance.ts.",
      "Read the public guide at docs/reference/features/skills.md.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/check.sh", "scripts/provider-maintenance.ts"]
      )
    ).toEqual([]);
  });
});
