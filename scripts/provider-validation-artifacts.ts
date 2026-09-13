import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const LOCK_PATHS = [
  "skillset.lock",
  ".agents/skills/skillset.lock",
  ".claude/skills/skillset.lock",
  ".cursor/skills/skillset.lock",
  "plugins/skillset.lock",
] as const;
const ROOT_MARKETPLACES = [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
] as const;

export interface ProviderArtifactInventory {
  readonly agentPlugins: readonly string[];
  readonly chatgptPlugins: readonly string[];
  readonly claudeMarketplaces: readonly string[];
  readonly claudePlugins: readonly string[];
  readonly codexMarketplaces: readonly string[];
  readonly codexPlugins: readonly string[];
  readonly cursorMarketplaces: readonly string[];
  readonly cursorPlugins: readonly string[];
  readonly skills: readonly string[];
}

interface LockEnvelope {
  readonly items?: readonly unknown[];
  readonly outputRoot?: unknown;
}

interface LockItem {
  readonly kind: "plugin" | "plugin-skill" | "standalone-skill";
  readonly outputPath: string;
}

export interface CodexMarketplaceConsumerReceipt {
  readonly catalogName: string;
  readonly codexVersion: string;
  readonly pluginIds: readonly string[];
}

/**
 * Parse the generated repository catalog through the real Codex 0.154
 * consumer without registering, installing, trusting, or enabling anything.
 * The catalog is supplied through ephemeral config overrides and every config
 * and cache root is isolated beneath a disposable directory.
 */
export async function validateCodexMarketplaceConsumer(
  root: string,
  codexBin: string
): Promise<CodexMarketplaceConsumerReceipt> {
  const canonicalRoot = await realpath(root);
  const catalogPath = await resolveContainedExisting(
    canonicalRoot,
    ".agents/plugins/marketplace.json"
  );
  const catalog = parseMarketplaceCatalog(
    JSON.parse(await readFile(catalogPath, "utf8")) as unknown,
    catalogPath
  );
  const isolatedRoot = await mkdtemp(
    join(tmpdir(), "skillset-codex-marketplace-consumer-")
  );
  try {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    );
    for (const path of [
      "home",
      "codex-home",
      "xdg/cache",
      "xdg/config",
      "xdg/data",
      "xdg/state",
    ]) {
      await mkdir(join(isolatedRoot, path), { recursive: true });
    }
    Object.assign(environment, {
      CODEX_HOME: join(isolatedRoot, "codex-home"),
      HOME: join(isolatedRoot, "home"),
      XDG_CACHE_HOME: join(isolatedRoot, "xdg/cache"),
      XDG_CONFIG_HOME: join(isolatedRoot, "xdg/config"),
      XDG_DATA_HOME: join(isolatedRoot, "xdg/data"),
      XDG_STATE_HOME: join(isolatedRoot, "xdg/state"),
    });

    const version = await runCodexConsumer(
      codexBin,
      ["--version"],
      canonicalRoot,
      environment
    );
    const codexVersion = version.stdout.trim();
    if (!/^codex-cli 0\.154\.0(?:\b|-)/u.test(codexVersion)) {
      throw new Error(
        `skillset: Codex marketplace consumer must be pinned to 0.154.0, received ${codexVersion || "empty version output"}`
      );
    }

    const listing = await runCodexConsumer(
      codexBin,
      [
        "--enable",
        "plugins",
        "-c",
        'marketplaces.skillset_validation.source_type="local"',
        "-c",
        `marketplaces.skillset_validation.source=${JSON.stringify(canonicalRoot)}`,
        "plugin",
        "list",
        "--available",
        "--json",
      ],
      canonicalRoot,
      environment
    );
    const pluginIds = parseCodexPluginIds(listing.stdout);
    const expectedPluginIds = catalog.pluginNames.map(
      (name) => `${name}@${catalog.name}`
    );
    const missing = expectedPluginIds.filter((id) => !pluginIds.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `skillset: Codex 0.154 marketplace consumer omitted generated plugins: ${missing.join(", ")}`
      );
    }
    return {
      catalogName: catalog.name,
      codexVersion,
      pluginIds: expectedPluginIds,
    };
  } finally {
    await rm(isolatedRoot, { force: true, recursive: true });
  }
}

