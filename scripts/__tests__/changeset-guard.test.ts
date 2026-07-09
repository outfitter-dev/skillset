import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateChangesetGuard,
  findMixedChangesetReleaseEntries,
  isActiveChangesetEntry,
  isPackageAffectingPath,
  parseChangedFileLine,
} from "../../apps/skillset/src/changeset-awareness";
import { runChangesetGuard } from "../changeset-guard";

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

  test("reports changesets that mix published and ignored private packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-changeset-guard-"));
    try {
      await mkdir(join(root, "apps/skillset"), { recursive: true });
      await mkdir(join(root, "packages/schema"), { recursive: true });
      await mkdir(join(root, ".changeset"), { recursive: true });
      await writeFile(join(root, "apps/skillset/package.json"), JSON.stringify({ name: "skillset" }));
      await writeFile(
        join(root, "packages/schema/package.json"),
        JSON.stringify({ name: "@skillset/schema", private: true })
      );
      await writeFile(
        join(root, ".changeset/config.json"),
        JSON.stringify({ ignore: [], privatePackages: { version: false } })
      );
      await writeFile(
        join(root, ".changeset/mixed.md"),
        '---\n"@skillset/schema": patch\n"skillset": patch\n---\n\nRelease both.\n'
      );

      await expect(findMixedChangesetReleaseEntries(root)).resolves.toEqual([
        {
          changesetPath: ".changeset/mixed.md",
          ignoredPackages: ["@skillset/schema"],
          publishedPackages: ["skillset"],
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("command rejects mixed release entries with an actionable diagnostic", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-changeset-command-"));
    try {
      await mkdir(join(root, "apps/skillset/src"), { recursive: true });
      await mkdir(join(root, "packages/schema"), { recursive: true });
      await mkdir(join(root, ".changeset"), { recursive: true });
      await writeFile(join(root, "apps/skillset/package.json"), JSON.stringify({ name: "skillset" }));
      await writeFile(
        join(root, "packages/schema/package.json"),
        JSON.stringify({ name: "@skillset/schema", private: true })
      );
      await writeFile(
        join(root, ".changeset/config.json"),
        JSON.stringify({ ignore: [], privatePackages: { version: false } })
      );
      await writeFile(
        join(root, ".changeset/mixed.md"),
        '---\n"@skillset/schema": patch\n"skillset": patch\n---\n\nRelease both.\n'
      );
      const changedFilesPath = join(root, "changed-files.txt");
      await writeFile(
        changedFilesPath,
        "M\tapps/skillset/src/cli.ts\nM\t.changeset/mixed.md\n"
      );
      const output: string[] = [];

      const exitCode = await runChangesetGuard(
        ["--changed-files", changedFilesPath],
        { rootPath: root, writeLine: (line) => output.push(line) }
      );

      expect(exitCode).toBe(1);
      expect(output.join("\n")).toContain(
        ".changeset/mixed.md mixes ignored package(s) @skillset/schema with published package(s) skillset"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("classifies private-only, public-only, explicit ignore, and versioned private entries", async () => {
    const ignoredRoot = await writeReleaseBoundaryFixture({
      changesets: {
        "explicit-ignore.md": '---\n"@skillset/ignored": patch\n"skillset": patch\n---\n',
        "private-only.md": '---\n"@skillset/schema": patch\n---\n',
        "public-only.md": '---\n"skillset": patch\n---\n',
      },
      ignore: ["@skillset/ignored"],
      privatePackageVersioning: false,
    });
    const versionedRoot = await writeReleaseBoundaryFixture({
      changesets: {
        "versioned-private.md": '---\n"@skillset/schema": patch\n"skillset": patch\n---\n',
      },
      ignore: [],
      privatePackageVersioning: true,
    });

    try {
      await expect(findMixedChangesetReleaseEntries(ignoredRoot)).resolves.toEqual([
        {
          changesetPath: ".changeset/explicit-ignore.md",
          ignoredPackages: ["@skillset/ignored"],
          publishedPackages: ["skillset"],
        },
      ]);
      await expect(findMixedChangesetReleaseEntries(versionedRoot)).resolves.toEqual([]);
    } finally {
      await Promise.all([
        rm(ignoredRoot, { force: true, recursive: true }),
        rm(versionedRoot, { force: true, recursive: true }),
      ]);
    }
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
    expect(isPackageAffectingPath("packages/registry/src/schema-snapshots.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/registry/src/migrations.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/registry/src/__tests__/snapshots.test.ts")).toBe(false);
    expect(isPackageAffectingPath("packages/schema/src/contracts.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/schema/src/validate.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/schema/src/__tests__/schema.test.ts")).toBe(false);
    expect(isPackageAffectingPath("packages/toolkit/src/runtime.ts")).toBe(true);
    expect(isPackageAffectingPath("packages/toolkit/src/__tests__/runtime.test.ts")).toBe(false);
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

async function writeReleaseBoundaryFixture(options: {
  readonly changesets: Readonly<Record<string, string>>;
  readonly ignore: readonly string[];
  readonly privatePackageVersioning: boolean;
}) {
  const root = await mkdtemp(join(tmpdir(), "skillset-changeset-boundary-"));
  await mkdir(join(root, "apps/skillset"), { recursive: true });
  await mkdir(join(root, "packages/ignored"), { recursive: true });
  await mkdir(join(root, "packages/schema"), { recursive: true });
  await mkdir(join(root, ".changeset"), { recursive: true });
  await writeFile(join(root, "apps/skillset/package.json"), JSON.stringify({ name: "skillset" }));
  await writeFile(
    join(root, "packages/ignored/package.json"),
    JSON.stringify({ name: "@skillset/ignored" })
  );
  await writeFile(
    join(root, "packages/schema/package.json"),
    JSON.stringify({ name: "@skillset/schema", private: true })
  );
  await writeFile(
    join(root, ".changeset/config.json"),
    JSON.stringify({
      ignore: options.ignore,
      privatePackages: { version: options.privatePackageVersioning },
    })
  );
  await Promise.all(
    Object.entries(options.changesets).map(([name, source]) =>
      writeFile(join(root, ".changeset", name), source)
    )
  );
  return root;
}
