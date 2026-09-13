import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  AGENT_PLUGINS_MCP_SCHEMA,
  parsePortableMcpSource,
} from "@skillset/core";
import {
  AGENT_PLUGIN_MANIFEST_SCHEMA,
  validateAgentPluginManifest,
} from "@skillset/core/internal/render-agent-plugins-standard";
import type { JsonRecord } from "@skillset/core/internal/types";
import { validateVersionField } from "@skillset/core/internal/versioning";
import { isJsonRecord, parseMarkdown } from "@skillset/core/internal/yaml";
import {
  SOURCE_LICENSE_IDS,
  validateSkillFrontmatter,
  validateSourceMetadata,
} from "@skillset/schema";

const ROOT_FILES = new Set([
  "CHANGELOG.md",
  "LICENSE",
  "LICENSE.txt",
  "README.md",
  "mcp.json",
  "plugin.json",
]);
const ROOT_DIRECTORIES = new Set(["assets", "scripts", "skills", "src"]);
const STANDARD_SKILL_FRONTMATTER_KEYS = new Set([
  "allowed-tools",
  "compatibility",
  "description",
  "license",
  "metadata",
  "name",
]);

export interface AgentPluginImportInspection {
  readonly manifest: JsonRecord;
  readonly manifestName: string;
  readonly version?: string;
}

