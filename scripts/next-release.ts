import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ChangedFile,
  isPackageAffectingPath,
  parseChangedFileLine,
} from "../apps/skillset/src/changeset-awareness";
import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { fetchRegistryDocument, writeGitHubOutput } from "./publish";
import {
  RELEASE_PACKAGE_SPECS,
  readReleasePackageSet,
} from "./release-packages";
import { readCiPassed } from "./release-policy";

/**
 * The `next` channel publishes the coordinated seven-package set as
 * `<pending stable version>-next.<n>` from `main` while Changesets are still
 * pending. The prerelease version is applied to the package manifests inside
 * CI only; it is never committed, so the generated version PR and the stable
 * `latest` route stay exactly as they are.
 */

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const stableVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const nextVersionPattern = /^(\d+\.\d+\.\d+)-next\.(0|[1-9]\d*)$/;
export const NEXT_TAG_MATCH = "v*-next.*";

export type NextPublishDecision = {
  readonly publish: boolean;
  readonly reason: string;
};

export function isNextVersion(version: string): boolean {
  return nextVersionPattern.test(version);
}

/**
 * Returns the first unused `<base>-next.<n>` across every registry version
 * already seen for the release packages. Counting all seven packages, not
 * only the launcher, means an abandoned partial prerelease is skipped rather
 * than recovered with different bytes.
 */
export function nextPrereleaseVersion(
  baseVersion: string,
  existingVersions: Iterable<string>
): string {
  if (!stableVersionPattern.test(baseVersion)) {
    throw new Error(
      `next prereleases need a stable base version, found ${baseVersion}`
    );
  }
  let highest = -1;
  for (const version of existingVersions) {
    const match = version.match(nextVersionPattern);
    if (!match || match[1] !== baseVersion) continue;
    highest = Math.max(highest, Number.parseInt(match[2]!, 10));
  }
  return `${baseVersion}-next.${highest + 1}`;
}

export function decideNextPublish(input: {
  readonly changedFiles: readonly ChangedFile[] | undefined;
  readonly force: boolean;
  readonly pendingVersion: string | undefined;
  readonly previousTag: string | undefined;
}): NextPublishDecision {
  if (!input.pendingVersion) {
    return {
      publish: false,
      reason: "no pending public package release; nothing to preview",
    };
  }
  if (input.force) {
    return { publish: true, reason: "manual dispatch requested a next build" };
  }
  if (!input.previousTag || !input.changedFiles) {
    return {
      publish: true,
      reason: "no earlier next prerelease tag is reachable from this commit",
    };
  }
  const packageFiles = input.changedFiles.filter((file) =>
    isPackageAffectingPath(file.path)
  );
  if (packageFiles.length === 0) {
    return {
      publish: false,
      reason: `no package-facing changes since ${input.previousTag}`,
    };
  }
  return {
    publish: true,
    reason: `${packageFiles.length} package-facing path(s) changed since ${input.previousTag}`,
  };
}

/**
 * Rewrites the seven release manifests to one exact `next` version, including
 * the launcher's exact native optional dependencies.
 */
export function applyNextVersionToManifests(
  manifests: Readonly<Record<string, Record<string, unknown>>>,
  version: string
): Record<string, Record<string, unknown>> {
  if (!isNextVersion(version)) {
    throw new Error(
      `Refusing to apply ${version}; next versions look like 1.2.3-next.4`
    );
  }
  const nativeNames = new Set(
    RELEASE_PACKAGE_SPECS.filter((spec) => spec.role === "native").map(
      (spec) => spec.name
    )
  );
  const result: Record<string, Record<string, unknown>> = {};
  for (const spec of RELEASE_PACKAGE_SPECS) {
    const manifest = manifests[spec.directory];
    if (!manifest) {
      throw new Error(`Missing ${spec.directory}/package.json`);
    }
    const next: Record<string, unknown> = { ...manifest, version };
    if (spec.role === "launcher") {
      const optional = manifest.optionalDependencies;
      if (!optional || typeof optional !== "object") {
        throw new Error(
          `${spec.directory}/package.json must declare native optionalDependencies`
        );
      }
      next.optionalDependencies = Object.fromEntries(
        Object.entries(optional as Record<string, unknown>).map(
          ([name, range]) => [name, nativeNames.has(name) ? version : range]
        )
      );
    }
    result[spec.directory] = next;
  }
  return result;
}