async function runCodexConsumer(
  codexBin: string,
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>
): Promise<{ readonly stdout: string }> {
  const process = Bun.spawn([codexBin, ...argv], {
    cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `skillset: Codex marketplace consumer failed (${exitCode}): ${stderr.trim() || stdout.trim()}`
    );
  }
  return { stdout };
}

function parseMarketplaceCatalog(
  value: unknown,
  path: string
): { readonly name: string; readonly pluginNames: readonly string[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`skillset: invalid ChatGPT marketplace catalog ${path}`);
  }
  const record = value as {
    readonly name?: unknown;
    readonly plugins?: unknown;
  };
  if (typeof record.name !== "string" || !Array.isArray(record.plugins)) {
    throw new Error(`skillset: invalid ChatGPT marketplace catalog ${path}`);
  }
  const pluginNames = record.plugins.map((plugin) => {
    if (
      plugin === null ||
      typeof plugin !== "object" ||
      Array.isArray(plugin) ||
      typeof (plugin as { readonly name?: unknown }).name !== "string"
    ) {
      throw new Error(
        `skillset: invalid ChatGPT marketplace plugin in ${path}`
      );
    }
    return (plugin as { readonly name: string }).name;
  });
  return { name: record.name, pluginNames };
}

function parseCodexPluginIds(stdout: string): readonly string[] {
  const value = JSON.parse(stdout) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "skillset: Codex marketplace consumer returned invalid JSON"
    );
  }
  const available = (value as { readonly available?: unknown }).available;
  if (!Array.isArray(available)) {
    throw new Error(
      "skillset: Codex marketplace consumer JSON omitted available plugins"
    );
  }
  return available.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof (entry as { readonly pluginId?: unknown }).pluginId !== "string"
    ) {
      throw new Error(
        "skillset: Codex marketplace consumer returned an invalid plugin entry"
      );
    }
    return (entry as { readonly pluginId: string }).pluginId;
  });
}

export async function enumerateProviderArtifacts(
  root: string
): Promise<ProviderArtifactInventory> {
  const canonicalRoot = await realpath(root);
  const agentPlugins = new Set<string>();
  const chatgptPlugins = new Set<string>();
  const claudePlugins = new Set<string>();
  const codexPlugins = new Set<string>();
  const cursorPlugins = new Set<string>();
  const skills = new Set<string>();

  for (const lockPath of LOCK_PATHS) {
    let absoluteLockPath: string;
    let source: string;
    try {
      absoluteLockPath = await resolveContainedExisting(
        canonicalRoot,
        lockPath
      );
      source = await readFile(absoluteLockPath, "utf8");
    } catch (error) {
      if (isMissing(error) && lockPath === "skillset.lock") continue;
      throw error;
    }
    const lock = JSON.parse(source) as LockEnvelope;
    if (typeof lock.outputRoot !== "string" || !Array.isArray(lock.items)) {
      throw new Error(`skillset: invalid provider-validation lock ${lockPath}`);
    }
    const outputRoot = await resolveContainedExisting(
      canonicalRoot,
      lock.outputRoot
    );
    for (const raw of lock.items) {
      const item = parseLockItem(raw, lockPath);
      if (item === undefined) continue;
      const outputPath = await resolveContainedExisting(
        outputRoot,
        item.outputPath
      );
      await assertContained(canonicalRoot, outputPath);
      if (item.kind === "plugin-skill" || item.kind === "standalone-skill") {
        skills.add(outputPath);
        continue;
      }
      if (outputPath.endsWith("/.claude-plugin/plugin.json"))
        claudePlugins.add(dirname(dirname(outputPath)));
      else if (outputPath.endsWith("/agents/plugin.json"))
        agentPlugins.add(dirname(outputPath));
      else if (outputPath.endsWith("/chatgpt/plugin.json"))
        chatgptPlugins.add(dirname(outputPath));
      else if (outputPath.endsWith("/.codex-plugin/plugin.json"))
        codexPlugins.add(dirname(dirname(outputPath)));
      else if (outputPath.endsWith("/.cursor-plugin/plugin.json"))
        cursorPlugins.add(dirname(dirname(outputPath)));
      else
        throw new Error(
          `skillset: unsupported generated plugin manifest ${relative(canonicalRoot, outputPath)}`
        );
    }
  }

  const marketplaces = await Promise.all(
    ROOT_MARKETPLACES.map((path) =>
      resolveContainedExisting(canonicalRoot, path)
    )
  );
  const inventory = {
    agentPlugins: [...agentPlugins].toSorted(),
    chatgptPlugins: [...chatgptPlugins].toSorted(),
    claudeMarketplaces: [marketplaces[1]!],
    claudePlugins: [...claudePlugins].toSorted(),
    codexMarketplaces: [marketplaces[0]!],
    codexPlugins: [...codexPlugins].toSorted(),
    cursorMarketplaces: [marketplaces[2]!],
    cursorPlugins: [...cursorPlugins].toSorted(),
    skills: [...skills].toSorted(),
  } satisfies ProviderArtifactInventory;
  assertNonEmptyInventory(inventory);
  await Promise.all([
    ...inventory.agentPlugins.map(assertTreeHasNoSymlinks),
    ...inventory.chatgptPlugins.map(assertTreeHasNoSymlinks),
    ...inventory.claudePlugins.map(assertTreeHasNoSymlinks),
    ...inventory.codexMarketplaces.map(assertTreeHasNoSymlinks),
    ...inventory.codexPlugins.map(assertTreeHasNoSymlinks),
    ...inventory.cursorPlugins.map(assertTreeHasNoSymlinks),
    ...inventory.skills.map((path) => assertTreeHasNoSymlinks(dirname(path))),
  ]);
  return inventory;
}