export async function hasAgentPluginManifest(
  sourcePath: string
): Promise<boolean> {
  const manifestPath = join(sourcePath, "plugin.json");
  let manifestStats;
  try {
    manifestStats = await lstat(manifestPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
  if (!manifestStats.isFile()) return true;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return (
      isJsonRecord(parsed) && parsed.$schema === AGENT_PLUGIN_MANIFEST_SCHEMA
    );
  } catch {
    return false;
  }
}

export async function inspectAgentPluginImport(
  sourcePath: string,
  options: { readonly ignoreSetupScaffold?: boolean } = {}
): Promise<AgentPluginImportInspection | undefined> {
  const manifestPath = join(sourcePath, "plugin.json");
  let manifestStats;
  try {
    manifestStats = await lstat(manifestPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
  if (manifestStats.isSymbolicLink()) {
    throw new Error(
      "skillset: Agent Plugins import cannot preserve symbolic link plugin.json"
    );
  }
  if (!manifestStats.isFile()) {
    throw new Error(
      `skillset: Agent Plugins manifest ${manifestPath} must be a regular file`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `skillset: Agent Plugins manifest ${manifestPath} is not valid JSON: ${errorMessage(error)}`
    );
  }
  if (!isJsonRecord(parsed)) {
    throw new Error(
      `skillset: Agent Plugins manifest ${manifestPath} must contain a JSON object`
    );
  }
  if (parsed.$schema !== AGENT_PLUGIN_MANIFEST_SCHEMA) {
    throw new Error(
      `skillset: Agent Plugins manifest ${manifestPath} must declare $schema ${AGENT_PLUGIN_MANIFEST_SCHEMA}`
    );
  }
  if (parsed.extensions !== undefined) {
    throw new Error(
      "skillset: Agent Plugins manifest extensions cannot be mapped to canonical portable source; remove or isolate the extension before importing"
    );
  }
  validateAgentPluginManifest(parsed);
  if (
    typeof parsed.license === "string" &&
    !SOURCE_LICENSE_IDS.includes(
      parsed.license as (typeof SOURCE_LICENSE_IDS)[number]
    )
  ) {
    throw new Error(
      `skillset: Agent Plugins license ${JSON.stringify(parsed.license)} cannot be mapped to canonical source; supported values are ${SOURCE_LICENSE_IDS.join(", ")}`
    );
  }
  if (
    typeof parsed.license === "string" &&
    ((await isFile(join(sourcePath, "LICENSE"))) ||
      (await isFile(join(sourcePath, "LICENSE.txt"))))
  ) {
    throw new Error(
      "skillset: Agent Plugins package license metadata and bundled license text cannot both be mapped to canonical source; remove one before importing"
    );
  }
  validateVersionField(parsed, "Agent Plugins manifest version");
  const sourceMetadataValidation = validateSourceMetadata(
    sourceMetadataForManifest(parsed, "agent-plugin-import"),
    "Agent Plugins manifest"
  );
  if (!sourceMetadataValidation.ok) {
    throw new Error(
      `skillset: Agent Plugins manifest metadata cannot be mapped to canonical source: ${sourceMetadataValidation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`
    );
  }
  const mcpPath = join(sourcePath, "mcp.json");
  const mcp = await inspectAgentPluginMcp(sourcePath, mcpPath);
  const referencedBinPaths = (mcp?.supportPaths ?? []).filter(
    (supportPath) => supportPath === "bin" || supportPath.startsWith("bin/")
  );
  await validateAgentPluginPackageLayout(
    sourcePath,
    options.ignoreSetupScaffold === true,
    referencedBinPaths
  );

  return {
    manifest: parsed,
    manifestName: parsed.name as string,
    ...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
  };
}

export function agentPluginSourceMetadata(
  inspection: AgentPluginImportInspection,
  name: string
): JsonRecord {
  return sourceMetadataForManifest(inspection.manifest, name);
}

function sourceMetadataForManifest(
  manifest: JsonRecord,
  name: string
): JsonRecord {
  return omitUndefined({
    name,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage,
    repository: manifest.repository,
    license: manifest.license,
    keywords: manifest.keywords,
  });
}

export function agentPluginIdentityWarnings(
  inspection: AgentPluginImportInspection,
  name: string
): readonly string[] {
  if (inspection.manifestName === name) return [];
  return [
    `Agent Plugins manifest name ${JSON.stringify(inspection.manifestName)} was explicitly mapped to Skillset plugin id ${JSON.stringify(name)}.`,
  ];
}

export function agentPluginCanonicalSkillFrontmatter(
  frontmatter: JsonRecord
): JsonRecord {
  const { "allowed-tools": allowedTools, license, ...canonical } = frontmatter;
  return {
    ...canonical,
    ...(allowedTools === undefined
      ? {}
      : { allowed_tools: { agents: allowedTools } }),
    ...(typeof license === "string" &&
    SOURCE_LICENSE_IDS.includes(license as (typeof SOURCE_LICENSE_IDS)[number])
      ? { skillset: { license } }
      : {}),
  };
}

async function validateAgentPluginPackageLayout(
  sourcePath: string,
  ignoreSetupScaffold: boolean,
  referencedBinPaths: readonly string[]
): Promise<void> {
  const entries = await readdir(sourcePath, { withFileTypes: true });
  if (
    (await isFile(join(sourcePath, "LICENSE"))) &&
    (await isFile(join(sourcePath, "LICENSE.txt")))
  ) {
    throw new Error(
      "skillset: Agent Plugins package contains both LICENSE and LICENSE.txt; remove one before importing"
    );
  }
  const unknown: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    if (entry.name === ".git") continue;
    if (ignoreSetupScaffold && isSetupScaffold(entry.name)) continue;
    const path = join(sourcePath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `skillset: Agent Plugins import cannot preserve symbolic link ${entry.name}`
      );
    }
    if (isPortableRootEntry(entry, referencedBinPaths.length > 0)) continue;
    if (entry.isDirectory() && isExtensionNamespace(entry.name)) {
      throw new Error(
        `skillset: Agent Plugins extension namespace directory ${entry.name} cannot be mapped to canonical portable source`
      );
    }
    unknown.push(entry.name);
    await lstat(path);
  }
  if (unknown.length > 0) {
    throw new Error(
      `skillset: Agent Plugins package contains unmappable root paths: ${unknown.toSorted().join(", ")}`
    );
  }

  for (const directory of ["assets", "scripts", "src"] as const) {
    await validatePortableTree(sourcePath, directory);
  }
  if (referencedBinPaths.length > 0) {
    await validateReferencedBinTree(sourcePath, referencedBinPaths);
  }
  await validateImmediateChildSkills(sourcePath);
}

function isPortableRootEntry(
  entry: { readonly name: string; isDirectory(): boolean; isFile(): boolean },
  allowBin: boolean
): boolean {
  return (
    (entry.isFile() && ROOT_FILES.has(entry.name)) ||
    (entry.isDirectory() && ROOT_DIRECTORIES.has(entry.name)) ||
    (entry.isDirectory() && entry.name === "bin" && allowBin)
  );
}

async function validateReferencedBinTree(
  sourcePath: string,
  referencedBinPaths: readonly string[]
): Promise<void> {
  await validatePortableTree(sourcePath, "bin");
  const referenced = await Promise.all(
    referencedBinPaths.map(async (path) => ({
      directory: (await lstat(join(sourcePath, path))).isDirectory(),
      path,
    }))
  );
  const unexpected = (await portableTreeEntries(sourcePath, "bin")).filter(
    (entry) =>
      !referenced.some(
        (reference) =>
          entry === reference.path ||
          reference.path.startsWith(`${entry}/`) ||
          (reference.directory && entry.startsWith(`${reference.path}/`))
      )
  );
  if (unexpected.length > 0) {
    throw new Error(
      `skillset: Agent Plugins package contains unreferenced bin paths that cannot be mapped to canonical portable source: ${unexpected.toSorted().join(", ")}`
    );
  }
}

async function portableTreeEntries(
  sourcePath: string,
  relativePath: string
): Promise<readonly string[]> {
  const entries = await readdir(join(sourcePath, relativePath), {
    withFileTypes: true,
  });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const childRelative = `${relativePath}/${entry.name}`;
    paths.push(childRelative);
    if (entry.isDirectory()) {
      paths.push(...(await portableTreeEntries(sourcePath, childRelative)));
    }
  }
  return paths;
}

