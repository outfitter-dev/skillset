import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  publishAndVerify,
  readReleaseRegistryStates,
  type PublicationIO,
  type RegistryDocument,
} from "./publish-propagation";
import {
  RELEASE_PACKAGE_SPECS,
  npmPublishCommand,
  planCoordinatedRelease,
  readReleasePackageSet,
  type ReleaseRegistryState,
  type CoordinatedReleasePlan,
  type ReleasePackageSpec,
} from "./release-packages";
import { resolveReleaseVersionCommit } from "./release-ref";
import {
  readStagedReleaseTarballs,
  stageReleaseTarballs,
  type StagedReleaseTarball,
} from "./release-tarballs";

interface RegistryState extends ReleaseRegistryState {
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

async function fetchRegistryDocument(
  name: string,
  signal = AbortSignal.timeout(30_000)
) {
  const url = `${registryUrl}/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal,
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
  const states = (
    await readReleaseRegistryStates(
      releaseSet.packages.map((spec) => ({
        name: spec.name,
        version: releaseSet.version,
        tag,
      })),
      {
        read: fetchRegistryDocument,
        sleep: Bun.sleep,
        now: () => performance.now(),
        log: console.error,
      }
    )
  ).map(
    (state): RegistryState => ({
      ...state,
      tag,
      version: releaseSet.version,
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

export async function publishReleasePackages(
  initial: { version: string; tag: string },
  initialPlan: CoordinatedReleasePlan,
  packages: readonly StagedReleaseTarball[],
  io: Omit<PublicationIO, "publish"> & {
    readonly states: () => Promise<{
      states: readonly ReleaseRegistryState[];
      version: string;
      tag: string;
    }>;
    readonly publish: (
      spec: ReleasePackageSpec,
      tarballPath: string
    ) => ReturnType<PublicationIO["publish"]>;
  }
): Promise<boolean> {
  const stagedIntegrity = expectedIntegrity(packages);
  let publishedAny = false;
  for (const spec of RELEASE_PACKAGE_SPECS) {
    if (!initialPlan.missing.includes(spec.name)) continue;
    const tarball = packages.find((entry) => entry.name === spec.name)!;

    if (spec.role === "launcher") {
      const beforeLauncher = await io.states();
      const launcherPlan = planCoordinatedRelease(
        beforeLauncher.states,
        beforeLauncher.version,
        beforeLauncher.tag,
        stagedIntegrity
      );
      if (
        launcherPlan.mode !== "complete" &&
        (launcherPlan.missing.length !== 1 ||
          launcherPlan.missing[0] !== "skillset")
      ) {
        throw new Error(
          `Refusing to publish skillset@${initial.version} before every prerequisite package is visible`
        );
      }
    }

    const published = await publishAndVerify(
      {
        name: spec.name,
        version: initial.version,
        tag: initial.tag,
        integrity: tarball.integrity,
      },
      { ...io, publish: () => io.publish(spec, tarball.path) }
    );
    publishedAny ||= published;
  }

  const final = await io.states();
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
  return publishedAny;
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

  const publishedAny = await publishReleasePackages(
    initial,
    initialPlan,
    staged.packages,
    {
      read: fetchRegistryDocument,
      states: getRegistryStates,
      sleep: Bun.sleep,
      now: () => performance.now(),
      log: console.error,
      publish: async (spec, tarballPath) => {
        const command = npmPublishCommand(spec, initial.tag, tarballPath);
        console.error(`skillset: running ${command.join(" ")}`);
        const subprocess = Bun.spawn([...command], {
          cwd: resolve(rootDir, spec.directory),
          stderr: "pipe",
          stdin: "inherit",
          stdout: "inherit",
        });
        const [exitCode, stderr] = await Promise.all([
          subprocess.exited,
          new Response(subprocess.stderr).text(),
        ]);
        process.stderr.write(stderr);
        return { exitCode, stderr };
      },
    }
  );
  await writeGitHubOutput({
    name: "skillset",
    published: publishedAny,
    registry_complete: true,
    tag: initial.tag,
    version: initial.version,
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
