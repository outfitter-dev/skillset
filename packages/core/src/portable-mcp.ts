import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

import {
  getProviderMcpEvidence,
  listStandardProfileSchemaSnapshots,
} from "@skillset/registry";
import type { ProviderMcpEvidence } from "@skillset/registry";

import { compareStrings } from "./path";
import { targetNames } from "./targets";
import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export const AGENT_PLUGINS_MCP_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const ROOT_FIELDS = new Set(["$schema", "mcpServers"]);
const STDIO_FIELDS = new Set(["type", "command", "args", "env", "cwd"]);
const REMOTE_FIELDS = new Set(["type", "url", "headers"]);
const UNION_FIELDS = new Set([...STDIO_FIELDS, ...REMOTE_FIELDS]);
const STANDARD_SUPPORT_ROOTS = new Set(["assets", "bin", "scripts", "src"]);
const CLIENT_OWNED_HTTP_HEADERS = new Set([
  "accept",
  "authorization",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "host",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
]);
const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const PROVIDER_PLACEHOLDERS: Readonly<Record<string, string>> = {
  CLAUDE_PLUGIN_DATA: "PLUGIN_DATA",
  CLAUDE_PLUGIN_ROOT: "PLUGIN_ROOT",
  CODEX_PLUGIN_DATA: "PLUGIN_DATA",
  CODEX_PLUGIN_ROOT: "PLUGIN_ROOT",
  CURSOR_PLUGIN_DATA: "PLUGIN_DATA",
  CURSOR_PLUGIN_ROOT: "PLUGIN_ROOT",
};

export type PortableMcpProviderEvidence = ProviderMcpEvidence;

/** Provider MCP facts used by the renderer below, kept reviewable at the seam. */
export const PORTABLE_MCP_PROVIDER_EVIDENCE = Object.fromEntries(
  targetNames().map((target) => [target, getProviderMcpEvidence(target)])
) as Readonly<Record<TargetName, PortableMcpProviderEvidence>>;

export interface PortableMcpStdioServer {
  readonly args?: readonly string[];
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly type: "stdio";
}

export interface PortableMcpRemoteServer {
  readonly headers?: Readonly<Record<string, string>>;
  readonly type: "sse" | "streamable-http";
  readonly url: string;
}

export type PortableMcpServer =
  | PortableMcpRemoteServer
  | PortableMcpStdioServer;

export interface UnsupportedPortableMcpServer {
  readonly fields: readonly string[];
  readonly name: string;
  readonly raw: JsonRecord;
  readonly reason: string;
}

export interface PortableMcpModel {
  /** Target-specific entries retained whole because no faithful rendering exists. */
  readonly providerUnsupported: readonly PortableMcpProviderUnsupported[];
  /** Portable entries that can be emitted into Agent Plugins `mcp.json`. */
  readonly servers: Readonly<Record<string, PortableMcpServer>>;
  /** Plugin-root-relative paths that a standards bundle must carry. */
  readonly supportPaths: readonly string[];
  /** Whole provider entries retained without stripping operative fields. */
  readonly unsupported: readonly UnsupportedPortableMcpServer[];
}

export interface PortableMcpProviderUnsupported {
  readonly evidence: PortableMcpProviderEvidence;
  readonly name: string;
  readonly raw: JsonRecord;
  readonly reason: string;
  readonly target: TargetName;
}

export interface ParsePortableMcpSourceOptions {
  readonly pluginRoot: string;
  readonly sourcePath: string;
}

/**
 * Parse and validate the adaptive MCP source once. The returned model is the
 * sole input to standards and provider renderers so their bytes cannot drift
 * through independent re-parsing.
 */
