import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { listStandardProfileSchemaSnapshots } from "@skillset/registry";

import { readString, readStringArray } from "./config";
import { pluginDependencySummaries } from "./dependencies";
import { resolveLicense, type ResolvedLicense } from "./licenses";
import { compareStrings } from "./path";
import {
  copyFileFromSource,
  lockRootsFor,
  renderedFileModes,
  textFile,
  type LockItem,
  type LockRoot,
} from "./render-support";
import { renderCodexAuthor } from "./source-author";
import { readSourceListing } from "./source-listing";
import { renderValidatedJson } from "./structured-output";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  RenderedFile,
  SourcePlugin,
} from "./types";
import { pluginVersion } from "./versioning";
import { isJsonRecord } from "./yaml";

export const AGENT_PLUGIN_MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

const AGENT_PLUGIN_PROFILE = "agent-plugins-1.0" as const;
const AGENT_PLUGIN_OUTPUT_ROOT = "plugins";
// `bin/` is deliberately absent: the Agent Plugins package may include only
// executables referenced by a standard component. SET-404 owns that typed MCP
// normalization; copying the directory here would leak unreferenced binaries.
const SUPPORT_PATHS = [
  "README.md",
  "CHANGELOG.md",
  "assets",
  "scripts",
  "src",
] as const;

interface AgentPluginManifestSchema {
  readonly properties: Readonly<Record<string, JsonRecord>>;
  readonly required: readonly string[];
}

export interface AgentPluginStandardClassification {
  readonly reason?: string;
  readonly status: "supported" | "unsupported";
}

/**
 * Classify the package identity before emitting any component. Agent Plugins
 * owns the complete package boundary, so an invalid manifest name suppresses
 * the root and every nested standard component rather than leaving a partial
 * package behind.
 */
export function classifyAgentPluginStandard(
  plugin: SourcePlugin
): AgentPluginStandardClassification {
  const schema = agentPluginManifestSchema();
  const { name } = schema.properties;
  const maxLength = numberProperty(name, "maxLength");
  const pattern = stringProperty(name, "pattern");
  if (
    plugin.id.length === 0 ||
    plugin.id.length > maxLength ||
    !new RegExp(pattern, "u").test(plugin.id)
  ) {
    return {
      reason: `plugin id ${JSON.stringify(plugin.id)} does not satisfy the Agent Plugins 1.0 name contract`,
      status: "unsupported",
    };
  }
  return { status: "supported" };
}

export async function renderAgentPluginStandardPackages(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  if (
    !graph.root.compile.agents.plugins ||
    !graph.standardProjections.adopted.includes(AGENT_PLUGIN_PROFILE)
  ) {
    return [];
  }

  const rendered: RenderedFile[] = [];
  const lockRoot = lockRootsFor(
    lockRoots,
    AGENT_PLUGIN_OUTPUT_ROOT,
    "workspace"
  );
  const rootLicense = await resolveRootLicense(graph);
  for (const plugin of graph.plugins) {
    if (classifyAgentPluginStandard(plugin).status !== "supported") continue;
    const pluginLicense = await resolvePluginLicense(
      graph,
      plugin,
      rootLicense
    );
    const packageRoot = path.posix.join(
      AGENT_PLUGIN_OUTPUT_ROOT,
      plugin.id,
      "agents"
    );
    const manifest = renderAgentPluginManifest(graph, plugin, pluginLicense);
    validateAgentPluginManifest(manifest);
    const manifestFile = textFile(
      path.posix.join(packageRoot, "plugin.json"),
      renderValidatedJson(manifest, `${plugin.id} Agent Plugins manifest`),
      normalizePath(path.relative(graph.rootPath, plugin.configPath))
    );
    const rootFiles: RenderedFile[] = [manifestFile];
    if (pluginLicense !== undefined) {
      rootFiles.push(
        textFile(
          path.posix.join(packageRoot, "LICENSE.txt"),
          pluginLicense.content,
          pluginLicense.sourcePath
        )
      );
    }
    for (const supportPath of SUPPORT_PATHS) {
      rootFiles.push(
        ...(await copySupportPath(graph, plugin, packageRoot, supportPath))
      );
    }
    const packageFiles = rootFiles
      .filter((file) => !file.path.endsWith(".gitkeep"))
      .toSorted((left, right) => compareStrings(left.path, right.path));
    rendered.push(...packageFiles);
    lockRoot.items.push(
      agentPluginLockItem(graph, plugin, packageFiles, pluginLicense)
    );
  }
  return rendered;
}

