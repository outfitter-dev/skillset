import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getConfigDir, getProjectRoot } from "@skillset/shared";
import type {
  ConfigSchema,
  GeneratedSettingsSchema,
  ProjectSettings,
} from "@skillset/types";
import { YAML } from "bun";
import {
  applyGeneratedOverrides,
  cleanupStaleHashes,
  loadGeneratedConfig,
  loadYamlConfig,
} from "./loader";
import { mergeConfigs } from "./merge";
import { getProjectId } from "./project";
import { deleteValueAtPath, getValueAtPath, setValueAtPath } from "./utils";
import {
  resetGeneratedValue,
  saveGeneratedConfig,
  setGeneratedValue,
} from "./writer";

export const CONFIG_DEFAULTS: ConfigSchema = {
  version: 1,
  rules: {
    unresolved: "warn",
    ambiguous: "warn",
  },
  resolution: {
    fuzzy_matching: true,
    default_scope_priority: ["project", "user", "plugin"],
  },
  output: {
    max_lines: 500,
    include_layout: false,
  },
  skills: {},
  sets: {},
};

export const CONFIG_PATHS = {
  project: (projectRoot = getProjectRoot()) =>
    join(projectRoot, ".skillset", "config.yaml"),
  user: () => join(getConfigDir(), "config.yaml"),
  generated: () => join(getConfigDir(), "config.generated.json"),
};

export function getConfigPath(
  scope: "project" | "user" | "generated",
  projectRoot?: string
): string {
  if (scope === "user") {
    return CONFIG_PATHS.user();
  }
  if (scope === "generated") {
    return CONFIG_PATHS.generated();
  }
  return CONFIG_PATHS.project(projectRoot);
}

export async function loadConfig(
  projectRoot = getProjectRoot()
): Promise<ConfigSchema> {
  const userYaml = await loadYamlConfig(CONFIG_PATHS.user());
  const generated = await loadGeneratedConfig(CONFIG_PATHS.generated());

  const withUser = mergeConfigs(CONFIG_DEFAULTS, userYaml);
  const withGlobalOverrides = applyGeneratedOverrides(
    withUser,
    userYaml,
    generated
  );

  const projectYaml = await loadYamlConfig(CONFIG_PATHS.project(projectRoot));
  const withProject = mergeConfigs(withGlobalOverrides, projectYaml);

  const projectId = getProjectId(
    projectRoot,
    generated.project_id_strategy ?? "path"
  );
  const projectOverrides = generated.projects[projectId];
  if (!projectOverrides) {
    return withProject;
  }

  const projectGenerated = {
    ...projectOverrides,
    _yaml_hashes: projectOverrides._yaml_hashes ?? {},
  } as ProjectSettings & Pick<GeneratedSettingsSchema, "_yaml_hashes">;

  return applyGeneratedOverrides(withProject, projectYaml, projectGenerated);
}

export async function ensureConfigFiles(
  projectRoot = getProjectRoot()
): Promise<void> {
  for (const path of [CONFIG_PATHS.project(projectRoot), CONFIG_PATHS.user()]) {
    await mkdir(dirname(path), { recursive: true });
    if (!(await Bun.file(path).exists())) {
      await writeYamlConfig(path, CONFIG_DEFAULTS, true);
    }
  }
}

export async function writeYamlConfig(
  path: string,
  config: ConfigSchema | Partial<ConfigSchema>,
  includeSchemaComment = true
): Promise<void> {
  const header = includeSchemaComment
    ? "# yaml-language-server: $schema=https://unpkg.com/@skillset/types/schemas/config.schema.json\n"
    : "";
  const yamlDefaults = YAML.stringify(config, null, 2) ?? "";
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${header}${yamlDefaults}`);
}

export function getConfigValue(
  config: ConfigSchema,
  key: string
): unknown | undefined {
  return getValueAtPath(config, key);
}

export function setConfigValue(
  config: Partial<ConfigSchema>,
  key: string,
  value: unknown
): Partial<ConfigSchema> {
  return setValueAtPath(config, key, value);
}

export function deleteConfigValue(
  config: Partial<ConfigSchema>,
  key: string
): Partial<ConfigSchema> {
  return deleteValueAtPath(config, key);
}

export async function loadYamlConfigByScope(
  scope: "project" | "user",
  projectRoot = getProjectRoot()
): Promise<Partial<ConfigSchema>> {
  const path =
    scope === "user" ? CONFIG_PATHS.user() : CONFIG_PATHS.project(projectRoot);
  return await loadYamlConfig(path);
}

export async function loadGeneratedSettings(): Promise<GeneratedSettingsSchema> {
  return await loadGeneratedConfig(CONFIG_PATHS.generated());
}

export async function writeGeneratedSettings(
  generated: GeneratedSettingsSchema
): Promise<void> {
  await saveGeneratedConfig(CONFIG_PATHS.generated(), generated);
}

export async function setGeneratedConfigValue(
  keyPath: string,
  newValue: unknown,
  projectRoot?: string
): Promise<void> {
  await setGeneratedValue(
    CONFIG_PATHS.generated(),
    projectRoot ? CONFIG_PATHS.project(projectRoot) : CONFIG_PATHS.user(),
    keyPath,
    newValue,
    projectRoot
  );
}

export async function resetGeneratedConfigValue(
  keyPath: string,
  projectRoot?: string
): Promise<void> {
  await resetGeneratedValue(CONFIG_PATHS.generated(), keyPath, projectRoot);
}

export async function cleanupGeneratedConfig(
  userYaml: Partial<ConfigSchema>,
  projectYaml?: Partial<ConfigSchema>,
  projectRoot?: string
): Promise<GeneratedSettingsSchema> {
  const generated = await loadGeneratedConfig(CONFIG_PATHS.generated());
  const cleanedGlobal = cleanupStaleHashes(generated, userYaml);

  if (!(projectRoot && projectYaml)) {
    return cleanedGlobal;
  }

  const projectId = getProjectId(
    projectRoot,
    generated.project_id_strategy ?? "path"
  );
  const projectSettings = cleanedGlobal.projects[projectId];
  if (!projectSettings) {
    return cleanedGlobal;
  }
  cleanedGlobal.projects[projectId] = cleanupStaleHashes(
    projectSettings,
    projectYaml
  );
  return cleanedGlobal;
}
