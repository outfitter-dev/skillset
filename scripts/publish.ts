import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NPM_PROVENANCE_PREDICATE,
  RELEASE_PACKAGE_SPECS,
  npmPublishCommand,
  planCoordinatedRelease,
  readReleasePackageSet,
  type ReleasePackageSpec,
  type ReleaseRegistryState,
} from "./release-packages";
import { resolveReleaseVersionCommit } from "./release-ref";
import {
  readStagedReleaseTarballs,
  stageReleaseTarballs,
  type StagedReleaseTarball,
} from "./release-tarballs";

type DistTags = Record<string, string | undefined>;

type RegistryDocument = {
  "dist-tags"?: DistTags;
  versions?: Record<
    string,
    {
      dist?: {
        attestations?: {
          provenance?: { predicateType?: unknown };
        };
        integrity?: unknown;
      };
    }
  >;
};

interface RegistryState extends ReleaseRegistryState {
  readonly document: RegistryDocument | null;
  readonly tag: string;
  readonly version: string;
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const registryUrl = "https://registry.npmjs.org";
const allowedPrereleaseTags = new Set([
  "alpha",
  "beta",
  "canary",
  "next",
  "rc",
]);

export function distTagForVersion(version: string) {
  const prerelease = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z.-]+)$/)?.[1];
  if (!prerelease) return "latest";

  const tag = prerelease.split(".")[0] || "next";
  if (!allowedPrereleaseTags.has(tag)) {
    throw new Error(
      `Unsupported prerelease dist-tag "${tag}" for ${version}; allowed tags: ${[...allowedPrereleaseTags].sort().join(", ")}`
    );
  }

  return tag;
}

