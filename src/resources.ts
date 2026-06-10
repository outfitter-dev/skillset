import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

import { compareStrings, resolveInside } from './path';
import type { JsonRecord, JsonValue, SourceResource } from './types';
import { isJsonRecord } from './yaml';

const RESOURCE_GROUPS = new Set([
  'assets',
  'references',
  'scripts',
  'templates',
]);

export interface ResourceContext {
  readonly label: string;
  readonly pluginSharedPath?: string;
  readonly sharedPath: string;
}

export async function readSkillResources(
  raw: JsonValue | undefined,
  context: ResourceContext
): Promise<readonly SourceResource[]> {
  if (raw === undefined) {
    return [];
  }

  const pending = readResourceEntries(raw, context.label);
  const resources: SourceResource[] = [];
  const targetPaths = new Set<string>();

  for (const entry of pending) {
    const resource = await resolveResource(entry, context);
    if (targetPaths.has(resource.targetPath)) {
      throw new Error(
        `skillset: ${context.label}.resources maps multiple resources to ${resource.targetPath}`
      );
    }
    targetPaths.add(resource.targetPath);
    resources.push(resource);
  }

  return resources.toSorted((left, right) =>
    compareStrings(left.targetPath, right.targetPath)
  );
}

interface PendingResource {
  readonly from: string;
  readonly group?: string;
  readonly to?: string;
}

function readResourceEntries(
  raw: JsonValue,
  label: string
): readonly PendingResource[] {
  if (typeof raw === 'string' || Array.isArray(raw)) {
    return readResourceEntryList(raw, label);
  }
  if (!isJsonRecord(raw)) {
    throw new Error(
      `skillset: expected ${label}.resources to be a string, array, or object`
    );
  }

  if (raw.from !== undefined) {
    return [readResourceEntry(raw, undefined, label)];
  }

  const entries: PendingResource[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!RESOURCE_GROUPS.has(key)) {
      throw new Error(
        `skillset: unsupported resource group ${key} in ${label}.resources`
      );
    }
    entries.push(
      ...readResourceEntryList(value, `${label}.resources.${key}`, key)
    );
  }
  return entries;
}

function readResourceEntryList(
  raw: JsonValue | undefined,
  label: string,
  group?: string
): readonly PendingResource[] {
  if (raw === undefined) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => readResourceEntry(entry, group, label));
  }
  return [readResourceEntry(raw, group, label)];
}

function readResourceEntry(
  raw: JsonValue,
  group: string | undefined,
  label: string
): PendingResource {
  if (typeof raw === 'string') {
    return { from: raw, ...(group === undefined ? {} : { group }) };
  }
  if (!isJsonRecord(raw)) {
    throw new Error(
      `skillset: expected ${label} resource entries to be strings or objects`
    );
  }

  const keys = new Set(Object.keys(raw));
  keys.delete('from');
  keys.delete('to');
  if (keys.size > 0) {
    throw new Error(
      `skillset: unsupported resource entry key ${[...keys][0]} in ${label}`
    );
  }

  const from = readNonEmptyString(raw, 'from', label);
  const to =
    raw.to === undefined ? undefined : readNonEmptyString(raw, 'to', label);
  return {
    from,
    ...(group === undefined ? {} : { group }),
    ...(to === undefined ? {} : { to }),
  };
}

function readNonEmptyString(
  raw: JsonRecord,
  key: string,
  label: string
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `skillset: expected ${label}.${key} to be a non-empty string`
    );
  }
  return value.trim();
}

async function resolveResource(
  entry: PendingResource,
  context: ResourceContext
): Promise<SourceResource> {
  const parsed = parseResourcePath(entry.from, context);
  const targetPath = validateResourceTargetPath(
    entry.to ?? defaultTargetPath(parsed.relativePath, entry.group),
    context.label
  );
  const sourcePath = resolveInside(parsed.root, parsed.relativePath);
  const sourceStats = await statSource(sourcePath);

  if (sourceStats === undefined) {
    throw new Error(
      `skillset: ${context.label}.resources source not found: ${entry.from}`
    );
  }
  if (!sourceStats.isFile() && !sourceStats.isDirectory()) {
    throw new Error(
      `skillset: ${context.label}.resources source must be a file or directory: ${entry.from}`
    );
  }

  return {
    from: parsed.from,
    kind: sourceStats.isDirectory() ? 'directory' : 'file',
    sourcePath,
    targetPath,
  };
}

