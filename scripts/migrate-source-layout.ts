import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { JsonRecord } from "../packages/core/src/types";
import { stringifyYamlSourceDocument } from "../packages/core/src/source-document";
import { parseYamlRecord } from "../packages/core/src/yaml";
import { splitRootConfigRecord } from "./source-layout-migration";

const SOURCE_DIR = ".skillset";
const SRC_DIR = "src";
const CONFIG_FILE = "config.yaml";
const SOURCE_MANIFEST_FILE = "skillset.yaml";

const MOVES: readonly (readonly [string, string])[] = [
  ["instructions", "src/rules"],
  ["rules", "src/rules"],
  ["skills", "src/skills"],
  ["plugins", "src/plugins"],
  ["shared", "src/shared"],
  ["src/claude", "src/_claude"],
  ["src/codex", "src/_codex"],
];

async function main(): Promise<void> {
  const roots = process.argv.slice(2);
  for (const root of roots.length === 0 ? ["."] : roots) {
    await migrateRoot(resolve(root));
  }
}

async function migrateRoot(rootPath: string): Promise<void> {
  const skillsetPath = join(rootPath, SOURCE_DIR);
  if (!(await exists(skillsetPath))) {
    console.error(`skip ${rootPath}: no ${SOURCE_DIR}/ directory`);
    return;
  }

  // Validate config before moving source so rejected settings leave authored files in place.
  const configPlan = await planRootConfig(skillsetPath);
  for (const [from, to] of MOVES) {
    await moveIfExists(join(skillsetPath, from), join(skillsetPath, to));
  }
  await movePluginProviderDirs(join(skillsetPath, SRC_DIR, "plugins"));
  if (configPlan) {
    await mkdir(dirname(configPlan.manifestPath), { recursive: true });
    await writeFile(configPlan.manifestPath, configPlan.manifest, "utf8");
    await writeFile(configPlan.configPath, configPlan.config, "utf8");
  }
  console.error(`migrated ${rootPath}`);
}

async function movePluginProviderDirs(pluginsPath: string): Promise<void> {
  if (!(await exists(pluginsPath))) return;
  const entries = await readdir(pluginsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginPath = join(pluginsPath, entry.name);
    await moveIfExists(join(pluginPath, "claude"), join(pluginPath, "_claude"));
    await moveIfExists(join(pluginPath, "codex"), join(pluginPath, "_codex"));
  }
}

interface RootConfigPlan {
  readonly configPath: string;
  readonly config: string;
  readonly manifestPath: string;
  readonly manifest: string;
}

async function planRootConfig(skillsetPath: string): Promise<RootConfigPlan | undefined> {
  const configPath = join(skillsetPath, CONFIG_FILE);
  if (!(await exists(configPath))) return;
  const rawConfig = await Bun.file(configPath).text();
  const config = parseYamlRecord(rawConfig, configPath);
  const { changed, sourceManifest, workspaceConfig } = splitRootConfigRecord(config);
  if (!changed) return;

  const manifestPath = join(skillsetPath, SRC_DIR, SOURCE_MANIFEST_FILE);
  if (await exists(manifestPath)) {
    throw new Error(`skillset: ${manifestPath} already exists; split ${configPath} by hand`);
  }
  return {
    configPath,
    config: stringifyConfig(workspaceConfig),
    manifestPath,
    manifest: stringifyYamlSourceDocument(sourceManifest ?? {}),
  };
}

function stringifyConfig(record: JsonRecord): string {
  return Object.keys(record).length === 0 ? "" : stringifyYamlSourceDocument(record);
}

async function moveIfExists(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return;
  if (await exists(to)) throw new Error(`skillset: refusing to overwrite existing path ${to}`);
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
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
