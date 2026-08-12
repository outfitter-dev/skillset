import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildNativePackages } from "./native-packages";
import { REQUIRED_NATIVE_TARGETS } from "./native-targets";
import {
  RELEASE_NPM_VERSION,
  RELEASE_PACKAGE_SPECS,
  readReleasePackageSet,
  type ReleasePackageSpec,
} from "./release-packages";

const manifestName = "release-tarballs.json";

export interface StagedReleaseTarball {
  readonly directory: string;
  readonly filename: string;
  readonly integrity: string;
  readonly name: string;
  readonly path: string;
}

type StagedManifest = {
  npmVersion: string;
  packages: Array<Omit<StagedReleaseTarball, "path">>;
  schemaVersion: 1;
  version: string;
};

export function tarballIntegrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function expectedReleaseTarballFiles(
  spec: ReleasePackageSpec
): readonly string[] {
  if (spec.role !== "native") {
    return ["LICENSE", "README.md", "dist/cli.js", "package.json"];
  }
  const target = REQUIRED_NATIVE_TARGETS.find(
    (candidate) => candidate.npmPackage === spec.name
  );
  if (!target) throw new Error(`Unknown native release package ${spec.name}`);
  return ["LICENSE", "README.md", `bin/${target.executable}`, "package.json"];
}

async function capture(command: readonly string[], cwd?: string) {
  const subprocess = Bun.spawn([...command], {
    ...(cwd ? { cwd } : {}),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${stdout}${stderr}`);
  }
  return stdout.trim();
}

async function assertPinnedNpm(): Promise<void> {
  const actual = await capture(["npm", "--version"]);
  if (actual !== RELEASE_NPM_VERSION) {
    throw new Error(
      `Release tarballs require npm ${RELEASE_NPM_VERSION}, found ${actual}`
    );
  }
}

async function packOne(
  spec: ReleasePackageSpec,
  rootPath: string,
  stageDir: string
): Promise<StagedReleaseTarball> {
  const output = await capture(
    [
      "npm",
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      stageDir,
    ],
    join(rootPath, spec.directory)
  );
  const result = JSON.parse(output) as Array<{
    filename?: unknown;
    files?: Array<{ path?: unknown }>;
    integrity?: unknown;
  }>;
  const filename = result.length === 1 ? result[0]?.filename : undefined;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`Expected npm pack to create one tarball for ${spec.name}`);
  }
  const path = join(stageDir, filename);
  const expectedFiles = [...expectedReleaseTarballFiles(spec)].sort();
  const actualFiles = (result[0]?.files ?? [])
    .map((entry) => entry.path)
    .filter((entry): entry is string => typeof entry === "string")
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `${spec.name} tarball must contain exactly ${expectedFiles.join(", ")}`
    );
  }
  const integrity = tarballIntegrity(new Uint8Array(await readFile(path)));
  if (result[0]?.integrity !== integrity) {
    throw new Error(`${spec.name} npm pack integrity does not match its bytes`);
  }
  return {
    directory: spec.directory,
    filename,
    integrity,
    name: spec.name,
    path,
  };
}

export async function stageReleaseTarballs(options: {
  readonly nativeOutputDir: string;
  readonly rootPath: string;
  readonly stageDir: string;
}): Promise<readonly StagedReleaseTarball[]> {
  await assertPinnedNpm();
  const releaseSet = await readReleasePackageSet(options.rootPath);
  const stageDir = resolve(options.stageDir);
  await mkdir(stageDir, { recursive: true });
  const initialEntries = await readdir(stageDir);
  if (initialEntries.length > 0) {
    throw new Error(
      `Release tarball staging directory must be empty: ${stageDir}`
    );
  }

  await capture(["bun", "run", "build:npm"], options.rootPath);
  await buildNativePackages({
    nativeOutputDir: options.nativeOutputDir,
    targets: REQUIRED_NATIVE_TARGETS,
  });

  const packages: StagedReleaseTarball[] = [];
  for (const spec of RELEASE_PACKAGE_SPECS) {
    packages.push(await packOne(spec, options.rootPath, stageDir));
  }
  const manifest: StagedManifest = {
    npmVersion: RELEASE_NPM_VERSION,
    packages: packages.map(({ path: _path, ...entry }) => entry),
    schemaVersion: 1,
    version: releaseSet.version,
  };
  await writeFile(
    join(stageDir, manifestName),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await assertExactStageEntries(stageDir, packages);
  return packages;
}

export async function readStagedReleaseTarballs(stagePath: string): Promise<{
  readonly packages: readonly StagedReleaseTarball[];
  readonly version: string;
}> {
  await assertPinnedNpm();
  const stageDir = resolve(stagePath);
  const manifest = JSON.parse(
    await readFile(join(stageDir, manifestName), "utf8")
  ) as Partial<StagedManifest>;
  if (
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(
        ["npmVersion", "packages", "schemaVersion", "version"].sort()
      ) ||
    manifest.schemaVersion !== 1 ||
    manifest.npmVersion !== RELEASE_NPM_VERSION ||
    typeof manifest.version !== "string" ||
    !Array.isArray(manifest.packages)
  ) {
    throw new Error("Release tarball manifest is missing or invalid");
  }
  const expectedNames = RELEASE_PACKAGE_SPECS.map((spec) => spec.name);
  if (
    JSON.stringify(manifest.packages.map((entry) => entry.name)) !==
    JSON.stringify(expectedNames)
  ) {
    throw new Error(
      "Release tarball manifest does not use canonical package order"
    );
  }

  const packages: StagedReleaseTarball[] = [];
  for (const [index, entry] of manifest.packages.entries()) {
    const spec = RELEASE_PACKAGE_SPECS[index]!;
    if (
      !entry ||
      typeof entry !== "object" ||
      JSON.stringify(Object.keys(entry).sort()) !==
        JSON.stringify(["directory", "filename", "integrity", "name"].sort()) ||
      entry.directory !== spec.directory ||
      typeof entry.filename !== "string" ||
      typeof entry.integrity !== "string"
    ) {
      throw new Error(
        `Release tarball manifest entry is invalid for ${spec.name}`
      );
    }
    const path = join(stageDir, entry.filename);
    const actualIntegrity = tarballIntegrity(
      new Uint8Array(await readFile(path))
    );
    if (actualIntegrity !== entry.integrity) {
      throw new Error(`${spec.name} staged tarball integrity changed`);
    }
    packages.push({ ...entry, path } as StagedReleaseTarball);
  }
  await assertExactStageEntries(stageDir, packages);
  return { packages, version: manifest.version };
}

async function assertExactStageEntries(
  stageDir: string,
  packages: readonly StagedReleaseTarball[]
): Promise<void> {
  const expected = [
    manifestName,
    ...packages.map((entry) => entry.filename),
  ].sort();
  const actual = (await readdir(stageDir)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release tarball stage must contain exactly ${expected.join(", ")}`
    );
  }
}
