import { createHash } from "node:crypto";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";

import { getProviderValidationLane } from "../packages/registry/src/provider-validation";
import { createProviderProbeEnvironment } from "./provider-probe-environment";
import {
  assertContained,
  assertTreeHasNoSymlinks,
  resolveContainedExisting,
  type ProviderArtifactInventory,
} from "./provider-validation-artifacts";

export interface ToolPaths {
  readonly agentSkills: string;
  readonly claude: string;
  readonly codex: string;
  readonly codexPython: string;
  readonly codexValidator: string;
  readonly cursor: string;
}

export async function acquireTools(temp: string): Promise<ToolPaths> {
  const downloads = join(temp, "downloads");
  const tools = join(temp, "tools");
  await mkdir(downloads, { recursive: true });
  await mkdir(tools, { recursive: true });

  const claudeLane = getProviderValidationLane("claude-product");
  const claudeArchive = join(downloads, "claude.tgz");
  const claudeNativeArchive = join(downloads, "claude-linux-x64.tgz");
  await downloadVerified(claudeLane.acquisitions[0]!, claudeArchive);
  await downloadVerified(claudeLane.acquisitions[1]!, claudeNativeArchive);
  const claudeRoot = join(tools, "claude");
  const claudePackageRoot = join(
    claudeRoot,
    "node_modules",
    "@anthropic-ai",
    "claude-code"
  );
  const claudeNativeRoot = join(
    claudeRoot,
    "node_modules",
    "@anthropic-ai",
    "claude-code-linux-x64"
  );
  await Promise.all(
    [claudePackageRoot, claudeNativeRoot].map((path) =>
      mkdir(path, { recursive: true })
    )
  );
  await runRequired(
    [
      "tar",
      "-xzf",
      claudeArchive,
      "--strip-components=1",
      "-C",
      claudePackageRoot,
    ],
    temp
  );
  await runRequired(
    [
      "tar",
      "-xzf",
      claudeNativeArchive,
      "--strip-components=1",
      "-C",
      claudeNativeRoot,
    ],
    temp
  );
  await verifyNodePackages(
    claudeRoot,
    {
      "@anthropic-ai/claude-code": claudeLane.version,
      "@anthropic-ai/claude-code-linux-x64": claudeLane.version,
    },
    temp
  );

  const codexLane = getProviderValidationLane("codex-authoring");
  const codexValidator = join(tools, "codex", "validate_plugin.py");
  await mkdir(dirname(codexValidator), { recursive: true });
  await downloadVerified(codexLane.acquisitions[0]!, codexValidator);
  await downloadVerified(
    codexLane.acquisitions[1]!,
    join(dirname(codexValidator), "identifier_validation.py")
  );
  const codexConsumerArchive = join(downloads, "codex-linux-x64.tgz");
  await downloadVerified(codexLane.acquisitions[2]!, codexConsumerArchive);
  const codexConsumerRoot = join(tools, "codex-consumer");
  await mkdir(codexConsumerRoot, { recursive: true });
  await runRequired(
    [
      "tar",
      "-xzf",
      codexConsumerArchive,
      "--strip-components=1",
      "-C",
      codexConsumerRoot,
    ],
    temp
  );
  const codexVenv = join(tools, "codex", "venv");
  await runRequired(["python3", "-m", "venv", codexVenv], temp);
  const codexPython = join(codexVenv, "bin", "python");
  const pyyaml = codexLane.dependencies[0]!;
  if (pyyaml.url === undefined)
    throw new Error("skillset: PyYAML dependency must own an acquisition URL");
  const pyyamlWheel = join(downloads, basename(new URL(pyyaml.url).pathname));
  await downloadVerified({ ...pyyaml, url: pyyaml.url }, pyyamlWheel);
  await runRequired(
    [
      codexPython,
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-index",
      "--no-deps",
      pyyamlWheel,
    ],
    temp
  );
  await runRequired(
    [codexPython, "-c", "import yaml; assert yaml.__version__ == '6.0.3'"],
    temp
  );

  const cursorLane = getProviderValidationLane("cursor-authoring");
  const cursorRoot = join(tools, "cursor");
  await mkdir(join(cursorRoot, "scripts"), { recursive: true });
  await mkdir(join(cursorRoot, "schemas"), { recursive: true });
  await downloadVerified(
    cursorLane.acquisitions[0]!,
    join(cursorRoot, "scripts", "validate-plugins.mjs")
  );
  await downloadVerified(
    cursorLane.acquisitions[1]!,
    join(cursorRoot, "schemas", "plugin.schema.json")
  );
  await downloadVerified(
    cursorLane.acquisitions[2]!,
    join(cursorRoot, "schemas", "marketplace.schema.json")
  );
  const cursorArchives: string[] = [];
  for (const dependency of cursorLane.dependencies) {
    if (dependency.url === undefined)
      throw new Error(
        `skillset: cursor dependency ${dependency.name} must own an acquisition URL`
      );
    const archive = join(
      downloads,
      `${dependency.name}-${dependency.version}.tgz`
    );
    await downloadVerified({ ...dependency, url: dependency.url }, archive);
    cursorArchives.push(archive);
  }
  await runRequired(
    [
      "npm",
      "install",
      "--prefix",
      cursorRoot,
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...cursorArchives,
    ],
    temp
  );
  await verifyNodePackages(
    cursorRoot,
    Object.fromEntries(
      cursorLane.dependencies.map(({ name, version }) => [name, version])
    ),
    temp
  );

  const agentLane = getProviderValidationLane("agent-skills-reference");
  const agentArchive = join(downloads, "agentskills.tar.gz");
  await downloadVerified(agentLane.acquisitions[0]!, agentArchive);
  await runRequired(["tar", "-xzf", agentArchive, "-C", tools], temp);
  const agentRoot = join(tools, `agentskills-${agentLane.pin}`, "skills-ref");
  await verifyFileHash(
    join(agentRoot, "uv.lock"),
    "sha256:c2d1b9a8638e81f763f04928e8107741886160b6bda2b8cb9784336bebeec94a"
  );
  await verifyFileHash(
    join(agentRoot, "pyproject.toml"),
    "sha256:4333dea52ff4a4fe87f96e5a25f2517a57127bbabb09cb30f3d9057da77a5967"
  );
  await runRequired(
    ["uv", "sync", "--frozen", "--no-dev", "--project", agentRoot],
    temp
  );

  return {
    agentSkills: agentRoot,
    claude: join(
      claudeRoot,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "cli-wrapper.cjs"
    ),
    codex: join(
      codexConsumerRoot,
      "vendor",
      "x86_64-unknown-linux-musl",
      "bin",
      "codex"
    ),
    codexPython,
    codexValidator,
    cursor: cursorRoot,
  };
}