export async function parsePortableMcpSource(
  options: ParsePortableMcpSourceOptions
): Promise<PortableMcpModel> {
  assertPinnedMcpSchemaContract();
  const { pluginRoot, sourcePath } = options;
  const label = sourcePath;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf-8")) as JsonValue;
  } catch (error) {
    throw new Error(
      `skillset: MCP source ${label} is not valid JSON: ${errorMessage(error)}`,
      { cause: error }
    );
  }
  if (!isJsonRecord(parsed)) {
    throw new Error(`skillset: MCP source ${label} must contain a JSON object`);
  }
  rejectUnknownFields(parsed, ROOT_FIELDS, `MCP source ${label}`, "root");
  if (
    parsed.$schema !== undefined &&
    parsed.$schema !== AGENT_PLUGINS_MCP_SCHEMA
  ) {
    throw new Error(
      `skillset: MCP source ${label} uses unsupported MCP schema ${JSON.stringify(parsed.$schema)}; use ${AGENT_PLUGINS_MCP_SCHEMA}`
    );
  }
  if (!isJsonRecord(parsed.mcpServers)) {
    throw new Error(
      `skillset: MCP source ${label}.mcpServers must be an object`
    );
  }

  const pluginRealRoot = await realpath(pluginRoot);
  const servers = Object.create(null) as Record<string, PortableMcpServer>;
  const supportPaths = new Set<string>();
  const unsupported: UnsupportedPortableMcpServer[] = [];
  for (const name of Object.keys(parsed.mcpServers).toSorted(compareStrings)) {
    const raw = parsed.mcpServers[name];
    if (!isJsonRecord(raw)) {
      throw new Error(`skillset: MCP server ${name} must be an object`);
    }
    const type = readOptionalString(raw, "type", name);
    if (
      type === "http" ||
      type === "streamable_http" ||
      type === "streamableHttp"
    ) {
      throw new Error(
        `skillset: MCP server ${name}: replace provider transport ${JSON.stringify(type)} with "streamable-http"`
      );
    }
    if (
      type !== undefined &&
      type !== "stdio" &&
      type !== "streamable-http" &&
      type !== "sse"
    ) {
      throw new Error(
        `skillset: MCP server ${name} declares unsupported transport ${JSON.stringify(type)}; use stdio, streamable-http, or sse`
      );
    }
    if (raw.http_headers !== undefined) {
      throw new Error(
        `skillset: MCP server ${name}: use headers instead of provider field http_headers`
      );
    }
    const unknownFields = Object.keys(raw)
      .filter((field) => !UNION_FIELDS.has(field))
      .toSorted(compareStrings);
    const credentialPlaceholderFields =
      type === "streamable-http" || type === "sse"
        ? providerCredentialPlaceholderFields(raw, name)
        : [];
    if (credentialPlaceholderFields.length > 0) {
      const portableFields = Object.fromEntries(
        Object.entries(raw).filter(
          ([field]) => UNION_FIELDS.has(field) && field !== "headers"
        )
      ) as JsonRecord;
      await parsePortableServer(
        name,
        portableFields,
        type,
        pluginRoot,
        pluginRealRoot,
        new Set<string>()
      );
      unsupported.push({
        fields: [...new Set([...unknownFields, ...credentialPlaceholderFields])]
          .toSorted(compareStrings),
        name,
        raw,
        reason:
          "provider credential placeholders are outside Agent Plugins 1.0",
      });
      continue;
    }
    if (unknownFields.length > 0) {
      const portableFields = Object.fromEntries(
        Object.entries(raw).filter(([field]) => UNION_FIELDS.has(field))
      ) as JsonRecord;
      const ignoredSupportPaths = new Set<string>();
      await parsePortableServer(
        name,
        portableFields,
        type,
        pluginRoot,
        pluginRealRoot,
        ignoredSupportPaths
      );
      unsupported.push({
        fields: unknownFields,
        name,
        raw,
        reason: "provider-only MCP fields are outside Agent Plugins 1.0",
      });
      continue;
    }
    servers[name] = await parsePortableServer(
      name,
      raw,
      type,
      pluginRoot,
      pluginRealRoot,
      supportPaths
    );
  }

  return {
    providerUnsupported: classifyProviderUnsupported(servers),
    servers,
    supportPaths: [...supportPaths].toSorted(compareStrings),
    unsupported,
  };
}

