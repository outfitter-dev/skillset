import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  nativeChecksumsName,
  nativeManifestName,
  verifyNativeArtifacts,
} from "./native-artifacts";
import { REQUIRED_NATIVE_TARGETS, nativeArchiveName } from "./native-targets";

export function expectedReleaseAssetNames(version: string): readonly string[] {
  return [
    ...REQUIRED_NATIVE_TARGETS.map((target) =>
      nativeArchiveName(version, target)
    ),
    nativeManifestName(version),
    nativeChecksumsName(version),
  ].sort();
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function directoryDigests(
  directory: string
): Promise<Readonly<Record<string, string>>> {
  const entries = (await readdir(directory)).sort();
  return Object.fromEntries(
    await Promise.all(
      entries.map(async (name) => [
        name,
        digest(new Uint8Array(await readFile(join(directory, name)))),
      ])
    )
  );
}

export async function stageReleaseAssets(options: {
  readonly nativeOutputDir: string;
  readonly releaseDir: string;
}): Promise<{ readonly names: readonly string[]; readonly version: string }> {
  const manifest = await verifyNativeArtifacts({
    outputDir: options.nativeOutputDir,
  });
  const names = expectedReleaseAssetNames(manifest.version);
  const releaseDir = resolve(options.releaseDir);
  await mkdir(releaseDir, { recursive: true });
  if ((await readdir(releaseDir)).length > 0) {
    throw new Error(
      `Release asset staging directory must be empty: ${releaseDir}`
    );
  }
  for (const name of names) {
    await copyFile(join(options.nativeOutputDir, name), join(releaseDir, name));
  }
  await assertExactReleaseAssets(releaseDir, manifest.version);
  return { names, version: manifest.version };
}

export async function assertExactReleaseAssets(
  directory: string,
  version: string
): Promise<void> {
  const expected = expectedReleaseAssetNames(version);
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release assets must be exactly ${expected.join(", ")}; found ${actual.join(", ")}`
    );
  }
}

export async function reconcileReleaseAssets(options: {
  readonly localDir: string;
  readonly missingOutput: string;
  readonly remoteDir: string;
  readonly version: string;
}): Promise<readonly string[]> {
  await assertExactReleaseAssets(options.localDir, options.version);
  const expected = expectedReleaseAssetNames(options.version);
  const remoteNames = (await readdir(options.remoteDir)).sort();
  const unexpected = remoteNames.filter((name) => !expected.includes(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Existing GitHub release has unexpected assets: ${unexpected.join(", ")}`
    );
  }
  const localDigests = await directoryDigests(options.localDir);
  const remoteDigests = await directoryDigests(options.remoteDir);
  for (const name of remoteNames) {
    if (remoteDigests[name] !== localDigests[name]) {
      throw new Error(
        `Existing GitHub release asset ${name} does not match the verified local artifact`
      );
    }
  }
  const missing = expected.filter((name) => !remoteNames.includes(name));
  await writeFile(
    options.missingOutput,
    `${missing.join("\n")}${missing.length ? "\n" : ""}`
  );
  return missing;
}

function readValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "stage": {
      const result = await stageReleaseAssets({
        nativeOutputDir: readValue(args, "--native-out-dir"),
        releaseDir: readValue(args, "--release-dir"),
      });
      console.error(
        `skillset: staged ${result.names.length} release assets for ${result.version}`
      );
      return;
    }
    case "verify":
      await assertExactReleaseAssets(
        readValue(args, "--release-dir"),
        readValue(args, "--version")
      );
      return;
    case "reconcile":
      await reconcileReleaseAssets({
        localDir: readValue(args, "--local-dir"),
        missingOutput: readValue(args, "--missing-output"),
        remoteDir: readValue(args, "--remote-dir"),
        version: readValue(args, "--version"),
      });
      return;
    default:
      throw new Error(
        "Expected release asset command stage, verify, or reconcile"
      );
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(
      `skillset: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
