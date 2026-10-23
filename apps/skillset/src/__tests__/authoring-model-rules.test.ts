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

  test("rejects paths: entries that leave the rule's scope", async () => {
    const root = await authoringModel();
    await writeFile(
      join(root, ".skillset/rules/docs/escape.md"),
      "---\npaths:\n  - ../src/**\n---\n\n# Escape\n"
    );
    await expect(buildSkillsetResult(root)).rejects.toThrow("leaves the rule's scope");
  });

  test("escapes glob characters in a literal scope and refuses scopes inside the source root", async () => {
    const root = await authoringModel();
    await mkdir(join(root, ".skillset/rules/team*"), { recursive: true });
    await writeFile(join(root, ".skillset/rules/team*/notes.md"), "# Team notes\n");
    await buildSkillsetResult(root);
    expect(await readFile(join(root, ".claude/rules/team*/notes.md"), "utf8")).toStartWith(
      "---\npaths:\n  - team\\*/**\n---\n"
    );

    const nested = await authoringModel();
    await mkdir(join(nested, ".skillset/rules/.skillset/rules"), { recursive: true });
    await writeFile(join(nested, ".skillset/rules/.skillset/rules/guidance.md"), "# Guidance\n");
    await expect(buildSkillsetResult(nested)).rejects.toThrow("rules cannot scope to Skillset source");
  });

  test("wraps combined or narrowed contributions in XML sections [SET-583]", async () => {
    const root = await authoringModel();
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const header = "<!-- Generated by skillset@0.1.0 from .skillset/rules. Do not edit directly. -->";

    expect(await readFile(join(root, "engineering/AGENTS.md"), "utf8")).toBe([
      header,
      "",
      "<coding_guidance",
      '  source=".skillset/rules/engineering/coding-guidance.md"',
      '  applies_to="engineering/**" >',
      "",
      "# Coding guidance",
      "",
      "Prefer small, typed functions.",
      "",
      "## Code Review Rules",
      "",
      "Flag untyped exports.",
      "",
      "</coding_guidance>",
      "",
      "<typescript",
      '  source=".skillset/rules/engineering/typescript.md"',
      '  applies_to="engineering/**/*.ts" >',
      "",
      "# TypeScript",
      "",
      "Use strict mode.",
      "",
      "## Code Review Rules",
      "",
      "Flag `any`.",
      "",
      "</typescript>",
      "",
    ].join("\n"));

    // A sole contributor is wrapped only when its paths: would otherwise be lost.
    expect(await readFile(join(root, "docs/AGENTS.md"), "utf8")).toBe([
      header,
      "",
      "<writing",
      '  source=".skillset/rules/docs/writing.md"',
      '  applies_to="docs/*.md, docs/guides/**/*.md" >',
      "",
      "# Writing",
      "",
      "Keep documentation concrete.",
      "",
      "</writing>",
      "",
    ].join("\n"));
    expect(await readFile(join(root, "app/[slug]/AGENTS.md"), "utf8")).toBe(
      `${header}\n\n# Routing\n\nPreserve literal route names.\n`
    );

    // The RULES.md front page leads bare; every rule after it is wrapped.
    const rootAgents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(rootAgents).toStartWith("# Authoring model\n\nKeep source ownership explicit.\n\n<testing\n");
    expect(rootAgents).toContain('  applies_to="**" >');

    for (const file of result.data) {
      const text = new TextDecoder().decode(file.content);
      expect(text).not.toContain("<!-- source:");
      expect(text).not.toMatch(/applies_to="[^"]*(?:\[\.\]|\[\.\.\.\]|`)/u);
    }
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "codex-code-review-rules-duplicate",
        message: expect.stringContaining(
          ".skillset/rules/engineering/coding-guidance.md, .skillset/rules/engineering/typescript.md"
        ),
      }),
    ]));
  });

  test("escapes section attributes and reads review headings from rendered output [SET-583]", async () => {
    const root = await authoringModel();
    await mkdir(join(root, ".skillset/rules/r&d"), { recursive: true });
    await mkdir(join(root, ".skillset/shared/partials"), { recursive: true });
    await mkdir(join(root, "r&d"), { recursive: true });
    await writeFile(join(root, "r&d/notes.md"), "Notes.\n");
    await writeFile(join(root, ".skillset/shared/partials/review.md"), "## Code Review Rules\n\nCheck the math.\n");
    await writeFile(join(root, ".skillset/rules/r&d/checks.md"), "# Checks\n\n{{> review}}\n");
    await writeFile(
      join(root, ".skillset/rules/r&d/fenced.md"),
      "# Fenced\n\n```markdown\n## Code Review Rules\n```\n"
    );
    await writeFile(join(root, ".skillset/rules/r&d/review.md"), "# Review\n\n## Code Review Rules ##\n\nKeep units.\n");

    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const agents = await readFile(join(root, "r&d/AGENTS.md"), "utf8");
    expect(agents).toContain('  source=".skillset/rules/r&amp;d/checks.md"\n  applies_to="r&amp;d/**" >');
    const warnings = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "codex-code-review-rules-duplicate" && diagnostic.outputPath === "r&d/AGENTS.md"
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(".skillset/rules/r&d/checks.md, .skillset/rules/r&d/review.md;");
    expect(warnings[0]?.message).not.toContain("fenced.md");
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
