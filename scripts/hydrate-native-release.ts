import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { extractNativeArchive } from "./native-archive";
import {
  nativeChecksumsName,
  nativeManifestName,
  parseNativeManifest,
  verifyNativeArtifacts,
} from "./native-artifacts";
import { getNativeTarget } from "./native-targets";
import { expectedReleaseAssetNames } from "./release-assets";

export async function hydrateNativeRelease(options: {
  readonly expectedCommit: string;
  readonly outputDir: string;
  readonly releaseDir: string;
  readonly version: string;
}): Promise<void> {
  const outputDir = resolve(options.outputDir);
  const releaseDir = resolve(options.releaseDir);
  await mkdir(outputDir, { recursive: true });
  if ((await readdir(outputDir)).length > 0) {
    throw new Error(`Native hydration directory must be empty: ${outputDir}`);
  }

  const manifestName = nativeManifestName(options.version);
  const manifest = parseNativeManifest(
    JSON.parse(await readFile(join(releaseDir, manifestName), "utf8"))
  );
  if (manifest.version !== options.version) {
    throw new Error(
      `Native manifest version ${manifest.version} does not match ${options.version}`
    );
  }
  if (manifest.commit !== options.expectedCommit) {
    throw new Error(
      `Native manifest commit ${manifest.commit} does not match ${options.expectedCommit}`
    );
  }

  for (const name of expectedReleaseAssetNames(options.version)) {
    await copyFile(join(releaseDir, name), join(outputDir, name));
  }
  for (const artifact of manifest.artifacts) {
    const target = getNativeTarget(artifact.suffix);
    const extracted = extractNativeArchive(
      target.archiveKind,
      new Uint8Array(await readFile(join(releaseDir, artifact.archive)))
    );
    if (extracted.name !== target.executable || extracted.mode !== 0o755) {
      throw new Error(
        `Native archive payload is invalid for ${artifact.suffix}`
      );
    }
    const executable = join(outputDir, "bin", target.suffix, target.executable);
    await mkdir(join(outputDir, "bin", target.suffix), { recursive: true });
    await writeFile(executable, extracted.bytes);
    if (target.archiveKind === "tar.gz") await chmod(executable, 0o755);
  }

  await verifyNativeArtifacts({ outputDir });
  await Promise.all([
    readFile(join(outputDir, manifestName)),
    readFile(join(outputDir, nativeChecksumsName(options.version))),
  ]);
}

function readValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await hydrateNativeRelease({
    expectedCommit: readValue(args, "--commit"),
    outputDir: readValue(args, "--out-dir"),
    releaseDir: readValue(args, "--release-dir"),
    version: readValue(args, "--version"),
  }).then(
    () => console.error("skillset: hydrated verified native release output"),
    (error: unknown) => {
      console.error(
        `skillset: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  );
}