function assertPinnedMcpSchemaContract(): void {
  const snapshot = listStandardProfileSchemaSnapshots("agent-plugins-1.0").find(
    (candidate) => {
      const parsed = JSON.parse(candidate.body) as JsonValue;
      return isJsonRecord(parsed) && parsed.$id === AGENT_PLUGINS_MCP_SCHEMA;
    }
  );
  if (snapshot === undefined) {
    throw new Error("skillset: pinned Agent Plugins MCP schema is missing");
  }
  const parsed = JSON.parse(snapshot.body) as JsonValue;
  if (!isJsonRecord(parsed)) {
    throw new Error("skillset: pinned Agent Plugins MCP schema is invalid");
  }
  assertSchemaFields(parsed.properties, ROOT_FIELDS, "root");
  const definitions = parsed.$defs;
  if (!isJsonRecord(definitions)) {
    throw new Error(
      "skillset: pinned Agent Plugins MCP schema definitions are invalid"
    );
  }
  assertSchemaFields(
    isJsonRecord(definitions.stdioServer)
      ? definitions.stdioServer.properties
      : undefined,
    STDIO_FIELDS,
    "stdio"
  );
  for (const variant of ["streamableHttpServer", "sseServer"]) {
    assertSchemaFields(
      isJsonRecord(definitions[variant])
        ? definitions[variant].properties
        : undefined,
      REMOTE_FIELDS,
      variant
    );
  }
}

function assertSchemaFields(
  value: JsonValue | undefined,
  expected: ReadonlySet<string>,
  label: string
): void {
  if (!isJsonRecord(value)) {
    throw new Error(
      `skillset: pinned Agent Plugins MCP ${label} fields are invalid`
    );
  }
  const actual = Object.keys(value).toSorted(compareStrings);
  const required = [...expected].toSorted(compareStrings);
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
  ) {
    throw new Error(
      `skillset: pinned Agent Plugins MCP ${label} fields drifted`
    );
  }
}

async function parsePortableServer(
  name: string,
  raw: JsonRecord,
  type: string | undefined,
  pluginRoot: string,
  pluginRealRoot: string,
  supportPaths: Set<string>
): Promise<PortableMcpServer> {
  if (type === undefined) {
    if (raw.command === undefined && raw.url !== undefined) {
      throw new Error(
        `skillset: MCP server ${name} URL entries must declare type: streamable-http or type: sse`
      );
    }
    if (raw.command === undefined) {
      throw new Error(
        `skillset: MCP server ${name} must declare a transport type`
      );
    }
    return parseStdioServer(
      name,
      raw,
      pluginRoot,
      pluginRealRoot,
      supportPaths
    );
  }
  if (type === "stdio") {
    return parseStdioServer(
      name,
      raw,
      pluginRoot,
      pluginRealRoot,
      supportPaths
    );
  }
  return parseRemoteServer(name, raw, type as PortableMcpRemoteServer["type"]);
}

export function renderAgentPluginsMcp(
  model: PortableMcpModel
): JsonRecord | undefined {
  if (Object.keys(model.servers).length === 0) {
    return undefined;
  }
  return {
    $schema: AGENT_PLUGINS_MCP_SCHEMA,
    mcpServers: sortedServerRecord(model.servers, (server) =>
      renderPortableServer(server)
    ),
  };
}

export function renderProviderMcp(
  model: PortableMcpModel,
  target: TargetName
): JsonRecord {
  return {
    mcpServers: sortedServerRecord(
      Object.fromEntries(
        Object.entries(model.servers).filter(
          ([name]) =>
            !model.providerUnsupported.some(
              (entry) => entry.target === target && entry.name === name
            )
        )
      ),
      (server) => renderProviderServer(server, target)
    ),
  };
}

/** Support roots referenced by entries that can be emitted for one provider. */
export function providerMcpSupportPaths(
  model: PortableMcpModel,
  target: TargetName
): readonly string[] {
  const omitted = new Set(
    model.providerUnsupported
      .filter((entry) => entry.target === target)
      .map((entry) => entry.name)
  );
  const supportPaths = new Set<string>();
  for (const [name, server] of Object.entries(model.servers)) {
    if (omitted.has(name) || server.type !== "stdio") continue;
    if (server.command.startsWith("./")) {
      collectReferencedSupportPath(server.command.slice(2), supportPaths);
    }
    if (server.cwd?.startsWith("./")) {
      collectReferencedSupportPath(server.cwd.slice(2), supportPaths);
    } else if (server.cwd?.startsWith("${PLUGIN_ROOT}/")) {
      collectReferencedSupportPath(
        server.cwd.slice("${PLUGIN_ROOT}/".length),
        supportPaths
      );
    }
  }
  return [...supportPaths].toSorted(compareStrings);
}

