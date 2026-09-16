import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import {
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
} from "./config";
import { renderClaudePluginDependencies } from "./dependencies";
import type { ResolvedLicense } from "./licenses";
import { validateSlug } from "./path";
import {
  pluginComponentPath,
  pluginComponents,
} from "./plugin-component-paths";
import { hasAdaptivePluginHookOutput } from "./render-hooks";
import { renderAgentPluginManifest } from "./agent-plugin-manifest";
import {
  readAuthorName,
  renderClaudeAuthor,
  renderCodexAuthor,
  renderCursorAuthor,
} from "./source-author";
import { readSourceListing } from "./source-listing";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SourcePlugin,
  SourcePluginFeature,
  SourceSkill,
  TargetName,
} from "./types";
import { pluginVersion } from "./versioning";
import { isJsonRecord } from "./yaml";

export function renderPluginManifest(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  enabledSkills: readonly SourceSkill[],
  license: ResolvedLicense | undefined
): JsonRecord {
  if (target === "codex") {
    return renderChatGptPluginManifest(graph, plugin, license);
  }
  const metadata = plugin.metadata;
  const targetOptions = plugin.targets[target].options;
  const portableManifest = readRecord(metadata, "manifest") ?? {};
  const listing = readSourceListing(metadata);
  const base: JsonRecord = {
    name: readString(portableManifest, "name") ?? plugin.id,
    version: pluginVersion(graph, plugin),
    description:
      readString(listing, "summary") ??
      readString(listing, "description") ??
      readString(metadata, "description") ??
      plugin.id,
    author: projectedPluginManifestAuthor(graph, plugin, target),
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: license?.manifestValue,
    keywords: copyOptionalStrings(
      readStringArray(listing, "keywords") ??
        readStringArray(metadata, "keywords")
    ),
  };
  const dependencies =
    target === "claude"
      ? renderClaudePluginDependencies(graph, plugin)
      : undefined;
  const manifestOverrides = readRecord(targetOptions, "manifest") ?? {};
  if (
    target === "claude" &&
    dependencies !== undefined &&
    manifestOverrides.dependencies !== undefined
  ) {
    throw new Error(
      `skillset: plugin ${plugin.id} declares dependencies, but claude.manifest.dependencies would overwrite generated dependency metadata`
    );
  }

  const targetBase =
    target === "claude"
      ? withOptionalSurfacePaths(
          graph,
          mergeRecords(
            mergeRecords(base, renderClaudePluginDisplayFields(metadata)),
            dependencies === undefined ? {} : { dependencies }
          ),
          plugin,
          enabledSkills,
          target
        )
        : withOptionalSurfacePaths(
            graph,
            mergeRecords(
              base,
              renderCursorPluginDisplayFields(metadata, portableManifest)
            ),
            plugin,
            enabledSkills,
            target
          );
  const withOverrides = mergeRecords(targetBase, manifestOverrides);

  return mergeRecords(withOverrides, {
    version: pluginVersion(graph, plugin),
  });
}

function renderClaudePluginDisplayFields(metadata: JsonRecord): JsonRecord {
  const listing = readSourceListing(metadata);
  return {
    displayName: readString(listing, "display_name"),
  };
}

/** Effective display label after target-native manifest and interface overrides. */
export function pluginManifestDisplayName(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): string | undefined {
  const manifestOverrides =
    readRecord(plugin.targets[target].options, "manifest") ?? {};
  if (target === "codex") {
    return readString(renderEffectiveOpenAiInterface(graph, plugin), "displayName");
  }
  const projected =
    target === "claude"
      ? renderClaudePluginDisplayFields(plugin.metadata)
      : renderCursorPluginDisplayFields(
          plugin.metadata,
          readRecord(plugin.metadata, "manifest") ?? {}
        );
  return readString(
    mergeRecords(projected, manifestOverrides),
    "displayName"
  );
}

function renderCursorPluginDisplayFields(
  metadata: JsonRecord,
  portableManifest: JsonRecord
): JsonRecord {
  const listing = readSourceListing(metadata);
  return {
    displayName:
      readString(portableManifest, "displayName") ??
      readString(listing, "display_name"),
    logo:
      readString(portableManifest, "logo") ??
      readString(listing, "logo"),
  };
}

