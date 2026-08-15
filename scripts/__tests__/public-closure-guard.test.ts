import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findRepoInternalScriptAliases,
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
  await writeFile(join(root, "package.json"), '{"scripts":{}}\n');
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

  test("SET-465: rejects package-script aliases that reach repository scripts", () => {
    const aliases = findRepoInternalScriptAliases(
      {
        check: "bun test",
        "private release": "bun ./scripts/publish.ts publish",
        "publish:packages": 'bun run --silent "private release"',
        "release:bun": "bun --silent release:yarn",
        "release:packages": "pnpm --silent publish:packages",
        "release:yarn": "yarn run --silent release:packages",
      },
      ["scripts/publish.ts"]
    );
    const content = [
      'Run `bun run --silent "private release"`.',
      "Run `npm run --silent release:packages`.",
      "Run `pnpm run publish:packages`.",
      "Run `yarn run release:packages`.",
      "Run `bun --silent release:bun`.",
      "Run `pnpm --silent publish:packages`.",
      "Run `yarn release:yarn`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "private release",
      "publish:packages",
      "release:bun",
      "release:packages",
      "release:yarn",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/publish.ts"],
        aliases
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-script" },
      { line: 2, rule: "internal-script" },
      { line: 3, rule: "internal-script" },
      { line: 4, rule: "internal-script" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-script" },
      { line: 7, rule: "internal-script" },
    ]);
  });

  test("SET-465: tree scan derives private aliases from package.json", async () => {
    const root = await fixtureRoot();
    const publicSkill = join(
      root,
      "plugins/skillset/claude/skills/skillset/SKILL.md"
    );
    const internalScript = join(root, "scripts/publish.ts");
    await mkdir(join(publicSkill, ".."), { recursive: true });
    await mkdir(join(internalScript, ".."), { recursive: true });
    await writeFile(publicSkill, "Run `bun run release:packages`.\n");
    await writeFile(internalScript, "export {};\n");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "publish:packages": "bun scripts/publish.ts publish",
          "release:packages": "bun run publish:packages",
        },
      })
    );

    const result = await scanGeneratedPublicTree(root);

    expect(result.violations).toEqual([
      {
        file: "plugins/skillset/claude/skills/skillset/SKILL.md",
        line: 1,
        rule: "internal-script",
        text: "Run `bun run release:packages`.",
      },
    ]);
  });

  test("SET-465: value-taking runner flags preserve direct and transitive aliases", () => {
    const aliases = findRepoInternalScriptAliases(
      {
        private: "bun scripts/private.ts",
        "via:bun": "bun --cwd . run private",
        "via:npm": "npm --prefix . run via:bun",
        "via:pnpm": "pnpm --dir . run via:npm",
        "via:yarn": "yarn --cwd . run via:pnpm",
      },
      ["scripts/private.ts"]
    );
    const content = [
      "Run `npm --prefix . run private`.",
      "Run `bun --cwd . run via:npm`.",
      "Run `pnpm --dir . run via:yarn`.",
      "Run `yarn --cwd . run via:pnpm`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "private",
      "via:bun",
      "via:npm",
      "via:pnpm",
      "via:yarn",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases
      ).map(({ line }) => line)
    ).toEqual([1, 2, 3, 4]);
  });

  test("SET-465: Bun builtins require explicit run to resolve package aliases", () => {
    const aliases = findRepoInternalScriptAliases(
      {
        build: "bun scripts/private.ts",
        "builtin:build": "bun build",
        "builtin:test": "bun test",
        "explicit:build": "bun run build",
        "explicit:test": "bun run test",
        test: "bun scripts/private.ts",
      },
      ["scripts/private.ts"]
    );
    const content = [
      "Use `bun test`.",
      "Use `bun build`.",
      "Use `bun run test`.",
      "Use `bun run build`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "build",
      "explicit:build",
      "explicit:test",
      "test",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases
      ).map(({ line }) => line)
    ).toEqual([3, 4]);
  });

  test("SET-465: allows package scripts without repository-script dependencies", () => {
    const aliases = findRepoInternalScriptAliases(
      {
        check: "bun test",
        "check:focused": "bun run check -- --focused",
        "publish:packages": "bun scripts/publish.ts publish",
      },
      ["scripts/publish.ts"]
    );
    const content = [
      "Run `bun run check`.",
      "Run `npm run check:focused`.",
      "Do not treat `npm publish:packages` as npm-run shorthand.",
      "Run `pnpm run unknown`.",
      "Run `yarn run check`.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/publish.ts"],
        aliases
      )
    ).toEqual([]);
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