export function renderAgentPluginManifest(
  graph: BuildGraph,
  plugin: SourcePlugin,
  license: ResolvedLicense | undefined
): JsonRecord {
  const listing = readSourceListing(plugin.metadata);
  const keywords =
    readStringArray(listing, "keywords") ??
    readStringArray(plugin.metadata, "keywords");
  return omitUndefined({
    $schema: AGENT_PLUGIN_MANIFEST_SCHEMA,
    author:
      renderCodexAuthor(plugin.metadata.author) ??
      renderCodexAuthor(graph.root.metadata.author),
    description:
      readString(listing, "summary") ??
      readString(listing, "description") ??
      readString(plugin.metadata, "description") ??
      plugin.id,
    homepage: readString(plugin.metadata, "homepage"),
    keywords: keywords === undefined ? undefined : [...keywords],
    license: license?.manifestValue,
    name: plugin.id,
    repository: readString(plugin.metadata, "repository"),
    version: pluginVersion(graph, plugin),
  });
}

/** Validate output against the closed, pinned Agent Plugins manifest schema. */
export function validateAgentPluginManifest(value: JsonRecord): void {
  const schema = agentPluginManifestSchema();
  for (const key of Object.keys(value)) {
    if (schema.properties[key] === undefined) {
      throw new Error(
        `skillset: Agent Plugins plugin.json has unknown field ${key}`
      );
    }
  }
  for (const required of schema.required) {
    if (value[required] === undefined) {
      throw new Error(
        `skillset: Agent Plugins plugin.json is missing required field ${required}`
      );
    }
  }
  const schemaId = schema.properties.$schema?.const;
  if (value.$schema !== schemaId) {
    throw new Error(
      `skillset: Agent Plugins plugin.json $schema must be ${String(schemaId)}`
    );
  }
  const nameSchema = schema.properties.name;
  const { name } = value;
  if (
    typeof name !== "string" ||
    name.length < numberProperty(nameSchema, "minLength") ||
    name.length > numberProperty(nameSchema, "maxLength") ||
    !new RegExp(stringProperty(nameSchema, "pattern"), "u").test(name)
  ) {
    throw new Error(
      "skillset: Agent Plugins plugin.json name violates the pinned schema"
    );
  }
  for (const key of [
    "version",
    "description",
    "homepage",
    "repository",
    "license",
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new Error(
        `skillset: Agent Plugins plugin.json ${key} must be a string`
      );
    }
  }
  if (value.keywords !== undefined) {
    if (
      !Array.isArray(value.keywords) ||
      value.keywords.some((keyword) => typeof keyword !== "string")
    ) {
      throw new Error(
        "skillset: Agent Plugins plugin.json keywords must be strings"
      );
    }
  }
  if (value.author !== undefined) validateAuthor(value.author, schema);
}

function validateAuthor(
  value: JsonValue,
  schema: AgentPluginManifestSchema
): void {
  if (!isJsonRecord(value)) {
    throw new Error(
      "skillset: Agent Plugins plugin.json author must be an object"
    );
  }
  const authorProperties = schema.properties.author?.properties;
  if (!isJsonRecord(authorProperties)) {
    throw new Error("skillset: pinned Agent Plugins author schema is invalid");
  }
  for (const [key, authorValue] of Object.entries(value)) {
    if (authorProperties[key] === undefined) {
      throw new Error(
        `skillset: Agent Plugins plugin.json author has unknown field ${key}`
      );
    }
    if (typeof authorValue !== "string") {
      throw new TypeError(
        `skillset: Agent Plugins plugin.json author.${key} must be a string`
      );
    }
  }
}

function agentPluginManifestSchema(): AgentPluginManifestSchema {
  const snapshot = listStandardProfileSchemaSnapshots(
    AGENT_PLUGIN_PROFILE
  ).find((candidate) => {
    const parsed = JSON.parse(candidate.body) as JsonRecord;
    return parsed.$id === AGENT_PLUGIN_MANIFEST_SCHEMA;
  });
  if (snapshot === undefined) {
    throw new Error(
      "skillset: pinned Agent Plugins manifest schema is missing"
    );
  }
  const parsed = JSON.parse(snapshot.body) as JsonRecord;
  if (!isJsonRecord(parsed.properties) || !Array.isArray(parsed.required)) {
    throw new Error(
      "skillset: pinned Agent Plugins manifest schema is invalid"
    );
  }
  const required = parsed.required.filter(
    (value): value is string => typeof value === "string"
  );
  if (required.length !== parsed.required.length) {
    throw new Error(
      "skillset: pinned Agent Plugins required fields are invalid"
    );
  }
  return {
    properties: parsed.properties as Readonly<Record<string, JsonRecord>>,
    required,
  };
}