async function parseStdioServer(
  name: string,
  raw: JsonRecord,
  pluginRoot: string,
  pluginRealRoot: string,
  supportPaths: Set<string>
): Promise<PortableMcpStdioServer> {
  rejectVariantFields(raw, STDIO_FIELDS, name, "stdio");
  const command = readRequiredString(raw, "command", name);
  rejectProviderPlaceholder(command, `${name}.command`);
  if (command.includes("${")) {
    throw new Error(
      `skillset: MCP server ${name}: placeholders are not allowed in command`
    );
  }
  if (!isBareCommand(command) && !isPortablePluginPath(command)) {
    throw new Error(
      `skillset: MCP server ${name} command must be a bare executable name or a contained ./ path`
    );
  }
  if (command.startsWith("./")) {
    assertStandardSupportPath(command.slice(2), `${name}.command`);
    await validatePluginFile(
      command,
      pluginRoot,
      pluginRealRoot,
      `${name}.command`
    );
    collectReferencedSupportPath(command.slice(2), supportPaths);
  }

  const args = readOptionalStringArray(raw, "args", name);
  for (const [index, arg] of (args ?? []).entries()) {
    validateExpandableString(arg, `${name}.args[${index}]`);
  }
  const env = readOptionalStringMap(raw, "env", name);
  for (const [key, value] of Object.entries(env ?? {})) {
    rejectAnyPlaceholder(key, `${name}.env key`);
    const normalizedKey = key.toUpperCase();
    if (normalizedKey === "PLUGIN_ROOT" || normalizedKey === "PLUGIN_DATA") {
      throw new Error(
        `skillset: MCP server ${name} env cannot override reserved variable ${normalizedKey}`
      );
    }
    validateExpandableString(value, `${name}.env.${key}`);
  }

  const cwd =
    raw.cwd === undefined ? undefined : readRequiredString(raw, "cwd", name);
  if (cwd !== undefined) {
    validateExpandableString(cwd, `${name}.cwd`);
    await validateCwd(name, cwd, pluginRoot, pluginRealRoot, supportPaths);
  }
  return {
    command,
    type: "stdio",
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function parseRemoteServer(
  name: string,
  raw: JsonRecord,
  type: PortableMcpRemoteServer["type"]
): PortableMcpRemoteServer {
  rejectVariantFields(raw, REMOTE_FIELDS, name, type);
  const url = readRequiredString(raw, "url", name);
  rejectAnyPlaceholder(url, `${name}.url`);
  validateRemoteUrl(name, url);
  const headers = readOptionalStringMap(raw, "headers", name);
  const seen = new Set<string>();
  for (const [header, value] of Object.entries(headers ?? {})) {
    const normalized = header.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(
        `skillset: MCP server ${name} has duplicate case-insensitive header ${header}`
      );
    }
    seen.add(normalized);
    if (!HTTP_HEADER_NAME.test(header)) {
      throw new Error(
        `skillset: MCP server ${name} has invalid HTTP header name ${JSON.stringify(header)}`
      );
    }
    if (
      [...value].some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 && code !== 9) || code === 127;
      })
    ) {
      throw new Error(
        `skillset: MCP server ${name} has invalid HTTP header value for ${header}`
      );
    }
    rejectAnyPlaceholder(header, `${name}.headers.${header}`);
    rejectAnyPlaceholder(value, `${name}.headers.${header}`);
    if (CLIENT_OWNED_HTTP_HEADERS.has(normalized)) {
      throw new Error(
        `skillset: MCP server ${name} cannot configure client-owned header ${header}`
      );
    }
  }
  return {
    type,
    url,
    ...(headers === undefined ? {} : { headers }),
  };
}

