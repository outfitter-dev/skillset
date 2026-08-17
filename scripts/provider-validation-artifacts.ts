import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const LOCK_PATHS = [
  "skillset.lock",
  ".agents/skills/skillset.lock",
  ".claude/skills/skillset.lock",
  ".cursor/skills/skillset.lock",
  "plugins/skillset.lock",
] as const;
const ROOT_MARKETPLACES = [
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
] as const;

export interface ProviderArtifactInventory {
  readonly claudeMarketplaces: readonly string[];
  readonly claudePlugins: readonly string[];
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

export async function enumerateProviderArtifacts(
  root: string
): Promise<ProviderArtifactInventory> {
  const canonicalRoot = await realpath(root);
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
    claudeMarketplaces: [marketplaces[0]!],
    claudePlugins: [...claudePlugins].toSorted(),
    codexPlugins: [...codexPlugins].toSorted(),
    cursorMarketplaces: [marketplaces[1]!],
    cursorPlugins: [...cursorPlugins].toSorted(),
    skills: [...skills].toSorted(),
  } satisfies ProviderArtifactInventory;
  assertNonEmptyInventory(inventory);
  await Promise.all([
    ...inventory.claudePlugins.map(assertTreeHasNoSymlinks),
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