async function copySupportPath(
  graph: BuildGraph,
  plugin: SourcePlugin,
  packageRoot: string,
  relativePath: string
): Promise<readonly RenderedFile[]> {
  const sourcePath = path.join(plugin.path, relativePath);
  let stats;
  try {
    stats = await lstat(sourcePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(
      `skillset: Agent Plugins support path ${normalizePath(path.relative(graph.rootPath, sourcePath))} must not be a symbolic link`
    );
  }
  const pluginRoot = await realpath(plugin.path);
  const resolvedSource = await realpath(sourcePath);
  assertContained(pluginRoot, resolvedSource, sourcePath);
  if (stats.isFile()) {
    return [
      await copyFileFromSource(
        sourcePath,
        path.posix.join(packageRoot, relativePath),
        normalizePath(path.relative(graph.rootPath, sourcePath))
      ),
    ];
  }
  if (!stats.isDirectory()) return [];
  return copySupportDirectory(
    graph,
    pluginRoot,
    sourcePath,
    path.posix.join(packageRoot, relativePath)
  );
}

async function copySupportDirectory(
  graph: BuildGraph,
  pluginRoot: string,
  sourceRoot: string,
  targetRoot: string
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) =>
    compareStrings(left.name, right.name)
  )) {
    const sourcePath = path.join(sourceRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `skillset: Agent Plugins support path ${normalizePath(path.relative(graph.rootPath, sourcePath))} must not be a symbolic link`
      );
    }
    const resolvedSource = await realpath(sourcePath);
    assertContained(pluginRoot, resolvedSource, sourcePath);
    const targetPath = path.posix.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      rendered.push(
        ...(await copySupportDirectory(
          graph,
          pluginRoot,
          sourcePath,
          targetPath
        ))
      );
    } else if (entry.isFile() && !entry.name.endsWith(".DS_Store")) {
      rendered.push(
        await copyFileFromSource(
          sourcePath,
          targetPath,
          normalizePath(path.relative(graph.rootPath, sourcePath))
        )
      );
    }
  }
  return rendered;
}

function agentPluginLockItem(
  graph: BuildGraph,
  plugin: SourcePlugin,
  files: readonly RenderedFile[],
  license: ResolvedLicense | undefined
): LockItem {
  const relativeFiles = files
    .map((file) =>
      normalizePath(path.relative(AGENT_PLUGIN_OUTPUT_ROOT, file.path))
    )
    .toSorted(compareStrings);
  const dependencies = pluginDependencySummaries(graph, plugin);
  return {
    consumers: [{ phase: "baseline", standardProfile: AGENT_PLUGIN_PROFILE }],
    ...(dependencies.length === 0 ? {} : { dependencies }),
    fileModes: renderedFileModes(AGENT_PLUGIN_OUTPUT_ROOT, files),
    files: relativeFiles,
    kind: "plugin",
    name: plugin.id,
    outputHash: hashRenderedFiles("agent-plugins-output-v1", files),
    outputPath: `${plugin.id}/agents/plugin.json`,
    owner: { standardProfile: AGENT_PLUGIN_PROFILE },
    renderInputsHash: hashJson("agent-plugins-inputs-v1", {
      author: plugin.metadata.author ?? graph.root.metadata.author,
      license: license?.manifestValue,
      metadata: plugin.metadata,
      version: pluginVersion(graph, plugin),
    }),
    sourceHash: hashRenderedFiles("agent-plugins-source-v1", files),
    ...(plugin.sourceOrigin === undefined
      ? {}
      : { sourceOrigin: plugin.sourceOrigin }),
    sourcePath: normalizePath(path.relative(graph.rootPath, plugin.path)),
    targetState: "sync",
    validation: "structured",
    version: pluginVersion(graph, plugin),
  };
}

function hashRenderedFiles(
  domain: string,
  files: readonly RenderedFile[]
): string {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`);
  for (const file of [...files].toSorted((left, right) =>
    compareStrings(left.path, right.path)
  )) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.mode));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function hashJson(domain: string, value: JsonRecord): string {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`);
  hash.update(JSON.stringify(value));
  return `sha256:${hash.digest("hex")}`;
}

function omitUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined)
  );
}

function numberProperty(record: JsonRecord | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value !== "number") {
    throw new TypeError(`skillset: pinned Agent Plugins ${key} is invalid`);
  }
  return value;
}

function stringProperty(record: JsonRecord | undefined, key: string): string {
  const value = record?.[key];
  if (typeof value !== "string") {
    throw new TypeError(`skillset: pinned Agent Plugins ${key} is invalid`);
  }
  return value;
}

function assertContained(
  root: string,
  candidate: string,
  sourcePath: string
): void {
  const relativePath = path.relative(root, candidate);
  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  ) {
    return;
  }
  throw new Error(
    `skillset: Agent Plugins support path ${sourcePath} resolves outside the plugin root`
  );
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function resolveRootLicense(
  graph: BuildGraph
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: normalizePath(path.relative(graph.rootPath, graph.rootManifestPath)),
    metadata: graph.root.metadata,
    scopePath: graph.sourceRootPath,
    sourcePath: graph.rootManifestPath,
  });
}

async function resolvePluginLicense(
  graph: BuildGraph,
  plugin: SourcePlugin,
  rootLicense: ResolvedLicense | undefined
): Promise<ResolvedLicense | undefined> {
  return resolveLicense({
    graph,
    label: normalizePath(path.relative(graph.rootPath, plugin.configPath)),
    metadata: plugin.metadata,
    ...(rootLicense === undefined ? {} : { parent: rootLicense }),
    scopePath: plugin.path,
    sourcePath: plugin.configPath,
  });
}