function isSetupScaffold(name: string): boolean {
  return (
    name === ".skillset" || name === "skillset.lock" || name === "skillset.yaml"
  );
}

async function validateImmediateChildSkills(sourcePath: string): Promise<void> {
  const skillsPath = join(sourcePath, "skills");
  if (!(await isDirectory(skillsPath))) return;
  const entries = await readdir(skillsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `skillset: Agent Plugins import cannot preserve symbolic link skills/${entry.name}`
      );
    }
    if (!entry.isDirectory()) {
      throw new Error(
        `skillset: Agent Plugins skills must be immediate child directories containing SKILL.md; found skills/${entry.name}`
      );
    }
    const skillFile = join(skillsPath, entry.name, "SKILL.md");
    if (!(await isFile(skillFile))) {
      throw new Error(
        `skillset: Agent Plugins skill skills/${entry.name} is missing SKILL.md; nested skill groups cannot be imported`
      );
    }
    await validateAgentPluginSkill(skillFile, entry.name);
    await validatePortableTree(sourcePath, `skills/${entry.name}`);
  }
}

async function inspectAgentPluginMcp(sourcePath: string, mcpPath: string) {
  if (!(await isFile(mcpPath))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(mcpPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `skillset: Agent Plugins MCP ${mcpPath} is not valid JSON: ${errorMessage(error)}`
    );
  }
  if (!isJsonRecord(parsed) || parsed.$schema !== AGENT_PLUGINS_MCP_SCHEMA) {
    throw new Error(
      `skillset: Agent Plugins MCP ${mcpPath} must declare $schema ${AGENT_PLUGINS_MCP_SCHEMA}`
    );
  }
  const model = await parsePortableMcpSource({
    pluginRoot: sourcePath,
    sourcePath: mcpPath,
  });
  if (model.unsupported.length > 0) {
    const details = model.unsupported.map(
      (entry) =>
        `MCP server ${entry.name} is unsupported: ${entry.reason}; fields: ${entry.fields.join(", ")}`
    );
    throw new Error(
      `skillset: Agent Plugins MCP ${mcpPath} contains entries that cannot be mapped to canonical portable source: ${details.join("; ")}`
    );
  }
  return model;
}

