import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import productManifest from "../apps/skillset/package.json";
import {
  REQUIRED_NATIVE_DISTRIBUTIONS,
  nativePackageDirectory,
} from "../apps/skillset/src/native-distribution";
import {
  verifyNativeArtifacts,
  type NativeArtifactManifest,
} from "./native-artifacts";
import {
  REQUIRED_NATIVE_TARGETS,
  getNativeTarget,
  type NativeTarget,
} from "./native-targets";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultNativeOutputDir = join(rootDir, ".skillset", "cache", "native");

type NativePackageManifest = {
  bin?: unknown;
  cpu?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  files?: unknown;
  libc?: unknown;
  license?: unknown;
  name?: unknown;
  os?: unknown;
  optionalDependencies?: unknown;
  publishConfig?: unknown;
  scripts?: unknown;
  version?: unknown;
};

export interface BuildNativePackagesOptions {
  readonly nativeOutputDir?: string;
  readonly packDir?: string;
  readonly targets: readonly NativeTarget[];
}

function expectedFiles(target: NativeTarget): readonly string[] {
  return [`bin/${target.executable}`, "README.md", "LICENSE"] as const;
}

function expectedPlatformValues(target: NativeTarget) {
  return {
    cpu: [target.arch],
    libc: target.libc ? [target.libc] : undefined,
    os: [target.os],
  };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function nativePackageManifestDiagnostics(
  rootPath = rootDir
): Promise<string[]> {
  const diagnostics: string[] = [];
  const expectedNames = REQUIRED_NATIVE_DISTRIBUTIONS.map(
    (distribution) => distribution.npmPackage
  ).sort();
  const optionalDependencies = (
    JSON.parse(
      await readFile(join(rootPath, "apps", "skillset", "package.json"), "utf8")
    ) as { optionalDependencies?: Record<string, unknown> }
  ).optionalDependencies;
  if (
    !optionalDependencies ||
    !equalJson(Object.keys(optionalDependencies).sort(), expectedNames)
  ) {
    diagnostics.push(
      "apps/skillset/package.json must declare exactly the five required native packages as optional dependencies"
    );
  }

  for (const target of REQUIRED_NATIVE_TARGETS) {
    const packageDir = nativePackageDirectory(target);
    const path = join(rootPath, packageDir, "package.json");
    let manifest: NativePackageManifest;
    try {
      manifest = JSON.parse(
        await readFile(path, "utf8")
      ) as NativePackageManifest;
    } catch {
      diagnostics.push(`${packageDir}/package.json is missing or unreadable`);
      continue;
    }
    const platform = expectedPlatformValues(target);
    const publishConfig = manifest.publishConfig as
      | Record<string, unknown>
      | undefined;
    if (
      manifest.name !== target.npmPackage ||
      manifest.version !== productManifest.version ||
      manifest.license !== "MIT" ||
      !equalJson(manifest.os, platform.os) ||
      !equalJson(manifest.cpu, platform.cpu) ||
      !equalJson(manifest.libc, platform.libc) ||
      !equalJson(manifest.files, expectedFiles(target)) ||
      publishConfig?.access !== "public" ||
      manifest.bin !== undefined ||
      manifest.dependencies !== undefined ||
      manifest.devDependencies !== undefined ||
      manifest.optionalDependencies !== undefined ||
      manifest.scripts !== undefined
    ) {
      diagnostics.push(
        `${packageDir}/package.json does not match the ${target.suffix} native package contract`
      );
    }
    if (optionalDependencies?.[target.npmPackage] !== productManifest.version) {
      diagnostics.push(
        `skillset optional dependency ${target.npmPackage} must equal product version ${productManifest.version}`
      );
    }
  }
  return diagnostics;
}

function packageReadme(target: NativeTarget): string {
  return `# ${target.npmPackage}\n\nThis package contains the ${target.suffix} native executable used by the \`skillset\` npm launcher. Install \`skillset\` globally instead of depending on this platform package directly.\n`;
}

async function runPack(
  target: NativeTarget,
  packageDir: string,
  packDir: string
): Promise<string> {
  await mkdir(packDir, { recursive: true });
  const child = Bun.spawn(
    [
      "npm",
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      packDir,
    ],
    { cwd: packageDir, stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not pack ${packageDir}:\n${stdout}${stderr}`);
  }
  const result = JSON.parse(stdout) as Array<{
    filename?: string;
    files?: Array<{ mode?: number; path?: string }>;
  }>;
  const filename = result[0]?.filename;
  const files = result[0]?.files ?? [];
  const expected = [
    "LICENSE",
    "README.md",
    `bin/${target.executable}`,
    "package.json",
  ].sort();
  if (result.length !== 1 || !filename) {
    throw new Error(
      `Expected one tarball for ${packageDir}, found ${result.length}`
    );
  }
  if (
    JSON.stringify(files.map((file) => file.path).sort()) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      `${target.npmPackage} tarball must contain exactly ${expected.join(", ")}`
    );
  }
  const executable = files.find(
    (file) => file.path === `bin/${target.executable}`
  );
  if (
    target.os !== "win32" &&
    process.platform !== "win32" &&
    executable?.mode !== 0o755
  ) {
    throw new Error(`${target.npmPackage} executable must pack with mode 0755`);
  }
  return join(packDir, filename);
}

export async function buildNativePackages(
  options: BuildNativePackagesOptions
): Promise<readonly string[]> {
  if (options.targets.length === 0) {
    throw new Error("Select at least one required native package target");
  }
  if (options.targets.some((target) => !target.required)) {
    throw new Error(
      "Reserved musl targets cannot be packaged before target-host promotion"
    );
  }
  if (
    new Set(options.targets.map((target) => target.suffix)).size !==
    options.targets.length
  ) {
    throw new Error("Native package target selection contains duplicates");
  }
  const diagnostics = await nativePackageManifestDiagnostics(rootDir);
  if (diagnostics.length > 0) throw new Error(diagnostics.join("\n"));

  const nativeOutputDir = resolve(
    options.nativeOutputDir ?? defaultNativeOutputDir
  );
  const manifest = await verifyNativeArtifacts({
    allowPartial: true,
    outputDir: nativeOutputDir,
  });
  assertSelectedArtifacts(manifest, options.targets);

  const tarballs: string[] = [];
  for (const target of options.targets) {
    const packageDir = join(rootDir, nativePackageDirectory(target));
    const binDir = join(packageDir, "bin");
    await rm(binDir, { force: true, recursive: true });
    await mkdir(binDir, { recursive: true });
    const executable = join(binDir, target.executable);
    await copyFile(
      join(nativeOutputDir, "bin", target.suffix, target.executable),
      executable
    );
    if (target.os !== "win32") await chmod(executable, 0o755);
    await copyFile(join(rootDir, "LICENSE"), join(packageDir, "LICENSE"));
    await writeFile(join(packageDir, "README.md"), packageReadme(target));

    if (options.packDir) {
      tarballs.push(
        await runPack(target, packageDir, resolve(options.packDir))
      );
    }
  }
  return tarballs;
}

function assertSelectedArtifacts(
  manifest: NativeArtifactManifest,
  targets: readonly NativeTarget[]
): void {
  for (const target of targets) {
    const artifact = manifest.artifacts.find(
      (candidate) => candidate.suffix === target.suffix
    );
    if (!artifact) {
      throw new Error(
        `Native artifact output is missing required package target ${target.suffix}`
      );
    }
    if (
      artifact.npmPackage !== target.npmPackage ||
      artifact.required !== true
    ) {
      throw new Error(
        `Native artifact metadata cannot package ${target.suffix}`
      );
    }
  }
}

function parseArgs(args: readonly string[]): {
  readonly nativeOutputDir?: string;
  readonly packDir?: string;
  readonly targets: readonly NativeTarget[];
} {
  let nativeOutputDir: string | undefined;
  let packDir: string | undefined;
  let required = false;
  const suffixes: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    switch (arg) {
      case "--native-out-dir":
        if (!value || value.startsWith("--"))
          throw new Error("--native-out-dir requires a value");
        nativeOutputDir = value;
        index += 1;
        break;
      case "--pack-dir":
        if (!value || value.startsWith("--"))
          throw new Error("--pack-dir requires a value");
        packDir = value;
        index += 1;
        break;
      case "--required":
        required = true;
        break;
      case "--target":
        if (!value || value.startsWith("--"))
          throw new Error("--target requires a value");
        suffixes.push(value);
        index += 1;
        break;
      default:
        throw new Error(`Unknown native package argument: ${arg}`);
    }
  }
  if (Number(required) + Number(suffixes.length > 0) !== 1) {
    throw new Error("Select exactly one of --required or --target");
  }
  return {
    ...(nativeOutputDir ? { nativeOutputDir } : {}),
    ...(packDir ? { packDir } : {}),
    targets: required ? REQUIRED_NATIVE_TARGETS : suffixes.map(getNativeTarget),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const tarballs = await buildNativePackages(options);
  console.error(
    `skillset: prepared ${options.targets.length} native npm package(s)${tarballs.length > 0 ? ` and packed ${tarballs.length} tarball(s)` : ""}`
  );
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(
      `skillset: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