function parseLockItem(raw: unknown, lockPath: string): LockItem | undefined {
  if (raw === null || typeof raw !== "object")
    throw new Error(`skillset: invalid lock item in ${lockPath}`);
  const item = raw as {
    readonly kind?: unknown;
    readonly outputPath?: unknown;
  };
  if (
    !["plugin", "plugin-skill", "standalone-skill"].includes(String(item.kind))
  )
    return undefined;
  if (typeof item.outputPath !== "string")
    throw new Error(`skillset: invalid lock outputPath in ${lockPath}`);
  return { kind: item.kind as LockItem["kind"], outputPath: item.outputPath };
}

function assertNonEmptyInventory(inventory: ProviderArtifactInventory): void {
  for (const [surface, values] of Object.entries(inventory)) {
    if (surface === "codexPlugins") continue;
    if (values.length === 0)
      throw new Error(`skillset: provider validation found no ${surface}`);
  }
}

export async function resolveContainedExisting(
  root: string,
  path: string
): Promise<string> {
  const canonicalRoot = await realpath(root);
  const candidate = resolve(canonicalRoot, path);
  await assertContained(canonicalRoot, candidate);
  await assertPathHasNoSymlinks(canonicalRoot, candidate);
  return candidate;
}

export async function assertPathHasNoSymlinks(
  root: string,
  candidate: string
): Promise<void> {
  const offset = relative(root, candidate);
  await assertContained(root, candidate);
  let current = root;
  for (const component of offset.split(sep).filter(Boolean)) {
    current = join(current, component);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink())
      throw new Error(
        `skillset: provider validation rejects symlink path ${current}`
      );
  }
}

export async function assertTreeHasNoSymlinks(root: string): Promise<void> {
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink())
    throw new Error(`skillset: provider validation rejects symlink ${root}`);
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(root)) {
    await assertTreeHasNoSymlinks(join(root, entry));
  }
}

export async function assertContained(
  root: string,
  candidate: string
): Promise<void> {
  const offset = relative(root, candidate);
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) &&
      offset !== ".." &&
      !offset.startsWith(sep))
  )
    return;
  throw new Error(
    `skillset: provider validation path escapes controlled root: ${candidate}`
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
