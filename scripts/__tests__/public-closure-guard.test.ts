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