export async function stageValidationInputs(
  root: string,
  temp: string,
  inventory: ProviderArtifactInventory,
  tools: ToolPaths
): Promise<{
  readonly agentCanary: string;
  readonly claudeCanary: string;
  readonly codexCanary: string;
  readonly codexMarketplaceRoots: readonly string[];
  readonly cursorCanary: string;
  readonly cursorRoots: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly inventory: ProviderArtifactInventory;
}> {
  const canonicalRoot = await realpath(root);
  const stage = join(temp, "stage");
  await mkdir(stage, { recursive: true });
  const { env: environment } = await createProviderProbeEnvironment({
    adapters: { npm: true, pip: true, uv: true },
    root: join(temp, "validation-environment"),
  });
  const stagedClaudeMarketplaces: string[] = [];
  const stagedClaudePlugins = new Set<string>();
  const representedClaudePlugins = new Set<string>();
  for (const [
    index,
    marketplacePath,
  ] of inventory.claudeMarketplaces.entries()) {
    const stagedRoot = join(stage, `claude-real-${index}`);
    const stagedMarketplace = join(
      stagedRoot,
      ".claude-plugin",
      "marketplace.json"
    );
    await mkdir(dirname(stagedMarketplace), { recursive: true });
    await cp(marketplacePath, stagedMarketplace);
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      readonly plugins?: readonly { readonly source?: unknown }[];
    };
    for (const entry of marketplace.plugins ?? []) {
      if (typeof entry.source !== "string")
        throw new Error("skillset: claude marketplace source must be a string");
      assertPortableMarketplaceSource(entry.source);
      const source = await resolveContainedExisting(
        canonicalRoot,
        entry.source
      );
      await assertTreeHasNoSymlinks(source);
      const destination = join(
        stagedRoot,
        normalizedMarketplaceSource(canonicalRoot, source, entry.source)
      );
      await assertContained(stagedRoot, destination);
      await cp(source, destination, { recursive: true });
      representedClaudePlugins.add(source);
      stagedClaudePlugins.add(destination);
    }
    stagedClaudeMarketplaces.push(stagedMarketplace);
  }
  for (const plugin of inventory.claudePlugins) {
    if (representedClaudePlugins.has(plugin)) continue;
    const destination = join(
      stage,
      "claude-plugins",
      `plugin-${stagedClaudePlugins.size}`
    );
    await cp(plugin, destination, { recursive: true });
    stagedClaudePlugins.add(destination);
  }

  const stagedPluginPackages: string[] = [];
  for (const [index, plugin] of inventory.pluginPackages.entries()) {
    const destination = join(stage, "plugin-packages", `plugin-${index}`);
    await cp(plugin, destination, { recursive: true });
    stagedPluginPackages.push(destination);
  }

  const stagedCodexPlugins: string[] = [];
  for (const [index, plugin] of inventory.codexPlugins.entries()) {
    const destination = join(stage, "codex-plugins", `plugin-${index}`);
    await cp(plugin, destination, { recursive: true });
    stagedCodexPlugins.push(destination);
  }
  const stagedCodexMarketplaces: string[] = [];
  const codexMarketplaceRoots: string[] = [];
  const representedCodexPlugins = new Set<string>();
  const generatedCodexPlugins = new Set(inventory.pluginPackages);
  for (const [
    index,
    marketplacePath,
  ] of inventory.codexMarketplaces.entries()) {
    const stagedRoot = join(stage, `codex-marketplace-${index}`);
    const stagedMarketplace = join(
      stagedRoot,
      ".agents",
      "plugins",
      "marketplace.json"
    );
    await mkdir(dirname(stagedMarketplace), { recursive: true });
    await cp(marketplacePath, stagedMarketplace);
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      readonly plugins?: readonly {
        readonly source?: {
          readonly path?: unknown;
          readonly source?: unknown;
        };
      }[];
    };
    for (const entry of marketplace.plugins ?? []) {
      if (
        entry.source?.source !== "local" ||
        typeof entry.source.path !== "string"
      ) {
        throw new Error(
          "skillset: Codex marketplace source must be a local path"
        );
      }
      assertPortableMarketplaceSource(entry.source.path);
      const source = await resolveContainedExisting(
        canonicalRoot,
        entry.source.path
      );
      if (!generatedCodexPlugins.has(source)) {
        throw new Error(
          `skillset: Codex marketplace source is not a generated plugin: ${entry.source.path}`
        );
      }
      await assertTreeHasNoSymlinks(source);
      const destination = join(
        stagedRoot,
        normalizedMarketplaceSource(canonicalRoot, source, entry.source.path)
      );
      await assertContained(stagedRoot, destination);
      await cp(source, destination, { recursive: true });
      representedCodexPlugins.add(source);
    }
    stagedCodexMarketplaces.push(stagedMarketplace);
    codexMarketplaceRoots.push(stagedRoot);
  }
  const missingCodexPlugins = [...generatedCodexPlugins].filter(
    (plugin) => !representedCodexPlugins.has(plugin)
  );
  if (missingCodexPlugins.length > 0) {
    throw new Error(
      `skillset: Codex marketplace omits generated plugins: ${missingCodexPlugins.map((plugin) => relative(canonicalRoot, plugin)).join(", ")}`
    );
  }

  const stagedSkills: string[] = [];
  for (const [index, skill] of inventory.skills.entries()) {
    const skillName = basename(dirname(skill));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skillName)) {
      throw new Error(
        `skillset: generated skill directory has an unsafe validator name ${skillName}`
      );
    }
    const destination = join(stage, "skills", `entry-${index}`, skillName);
    await cp(dirname(skill), destination, { recursive: true });
    stagedSkills.push(join(destination, basename(skill)));
  }
  const claudeCanary = join(stage, "claude-canary");
  await mkdir(join(claudeCanary, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(claudeCanary, ".claude-plugin", "plugin.json"),
    "{",
    "utf8"
  );
  const codexCanary = join(stage, "codex-canary");
  await mkdir(join(codexCanary, ".codex-plugin"), { recursive: true });
  await writeFile(
    join(codexCanary, ".codex-plugin", "plugin.json"),
    '{"version":"1.0.0"}\n',
    "utf8"
  );
  const agentCanary = join(stage, "agent-canary");
  await mkdir(agentCanary, { recursive: true });
  await writeFile(
    join(agentCanary, "SKILL.md"),
    "---\nname: agent-canary\n---\n# Canary\n",
    "utf8"
  );

  const cursorRoots: string[] = [];
  const stagedCursorMarketplaces: string[] = [];
  const stagedCursorPlugins = new Set<string>();
  const represented = new Set<string>();
  for (const marketplacePath of inventory.cursorMarketplaces) {
    const cursorReal = join(stage, `cursor-real-${cursorRoots.length}`);
    await mkdir(join(cursorReal, ".cursor-plugin"), { recursive: true });
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      readonly plugins?: readonly { readonly source?: unknown }[];
    };
    await cp(
      marketplacePath,
      join(cursorReal, ".cursor-plugin", "marketplace.json")
    );
    stagedCursorMarketplaces.push(
      join(cursorReal, ".cursor-plugin", "marketplace.json")
    );
    for (const entry of marketplace.plugins ?? []) {
      if (typeof entry.source !== "string")
        throw new Error("skillset: cursor marketplace source must be a string");
      assertPortableMarketplaceSource(entry.source);
      const source = await resolveContainedExisting(
        canonicalRoot,
        entry.source
      );
      await assertTreeHasNoSymlinks(source);
      assertCursorSourceDoesNotShadowValidator(
        canonicalRoot,
        source,
        entry.source
      );
      represented.add(source);
      const destination = join(
        cursorReal,
        normalizedMarketplaceSource(canonicalRoot, source, entry.source)
      );
      await assertContained(cursorReal, destination);
      await cp(source, destination, { recursive: true });
      stagedCursorPlugins.add(destination);
    }
    await stageCursorTool(tools.cursor, cursorReal);
    cursorRoots.push(cursorReal);
  }
  const unrepresented = inventory.cursorPlugins.filter(
    (plugin) => !represented.has(plugin)
  );
  if (unrepresented.length > 0) {
    const synthetic = join(stage, "cursor-synthetic");
    await mkdir(join(synthetic, ".cursor-plugin"), { recursive: true });
    const plugins = [];
    for (const [index, plugin] of unrepresented.entries()) {
      const destination = `plugins/plugin-${index}`;
      await cp(plugin, join(synthetic, destination), { recursive: true });
      stagedCursorPlugins.add(join(synthetic, destination));
      const manifest = JSON.parse(
        await readFile(join(plugin, ".cursor-plugin", "plugin.json"), "utf8")
      ) as { readonly name?: unknown };
      if (typeof manifest.name !== "string")
        throw new Error("skillset: cursor plugin name must be a string");
      plugins.push({ name: manifest.name, source: destination });
    }
    await writeFile(
      join(synthetic, ".cursor-plugin", "marketplace.json"),
      `${JSON.stringify({ name: "skillset-hosted-validation", plugins }, null, 2)}\n`
    );
    stagedCursorMarketplaces.push(
      join(synthetic, ".cursor-plugin", "marketplace.json")
    );
    await stageCursorTool(tools.cursor, synthetic);
    cursorRoots.push(synthetic);
  }

  const cursorCanary = join(stage, "cursor-canary");
  await mkdir(join(cursorCanary, ".cursor-plugin"), { recursive: true });
  await mkdir(join(cursorCanary, "plugin", ".cursor-plugin"), {
    recursive: true,
  });
  await writeFile(
    join(cursorCanary, ".cursor-plugin", "marketplace.json"),
    `${JSON.stringify({ name: "canary", plugins: [{ name: "canary", source: "plugin" }] })}\n`
  );
  await writeFile(
    join(cursorCanary, "plugin", ".cursor-plugin", "plugin.json"),
    "{}\n"
  );
  await stageCursorTool(tools.cursor, cursorCanary);
  return {
    agentCanary,
    claudeCanary,
    codexCanary,
    codexMarketplaceRoots,
    cursorCanary,
    cursorRoots,
    environment,
    inventory: {
      claudeMarketplaces: stagedClaudeMarketplaces,
      claudePlugins: [...stagedClaudePlugins].toSorted(),
      codexMarketplaces: stagedCodexMarketplaces,
      codexPlugins: stagedCodexPlugins,
      cursorMarketplaces: stagedCursorMarketplaces,
      cursorPlugins: [...stagedCursorPlugins].toSorted(),
      pluginPackages: stagedPluginPackages,
      skills: stagedSkills,
    },
  };
}

