import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  nativeManifestName,
  parseNativeManifest,
  type NativeArtifactManifest,
} from "./native-artifacts";
import {
  RELEASE_NPM_VERSION,
  RELEASE_PACKAGE_SPECS,
  type ReleasePackageSpec,
} from "./release-packages";
import {
  expectedReleaseTarballFiles,
  readStagedReleaseTarballs,
  stageReleaseTarballs,
  tarballIntegrity,
  type StagedReleaseTarball,
} from "./release-tarballs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const registryUrl = "https://registry.npmjs.org";
const manifestName = "npm-bootstrap-packages.json";

export const NPM_BOOTSTRAP_VERSION = "0.22.2" as const;
export const NPM_BOOTSTRAP_PACKAGE_SPECS: readonly ReleasePackageSpec[] =
  RELEASE_PACKAGE_SPECS.filter((spec) => spec.role !== "launcher");

export interface NpmBootstrapRegistryState {
  readonly integrity?: string | undefined;
  readonly name: string;
  readonly published: boolean;
  readonly registered: boolean;
  readonly taggedVersion?: string | undefined;
}

export interface NpmBootstrapPlan {
  readonly missing: readonly string[];
  readonly mode: "complete" | "publish" | "recover";
  readonly published: readonly string[];
}

type RegistryDocument = {
  "dist-tags"?: Record<string, string | undefined>;
  versions?: Record<string, { dist?: { integrity?: unknown } }>;
};

type BootstrapManifest = {
  npmVersion: string;
  packages: Array<Omit<StagedReleaseTarball, "path">>;
  schemaVersion: 1;
  sourceCommit: string;
  version: string;
};

export function npmBootstrapPublishCommand(
  tarballPath: string,
  userConfigPath: string,
  globalConfigPath: string
): readonly string[] {
  return [
    "npm",
    "publish",
    tarballPath,
    "--access",
    "public",
    "--tag",
    "latest",
    "--registry",
    registryUrl,
    "--userconfig",
    userConfigPath,
    "--globalconfig",
    globalConfigPath,
  ];
}

export function npmBootstrapLoginCommand(
  userConfigPath: string,
  globalConfigPath: string
): readonly string[] {
  return [
    "npm",
    "login",
    "--auth-type",
    "web",
    "--registry",
    registryUrl,
    "--userconfig",
    userConfigPath,
    "--globalconfig",
    globalConfigPath,
  ];
}

export function npmBootstrapEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) =>
        value !== undefined &&
        !key.toUpperCase().startsWith("NPM_CONFIG_") &&
        !/^(?:NPM|NODE)_.*(?:AUTH|TOKEN)/iu.test(key)
    )
  ) as Record<string, string>;
}

export function npmBootstrapFilename(spec: ReleasePackageSpec): string {
  return `${spec.name.slice(1).replace("/", "-")}-${NPM_BOOTSTRAP_VERSION}.tgz`;
}

export function planNpmBootstrap(
  states: readonly NpmBootstrapRegistryState[],
  expectedIntegrity: Readonly<Record<string, string>>
): NpmBootstrapPlan {
  const expectedNames = NPM_BOOTSTRAP_PACKAGE_SPECS.map((spec) => spec.name);
  if (
    JSON.stringify(states.map((state) => state.name)) !==
    JSON.stringify(expectedNames)
  ) {
    throw new Error(
      `npm bootstrap state must cover exactly ${expectedNames.join(", ")} in canonical order`
    );
  }

  let reachedMissing = false;
  for (const state of states) {
    if (!state.registered) {
      reachedMissing = true;
      continue;
    }
    if (!state.published) {
      throw new Error(
        `${state.name} is already registered without ${NPM_BOOTSTRAP_VERSION}; investigate before bootstrapping`
      );
    }
    if (state.taggedVersion !== NPM_BOOTSTRAP_VERSION) {
      throw new Error(
        `${state.name} latest points to ${state.taggedVersion ?? "nothing"}, expected ${NPM_BOOTSTRAP_VERSION}`
      );
    }
    if (state.integrity !== expectedIntegrity[state.name]) {
      throw new Error(
        `${state.name}@${NPM_BOOTSTRAP_VERSION} registry integrity does not match the staged bootstrap tarball`
      );
    }
    if (reachedMissing) {
      throw new Error(
        `${state.name}@${NPM_BOOTSTRAP_VERSION} appears after a missing bootstrap prerequisite`
      );
    }
  }

  const published = states
    .filter((state) => state.published)
    .map((state) => state.name);
  const missing = states
    .filter((state) => !state.registered)
    .map((state) => state.name);
  if (missing.length === 0) return { missing, mode: "complete", published };
  return {
    missing,
    mode: published.length === 0 ? "publish" : "recover",
    published,
  };
}

