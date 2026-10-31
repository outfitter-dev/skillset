import { checkClaudeInlineHooks } from "./claude-inline-hooks-conformance";
import { checkClaudeHookReferences } from "./claude-hook-reference-conformance";
import { checkClaudeExperimental } from "./claude-experimental-conformance";
import { checkClaudeMonitors } from "./claude-monitor-conformance";
import { checkClaudeLspServers } from "./claude-lsp-conformance";
import { checkClaudeComponentReferences } from "./claude-component-reference-conformance";
import { checkClaudeDependencies } from "./claude-dependency-conformance";
import { checkClaudeMcpServers } from "./claude-mcp-conformance";
import { checkClaudeChannels, checkClaudeUserConfig } from "./claude-user-config-conformance";
import { checkClaudeCommandMap } from "./claude-command-map-conformance";
import { checkClaudeMarketplaceEntryHeaders } from "./claude-marketplace-entry-fields";
import { CLAUDE_MARKETPLACE_UNTYPED_FIELDS, CLAUDE_MARKETPLACE_HEADER_FIELD_TYPES, CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS, CLAUDE_MARKETPLACE_SOURCE_FIELD_TYPES } from "@skillset/registry";
import { CLAUDE_PLUGIN_FIELD_TYPES } from "./manifest-field-contracts";
import {
  checkFieldTypes,
  checkRequiredFields,
  checkUnknownFields,
  issue,
  jsonSchemaSummary,
  parseJsonRecord,
  type ProviderFormatConformanceFile,
  type ProviderFormatConformanceIssue,
  type ProviderFormatConformanceIssueCode,
} from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";
import { isTargetMarketplacePath } from "./plugin-output";

export function checkClaudeMarketplace(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "claude", "claude-marketplace-schema");
  if (!parsed.ok) return parsed.issues;

  const issues: ProviderFormatConformanceIssue[] = [];
  const schema = jsonSchemaSummary("claude-marketplace-schema");
  issues.push(
    ...checkRequiredFields(
      file,
      parsed.value,
      "claude",
      "claude-marketplace-schema",
      schema.required ?? []
    ),
    ...checkFieldTypes(
      file,
      parsed.value,
      "claude",
      "claude-marketplace-schema",
      {
        $schema: "string",
        allowCrossMarketplaceDependenciesOn: "string-array",
        description: "string",
        forceRemoveDeletedPlugins: "boolean",
        metadata: "object",
        name: "string",
        owner: "object",
        plugins: "array",
        renames: "object",
        version: "string",
      }
    ),
    ...checkUnknownFields(
      file,
      parsed.value,
      "claude",
      "claude-marketplace-schema",
      [...(schema.properties ?? []), "renames"]
    )
  );
  if (isJsonRecord(parsed.value.owner)) {
    issues.push(
      ...checkClaudeAuthorObject(
        file,
        parsed.value.owner,
        "claude-marketplace-schema",
        "owner"
      )
    );
  }
  if (parsed.value.name === "") {
    issues.push(
      issue(
        file,
        "claude",
        "claude-marketplace-schema",
        "invalid-shape",
        "destination field name must not be empty"
      )
    );
  }
  if (isJsonRecord(parsed.value.renames)) {
    for (const [formerName, currentName] of Object.entries(parsed.value.renames)) {
      if (currentName === null || typeof currentName === "string") continue;
      issues.push(
        issue(
          file,
          "claude",
          "claude-marketplace-schema",
          "invalid-field-type",
          `destination field renames.${formerName} must be a string or null`
        )
      );
    }
  }
  if (isJsonRecord(parsed.value.metadata)) {
    issues.push(
      ...checkFieldTypes(
        file,
        parsed.value.metadata,
        "claude",
        "claude-marketplace-schema",
        {
          description: "string",
          pluginRoot: "string",
          version: "string",
        },
        "metadata"
      ),
      ...checkUnknownFields(
        file,
        parsed.value.metadata,
        "claude",
        "claude-marketplace-schema",
        ["description", "pluginRoot", "version"],
        "metadata"
      )
    );
  }
  if (Array.isArray(parsed.value.plugins)) {
    const nameIndexes = new Map<string, number>();
    for (const [index, plugin] of parsed.value.plugins.entries()) {
      const prefix = `plugins[${index}]`;
      if (!isJsonRecord(plugin)) {
        issues.push(
          issue(
            file,
            "claude",
            "claude-marketplace-schema",
            "invalid-shape",
            `destination field ${prefix} must be an object`
          )
        );
        continue;
      }
      if (typeof plugin.name === "string") {
        const firstIndex = nameIndexes.get(plugin.name);
        if (firstIndex === undefined) nameIndexes.set(plugin.name, index);
        else issues.push(issue(
          file, "claude", "claude-marketplace-schema", "invalid-shape",
          `destination field ${prefix}.name duplicates plugins[${firstIndex}].name: ${plugin.name}`
        ));
      }
      const pluginIssues = checkClaudeMarketplacePlugin(file, plugin, prefix);
      issues.push(...pluginIssues, ...checkClaudeMarketplaceEntryHeaders(file, plugin, prefix, pluginIssues.length === 0));
      if (isJsonRecord(plugin.author)) {
        issues.push(
          ...checkClaudeAuthorObject(
            file,
            plugin.author,
            "claude-marketplace-schema",
            `${prefix}.author`
          )
        );
      }
    }
  }
  return issues;
}