/**
 * Canonical author projection a rendered plugin manifest starts from.
 *
 * Provider author formats support different key sets, so the canonical author
 * is projected per target before any `<target>.manifest.author` override is
 * merged over it.
 */
function projectedPluginManifestAuthor(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): JsonRecord | undefined {
  const author = plugin.metadata.author;
  const rootAuthor = graph.root.metadata.author;
  if (target === "claude") {
    return renderClaudeAuthor(author) ?? renderClaudeAuthor(rootAuthor);
  }
  if (target === "codex") {
    return renderCodexAuthor(author) ?? renderCodexAuthor(rootAuthor);
  }
  return renderCursorAuthor(author) ?? renderCursorAuthor(rootAuthor);
}

/**
 * Effective `author` a rendered plugin manifest carries.
 *
 * `renderPluginManifest` merges `<target>.manifest` over the rendered manifest,
 * so a `manifest.author` override can replace part or all of the canonical
 * author projection. Callers that need to know which canonical author fields
 * survive must compare this value, not the canonical author.
 */
export function pluginManifestAuthor(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName
): JsonValue | undefined {
  const projected = projectedPluginManifestAuthor(graph, plugin, target);
  const manifestOverrides =
    readRecord(plugin.targets[target].options, "manifest") ?? {};
  const override = manifestOverrides.author;
  if (override === undefined) return projected;
  return projected !== undefined && isJsonRecord(override)
    ? mergeRecords(projected, override)
    : override;
}

/**
 * Effective `interface.category` a rendered Codex plugin manifest carries.
 *
 * `renderPluginManifest` merges `codex.manifest` over the rendered manifest and
 * `renderCodexInterface` merges `codex.interface` over the canonical base, so
 * either override can replace the canonical `listing.category`. Callers that
 * need to know whether the authored category survives must compare this value,
 * not the presence of the destination.
 */
export function codexInterfaceCategory(
  graph: BuildGraph,
  plugin: SourcePlugin
): string | undefined {
  return readString(renderEffectiveOpenAiInterface(graph, plugin), "category");
}

/** The one effective OpenAI interface used for bytes and outcome evidence. */
export function renderEffectiveOpenAiInterface(
  graph: BuildGraph,
  plugin: SourcePlugin,
  validatedLegacyExtension?: JsonRecord
): JsonRecord {
  const manifestOverrides =
    readRecord(plugin.targets.codex.options, "manifest") ?? {};
  const extensions = readRecord(manifestOverrides, "extensions") ?? {};
  const authoredExtension = readRecord(extensions, "com.openai") ?? {};
  const legacyExtension = validatedLegacyExtension ??
    readLegacyOpenAiExtension(graph, plugin);
  const canonical = mergeRecords(
    renderCodexInterface(graph, plugin),
    readRecord(manifestOverrides, "interface") ?? {}
  );
  return mergeRecords(
    mergeRecords(canonical, readRecord(legacyExtension, "interface") ?? {}),
    readRecord(authoredExtension, "interface") ?? {}
  );
}

export function renderCodexInterface(
  graph: BuildGraph,
  plugin: SourcePlugin
): JsonRecord {
  const metadata = plugin.metadata;
  const listing = readSourceListing(metadata);
  const authorName =
    readAuthorName(metadata.author) ??
    readAuthorName(graph.root.metadata.author) ??
    readAuthorName(graph.root.metadata.owner);
  const targetOptions = plugin.targets.codex.options;
  const interfaceOverrides = readRecord(targetOptions, "interface") ?? {};
  const color = readString(targetOptions, "color") ?? readString(listing, "color");
  const website =
    readString(listing, "website_url") ??
    readString(metadata, "homepage") ??
    readString(metadata, "repository");
  const capabilities = readStringArray(listing, "capabilities");
  const defaultPrompt = readStringArray(listing, "default_prompt");
  const screenshots = readStringArray(listing, "screenshots");

  const base = omitUndefined({
    displayName:
      readString(listing, "display_name"),
    shortDescription: firstDefined(
      readString(listing, "summary"),
      readString(listing, "description"),
      readString(metadata, "description"),
      plugin.id
    ),
    longDescription: firstDefined(
      readString(listing, "description"),
      readString(metadata, "description"),
      readString(listing, "summary"),
      plugin.id
    ),
    developerName: authorName,
    category: readString(listing, "category"),
    capabilities: capabilities === undefined ? undefined : [...capabilities],
    websiteUrl: website,
    privacyPolicyUrl: readString(listing, "privacy_policy_url"),
    termsOfServiceUrl: readString(listing, "terms_of_service_url"),
    defaultPrompt: defaultPrompt ? [...defaultPrompt] : undefined,
    brandColor: color,
    composerIcon: readString(listing, "composer_icon"),
    logo: readString(listing, "logo"),
    logoDark: readString(listing, "logo_dark"),
    screenshots: screenshots === undefined ? undefined : [...screenshots],
  });

  return mergeRecords(base, interfaceOverrides);
}

