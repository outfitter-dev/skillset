import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  licenseDiagnostics,
  packageBinDiagnostics,
  packedFileDiagnostics,
  projectionDiagnostics,
  readmeMetadataDiagnostics,
  workspaceManifestPaths,
} from "../package-metadata";

describe("package metadata checks", () => {
  test("discovers package manifests from the workspace contract", async () => {
    const root = await fixture({
      "apps/cli/package.json": { license: "MIT", name: "cli" },
      "package.json": {
        license: "MIT",
        name: "root",
        workspaces: ["apps/*", "packages/*"],
      },
      "packages/core/package.json": { license: "MIT", name: "core" },
    });

    expect(await workspaceManifestPaths(root)).toEqual([
      "apps/cli/package.json",
      "package.json",
      "packages/core/package.json",
    ]);
    expect(await licenseDiagnostics(root)).toEqual([]);
  });

  test("reports every workspace that does not declare MIT", async () => {
    const root = await fixture({
      "apps/cli/package.json": { name: "cli" },
      "package.json": { license: "MIT", name: "root", workspaces: ["apps/*"] },
    });

    expect(await licenseDiagnostics(root)).toEqual([
      "apps/cli/package.json: expected license MIT, found undefined",
    ]);
  });

  test("requires the public package payload", () => {
    const complete = [
      "LICENSE",
      "README.md",
      "dist/cli.js",
      "package.json",
    ]
      .map((path) => `packed 1B ${path}`)
      .join("\n");
    expect(packedFileDiagnostics(complete)).toEqual([]);
    expect(packedFileDiagnostics("packed 1B package.json")).toEqual([
      "package tarball is missing LICENSE",
      "package tarball is missing README.md",
      "package tarball is missing dist/cli.js",
    ]);
  });

  test("requires one public CLI bin", async () => {
    const root = await fixture({
      "apps/skillset/package.json": {
        bin: { skillset: "dist/cli.js" },
      },
    });
    expect(await packageBinDiagnostics(root)).toEqual([]);

    await writeFile(
      join(root, "apps/skillset/package.json"),
      `${JSON.stringify({
        bin: {
          skillset: "dist/cli.js",
          "skillset-toolkit": "dist/toolkit.js",
        },
      })}\n`
    );
    expect(await packageBinDiagnostics(root)).toEqual([
      "apps/skillset/package.json must expose only skillset -> dist/cli.js",
    ]);
  });

  test("requires exact README and LICENSE projections", async () => {
    const root = await fixture({
      LICENSE: "license\n",
      "README.md": "readme\n",
      "apps/skillset/LICENSE": "license\n",
      "apps/skillset/README.md": "stale\n",
      "package.json": { license: "MIT", name: "root", workspaces: ["apps/*"] },
    });

    expect(await projectionDiagnostics(root)).toEqual([
      "apps/skillset/README.md differs from root README.md",
    ]);
  });

  test("keeps the package description and first executable path in the README front door", async () => {
    const root = await fixture({
      "README.md": [
        "# Skillset",
        "",
        "Skillset is a source-first compiler for provider-native agent loadouts.",
        "",
        "```bash",
        "bun add --dev skillset",
        "bunx skillset init",
        "```",
      ].join("\n"),
      "apps/skillset/package.json": {
        description:
          "Source-first compiler for provider-native agent loadouts.",
      },
    });

    expect(await readmeMetadataDiagnostics(root)).toEqual([]);
    await writeFile(join(root, "README.md"), "# Skillset\n\nStale copy.\n");
    expect(await readmeMetadataDiagnostics(root)).toEqual([
      "README.md must state the package description in its first 60 lines: Skillset is a source-first compiler for provider-native agent loadouts.",
      "README.md must include the package install command in its first 60 lines",
      "README.md must include an executable Skillset example in its first 60 lines",
    ]);
  });
});

async function fixture(files: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "skillset-package-metadata-"));
  for (const [path, value] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    const content =
      typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
    await writeFile(destination, content);
  }
  return root;
}
