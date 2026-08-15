import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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

  test("SET-465: rejects protected directory roots at token boundaries", () => {
    const content = [
      "Run `cd [packages/core]`.",
      "Open {apps/skillset/src}.",
      "Read <docs/development>.",
      "Inspect fixtures...",
      "cd scripts",
      "Open <scripts>.",
      "Inspect scripts...",
      "cd ../scripts",
      "cd ../../scripts",
      "cd scripts/",
      "cd scripts && ls",
      "cd scripts || exit 1",
      "Open scripts directory.",
      "cd scripts # inspect",
      "cd scripts | pwd",
      "cd scripts & pwd",
      "cd scripts > /tmp/out",
      "cd scripts.",
      "cd scripts, then inspect the files.",
      "cd scripts 2>/dev/null",
      "cd scripts 2>&1",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-package" },
      { line: 2, rule: "internal-package" },
      { line: 3, rule: "development-docs" },
      { line: 4, rule: "fixture-path" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-script" },
      { line: 7, rule: "internal-script" },
      { line: 8, rule: "internal-script" },
      { line: 9, rule: "internal-script" },
      { line: 10, rule: "internal-script" },
      { line: 11, rule: "internal-script" },
      { line: 12, rule: "internal-script" },
      { line: 13, rule: "internal-script" },
      { line: 14, rule: "internal-script" },
      { line: 15, rule: "internal-script" },
      { line: 16, rule: "internal-script" },
      { line: 17, rule: "internal-script" },
      { line: 18, rule: "internal-script" },
      { line: 19, rule: "internal-script" },
      { line: 20, rule: "internal-script" },
      { line: 21, rule: "internal-script" },
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        "Use docs/developmental, docs/development.md, apps/skillset/srcset, fixtures.json, and fixtures-extra."
      )
    ).toEqual([]);
  });

  test("SET-465: normalizes Windows separators before protected-boundary matching", () => {
    const content = [
      "Read docs\\development\\schema-contracts.md.",
      "Inspect packages\\core\\src\\render.ts.",
      "Use docs\\developmental and docs\\development.md.",
      "Read docs\\reference\\features\\skills.md.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "development-docs" },
      { line: 2, rule: "internal-package" },
    ]);
  });

  test("SET-465: normalizes literal shell quote fragments inside protected paths", () => {
    const content = [
      'Read packages/"core"/src/index.ts.',
      "Run `node packages/'core'/src/index.ts`.",
      'Read "docs"/development/schema-contracts.md.',
      'Read apps/skillset/"src"/cli.ts.',
      'Read fixtures/"kitchen-sink"/skillset.yaml.',
      'Run `node scripts/"private".ts`.',
      'Run `node pack""ages/core/src/index.ts`.',
      "Run `node fi''xtures/kitchen-sink/skillset.yaml`.",
      'Read docs/deve""lopment/schema-contracts.md.',
      'Run `node packages/"/"core/src/index.ts`.',
      'Read public/"packages"/core/src/index.ts.',
      'Read packages/"$PACKAGE"/src/index.ts.',
      'Read packages/"core docs"/src/index.ts.',
      'Read .skillset/plugins/demo/scripts/"check".ts.',
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"]
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-package" },
      { line: 2, rule: "internal-package" },
      { line: 3, rule: "development-docs" },
      { line: 4, rule: "internal-package" },
      { line: 5, rule: "fixture-path" },
      { line: 6, rule: "internal-script" },
      { line: 7, rule: "internal-package" },
      { line: 8, rule: "fixture-path" },
      { line: 9, rule: "development-docs" },
      { line: 10, rule: "internal-package" },
    ]);
  });

  test("SET-465: recognizes protected paths only in this repository's HTTP links", () => {
    const content = [
      "Read https://github.com/outfitter-dev/skillset/blob/main/docs/development/schema-contracts.md.",
      "Inspect https://github.com/outfitter-dev/skillset/tree/main/packages/core/src.",
      "Read https://raw.githubusercontent.com/outfitter-dev/skillset/main/fixtures/kitchen-sink/skillset.yaml.",
      "Open https://github.com/outfitter-dev/skillset/blob/main/apps%2Fskillset%2Fsrc%2Fcli.ts.",
      "Read https://github.com/outfitter-dev/skillset/blob/feature/foo/docs/development/schema-contracts.md.",
      "Read https://raw.githubusercontent.com/outfitter-dev/skillset/feature/foo/packages/core/src/index.ts.",
      "Read https://github.com/another/skillset/blob/main/docs/development/schema-contracts.md.",
      "Read https://example.com/outfitter-dev/skillset/blob/main/packages/core/src/index.ts.",
      "Read https://github.com/outfitter-dev/skillset/issues/1?path=docs/development/schema-contracts.md.",
      "Read https://github.com/outfitter-dev/skillset/blob/main/docs/developmental/overview.md.",
      "Read https://github.com/outfitter-dev/skillset/blob/main/docs/reference/features/skills.md.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "development-docs" },
      { line: 2, rule: "internal-package" },
      { line: 3, rule: "fixture-path" },
      { line: 4, rule: "internal-package" },
      { line: 5, rule: "development-docs" },
      { line: 6, rule: "internal-package" },
    ]);
  });

  test("SET-465: strips Markdown delimiters from repository HTTP links", () => {
    const content = [
      "[Development docs](https://github.com/outfitter-dev/skillset/tree/main/docs/development)",
      "![Fixture](https://github.com/outfitter-dev/skillset/blob/main/fixtures)",
      "[Package source](https://raw.githubusercontent.com/outfitter-dev/skillset/main/packages/core/src/index.ts)",
      "[Public docs](https://github.com/outfitter-dev/skillset/tree/main/docs/reference)",
      "[Lookalike](https://github.com/outfitter-dev/skillset/tree/main/docs/developmental)",
      "[Other repository](https://github.com/another/skillset/tree/main/docs/development)",
      "[Balanced parentheses](https://github.com/outfitter-dev/skillset/tree/main/docs/reference/example_(draft))",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "development-docs" },
      { line: 2, rule: "fixture-path" },
      { line: 3, rule: "internal-package" },
    ]);
  });

  test("SET-465: treats supported Markdown shell fences as command context", () => {
    const content = [
      "```bash",
      "ls scripts",
      "find fixtures",
      "cp -R packages out",
      "$ ls scripts",
      "(ls scripts)",
      "echo scripts",
      "```",
      "~~~shell",
      "tree scripts",
      "~~~",
      "```sh title=check",
      "du scripts",
      "```",
      "```ZSH",
      "stat scripts",
      "% ls scripts",
      "> ls scripts",
      "```",
      "```{.bash}",
      "command ls scripts",
      "```",
      "```typescript",
      'console.log("ls scripts");',
      "```",
      "In prose, ls scripts is not presented as a command.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 2, rule: "internal-script" },
      { line: 3, rule: "fixture-path" },
      { line: 4, rule: "internal-package" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-script" },
      { line: 10, rule: "internal-script" },
      { line: 13, rule: "internal-script" },
      { line: 16, rule: "internal-script" },
      { line: 17, rule: "internal-script" },
      { line: 18, rule: "internal-script" },
      { line: 21, rule: "internal-script" },
    ]);
  });

  test("SET-465: treats git -C as fenced-shell directory routing", () => {
    const content = [
      "```bash",
      "git -C scripts status",
      "git --no-pager -C scripts status",
      "git -c color.ui=false --git-dir .git -C scripts status",
      "git -C . -C scripts/subdir status",
      "git -C public -C .. -C scripts status",
      "git -C scripts>/tmp/log status",
      "git --literal-pathspecs -C scripts status",
      "git --glob-pathspecs -C scripts status",
      "git --noglob-pathspecs -C scripts status",
      "git --icase-pathspecs -C scripts status",
      "git --exec-path=/tmp -C scripts status",
      'git -C "scr"ipts status',
      "git -C docs/reference status",
      "git -C docs/reference -C examples status",
      "git -C scripts -C .. status",
      "git -C public -C scripts status",
      "git -C",
      "git -C --no-pager status",
      "git -Cscripts status",
      "git -config -C scripts status",
      "git -c=color.ui=false -C scripts status",
      "git --version -C scripts status",
      "git -h -C scripts status",
      "git status -C scripts",
      "echo git -C scripts",
      'git -C "scripts>/tmp" status',
      "git -C scripts\\>/tmp status",
      'git -C "packages|safe" status',
      "git -C packages\\|safe status",
      'ls "scripts|safe"',
      'ls \\"scripts',
      "ls scripts\\>",
      "ls \\(scripts",
      "ls scripts.",
      "```",
      "In prose, git -C scripts is not presented as a command.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 2, rule: "internal-script" },
      { line: 3, rule: "internal-script" },
      { line: 4, rule: "internal-script" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-script" },
      { line: 7, rule: "internal-script" },
      { line: 8, rule: "internal-script" },
      { line: 9, rule: "internal-script" },
      { line: 10, rule: "internal-script" },
      { line: 11, rule: "internal-script" },
      { line: 12, rule: "internal-script" },
      { line: 13, rule: "internal-script" },
    ]);
  });

  test("SET-465: protected path owners include roots and descendants across path forms", () => {
    const owners = [
      ["docs/development", "development-docs"],
      ["fixtures", "fixture-path"],
      ["packages", "internal-package"],
      ["apps/skillset/src", "internal-package"],
      ["scripts", "internal-script"],
    ] as const;

    for (const [owner, rule] of owners) {
      const lines = [
        `cd ${owner}`,
        `Open <${owner}>.`,
        `Read ../../${owner}.`,
        `Read ..\\..\\${owner.replaceAll("/", "\\")}.`,
        `Read /repo/${owner}.`,
        ...(owner === "scripts" ? [] : [`Read ${owner}/child.ts.`]),
        ...(owner === "scripts" ? [] : [`Use \`${owner}\`.`]),
      ];
      const content = lines.join("\n");
      expect(
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          content,
          [],
          new Set(),
          undefined,
          "/repo"
        ).map(({ line, rule: actualRule }) => ({ line, rule: actualRule }))
      ).toEqual(lines.map((_, index) => ({ line: index + 1, rule })));
      expect(
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Read C:\\repo\\${owner.replaceAll("/", "\\")}.`,
          [],
          new Set(),
          undefined,
          "C:\\repo"
        ).map(({ rule: actualRule }) => actualRule)
      ).toEqual([rule]);
      expect(
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          [
            `Read ${owner.toUpperCase()}/child.ts.`,
            `Read ..\\..\\${owner.toUpperCase().replaceAll("/", "\\")}.`,
          ].join("\n")
        ).map(({ rule: actualRule }) => actualRule)
      ).toEqual(owner === "scripts" ? [rule] : [rule, rule]);
    }

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        [
          "Public packages are useful.",
          "Portable fixtures improve examples.",
          "Plugin scripts make automation deterministic.",
          "Read docs/reference/features/skills.md.",
          "Import @skillset/core.",
          "Read .skillset/plugins/demo/scripts/check.ts.",
          "Read apps/public/src/index.ts.",
          "Read /other/packages/core/src/index.ts.",
          "Use docs/developmental and apps/skillset/srcset.",
        ].join("\n"),
        [],
        new Set(),
        undefined,
        "/repo"
      )
    ).toEqual([]);
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

  test("SET-465: tree scans fail closed on symbolic links", async () => {
    const root = await fixtureRoot();
    const publicRoot = join(root, "plugins/skillset/claude");
    const publicTarget = join(root, "outside-public.md");
    await mkdir(publicRoot, { recursive: true });
    await writeFile(publicTarget, "Read packages/core/src/private.ts.\n");
    await symlink(publicTarget, join(publicRoot, "linked.md"));

    await expect(scanGeneratedPublicTree(root)).rejects.toThrow(
      "public closure guard refuses symbolic link"
    );
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

  test("SET-465: package aliases inherit every protected internal boundary", () => {
    const packageScripts = {
      "internal:contributor": "echo skillset-dev-schema",
      "internal:docs": "echo docs\\development\\schema-contracts.md",
      "internal:fixture": "bun fixtures/kitchen-sink/check.ts",
      "internal:package":
        "bun packages/core/src/__tests__/adapter-conformance.test.ts",
      "internal:scoped": "bun @skillset/core/internal/build",
      "public:docs": "echo docs/reference/features/skills.md",
      "public:package": "bun @skillset/core",
      "public:plugin-script": "bun .skillset/plugins/demo/scripts/check.ts",
      "via:docs": "npm run internal:docs",
      "via:package": "bun run via:docs && pnpm run internal:package",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, []);

    expect([...aliases].toSorted()).toEqual([
      "internal:contributor",
      "internal:docs",
      "internal:fixture",
      "internal:package",
      "internal:scoped",
      "via:docs",
      "via:package",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        [
          "Run `bun run internal:package`.",
          "Run `npm run via:package`.",
          "Run `pnpm run public:docs`.",
          "Run `yarn run public:package`.",
          "Run `bun run public:plugin-script`.",
        ].join("\n"),
        [],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-script" },
      { line: 2, rule: "internal-script" },
    ]);
  });

  test("SET-465: scripts ownership distinguishes repository and plugin-local paths", () => {
    const packageScripts = {
      "plugin-local": "bun .skillset/plugins/demo/scripts/check.ts",
      private: "bun scripts/private.ts",
      transitive: "npm run private",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);

    expect([...aliases].toSorted()).toEqual(["private", "transitive"]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        [
          "Read scripts/check.ts from this plugin.",
          "Read scripts/private.ts from the repository.",
          "A plugin may contain `scripts/` companions.",
        ].join("\n"),
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([{ line: 2, rule: "internal-script" }]);
  });

  test("SET-465: shell-token contexts close bare protected roots", () => {
    const packageScripts = {
      "find:scripts": "find scripts -type f",
      "find:scripts:assignment": "CI=1 find scripts -type f",
      "list:fixtures": "ls fixtures",
      "list:scripts": "ls scripts",
      "list:scripts:env": "env CI=1 ls scripts",
      "public:lookalikes": "ls scripts-extra fixtures.json packages-public",
      "public:print-fixtures": "printf fixtures",
      "public:print-packages": "echo packages",
      "public:print-scripts": "echo scripts",
      "via:roots": "npm run list:scripts && bun run list:fixtures",
      "via:command": "command find fixtures -type f",
      "copy:packages": "cp -R packages out",
      "copy:packages:sudo": "sudo -u root cp -R packages out",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, []);

    expect([...aliases].toSorted()).toEqual([
      "copy:packages",
      "copy:packages:sudo",
      "find:scripts",
      "find:scripts:assignment",
      "list:fixtures",
      "list:scripts",
      "list:scripts:env",
      "via:command",
      "via:roots",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        [
          "Run `ls scripts`.",
          "Run `find fixtures -type f`.",
          "Run `cp -R packages out`.",
          "Run `node scripts`.",
          "Run `bun scripts`.",
          "Run `env CI=1 ls scripts`.",
          "Run `command find fixtures -type f`.",
          "Run `sudo -u root cp -R packages out`.",
          "Run `CI=1 find scripts -type f`.",
          "Run `echo packages`.",
          "Run `printf fixtures`.",
          "Run `echo scripts`.",
          "The plugin ships `scripts/` and `fixtures.json`.",
        ].join("\n")
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-script" },
      { line: 2, rule: "fixture-path" },
      { line: 3, rule: "internal-package" },
      { line: 4, rule: "internal-script" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-script" },
      { line: 7, rule: "fixture-path" },
      { line: 8, rule: "internal-package" },
      { line: 9, rule: "internal-script" },
    ]);
  });

  test("SET-465: ripgrep distinguishes patterns, option values, and path operands", () => {
    expect(
      [
        ...findRepoInternalScriptAliases(
          {
            "private:path": "rg TODO packages",
            "private:plugin-script-option": "rg -f scripts/patterns.txt public",
            "private:plugin-script-path": "rg TODO scripts/check.ts",
            "private:script-path": "rg TODO scripts/private.ts",
            "public:glob": "rg -g packages TODO public",
            "public:pattern": "rg packages/core/src/index.ts",
            "public:script-pattern": "rg scripts/private.ts",
          },
          ["scripts/private.ts"]
        ),
      ].toSorted()
    ).toEqual([
      "private:path",
      "private:plugin-script-option",
      "private:plugin-script-path",
      "private:script-path",
    ]);

    const content = [
      "```sh",
      "rg TODO packages",
      "rg TODO public packages fixtures",
      "rg -g packages TODO public",
      "rg --glob '*.ts' TODO packages",
      "rg -e TODO -- packages",
      "rg --regexp=TODO packages/core",
      "rg --files scripts",
      "rg TODO 'docs/development'",
      'rg TODO "apps/skillset/src"',
      "rg TODO pack\\ages",
      "rg TODO packages/**",
      "rg -- TODO packages",
      "rg packages",
      "rg packages public",
      "rg -e packages",
      "rg --regexp packages",
      "rg --glob packages TODO public",
      "rg -gpackages TODO public",
      "rg TODO public",
      "rg TODO -",
      "rg --files",
      "rg --glob packages",
      "rg --max-depth packages TODO public",
      "```",
      "Run `rg packages/core/src/index.ts`.",
      "Run `rg TODO packages/core/src/index.ts`.",
      "```sh",
      "rg 'packages/core/src/index.ts'",
      "rg packages/core/src/index.ts public",
      "rg -e packages/core/src/index.ts",
      "rg --glob packages/core/src/** TODO public",
      "rg scripts/private.ts",
      "rg TODO scripts/private.ts",
      "rg TODO scripts/check.ts",
      "rg --files scripts/check.ts",
      "rg -f scripts/patterns.txt public",
      "```",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"]
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 2, rule: "internal-package" },
      { line: 3, rule: "fixture-path" },
      { line: 3, rule: "internal-package" },
      { line: 5, rule: "internal-package" },
      { line: 6, rule: "internal-package" },
      { line: 7, rule: "internal-package" },
      { line: 9, rule: "development-docs" },
      { line: 10, rule: "internal-package" },
      { line: 11, rule: "internal-package" },
      { line: 12, rule: "internal-package" },
      { line: 13, rule: "internal-package" },
      { line: 27, rule: "internal-package" },
      { line: 34, rule: "internal-script" },
    ]);
  });

  test("SET-465: ripgrep handles normalized paths, short clusters, and bounded shell expansion", () => {
    expect(
      [
        ...findRepoInternalScriptAliases(
          {
            "private:absolute": "rg TODO /repo/packages",
            "private:brace": "rg TODO {packages,public}",
            "private:cluster": "rg -neTODO packages",
            "private:glob": "rg TODO **/packages",
            "private:negated": "! rg TODO packages",
            "private:parent": "rg TODO ../packages",
            "private:script-parent": "rg TODO ../scripts/private.ts",
            "public:foreign-absolute": "rg TODO /other/packages",
            "public:glob-option": "rg -ugpackages TODO public",
            "public:pattern-brace": "rg {packages,public}",
            "public:quoted-brace": "rg TODO '{packages,public}'",
          },
          ["scripts/private.ts"],
          "/repo"
        ),
      ].toSorted()
    ).toEqual([
      "private:absolute",
      "private:brace",
      "private:cluster",
      "private:glob",
      "private:negated",
      "private:parent",
      "private:script-parent",
    ]);

    const content = [
      "```sh",
      "rg TODO ../packages",
      "rg TODO ../../docs/development",
      "rg TODO /repo/packages",
      "rg TODO ../scripts/private.ts",
      "rg -neTODO packages",
      "rg -uneTODO fixtures",
      "rg -HneTODO docs/development",
      "! rg TODO packages",
      "rg TODO {packages,public}",
      "rg TODO {fixtures,public}",
      "rg TODO **/packages",
      "rg TODO /repo/**/packages",
      "rg TODO /other/packages",
      "rg TODO ../public/packages",
      "rg -ugpackages TODO public",
      "rg -g {packages,public} TODO public",
      "rg {packages,public}",
      "! echo packages",
      "rg -ne",
      "rg TODO '{packages,public}'",
      'rg TODO "{fixtures,public}"',
      "rg TODO \\{packages,public\\}",
      "```",
      "Run `rg TODO ../packages`.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        new Set(),
        undefined,
        "/repo"
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 2, rule: "internal-package" },
      { line: 3, rule: "development-docs" },
      { line: 4, rule: "internal-package" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-package" },
      { line: 7, rule: "fixture-path" },
      { line: 8, rule: "development-docs" },
      { line: 9, rule: "internal-package" },
      { line: 10, rule: "internal-package" },
      { line: 11, rule: "fixture-path" },
      { line: 12, rule: "internal-package" },
      { line: 13, rule: "internal-package" },
      { line: 25, rule: "internal-package" },
    ]);
  });

  test("SET-465: ripgrep checks path-reading and command option operands", () => {
    expect(
      [
        ...findRepoInternalScriptAliases(
          {
            "private:file": "rg -f scripts/private.ts public",
            "private:file-attached": "rg --file=scripts/private.ts public",
            "private:hostname":
              "rg --hostname-bin scripts/private.ts TODO public",
            "private:ignore":
              "rg --ignore-file docs/development/schema-contracts.md TODO public",
            "private:pre": "rg --pre 'node scripts/private.ts' TODO public",
            "public:file": "rg --file patterns.txt public",
            "public:ignore":
              "rg --ignore-file docs/reference/ignore TODO public",
            "public:pre": "rg --pre 'echo ready' TODO public",
          },
          ["scripts/private.ts"]
        ),
      ].toSorted()
    ).toEqual([
      "private:file",
      "private:file-attached",
      "private:hostname",
      "private:ignore",
      "private:pre",
    ]);

    const content = [
      "```sh",
      "rg -f scripts/private.ts public",
      "rg --file scripts/private.ts public",
      "rg --file=scripts/private.ts public",
      "rg --ignore-file docs/development/schema-contracts.md TODO public",
      "rg --pre scripts/private.ts TODO public",
      "rg --hostname-bin scripts/private.ts TODO public",
      "rg --pre 'node scripts/private.ts' TODO public",
      "rg --file patterns.txt public",
      "rg --ignore-file docs/reference/ignore TODO public",
      "rg --pre 'echo ready' TODO public",
      "rg --hostname-bin /usr/bin/hostname TODO public",
      "rg --glob packages TODO public",
      "```",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"]
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 2, rule: "internal-script" },
      { line: 3, rule: "internal-script" },
      { line: 4, rule: "internal-script" },
      { line: 5, rule: "development-docs" },
      { line: 6, rule: "internal-script" },
      { line: 7, rule: "internal-script" },
      { line: 8, rule: "internal-script" },
    ]);
  });

  test("SET-465: grep shares bounded pattern and file operand semantics", () => {
    expect(
      [
        ...findRepoInternalScriptAliases(
          {
            "private:attached": "grep -ReTODO packages",
            "private:pattern-file": "grep -f scripts/patterns.txt public",
            "private:recursive": "grep -R TODO packages",
            "private:wrapped": "env grep TODO fixtures",
            "public:option-value": "grep --include packages TODO public",
            "public:path-pattern": "grep packages/core public",
            "public:pattern": "grep packages/core",
          },
          ["scripts/patterns.txt"]
        ),
      ].toSorted()
    ).toEqual([
      "private:attached",
      "private:pattern-file",
      "private:recursive",
      "private:wrapped",
    ]);

    const cases = [
      ["grep -R TODO packages", ["internal-package"]],
      [
        "grep TODO public packages fixtures",
        ["fixture-path", "internal-package"],
      ],
      ["grep -e TODO packages", ["internal-package"]],
      ["grep -eTODO packages", ["internal-package"]],
      ["grep -ReTODO packages", ["internal-package"]],
      ["grep --color TODO packages", ["internal-package"]],
      ["grep --colour TODO packages", ["internal-package"]],
      ["grep --context 2 TODO packages", ["internal-package"]],
      ["grep --color=always TODO packages", ["internal-package"]],
      ["rg --colour TODO packages", ["internal-package"]],
      ["grep -f scripts/patterns.txt public", ["internal-script"]],
      ["grep --file=scripts/patterns.txt public", ["internal-script"]],
      [
        "grep --exclude-from docs/development/ignore TODO public",
        ["development-docs"],
      ],
      ["grep -- TODO packages", ["internal-package"]],
      ["grep TODO ../packages", ["internal-package"]],
      ["grep TODO /repo/packages", ["internal-package"]],
      ["env grep TODO packages", ["internal-package"]],
      ["echo ok && grep TODO fixtures", ["fixture-path"]],
      ["grep TODO 'docs/development'", ["development-docs"]],
      ["grep packages", []],
      ["grep packages/core", []],
      ["grep packages/core public", []],
      ["grep -e packages/core", []],
      ["grep -e TODO", []],
      ["grep TODO -", []],
      ["grep -- packages", []],
      ["grep --color packages", []],
      ["grep --context 2 packages/core public", []],
      ["grep -A packages TODO public", []],
      ["grep --include packages TODO public", []],
      ["grep -f scripts/plugin-patterns.txt public", []],
      ["grep TODO /other/packages", []],
      ["printf packages | grep TODO", []],
    ] as const;

    expect(
      cases.map(([command]) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `\`\`\`bash\n${command}\n\`\`\``,
          ["scripts/patterns.txt"],
          new Set(),
          undefined,
          "/repo"
        ).map(({ rule }) => rule)
      )
    ).toEqual(cases.map(([, rules]) => [...rules]));
  });

  test("SET-465: repository file URLs inherit protected owner semantics", () => {
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        [
          "Read file:///repo/scripts/private.ts.",
          "Read file:///repo/packages/core/src/x.ts.",
          "Read file:///other/scripts/private.ts.",
          "Read https://example.com/repo/packages/core/src/x.ts.",
        ].join("\n"),
        [],
        new Set(),
        undefined,
        "/repo"
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-script" },
      { line: 2, rule: "internal-package" },
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Read file:///C:/repo/Packages/core/src/x.ts.",
        [],
        new Set(),
        undefined,
        "C:\\repo"
      ).map(({ rule }) => rule)
    ).toEqual(["internal-package"]);
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

  test("SET-465: run delimiters expose scripts but not later script arguments", () => {
    const packageScripts = {
      "--private": "bun scripts/private.ts",
      "--public": "echo public",
      private: "bun scripts/private.ts",
      public: "echo public",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const protectedCommands = [
      "npm run -- private",
      "npm run --silent -- private",
      "bun run -- private",
      "bun run --silent -- private",
      "pnpm run -- private",
      "pnpm run --silent -- private",
      "npm run -- --private",
      "bun run -- --private",
      "pnpm run -- --private",
    ];
    const publicCommandsWithPrivateArguments = [
      "npm run public -- private",
      "bun run public -- private",
      "pnpm run public -- private",
      "npm run -- --public private",
      "bun run -- --public private",
      "pnpm run -- --public private",
    ];

    expect(
      protectedCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/private.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(protectedCommands.map(() => ["internal-script"]));
    expect(
      publicCommandsWithPrivateArguments.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/private.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        )
      )
    ).toEqual(publicCommandsWithPrivateArguments.map(() => []));
  });

  test("SET-465: unquoted shell operators terminate package-script tokens", () => {
    const packageScripts = {
      "publish:packages": "bun scripts/publish.ts",
      public: "echo public",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/publish.ts",
    ]);
    const protectedCommands = [
      "bun run publish:packages>/tmp/log",
      "npm run publish:packages|tee /tmp/log",
      "pnpm run publish:packages&&echo done",
      "yarn run publish:packages<input.txt",
      "bun run publish:packages&wait",
      "bun run publish\\:packages",
      'bun run "publish:"packages',
    ];
    const literalOrPublicCommands = [
      'bun run "publish:packages>/tmp/log"',
      "bun run 'publish:packages|tee'",
      "bun run publish:packages\\>/tmp/log",
      "bun run 'publish\\:packages'",
      'bun run "publish\\:packages"',
      "npm run public>publish:packages",
    ];

    expect(
      protectedCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/publish.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(protectedCommands.map(() => ["internal-script"]));
    expect(
      literalOrPublicCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/publish.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        )
      )
    ).toEqual(literalOrPublicCommands.map(() => []));
  });

  test("SET-465: npm pre-command config options preserve exact command selection", () => {
    const packageScripts = {
      private: "bun packages/core/src/private.ts",
      public: "echo public",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, []);
    const protectedCommands = [
      "npm --loglevel silent run private",
      "npm --workspace demo run private",
      "npm -w demo run private",
      "npm --silent run private",
      "npm --loglevel=silent run private",
      "npm --future-config value run private",
      "npm --future-boolean run private",
      "npm --no-future-boolean run private",
      "npm -- run private",
      "npm -L project run private",
      "npm -Q value run private",
      "npm -Z run private",
      "npm -s run private",
    ];

    expect([...aliases]).toEqual(["private"]);
    expect(
      protectedCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          [],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(protectedCommands.map(() => ["internal-script"]));

    const nonPrivateSelections = [
      "npm --loglevel silent run public private",
      "npm --workspace run private",
      "npm --future-config value public private",
      "npm --silent public private",
      "npm -L run private",
      "npm --location run private",
      "npm -Q value public private",
      "npm -- run public private",
    ];
    expect(
      nonPrivateSelections.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          [],
          aliases,
          new Set(Object.keys(packageScripts))
        )
      )
    ).toEqual(nonPrivateSelections.map(() => []));
  });

  test("SET-465: npm post-run config values preserve exact script selection", () => {
    const packageScripts = {
      "--private": "bun packages/core/src/private.ts",
      private: "bun packages/core/src/private.ts",
      public: "echo public",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, []);
    const protectedCommands = [
      "npm run --loglevel silent private",
      "npm run --loglevel=silent private",
      "npm run --workspace demo private",
      "npm run -w demo private",
      "npm run --prefix . private",
      "npm run --script-shell /bin/sh private",
      "npm run --location project private",
      "npm run -L project private",
      "npm run --userconfig /tmp/npmrc private",
      "npm run --cache /tmp/cache private",
      "npm run --registry https://registry.npmjs.org private",
      "npm run --fetch-retries 2 private",
      "npm run --future-config value private",
      "npm run --future-boolean private",
      "npm run --loglevel silent -- private",
      "npm run -- --private",
    ];
    const publicOrIncompleteCommands = [
      "npm run --loglevel silent public private",
      "npm run public --loglevel silent private",
      "npm run --loglevel private",
      "npm run --workspace private",
      "npm run --cache private",
      "npm run --userconfig private",
      "npm run --future-config value public private",
      "npm run --silent public private",
      "npm run --loglevel silent -- public private",
    ];

    expect(
      protectedCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          [],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(protectedCommands.map(() => ["internal-script"]));
    expect(
      publicOrIncompleteCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          [],
          aliases,
          new Set(Object.keys(packageScripts))
        )
      )
    ).toEqual(publicOrIncompleteCommands.map(() => []));
  });

  test("SET-465: pnpm post-run value options preserve exact script selection", () => {
    const packageScripts = {
      "--private": "bun packages/core/src/private.ts",
      private: "bun packages/core/src/private.ts",
      public: "echo public",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, []);
    const protectedCommands = [
      "pnpm run --loglevel silent private",
      "pnpm run --loglevel=silent private",
      "pnpm run --filter demo private",
      "pnpm run -F demo private",
      "pnpm run --dir . private",
      "pnpm run -C . private",
      "pnpm run --workspace-concurrency 2 private",
      "pnpm run --reporter append-only private",
      "pnpm run --script-shell /bin/sh private",
      "pnpm run --store-dir /tmp/store private",
      "pnpm run --network-concurrency 2 private",
      "pnpm run --future-config value private",
      "pnpm run --future-boolean private",
      "pnpm run --loglevel silent -- private",
      "pnpm run -- --private",
    ];
    const publicOrIncompleteCommands = [
      "pnpm run --loglevel silent public private",
      "pnpm run public --loglevel silent private",
      "pnpm run --loglevel private",
      "pnpm run --filter private",
      "pnpm run --reporter private",
      "pnpm run --script-shell private",
      "pnpm run --future-config value public private",
      "pnpm run --silent public private",
      "pnpm run --loglevel silent -- public private",
    ];

    expect(
      protectedCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          [],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(protectedCommands.map(() => ["internal-script"]));
    expect(
      publicOrIncompleteCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          [],
          aliases,
          new Set(Object.keys(packageScripts))
        )
      )
    ).toEqual(publicOrIncompleteCommands.map(() => []));
  });

  test("SET-465: Yarn require values do not hide the selected script", () => {
    const packageScripts = {
      private: "bun scripts/private.ts",
      public: "echo public",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const protectedCommands = [
      "yarn run --require ./hook.cjs private",
      "yarn --cwd . run --require ./hook.cjs private",
      "yarn run --require=./hook.cjs private",
      "yarn --require ./hook.cjs run private",
      "yarn --require=./hook.cjs run private",
      "yarn --require ./hook.cjs --cwd . run private",
      "yarn --require ./hook.cjs --silent run private",
      "yarn --require ./hook.cjs --inspect run private",
      "yarn --require one.cjs --require two.cjs run private",
    ];

    expect(
      protectedCommands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/private.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(protectedCommands.map(() => ["internal-script"]));
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Run `yarn run public --require ./hook.cjs private`.",
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      )
    ).toEqual([]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Run `yarn --require ./hook.cjs private`.",
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      )
    ).toEqual([]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Run `yarn --require=./hook.cjs private`.",
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      )
    ).toEqual([]);
  });

  test("SET-465: pnpm filter selectors preserve direct and transitive aliases", () => {
    const packageScripts = {
      private: "bun scripts/private.ts",
      "via:filter": "pnpm --filter skillset run private",
      "via:filter-short": "pnpm -F skillset run via:filter",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const content = [
      "Run `pnpm --filter skillset run private`.",
      "Run `pnpm -F skillset run via:filter`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "private",
      "via:filter",
      "via:filter-short",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line }) => line)
    ).toEqual([1, 2]);
  });

  test("SET-465: pnpm directory selectors preserve the following script command", () => {
    const packageScripts = {
      private: "bun scripts/private.ts",
      "via:dir": "pnpm --dir . run private",
      "via:dir-short": "pnpm -C . run via:dir",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const content = [
      "Run `pnpm --dir . run private`.",
      "Run `pnpm -C . run via:dir`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "private",
      "via:dir",
      "via:dir-short",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line }) => line)
    ).toEqual([1, 2]);
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

  test("SET-465: npm run aliases and lifecycle shorthand resolve private scripts", () => {
    const aliases = findRepoInternalScriptAliases(
      {
        install: "bun scripts/private.ts",
        private: "bun scripts/private.ts",
        restart: "bun scripts/private.ts",
        start: "bun scripts/private.ts",
        stop: "bun scripts/private.ts",
        "via:run-script": "npm run-script private",
        "via:rum": "npm rum via:run-script",
        "via:t": "npm t",
        "via:test": "npm test",
        "via:tst": "npm tst",
        "via:urn": "npm urn via:rum",
        test: "bun scripts/private.ts",
      },
      ["scripts/private.ts"]
    );
    const content = [
      "Run `npm run-script private`.",
      "Run `npm rum via:run-script`.",
      "Run `npm urn via:rum`.",
      "Run `npm test`.",
      "Run `npm t`.",
      "Run `npm tst`.",
      "Run `npm start`.",
      "Run `npm stop`.",
      "Run `npm restart`.",
      "Run `npm install`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "install",
      "private",
      "restart",
      "start",
      "stop",
      "test",
      "via:rum",
      "via:run-script",
      "via:t",
      "via:test",
      "via:tst",
      "via:urn",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases
      ).map(({ line }) => line)
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("SET-465: npm lifecycle edges and restart fallback close private aliases", () => {
    const packageScripts = {
      postrelease: "bun scripts/private.ts",
      pretest: "bun scripts/private.ts",
      release: "echo release",
      start: "echo start",
      stop: "bun scripts/private.ts",
      test: "echo test",
      "via:release": "npm run release",
      "via:restart": "npm restart",
      "via:test": "npm test",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const content = [
      "Run `npm test`.",
      "Run `npm run release`.",
      "Run `npm restart`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "postrelease",
      "pretest",
      "stop",
      "via:release",
      "via:restart",
      "via:test",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line }) => line)
    ).toEqual([1, 2, 3]);
  });

  test("SET-465: npm restart does not follow fallback when restart exists", () => {
    const packageScripts = {
      restart: "echo restart",
      stop: "bun scripts/private.ts",
      wrapper: "npm restart",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);

    expect([...aliases]).toEqual(["stop"]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Run `npm restart`.",
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      )
    ).toEqual([]);
  });

  test("SET-465: npm run value flags preserve direct and transitive aliases", () => {
    const packageScripts = {
      private: "bun scripts/private.ts",
      "via:prefix": "npm --prefix . run private",
      "via:shell": "npm --script-shell bash run via:workspace",
      "via:workspace": "npm --workspace packages/demo run via:prefix",
      "via:workspace-short": "npm run -w packages/demo via:shell",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const content = [
      "Run `npm --prefix . run private`.",
      "Run `npm --workspace packages/demo run via:prefix`.",
      "Run `npm run -w packages/demo via:workspace`.",
      "Run `npm --script-shell bash run via:workspace-short`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "private",
      "via:prefix",
      "via:shell",
      "via:workspace",
      "via:workspace-short",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      )
        .filter(({ rule }) => rule === "internal-script")
        .map(({ line }) => line)
    ).toEqual([1, 2, 3, 4]);
  });

  test("SET-465: Bun and pnpm execution follows package pre and post hooks", () => {
    const packageScripts = {
      check: "echo check",
      postreview: "bun scripts/private.ts",
      precheck: "bun scripts/private.ts",
      review: "echo review",
      "via:bun-run": "bun --cwd . run check",
      "via:bun-short": "bun --cwd . review",
      "via:pnpm-run": "pnpm --dir . run check",
      "via:pnpm-run-script-post": "pnpm --dir . run-script review",
      "via:pnpm-run-script-pre": "pnpm run-script check",
      "via:pnpm-short": "pnpm --dir . review",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const content = [
      "Run `bun --cwd . run check`.",
      "Run `bun --cwd . review`.",
      "Run `pnpm --dir . run check`.",
      "Run `pnpm --dir . review`.",
      "Run `pnpm run-script check`.",
      "Run `pnpm --dir . run-script review`.",
    ].join("\n");

    expect([...aliases].toSorted()).toEqual([
      "postreview",
      "precheck",
      "via:bun-run",
      "via:bun-short",
      "via:pnpm-run",
      "via:pnpm-run-script-post",
      "via:pnpm-run-script-pre",
      "via:pnpm-short",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/claude/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line }) => line)
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("SET-465: Bun value flags do not swallow protected package scripts", () => {
    const packageScripts = {
      private: "bun scripts/private.ts",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);
    const commands = [
      "bun run --shell system private",
      "bun run --filter workspace private",
      "bun run -F workspace private",
      "bun run --config private",
      "bun run -c private",
      "bun run --bunfile private",
      "bun run --config=bunfig.toml private",
      "bun run -c=bunfig.toml private",
      "bun run --bunfile=bunfig.toml private",
      "bun run --preload setup.ts private",
      "bun run -r setup.ts private",
      "bun run --inspect private",
      "bun run --inspect-wait private",
      "bun run --inspect-brk private",
      "bun run --inspect=localhost:9229 private",
      "bun run --inspect-wait=localhost:9229 private",
      "bun run --inspect-brk=localhost:9229 private",
      "bun --inspect run private",
      "bun --config run private",
      "bun run --cpu-prof-name profile private",
      "bun run --conditions development private",
      "bun run --env-file .env.test private",
      "bun run --define FLAG:true private",
      "bun run -d FLAG:true private",
      "bun run --eval 1+1 private",
      "bun run -e 1+1 private",
      "bun run --print 1+1 private",
      "bun run -p 1+1 private",
      "bun run --loader .ts:tsx private",
      "bun run -l .ts:tsx private",
      "bun run --tsconfig-override tsconfig.test.json private",
      "bun run --shell=system private",
    ];

    expect(
      commands.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/private.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        ).map(({ rule }) => rule)
      )
    ).toEqual(commands.map(() => ["internal-script"]));

    const separatedNonValues = [
      "bun run --config bunfig.toml private",
      "bun run -c bunfig.toml private",
      "bun run --bunfile bunfig.toml private",
      "bun run --inspect localhost:9229 private",
      "bun run --inspect-wait localhost:9229 private",
      "bun run --inspect-brk localhost:9229 private",
      "bun --inspect localhost:9229 run private",
      "bun --config bunfig.toml run private",
    ];
    expect(
      separatedNonValues.map((command) =>
        scanGeneratedPublicContent(
          "plugins/skillset/codex/skills/skillset/SKILL.md",
          `Run \`${command}\`.`,
          ["scripts/private.ts"],
          aliases,
          new Set(Object.keys(packageScripts))
        )
      )
    ).toEqual(separatedNonValues.map(() => []));
  });

  test("SET-465: Bun builtins still bypass package lifecycle shorthand", () => {
    const packageScripts = {
      pretest: "bun scripts/private.ts",
      test: "echo test",
      "via:explicit": "bun run test",
      "via:shorthand": "bun test",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);

    expect([...aliases].toSorted()).toEqual(["pretest", "via:explicit"]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        ["Use `bun test`.", "Use `bun run test`."].join("\n"),
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      ).map(({ line }) => line)
    ).toEqual([2]);
  });

  test("SET-465: shell continuations remove backslash-newline without a separator", () => {
    const packageScripts = {
      outer: "bun run pri\\\nvate",
      path: "bun scripts/\\\nprivate.ts",
      private: "bun scripts/private.ts",
      transitive: "bun run out\\\ner",
    };
    const aliases = findRepoInternalScriptAliases(packageScripts, [
      "scripts/private.ts",
    ]);

    expect([...aliases].toSorted()).toEqual([
      "outer",
      "path",
      "private",
      "transitive",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        [
          "Run `bun run pri\\",
          "vate`.",
          "Run `bun scripts/\\",
          "private.ts`.",
          "Run `bun run\\",
          "private`.",
          "Run `bun run out\\",
          "er`.",
        ].join("\n"),
        ["scripts/private.ts"],
        aliases,
        new Set(Object.keys(packageScripts))
      )
    ).toEqual([
      {
        file: "plugins/skillset/codex/skills/skillset/SKILL.md",
        line: 1,
        rule: "internal-script",
        text: "Run `bun run private`.",
      },
      {
        file: "plugins/skillset/codex/skills/skillset/SKILL.md",
        line: 3,
        rule: "internal-script",
        text: "Run `bun scripts/private.ts`.",
      },
      {
        file: "plugins/skillset/codex/skills/skillset/SKILL.md",
        line: 7,
        rule: "internal-script",
        text: "Run `bun run outer`.",
      },
    ]);
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
      "Portable scripts make repeated operations deterministic.",
      "Read scripts carefully before distributing a plugin.",
      "Run `cd scripts.md` to inspect an unrelated directory.",
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

  test("SET-465: rejects traversals and actual absolute paths to inventoried scripts", () => {
    const content = [
      "Read ../../scripts/private.ts.",
      "Read .././../scripts/private.ts.",
      "Read `..\\..\\scripts\\private.ts`.",
      "Read /repo/scripts/private.ts.",
      "Read /repo/./scripts/private.ts.",
      "Read /repo/sub/../scripts/private.ts.",
      "Read /other/scripts/private.ts.",
      "Read ../../scripts/public.ts.",
      "Read .skillset/plugins/demo/scripts/private.ts.",
      "cd /repo/scripts",
      "cd /other/scripts",
      "Open .skillset/plugins/demo/scripts.",
    ].join("\n");

    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        content,
        ["scripts/private.ts"],
        new Set(),
        undefined,
        "/repo"
      ).map(({ line, rule }) => ({ line, rule }))
    ).toEqual([
      { line: 1, rule: "internal-script" },
      { line: 2, rule: "internal-script" },
      { line: 3, rule: "internal-script" },
      { line: 4, rule: "internal-script" },
      { line: 5, rule: "internal-script" },
      { line: 6, rule: "internal-script" },
      { line: 8, rule: "internal-script" },
      { line: 10, rule: "internal-script" },
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Read `C:\\repo\\sub\\..\\scripts\\private.ts`.",
        ["scripts/private.ts"],
        new Set(),
        undefined,
        "C:\\repo"
      ).map(({ rule }) => rule)
    ).toEqual(["internal-script"]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "cd C:\\repo\\scripts",
        ["scripts/private.ts"],
        new Set(),
        undefined,
        "C:\\repo"
      ).map(({ rule }) => rule)
    ).toEqual(["internal-script"]);
  });
});
