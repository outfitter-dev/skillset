import { CLAUDE_HOOK_EVENTS, validateHookDefinition } from "./hooks";
import {
  checkFieldTypes,
  checkRequiredFields,
  checkUnknownFields,
  errorMessage,
  issue,
  jsonSchemaSummary,
  parseJsonRecord,
  type FieldType,
  type ProviderFormatConformanceFile,
  type ProviderFormatConformanceIssue,
  type ProviderFormatConformanceIssueCode,
} from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

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
      issues.push(...checkClaudeMarketplacePlugin(file, plugin, prefix));
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
  const report = (code: ProviderFormatConformanceIssueCode, message: string): void => {
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
  const requiredFields = CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS[sourceKind];
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

const CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS = {
  archive: ["url"],
  command: ["command"],
  github: ["repo"],
  "git-subdir": ["url", "path"],
  npm: ["package"],
  url: ["url"],
} as const;

const CLAUDE_MARKETPLACE_SOURCE_FIELD_TYPES = {
  archive: { sha256: "string", url: "string" },
  command: { command: "string", mode: "string", timeout: "number" },
  github: { ref: "string", repo: "string", sha: "string" },
  "git-subdir": { path: "string", ref: "string", sha: "string", url: "string" },
  npm: { package: "string", registry: "string", version: "string" },
  url: { ref: "string", sha: "string", url: "string" },
} as const satisfies Readonly<
  Record<keyof typeof CLAUDE_MARKETPLACE_SOURCE_REQUIRED_FIELDS, Readonly<Record<string, FieldType>>>
>;

const CLAUDE_MARKETPLACE_PLUGIN_FIELD_TYPES = {
  $schema: "string",
  agents: "string-or-string-array",
  author: "object",
  category: "string",
  channels: "array",
  commands: "string-object-or-array",
  defaultEnabled: "boolean",
  dependencies: "array",
  description: "string",
  displayName: "string",
  experimental: "object",
  homepage: "string",
  hooks: "string-object-or-array",
  keywords: "string-array",
  license: "string",
  lspServers: "string-object-or-array",
  mcpServers: "string-object-or-array",
  metadata: "object",
  monitors: "string-or-array",
  outputStyles: "string-or-string-array",
  relevance: "object",
  repository: "string",
  settings: "object",
  skills: "string-or-string-array",
  strict: "boolean",
  tags: "string-array",
  themes: "string-or-string-array",
  userConfig: "object",
  version: "string",
  workflows: "string-or-string-array",
} as const satisfies Readonly<Record<string, FieldType>>;

const CLAUDE_MARKETPLACE_PLUGIN_FIELDS = [
  ...Object.keys(CLAUDE_MARKETPLACE_PLUGIN_FIELD_TYPES),
  "name",
  "source",
] as const;

function checkClaudeMarketplacePluginArrays(
  file: ProviderFormatConformanceFile,
  plugin: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const report = (code: ProviderFormatConformanceIssueCode, message: string): void => {
    issues.push(issue(file, "claude", "claude-marketplace-schema", code, message));
  };
  const checkItems = (
    field: string,
    valid: (value: unknown) => boolean,
    expected: string
  ): void => {
    const value = plugin[field];
    if (!Array.isArray(value)) return;
    for (const [index, item] of value.entries()) {
      if (valid(item)) continue;
      report(
        "invalid-field-type",
        `destination field ${prefix}.${field}[${index}] must be ${expected}`
      );
    }
  };
  for (const [field, extension] of [
    ["agents", ".md"],
    ["commands", undefined],
    ["hooks", ".json"],
    ["lspServers", ".json"],
    ["monitors", ".json"],
    ["outputStyles", undefined],
    ["skills", undefined],
    ["themes", undefined],
    ["workflows", undefined],
  ] as const) {
    issues.push(
      ...checkClaudeComponentPaths(file, plugin[field], `${prefix}.${field}`, extension)
    );
  }
  const checkMcpServerReference = (path: string, label: string): void => {
    if (path.startsWith("./") || isAbsoluteUrl(path)) return;
    report("invalid-shape", `destination field ${label} must start with ./ or be an absolute URL`);
  };
  if (typeof plugin.mcpServers === "string") {
    checkMcpServerReference(plugin.mcpServers, `${prefix}.mcpServers`);
  } else if (Array.isArray(plugin.mcpServers)) {
    for (const [index, entry] of plugin.mcpServers.entries()) {
      if (typeof entry !== "string") continue;
      checkMcpServerReference(entry, `${prefix}.mcpServers[${index}]`);
    }
  }
  checkItems("commands", (value) => typeof value === "string", "a string");
  for (const field of ["hooks", "lspServers", "mcpServers"] as const) {
    checkItems(
      field,
      (value) => typeof value === "string" || isJsonRecord(value),
      "a string or an object"
    );
  }
  if (Array.isArray(plugin.hooks)) {
    for (const [index, hookEntry] of plugin.hooks.entries()) {
      if (!isJsonRecord(hookEntry)) continue;
      issues.push(...checkClaudeHookMap(file, hookEntry, `${prefix}.hooks[${index}]`));
    }
  }
  checkItems("monitors", isJsonRecord, "an object");
  if (Array.isArray(plugin.dependencies)) {
    for (const [index, dependency] of plugin.dependencies.entries()) {
      if (
        typeof dependency === "string" &&
        !/^[A-Za-z0-9][-A-Za-z0-9._]*(@[A-Za-z0-9][-A-Za-z0-9._]*)?(@\^[^@]*)?$/u.test(dependency)
      ) {
        report(
          "invalid-shape",
          `destination field ${prefix}.dependencies[${index}] must be a valid plugin dependency identifier`
        );
      }
    }
  }
  if (isJsonRecord(plugin.commands)) {
    issues.push(...checkClaudeCommandMap(file, plugin.commands, `${prefix}.commands`));
  }
  if (isJsonRecord(plugin.hooks)) {
    issues.push(...checkClaudeHookMap(file, plugin.hooks, `${prefix}.hooks`));
  }
  issues.push(
    ...checkClaudeConfigMapVariants(file, plugin.lspServers, `${prefix}.lspServers`, "lsp"),
    ...checkClaudeConfigMapVariants(file, plugin.mcpServers, `${prefix}.mcpServers`, "mcp")
  );
  if (isJsonRecord(plugin.userConfig)) {
    issues.push(...checkClaudeUserConfig(file, plugin.userConfig, `${prefix}.userConfig`));
  }
  if (Array.isArray(plugin.monitors)) {
    for (const [index, monitor] of plugin.monitors.entries()) {
      if (!isJsonRecord(monitor)) continue;
      issues.push(...checkClaudeMonitor(file, monitor, `${prefix}.monitors[${index}]`));
    }
  }
  if (Array.isArray(plugin.channels)) {
    for (const [index, channel] of plugin.channels.entries()) {
      const channelPrefix = `${prefix}.channels[${index}]`;
      if (!isJsonRecord(channel)) {
        report("invalid-field-type", `destination field ${channelPrefix} must be an object`);
        continue;
      }
      if (channel.server === undefined) {
        report("missing-required-field", `missing required destination field ${channelPrefix}.server`);
      } else if (typeof channel.server !== "string") {
        report("invalid-field-type", `destination field ${channelPrefix}.server must be a string`);
      } else if (channel.server === "") {
        report("invalid-shape", `destination field ${channelPrefix}.server must not be empty`);
      }
      issues.push(
        ...checkFieldTypes(
          file,
          channel,
          "claude",
          "claude-marketplace-schema",
          { displayName: "string", userConfig: "object" },
          channelPrefix
        ),
        ...checkUnknownFields(
          file,
          channel,
          "claude",
          "claude-marketplace-schema",
          ["displayName", "server", "userConfig"],
          channelPrefix
        )
      );
      if (isJsonRecord(channel.userConfig)) {
        issues.push(
          ...checkClaudeUserConfig(file, channel.userConfig, `${channelPrefix}.userConfig`)
        );
      }
    }
  }
  if (Array.isArray(plugin.dependencies)) {
    for (const [index, dependency] of plugin.dependencies.entries()) {
      const dependencyPrefix = `${prefix}.dependencies[${index}]`;
      if (typeof dependency === "string") continue;
      if (!isJsonRecord(dependency)) {
        report(
          "invalid-field-type",
          `destination field ${dependencyPrefix} must be a string or an object`
        );
        continue;
      }
      if (dependency.name === undefined) {
        report("missing-required-field", `missing required destination field ${dependencyPrefix}.name`);
      } else if (typeof dependency.name !== "string") {
        report("invalid-field-type", `destination field ${dependencyPrefix}.name must be a string`);
      } else if (dependency.name === "") {
        report("invalid-shape", `destination field ${dependencyPrefix}.name must not be empty`);
      } else if (!/^[A-Za-z0-9][-A-Za-z0-9._]*$/u.test(dependency.name)) {
        report("invalid-shape", `destination field ${dependencyPrefix}.name must be a valid plugin name`);
      }
      if (dependency.marketplace !== undefined && typeof dependency.marketplace !== "string") {
        report("invalid-field-type", `destination field ${dependencyPrefix}.marketplace must be a string`);
      } else if (dependency.marketplace === "") {
        report("invalid-shape", `destination field ${dependencyPrefix}.marketplace must not be empty`);
      } else if (
        typeof dependency.marketplace === "string" &&
        !/^[A-Za-z0-9][-A-Za-z0-9._]*$/u.test(dependency.marketplace)
      ) {
        report("invalid-shape", `destination field ${dependencyPrefix}.marketplace must be a valid marketplace name`);
      }
      if (dependency.version !== undefined && typeof dependency.version !== "string") {
        report("invalid-field-type", `destination field ${dependencyPrefix}.version must be a string`);
      } else if (dependency.version === "") {
        report("invalid-shape", `destination field ${dependencyPrefix}.version must not be empty`);
      }
      issues.push(
        ...checkUnknownFields(
          file,
          dependency,
          "claude",
          "claude-marketplace-schema",
          ["marketplace", "name", "version"],
          dependencyPrefix
        )
      );
    }
  }
  if (isJsonRecord(plugin.experimental)) {
    issues.push(
      ...checkFieldTypes(
        file,
        plugin.experimental,
        "claude",
        "claude-marketplace-schema",
        { monitors: "string-or-array", themes: "string-or-string-array" },
        `${prefix}.experimental`
      ),
      ...checkUnknownFields(
        file,
        plugin.experimental,
        "claude",
        "claude-marketplace-schema",
        ["monitors", "themes"],
        `${prefix}.experimental`
      )
    );
    issues.push(
      ...checkClaudeComponentPaths(
        file,
        plugin.experimental.monitors,
        `${prefix}.experimental.monitors`,
        ".json"
      ),
      ...checkClaudeComponentPaths(
        file,
        plugin.experimental.themes,
        `${prefix}.experimental.themes`
      )
    );
    if (Array.isArray(plugin.experimental.monitors)) {
      for (const [index, monitor] of plugin.experimental.monitors.entries()) {
        if (isJsonRecord(monitor)) continue;
        report(
          "invalid-field-type",
          `destination field ${prefix}.experimental.monitors[${index}] must be an object`
        );
      }
      for (const [index, monitor] of plugin.experimental.monitors.entries()) {
        if (!isJsonRecord(monitor)) continue;
        issues.push(
          ...checkClaudeMonitor(
            file,
            monitor,
            `${prefix}.experimental.monitors[${index}]`
          )
        );
      }
    }
  }
  return issues;
}

function checkClaudeComponentPaths(
  file: ProviderFormatConformanceFile,
  value: unknown,
  prefix: string,
  extension?: string
): readonly ProviderFormatConformanceIssue[] {
  const paths = typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [index, path] of paths.entries()) {
    const label = Array.isArray(value) ? `${prefix}[${index}]` : prefix;
    if (!path.startsWith("./")) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${label} must start with ./`));
      continue;
    }
    if (extension !== undefined && !path.endsWith(extension)) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${label} must end with ${extension}`));
    }
  }
  return issues;
}