function assertPortableMarketplaceSource(declaredSource: string): void {
  const normalized = normalizeDeclaredMarketplaceSource(declaredSource);
  if (
    declaredSource.includes("\\") ||
    posix.isAbsolute(declaredSource) ||
    /^[A-Za-z]:/u.test(declaredSource) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(
      `skillset: marketplace source must be a portable repository-relative path: ${declaredSource}`
    );
  }
}

function normalizedMarketplaceSource(
  root: string,
  source: string,
  declaredSource: string
): string {
  const offset = relative(root, source).split(sep).join("/") || ".";
  if (normalizeDeclaredMarketplaceSource(declaredSource) !== offset) {
    throw new Error(
      `skillset: marketplace source must be a normalized repository-relative path: ${declaredSource}`
    );
  }
  return offset;
}

function normalizeDeclaredMarketplaceSource(source: string): string {
  const normalized = posix.normalize(source);
  if (normalized === "./") return ".";
  return normalized.replace(/\/$/u, "");
}

async function stageCursorTool(
  toolRoot: string,
  destination: string
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const item of [
    "scripts",
    "schemas",
    "node_modules",
    "package.json",
    "package-lock.json",
  ]) {
    await cp(join(toolRoot, item), join(destination, item), {
      errorOnExist: true,
      force: false,
      recursive: true,
    });
  }
}

