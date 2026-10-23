import { describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { buildSkillsetResult } from "@skillset/core";
import { explainPath } from "@skillset/core/internal/authoring";

async function authoringModel(): Promise<string> {
  const root = await createTestFixtureRoot("skillset-authoring-rules-");
  await cp(join(process.cwd(), "fixtures/authoring-model"), root, { recursive: true });
  return root;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

describe("rule scope from location [SET-557]", () => {
  test("a rule's directory decides its AGENTS.md and paths: narrows within it", async () => {
    const root = await authoringModel();
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const paths = result.data.map((file) => file.path);

    const engineering = await readFile(join(root, "engineering/AGENTS.md"), "utf8");
    expect(engineering).toContain("# Coding guidance");
    expect(engineering).toContain("# TypeScript");

    expect(await readFile(join(root, ".claude/rules/docs/writing.md"), "utf8")).toStartWith(
      "---\npaths:\n  - docs/*.md\n  - docs/guides/**/*.md\n---\n"
    );
    expect(await readFile(join(root, ".cursor/rules/docs/writing.mdc"), "utf8")).toContain(
      "globs:\n  - docs/*.md\n  - docs/guides/**/*.md\n"
    );
    expect(await readFile(join(root, ".claude/rules/testing.md"), "utf8")).toStartWith("# Testing");

    expect(await exists(join(root, "app/[slug]/AGENTS.md"))).toBe(true);
    expect(await readFile(join(root, ".claude/rules/app/[slug]/routing.md"), "utf8")).toStartWith(
      "---\npaths:\n  - app/\\[slug\\]/**\n---\n"
    );
    expect(await readFile(join(root, ".cursor/rules/app/[slug]/routing.mdc"), "utf8")).toContain(
      "  - app/[slug]/**\n"
    );
    expect(await exists(join(root, "app/(marketing)/AGENTS.md"))).toBe(true);

    // The wildcard rule writes nothing anywhere and never falls back to root.
    expect(paths.some((path) => path.includes("[.]"))).toBe(false);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).not.toContain("App testing");
    const wildcard = await explainPath(root, ".skillset/rules/apps/[.]/src/testing.md");
    expect(wildcard.renderResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        featureId: "rule-wildcard-scope-pending",
        reason: expect.stringContaining("SET-574"),
        status: "unsupported",
      }),
      // The Agent Instructions baseline renders rules regardless of provider
      // toggles, so it records the gap too.
      expect.objectContaining({
        featureId: "rule-wildcard-scope-pending",
        standardProfile: "agent-instructions",
        status: "unsupported",
      }),
    ]));

    expect(paths).not.toContain("services/payments/AGENTS.override.md");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "codex-agents-override-shadow",
        message: expect.stringContaining("services/payments/AGENTS.override.md shadows generated services/payments/AGENTS.md"),
      }),
    ]));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "rule-scope-path-double-prefix"
    );
  });

  test("Codex shows paths: narrowing as degraded while keeping the whole rule", async () => {
    const root = await authoringModel();
    expect((await buildSkillsetResult(root)).ok).toBe(true);

    expect(await readFile(join(root, "docs/AGENTS.md"), "utf8")).toContain("Keep documentation concrete.");
    const explanation = await explainPath(root, "docs/AGENTS.md");
    expect(explanation.renderResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        featureId: "codex-rule-paths-not-enforceable",
        status: "degraded",
        target: "codex",
      }),
    ]));
    const cursor = await explainPath(root, ".cursor/rules/app/[slug]/routing.mdc");
    expect(cursor.renderResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ featureId: "cursor-rule-glob-escaping-unverified", status: "degraded" }),
    ]));
  });

  test("destinations do not depend on the working tree", async () => {
    const root = await authoringModel();
    const before = (await buildSkillsetResult(root)).data.map((file) => file.path).sort();
    await mkdir(join(root, "docs/extra"), { recursive: true });
    await writeFile(join(root, "docs/extra/unrelated.md"), "# Unrelated\n");
    const after = (await buildSkillsetResult(root)).data.map((file) => file.path).sort();
    expect(after).toEqual(before);
  });

  test("warns on a double-prefixed paths: entry and on a missing scope directory", async () => {
    const root = await authoringModel();
    await mkdir(join(root, ".skillset/rules/services/billing"), { recursive: true });
    await writeFile(
      join(root, ".skillset/rules/services/billing/rules.md"),
      "---\npaths:\n  - services/billing/**/*.ts\n---\n\n# Billing\n\nRound half to even.\n"
    );

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(await exists(join(root, "services/billing/AGENTS.md"))).toBe(true);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "rule-scope-path-double-prefix",
        message: expect.stringContaining("services/billing/**/*.ts repeats its scope directory services/billing"),
      }),
      expect.objectContaining({
        code: "rule-scope-directory-missing",
        message: expect.stringContaining(".skillset/rules/services/billing/rules.md governs services/billing/"),
      }),
    ]));
  });
});