function checkClaudeMonitor(
  file: ProviderFormatConformanceFile,
  monitor: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues = [
    ...checkRequiredFields(
      file,
      monitor,
      "claude",
      "claude-marketplace-schema",
      ["command", "description", "name"],
      prefix
    ),
    ...checkFieldTypes(
      file,
      monitor,
      "claude",
      "claude-marketplace-schema",
      { command: "string", description: "string", name: "string", when: "string" },
      prefix
    ),
    ...checkUnknownFields(
      file,
      monitor,
      "claude",
      "claude-marketplace-schema",
      ["command", "description", "name", "when"],
      prefix
    ),
  ];
  for (const field of ["command", "description", "name"] as const) {
    if (monitor[field] !== "") continue;
    issues.push(
      issue(
        file,
        "claude",
        "claude-marketplace-schema",
        "invalid-shape",
        `destination field ${prefix}.${field} must not be empty`
      )
    );
  }
  if (
    typeof monitor.when === "string" &&
    monitor.when !== "always" &&
    !monitor.when.startsWith("on-skill-invoke:")
  ) {
    issues.push(
      issue(
        file,
        "claude",
        "claude-marketplace-schema",
        "invalid-shape",
        `destination field ${prefix}.when must be always or start with on-skill-invoke:`
      )
    );
  }
  return issues;
}