interface ParsedResourcePath {
  readonly from: string;
  readonly relativePath: string;
  readonly root: string;
}

function parseResourcePath(
  raw: string,
  context: ResourceContext
): ParsedResourcePath {
  const value = raw.trim();
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    throw new Error(
      `skillset: ${context.label}.resources must use shared: or plugin: resource paths`
    );
  }

  const scheme = value.slice(0, separatorIndex);
  const relativePath = validateResourceSourcePath(
    value.slice(separatorIndex + 1),
    context.label
  );
  if (scheme === 'shared') {
    return {
      from: `shared:${relativePath}`,
      relativePath,
      root: context.sharedPath,
    };
  }
  if (scheme === 'plugin') {
    if (context.pluginSharedPath === undefined) {
      throw new Error(
        `skillset: ${context.label}.resources uses plugin: outside a plugin skill`
      );
    }
    return {
      from: `plugin:${relativePath}`,
      relativePath,
      root: context.pluginSharedPath,
    };
  }

  throw new Error(
    `skillset: ${context.label}.resources must use shared: or plugin: resource paths`
  );
}

function validateResourceSourcePath(raw: string, label: string): string {
  const value = normalizeResourcePath(raw);
  if (value.length === 0) {
    throw new Error(`skillset: ${label}.resources has an empty source path`);
  }
  if (isUnsafeRelativePath(value)) {
    throw new Error(
      `skillset: ${label}.resources source paths must stay inside shared roots`
    );
  }
  return value;
}

function validateResourceTargetPath(raw: string, label: string): string {
  const value = normalizeResourcePath(raw);
  if (value.length === 0) {
    throw new Error(`skillset: ${label}.resources has an empty target path`);
  }
  if (isUnsafeRelativePath(value)) {
    throw new Error(
      `skillset: ${label}.resources target paths must stay inside the generated skill`
    );
  }
  if (
    value === 'SKILL.md' ||
    value === 'agents/openai.yaml' ||
    value === '.skillset.tools.yaml'
  ) {
    throw new Error(
      `skillset: ${label}.resources cannot write generated skill control file ${value}`
    );
  }
  return value;
}

function defaultTargetPath(
  sourcePath: string,
  group: string | undefined
): string {
  if (group === undefined) {
    return sourcePath;
  }
  if (sourcePath === group || sourcePath.startsWith(`${group}/`)) {
    return sourcePath;
  }
  return `${group}/${sourcePath}`;
}

function normalizeResourcePath(raw: string): string {
  return raw
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replaceAll(/\/+/g, '/')
    .replace(/\/$/, '');
}

function isUnsafeRelativePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

async function statSource(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

interface ResourceLinkMapping {
  readonly from: string;
  readonly kind: SourceResource['kind'];
  readonly sourcePath: string;
  readonly targetPath: string;
}

export function rewriteResourceLinks(
  body: string,
  resources: readonly SourceResource[],
  label: string
): string {
  const replacements = new Map(
    resources.map((resource) => [resource.from, resource.targetPath])
  );
  // Bare (schemeless) links to a resource's *source* path break when a custom
  // `to` emits that resource elsewhere; index those remapped source paths so the
  // build can reject the ambiguous link instead of leaving it silently broken.
  const resourceMappings: ResourceLinkMapping[] = [];
  for (const resource of resources) {
    const sourceRelativePath = resourceSourceRelativePath(resource.from);
    if (sourceRelativePath !== undefined) {
      resourceMappings.push({
        from: resource.from,
        kind: resource.kind,
        sourcePath: sourceRelativePath,
        targetPath: resource.targetPath,
      });
    }
  }

  return body.replaceAll(
    /(!?\[[^\]\n]*\]\()([^) \t\n]+)(\))/g,
    (match, open, target, close) => {
      const rewritten = rewriteResourceTarget(
        String(target),
        replacements,
        resourceMappings,
        label
      );
      return rewritten === undefined
        ? String(match)
        : `${open}${rewritten}${close}`;
    }
  );
}

