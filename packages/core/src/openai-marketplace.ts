import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import {
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
} from "./config";
import type { ResolvedLicense } from "./licenses";
import { pluginBundleRoot } from "./plugin-output";
import { renderPluginManifest } from "./render-plugin-manifest";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  MarketplacePluginEntryConfig,
  SourcePlugin,
} from "./types";
import { isJsonRecord } from "./yaml";

const REMOTE_INTERFACE_PATH_FIELDS = [
  "composerIcon",
  "logo",
  "logoDark",
  "screenshots",
] as const;

/**
 * Renders one closed OpenAI marketplace entry. The generated ChatGPT manifest
 * remains the package metadata authority; catalog configuration can only
 * replace the reviewed listing and policy fields.
 */
export function renderOpenAiMarketplacePlugin(args: {
  readonly entry: MarketplacePluginEntryConfig;
  readonly graph: BuildGraph;
  readonly license: ResolvedLicense | undefined;
  readonly plugin: SourcePlugin | undefined;
}): JsonRecord {
  const options =
    readRecord(args.entry as unknown as JsonRecord, "codex") ?? {};
  const source = openAiMarketplaceSource(
    args.graph,
    args.entry,
    options,
    args.plugin
  );
  const local = source.source === "local";
  const manifest =
    args.plugin === undefined
      ? {}
      : renderPluginManifest(
          args.graph,
          args.plugin,
          "codex",
          [],
          args.license
        );
  const extension =
    readRecord(readRecord(manifest, "extensions") ?? {}, "com.openai") ?? {};
  const generatedInterface = readRecord(extension, "interface") ?? {};
  const configuredInterface = readRecord(options, "interface") ?? {};
  const legacyDisplayName = readString(options, "displayName");
  const homepage = local
    ? readString(manifest, "homepage")
    : (readString(options, "homepage") ?? readString(manifest, "homepage"));
  const interfaceWithDisplayName =
    legacyDisplayName === undefined ||
    configuredInterface.displayName !== undefined
      ? configuredInterface
      : mergeRecords({ displayName: legacyDisplayName }, configuredInterface);
  const interfaceWithHomepage =
    homepage === undefined || interfaceWithDisplayName.websiteUrl !== undefined
      ? mergeRecords(generatedInterface, interfaceWithDisplayName)
      : mergeRecords(
          mergeRecords(generatedInterface, { websiteUrl: homepage }),
          interfaceWithDisplayName
        );
  const category =
    readString(options, "category") ??
    readString(interfaceWithHomepage, "category") ??
    "Other";
  const effectiveInterface = stripUndefined(
    mergeRecords(interfaceWithHomepage, { category })
  );
  const listingInterface = local
    ? effectiveInterface
    : Object.fromEntries(
        Object.entries(effectiveInterface).filter(
          ([field]) =>
            !REMOTE_INTERFACE_PATH_FIELDS.includes(
              field as (typeof REMOTE_INTERFACE_PATH_FIELDS)[number]
            )
        )
      );
  if (local && args.plugin !== undefined) {
    validateLocalInterfaceAssets(args.plugin, args.entry.id, listingInterface);
  }

  const policy = readRecord(options, "policy") ?? {};
  const products = readStringArray(policy, "products");
  return stripUndefined({
    name: args.entry.id,
    source,
    policy: {
      installation: readString(policy, "installation") ?? "AVAILABLE",
      authentication: readString(policy, "authentication") ?? "ON_INSTALL",
      ...(products === undefined
        ? {}
        : { products: products.map((product) => product.toUpperCase()) }),
    },
    category,
    version: local
      ? readString(manifest, "version")
      : (readString(options, "version") ?? readString(manifest, "version")),
    description: local
      ? readString(manifest, "description")
      : (readString(options, "description") ??
        readString(manifest, "description")),
    keywords: copyStrings(
      local
        ? readStringArray(manifest, "keywords")
        : (readStringArray(options, "keywords") ??
            readStringArray(manifest, "keywords"))
    ),
    author: local ? manifest.author : (options.author ?? manifest.author),
    homepage,
    interface: listingInterface,
  });
}

