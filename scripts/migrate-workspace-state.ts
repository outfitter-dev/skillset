import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { JsonRecord } from "../packages/core/src/types";
import { parseYamlRecord, stringifyYaml } from "../packages/core/src/yaml";
import { splitRootConfigRecord } from "./source-layout-migration";

const ORDINARY_DIR = ".skillset";
const LEGACY_CONFIG_FILE = "config.yaml";
const LEGACY_SOURCE_MANIFEST_FILE = "src/skillset.yaml";
const WORKSPACE_MANIFEST_FILE = "skillset.yaml";

type Operation =
  | {
      readonly kind: "write";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly kind: "rename";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: "remove";
      readonly path: string;
    };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const roots = args.filter((arg) => arg !== "--dry-run");
  const plans = await Promise.all((roots.length === 0 ? ["."] : roots).map(async (root) => planRoot(resolve(root))));

  for (const plan of plans) {
    printPlan(plan);
  }
  if (dryRun) {
    console.error("skillset: migration dry run wrote no files");
    return;
  }

  for (const plan of plans) {
    await applyPlan(plan);
  }
}

interface RootPlan {
  readonly rootPath: string;
  readonly operations: readonly Operation[];
}

async function planRoot(rootPath: string): Promise<RootPlan> {
  const operations: Operation[] = [];
  await planWorkspaceManifest(rootPath, operations);
  await planPendingChanges(rootPath, join(ORDINARY_DIR, "changes"), operations);
  if (await isDedicatedWorkspace(rootPath)) {
    await planPendingChanges(rootPath, "changes", operations);
    await planDedicatedChangesDirectory(rootPath, operations);
    await planPendingChanges(rootPath, join("skillset", "changes"), operations);
  }
  return { rootPath, operations };
}

async function isDedicatedWorkspace(rootPath: string): Promise<boolean> {
  return (await exists(join(rootPath, WORKSPACE_MANIFEST_FILE))) || (await exists(join(rootPath, "skillset")));
}

async function planWorkspaceManifest(rootPath: string, operations: Operation[]): Promise<void> {
  const skillsetPath = join(rootPath, ORDINARY_DIR);
  if (!(await exists(skillsetPath))) return;

  const legacyConfigPath = join(skillsetPath, LEGACY_CONFIG_FILE);
  const legacySourceManifestPath = join(skillsetPath, LEGACY_SOURCE_MANIFEST_FILE);
  const workspaceManifestPath = join(skillsetPath, WORKSPACE_MANIFEST_FILE);
  const hasLegacyConfig = await exists(legacyConfigPath);
  const hasLegacySourceManifest = await exists(legacySourceManifestPath);
  if (!hasLegacyConfig && !hasLegacySourceManifest) return;
  if (await exists(workspaceManifestPath)) {
    throw new Error(
      `skillset: ${relative(rootPath, workspaceManifestPath)} already exists; migrate ${relative(rootPath, legacyConfigPath)} and ${relative(
        rootPath,
        legacySourceManifestPath
      )} by hand`
    );
  }

  const workspaceConfig = hasLegacyConfig ? await readWorkspaceConfig(legacyConfigPath) : {};
  const sourceManifest = hasLegacySourceManifest ? await readRecord(legacySourceManifestPath) : {};
  const combined = mergeRecords(sourceManifest, workspaceConfig, workspaceManifestPath);

  operations.push({ content: stringifyYaml(combined), kind: "write", path: workspaceManifestPath });
  if (hasLegacyConfig) operations.push({ kind: "remove", path: legacyConfigPath });
  if (hasLegacySourceManifest) operations.push({ kind: "remove", path: legacySourceManifestPath });
}

async function readWorkspaceConfig(path: string): Promise<JsonRecord> {
  const record = await readRecord(path);
  const split = splitRootConfigRecord(record);
  const config = split.workspaceConfig;
  return split.sourceManifest === undefined ? config : mergeRecords(split.sourceManifest, config, path);
}

async function readRecord(path: string): Promise<JsonRecord> {
  return parseYamlRecord(await Bun.file(path).text(), path);
}

function mergeRecords(source: JsonRecord, workspace: JsonRecord, path: string): JsonRecord {
  const result: Record<string, JsonRecord[keyof JsonRecord]> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = value;
  }
  for (const [key, value] of Object.entries(workspace)) {
    if (result[key] !== undefined) {
      throw new Error(`skillset: cannot merge duplicate top-level key ${key} into ${path}; combine files by hand`);
    }
    result[key] = value;
  }
  return result;
}

async function planPendingChanges(rootPath: string, changeDir: string, operations: Operation[]): Promise<void> {
  const pendingPath = join(rootPath, changeDir, "pending");
  if (!(await exists(pendingPath))) return;

  const entries = await readdir(pendingPath, { withFileTypes: true });
  const markdownFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  for (const entry of markdownFiles) {
    const from = join(pendingPath, entry.name);
    const to = join(rootPath, changeDir, entry.name);
    if (await exists(to)) {
      throw new Error(`skillset: refusing to overwrite existing pending change entry ${relative(rootPath, to)}`);
    }
    operations.push({ from, kind: "rename", to });
  }

  if (entries.length === markdownFiles.length) {
    operations.push({ kind: "remove", path: pendingPath });
  }
}

async function planDedicatedChangesDirectory(rootPath: string, operations: Operation[]): Promise<void> {
  const oldPath = join(rootPath, "changes");
  const newPath = join(rootPath, "skillset", "changes");
  if (!(await exists(oldPath))) return;
  if (await exists(newPath)) {
    throw new Error("skillset: both changes and skillset/changes exist; migrate dedicated change state by hand");
  }
  operations.push({ from: oldPath, kind: "rename", to: newPath });
}

function printPlan(plan: RootPlan): void {
  if (plan.operations.length === 0) {
    console.error(`skip ${plan.rootPath}: no workspace state migration needed`);
    return;
  }
  for (const operation of plan.operations) {
    if (operation.kind === "write") {
      console.error(`write ${relative(plan.rootPath, operation.path)}`);
      continue;
    }
    if (operation.kind === "rename") {
      console.error(`move ${relative(plan.rootPath, operation.from)} -> ${relative(plan.rootPath, operation.to)}`);
      continue;
    }
    console.error(`remove ${relative(plan.rootPath, operation.path)}`);
  }
}

async function applyPlan(plan: RootPlan): Promise<void> {
  for (const operation of plan.operations) {
    if (operation.kind === "write") {
      await mkdir(dirname(operation.path), { recursive: true });
      await writeFile(operation.path, operation.content, "utf8");
      continue;
    }
    if (operation.kind === "rename") {
      await mkdir(dirname(operation.to), { recursive: true });
      await rename(operation.from, operation.to);
      continue;
    }
    await rm(operation.path, { force: true, recursive: true });
  }
  if (plan.operations.length > 0) console.error(`migrated ${plan.rootPath}`);
}

function relative(rootPath: string, path: string): string {
  return path.slice(rootPath.length + 1).replaceAll("\\", "/");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
