import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkFeatureRegistryDrift,
  listSkillsetFeatures,
  type SkillsetFeatureEntry,
  type SkillsetFeatureEvidence,
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
    const root = await fixture({
      "docs/features/demo.md": "# Demo\n",
      "src/demo.ts": "export {};\n",
    });

    const report = await checkFeatureRegistryDrift(root, [
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
    ]);

    expect(report.issues.map((issue) => `${issue.field}:${issue.ref}`)).toEqual([
      "evidence[0]:fixtures/missing",
      "evidence[1]:tests/missing.test.ts",
      "targetSupport.claude.evidence[0]:fixtures/missing",
      "targetSupport.claude.evidence[1]:tests/missing.test.ts",
      "targetSupport.codex.evidence[0]:fixtures/missing",
      "targetSupport.codex.evidence[1]:tests/missing.test.ts",
    ]);
  });

  it("ignores future owner sentinels and external evidence refs", async () => {
    const root = await fixture({
      "docs/features/demo.md": "# Demo\n",
    });

    const report = await checkFeatureRegistryDrift(root, [
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
    ]);

    expect(report).toEqual({
      checkedFeatures: 1,
      issues: [],
      ok: true,
    });
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
    targetSupport: overrides.targetSupport ?? {
      claude: { evidence, status: "native" },
      codex: { evidence, status: "native" },
    },
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
