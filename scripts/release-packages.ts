import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nativePackageDirectory } from "../apps/skillset/src/native-distribution";
import { REQUIRED_NATIVE_TARGETS } from "./native-targets";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export interface ReleasePackageSpec {
  readonly directory: string;
  readonly name: string;
  readonly role: "cli" | "launcher" | "native";
}

export interface ReleaseRegistryState {
  readonly integrity?: string | undefined;
  readonly name: string;
  readonly published: boolean;
  readonly provenancePredicateType?: string | undefined;
  readonly taggedVersion?: string | undefined;
}

export interface CoordinatedReleasePlan {
  readonly missing: readonly string[];
  readonly mode: "complete" | "publish" | "recover";
  readonly published: readonly string[];
}

type PackageManifest = {
  name?: unknown;
  optionalDependencies?: unknown;
  private?: unknown;
  publishConfig?: unknown;
  version?: unknown;
};

type ChangesetConfig = {
  fixed?: unknown;
};

const nativeReleasePackages: readonly ReleasePackageSpec[] =
  REQUIRED_NATIVE_TARGETS.map((target) => ({
    directory: nativePackageDirectory(target),
    name: target.npmPackage,
    role: "native" as const,
  }));

export const RELEASE_PACKAGE_SPECS: readonly ReleasePackageSpec[] = [
  ...nativeReleasePackages,
  { directory: "apps/cli", name: "@skillset/cli", role: "cli" },
  { directory: "apps/skillset", name: "skillset", role: "launcher" },
];

export const NPM_PROVENANCE_PREDICATE =
  "https://slsa.dev/provenance/v1" as const;
export const RELEASE_NPM_VERSION = "11.12.1" as const;

export function npmPublishCommand(
  _spec: ReleasePackageSpec,
  tag: string,
  tarballPath?: string
): readonly string[] {
  return [
    "npm",
    "publish",
    ...(tarballPath ? [tarballPath] : []),
    "--access",
    "public",
    "--tag",
    tag,
    "--provenance",
  ];
}

export function planCoordinatedRelease(
  states: readonly ReleaseRegistryState[],
  version: string,
  tag: string,
  expectedIntegrity: Readonly<Record<string, string>> = {}
): CoordinatedReleasePlan {
  const expectedNames = RELEASE_PACKAGE_SPECS.map((spec) => spec.name);
  const stateByName = new Map<string, ReleaseRegistryState>();
  for (const state of states) {
    if (stateByName.has(state.name)) {
      throw new Error(`Duplicate registry state for ${state.name}`);
    }
    stateByName.set(state.name, state);
  }
  const actualNames = [...stateByName.keys()].sort();
  if (
    JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].sort())
  ) {
    throw new Error(
      `Registry state must cover exactly ${expectedNames.join(", ")}`
    );
  }

  const orderedStates = expectedNames.map((name) => stateByName.get(name)!);
  for (const state of orderedStates) {
    if (state.published && state.taggedVersion !== version) {
      throw new Error(
        `${state.name}@${version} exists, but ${tag} points to ${state.taggedVersion ?? "nothing"}`
      );
    }
    if (
      state.published &&
      state.provenancePredicateType !== NPM_PROVENANCE_PREDICATE
    ) {
      throw new Error(
        `${state.name}@${version} does not expose required npm provenance ${NPM_PROVENANCE_PREDICATE}`
      );
    }
    if (
      state.published &&
      expectedIntegrity[state.name] !== undefined &&
      state.integrity !== expectedIntegrity[state.name]
    ) {
      throw new Error(
        `${state.name}@${version} registry integrity does not match the staged tarball`
      );
    }
  }

  const published = orderedStates
    .filter((state) => state.published)
    .map((state) => state.name);
  const missing = orderedStates
    .filter((state) => !state.published)
    .map((state) => state.name);
  const launcher = orderedStates.at(-1)!;
  if (launcher.published && missing.length > 0) {
    throw new Error(
      `skillset@${version} is already published while prerequisite release packages are missing: ${missing.join(", ")}`
    );
  }

  let reachedMissing = false;
  for (const state of orderedStates) {
    if (!state.published) reachedMissing = true;
    else if (reachedMissing) {
      throw new Error(
        `Registry published package set is not a canonical prefix; ${state.name}@${version} appears after a missing prerequisite`
      );
    }
  }

  if (missing.length === 0) return { mode: "complete", missing, published };
  return {
    mode: published.length === 0 ? "publish" : "recover",
    missing,
    published,
  };
}

export async function readReleasePackageSet(rootPath = rootDir): Promise<{
  readonly packages: readonly ReleasePackageSpec[];
  readonly version: string;
}> {
  const manifests = await Promise.all(
    RELEASE_PACKAGE_SPECS.map(async (spec) => ({
      manifest: JSON.parse(
        await readFile(join(rootPath, spec.directory, "package.json"), "utf8")
      ) as PackageManifest,
      spec,
    }))
  );
  const launcher = manifests.at(-1)?.manifest;
  if (typeof launcher?.version !== "string" || launcher.version.length === 0) {
    throw new Error(
      "apps/skillset/package.json must declare the product version"
    );
  }
  const version = launcher.version;

  for (const { manifest, spec } of manifests) {
    const publishConfig = manifest.publishConfig as
      | Record<string, unknown>
      | undefined;
    if (
      manifest.name !== spec.name ||
      manifest.version !== version ||
      manifest.private === true ||
      publishConfig?.access !== "public"
    ) {
      throw new Error(
        `${spec.directory}/package.json must declare public ${spec.name}@${version}`
      );
    }
  }

  const nativeNames = nativeReleasePackages.map((spec) => spec.name);
  const optionalDependencies = launcher.optionalDependencies as
    | Record<string, unknown>
    | undefined;
  if (
    !optionalDependencies ||
    JSON.stringify(Object.keys(optionalDependencies).sort()) !==
      JSON.stringify([...nativeNames].sort()) ||
    nativeNames.some((name) => optionalDependencies[name] !== version)
  ) {
    throw new Error(
      `skillset@${version} must declare the exact native release set at the product version`
    );
  }

  const changesetConfig = JSON.parse(
    await readFile(join(rootPath, ".changeset", "config.json"), "utf8")
  ) as ChangesetConfig;
  const fixedGroups = changesetConfig.fixed;
  const expectedNames = RELEASE_PACKAGE_SPECS.map((spec) => spec.name).sort();
  if (
    !Array.isArray(fixedGroups) ||
    fixedGroups.length !== 1 ||
    !Array.isArray(fixedGroups[0]) ||
    JSON.stringify([...fixedGroups[0]].sort()) !== JSON.stringify(expectedNames)
  ) {
    throw new Error(
      `Changesets must keep exactly ${expectedNames.join(", ")} in one fixed release group`
    );
  }

  return { packages: RELEASE_PACKAGE_SPECS, version };
}