async function validateCwd(
  name: string,
  cwd: string,
  pluginRoot: string,
  pluginRealRoot: string,
  supportPaths: Set<string>
): Promise<void> {
  let relativePath: string | undefined;
  if (cwd === "./") {
    return;
  }
  if (cwd.startsWith("./")) {
    relativePath = cwd.slice(2);
  } else if (cwd === "${PLUGIN_ROOT}" || cwd === "${PLUGIN_ROOT}/") {
    return;
  } else if (cwd.startsWith("${PLUGIN_ROOT}/")) {
    relativePath = cwd.slice("${PLUGIN_ROOT}/".length);
  } else if (cwd === "${PLUGIN_DATA}" || cwd === "${PLUGIN_DATA}/") {
    return;
  } else if (cwd.startsWith("${PLUGIN_DATA}/")) {
    const dataPath = cwd.slice("${PLUGIN_DATA}/".length);
    if (!isContainedPortablePath(dataPath)) {
      throw new Error(`skillset: MCP server ${name} cwd escapes PLUGIN_DATA`);
    }
    return;
  } else {
    throw new Error(
      `skillset: MCP server ${name} cwd must be a contained ./, \${PLUGIN_ROOT}, or \${PLUGIN_DATA} path`
    );
  }
  if (!isContainedPortablePath(relativePath)) {
    throw new Error(`skillset: MCP server ${name} cwd escapes the plugin root`);
  }
  assertStandardSupportPath(relativePath, `${name}.cwd`);
  const source = resolve(pluginRoot, relativePath);
  let sourceStat;
  try {
    sourceStat = await stat(source);
  } catch {
    throw new Error(`skillset: MCP server ${name} cwd ${cwd} does not exist`);
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(
      `skillset: MCP server ${name} cwd ${cwd} must be a directory`
    );
  }
  await assertRealPathInside(source, pluginRealRoot, `${name}.cwd`);
  collectReferencedSupportPath(relativePath, supportPaths);
}

async function validatePluginFile(
  value: string,
  pluginRoot: string,
  pluginRealRoot: string,
  label: string
): Promise<void> {
  const relativePath = value.slice(2);
  if (!isContainedPortablePath(relativePath)) {
    throw new Error(`skillset: MCP server ${label} escapes the plugin root`);
  }
  const source = resolve(pluginRoot, relativePath);
  let sourceStat;
  try {
    sourceStat = await stat(source);
  } catch {
    throw new Error(`skillset: MCP server ${label} ${value} does not exist`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`skillset: MCP server ${label} ${value} must be a file`);
  }
  await assertRealPathInside(source, pluginRealRoot, label);
}

async function assertRealPathInside(
  source: string,
  pluginRealRoot: string,
  label: string
): Promise<void> {
  const actual = await realpath(source);
  const fromRoot = relative(pluginRealRoot, actual);
  if (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  ) {
    return;
  }
  throw new Error(
    `skillset: MCP server ${label} resolves outside the plugin root`
  );
}

function validateRemoteUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `skillset: MCP server ${name} URL must be absolute HTTP or HTTPS`
    );
  }
  if (
    value.trim() !== value ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname === ""
  ) {
    throw new Error(
      `skillset: MCP server ${name} URL must be absolute HTTP or HTTPS`
    );
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error(
      `skillset: MCP server ${name} URL must not contain user information or a fragment`
    );
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error(
      `skillset: MCP server ${name}: non-loopback MCP endpoints must use HTTPS`
    );
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replaceAll(/^\[|\]$/gu, "");
  if (host === "localhost" || host === "::1") {
    return true;
  }
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet))
  );
}

function validateExpandableString(value: string, label: string): void {
  rejectProviderPlaceholder(value, label);
  rejectUnbracedPortablePlaceholder(value, label);
  const remainder = value
    .replaceAll("${PLUGIN_ROOT}", "")
    .replaceAll("${PLUGIN_DATA}", "");
  const unsupported = /\$\{([^}]*)\}/u.exec(remainder);
  if (unsupported !== null) {
    throw new Error(
      `skillset: MCP ${label} uses unsupported placeholder \${${unsupported[1]}}; use \${PLUGIN_ROOT} or \${PLUGIN_DATA}`
    );
  }
  if (remainder.includes("${")) {
    throw new Error(
      `skillset: MCP ${label} contains an unterminated placeholder`
    );
  }
}

function rejectProviderPlaceholder(value: string, label: string): void {
  for (const [providerName, portableName] of Object.entries(
    PROVIDER_PLACEHOLDERS
  )) {
    const braced = `\${${providerName}}`;
    const unbraced = `$${providerName}`;
    if (value.includes(braced) || value.includes(unbraced)) {
      throw new Error(
        `skillset: MCP ${label}: use \${${portableName}} instead of ${value.includes(braced) ? braced : unbraced}`
      );
    }
  }
}

function rejectAnyPlaceholder(value: string, label: string): void {
  rejectProviderPlaceholder(value, label);
  rejectUnbracedPortablePlaceholder(value, label);
  if (value.includes("${")) {
    throw new Error(`skillset: MCP ${label} cannot contain placeholders`);
  }
}