function checkClaudeMarketplacePlugin(
  file: ProviderFormatConformanceFile,
  plugin: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const report = (code: Exclude<ProviderFormatConformanceIssueCode, "unclassified-skill">, message: string): void => {
    issues.push(
      issue(file, "claude", "claude-marketplace-schema", code, message)
    );
  };
  issues.push(
    ...checkFieldTypes(
      file,
      plugin,
      "claude",
      "claude-marketplace-schema",
      CLAUDE_MARKETPLACE_PLUGIN_FIELD_TYPES,
      prefix
    ),
    ...checkUnknownFields(
      file,
      plugin,
      "claude",
      "claude-marketplace-schema",
      CLAUDE_MARKETPLACE_PLUGIN_FIELDS,
      prefix
    ),
    ...checkClaudeMarketplacePluginArrays(file, plugin, prefix)
  );
  for (const field of ["name", "source"] as const) {
    if (plugin[field] !== undefined) continue;
    report(
      "missing-required-field",
      `missing required destination field ${prefix}.${field}`
    );
  }
  if (plugin.name !== undefined && typeof plugin.name !== "string") {
    report("invalid-field-type", `destination field ${prefix}.name must be a string`);
  } else if (plugin.name === "") {
    report("invalid-shape", `destination field ${prefix}.name must not be empty`);
  } else if (
    typeof plugin.name === "string" &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(plugin.name)
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.name must start with a letter or digit, use only letters, digits, dots, underscores, or hyphens, and contain at most 128 characters`
    );
  }

  const source = plugin.source;
  if (source === undefined) return issues;
  if (typeof source === "string") {
    if (!source.startsWith("./")) {
      report(
        "invalid-shape",
        `destination field ${prefix}.source must start with ./ when it is a string`
      );
    } else if (hasParentPathSegment(source)) {
      report(
        "invalid-shape",
        `destination field ${prefix}.source must not traverse outside the marketplace root`
      );
    }
    return issues;
  }
  if (!isJsonRecord(source)) {
    report(
      "invalid-field-type",
      `destination field ${prefix}.source must be a string or an object`
    );
    return issues;
  }

  if (source.source === undefined) {
    report(
      "missing-required-field",
      `missing required destination field ${prefix}.source.source`
    );
    return issues;
  }
  if (typeof source.source !== "string") {
    report(
      "invalid-field-type",
      `destination field ${prefix}.source.source must be a string`
    );
    return issues;
  }

  const sourceKind = source.source as keyof typeof CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS;
  const requiredFields = Object.hasOwn(CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS, sourceKind)
    ? CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS[sourceKind]
    : undefined;
  if (requiredFields === undefined) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.source must be archive, command, github, git-subdir, npm, or url`
    );
    return issues;
  }
  const sourceFieldTypes = CLAUDE_MARKETPLACE_SOURCE_FIELD_TYPES[sourceKind];
  issues.push(
    ...checkFieldTypes(
      file,
      source,
      "claude",
      "claude-marketplace-schema",
      sourceFieldTypes,
      `${prefix}.source`
    ),
    ...checkUnknownFields(
      file,
      source,
      "claude",
      "claude-marketplace-schema",
      ["source", ...Object.keys(sourceFieldTypes)],
      `${prefix}.source`
    )
  );
  for (const field of requiredFields) {
    if (source[field] === undefined) {
      report(
        "missing-required-field",
        `missing required destination field ${prefix}.source.${field}`
      );
    } else if (source[field] === "") {
      report(
        "invalid-shape",
        `destination field ${prefix}.source.${field} must not be empty`
      );
    }
  }
  if (
    source.sha !== undefined &&
    typeof source.sha === "string" &&
    !/^[a-f0-9]{40}$/u.test(source.sha)
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.sha must be a 40-character lowercase hexadecimal commit SHA`
    );
  }
  if (
    source.source === "archive" &&
    typeof source.sha256 === "string" &&
    !/^[A-Fa-f0-9]{64}$/u.test(source.sha256)
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.sha256 must be a 64-character hexadecimal digest`
    );
  }
  if (
    source.source === "command" &&
    typeof source.mode === "string" &&
    source.mode !== "copy" &&
    source.mode !== "link"
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.mode must be copy or link`
    );
  }
  if (
    source.source === "command" &&
    typeof source.timeout === "number" &&
    (!Number.isInteger(source.timeout) || source.timeout < 1 || source.timeout > 600)
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.timeout must be an integer from 1 through 600`
    );
  }
  if (
    source.source === "archive" &&
    typeof source.url === "string" &&
    source.url !== ""
  ) {
    // A prefix test accepts values such as `https://[bad` that `URL` cannot
    // parse, so the host checks below silently pass an unfetchable archive.
    // Parsing first makes an unparsable URL its own conformance failure.
    const parsed = parseAbsoluteUrl(source.url);
    if (parsed === undefined) {
      report(
        "invalid-shape",
        `destination field ${prefix}.source.url must be a parsable absolute URL`
      );
    } else if (parsed.protocol !== "https:") {
      report(
        "invalid-shape",
        `destination field ${prefix}.source.url must use HTTPS`
      );
    } else if (isBlockedArchiveHost(parsed)) {
      report(
        "invalid-shape",
        `destination field ${prefix}.source.url must not use a loopback, link-local, or cloud-metadata host`
      );
    }
  }
  if (
    source.source === "command" &&
    typeof source.command === "string" &&
    (source.command.length > 500 || /[^\x20-\x7E]/u.test(source.command) || source.command.includes("    "))
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.command must be at most 500 printable ASCII characters without four consecutive spaces`
    );
  }
  if (
    source.source === "npm" &&
    typeof source.registry === "string" &&
    !isAbsoluteUrl(source.registry)
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.registry must be an absolute URL`
    );
  }
  if (
    source.source === "git-subdir" &&
    typeof source.path === "string" &&
    hasParentPathSegment(source.path)
  ) {
    report(
      "invalid-shape",
      `destination field ${prefix}.source.path must not contain parent traversal`
    );
  }
  return issues;
}