function openAiMarketplaceSource(
  graph: BuildGraph,
  entry: MarketplacePluginEntryConfig,
  options: JsonRecord,
  plugin: SourcePlugin | undefined
): JsonRecord {
  const configured = readRecord(options, "source");
  if (configured !== undefined) {
    assertNoSourceCredentials(configured, entry.id);
    if (readString(configured, "source") === "local") {
      if (plugin === undefined) {
        throw new Error(
          `skillset: ChatGPT marketplace entry ${entry.id} requires a materialized local plugin package`
        );
      }
      const expectedPath = localPluginSourcePath(graph, plugin);
      if (readString(configured, "path") !== expectedPath) {
        throw new Error(
          `skillset: ChatGPT marketplace entry ${entry.id} local source must reference the materialized package ${expectedPath}`
        );
      }
      return { source: "local", path: expectedPath };
    }
    return cloneRecord(configured);
  }
  if (entry.repo !== undefined) {
    return stripUndefined({
      source: "url",
      url: entry.repo,
      ref: entry.ref ?? entry.version,
      sha: entry.sha,
    });
  }
  if (plugin === undefined) {
    throw new Error(
      `skillset: ChatGPT marketplace entry ${entry.id} references missing local plugin ${entry.plugin}`
    );
  }
  return { source: "local", path: localPluginSourcePath(graph, plugin) };
}

function localPluginSourcePath(
  graph: BuildGraph,
  plugin: SourcePlugin
): string {
  const path = pluginBundleRoot(
    graph.root.outputs.plugins.codex,
    "codex",
    plugin
  );
  return `./${path.replace(/^\.\//u, "")}`;
}

function validateLocalInterfaceAssets(
  plugin: SourcePlugin,
  entryId: string,
  interfaceValue: JsonRecord
): void {
  for (const field of ["composerIcon", "logo", "logoDark"] as const) {
    const value = readString(interfaceValue, field);
    if (value !== undefined)
      validateLocalInterfaceAsset(plugin, entryId, field, value);
  }
  for (const value of readStringArray(interfaceValue, "screenshots") ?? []) {
    validateLocalInterfaceAsset(plugin, entryId, "screenshots", value);
  }
}

function validateLocalInterfaceAsset(
  plugin: SourcePlugin,
  entryId: string,
  field: string,
  value: string
): void {
  if (!value.startsWith("./") || value === "./") {
    throw new Error(
      `skillset: ChatGPT marketplace entry ${entryId} interface.${field} must be a contained ./ package asset path`
    );
  }
  const sourceRelativePath = value.slice(2);
  try {
    const pluginRoot = realpathSync(plugin.path);
    const sourcePath = resolve(pluginRoot, sourceRelativePath);
    if (!isPathContainedBy(pluginRoot, sourcePath)) {
      throw new Error(
        `skillset: ChatGPT marketplace entry ${entryId} interface.${field} resolves outside the local plugin package`
      );
    }
    const [topLevel] = sourceRelativePath.split("/");
    if (
      topLevel === undefined ||
      !["assets", "scripts", "src"].includes(topLevel)
    ) {
      throw new Error(
        `skillset: ChatGPT marketplace entry ${entryId} interface.${field} is not materialized in the local package`
      );
    }
    if (!statSync(sourcePath).isFile()) {
      throw new Error(
        `skillset: ChatGPT marketplace entry ${entryId} interface.${field} must reference a package file`
      );
    }
    if (!isPathContainedBy(pluginRoot, realpathSync(sourcePath))) {
      throw new Error(
        `skillset: ChatGPT marketplace entry ${entryId} interface.${field} resolves outside the local plugin package`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("skillset:")) {
      throw error;
    }
    throw new Error(
      `skillset: ChatGPT marketplace entry ${entryId} interface.${field} references a missing package asset ${value}`
    );
  }
}

function isPathContainedBy(root: string, candidate: string): boolean {
  const contained = relative(root, candidate);
  return (
    contained !== "" &&
    contained !== ".." &&
    !contained.startsWith(`..${"/"}`) &&
    !contained.startsWith(`..${"\\"}`) &&
    !isAbsolute(contained)
  );
}

function assertNoSourceCredentials(source: JsonRecord, entryId: string): void {
  const candidates = [
    readString(source, "url"),
    readString(source, "registry"),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || !/^https?:\/\//iu.test(candidate)) continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.username === "" && parsed.password === "") continue;
    throw new Error(
      `skillset: ChatGPT marketplace entry ${entryId} source credentials are unsupported; configure Git or npm credentials out of band`
    );
  }
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      nested === undefined ? [] : [[key, cloneJson(nested)] as const]
    )
  );
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isJsonRecord(value)) return cloneRecord(value);
  return value;
}

function stripUndefined(
  value: Readonly<Record<string, JsonValue | undefined>>
): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined
    )
  );
}

function copyStrings(
  value: readonly string[] | undefined
): string[] | undefined {
  return value === undefined ? undefined : [...value];
}