function rejectUnbracedPortablePlaceholder(value: string, label: string): void {
  const match = /\$(PLUGIN_ROOT|PLUGIN_DATA)\b/u.exec(value);
  if (match?.[1] !== undefined) {
    throw new Error(
      `skillset: MCP ${label}: use \${${match[1]}} instead of $${match[1]}`
    );
  }
}

function isBareCommand(command: string): boolean {
  return (
    command !== "" &&
    !command.includes("/") &&
    !command.includes("\\") &&
    !/\s/u.test(command)
  );
}

function isPortablePluginPath(value: string): boolean {
  return value.startsWith("./") && isContainedPortablePath(value.slice(2));
}

function isContainedPortablePath(value: string): boolean {
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value === "" ||
    posix.isAbsolute(value)
  ) {
    return false;
  }
  const normalized = posix.normalize(value);
  return (
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    normalized === value.replace(/\/$/u, "")
  );
}

function assertStandardSupportPath(value: string, label: string): void {
  const [root] = posix.normalize(value).split("/");
  if (root !== undefined && STANDARD_SUPPORT_ROOTS.has(root)) {
    return;
  }
  throw new Error(
    `skillset: MCP server ${label} must reference assets/, bin/, scripts/, or src/`
  );
}

function collectReferencedSupportPath(
  value: string,
  supportPaths: Set<string>
): void {
  if (posix.normalize(value).split("/")[0] === "bin") {
    supportPaths.add("bin");
  }
}

function rejectVariantFields(
  raw: JsonRecord,
  allowed: ReadonlySet<string>,
  name: string,
  type: string
): void {
  const wrong = Object.keys(raw)
    .filter((field) => !allowed.has(field))
    .toSorted(compareStrings);
  if (wrong.length > 0) {
    throw new Error(
      `skillset: MCP server ${name} ${type} entry cannot contain ${wrong.join(", ")}`
    );
  }
}

function rejectUnknownFields(
  raw: JsonRecord,
  allowed: ReadonlySet<string>,
  label: string,
  kind: "root"
): void {
  const [unknown] = Object.keys(raw)
    .filter((field) => !allowed.has(field))
    .toSorted(compareStrings);
  if (unknown !== undefined) {
    throw new Error(`skillset: ${label} has unknown ${kind} field ${unknown}`);
  }
}

function readRequiredString(
  raw: JsonRecord,
  field: string,
  name: string
): string {
  const value = raw[field];
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `skillset: MCP server ${name}.${field} must be a non-empty string`
    );
  }
  return value;
}

function readOptionalString(
  raw: JsonRecord,
  field: string,
  name: string
): string | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `skillset: MCP server ${name}.${field} must be a non-empty string`
    );
  }
  return value;
}

function readOptionalStringArray(
  raw: JsonRecord,
  field: string,
  name: string
): readonly string[] | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      `skillset: MCP server ${name}.${field} must be an array of strings`
    );
  }
  return value as readonly string[];
}

function readOptionalStringMap(
  raw: JsonRecord,
  field: string,
  name: string
): Readonly<Record<string, string>> | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (
    !isJsonRecord(value) ||
    Object.values(value).some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      `skillset: MCP server ${name}.${field} must be an object of strings`
    );
  }
  return value as Readonly<Record<string, string>>;
}

function renderPortableServer(server: PortableMcpServer): JsonRecord {
  if (server.type === "stdio") {
    return {
      command: server.command,
      type: server.type,
      ...(server.args === undefined ? {} : { args: [...server.args] }),
      ...(server.env === undefined ? {} : { env: { ...server.env } }),
      ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    };
  }
  return {
    type: server.type,
    url: server.url,
    ...(server.headers === undefined ? {} : { headers: { ...server.headers } }),
  };
}