const CLAUDE_MARKETPLACE_PLUGIN_FIELD_TYPES = { ...CLAUDE_PLUGIN_FIELD_TYPES, ...CLAUDE_MARKETPLACE_HEADER_FIELD_TYPES };

const CLAUDE_MARKETPLACE_PLUGIN_FIELDS = [
  ...Object.keys(CLAUDE_MARKETPLACE_PLUGIN_FIELD_TYPES),
  ...CLAUDE_MARKETPLACE_UNTYPED_FIELDS,
  "name",
  "source",
] as const;

function checkClaudeMarketplacePluginArrays(
  file: ProviderFormatConformanceFile,
  plugin: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  issues.push(...checkClaudeHookReferences(file, plugin.hooks, `${prefix}.hooks`, "claude-marketplace-schema"));
  issues.push(...checkClaudeComponentReferences(file, plugin, prefix, "claude-marketplace-schema"));
  issues.push(...checkClaudeInlineHooks(file, plugin.hooks, `${prefix}.hooks`, "claude-marketplace-schema"));
  if (Array.isArray(plugin.dependencies)) {
    issues.push(...checkClaudeDependencies(file, plugin.dependencies, `${prefix}.dependencies`, "claude-marketplace-schema"));
  }
  if (isJsonRecord(plugin.commands)) {
    issues.push(...checkClaudeCommandMap(file, plugin.commands, `${prefix}.commands`, "claude-marketplace-schema"));
  }

  issues.push(
    ...checkClaudeLspServers(file, plugin.lspServers, `${prefix}.lspServers`, "claude-marketplace-schema"),
    ...checkClaudeMcpServers(file, plugin.mcpServers, `${prefix}.mcpServers`, "claude-marketplace-schema")
  );
  if (isJsonRecord(plugin.userConfig)) {
    issues.push(...checkClaudeUserConfig(file, plugin.userConfig, `${prefix}.userConfig`, "claude-marketplace-schema", "identifier"));
  }
  issues.push(...checkClaudeMonitors(file, plugin.monitors, `${prefix}.monitors`, "claude-marketplace-schema"));
  if (Array.isArray(plugin.channels)) {
    issues.push(...checkClaudeChannels(file, plugin.channels, `${prefix}.channels`, "claude-marketplace-schema"));
  }

  if (isJsonRecord(plugin.experimental)) {
    issues.push(...checkClaudeExperimental(file, plugin.experimental, `${prefix}.experimental`, "claude-marketplace-schema"));
  }
  return issues;
}