function assertCursorSourceDoesNotShadowValidator(
  root: string,
  source: string,
  declaredSource: string
): void {
  const offset = relative(root, source);
  const firstComponent = offset.split(sep)[0];
  if (
    offset === "" ||
    firstComponent === ".cursor-plugin" ||
    firstComponent === "node_modules" ||
    firstComponent === "package-lock.json" ||
    firstComponent === "package.json" ||
    firstComponent === "schemas" ||
    firstComponent === "scripts"
  ) {
    throw new Error(
      `skillset: cursor marketplace source shadows the pinned validator: ${declaredSource}`
    );
  }
}

const ACQUISITION_FETCH_ATTEMPTS = 3;
const TRANSIENT_ACQUISITION_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export type AcquisitionFetch = (url: string) => Promise<Response>;

export interface DownloadVerifiedOptions {
  readonly fetch?: AcquisitionFetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function isTransientAcquisitionNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_ACQUISITION_NETWORK_CODES.has(error.code)
  ) {
    return true;
  }
  return /socket connection was closed|other side closed|network error|fetch failed/iu.test(
    error.message
  );
}

function isRetryableAcquisitionStatus(status: number): boolean {
  return status >= 500;
}

function acquisitionRetryDelayMs(attempt: number): number {
  return 200 * attempt;
}