export function validateBootstrapSourceState(state: {
  readonly branch: string;
  readonly head: string;
  readonly originMain: string;
  readonly status: string;
}): void {
  if (state.branch !== "main") {
    throw new Error(
      `npm bootstrap publication must run from main, found ${state.branch || "detached HEAD"}`
    );
  }
  if (state.status.length > 0) {
    throw new Error("npm bootstrap publication requires a clean worktree");
  }
  if (state.head !== state.originMain) {
    throw new Error(
      `npm bootstrap publication requires HEAD ${state.head} to equal origin/main ${state.originMain}`
    );
  }
}

export function validateBootstrapPublicationSourceCommit(
  stagedSourceCommit: string,
  liveMainCommit: string
): void {
  if (stagedSourceCommit !== liveMainCommit) {
    throw new Error(
      `npm bootstrap stage came from ${stagedSourceCommit}, expected live main ${liveMainCommit}; rebuild the stage`
    );
  }
}

export function validateBootstrapStageSourceState(state: {
  readonly head: string;
  readonly status: string;
}): void {
  if (!/^[0-9a-f]{40}$/u.test(state.head)) {
    throw new Error(
      "npm bootstrap staging requires a committed source revision"
    );
  }
  if (state.status.length > 0) {
    throw new Error("npm bootstrap staging requires a clean worktree");
  }
}

export function validateBootstrapNativeManifest(
  manifest: NativeArtifactManifest,
  sourceCommit: string
): void {
  if (manifest.version !== NPM_BOOTSTRAP_VERSION) {
    throw new Error(
      `npm bootstrap native manifest must be ${NPM_BOOTSTRAP_VERSION}, found ${manifest.version}`
    );
  }
  if (manifest.commit !== sourceCommit) {
    throw new Error(
      `npm bootstrap native artifacts came from ${manifest.commit}, expected staged source ${sourceCommit}`
    );
  }
}

