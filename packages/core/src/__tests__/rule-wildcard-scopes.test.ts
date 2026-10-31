import { expect, test } from "bun:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { explainPath } from "../authoring";
import {
  buildSkillsetResult,
  diffSkillsetResult,
  verifySkillsetResult,
} from "../build";
import { loadBuildGraph } from "../resolver";
import { parseMarkdown } from "../yaml";

async function fixture(
  rules: Record<string, string>,
  directories: readonly string[],
  targets = ["claude", "codex", "cursor"]
) {
  const root = await createTestFixtureRoot("rule-wildcard-");
  await mkdir(join(root, ".skillset/rules"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    `compile:\n  targets: ${JSON.stringify(targets)}\n`
  );
  for (const directory of directories)
    await mkdir(join(root, directory), { recursive: true });
  for (const [path, body] of Object.entries(rules)) {
    const target = join(root, ".skillset/rules", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, body);
  }
  return root;
}
const agents = (result: Awaited<ReturnType<typeof buildSkillsetResult>>) =>
  result.data
    .map((file) => file.path)
    .filter((path) => path === "AGENTS.md" || path.endsWith("/AGENTS.md"))
    .sort();

test("one-level scope yields concrete instructions and one mirrored rule per glob provider", async () => {
  const root = await fixture({ "apps/[.]/src/testing.md": "App testing." }, [
    "apps/web/src",
    "apps/api/src",
    "apps/deep/nested/src",
  ]);
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(agents(result)).toEqual([
    "apps/api/src/AGENTS.md",
    "apps/web/src/AGENTS.md",
  ]);
  const claude = parseMarkdown(
    await readFile(join(root, ".claude/rules/apps/[.]/src/testing.md"), "utf8"),
    "Claude rule"
  );
  expect(claude.frontmatter.paths).toEqual(["apps/*/src/**"]);
  const cursor = parseMarkdown(
    await readFile(
      join(root, ".cursor/rules/apps/[.]/src/testing.mdc"),
      "utf8"
    ),
    "Cursor rule"
  );
  expect(cursor.frontmatter.globs).toEqual(["apps/*/src/**"]);
  expect(
    result.renderResults.some(
      (item) => item.featureId === "cursor-rule-glob-escaping-unverified"
    )
  ).toBe(false);
  const explanation = await explainPath(
    root,
    ".skillset/rules/apps/[.]/src/testing.md"
  );
  expect(
    explanation.renderResults
      .find(
        (item) =>
          item.featureId === "rule-wildcard-scope-expanded" &&
          item.target === "codex"
      )
      ?.outputs?.map((item) => item.path)
  ).toEqual(agents(result));
  const first = new Map(
    result.data.map((file) => [
      file.path,
      Buffer.from(file.content).toString("hex"),
    ])
  );
  await mkdir(join(root, "unrelated/area"), { recursive: true });
  const second = await buildSkillsetResult(root);
  expect(
    new Map(
      second.data.map((file) => [
        file.path,
        Buffer.from(file.content).toString("hex"),
      ])
    )
  ).toEqual(first);
});

test("any-depth includes zero levels, deduplicates multiple routes and skips protected/symlink trees", async () => {
  const root = await fixture(
    { "[...]/[...]/packages/core/testing.md": "Core testing." },
    [
      "packages/core",
      "nested/packages/core",
      ".hidden/packages/core",
      "node_modules/pkg/packages/core",
      "plugins/demo/packages/core",
      ".skillset/packages/core",
    ]
  );
  await symlink(
    join(root, "nested"),
    join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(agents(result)).toEqual([
    "nested/packages/core/AGENTS.md",
    "packages/core/AGENTS.md",
  ]);
});

test("zero matches warns and writes no instructions while provider globs remain future-facing", async () => {
  const root = await fixture(
    { "apps/[.]/src/testing.md": "Future testing." },
    []
  );
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(agents(result)).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "rule-wildcard-scope-no-match",
      severity: "warning",
    })
  );
  expect(
    result.data.some(
      (file) => file.path === ".claude/rules/apps/[.]/src/testing.md"
    )
  ).toBe(true);
  expect(await Bun.file(join(root, "AGENTS.md")).exists()).toBe(false);
});

test("literal punctuation and explicit zero-depth root matches keep their semantics", async () => {
  const root = await fixture(
    {
      "apps/[.]/[slug]/routing.md": "Routes.",
      "[...]/root.md": "Every existing directory.",
    },
    ["apps/web/[slug]"],
    ["codex"]
  );
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(agents(result)).toContain("AGENTS.md");
  expect(agents(result)).toContain("apps/web/[slug]/AGENTS.md");
  expect(agents(result).some((path) => path.startsWith(".skillset/"))).toBe(
    false
  );
});