async function validateAgentPluginSkill(
  skillFile: string,
  directoryName: string
): Promise<void> {
  const { frontmatter } = parseMarkdown(
    await readFile(skillFile, "utf8"),
    skillFile
  );
  const unknownKeys = Object.keys(frontmatter)
    .filter((key) => !STANDARD_SKILL_FRONTMATTER_KEYS.has(key))
    .toSorted();
  if (unknownKeys.length > 0) {
    throw new Error(
      `skillset: Agent Plugins skill ${skillFile} contains unmappable frontmatter fields: ${unknownKeys.join(", ")}`
    );
  }
  const name = frontmatter.name;
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    [...name].length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
  ) {
    throw new Error(
      `skillset: Agent Plugins skill ${skillFile} name must contain 1 to 64 lowercase letters, digits, or single hyphen-separated segments`
    );
  }
  if (name !== directoryName) {
    throw new Error(
      `skillset: Agent Plugins skill ${skillFile} name ${JSON.stringify(name)} must match directory ${JSON.stringify(directoryName)}`
    );
  }
  requireBoundedString(
    frontmatter.description,
    1024,
    `Agent Plugins skill ${skillFile} description`
  );
  if (frontmatter.compatibility !== undefined) {
    requireBoundedString(
      frontmatter.compatibility,
      500,
      `Agent Plugins skill ${skillFile} compatibility`
    );
  }
  if (frontmatter["allowed-tools"] !== undefined) {
    requireBoundedString(
      frontmatter["allowed-tools"],
      Number.POSITIVE_INFINITY,
      `Agent Plugins skill ${skillFile} allowed-tools`
    );
  }
  if (frontmatter.license !== undefined) {
    const license = requireBoundedString(
      frontmatter.license,
      Number.POSITIVE_INFINITY,
      `Agent Plugins skill ${skillFile} license`
    );
    if (
      !SOURCE_LICENSE_IDS.includes(
        license as (typeof SOURCE_LICENSE_IDS)[number]
      ) &&
      license !== "LICENSE.txt"
    ) {
      throw new Error(
        `skillset: Agent Plugins skill ${skillFile} license ${JSON.stringify(license)} cannot be mapped to canonical source`
      );
    }
    if (
      license === "LICENSE.txt" &&
      !(await isFile(join(dirname(skillFile), "LICENSE.txt")))
    ) {
      throw new Error(
        `skillset: Agent Plugins skill ${skillFile} references missing LICENSE.txt`
      );
    }
    if (
      SOURCE_LICENSE_IDS.includes(
        license as (typeof SOURCE_LICENSE_IDS)[number]
      ) &&
      (await isFile(join(dirname(skillFile), "LICENSE.txt")))
    ) {
      throw new Error(
        `skillset: Agent Plugins skill ${skillFile} license metadata and bundled LICENSE.txt cannot both be mapped to canonical source; remove one before importing`
      );
    }
  }
  if (frontmatter.metadata !== undefined) {
    if (!isJsonRecord(frontmatter.metadata)) {
      throw new Error(
        `skillset: Agent Plugins skill ${skillFile} metadata must be an object of string values`
      );
    }
    const invalidMetadata = Object.entries(frontmatter.metadata)
      .filter((entry) => typeof entry[1] !== "string")
      .map((entry) => entry[0])
      .toSorted();
    if (invalidMetadata.length > 0) {
      throw new Error(
        `skillset: Agent Plugins skill ${skillFile} metadata values must be strings: ${invalidMetadata.join(", ")}`
      );
    }
  }
  const canonicalValidation = validateSkillFrontmatter(
    agentPluginCanonicalSkillFrontmatter(frontmatter),
    `Agent Plugins skill ${skillFile}`
  );
  if (!canonicalValidation.ok) {
    throw new Error(
      `skillset: Agent Plugins skill ${skillFile} cannot be mapped to canonical source: ${canonicalValidation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`
    );
  }
}

function requireBoundedString(
  value: unknown,
  maxLength: number,
  label: string
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    [...value].length > maxLength
  ) {
    throw new Error(
      `skillset: ${label} must be a non-empty string${Number.isFinite(maxLength) ? ` of at most ${maxLength} characters` : ""}`
    );
  }
  return value;
}

async function validatePortableTree(
  sourcePath: string,
  relativePath: string
): Promise<void> {
  const root = join(sourcePath, relativePath);
  if (!(await isDirectory(root))) return;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const childRelative = `${relativePath}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `skillset: Agent Plugins import cannot preserve symbolic link ${childRelative}`
      );
    }
    if (entry.isDirectory()) {
      await validatePortableTree(sourcePath, childRelative);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `skillset: Agent Plugins import cannot preserve special path ${childRelative}`
      );
    }
  }
}

function isExtensionNamespace(name: string): boolean {
  return /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/u.test(name);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function omitUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined)
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