export async function writeNpmBootstrapStage(options: {
  readonly packages: readonly StagedReleaseTarball[];
  readonly sourceCommit: string;
  readonly stageDir: string;
  readonly version: string;
}): Promise<readonly StagedReleaseTarball[]> {
  if (options.version !== NPM_BOOTSTRAP_VERSION) {
    throw new Error(
      `npm bootstrap is fixed to ${NPM_BOOTSTRAP_VERSION}, found ${options.version}`
    );
  }
  if (!/^[0-9a-f]{40}$/u.test(options.sourceCommit)) {
    throw new Error("npm bootstrap stage requires an exact source commit");
  }
  const sourceByName = new Map(
    options.packages.map((entry) => [entry.name, entry])
  );
  const stageDir = resolve(options.stageDir);
  await mkdir(stageDir, { recursive: true });
  if ((await readdir(stageDir)).length > 0) {
    throw new Error(
      `npm bootstrap staging directory must be empty: ${stageDir}`
    );
  }

  const packages: StagedReleaseTarball[] = [];
  for (const spec of NPM_BOOTSTRAP_PACKAGE_SPECS) {
    const source = sourceByName.get(spec.name);
    if (!source) {
      throw new Error(
        `release staging is missing npm bootstrap package ${spec.name}`
      );
    }
    const path = join(stageDir, source.filename);
    await copyFile(source.path, path);
    packages.push({ ...source, path });
  }
  const manifest: BootstrapManifest = {
    npmVersion: RELEASE_NPM_VERSION,
    packages: packages.map(({ path: _path, ...entry }) => entry),
    schemaVersion: 1,
    sourceCommit: options.sourceCommit,
    version: options.version,
  };
  await writeFile(
    join(stageDir, manifestName),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await assertExactBootstrapEntries(stageDir, packages);
  return packages;
}

export async function readNpmBootstrapStage(stagePath: string): Promise<{
  readonly packages: readonly StagedReleaseTarball[];
  readonly sourceCommit: string;
  readonly version: string;
}> {
  const stageDir = resolve(stagePath);
  const npmVersion = await capture(["npm", "--version"]);
  return readNpmBootstrapStageForNpmVersion(stageDir, npmVersion);
}

export async function readNpmBootstrapStageForNpmVersion(
  stagePath: string,
  npmVersion: string
): Promise<{
  readonly packages: readonly StagedReleaseTarball[];
  readonly sourceCommit: string;
  readonly version: string;
}> {
  const stageDir = resolve(stagePath);
  if (npmVersion !== RELEASE_NPM_VERSION) {
    throw new Error(
      `npm bootstrap requires npm ${RELEASE_NPM_VERSION}, found ${npmVersion}`
    );
  }
  const manifest = JSON.parse(
    await readFile(join(stageDir, manifestName), "utf8")
  ) as Partial<BootstrapManifest>;
  if (
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(
        [
          "npmVersion",
          "packages",
          "schemaVersion",
          "sourceCommit",
          "version",
        ].sort()
      ) ||
    manifest.schemaVersion !== 1 ||
    manifest.npmVersion !== RELEASE_NPM_VERSION ||
    manifest.version !== NPM_BOOTSTRAP_VERSION ||
    typeof manifest.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(manifest.sourceCommit) ||
    !Array.isArray(manifest.packages)
  ) {
    throw new Error("npm bootstrap manifest is missing or invalid");
  }
  const expectedNames = NPM_BOOTSTRAP_PACKAGE_SPECS.map((spec) => spec.name);
  if (
    JSON.stringify(manifest.packages.map((entry) => entry.name)) !==
    JSON.stringify(expectedNames)
  ) {
    throw new Error(
      "npm bootstrap manifest does not use canonical package order"
    );
  }

  const packages: StagedReleaseTarball[] = [];
  for (const [index, entry] of manifest.packages.entries()) {
    const spec = NPM_BOOTSTRAP_PACKAGE_SPECS[index]!;
    if (
      !entry ||
      typeof entry !== "object" ||
      JSON.stringify(Object.keys(entry).sort()) !==
        JSON.stringify(["directory", "filename", "integrity", "name"].sort()) ||
      entry.directory !== spec.directory ||
      entry.name !== spec.name ||
      entry.filename !== npmBootstrapFilename(spec) ||
      typeof entry.integrity !== "string"
    ) {
      throw new Error(
        `npm bootstrap manifest entry is invalid for ${spec.name}`
      );
    }
    const path = join(stageDir, entry.filename);
    const integrity = tarballIntegrity(new Uint8Array(await readFile(path)));
    if (integrity !== entry.integrity) {
      throw new Error(
        `${spec.name} staged bootstrap tarball integrity changed`
      );
    }
    await validateBootstrapTarball(spec, path);
    packages.push({ ...entry, path } as StagedReleaseTarball);
  }
  await assertExactBootstrapEntries(stageDir, packages);
  return {
    packages,
    sourceCommit: manifest.sourceCommit,
    version: manifest.version,
  };
}

export async function validateBootstrapTarball(
  spec: ReleasePackageSpec,
  tarballPath: string
): Promise<void> {
  const output = await capture([
    "npm",
    "pack",
    "--dry-run",
    "--ignore-scripts",
    "--json",
    tarballPath,
  ]);
  const result = JSON.parse(output) as Array<{
    files?: Array<{ path?: unknown }>;
    name?: unknown;
    version?: unknown;
  }>;
  const inspected = result.length === 1 ? result[0] : undefined;
  const actualFiles = (inspected?.files ?? [])
    .map((entry) => entry.path)
    .filter((entry): entry is string => typeof entry === "string")
    .sort();
  const expectedFiles = [...expectedReleaseTarballFiles(spec)].sort();
  if (
    inspected?.name !== spec.name ||
    inspected.version !== NPM_BOOTSTRAP_VERSION ||
    JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)
  ) {
    throw new Error(
      `${spec.name} bootstrap tarball identity or exact payload is invalid`
    );
  }
}

async function assertExactBootstrapEntries(
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
      `npm bootstrap stage must contain exactly ${expected.join(", ")}`
    );
  }
}