async function fetchRegistryDocument(name: string) {
  const url = `${registryUrl}/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Registry lookup failed for ${name}: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as RegistryDocument;
}

async function getRegistryStates(): Promise<{
  readonly states: readonly RegistryState[];
  readonly tag: string;
  readonly version: string;
}> {
  const releaseSet = await readReleasePackageSet(rootDir);
  const tag = distTagForVersion(releaseSet.version);
  const states = await Promise.all(
    releaseSet.packages.map(async (spec): Promise<RegistryState> => {
      const document = await fetchRegistryDocument(spec.name);
      const publishedVersion = document?.versions?.[releaseSet.version];
      return {
        document,
        integrity:
          typeof publishedVersion?.dist?.integrity === "string"
            ? publishedVersion.dist.integrity
            : undefined,
        name: spec.name,
        provenancePredicateType:
          typeof publishedVersion?.dist?.attestations?.provenance
            ?.predicateType === "string"
            ? publishedVersion.dist.attestations.provenance.predicateType
            : undefined,
        published: Boolean(publishedVersion),
        tag,
        taggedVersion: document?.["dist-tags"]?.[tag],
        version: releaseSet.version,
      };
    })
  );
  return { states, tag, version: releaseSet.version };
}

export async function writeGitHubOutput(
  values: Record<string, string | boolean>
) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await appendFile(outputPath, `${lines.join("\n")}\n`);
}

function printStates(states: readonly RegistryState[]): void {
  for (const state of states) {
    const status = state.published ? "published" : "not published";
    console.error(
      `skillset: ${state.name}@${state.version} is ${status} on ${registryUrl}`
    );
    if (state.taggedVersion) {
      console.error(
        `skillset: ${state.name} registry ${state.tag} points to ${state.taggedVersion}`
      );
    }
  }
}

async function run(command: readonly string[], cwd = rootDir) {
  console.error(
    `skillset: running ${command.join(" ")}${cwd === rootDir ? "" : ` in ${cwd}`}`
  );

  const subprocess = Bun.spawn([...command], {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  const exitCode = await subprocess.exited;

  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
}

function outputForPlan(
  mode: "complete" | "publish" | "recover",
  states: readonly RegistryState[],
  tag: string,
  version: string
) {
  const published = states
    .filter((state) => state.published)
    .map((state) => state.name);
  const missing = states
    .filter((state) => !state.published)
    .map((state) => state.name);
  return {
    missing_packages: JSON.stringify(missing),
    name: "skillset",
    partial_release: mode === "recover",
    published: mode === "complete",
    published_packages: JSON.stringify(published),
    registry_complete: mode === "complete",
    should_publish: mode !== "complete",
    tag,
    version,
  };
}

async function commandPlan() {
  const { states, tag, version } = await getRegistryStates();
  printStates(states);
  const plan = planCoordinatedRelease(states, version, tag);
  const versionCommit = await resolveReleaseVersionCommit(rootDir, version);
  await writeGitHubOutput({
    ...outputForPlan(plan.mode, states, tag, version),
    version_commit: versionCommit,
  });
}

function expectedIntegrity(
  packages: readonly StagedReleaseTarball[]
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    packages.map((entry) => [entry.name, entry.integrity])
  );
}

async function commandRegistryCheck(
  requirePublished: boolean,
  stageDir?: string
) {
  const { states, tag, version } = await getRegistryStates();
  printStates(states);
  const staged = stageDir
    ? await readStagedReleaseTarballs(stageDir)
    : undefined;
  const plan = planCoordinatedRelease(
    states,
    version,
    tag,
    staged ? expectedIntegrity(staged.packages) : undefined
  );
  if (requirePublished && plan.mode !== "complete") {
    throw new Error(
      `Coordinated registry set is incomplete for ${version}; missing ${plan.missing.join(", ")}`
    );
  }
}

async function commandCheck() {
  await readReleasePackageSet(rootDir);
  await run(["bun", "run", "check:pack"]);
}

async function waitForPublished(
  spec: ReleasePackageSpec,
  version: string,
  tag: string,
  integrity: string
): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const document = await fetchRegistryDocument(spec.name);
    const published = document?.versions?.[version];
    if (
      published?.dist?.integrity === integrity &&
      published.dist.attestations?.provenance?.predicateType ===
        NPM_PROVENANCE_PREDICATE &&
      document?.["dist-tags"]?.[tag] === version
    ) {
      return;
    }

    console.error(
      `skillset: waiting for ${spec.name}@${version} registry propagation (${attempt}/10)`
    );
    await Bun.sleep(3000);
  }

  throw new Error(
    `${spec.name}@${version} did not become visible with dist-tag ${tag}`
  );
}

async function commandReleaseCheck(
  nativeOutputDir: string,
  stageDir: string
): Promise<void> {
  await commandCheck();
  const staged = await stageReleaseTarballs({
    nativeOutputDir,
    rootPath: rootDir,
    stageDir,
  });
  const current = await getRegistryStates();
  planCoordinatedRelease(
    current.states,
    current.version,
    current.tag,
    expectedIntegrity(staged)
  );
}

async function commandPublish(nativeOutputDir?: string, stageDir?: string) {
  const initial = await getRegistryStates();
  printStates(initial.states);
  if (!nativeOutputDir || !stageDir) {
    throw new Error(
      "Coordinated publication requires --native-out-dir and --stage-dir from the verified release preflight"
    );
  }
  const staged = await readStagedReleaseTarballs(stageDir);
  if (staged.version !== initial.version) {
    throw new Error(
      `Staged release version ${staged.version} does not match product version ${initial.version}`
    );
  }
  const stagedIntegrity = expectedIntegrity(staged.packages);
  const initialPlan = planCoordinatedRelease(
    initial.states,
    initial.version,
    initial.tag,
    stagedIntegrity
  );
  if (initialPlan.mode === "complete") {
    await writeGitHubOutput({
      name: "skillset",
      published: false,
      registry_complete: true,
      tag: initial.tag,
      version: initial.version,
    });
    console.error(
      "skillset: skipping publish because the coordinated version already exists"
    );
    return;
  }
  assertPublishAllowed();

  let publishedAny = false;
  for (const spec of RELEASE_PACKAGE_SPECS) {
    if (!initialPlan.missing.includes(spec.name)) continue;
    const tarball = staged.packages.find((entry) => entry.name === spec.name)!;

    if (spec.role === "launcher") {
      const beforeLauncher = await getRegistryStates();
      const launcherPlan = planCoordinatedRelease(
        beforeLauncher.states,
        beforeLauncher.version,
        beforeLauncher.tag,
        stagedIntegrity
      );
      if (
        launcherPlan.missing.length !== 1 ||
        launcherPlan.missing[0] !== "skillset"
      ) {
        throw new Error(
          `Refusing to publish skillset@${initial.version} before every prerequisite package is visible`
        );
      }
    }

    await run(
      npmPublishCommand(spec, initial.tag, tarball.path),
      resolve(rootDir, spec.directory)
    );
    await waitForPublished(
      spec,
      initial.version,
      initial.tag,
      tarball.integrity
    );
    publishedAny = true;
  }

  const final = await getRegistryStates();
  const finalPlan = planCoordinatedRelease(
    final.states,
    final.version,
    final.tag,
    stagedIntegrity
  );
  if (finalPlan.mode !== "complete") {
    throw new Error(
      `Coordinated registry set did not complete; missing ${finalPlan.missing.join(", ")}`
    );
  }
  await writeGitHubOutput({
    name: "skillset",
    published: publishedAny,
    registry_complete: true,
    tag: final.tag,
    version: final.version,
  });
}

function assertPublishAllowed() {
  if (process.env.GITHUB_ACTIONS === "true") return;
  if (process.env.SKILLSET_ALLOW_LOCAL_PUBLISH === "1") return;

  throw new Error(
    "Refusing to publish outside GitHub Actions; set SKILLSET_ALLOW_LOCAL_PUBLISH=1 only for an explicit release recovery"
  );
}

function readFlagValue(
  args: readonly string[],
  flag: string
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function main() {
  const [command = "plan", ...args] = Bun.argv.slice(2);
  const flags = new Set(args);
  const nativeOutputDir = readFlagValue(args, "--native-out-dir");
  const stageDir = readFlagValue(args, "--stage-dir");

  switch (command) {
    case "check":
      await commandCheck();
      break;
    case "plan":
      await commandPlan();
      break;
    case "publish":
      await commandPublish(nativeOutputDir, stageDir);
      break;
    case "registry-check":
      await commandRegistryCheck(flags.has("--require-published"), stageDir);
      break;
    case "release-check":
      if (!nativeOutputDir || !stageDir) {
        throw new Error(
          "release-check requires --native-out-dir and --stage-dir"
        );
      }
      await commandReleaseCheck(nativeOutputDir, stageDir);
      break;
    default:
      throw new Error(`Unknown publish command: ${command}`);
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