async function commandApply(version: string | undefined) {
  if (!version) throw new Error("apply requires --version <x.y.z-next.n>");
  const manifests: Record<string, Record<string, unknown>> = {};
  for (const spec of RELEASE_PACKAGE_SPECS) {
    manifests[spec.directory] = JSON.parse(
      await readFile(join(rootDir, spec.directory, "package.json"), "utf8")
    ) as Record<string, unknown>;
  }
  const updated = applyNextVersionToManifests(manifests, version);
  for (const [directory, manifest] of Object.entries(updated)) {
    await writeFile(
      join(rootDir, directory, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
  }
  const releaseSet = await readReleasePackageSet(rootDir);
  if (releaseSet.version !== version) {
    throw new Error(
      `Applied ${version}, but the release set reads ${releaseSet.version}`
    );
  }
  console.error(
    `skillset: applied ${version} to ${RELEASE_PACKAGE_SPECS.length} release manifests (not committed)`
  );
}

async function readPendingStableVersion(): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "skillset-next-"));
  try {
    const statusPath = join(directory, "changeset-status.json");
    const subprocess = Bun.spawn(
      ["bun", "changeset", "status", "--output", statusPath],
      { cwd: rootDir, env: gitSafeEnv(), stderr: "inherit", stdout: "inherit" }
    );
    if ((await subprocess.exited) !== 0) {
      throw new Error("changeset status failed");
    }
    const status = JSON.parse(await readFile(statusPath, "utf8")) as {
      releases?: { name?: string; newVersion?: string }[];
    };
    const launcher = RELEASE_PACKAGE_SPECS.at(-1)!.name;
    return status.releases?.find((release) => release.name === launcher)
      ?.newVersion;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function readPreviousNextTag(): Promise<string | undefined> {
  const subprocess = Bun.spawn(
    [
      "git",
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      NEXT_TAG_MATCH,
      "HEAD",
    ],
    { cwd: rootDir, env: gitSafeEnv(), stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
  ]);
  const tag = stdout.trim();
  return exitCode === 0 && tag.length > 0 ? tag : undefined;
}

/**
 * Diffs without rename detection so a package-facing file moved out of the
 * package paths still counts through its deletion side.
 */
async function readChangedFilesSince(tag: string): Promise<ChangedFile[]> {
  const subprocess = Bun.spawn(
    ["git", "diff", "--name-status", "--no-renames", `${tag}...HEAD`],
    { cwd: rootDir, env: gitSafeEnv(), stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git diff ${tag}...HEAD failed: ${stderr.trim()}`);
  }
  return stdout
    .split("\n")
    .map(parseChangedFileLine)
    .filter((file): file is ChangedFile => Boolean(file));
}

async function readRegistryVersions(): Promise<string[]> {
  const versions: string[] = [];
  for (const spec of RELEASE_PACKAGE_SPECS) {
    const document = await fetchRegistryDocument(spec.name);
    versions.push(...Object.keys(document?.versions ?? {}));
  }
  return versions;
}

async function commandPlan() {
  const sourceSha = process.env.GITHUB_SHA;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!sourceSha || !repository) {
    throw new Error("next plan runs in GitHub Actions with GITHUB_SHA and GITHUB_REPOSITORY");
  }
  const pendingVersion = await readPendingStableVersion();
  const previousTag = await readPreviousNextTag();
  const changedFiles = previousTag
    ? await readChangedFilesSince(previousTag)
    : undefined;
  const decision = decideNextPublish({
    changedFiles,
    force: process.env.SKILLSET_NEXT_FORCE === "true",
    pendingVersion,
    previousTag,
  });
  console.error(`skillset: next channel: ${decision.reason}`);
  if (!decision.publish || !pendingVersion) {
    await writeGitHubOutput({ should_publish: false });
    return;
  }

  if (!(await readCiPassed(repository, sourceSha))) {
    throw new Error(
      `Exact-SHA CI for ${sourceSha} did not pass; not publishing a next prerelease`
    );
  }

  const version = nextPrereleaseVersion(
    pendingVersion,
    await readRegistryVersions()
  );
  console.error(`skillset: next channel will publish ${version}`);
  await writeGitHubOutput({
    should_publish: true,
    source_sha: sourceSha,
    version,
  });
}

function readFlagValue(args: readonly string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.main) {
  const [command, ...args] = Bun.argv.slice(2);
  try {
    switch (command) {
      case "plan":
        await commandPlan();
        break;
      case "apply":
        await commandApply(readFlagValue(args, "--version"));
        break;
      default:
        throw new Error(`Unknown next-release command: ${command ?? "(none)"}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