/**
 * Render the modern ChatGPT product bundle from the same Agent Plugins
 * baseline used for the portable package. The OpenAI extension is deliberately
 * a closed provider delta; it cannot redirect portable skills or MCP.
 */
function renderChatGptPluginManifest(
  graph: BuildGraph,
  plugin: SourcePlugin,
  license: ResolvedLicense | undefined
): JsonRecord {
  const targetOptions = plugin.targets.codex.options;
  const manifestOverrides = readRecord(targetOptions, "manifest") ?? {};
  const extensionOverrides = readRecord(manifestOverrides, "extensions") ?? {};
  for (const key of Object.keys(manifestOverrides)) {
    if (key !== "extensions" && key !== "interface") {
      throw new Error(
        `skillset: plugin ${plugin.id} codex.manifest.${key} cannot override the portable ChatGPT root manifest`
      );
    }
  }
  for (const key of Object.keys(extensionOverrides)) {
    if (key !== "com.openai") {
      throw new Error(
        `skillset: plugin ${plugin.id} codex.manifest.extensions.${key} is not a supported ChatGPT extension`
      );
    }
  }
  const authoredExtension = readRecord(extensionOverrides, "com.openai") ?? {};
  const canonicalManifest = renderAgentPluginManifest(graph, plugin, license);
  const legacyExtension = readLegacyOpenAiExtension(
    graph,
    plugin,
    canonicalManifest
  );
  const hasApp = plugin.features.some((feature) => feature.key === "app");
  const hasHooks =
    pluginHasPath(plugin, "hooks/hooks.json") ||
    hasAdaptivePluginHookOutput(graph, plugin, "codex");
  const extension = mergeRecords(
    mergeRecords(
      {
        ...(hasApp ? { apps: pluginComponentPath("codex", "apps") } : {}),
        ...(hasHooks
          ? { hooks: pluginComponentPath("codex", "hooks") }
          : {}),
      },
      mergeRecords(legacyExtension, authoredExtension)
    ),
    { interface: renderEffectiveOpenAiInterface(graph, plugin, legacyExtension) }
  );
  validateOpenAiExtension(plugin, extension);
  if (extension.apps !== undefined && !hasApp) {
    throw new Error(
      `skillset: plugin ${plugin.id} extensions.com.openai.apps requires an authored .app.json component`
    );
  }
  if (extension.hooks !== undefined && !hasHooks) {
    throw new Error(
      `skillset: plugin ${plugin.id} extensions.com.openai.hooks requires an authored or adaptive hooks component`
    );
  }
  return mergeRecords(canonicalManifest, {
    extensions: { "com.openai": extension },
  });
}

/**
 * A legacy native manifest is an import boundary, never an output overlay.
 * Preserve only the reviewed OpenAI meaning that has an exact modern home;
 * anything that could redirect a fixed portable component fails before write.
 */