function renderProviderServer(
  server: PortableMcpServer,
  target: TargetName
): JsonRecord {
  const evidence = PORTABLE_MCP_PROVIDER_EVIDENCE[target];
  if (server.type === "stdio") {
    return {
      ...(evidence.stdioType === null ? {} : { type: evidence.stdioType }),
      command: server.command,
      ...(server.args === undefined
        ? {}
        : {
            args: server.args.map((arg) =>
              renderProviderPlaceholders(
                arg,
                evidence.rootPlaceholder,
                evidence.dataPlaceholder
              )
            ),
          }),
      ...(server.env === undefined
        ? {}
        : {
            env: Object.fromEntries(
              Object.entries(server.env).map(([key, value]) => [
                key,
                renderProviderPlaceholders(
                  value,
                  evidence.rootPlaceholder,
                  evidence.dataPlaceholder
                ),
              ])
            ),
          }),
      ...(server.cwd === undefined || !evidence.stdioCwd
        ? {}
        : {
            cwd: renderProviderPlaceholders(
              server.cwd,
              evidence.rootPlaceholder,
              evidence.dataPlaceholder
            ),
          }),
    };
  }
  const type =
    server.type === "streamable-http"
      ? evidence.streamableHttpType
      : evidence.sseType;
  return {
    ...(type === null ? {} : { type }),
    url: server.url,
    ...(server.headers === undefined
      ? {}
      : { [evidence.remoteHeadersField]: { ...server.headers } }),
  };
}

function renderProviderPlaceholders(
  value: string,
  root: string,
  data: string | null
): string {
  const rendered = value.replaceAll("${PLUGIN_ROOT}", `\${${root}}`);
  if (data !== null) {
    return rendered.replaceAll("${PLUGIN_DATA}", `\${${data}}`);
  }
  if (rendered.includes("${PLUGIN_DATA}")) {
    throw new Error(
      "skillset: provider MCP rendering received an uncovered PLUGIN_DATA placeholder"
    );
  }
  return rendered;
}

function sortedServerRecord<T extends JsonValue>(
  servers: Readonly<Record<string, PortableMcpServer>>,
  render: (server: PortableMcpServer, name: string) => T
): Record<string, T> {
  return Object.fromEntries(
    Object.keys(servers)
      .toSorted(compareStrings)
      .map((name) => [name, render(servers[name] as PortableMcpServer, name)])
  );
}

function classifyProviderUnsupported(
  servers: Readonly<Record<string, PortableMcpServer>>
): readonly PortableMcpProviderUnsupported[] {
  const unsupported: PortableMcpProviderUnsupported[] = [];
  for (const name of Object.keys(servers).toSorted(compareStrings)) {
    const server = servers[name] as PortableMcpServer;
    for (const target of targetNames()) {
      const evidence = PORTABLE_MCP_PROVIDER_EVIDENCE[target];
      if (
        server.type === "stdio" &&
        server.cwd !== undefined &&
        !evidence.stdioCwd
      ) {
        unsupported.push({
          evidence,
          name,
          raw: renderPortableServer(server),
          reason: `${evidence.providerName} native MCP has no documented stdio cwd rendering`,
          target,
        });
        continue;
      }
      if (server.type === "sse" && evidence.sseType === null) {
        unsupported.push({
          evidence,
          name,
          raw: renderPortableServer(server),
          reason: `${evidence.providerName} ${evidence.providerVersion} reports Agent Plugins SSE as unsupported`,
          target,
        });
      }
      if (
        server.type === "stdio" &&
        evidence.dataPlaceholder === null &&
        stdioUsesPlaceholder(server, "PLUGIN_DATA")
      ) {
        unsupported.push({
          evidence,
          name,
          raw: renderPortableServer(server),
          reason: `${evidence.providerName} native MCP has no documented persistent plugin-data placeholder rendering`,
          target,
        });
      }
    }
  }
  return unsupported;
}

function providerCredentialPlaceholderFields(
  raw: JsonRecord,
  name: string
): readonly string[] {
  const headers = readOptionalStringMap(raw, "headers", name);
  if (
    headers !== undefined &&
    Object.values(headers).some((value) =>
      [...value.matchAll(/\$\{([^}]+)\}/gu)].some((match) => {
        const placeholder = match[1];
        return (
          placeholder !== undefined &&
          placeholder !== "PLUGIN_ROOT" &&
          placeholder !== "PLUGIN_DATA" &&
          PROVIDER_PLACEHOLDERS[placeholder] === undefined
        );
      })
    )
  ) {
    return ["headers"];
  }
  return [];
}

function stdioUsesPlaceholder(
  server: PortableMcpStdioServer,
  name: "PLUGIN_DATA" | "PLUGIN_ROOT"
): boolean {
  const placeholder = `\${${name}}`;
  return (
    (server.cwd?.includes(placeholder) ?? false) ||
    (server.args ?? []).some((value) => value.includes(placeholder)) ||
    Object.values(server.env ?? {}).some((value) => value.includes(placeholder))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
