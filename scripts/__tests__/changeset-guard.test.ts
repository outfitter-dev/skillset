import { describe, expect, test } from "bun:test";

import {
  evaluateChangesetGuard,
  isActiveChangesetEntry,
  isPackageAffectingPath,
  parseChangedFileLine,
} from "../../apps/skillset/src/changeset-awareness";

describe("changeset guard", () => {
  test("requires an active changeset for published package payload changes", () => {
    const result = evaluateChangesetGuard([
      { path: "apps/skillset/src/cli.ts", status: "M" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.packageFiles.map((file) => file.path)).toEqual(["apps/skillset/src/cli.ts"]);
    expect(result.diagnostics[0]).toContain("Package-facing changes require a .changeset/*.md entry");
  });

  test("passes package payload changes with an active changeset", () => {
    const result = evaluateChangesetGuard([
      { path: "packages/core/src/build.ts", status: "M" },
      { path: ".changeset/runtime-build.md", status: "A" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("blocks active changesets when only repo machinery changed", () => {
    const result = evaluateChangesetGuard([
      { path: ".github/workflows/release.yml", status: "M" },
      { path: "docs/package-releases.md", status: "M" },
      { path: "scripts/release-policy.ts", status: "M" },
      { path: ".changeset/release-policy.md", status: "A" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.packageFiles).toEqual([]);
    expect(result.diagnostics[0]).toContain("Changeset entries are only for published package payload changes");
  });

  test("allows correcting existing active changeset metadata", () => {
    const result = evaluateChangesetGuard([{ path: ".changeset/release-plan.md", status: "M" }]);

    expect(result.ok).toBe(true);
    expect(result.packageFiles).toEqual([]);
    expect(result.changesetFiles.map((file) => file.path)).toEqual([".changeset/release-plan.md"]);
  });

  test("passes repo-only changes without a changeset", () => {
    const result = evaluateChangesetGuard([
      { path: ".github/workflows/release.yml", status: "M" },
      { path: "docs/package-releases.md", status: "M" },
      { path: "scripts/release-policy.ts", status: "M" },
    ]);

    expect(result.ok).toBe(true);
  });

  test("does not treat tests as package payload changes", () => {
    expect(isPackageAffectingPath("apps/skillset/src/__tests__/skillset.test.ts")).toBe(false);
    expect(isPackageAffectingPath("packages/core/src/__tests__/build-result.test.ts")).toBe(false);
    expect(isPackageAffectingPath("packages/lint/src/rules/name-directory.ts")).toBe(true);
  });

  test("requires release intent for provider and schema contract changes", () => {
    expect(isPackageAffectingPath("packages/provider-formats/src/schema-snapshots.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/provider-formats/src/migrations.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/provider-formats/src/__tests__/snapshots.test.ts")).toBe(false);
    expect(isPackageAffectingPath("packages/schema/src/contracts.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/schema/src/validate.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/schema/src/__tests__/schema.test.ts")).toBe(false);
    expect(isPackageAffectingPath("docs/reference/schemas/0.1.0/skillset.schema.json")).toBe(false);
    expect(isPackageAffectingPath("docs/reference/examples/skill-frontmatter.yaml")).toBe(false);
  });

  test("ignores deleted changesets so cleanup branches can remove mistakes", () => {
    expect(isActiveChangesetEntry({ path: ".changeset/old.md", status: "D" })).toBe(false);
    expect(isActiveChangesetEntry({ path: ".changeset/new.md", status: "A" })).toBe(true);

    const result = evaluateChangesetGuard([
      { path: ".changeset/old.md", status: "D" },
      { path: "docs/package-releases.md", status: "M" },
    ]);
    expect(result.ok).toBe(true);
  });

  test("parses both name-status and path-only changed file lines", () => {
    expect(parseChangedFileLine("M\tapps/skillset/src/cli.ts")).toEqual({
      path: "apps/skillset/src/cli.ts",
      status: "M",
    });
    expect(parseChangedFileLine("modified\tpackages/core/src/build.ts")).toEqual({
      path: "packages/core/src/build.ts",
      status: "modified",
    });
    expect(parseChangedFileLine("R100\tpackages/core/src/old.ts\tpackages/core/src/new.ts")).toEqual({
      path: "packages/core/src/new.ts",
      status: "R100",
    });
    expect(parseChangedFileLine("docs/package-releases.md")).toEqual({
      path: "docs/package-releases.md",
    });
    expect(parseChangedFileLine("")).toBeUndefined();
  });
});