test("concrete scope drives applies_to and links while source provenance stays authored", async () => {
  const root = await fixture(
    {
      "apps/[.]/src/testing.md": "---\npaths: ['*.ts']\n---\n[Guide](guide.md)",
      "apps/[.]/src/style.md": "Style.",
    },
    ["apps/web/src"],
    ["codex"]
  );
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  const content = await readFile(join(root, "apps/web/src/AGENTS.md"), "utf8");
  expect(content).toContain('applies_to="apps/web/src/*.ts"');
  expect(content).toContain('source=".skillset/rules/apps/[.]/src/testing.md"');
  expect(content).toContain("[Guide](guide.md)");
  expect(content).not.toContain('applies_to="apps/[.]');
});

test("single provider glob refuses an ambiguous scope-relative link", async () => {
  const root = await fixture(
    { "apps/[.]/src/testing.md": "[Guide](guide.md)" },
    ["apps/web/src", "apps/api/src"]
  );
  await expect(buildSkillsetResult(root)).rejects.toMatchObject({
    renderResults: expect.arrayContaining([
      expect.objectContaining({
        featureId: "rule-wildcard-relative-link",
        status: "unsupported",
        target: "claude",
      }),
    ]),
  });
});

test("graph owns one sorted scope snapshot that refreshes on the next load", async () => {
  const root = await fixture({ "apps/[.]/src/testing.md": "Testing." }, [
    "apps/web/src",
  ]);
  const first = await loadBuildGraph(root);
  expect(first.rules[0]?.expandedScopes).toEqual(["apps/web/src"]);
  await mkdir(join(root, "apps/api/src"), { recursive: true });
  expect(first.rules[0]?.expandedScopes).toEqual(["apps/web/src"]);
  expect((await loadBuildGraph(root)).rules[0]?.expandedScopes).toEqual([
    "apps/api/src",
    "apps/web/src",
  ]);
});

test("included partial links are refused but code, URLs and fragments remain unchanged", async () => {
  const root = await fixture({ "apps/[.]/testing.md": "{{> links}}" }, [
    "apps/web",
  ]);
  await mkdir(join(root, ".skillset/shared/partials"), { recursive: true });
  await writeFile(
    join(root, ".skillset/shared/partials/links.md"),
    "[Guide](guide.md)"
  );
  await expect(buildSkillsetResult(root)).rejects.toMatchObject({
    renderResults: expect.arrayContaining([
      expect.objectContaining({ featureId: "rule-wildcard-relative-link" }),
    ]),
  });
  await writeFile(
    join(root, ".skillset/shared/partials/links.md"),
    "`[Example](guide.md)`\n[Web](https://example.com)\n[Anchor](#details)"
  );
  expect((await buildSkillsetResult(root)).ok).toBe(true);
});

test("custom generated roots and source trees are excluded without excluding similar names", async () => {
  const root = await fixture(
    { "[...]/testing.md": "Test." },
    ["provider-output/nested", "provider-output-extra/nested"],
    ["cursor"]
  );
  await writeFile(
    join(root, "skillset.yaml"),
    "compile:\n  targets: [cursor]\ncursor:\n  projectRoot: provider-output\n"
  );
  const graph = await loadBuildGraph(root);
  expect(graph.rules[0]?.expandedScopes).toContain(
    "provider-output-extra/nested"
  );
  expect(
    graph.rules[0]?.expandedScopes?.some(
      (path) =>
        path === "provider-output" || path.startsWith("provider-output/")
    )
  ).toBe(false);
});

test("standards-only projections refresh additions and removals through normal drift ownership", async () => {
  const root = await fixture(
    { "apps/[.]/src/testing.md": "Testing." },
    ["apps/web/src"],
    []
  );
  expect(agents(await buildSkillsetResult(root))).toEqual([
    "apps/web/src/AGENTS.md",
  ]);
  await mkdir(join(root, "apps/api/src"), { recursive: true });
  expect((await diffSkillsetResult(root)).data.added).toContain(
    "apps/api/src/AGENTS.md"
  );
  expect(agents(await buildSkillsetResult(root))).toEqual([
    "apps/api/src/AGENTS.md",
    "apps/web/src/AGENTS.md",
  ]);
  await rm(join(root, "apps/web"), { recursive: true });
  // The directory and output are already gone; the next build retires lock ownership.
  expect(agents(await buildSkillsetResult(root))).toEqual([
    "apps/api/src/AGENTS.md",
  ]);
  expect(await readFile(join(root, "skillset.lock"), "utf8")).not.toContain(
    "apps/web/src/AGENTS.md"
  );
  expect((await verifySkillsetResult(root)).ok).toBe(true);
});

test("outside links and cycles never contribute directories", async () => {
  const root = await fixture(
    { "[...]/src/testing.md": "Testing." },
    ["apps/web/src"],
    ["codex"]
  );
  const outside = await createTestFixtureRoot("rule-wildcard-outside-");
  await mkdir(join(outside, "src"));
  const type = process.platform === "win32" ? "junction" : "dir";
  await symlink(outside, join(root, "outside"), type);
  await symlink(root, join(root, "apps/web/cycle"), type);
  expect(agents(await buildSkillsetResult(root))).toEqual([
    "apps/web/src/AGENTS.md",
  ]);
});