function readLegacyOpenAiExtension(
  graph: BuildGraph,
  plugin: SourcePlugin,
  canonical?: JsonRecord
): JsonRecord {
  const path = join(plugin.path, ".codex-plugin", "plugin.json");
  if (!pluginHasPath(plugin, ".codex-plugin/plugin.json")) return {};
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as JsonValue;
  } catch {
    throw new Error(`skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json must contain JSON`);
  }
  if (!isJsonRecord(parsed)) {
    throw new Error(`skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json must be an object`);
  }
  const allowed = new Set([
    "name", "description", "version", "author", "homepage", "repository",
    "license", "keywords", "interface", "apps", "hooks", "skills",
  ]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new Error(
        `skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.${key} cannot be preserved in the modern ChatGPT bundle`
      );
    }
  }
  const expectedName = plugin.id;
  if (parsed.name !== undefined && parsed.name !== expectedName) {
    throw new Error(
      `skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.name conflicts with the canonical plugin id`
    );
  }
  const expectedDescription = canonical === undefined
    ? undefined
    : readString(canonical, "description");
  if (
    canonical !== undefined &&
    parsed.description !== undefined &&
    parsed.description !== expectedDescription
  ) {
    throw new Error(
      `skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.description cannot be preserved without changing portable metadata`
    );
  }
  for (const key of [
    "author",
    "homepage",
    "keywords",
    "license",
    "repository",
    "version",
  ] as const) {
    if (canonical === undefined) break;
    if (parsed[key] === undefined) continue;
    if (!sameJsonValue(parsed[key], canonical[key])) {
      throw new Error(
        `skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.${key} conflicts with canonical portable metadata`
      );
    }
  }
  for (const key of ["apps", "hooks", "skills"] as const) {
    const value = parsed[key];
    if (value === undefined) continue;
    const expected =
      key === "apps"
        ? pluginComponentPath("codex", "apps")
        : key === "hooks"
          ? pluginComponentPath("codex", "hooks")
          : pluginComponentPath("codex", "skills");
    if (value !== expected) {
      throw new Error(
        `skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.${key} must use the fixed ${expected} component path`
      );
    }
  }
  const interfaceValue = parsed.interface;
  if (interfaceValue !== undefined && !isJsonRecord(interfaceValue)) {
    throw new Error(`skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.interface must be an object`);
  }
  return omitUndefined({
    apps: parsed.apps,
    hooks: parsed.hooks,
    interface:
      interfaceValue === undefined
        ? undefined
        : canonicalizeLegacyOpenAiInterface(plugin, interfaceValue),
  });
}

function canonicalizeLegacyOpenAiInterface(
  plugin: SourcePlugin,
  value: JsonRecord
): JsonRecord {
  const aliases = {
    privacyPolicyURL: "privacyPolicyUrl",
    termsOfServiceURL: "termsOfServiceUrl",
    websiteURL: "websiteUrl",
  } as const;
  const normalized = { ...value };
  for (const [legacyKey, canonicalKey] of Object.entries(aliases)) {
    const legacy = normalized[legacyKey];
    if (legacy === undefined) continue;
    const canonical = normalized[canonicalKey];
    if (canonical !== undefined && !sameJsonValue(canonical, legacy)) {
      throw new Error(
        `skillset: plugin ${plugin.id} legacy .codex-plugin/plugin.json.interface.${legacyKey} conflicts with ${canonicalKey}`
      );
    }
    normalized[canonicalKey] = legacy;
    delete normalized[legacyKey];
  }
  return normalized;
}