function rewriteResourceTarget(
  target: string,
  replacements: ReadonlyMap<string, string>,
  resourceMappings: readonly ResourceLinkMapping[],
  label: string
): string | undefined {
  const hashIndex = target.indexOf('#');
  const base = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const suffix = hashIndex === -1 ? '' : target.slice(hashIndex);
  const normalizedBase = canonicalResourceReference(base);
  const replacement =
    replacements.get(normalizedBase) ??
    rewriteDeclaredResourceChild(normalizedBase, resourceMappings);
  if (replacement === undefined && isResourceReference(normalizedBase)) {
    throw new Error(
      `skillset: ${label} links to undeclared shared resource ${base}; declare it, e.g. ${suggestResourceEntry(normalizedBase)}`
    );
  }
  if (replacement === undefined && !isResourceReference(normalizedBase)) {
    const remapped = remappedBareResourceLink(
      normalizeResourcePath(base),
      resourceMappings
    );
    if (remapped !== undefined) {
      throw new Error(
        `skillset: ${label} links to ${base}, but a declared resource remaps ${remapped.from} ` +
          `to ${remapped.targetPath}; link to ${remapped.rewrittenPath} or use the ${remapped.resourceUrl} resource URL`
      );
    }
  }
  return replacement === undefined ? undefined : `${replacement}${suffix}`;
}

function rewriteDeclaredResourceChild(
  normalizedBase: string,
  resourceMappings: readonly ResourceLinkMapping[]
): string | undefined {
  const parsed = splitResourceReference(normalizedBase);
  if (parsed === undefined) {
    return undefined;
  }

  const mapping = resourceMappings.find(
    (resource) =>
      resource.kind === 'directory' &&
      parsed.path.startsWith(`${resource.sourcePath}/`) &&
      normalizedBase.startsWith(resource.from)
  );
  if (mapping === undefined) {
    return undefined;
  }

  return joinResourcePath(
    mapping.targetPath,
    parsed.path.slice(mapping.sourcePath.length + 1)
  );
}

interface RemappedBareLink {
  readonly from: string;
  readonly resourceUrl: string;
  readonly rewrittenPath: string;
  readonly targetPath: string;
}

function remappedBareResourceLink(
  normalizedBase: string,
  resourceMappings: readonly ResourceLinkMapping[]
): RemappedBareLink | undefined {
  for (const resource of resourceMappings) {
    if (resource.sourcePath === resource.targetPath) {
      continue;
    }
    if (normalizedBase === resource.sourcePath) {
      return {
        from: resource.from,
        resourceUrl: resource.from,
        rewrittenPath: resource.targetPath,
        targetPath: resource.targetPath,
      };
    }
    if (
      resource.kind !== 'directory' ||
      !normalizedBase.startsWith(`${resource.sourcePath}/`)
    ) {
      continue;
    }

    const childPath = normalizedBase.slice(resource.sourcePath.length + 1);
    return {
      from: resource.from,
      resourceUrl: `${resource.from}/${childPath}`,
      rewrittenPath: joinResourcePath(resource.targetPath, childPath),
      targetPath: resource.targetPath,
    };
  }
  return undefined;
}

function splitResourceReference(
  value: string
): { readonly path: string; readonly scheme: string } | undefined {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    return undefined;
  }
  return {
    path: normalizeResourcePath(value.slice(separatorIndex + 1)),
    scheme: value.slice(0, separatorIndex),
  };
}

function joinResourcePath(base: string, child: string): string {
  return normalizeResourcePath(`${base}/${child}`);
}

function resourceSourceRelativePath(from: string): string | undefined {
  const separatorIndex = from.indexOf(':');
  if (separatorIndex <= 0) {
    return undefined;
  }
  return normalizeResourcePath(from.slice(separatorIndex + 1));
}

const RESOURCE_LINK_PATTERN = /(?:!?\[[^\]\n]*\]\()([^) \t\n]+)(?:\))/g;

export interface UndeclaredResourceLink {
  readonly reference: string;
  readonly suggestion: string;
}

/**
 * Find skill-body markdown links to `shared:`/`plugin:` resources that are not
 * declared (and not children of a declared directory resource). Each result
 * carries a suggested `resources` entry so the diagnostic is actionable. This
 * mirrors the build's hard rejection but runs at lint time and reports all
 * offenders with fixes instead of failing on the first.
 */