function checkClaudeCommandMap(
  file: ProviderFormatConformanceFile,
  commands: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [name, command] of Object.entries(commands)) {
    const commandPrefix = `${prefix}.${name}`;
    if (!isJsonRecord(command)) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-field-type", `destination field ${commandPrefix} must be an object`));
      continue;
    }
    issues.push(
      ...checkFieldTypes(file, command, "claude", "claude-marketplace-schema", {
        allowedTools: "string-array",
        argumentHint: "string",
        content: "string",
        description: "string",
        model: "string",
        source: "string",
      }, commandPrefix),
      ...checkUnknownFields(file, command, "claude", "claude-marketplace-schema", [
        "allowedTools", "argumentHint", "content", "description", "model", "source",
      ], commandPrefix)
    );
    if (
      typeof command.source === "string" &&
      !command.source.startsWith("./")
    ) {
      issues.push(
        issue(
          file,
          "claude",
          "claude-marketplace-schema",
          "invalid-shape",
          `destination field ${commandPrefix}.source must start with ./`
        )
      );
    }
    if (command.source !== undefined && command.content !== undefined) {
      issues.push(
        issue(
          file,
          "claude",
          "claude-marketplace-schema",
          "invalid-shape",
          `destination field ${commandPrefix} must not define both source and content`
        )
      );
    }
  }
  return issues;
}

