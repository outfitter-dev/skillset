import type { JsonRecord } from "../../packages/core/src/types";
import { parseYamlRecord, stringifyYaml } from "../../packages/core/src/yaml";
import { splitRootConfigRecord } from "../source-layout-migration";

const CONFIG_FILE = "config.yaml";
const PLUGINS_SEGMENT = "/plugins/";
const SOURCE_MANIFEST_FILE = "src/skillset.yaml";

export function normalizeSkillsetFixtureFiles(files: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = { ...files };
  for (const [path, content] of Object.entries(files)) {
    if (!isRootWorkspaceConfigPath(path)) continue;
    const sourceDir = path.slice(0, -CONFIG_FILE.length).replace(/\/$/, "");
    const manifestPath = `${sourceDir}/${SOURCE_MANIFEST_FILE}`;
    if (files[manifestPath] !== undefined) continue;

    const parsed = parseYamlRecord(content, path);
    const { changed, sourceManifest, workspaceConfig } = splitRootConfigRecord(parsed);
    if (!changed) continue;
    normalized[path] = stringifyConfig(workspaceConfig);
    normalized[manifestPath] = stringifyYaml(sourceManifest ?? {});
  }
  return normalized;
}

function isRootWorkspaceConfigPath(path: string): boolean {
  return path.endsWith(`/${CONFIG_FILE}`) && !path.includes(PLUGINS_SEGMENT);
}

function stringifyConfig(record: JsonRecord): string {
  return Object.keys(record).length === 0 ? "\n" : stringifyYaml(record);
}
