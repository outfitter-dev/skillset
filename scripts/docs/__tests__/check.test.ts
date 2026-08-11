import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { targetNames } from "../../../packages/core/src";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../test-helpers/git-remote";
import {
  collectDocsDiagnostics,
  checkDocumentation,
  discoverUntrackedDocumentationPaths,
  evaluateDocsBaseline,
  rebaseBaselineIdentities,
  writeDocsBaseline,
} from "../check";
import type { MigrationMap } from "../migrations";

describe("documentation checks", () => {
  test("reports structural, description, link, marker, and reachability failures", async () => {
    const root = await createTestGitFixtureRoot("skillset-docs-check-");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "README.md"),
      "# Root\n\n[Documentation](docs/README.md)\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "README.md"),
      [
        "---",
        "description: Documentation routes.",
        "---",
        "",
        "# Documentation",
        "",
        "[Missing anchor][guide]",
        "[guide]: guide.md#absent",
        "<!-- skillset:generated:start Bad_ID -->",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(root, "docs", "guide.md"),
      "# Guide\n\n## Present\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "orphan.md"),
      "---\ndescription: An orphan.\n---\n\n# Orphan\n",
      "utf8"
    );
    await mkdir(join(root, "docs", "development"), { recursive: true });
    await writeFile(
      join(root, "docs", "development", "README.md"),
      "---\ndescription: Development guidance.\n---\n\n# Development\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "development", "orphan.md"),
      "---\ndescription: An orphaned maintainer page.\n---\n\n# Maintainer Orphan\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );

    const diagnostics = await collectDocsDiagnostics(root, {
      migrationChanges: [],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual(
      expect.arrayContaining([
        "docs/description-required",
        "docs/generated-marker",
        "docs/link-anchor",
        "docs/reachability",
      ])
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.rule === "docs/reachability" &&
          diagnostic.path === "docs/orphan.md"
      )
    ).toBe(true);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.rule === "docs/reachability" &&
          diagnostic.path === "docs/development/orphan.md"
      )
    ).toBe(true);
  });

  test("suppresses dependent findings after malformed frontmatter", async () => {
    const root = await createTestGitFixtureRoot("skillset-docs-syntax-");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Root\n", "utf8");
    await writeFile(
      join(root, "docs", "README.md"),
      "---\ndescription: [\n---\nNo title and [bad](missing.md).\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );

    const diagnostics = await collectDocsDiagnostics(root, {
      migrationChanges: [],
    });
    expect(
      diagnostics.filter((diagnostic) => diagnostic.path === "docs/README.md")
    ).toEqual([expect.objectContaining({ rule: "docs/syntax" })]);
  });

  test("validates canonical provider paths, markers, and authored ids", async () => {
    const root = await createTestGitFixtureRoot("skillset-docs-providers-");
    const providersRoot = join(root, "docs", "reference", "providers");
    await mkdir(providersRoot, { recursive: true });
    await writeFile(join(root, "README.md"), "# Root\n", "utf8");
    await writeFile(
      join(providersRoot, "README.md"),
      providerPage("Provider Reference", "provider-list"),
      "utf8"
    );
    const [mismatched, duplicated, missing] = targetNames();
    if (
      mismatched === undefined ||
      duplicated === undefined ||
      missing === undefined
    )
      throw new Error("expected at least three canonical providers");
    await writeFile(
      join(providersRoot, `${mismatched}.md`),
      providerPage(mismatched, "provider-feature-support", "not-the-provider"),
      "utf8"
    );
    await writeFile(
      join(providersRoot, `${duplicated}.md`),
      providerPage(duplicated, "wrong-provider-marker", duplicated, duplicated),
      "utf8"
    );
    await writeFile(
      join(providersRoot, "unknown.md"),
      providerPage("Unknown", "provider-feature-support", "unknown"),
      "utf8"
    );
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );

    const diagnostics = (
      await collectDocsDiagnostics(root, {
        migrationChanges: [],
      })
    ).filter((diagnostic) => diagnostic.rule === "docs/provider-id");

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `docs/reference/providers/${missing}.md`,
          subject: `missing:docs/reference/providers/${missing}.md`,
        }),
        expect.objectContaining({
          path: `docs/reference/providers/${mismatched}.md`,
          subject: `declaration:mismatch:${mismatched}`,
        }),
        expect.objectContaining({
          path: `docs/reference/providers/${duplicated}.md`,
          subject: `declaration:duplicate:${duplicated}`,
        }),
        expect.objectContaining({
          path: `docs/reference/providers/${duplicated}.md`,
          subject: "marker:provider-feature-support",
        }),
        expect.objectContaining({
          path: "docs/reference/providers/unknown.md",
          subject: "unknown:docs/reference/providers/unknown.md",
        }),
      ])
    );
  });

  test("rejects provider ids hidden outside authored prose", async () => {
    const root = await createTestGitFixtureRoot("skillset-docs-provider-id-");
    const providersRoot = join(root, "docs", "reference", "providers");
    await mkdir(providersRoot, { recursive: true });
    await writeFile(join(root, "README.md"), "# Root\n", "utf8");
    await writeFile(
      join(providersRoot, "README.md"),
      providerPage("Provider Reference", "provider-list"),
      "utf8"
    );
    const [fenced, commented, generated] = targetNames();
    if (
      fenced === undefined ||
      commented === undefined ||
      generated === undefined
    )
      throw new Error("expected at least three canonical providers");
    const hiddenDeclarations = new Map([
      [fenced, `\`\`\`markdown\nProvider id: \`${fenced}\`\n\`\`\``],
      [commented, `<!-- Provider id: \`${commented}\` -->`],
      [generated, `Provider id: \`${generated}\``],
    ]);
    for (const provider of targetNames()) {
      const hidden = hiddenDeclarations.get(provider) ?? "";
      await writeFile(
        join(providersRoot, `${provider}.md`),
        [
          "---",
          `description: ${provider} provider reference.`,
          "---",
          `# ${provider}`,
          "",
          ...(provider === generated ? [] : [hidden, ""]),
          "<!-- skillset:generated:start provider-feature-support -->",
          ...(provider === generated ? [hidden] : ["stale"]),
          "<!-- skillset:generated:end provider-feature-support -->",
          "",
        ].join("\n"),
        "utf8"
      );
    }
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );

    const diagnostics = (
      await collectDocsDiagnostics(root, { migrationChanges: [] })
    ).filter(
      (diagnostic) =>
        diagnostic.rule === "docs/provider-id" &&
        diagnostic.subject.startsWith("declaration:missing:")
    );

    expect(diagnostics.map(({ path }) => path)).toEqual(
      targetNames().map((provider) => `docs/reference/providers/${provider}.md`)
    );
  });

  test("validates anchors from rendered reference-link heading text", async () => {
    const root = await createTestGitFixtureRoot("skillset-docs-ref-heading-");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "README.md"),
      "# Root\n\n[Docs](docs/README.md)\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "README.md"),
      "---\ndescription: Documentation routes.\n---\n\n# Docs\n\n[Target](target.md#full)\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "target.md"),
      "---\ndescription: A target page.\n---\n\n# Target\n\n## [Full][ref]\n\n[ref]: ./elsewhere.md\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "elsewhere.md"),
      "---\ndescription: The reference destination.\n---\n\n# Elsewhere\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );

    const diagnostics = await collectDocsDiagnostics(root, {
      migrationChanges: [],
    });
    expect(
      diagnostics.filter(({ rule }) => rule === "docs/link-anchor")
    ).toEqual([]);
  });

  test("rebases shrink-only debt through one-to-one documented moves", () => {
    const map: MigrationMap = {
      entries: [
        {
          from: "docs/old.md",
          primary: "docs/new.md",
          status: "moved",
          successors: ["docs/new.md"],
        },
      ],
      schemaVersion: 1,
    };
    expect(
      rebaseBaselineIdentities(
        ["docs/description-required|docs/old.md|description"],
        map
      )
    ).toEqual(["docs/description-required|docs/new.md|description"]);

    expect(
      rebaseBaselineIdentities(
        ["docs/description-required|docs/old.md|description"],
        {
          entries: [
            {
              from: "docs/old.md",
              primary: "docs/new.md",
              status: "moved",
              successors: ["docs/new.md", "docs/other.md"],
            },
          ],
          schemaVersion: 1,
        }
      )
    ).toEqual(["docs/description-required|docs/old.md|description"]);
  });

  test("rejects novel diagnostics and stale repaired baseline entries", () => {
    const diagnostic = {
      message: "missing description",
      path: "docs/guide.md",
      rule: "docs/description-required" as const,
      subject: "description",
    };
    expect(
      evaluateDocsBaseline([diagnostic], { diagnostics: [], schemaVersion: 1 })
    ).toMatchObject({ novel: [diagnostic], ok: false, staleBaseline: [] });
    expect(
      evaluateDocsBaseline([], {
        diagnostics: ["docs/description-required|docs/guide.md|description"],
        schemaVersion: 1,
      })
    ).toMatchObject({ novel: [], ok: false });
  });

  test("rejects duplicate or unsorted baseline identities", async () => {
    const root = await createTestGitFixtureRoot(
      "skillset-docs-baseline-shape-"
    );
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Root\n", "utf8");
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );
    await writeFile(
      join(root, "docs", "docs-check-baseline.json"),
      JSON.stringify({ schemaVersion: 1, diagnostics: ["z", "a", "a"] }),
      "utf8"
    );

    await expect(checkDocumentation(root)).rejects.toThrow(
      "baseline diagnostics must be sorted and unique"
    );
  });

  test("refuses to baseline debt from new or newly broken pages", async () => {
    const root = await createTestGitFixtureRoot("skillset-docs-baseline-");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "README.md"),
      "# Root\n\n[Docs](docs/README.md)\n",
      "utf8"
    );
    await writeFile(
      join(root, "docs", "README.md"),
      "---\ndescription: Documentation routes.\n---\n\n# Docs\n\n[New](new.md)\n",
      "utf8"
    );
    await writeFile(join(root, "docs", "new.md"), "# New\n", "utf8");
    await writeFile(
      join(root, "docs", "migration-map.json"),
      '{"schemaVersion":1,"entries":[]}\n',
      "utf8"
    );

    await expect(
      writeDocsBaseline(root, {
        migrationChanges: [],
        untrackedPaths: ["docs/new.md"],
      })
    ).rejects.toThrow("newly added documentation");

    await writeFile(
      join(root, "docs", "docs-check-baseline.json"),
      '{"schemaVersion":1,"diagnostics":[]}\n',
      "utf8"
    );
    await expect(
      writeDocsBaseline(root, {
        migrationChanges: [],
        untrackedPaths: [],
      })
    ).rejects.toThrow("shrink-only docs baseline");
  });

  test("discovers untracked documentation through sanitized Git state", async () => {
    const disposableRoot = await createTestGitFixtureRoot(
      "skillset-docs-untracked-"
    );
    const root = join(disposableRoot, "work");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Root\n", "utf8");
    await initializeTestGitRepository(root, { disposableRoot });
    await writeFile(join(root, "docs", "untracked.md"), "# New\n", "utf8");
    await writeFile(join(root, ".changeset.md"), "# Not docs\n", "utf8");

    expect(await discoverUntrackedDocumentationPaths(root)).toEqual([
      "docs/untracked.md",
    ]);
  });
});

function providerPage(
  title: string,
  marker: string,
  ...ids: readonly string[]
): string {
  return [
    "---",
    `description: ${title} provider reference.`,
    "---",
    `# ${title}`,
    "",
    ...ids.map((id) => `Provider id: \`${id}\``),
    ...(ids.length === 0 ? [] : [""]),
    `<!-- skillset:generated:start ${marker} -->`,
    "stale",
    `<!-- skillset:generated:end ${marker} -->`,
    "",
  ].join("\n");
}