function hasParentPathSegment(value: string): boolean {
  return value.split(/[\\/]+/u).includes("..");
}

function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isAbsoluteUrl(value: string): boolean {
  return (parseAbsoluteUrl(value)?.protocol.length ?? 0) > 1;
}

/**
 * Takes a parsed `URL` so an unparsable value can never reach the host checks.
 * Swallowing the parse failure here would report a malformed archive URL as an
 * allowed host instead of as a conformance failure.
 *
 * `URL.hostname` keeps the terminal dot of a fully qualified name, so trailing
 * dots are stripped before comparison: DNS resolves `localhost.` exactly like
 * `localhost`, and repeated dots are dropped too so a malformed spelling cannot
 * evade the check either.
 */
function isBlockedArchiveHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.+$/u, "");
  if (hostname === "localhost" || hostname === "::1" || hostname === "metadata.google.internal") return true;
  if (isBlockedIpv4Host(hostname)) return true;
  const mapped = ipv4MappedIpv6Address(hostname);
  if (mapped !== undefined && isBlockedIpv4Host(mapped)) return true;
  return /^fe[89ab][0-9a-f]:/u.test(hostname);
}

function isBlockedIpv4Host(hostname: string): boolean {
  return (
    /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
    /^169\.254(?:\.\d{1,3}){2}$/u.test(hostname)
  );
}

/**
 * Returns the IPv4 address embedded in an IPv4-mapped IPv6 host, which reaches
 * the same interface as the bare IPv4 address. `URL.hostname` normalizes
 * `[::ffff:127.0.0.1]` to `::ffff:7f00:1`, so both spellings are recognized.
 */
function ipv4MappedIpv6Address(hostname: string): string | undefined {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(hostname);
  if (dotted?.[1] !== undefined) return dotted[1];
  const hextets = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(hostname);
  if (hextets?.[1] === undefined || hextets[2] === undefined) return undefined;
  const high = Number.parseInt(hextets[1], 16);
  const low = Number.parseInt(hextets[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export function checkClaudeAuthorObject(
  file: ProviderFormatConformanceFile,
  author: JsonRecord,
  providerRef: "claude-marketplace-schema" | "claude-plugin-manifest-schema",
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  if (author.name === undefined) {
    issues.push(
      issue(
        file,
        "claude",
        providerRef,
        "missing-required-field",
        `missing required destination field ${prefix}.name`
      )
    );
  } else if (author.name === "") {
    issues.push(
      issue(
        file,
        "claude",
        providerRef,
        "invalid-shape",
        `destination field ${prefix}.name must not be empty`
      )
    );
  }
  for (const key of ["email", "name", "url"] as const) {
    const value = author[key];
    if (value === undefined || typeof value === "string") continue;
    issues.push(
      issue(
        file,
        "claude",
        providerRef,
        "invalid-field-type",
        `destination field ${prefix}.${key} must be a string`
      )
    );
  }
  issues.push(
    ...checkUnknownFields(
      file,
      author,
      "claude",
      providerRef,
      ["email", "name", "url"],
      prefix
    )
  );
  return issues;
}

export function isClaudeMarketplacePath(path: string): boolean {
  return isTargetMarketplacePath(path, "claude");
}