export function findUndeclaredResourceLinks(
  body: string,
  resources: readonly SourceResource[]
): readonly UndeclaredResourceLink[] {
  const declared = new Set(resources.map((resource) => resource.from));
  const directoryResources = resources
    .filter((resource) => resource.kind === 'directory')
    .map((resource) => ({
      from: resource.from,
      source: resourceSourceRelativePath(resource.from),
    }));
  const found = new Map<string, string>();

  for (const match of body.matchAll(RESOURCE_LINK_PATTERN)) {
    const rawTarget = match[1];
    if (rawTarget === undefined) {
      continue;
    }
    const hashIndex = rawTarget.indexOf('#');
    const base = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
    const canonical = canonicalResourceReference(base);
    if (!isResourceReference(canonical) || declared.has(canonical)) {
      continue;
    }

    const parsed = splitResourceReference(canonical);
    const isDeclaredChild =
      parsed !== undefined &&
      directoryResources.some(
        (resource) =>
          resource.source !== undefined &&
          canonical.startsWith(resource.from) &&
          parsed.path.startsWith(`${resource.source}/`)
      );
    if (isDeclaredChild) {
      continue;
    }

    if (!found.has(canonical)) {
      found.set(canonical, suggestResourceEntry(canonical));
    }
  }

  return [...found].map(([reference, suggestion]) => ({
    reference,
    suggestion,
  }));
}

const SCRIPT_EXTENSION_PATTERN = /\.(sh|bash|zsh|py|rb|pl|js|ts|mjs)$/i;
const PLUGIN_ROOT_PATTERN = /\$\{?(?:CLAUDE_)?PLUGIN_ROOT\}?/;

/**
 * Find skill-body markdown links that depend on a plugin-root script path — a
 * `${CLAUDE_PLUGIN_ROOT}`/`${PLUGIN_ROOT}` reference, or a `../` link escaping
 * the skill directory to a script. Skills should copy scripts skill-local via
 * `resources.scripts` and reference `./scripts/<name>` instead.
 *
 * Scope is intentionally link targets only, not all body prose: a markdown link
 * to a plugin-root script is a real dependency, whereas a prose/code-span mention
 * of `${CLAUDE_PLUGIN_ROOT}` is often documentation (e.g. a skill that teaches
 * hook authoring). Scanning all prose would false-positive on those.
 */
export function findPluginRootScriptLinks(body: string): readonly string[] {
  const offenders = new Set<string>();
  for (const match of body.matchAll(RESOURCE_LINK_PATTERN)) {
    const rawTarget = match[1];
    if (rawTarget === undefined) {
      continue;
    }
    const base = (rawTarget.split('#')[0] ?? rawTarget).trim();
    const usesPluginRoot = PLUGIN_ROOT_PATTERN.test(base);
    const escapesToScript =
      base.startsWith('../') && SCRIPT_EXTENSION_PATTERN.test(base);
    if (usesPluginRoot || escapesToScript) {
      offenders.add(base);
    }
  }
  return [...offenders];
}

/**
 * Suggest a `resources` entry for a `shared:`/`plugin:` reference, grouping by
 * the referenced file's extension so the fix lands at the conventional path.
 */
function suggestResourceEntry(reference: string): string {
  const parsed = splitResourceReference(reference);
  const group =
    parsed === undefined ? 'references' : resourceGroupForPath(parsed.path);
  return `resources: { ${group}: [${reference}] }`;
}

function resourceGroupForPath(path: string): string {
  const lower = path.toLowerCase();
  if (/\.(sh|bash|zsh|py|rb|pl|js|ts|mjs)$/.test(lower)) {
    return 'scripts';
  }
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|pdf)$/.test(lower)) {
    return 'assets';
  }
  if (lower.endsWith('.md')) {
    return 'references';
  }
  return 'templates';
}

/**
 * True when a generated target path is a runnable script — i.e. lands under the
 * skill-local `scripts/` directory — and therefore should carry an executable
 * bit at source.
 */
export function isScriptTargetPath(targetPath: string): boolean {
  return targetPath === 'scripts' || targetPath.startsWith('scripts/');
}

function canonicalResourceReference(value: string): string {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    return value;
  }
  const scheme = value.slice(0, separatorIndex);
  const resourcePath = normalizeResourcePath(value.slice(separatorIndex + 1));
  if (scheme === 'shared' || scheme === 'plugin') {
    return `${scheme}:${resourcePath}`;
  }
  return value;
}

function isResourceReference(value: string): boolean {
  return value.startsWith('shared:') || value.startsWith('plugin:');
}