function checkClaudeHookMap(
  file: ProviderFormatConformanceFile,
  hooks: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues = [
    ...checkUnknownFields(
      file,
      hooks,
      "claude",
      "claude-marketplace-schema",
      [...CLAUDE_HOOK_EVENTS],
      prefix
    ),
  ];
  try {
    validateHookDefinition(hooks, { sourcePath: file.path, target: "claude" });
  } catch (error) {
    issues.push(
      issue(
        file,
        "claude",
        "claude-marketplace-schema",
        "invalid-shape",
        `${prefix} is invalid: ${errorMessage(error)}`
      )
    );
  }
  return issues;
}

function checkClaudeConfigMapVariants(
  file: ProviderFormatConformanceFile,
  value: unknown,
  prefix: string,
  kind: "lsp" | "mcp"
): readonly ProviderFormatConformanceIssue[] {
  const maps = isJsonRecord(value)
    ? [value]
    : Array.isArray(value)
      ? value.filter(isJsonRecord)
      : [];
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [mapIndex, map] of maps.entries()) {
    const mapPrefix = Array.isArray(value) ? `${prefix}[${mapIndex}]` : prefix;
    for (const [name, config] of Object.entries(map)) {
      const configPrefix = `${mapPrefix}.${name}`;
      if (!isJsonRecord(config)) {
        issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-field-type", `destination field ${configPrefix} must be an object`));
        continue;
      }
      if (kind === "lsp") {
        issues.push(
          ...checkRequiredFields(file, config, "claude", "claude-marketplace-schema", ["command", "extensionToLanguage"], configPrefix),
          ...checkFieldTypes(file, config, "claude", "claude-marketplace-schema", {
            args: "string-array", command: "string", diagnostics: "boolean", env: "object",
            extensionToLanguage: "object", maxRestarts: "number", restartOnCrash: "boolean",
            shutdownTimeout: "number", startupTimeout: "number", transport: "string",
            workspaceFolder: "string",
          }, configPrefix),
          ...checkUnknownFields(file, config, "claude", "claude-marketplace-schema", [
            "args", "command", "diagnostics", "env", "extensionToLanguage", "initializationOptions",
            "maxRestarts", "restartOnCrash", "settings", "shutdownTimeout",
            "startupTimeout", "transport", "workspaceFolder",
          ], configPrefix)
        );
        if (config.transport !== undefined && config.transport !== "socket" && config.transport !== "stdio") {
          issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.transport must be socket or stdio`));
        }
        if (isJsonRecord(config.env)) {
          issues.push(...checkStringRecordValues(file, config.env, `${configPrefix}.env`));
        }
        if (isJsonRecord(config.extensionToLanguage)) {
          issues.push(...checkStringRecordValues(file, config.extensionToLanguage, `${configPrefix}.extensionToLanguage`));
          for (const [extension, language] of Object.entries(config.extensionToLanguage)) {
            if (extension.length < 2) {
              issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.extensionToLanguage.${extension} must use an extension of at least two characters`));
            }
            if (language === "") {
              issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.extensionToLanguage.${extension} must not be empty`));
            }
          }
        }
        if (Array.isArray(config.args)) {
          for (const [index, argument] of config.args.entries()) {
            if (argument !== "") continue;
            issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.args[${index}] must not be empty`));
          }
        }
        for (const field of ["shutdownTimeout", "startupTimeout"] as const) {
          const timeout = config[field];
          if (typeof timeout === "number" && (!Number.isInteger(timeout) || timeout <= 0)) {
            issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.${field} must be a positive integer`));
          }
        }
        if (typeof config.maxRestarts === "number" && (!Number.isInteger(config.maxRestarts) || config.maxRestarts < 0)) {
          issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.maxRestarts must be a nonnegative integer`));
        }
      } else {
        const remote = config.type === "http" || config.type === "sse" || config.type === "ws";
        const required = remote ? ["type", "url"] : ["command"];
        const allowed = remote
          ? ["headers", "headersHelper", "oauth", "type", "url"]
          : ["args", "command", "env", "type"];
        issues.push(
          ...checkRequiredFields(file, config, "claude", "claude-marketplace-schema", required, configPrefix),
          ...checkFieldTypes(file, config, "claude", "claude-marketplace-schema", {
            args: "string-array", command: "string", env: "object", headers: "object",
            headersHelper: "string", oauth: "object", type: "string", url: "string",
          }, configPrefix),
          ...checkUnknownFields(file, config, "claude", "claude-marketplace-schema", allowed, configPrefix)
        );
        if (
          config.type !== undefined &&
          config.type !== "http" && config.type !== "sse" &&
          config.type !== "stdio" && config.type !== "ws"
        ) {
          issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${configPrefix}.type must be http, sse, stdio, or ws`));
        }
        if (isJsonRecord(config.env)) {
          issues.push(...checkStringRecordValues(file, config.env, `${configPrefix}.env`));
        }
        if (isJsonRecord(config.headers)) {
          issues.push(...checkStringRecordValues(file, config.headers, `${configPrefix}.headers`));
        }
        if (isJsonRecord(config.oauth)) {
          issues.push(...checkClaudeMcpOauth(file, config.oauth, `${configPrefix}.oauth`));
        }
      }
    }
  }
  return issues;
}

function checkClaudeMcpOauth(
  file: ProviderFormatConformanceFile,
  oauth: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues = [
    ...checkFieldTypes(file, oauth, "claude", "claude-marketplace-schema", {
      authServerMetadataUrl: "string", callbackPort: "number", clientId: "string",
      scopes: "string", xaa: "boolean",
    }, prefix),
    ...checkUnknownFields(file, oauth, "claude", "claude-marketplace-schema", [
      "authServerMetadataUrl", "callbackPort", "clientId", "scopes", "xaa",
    ], prefix),
  ];
  if (typeof oauth.callbackPort === "number" && (!Number.isInteger(oauth.callbackPort) || oauth.callbackPort <= 0)) {
    issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${prefix}.callbackPort must be a positive integer`));
  }
  if (typeof oauth.authServerMetadataUrl === "string" && !oauth.authServerMetadataUrl.startsWith("https://")) {
    issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${prefix}.authServerMetadataUrl must use HTTPS`));
  }
  if (oauth.scopes === "") {
    issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${prefix}.scopes must not be empty`));
  }
  return issues;
}

