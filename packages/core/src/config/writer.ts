import { existsSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ConfigSchema,
  GeneratedSettingsSchema,
  ProjectSettings,
} from "@skillset/types";
import { lock } from "proper-lockfile";
import { hashValue } from "./hash";
import { loadGeneratedConfig, loadYamlConfig } from "./loader";
import { getProjectId } from "./project";
import { deleteValueAtPath, getValueAtPath, setValueAtPath } from "./utils";

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  ensureDir(filePath);
  if (!existsSync(filePath)) {
    await Bun.write(filePath, "{}");
  }

  const lockRelease = await lock(filePath, {
    retries: { retries: 3, minTimeout: 100, maxTimeout: 1000 },
    stale: 10_000,
  });

  const tempPath = join(
    tmpdir(),
    `skillset-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );

  try {
    await Bun.write(tempPath, JSON.stringify(data, null, 2));
    renameSync(tempPath, filePath);
  } finally {
    await lockRelease();
  }
}

export async function saveGeneratedConfig(
  path: string,
  generated: GeneratedSettingsSchema
): Promise<void> {
  await atomicWriteJson(path, generated);
}

function ensureProjectSettings(
  generated: GeneratedSettingsSchema,
  projectId: string
): ProjectSettings {
  const existing = generated.projects[projectId];
  if (existing?._yaml_hashes) {
    return existing;
  }
  const created: ProjectSettings = { _yaml_hashes: {} };
  generated.projects[projectId] = created;
  return created;
}

export async function setGeneratedValue(
  generatedPath: string,
  yamlPath: string,
  keyPath: string,
  newValue: unknown,
  projectPath?: string
): Promise<void> {
  const generated = loadGeneratedConfig(generatedPath);
  const yamlConfig = loadYamlConfig(yamlPath) as ConfigSchema;

  const yamlValue = getValueAtPath(yamlConfig, keyPath);
  const yamlHash = hashValue(yamlValue);

  const projectId = projectPath
    ? getProjectId(projectPath, generated.project_id_strategy ?? "path")
    : undefined;

  const target = projectId
    ? ensureProjectSettings(generated, projectId)
    : generated;

  target._yaml_hashes[keyPath] = yamlHash;
  const updated = setValueAtPath(target, keyPath, newValue) as typeof target;

  if (projectId) {
    generated.projects[projectId] = updated as ProjectSettings;
  } else {
    Object.assign(generated, updated);
  }

  await saveGeneratedConfig(generatedPath, generated);
}

export async function resetGeneratedValue(
  generatedPath: string,
  keyPath: string,
  projectPath?: string
): Promise<void> {
  const generated = loadGeneratedConfig(generatedPath);

  const projectId = projectPath
    ? getProjectId(projectPath, generated.project_id_strategy ?? "path")
    : undefined;

  const target = projectId
    ? ensureProjectSettings(generated, projectId)
    : generated;

  delete target._yaml_hashes[keyPath];
  const updated = deleteValueAtPath(target, keyPath) as typeof target;

  if (projectId) {
    generated.projects[projectId] = updated as ProjectSettings;
  } else {
    Object.assign(generated, updated);
  }

  await saveGeneratedConfig(generatedPath, generated);
}
