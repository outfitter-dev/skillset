import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type DistTags = Record<string, string | undefined>;

type RegistryDocument = {
  "dist-tags"?: DistTags;
  versions?: Record<string, unknown>;
};

type PackageJson = {
  name?: string;
  version?: string;
};

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDir = join(rootDir, "apps", "skillset");
const packageJsonPath = join(packageDir, "package.json");
const registryUrl = "https://registry.npmjs.org";
const allowedPrereleaseTags = new Set(["alpha", "beta", "canary", "next", "rc"]);

async function readPackageInfo() {
  const raw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(raw) as PackageJson;

  if (!packageJson.name || !packageJson.version) {
    throw new Error(`Missing name or version in ${packageJsonPath}`);
  }

  return {
    name: packageJson.name,
    tag: distTagForVersion(packageJson.version),
    version: packageJson.version,
  };
}

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
    throw new Error(`Registry lookup failed for ${name}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as RegistryDocument;
}

async function getRegistryState() {
  const info = await readPackageInfo();
  const document = await fetchRegistryDocument(info.name);
  const published = Boolean(document?.versions?.[info.version]);
  const taggedVersion = document?.["dist-tags"]?.[info.tag];

  return { ...info, document, published, taggedVersion };
}

function registryComplete(state: Awaited<ReturnType<typeof getRegistryState>>) {
  return state.published && state.taggedVersion === state.version;
}

export async function writeGitHubOutput(values: Record<string, string | boolean>) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await appendFile(outputPath, `${lines.join("\n")}\n`);
}

function printState(state: Awaited<ReturnType<typeof getRegistryState>>) {
  const status = state.published ? "published" : "not published";
  console.error(`skillset: ${state.name}@${state.version} is ${status} on ${registryUrl}`);
  console.error(`skillset: intended dist-tag is ${state.tag}`);

  if (state.taggedVersion) {
    console.error(`skillset: registry ${state.tag} currently points to ${state.taggedVersion}`);
  }
}

async function run(command: string[], cwd = rootDir) {
  console.error(`skillset: running ${command.join(" ")}${cwd === rootDir ? "" : ` in ${cwd}`}`);

  const subprocess = Bun.spawn(command, {
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

async function commandPlan() {
  const state = await getRegistryState();
  printState(state);

  if (state.published && !registryComplete(state)) {
    throw new Error(
      `${state.name}@${state.version} exists, but ${state.tag} points to ${state.taggedVersion ?? "nothing"}`
    );
  }

  await writeGitHubOutput({
    name: state.name,
    published: state.published,
    registry_complete: registryComplete(state),
    should_publish: !state.published,
    tag: state.tag,
    version: state.version,
  });
}

async function commandRegistryCheck(requirePublished: boolean) {
  const state = await getRegistryState();
  printState(state);

  if (!requirePublished) return;

  if (!state.published) {
    throw new Error(`${state.name}@${state.version} is not visible on ${registryUrl}`);
  }

  if (state.taggedVersion !== state.version) {
    throw new Error(`${state.name}@${state.version} is published, but ${state.tag} points to ${state.taggedVersion ?? "nothing"}`);
  }
}

async function commandCheck() {
  const state = await getRegistryState();
  printState(state);

  await run(["bun", "run", "build:npm"]);
  await run(["bun", "pm", "pack", "--dry-run"], packageDir);
}

async function waitForPublished() {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const state = await getRegistryState();
    if (state.published && state.taggedVersion === state.version) return state;

    console.error(`skillset: waiting for registry propagation (${attempt}/10)`);
    await Bun.sleep(3000);
  }

  const finalState = await getRegistryState();
  throw new Error(`${finalState.name}@${finalState.version} did not become visible with dist-tag ${finalState.tag}`);
}

async function commandPublish() {
  const state = await getRegistryState();
  printState(state);

  if (state.published) {
    if (!registryComplete(state)) {
      throw new Error(
        `${state.name}@${state.version} exists, but ${state.tag} points to ${state.taggedVersion ?? "nothing"}`
      );
    }

    await writeGitHubOutput({
      name: state.name,
      published: false,
      registry_complete: true,
      tag: state.tag,
      version: state.version,
    });
    console.error("skillset: skipping publish because this version already exists");
    return;
  }

  assertPublishAllowed();
  await run(["bun", "run", "build:npm"]);
  await run(["npm", "publish", "--access", "public", "--tag", state.tag], packageDir);

  const publishedState = await waitForPublished();
  await writeGitHubOutput({
    name: publishedState.name,
    published: true,
    registry_complete: true,
    tag: publishedState.tag,
    version: publishedState.version,
  });
}

function assertPublishAllowed() {
  if (process.env.GITHUB_ACTIONS === "true") return;
  if (process.env.SKILLSET_ALLOW_LOCAL_PUBLISH === "1") return;

  throw new Error(
    "Refusing to publish outside GitHub Actions; set SKILLSET_ALLOW_LOCAL_PUBLISH=1 only for an explicit release recovery"
  );
}

async function main() {
  const [command = "plan", ...args] = Bun.argv.slice(2);
  const flags = new Set(args);

  switch (command) {
    case "check":
      await commandCheck();
      break;
    case "plan":
      await commandPlan();
      break;
    case "publish":
      await commandPublish();
      break;
    case "registry-check":
      await commandRegistryCheck(flags.has("--require-published"));
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
