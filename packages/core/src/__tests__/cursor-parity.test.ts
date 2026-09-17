import { afterEach, describe, expect, it, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSkillsetResult } from "@skillset/core";

const sourceRoot = path.join(process.cwd(), "fixtures/cursor-parity");
const roots: string[] = [];

const buildFixtureResult = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillset-cursor-parity-"));
  roots.push(root);
  await cp(sourceRoot, root, { recursive: true });
  const result = await buildSkillsetResult(root);
  return { result, root };
};

const buildFixture = async (): Promise<string> => {
  const { root } = await buildFixtureResult();
  return root;
};

const fileExists = (filePath: string): Promise<boolean> =>
  Bun.file(filePath).exists();

const unresolvedFixtureClaim = (): never => {
  throw new Error("unresolved Cursor parity fixture claim");
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("SET-550 Cursor parity evidence baseline", () => {
  it("cursor-rules-frontmatter [SET-557]", async () => {
    const root = await buildFixture();
    const rule = await readFile(
      path.join(root, ".cursor/rules/frontend/testing.mdc"),
      "utf-8"
    );

    expect(rule).toContain("description: Frontend testing guidance.");
    expect(rule).toContain("alwaysApply: false");
    expect(rule).toContain("globs:\n  - src/frontend/**/*.tsx");
  });

  test.todo(
    "cursor-rules-globs-escaping [SET-557, SET-574]",
    unresolvedFixtureClaim
  );

  it("cursor-rules-nested-dirs structural mirroring [SET-557]", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(path.join(root, ".cursor/rules/frontend/testing.mdc"))
    ).toBe(true);
  });

  test.todo(
    "cursor-rules-nested-dirs scoping semantics [SET-557]",
    unresolvedFixtureClaim
  );

  it("cursor-agents-md-root remains explicitly unsupported [SET-551, SET-557]", async () => {
    const { result } = await buildFixtureResult();

    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "AGENTS.md",
        featureId: "cursor-agents-md-root",
        sourcePath: ".skillset/RULES.md",
        status: "unsupported",
        target: "cursor",
      })
    );
  });

  it("cursor-skills-path [SET-553, SET-554]", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(path.join(root, ".cursor/skills/cursor-smoke/SKILL.md"))
    ).toBe(true);
  });

  it("cursor-subagents-path [SET-551]", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(path.join(root, ".cursor/agents/verifier.md"))
    ).toBe(true);
  });

  it("cursor-plugin-assets [SET-558]", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(path.join(root, "plugins/cursor-kit/assets/logo.svg"))
    ).toBe(true);
    expect(
      await fileExists(
        path.join(root, "plugins/cursor-kit/cursor/assets/logo.svg")
      )
    ).toBe(false);
  });

  it("carries package-root plugin surfaces beside the _cursor island", async () => {
    const root = await buildFixture();
    const pluginSource = path.join(
      root,
      ".skillset/plugins/cursor-kit"
    );

    expect(await fileExists(path.join(pluginSource, "assets/logo.svg"))).toBe(
      true
    );
    expect(await fileExists(path.join(pluginSource, "rules/plugin.md"))).toBe(
      true
    );
    expect(
      await fileExists(path.join(pluginSource, "hooks/hooks.json"))
    ).toBe(true);
    expect(
      await fileExists(
        path.join(pluginSource, "_cursor/native-evidence.txt")
      )
    ).toBe(true);
  });

  it("captures the documented Cursor plugin logo asset baseline", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(
        path.join(root, "plugins/cursor-kit/assets/logo.svg")
      )
    ).toBe(true);
  });

  test.todo("cursor-plugin-rules [SET-568]", unresolvedFixtureClaim);

  it("cursor-hooks-events [SET-559]", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(
        path.join(root, "plugins/cursor-kit/hooks/hooks.json")
      )
    ).toBe(true);
  });

  test.todo("cursor-settings-allow-deny [SET-564]", unresolvedFixtureClaim);

  it("preserves literal rule directory punctuation as the pre-SET-557 baseline", async () => {
    const root = await buildFixture();

    expect(
      await fileExists(path.join(root, ".cursor/rules/app/[slug]/routing.mdc"))
    ).toBe(true);
    expect(
      await fileExists(
        path.join(root, ".cursor/rules/app/(marketing)/copy.mdc")
      )
    ).toBe(true);
  });
});
