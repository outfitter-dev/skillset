import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkFeatureRegistryDrift,
  getSkillsetFeature,
  listSkillsetFeatures,
  renderFeatureSupportMatrix,
  type SkillsetFeatureEntry,
  type SkillsetFeatureEvidence,
  targetNames,
  targetRecord,
} from "@skillset/core";

describe("feature registry drift checks", () => {
  it("keeps the shipped registry docs, owners, and evidence refs resolvable", async () => {
    const report = await checkFeatureRegistryDrift(process.cwd());

    expect(report.issues).toEqual([]);
    expect(report.checkedFeatures).toBe(listSkillsetFeatures().length);
    expect(report.ok).toBe(true);
  });

  it("reports implemented features with no entry evidence", async () => {
    const root = await fixture({
      "docs/features/demo.md": "# Demo\n",
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, [
      feature({
        docs: ["docs/features/demo.md"],
        evidence: [],
        id: "demo",
        renderOwner: "src/demo.ts",
        validationOwner: "src/demo.ts",
      }),
    ]);

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({
      code: "missing-evidence",
      featureId: "demo",
      field: "evidence",
      message: "implemented feature demo requires at least one evidence ref",
    });
  });

  it("reports missing docs with the entry and field", async () => {
    const root = await fixture({
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, [
      feature({
        docs: ["docs/features/missing.md"],
        id: "demo",
        renderOwner: "src/demo.ts",
        validationOwner: "src/demo.ts",
      }),
    ]);

    expect(report.issues).toContainEqual({
      code: "missing-doc-ref",
      featureId: "demo",
      field: "docs[0]",
      message: "demo docs[0] points to missing doc ref docs/features/missing.md",
      ref: "docs/features/missing.md",
    });
  });

  it("reports refs that only differ by path casing", async () => {
    const root = await fixture({
      "docs/features/Demo.md": "# Demo\n",
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, [
      feature({
        docs: ["docs/features/demo.md"],
        id: "demo",
        renderOwner: "src/demo.ts",
        validationOwner: "src/demo.ts",
      }),
    ]);

    expect(report.issues).toContainEqual({
      code: "missing-doc-ref",
      featureId: "demo",
      field: "docs[0]",
      message: "demo docs[0] points to missing doc ref docs/features/demo.md",
      ref: "docs/features/demo.md",
    });
  });

  it("reports missing markdown fragments and accepts existing heading fragments", async () => {
    const root = await fixture({
      "docs/features/demo.md": "# Demo\n\n## Existing Heading!\n\n## Existing Heading!\n",
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, [
      feature({
        docs: [
          "docs/features/demo.md#existing-heading",
          "docs/features/demo.md#existing-heading-1",
          "docs/features/demo.md#missing-heading",
        ],
        id: "demo",
        renderOwner: "src/demo.ts",
        validationOwner: "src/demo.ts",
      }),
    ]);

    expect(report.issues).toContainEqual({
      code: "missing-ref-fragment",
      featureId: "demo",
      field: "docs[2]",
      message: "demo docs[2] points to missing doc ref fragment docs/features/demo.md#missing-heading",
      ref: "docs/features/demo.md#missing-heading",
    });
    expect(report.issues.filter((issue) => issue.code === "missing-ref-fragment")).toHaveLength(1);
  });

  it("reports local refs that escape the checked root", async () => {
    const root = await fixture({
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });
    await Bun.write(join(root, "../outside-registry-ref.txt"), "outside\n");

    const report = await checkFeatureRegistryDrift(root, [
      feature({
        docs: ["../outside-registry-ref.txt"],
        id: "demo",
        renderOwner: "src/demo.ts",
        validationOwner: "src/demo.ts",
      }),
    ]);

    expect(report.issues).toContainEqual({
      code: "outside-root-ref",
      featureId: "demo",
      field: "docs[0]",
      message: "demo docs[0] points outside root with doc ref ../outside-registry-ref.txt",
      ref: "../outside-registry-ref.txt",
    });
  });

  it("reports missing fixture and test evidence refs", async () => {
    const registry = [
      feature({
        docs: ["docs/features/demo.md"],
        evidence: [
          { kind: "fixture", ref: "fixtures/missing" },
          { kind: "test", ref: "tests/missing.test.ts" },
        ],
        id: "demo",
        renderOwner: "src/demo.ts",
        validationOwner: "src/demo.ts",
      }),
    ];
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${renderFeatureSupportMatrix(registry)}\n`,
      "src/demo.ts": "export {};\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues.map((issue) => `${issue.field}:${issue.ref}`)).toEqual([
      "evidence[0]:fixtures/missing",
      "evidence[1]:tests/missing.test.ts",
      "targetSupport.claude.evidence[0]:fixtures/missing",
      "targetSupport.claude.evidence[1]:tests/missing.test.ts",
      "targetSupport.codex.evidence[0]:fixtures/missing",
      "targetSupport.codex.evidence[1]:tests/missing.test.ts",
      "targetSupport.cursor.evidence[0]:fixtures/missing",
      "targetSupport.cursor.evidence[1]:tests/missing.test.ts",
    ]);
  });

  it("ignores future owner sentinels and external evidence refs", async () => {
    const registry = [
      feature({
        docs: ["docs/features/demo.md"],
        evidence: [
          { kind: "external-docs", ref: "https://example.com/docs", verifiedAt: "2026-06-14" },
        ],
        id: "demo",
        renderOwner: "future",
        status: "planned",
        validationOwner: "future",
      }),
    ];
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${renderFeatureSupportMatrix(registry)}\n`,
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report).toEqual({
      checkedFeatures: 1,
      issues: [],
      ok: true,
    });
  });

  it("renders feature status and every canonical target status without a target subset", () => {
    const entry = feature({
      id: "demo",
      targetSupport: targetRecord((target) => ({
        status: target === "cursor" ? "pass_through" : "native",
      })),
    });

    const matrix = renderFeatureSupportMatrix([entry]);
    const header = `| Feature | Feature status | ${targetNames().join(" | ")} |`;

    expect(matrix).toBe([
      "<!-- skillset:feature-support:start -->",
      header,
      `| ${["Feature", "Feature status", ...targetNames()].map(() => "---").join(" | ")} |`,
      "| `demo` | `implemented` | `native` | `native` | `pass_through` |",
      "<!-- skillset:feature-support:end -->",
    ].join("\n"));
  });

  it("groups every registry entry that owns the same doc and ignores surrounding prose", async () => {
    const registry = [
      feature({ id: "alpha" }),
      feature({ id: "beta" }),
    ];
    const root = await fixture({
      "docs/features/demo.md": [
        "# Demo",
        "",
        "Narrative before the checked matrix.",
        "",
        renderFeatureSupportMatrix(registry),
        "",
        "Narrative after the checked matrix remains human-owned.",
        "",
      ].join("\n"),
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toEqual([]);
  });

  it("reports a wrong target value with the feature, target, field, expected, and actual value", async () => {
    const registry = [feature({ id: "demo" })];
    const matrix = renderFeatureSupportMatrix(registry).replace(
      "| `demo` | `implemented` | `native` | `native` | `native` |",
      "| `demo` | `implemented` | `native` | `native` | `metadata_only` |"
    );
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "metadata_only",
      code: "feature-support-table-drift",
      expected: "native",
      featureId: "demo",
      field: "targetSupport.cursor.status",
      message: "demo cursor targetSupport.cursor.status expected native but found metadata_only",
      ref: "docs/features/demo.md",
      target: "cursor",
    });
  });

  it("reports a missing target column as a missing exact target-support field", async () => {
    const registry = [feature({ id: "demo" })];
    const matrix = renderFeatureSupportMatrix(registry)
      .replace(" | cursor |", " |")
      .replace(" | `native` |\n<!-- skillset:feature-support:end -->", " |\n<!-- skillset:feature-support:end -->");
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "missing",
      code: "feature-support-table-drift",
      expected: "native",
      featureId: "demo",
      field: "targetSupport.cursor.status",
      message: "demo cursor targetSupport.cursor.status expected native but found missing",
      ref: "docs/features/demo.md",
      target: "cursor",
    });
  });

  it("rejects non-registry fields inside the bounded matrix", async () => {
    const registry = [feature({ id: "demo" })];
    const matrix = renderFeatureSupportMatrix(registry)
      .replace("| Feature | Feature status | claude", "| Feature | Feature status | Reason | claude")
      .replace("| --- | --- | ---", "| --- | --- | --- | ---")
      .replace("| `demo` | `implemented` | `native`", "| `demo` | `implemented` | authored note | `native`");
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "Feature, Feature status, Reason, claude, codex, cursor",
      code: "feature-support-table-drift",
      expected: "Feature, Feature status, claude, codex, cursor",
      featureId: "demo",
      field: "matrix.columns",
      message: "demo claude matrix.columns expected Feature, Feature status, claude, codex, cursor but found Feature, Feature status, Reason, claude, codex, cursor",
      ref: "docs/features/demo.md",
      target: "claude",
    });
  });

  it("rejects a stale duplicate feature row instead of collapsing it by id", async () => {
    const registry = [feature({ id: "demo" })];
    const row = "| `demo` | `implemented` | `native` | `native` | `native` |";
    const staleRow = "| `demo` | `implemented` | `native` | `native` | `metadata_only` |";
    const matrix = renderFeatureSupportMatrix(registry).replace(row, `${row}\n${staleRow}`);
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "demo, demo",
      code: "feature-support-table-drift",
      expected: "demo",
      featureId: "demo",
      field: "matrix.rows",
      message: "demo claude matrix.rows expected demo but found demo, demo",
      ref: "docs/features/demo.md",
      target: "claude",
    });
  });

  it.each([
    ["blank row", "|  | `implemented` | `native` | `native` | `native` |"],
    ["short row", "| `demo` | `implemented` |"],
    ["non-table row", "unexpected content"],
  ])("rejects a %s inside the bounded matrix", async (_case, extraRow) => {
    const registry = [feature({ id: "demo" })];
    const row = "| `demo` | `implemented` | `native` | `native` | `native` |";
    const matrix = renderFeatureSupportMatrix(registry).replace(row, `${row}\n${extraRow}`);
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "missing",
      code: "feature-support-table-drift",
      expected: "native",
      featureId: "demo",
      field: "targetSupport.cursor.status",
      message: "demo cursor targetSupport.cursor.status expected native but found missing",
      ref: "docs/features/demo.md",
      target: "cursor",
    });
  });

  it("rejects a malformed separator inside the bounded matrix", async () => {
    const registry = [feature({ id: "demo" })];
    const matrix = renderFeatureSupportMatrix(registry).replace(
      "| --- | --- | --- | --- | --- |",
      "| --- | --- | --- | invalid | --- |"
    );
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "missing",
      code: "feature-support-table-drift",
      expected: "native",
      featureId: "demo",
      field: "targetSupport.cursor.status",
      message: "demo cursor targetSupport.cursor.status expected native but found missing",
      ref: "docs/features/demo.md",
      target: "cursor",
    });
  });

  it("rejects feature rows that do not follow deterministic registry order", async () => {
    const registry = [feature({ id: "alpha" }), feature({ id: "beta" })];
    const alpha = "| `alpha` | `implemented` | `native` | `native` | `native` |";
    const beta = "| `beta` | `implemented` | `native` | `native` | `native` |";
    const matrix = renderFeatureSupportMatrix(registry).replace(
      `${alpha}\n${beta}`,
      `${beta}\n${alpha}`
    );
    const root = await fixture({
      "docs/features/demo.md": `# Demo\n\n${matrix}\n`,
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "beta, alpha",
      code: "feature-support-table-drift",
      expected: "alpha, beta",
      featureId: "alpha",
      field: "matrix.rows",
      message: "alpha claude matrix.rows expected alpha, beta but found beta, alpha",
      ref: "docs/features/demo.md",
      target: "claude",
    });
  });

  it("requires a checked matrix for every registry-linked feature doc", async () => {
    const registry = [feature({ id: "demo" })];
    const root = await fixture({
      "docs/features/demo.md": "# Demo\n\nHuman-owned prose only.\n",
      "src/demo.ts": "export {};\n",
      "tests/demo.test.ts": "test('demo', () => {});\n",
    });

    const report = await checkFeatureRegistryDrift(root, registry);

    expect(report.issues).toContainEqual({
      actual: "missing",
      code: "feature-support-table-drift",
      expected: "native",
      featureId: "demo",
      field: "targetSupport.cursor.status",
      message: "demo cursor targetSupport.cursor.status expected native but found missing",
      ref: "docs/features/demo.md",
      target: "cursor",
    });
  });

  it("derives the shipped Cursor provider-source support from the registry", async () => {
    const providerSource = getSkillsetFeature("target-native-islands");
    expect(providerSource).toBeDefined();
    if (providerSource === undefined) throw new Error("missing target-native-islands fixture");

    const matrix = renderFeatureSupportMatrix([providerSource]);

    expect(providerSource.targetSupport.cursor.status).toBe("pass_through");
    expect(matrix).toContain("| `target-native-islands` | `implemented` | `pass_through` | `pass_through` | `pass_through` |");
  });
});

function feature(
  overrides: Partial<SkillsetFeatureEntry> & { readonly id: string }
): SkillsetFeatureEntry {
  const defaultEvidence: readonly SkillsetFeatureEvidence[] = [
    { kind: "test", ref: "tests/demo.test.ts" },
  ];
  const evidence = overrides.evidence ?? defaultEvidence;
  return {
    docs: overrides.docs ?? ["docs/features/demo.md"],
    evidence,
    id: overrides.id,
    kind: overrides.kind ?? "source",
    renderOwner: overrides.renderOwner ?? "src/demo.ts",
    sourceShape: overrides.sourceShape ?? ".skillset/demo",
    status: overrides.status ?? "implemented",
    summary: overrides.summary ?? "Demo feature.",
    targetSupport: overrides.targetSupport ?? targetRecord(() => ({ evidence, status: "native" })),
    title: overrides.title ?? "Demo",
    validationOwner: overrides.validationOwner ?? "src/demo.ts",
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-feature-registry-check-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), content);
  }
  return root;
}