export async function downloadVerified(
  acquisition: { readonly integrity: string; readonly url: string },
  destination: string,
  options: DownloadVerifiedOptions = {}
): Promise<void> {
  const bytes = await readAcquisitionBytes(acquisition, options);
  await writeFile(destination, bytes);
  await verifyBytes(bytes, acquisition.integrity, acquisition.url);
}

async function readAcquisitionBytes(
  acquisition: { readonly integrity: string; readonly url: string },
  options: DownloadVerifiedOptions
): Promise<Uint8Array> {
  const fetchAcquisition = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  let lastError: unknown;
  /* eslint-disable no-await-in-loop -- Bounded acquisition retries are sequential. */
  for (let attempt = 1; attempt <= ACQUISITION_FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetchAcquisition(acquisition.url);
      if (!response.ok) {
        const error = new Error(
          `skillset: failed to acquire ${acquisition.url}: ${response.status}`
        );
        if (
          isRetryableAcquisitionStatus(response.status) &&
          attempt < ACQUISITION_FETCH_ATTEMPTS
        ) {
          lastError = error;
          await sleep(acquisitionRetryDelayMs(attempt));
          continue;
        }
        throw error;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message.startsWith("skillset: failed to acquire")
      ) {
        throw error;
      }
      if (
        !isTransientAcquisitionNetworkError(error) ||
        attempt === ACQUISITION_FETCH_ATTEMPTS
      ) {
        throw error;
      }
      await sleep(acquisitionRetryDelayMs(attempt));
    }
  }
  /* eslint-enable no-await-in-loop -- Re-enable after the sequential retry loop. */
  throw lastError;
}

