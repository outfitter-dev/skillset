import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type PackageManifest = {
  bin?: unknown;
  description?: unknown;
  engines?: unknown;
  files?: unknown;
  license?: unknown;
  name?: unknown;
  workspaces?: unknown;
};

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicPackageDirs = ["apps/cli", "apps/skillset"] as const;
const expectedPackedFiles = [
  "LICENSE",
  "README.md",
  "dist/cli.js",
  "package.json",
];

export async function workspaceManifestPaths(rootPath: string) {
  const rootManifest = await readManifest(join(rootPath, "package.json"));
  const workspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  const paths = ["package.json"];

  for (const workspace of workspaces) {
    const glob = new Bun.Glob(`${workspace}/package.json`);
    for await (const path of glob.scan({ cwd: rootPath, onlyFiles: true }))
      paths.push(path);
  }

  return [...new Set(paths)].sort();
}

export async function licenseDiagnostics(rootPath: string) {
  const diagnostics: string[] = [];
  for (const path of await workspaceManifestPaths(rootPath)) {
    const manifest = await readManifest(join(rootPath, path));
    if (manifest.license !== "MIT") {
      diagnostics.push(
        `${path}: expected license MIT, found ${JSON.stringify(manifest.license)}`
      );
    }
  }
  return diagnostics;
}

export function packedFileDiagnostics(output: string, packageDir = "package") {
  const diagnostics: string[] = [];
  for (const path of expectedPackedFiles) {
    if (
      !output.split("\n").some((line) => line.trimEnd().endsWith(` ${path}`))
    ) {
      diagnostics.push(`${packageDir} tarball is missing ${path}`);
    }
  }
  const totalFileLines = output
    .split("\n")
    .filter((line) => line.trim().startsWith("Total files:"));
  if (
    totalFileLines.length !== 1 ||
    totalFileLines[0]?.trim() !== `Total files: ${expectedPackedFiles.length}`
  ) {
    diagnostics.push(
      `${packageDir} tarball must contain exactly ${expectedPackedFiles.length} files`
    );
  }
  return diagnostics;
}

export async function projectionDiagnostics(rootPath: string) {
  const diagnostics: string[] = [];
  for (const packageDir of publicPackageDirs) {
    for (const file of ["README.md", "LICENSE"]) {
      const sourcePath = join(rootPath, file);
      const projectedPath = join(rootPath, packageDir, file);
      const [source, projected] = await Promise.all([
        readFile(sourcePath).catch(() => null),
        readFile(projectedPath).catch(() => null),
      ]);
      if (!source) diagnostics.push(`${file} is missing`);
      if (!projected)
        diagnostics.push(
          `${packageDir}/${file} is missing; run bun run build:npm`
        );
      if (source && projected && !source.equals(projected)) {
        diagnostics.push(`${packageDir}/${file} differs from root ${file}`);
      }
    }
  }
  return diagnostics;
}

export async function bundleParityDiagnostics(rootPath: string) {
  const [canonical, legacy] = await Promise.all([
    readFile(join(rootPath, "apps", "cli", "dist", "cli.js")).catch(() => null),
    readFile(join(rootPath, "apps", "skillset", "dist", "cli.js")).catch(
      () => null
    ),
  ]);
  if (!canonical || !legacy) {
    return ["Both public CLI bundles must exist; run bun run build:npm"];
  }
  return canonical.equals(legacy)
    ? []
    : [
        "apps/skillset/dist/cli.js must match apps/cli/dist/cli.js byte-for-byte",
      ];
}

export async function readmeMetadataDiagnostics(rootPath: string) {
  const [readme, manifest] = await Promise.all([
    readFile(join(rootPath, "README.md"), "utf8"),
    readManifest(join(rootPath, "apps", "cli", "package.json")),
  ]);
  if (typeof manifest.description !== "string" || !manifest.description) {
    return ["apps/cli/package.json is missing a package description"];
  }
  const description = manifest.description;
  const expectedSentence = `Skillset is a ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
  const firstSixtyLines = readme.split("\n").slice(0, 60).join("\n");
  const diagnostics: string[] = [];
  if (!firstSixtyLines.includes(expectedSentence)) {
    diagnostics.push(
      `README.md must state the package description in its first 60 lines: ${expectedSentence}`
    );
  }
  if (!firstSixtyLines.includes("bun add --dev @skillset/cli")) {
    diagnostics.push(
      "README.md must include the package install command in its first 60 lines"
    );
  }
  if (!firstSixtyLines.includes("bunx @skillset/cli init")) {
    diagnostics.push(
      "README.md must include an executable Skillset example in its first 60 lines"
    );
  }
  return diagnostics;
}

export async function packageBinDiagnostics(rootPath: string) {
  const diagnostics: string[] = [];
  for (const packageDir of publicPackageDirs) {
    const manifest = await readManifest(
      join(rootPath, packageDir, "package.json")
    );
    const bin = manifest.bin;
    if (
      typeof bin === "object" &&
      bin !== null &&
      !Array.isArray(bin) &&
      Object.keys(bin).length === 1 &&
      (bin as Record<string, unknown>).skillset === "dist/cli.js"
    ) {
      continue;
    }
    diagnostics.push(
      `${packageDir}/package.json must expose only skillset -> dist/cli.js`
    );
  }
  return diagnostics;
}

export async function bunRuntimeDiagnostics(rootPath: string) {
  const manifest = await readManifest(
    join(rootPath, "apps", "cli", "package.json")
  );
  const engines = manifest.engines;
  return isRecord(engines) && engines.bun === ">=1.3.14"
    ? []
    : ["apps/cli/package.json must require Bun >=1.3.14"];
}

async function runPackDryRun(packagePath: string) {
  const process = Bun.spawn(["bun", "pm", "pack", "--dry-run"], {
    cwd: join(rootDir, packagePath),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0)
    throw new Error(`bun pm pack --dry-run failed:\n${output.trim()}`);
  return output;
}

async function commandCheck() {
  const diagnostics = [
    ...(await licenseDiagnostics(rootDir)),
    ...(await bunRuntimeDiagnostics(rootDir)),
    ...(await bundleParityDiagnostics(rootDir)),
    ...(await packageBinDiagnostics(rootDir)),
    ...(await projectionDiagnostics(rootDir)),
    ...(await readmeMetadataDiagnostics(rootDir)),
  ];
  for (const packageDir of publicPackageDirs) {
    diagnostics.push(
      ...packedFileDiagnostics(await runPackDryRun(packageDir), packageDir)
    );
  }
  if (diagnostics.length > 0) throw new Error(diagnostics.join("\n"));

  const manifests = await workspaceManifestPaths(rootDir);
  console.error(`skillset: ${manifests.length} package manifests declare MIT`);
  console.error(
    `skillset: npm projections and both ${expectedPackedFiles.length}-file tarball manifests are current`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readManifest(path: string) {
  const parsed = JSON.parse(await readFile(path, "utf8")) as PackageManifest;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Expected ${relative(rootDir, path)} to contain a JSON object`
    );
  }
  return parsed;
}

if (import.meta.main) {
  await (async () => {
    const [command = "check"] = Bun.argv.slice(2);
    if (command !== "check")
      throw new Error(`Unknown package metadata command: ${command}`);
    await commandCheck();
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