function checkStringRecordValues(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  return Object.entries(value)
    .filter(([, entry]) => typeof entry !== "string")
    .map(([key]) => issue(
      file,
      "claude",
      "claude-marketplace-schema",
      "invalid-field-type",
      `destination field ${prefix}.${key} must be a string`
    ));
}

function checkClaudeUserConfig(
  file: ProviderFormatConformanceFile,
  config: JsonRecord,
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [name, entry] of Object.entries(config)) {
    const entryPrefix = `${prefix}.${name}`;
    if (!/^[A-Za-z_]\w*$/u.test(name)) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${entryPrefix} must use an identifier key`));
    }
    if (!isJsonRecord(entry)) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-field-type", `destination field ${entryPrefix} must be an object`));
      continue;
    }
    issues.push(
      ...checkRequiredFields(file, entry, "claude", "claude-marketplace-schema", ["description", "title", "type"], entryPrefix),
      ...checkFieldTypes(file, entry, "claude", "claude-marketplace-schema", {
        description: "string", max: "number", min: "number", multiple: "boolean",
        required: "boolean", sensitive: "boolean", title: "string", type: "string",
      }, entryPrefix),
      ...checkUnknownFields(file, entry, "claude", "claude-marketplace-schema", [
        "default", "description", "max", "min", "multiple", "required", "sensitive", "title", "type",
      ], entryPrefix)
    );
    if (typeof entry.type === "string" && !["boolean", "directory", "file", "number", "string"].includes(entry.type)) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-shape", `destination field ${entryPrefix}.type must be boolean, directory, file, number, or string`));
    }
    if (
      entry.default !== undefined &&
      typeof entry.default !== "string" &&
      typeof entry.default !== "number" &&
      typeof entry.default !== "boolean" &&
      !(Array.isArray(entry.default) && entry.default.every((value) => typeof value === "string"))
    ) {
      issues.push(issue(file, "claude", "claude-marketplace-schema", "invalid-field-type", `destination field ${entryPrefix}.default must be a string, number, boolean, or array of strings`));
    }
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
  return (
    path === ".claude-plugin/marketplace.json" ||
    path.endsWith("/.claude-plugin/marketplace.json")
  );
}
