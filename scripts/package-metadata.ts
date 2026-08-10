import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type PackageManifest = {
  description?: unknown;
  files?: unknown;
  license?: unknown;
  name?: unknown;
  workspaces?: unknown;
};

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDir = join(rootDir, "apps", "skillset");
const expectedPackedFiles = [
  "LICENSE",
  "README.md",
  "dist/cli.js",
  "dist/toolkit.js",
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

export function packedFileDiagnostics(output: string) {
  const diagnostics: string[] = [];
  for (const path of expectedPackedFiles) {
    if (
      !output.split("\n").some((line) => line.trimEnd().endsWith(` ${path}`))
    ) {
      diagnostics.push(`package tarball is missing ${path}`);
    }
  }
  return diagnostics;
}

export async function projectionDiagnostics(rootPath: string) {
  const diagnostics: string[] = [];
  for (const file of ["README.md", "LICENSE"]) {
    const sourcePath = join(rootPath, file);
    const projectedPath = join(rootPath, "apps", "skillset", file);
    const [source, projected] = await Promise.all([
      readFile(sourcePath).catch(() => null),
      readFile(projectedPath).catch(() => null),
    ]);
    if (!source) diagnostics.push(`${file} is missing`);
    if (!projected)
      diagnostics.push(
        `apps/skillset/${file} is missing; run bun run build:npm`
      );
    if (source && projected && !source.equals(projected)) {
      diagnostics.push(`apps/skillset/${file} differs from root ${file}`);
    }
  }
  return diagnostics;
}

export async function readmeMetadataDiagnostics(rootPath: string) {
  const [readme, manifest] = await Promise.all([
    readFile(join(rootPath, "README.md"), "utf8"),
    readManifest(join(rootPath, "apps", "skillset", "package.json")),
  ]);
  if (typeof manifest.description !== "string" || !manifest.description) {
    return ["apps/skillset/package.json is missing a package description"];
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
  if (!firstSixtyLines.includes("bun add --dev skillset")) {
    diagnostics.push(
      "README.md must include the package install command in its first 60 lines"
    );
  }
  if (!firstSixtyLines.includes("bunx skillset init")) {
    diagnostics.push(
      "README.md must include an executable Skillset example in its first 60 lines"
    );
  }
  return diagnostics;
}

async function runPackDryRun() {
  const process = Bun.spawn(["bun", "pm", "pack", "--dry-run"], {
    cwd: packageDir,
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
    ...(await projectionDiagnostics(rootDir)),
    ...(await readmeMetadataDiagnostics(rootDir)),
    ...packedFileDiagnostics(await runPackDryRun()),
  ];
  if (diagnostics.length > 0) throw new Error(diagnostics.join("\n"));

  const manifests = await workspaceManifestPaths(rootDir);
  console.error(`skillset: ${manifests.length} package manifests declare MIT`);
  console.error(
    `skillset: npm projection and ${expectedPackedFiles.length}-file tarball manifest are current`
  );
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