async function verifyFileHash(path: string, integrity: string): Promise<void> {
  await verifyBytes(await readFile(path), integrity, path);
}

async function verifyBytes(
  bytes: Uint8Array,
  integrity: string,
  subject: string
): Promise<void> {
  const [algorithm, expected] = integrity.startsWith("sha512-")
    ? ["sha512", integrity.slice("sha512-".length)]
    : ["sha256", integrity.slice("sha256:".length)];
  const encoding = algorithm === "sha512" ? "base64" : "hex";
  const actual = createHash(algorithm).update(bytes).digest(encoding);
  if (actual !== expected)
    throw new Error(`skillset: acquisition hash mismatch for ${subject}`);
}

async function runRequired(
  argv: readonly [string, ...string[]],
  temp: string
): Promise<void> {
  const { env } = await createProviderProbeEnvironment({
    adapters: { npm: true, pip: true, uv: true },
    root: join(temp, "acquisition-environment"),
  });
  const child = Bun.spawn([...argv], {
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(formatAcquisitionFailureDiagnostic(argv, stderr));
  }
}

export function formatAcquisitionFailureDiagnostic(
  argv: readonly [string, ...string[]],
  stderr: string
): string {
  return `skillset: acquisition command failed: ${argv.join(" ")}\n${stderr}`;
}

async function verifyNodePackages(
  root: string,
  expected: Readonly<Record<string, string>>,
  temp: string
): Promise<void> {
  await runRequired(
    [
      "node",
      "-e",
      "const fs=require('node:fs');const path=require('node:path');const [root,raw]=process.argv.slice(1);for(const [name,version] of Object.entries(JSON.parse(raw))){const pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8'));if(pkg.version!==version)throw new Error(`${name}: expected ${version}, received ${pkg.version}`)}",
      root,
      JSON.stringify(expected),
    ],
    temp
  );
}