function validateOpenAiExtension(plugin: SourcePlugin, value: JsonRecord): void {
  const pluginId = plugin.id;
  const allowed = new Set(["interface", "apps", "hooks"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`skillset: plugin ${pluginId} extensions.com.openai.${key} is unsupported; portable skills and MCP have fixed component paths`);
    }
  }
  const interfaceValue = value.interface;
  if (!isJsonRecord(interfaceValue)) {
    throw new Error(`skillset: plugin ${pluginId} extensions.com.openai.interface must be an object`);
  }
  const interfaceKeys = new Set([
    "displayName", "shortDescription", "longDescription", "developerName",
    "category", "capabilities", "websiteUrl", "privacyPolicyUrl",
    "termsOfServiceUrl", "defaultPrompt", "brandColor", "composerIcon",
    "logo", "logoDark", "screenshots",
  ]);
  for (const [key, field] of Object.entries(interfaceValue)) {
    if (!interfaceKeys.has(key)) {
      throw new Error(`skillset: plugin ${pluginId} extensions.com.openai.interface.${key} is unknown`);
    }
    if ((key === "capabilities" || key === "defaultPrompt" || key === "screenshots")) {
      if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || item.trim() === "")) {
        throw new Error(`skillset: plugin ${pluginId} extensions.com.openai.interface.${key} must be a non-empty string array`);
      }
      const strings = field as readonly string[];
      if (key === "defaultPrompt" && (strings.length > 3 || strings.some((item) => item.length > 128))) {
        throw new Error(`skillset: plugin ${pluginId} extensions.com.openai.interface.defaultPrompt permits at most three 128-character prompts`);
      }
    } else if (typeof field !== "string" || field.trim() === "") {
      throw new Error(`skillset: plugin ${pluginId} extensions.com.openai.interface.${key} must be a non-empty string`);
    }
  }
  for (const key of ["composerIcon", "logo", "logoDark"] as const) {
    const field = interfaceValue[key];
    if (field !== undefined) validateOpenAiAssetPath(plugin, key, field);
  }
  const screenshots = interfaceValue.screenshots;
  if (Array.isArray(screenshots)) {
    for (const screenshot of screenshots) {
      validateOpenAiAssetPath(plugin, "screenshots", screenshot);
    }
  }
  for (const key of ["apps", "hooks"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    const expected = pluginComponentPath(
      "codex",
      key === "apps" ? "apps" : "hooks"
    );
    if (field !== expected) {
      throw new Error(
        `skillset: plugin ${pluginId} extensions.com.openai.${key} must use the fixed ${expected} component path`
      );
    }
  }
}

function validateOpenAiAssetPath(
  plugin: SourcePlugin,
  field: string,
  value: JsonValue
): void {
  if (typeof value !== "string" || !value.startsWith("./") || value === "./") {
    throw new Error(`skillset: plugin ${plugin.id} extensions.com.openai.interface.${field} must be a contained ./ asset path`);
  }
  try {
    const pluginRoot = realpathSync(plugin.path);
    const sourcePath = resolve(pluginRoot, value);
    if (!isPathContainedBy(pluginRoot, sourcePath)) {
      throw new Error(`skillset: plugin ${plugin.id} extensions.com.openai.interface.${field} resolves outside the plugin root`);
    }
    if (!statSync(sourcePath).isFile()) {
      throw new Error(`skillset: plugin ${plugin.id} extensions.com.openai.interface.${field} must reference a file`);
    }
    const assetPath = realpathSync(sourcePath);
    if (!isPathContainedBy(pluginRoot, assetPath)) {
      throw new Error(`skillset: plugin ${plugin.id} extensions.com.openai.interface.${field} resolves outside the plugin root`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("skillset:")) throw error;
    throw new Error(`skillset: plugin ${plugin.id} extensions.com.openai.interface.${field} references a missing asset ${value}`);
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

function copyOptionalStrings(
  value: readonly string[] | undefined
): string[] | undefined {
  return value === undefined ? undefined : [...value];
}

function omitUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined)
  );
}

function firstDefined<T>(...values: readonly (T | undefined)[]): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function sameJsonValue(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (isJsonRecord(left) && isJsonRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]));
  }
  return false;
}

export function withOptionalSurfacePaths(
  graph: BuildGraph,
  manifest: JsonRecord,
  plugin: SourcePlugin,
  enabledSkills: readonly SourceSkill[],
  target: TargetName
): JsonRecord {
  const withPaths: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (value !== undefined) withPaths[key] = value;
  }

  for (const component of pluginComponents(target)) {
    const manifestField = component.manifestField;
    if (manifestField === undefined) continue;
    const value = pluginComponentManifestValue(
      graph,
      plugin,
      enabledSkills,
      target,
      component.kind,
      component.path
    );
    if (value !== undefined) {
      setManifestField(withPaths, manifestField, value);
    }
  }

  return withPaths;
}