async function fetchRegistryDocument(
  name: string
): Promise<RegistryDocument | null> {
  const response = await fetch(`${registryUrl}/${encodeURIComponent(name)}`, {
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

async function getRegistryStates(): Promise<
  readonly NpmBootstrapRegistryState[]
> {
  return Promise.all(
    NPM_BOOTSTRAP_PACKAGE_SPECS.map(async (spec) => {
      const document = await fetchRegistryDocument(spec.name);
      const published = document?.versions?.[NPM_BOOTSTRAP_VERSION];
      return {
        integrity:
          typeof published?.dist?.integrity === "string"
            ? published.dist.integrity
            : undefined,
        name: spec.name,
        published: Boolean(published),
        registered: document !== null,
        taggedVersion: document?.["dist-tags"]?.latest,
      };
    })
  );
}

function expectedIntegrity(
  packages: readonly StagedReleaseTarball[]
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    packages.map((entry) => [entry.name, entry.integrity])
  );
}

async function capture(
  command: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
): Promise<string> {
  const subprocess = Bun.spawn([...command], {
    cwd: options.cwd ?? rootDir,
    ...(options.env ? { env: { ...options.env } } : {}),
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

async function runInteractive(
  command: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
): Promise<void> {
  console.error(`skillset: running ${command.join(" ")}`);
  const subprocess = Bun.spawn([...command], {
    cwd: options.cwd ?? rootDir,
    ...(options.env ? { env: { ...options.env } } : {}),
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
}

async function waitForPublished(
  spec: ReleasePackageSpec,
  integrity: string
): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const document = await fetchRegistryDocument(spec.name);
    const published = document?.versions?.[NPM_BOOTSTRAP_VERSION];
    if (
      published?.dist?.integrity === integrity &&
      document?.["dist-tags"]?.latest === NPM_BOOTSTRAP_VERSION
    ) {
      return;
    }
    console.error(
      `skillset: waiting for ${spec.name}@${NPM_BOOTSTRAP_VERSION} registry propagation (${attempt}/10)`
    );
    await Bun.sleep(3000);
  }
  throw new Error(
    `${spec.name}@${NPM_BOOTSTRAP_VERSION} did not become visible with exact integrity`
  );
}

async function assertPublicationSource(): Promise<string> {
  const remoteMain = await capture([
    "git",
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/heads/main",
  ]);
  const originMain = remoteMain.split(/\s+/u)[0];
  if (!originMain || !/^[0-9a-f]{40}$/u.test(originMain)) {
    throw new Error(
      "npm bootstrap could not resolve the live origin/main commit"
    );
  }
  validateBootstrapSourceState({
    branch: await capture(["git", "branch", "--show-current"]),
    head: await capture(["git", "rev-parse", "HEAD"]),
    originMain,
    status: await capture(["git", "status", "--porcelain"]),
  });
  return originMain;
}

async function assertStagedPublicationSource(
  stagedSourceCommit: string
): Promise<void> {
  validateBootstrapPublicationSourceCommit(
    stagedSourceCommit,
    await assertPublicationSource()
  );
}

async function commandStage(
  nativeOutputDir: string,
  stageDir: string
): Promise<void> {
  const sourceCommit = await capture(["git", "rev-parse", "HEAD"]);
  validateBootstrapStageSourceState({
    head: sourceCommit,
    status: await capture(["git", "status", "--porcelain"]),
  });
  validateBootstrapNativeManifest(
    parseNativeManifest(
      JSON.parse(
        await readFile(
          join(nativeOutputDir, nativeManifestName(NPM_BOOTSTRAP_VERSION)),
          "utf8"
        )
      )
    ),
    sourceCommit
  );
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "skillset-npm-bootstrap-")
  );
  try {
    const fullStage = join(temporaryRoot, "release");
    const staged = await stageReleaseTarballs({
      nativeOutputDir,
      rootPath: rootDir,
      stageDir: fullStage,
    });
    const release = await readStagedReleaseTarballs(fullStage);
    if (release.packages.length !== staged.length) {
      throw new Error(
        "release tarball staging changed before npm bootstrap projection"
      );
    }
    await writeNpmBootstrapStage({
      packages: release.packages,
      sourceCommit,
      stageDir,
      version: release.version,
    });
    const { packages } = await readNpmBootstrapStage(stageDir);
    const states = await getRegistryStates();
    const plan = planNpmBootstrap(states, expectedIntegrity(packages));
    console.error(
      `skillset: npm bootstrap ${plan.mode}; ${packages.length} exact packages staged at ${resolve(stageDir)}`
    );
    for (const entry of packages) {
      console.error(
        `skillset: staged ${entry.name}@${NPM_BOOTSTRAP_VERSION} ${entry.integrity}`
      );
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function commandPublish(
  stageDir: string,
  confirmedVersion?: string
): Promise<void> {
  if (confirmedVersion !== NPM_BOOTSTRAP_VERSION) {
    throw new Error(
      `publish requires --confirm-version ${NPM_BOOTSTRAP_VERSION}`
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "npm bootstrap publication requires an interactive terminal for npm 2FA"
    );
  }
  const staged = await readNpmBootstrapStage(stageDir);
  await assertStagedPublicationSource(staged.sourceCommit);
  const integrity = expectedIntegrity(staged.packages);
  const initial = await getRegistryStates();
  const plan = planNpmBootstrap(initial, integrity);
  if (plan.mode === "complete") {
    console.error(
      "skillset: npm bootstrap packages already match the exact staged set"
    );
    return;
  }

  const authRoot = await mkdtemp(join(tmpdir(), "skillset-npm-auth-"));
  try {
    const userConfigPath = join(authRoot, "user.npmrc");
    const globalConfigPath = join(authRoot, "global.npmrc");
    await Promise.all([
      writeFile(userConfigPath, "", { mode: 0o600 }),
      writeFile(globalConfigPath, "", { mode: 0o600 }),
    ]);
    const environment = npmBootstrapEnvironment(process.env);
    await runInteractive(
      npmBootstrapLoginCommand(userConfigPath, globalConfigPath),
      { cwd: authRoot, env: environment }
    );
    const npmOptions = [
      "--registry",
      registryUrl,
      "--userconfig",
      userConfigPath,
      "--globalconfig",
      globalConfigPath,
    ];
    const user = await capture(["npm", "whoami", ...npmOptions], {
      cwd: authRoot,
      env: environment,
    });
    const profile = JSON.parse(
      await capture(["npm", "profile", "get", "--json", ...npmOptions], {
        cwd: authRoot,
        env: environment,
      })
    ) as { tfa?: { mode?: unknown; pending?: unknown } };
    if (profile.tfa?.mode !== "auth-and-writes" || profile.tfa.pending) {
      throw new Error(
        "npm bootstrap requires the authenticated account to use auth-and-writes 2FA"
      );
    }
    console.error(
      `skillset: authenticated to npm as ${user} with auth-and-writes 2FA`
    );
    for (const spec of NPM_BOOTSTRAP_PACKAGE_SPECS) {
      if (!plan.missing.includes(spec.name)) continue;
      const currentPlan = planNpmBootstrap(
        await getRegistryStates(),
        integrity
      );
      if (currentPlan.missing[0] !== spec.name) {
        throw new Error(
          `npm bootstrap registry state changed before ${spec.name}; stop and restage`
        );
      }
      const tarball = staged.packages.find(
        (entry) => entry.name === spec.name
      )!;
      await assertStagedPublicationSource(staged.sourceCommit);
      await runInteractive(
        npmBootstrapPublishCommand(
          tarball.path,
          userConfigPath,
          globalConfigPath
        ),
        { cwd: authRoot, env: environment }
      );
      await waitForPublished(spec, tarball.integrity);
    }
  } finally {
    await rm(authRoot, { force: true, recursive: true });
  }

  const finalPlan = planNpmBootstrap(await getRegistryStates(), integrity);
  if (finalPlan.mode !== "complete") {
    throw new Error(
      `npm bootstrap did not complete; missing ${finalPlan.missing.join(", ")}`
    );
  }
  console.error(
    "skillset: npm bootstrap complete; configure release.yml as the trusted publisher for all seven packages before 0.23.0"
  );
}

function readFlagValue(
  args: readonly string[],
  flag: string
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  const nativeOutputDir = readFlagValue(args, "--native-out-dir");
  const stageDir = readFlagValue(args, "--stage-dir");
  if (command === "stage") {
    if (!nativeOutputDir || !stageDir) {
      throw new Error("stage requires --native-out-dir and --stage-dir");
    }
    await commandStage(nativeOutputDir, stageDir);
    return;
  }
  if (command === "publish") {
    if (!stageDir) throw new Error("publish requires --stage-dir");
    await commandPublish(stageDir, readFlagValue(args, "--confirm-version"));
    return;
  }
  throw new Error(
    "usage: bun run publish:bootstrap -- <stage|publish> [options]"
  );
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