function pluginComponentManifestValue(
  graph: BuildGraph,
  plugin: SourcePlugin,
  enabledSkills: readonly SourceSkill[],
  target: TargetName,
  kind: string,
  path: string
): JsonValue | undefined {
  if (kind === "skills") {
    if (enabledSkills.length === 0) return undefined;
    if (target !== "claude") return path;
    const nestedSkillPaths = [
      ...new Set(
        enabledSkills
          .map((skill) => relativeSkillDirectory(skill.relativePath, path))
          .filter((skillPath) => skillPath.includes("/"))
          .map((skillPath) => `${path}${skillPath}`)
      ),
    ].sort();
    return nestedSkillPaths.length === 0 ? path : nestedSkillPaths;
  }
  if (kind === "hooks") {
    const sourcePath = componentSourcePath(path);
    const hasHooks =
      target === "cursor"
        ? pluginHasSurfacePath(graph, plugin, target, sourcePath)
        : pluginHasPath(plugin, sourcePath);
    return hasHooks || hasAdaptivePluginHookOutput(graph, plugin, target)
      ? path
      : undefined;
  }
  if (kind === "mcp") return pluginHasFeature(plugin, "mcp") ? path : undefined;
  if (kind === "apps") return pluginHasFeature(plugin, "app") ? path : undefined;

  const sourcePath = componentSourcePath(path);
  const hasPath =
    target === "cursor"
      ? pluginHasSurfacePath(graph, plugin, target, sourcePath)
      : pluginHasPath(plugin, sourcePath);
  return hasPath ? path : undefined;
}

function componentSourcePath(path: string): string {
  const withoutPrefix = path.startsWith("./") ? path.slice(2) : path;
  return withoutPrefix.endsWith("/") ? withoutPrefix.slice(0, -1) : withoutPrefix;
}

function relativeSkillDirectory(
  relativePath: string,
  manifestRoot: string
): string {
  const normalized = relativePath.replaceAll("\\", "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return ".";
  const directory = normalized.slice(0, lastSlash);
  const sourceRoot = componentSourcePath(manifestRoot);
  return directory.startsWith(`${sourceRoot}/`)
    ? directory.slice(sourceRoot.length + 1)
    : directory;
}

function setManifestField(
  manifest: Record<string, JsonValue>,
  field: string,
  value: JsonValue
): void {
  const [head, ...tail] = field.split(".");
  if (head === undefined) return;
  if (tail.length === 0) {
    manifest[head] = value;
    return;
  }
  const nested: Record<string, JsonValue> = {};
  const current = manifest[head];
  if (isJsonRecord(current)) {
    for (const [key, nestedValue] of Object.entries(current)) {
      if (nestedValue !== undefined) nested[key] = nestedValue;
    }
  }
  setManifestField(nested, tail.join("."), value);
  manifest[head] = nested;
}

function pluginHasFeature(
  plugin: SourcePlugin,
  key: SourcePluginFeature["key"]
): boolean {
  return plugin.features.some((feature) => feature.key === key);
}

/**
 * Render Codex and Cursor plugin hook files at the documented default path
 * `hooks/hooks.json` with a top-level `hooks` object.
 *
 * Source resolution: `hooks/hooks.json` is the canonical hook source for both
 * plugin targets. Flat event maps are normalized into the canonical
 * `{ "hooks": { ... } }` shape.
 */
function pluginHasPath(plugin: SourcePlugin, path: string): boolean {
  try {
    validateSlug(plugin.id, "plugin id");
  } catch {
    return false;
  }
  // Real file-system errors (EACCES, ELOOP, ...) must surface instead of being
  // read as "path absent"; only a missing path counts as no surface.
  return hasRenderableContent(join(plugin.path, path));
}

function pluginHasSurfacePath(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  path: string
): boolean {
  return pluginHasPath(plugin, path) || pluginHasTargetNativePath(graph, plugin, target, path);
}

function pluginHasTargetNativePath(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  path: string
): boolean {
  return graph.projectIslands.some(
    (island) =>
      island.plugin === plugin.id &&
      island.target === target &&
      (island.relativePath === path || island.relativePath.startsWith(`${path}/`))
  );
}

function hasRenderableContent(path: string): boolean {
  // A missing path means "no surface"; any other FS error (EACCES, ELOOP, ...)
  // must surface instead of being read as absent.
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
  if (stats.isFile()) return !isIgnoredCompanionFile(path);
  if (!stats.isDirectory()) return false;

  for (const entry of readdirSync(path)) {
    if (hasRenderableContent(join(path, entry))) return true;
  }

  return false;
}

function isIgnoredCompanionFile(path: string): boolean {
  const name = basename(path);
  return name === ".DS_Store" || name === ".gitkeep";
}
