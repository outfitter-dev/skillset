import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/**
 * Least-privilege environment for external Codex, skills, npm, and uv
 * validation probes.
 *
 * Children receive isolated HOME, temporary, XDG, Codex, Claude, and Cursor
 * roots. Only the host's executable path, proxy, CA, locale, and platform variables pass through
 * the documented allowlist. Credentialed paths must name the exact variables
 * they need; missing required credentials fail before the child starts.
 */

export const PROVIDER_PROBE_PASSTHROUGH = {
  path: ["PATH"] as const,
  proxy: [
    "ALL_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "all_proxy",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ] as const,
  ca: [
    "CURL_CA_BUNDLE",
    "GIT_SSL_CAINFO",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
  ] as const,
  locale: ["LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES"] as const,
  platform: [
    "ComSpec",
    "LOGNAME",
    "OS",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_ARCHITEW6432",
    "SYSTEMROOT",
    "SystemRoot",
    "TERM",
    "TZ",
    "USER",
    "USERNAME",
    "WINDIR",
  ] as const,
} as const;

export const PROVIDER_PROBE_PASSTHROUGH_VARIABLES = [
  ...PROVIDER_PROBE_PASSTHROUGH.path,
  ...PROVIDER_PROBE_PASSTHROUGH.proxy,
  ...PROVIDER_PROBE_PASSTHROUGH.ca,
  ...PROVIDER_PROBE_PASSTHROUGH.locale,
  ...PROVIDER_PROBE_PASSTHROUGH.platform,
] as const;

export const PROVIDER_PROBE_ISOLATION_VARIABLES = [
  "APPDATA",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "CURSOR_CONFIG_DIR",
  "HOME",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
] as const;

export const PROVIDER_PROBE_NPM_VARIABLES = [
  "DO_NOT_TRACK",
  "npm_config_cache",
  "npm_config_globalconfig",
  "npm_config_prefix",
  "npm_config_userconfig",
] as const;

export const PROVIDER_PROBE_UV_VARIABLES = [
  "DO_NOT_TRACK",
  "UV_CACHE_DIR",
  "UV_NO_CONFIG",
] as const;

export const PROVIDER_PROBE_PIP_VARIABLES = [
  "PIP_CACHE_DIR",
  "PIP_CONFIG_FILE",
] as const;

const CREDENTIAL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export interface ProviderProbeRoots {
  readonly claudeConfig: string;
  readonly codexHome: string;
  readonly cursorConfig: string;
  readonly environmentRoot: string;
  readonly home: string;
  readonly tmp: string;
  readonly xdgCache: string;
  readonly xdgConfig: string;
  readonly xdgData: string;
  readonly xdgState: string;
}

export interface ProviderProbeCredentials {
  readonly optional?: readonly string[];
  readonly required?: readonly string[];
}

export interface ProviderProbeAdapters {
  readonly npm?: boolean;
  readonly pip?: boolean;
  readonly uv?: boolean;
}

export interface CreateProviderProbeEnvironmentOptions {
  readonly adapters?: ProviderProbeAdapters;
  readonly createDirectories?: boolean;
  readonly credentials?: ProviderProbeCredentials;
  readonly extras?: Readonly<Record<string, string>>;
  readonly platform?: NodeJS.Platform;
  readonly root: string;
  readonly source?: Readonly<Record<string, string | undefined>>;
}

export interface ProviderProbeEnvironment {
  readonly env: Readonly<Record<string, string>>;
  readonly roots: ProviderProbeRoots;
}

export function providerProbeRoots(root: string): ProviderProbeRoots {
  assertAbsoluteRoot(root);
  const xdgConfig = join(root, "config");
  const xdgData = join(root, "data");
  return {
    claudeConfig: join(xdgConfig, "claude"),
    codexHome: join(xdgConfig, "codex"),
    cursorConfig: join(xdgConfig, "cursor"),
    environmentRoot: root,
    home: join(root, "home"),
    tmp: join(root, "tmp"),
    xdgCache: join(root, "cache"),
    xdgConfig,
    xdgData,
    xdgState: join(root, "state"),
  };
}

export function isProviderProbePassthroughVariable(
  name: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform === "win32" && name.toUpperCase() === "PATH") return true;
  return (PROVIDER_PROBE_PASSTHROUGH_VARIABLES as readonly string[]).includes(
    name
  );
}

export function isProviderProbeIsolationVariable(
  name: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return PROVIDER_PROBE_ISOLATION_VARIABLES.some(
    (variable) =>
      environmentNameKey(variable, platform) ===
      environmentNameKey(name, platform)
  );
}

export async function createProviderProbeEnvironment(
  options: CreateProviderProbeEnvironmentOptions
): Promise<ProviderProbeEnvironment> {
  const normalized = normalizeOptions(options);
  const roots = providerProbeRoots(normalized.root);
  const reserved = reservedNames(normalized.adapters, normalized.platform);
  const credentials = collectCredentials(
    normalized.credentials,
    normalized.source,
    new Set([
      ...reserved,
      ...PROVIDER_PROBE_PASSTHROUGH_VARIABLES.map((name) =>
        environmentNameKey(name, normalized.platform)
      ),
    ]),
    normalized.platform
  );
  const directories = [
    roots.claudeConfig,
    roots.codexHome,
    roots.cursorConfig,
    roots.home,
    roots.tmp,
    roots.xdgCache,
    roots.xdgConfig,
    roots.xdgData,
    roots.xdgState,
  ];
  const env: Record<string, string> = {};

  const pathEntry = Object.entries(normalized.source).find(
    ([name, value]) =>
      (normalized.platform === "win32"
        ? name.toUpperCase() === "PATH"
        : name === "PATH") &&
      value !== undefined &&
      value !== ""
  );
  if (pathEntry) env[pathEntry[0]] = pathEntry[1] as string;
  for (const name of PROVIDER_PROBE_PASSTHROUGH_VARIABLES) {
    if (name === "PATH") continue;
    const value = normalized.source[name];
    if (value !== undefined && value !== "") env[name] = value;
  }
  for (const [name, value] of Object.entries(normalized.extras)) {
    if (reserved.has(environmentNameKey(name, normalized.platform))) continue;
    if (normalized.platform === "win32") {
      const existing = Object.keys(env).find(
        (key) => environmentNameKey(key, normalized.platform) === environmentNameKey(name, normalized.platform)
      );
      if (existing) delete env[existing];
    }
    env[name] = value;
  }

  env.APPDATA = roots.xdgConfig;
  env.CLAUDE_CONFIG_DIR = roots.claudeConfig;
  env.CODEX_HOME = roots.codexHome;
  env.CURSOR_CONFIG_DIR = roots.cursorConfig;
  env.HOME = roots.home;
  env.LOCALAPPDATA = roots.xdgData;
  env.TEMP = roots.tmp;
  env.TMP = roots.tmp;
  env.TMPDIR = roots.tmp;
  env.USERPROFILE = roots.home;
  env.XDG_CACHE_HOME = roots.xdgCache;
  env.XDG_CONFIG_HOME = roots.xdgConfig;
  env.XDG_DATA_HOME = roots.xdgData;
  env.XDG_STATE_HOME = roots.xdgState;

  if (normalized.adapters.npm) {
    const npmCache = join(roots.xdgCache, "npm");
    const npmPrefix = join(roots.environmentRoot, "npm-prefix");
    env.DO_NOT_TRACK = "1";
    env.npm_config_cache = npmCache;
    env.npm_config_globalconfig = nullDevice(normalized.platform);
    env.npm_config_prefix = npmPrefix;
    env.npm_config_userconfig = join(roots.xdgConfig, "npmrc");
    directories.push(npmCache, npmPrefix);
  }
  if (normalized.adapters.uv) {
    const uvCache = join(roots.xdgCache, "uv");
    env.DO_NOT_TRACK = "1";
    env.UV_CACHE_DIR = uvCache;
    env.UV_NO_CONFIG = "1";
    directories.push(uvCache);
  }
  if (normalized.adapters.pip) {
    const pipCache = join(roots.xdgCache, "pip");
    env.PIP_CACHE_DIR = pipCache;
    env.PIP_CONFIG_FILE = nullDevice(normalized.platform);
    directories.push(pipCache);
  }

  Object.assign(env, credentials);

  if (normalized.createDirectories) {
    await Promise.all(
      directories.map((path) => mkdir(path, { recursive: true }))
    );
  }

  return { env, roots };
}

function normalizeOptions(options: CreateProviderProbeEnvironmentOptions): {
  readonly adapters: Required<ProviderProbeAdapters>;
  readonly createDirectories: boolean;
  readonly credentials: ProviderProbeCredentials;
  readonly extras: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
  readonly root: string;
  readonly source: Readonly<Record<string, string | undefined>>;
} {
  if (typeof options !== "object" || options === null) {
    throw new Error(
      "skillset: provider probe environment requires an options object"
    );
  }
  assertAbsoluteRoot(options.root);
  if (
    options.source !== undefined &&
    (typeof options.source !== "object" || options.source === null)
  ) {
    throw new Error(
      "skillset: provider probe environment source must be an object"
    );
  }
  if (
    options.extras !== undefined &&
    (typeof options.extras !== "object" || options.extras === null)
  ) {
    throw new Error(
      "skillset: provider probe environment extras must be an object"
    );
  }
  if (
    options.credentials !== undefined &&
    (typeof options.credentials !== "object" || options.credentials === null)
  ) {
    throw new Error(
      "skillset: provider probe credentials must be an object"
    );
  }
  if (
    options.adapters !== undefined &&
    (typeof options.adapters !== "object" || options.adapters === null)
  ) {
    throw new Error("skillset: provider probe adapters must be an object");
  }
  const extras = options.extras ?? {};
  for (const [name, value] of Object.entries(extras)) {
    assertEnvironmentName(name, "extra");
    if (typeof value !== "string") {
      throw new Error(
        `skillset: provider probe extra ${name} must be a string`
      );
    }
  }
  return {
    adapters: {
      npm: options.adapters?.npm === true,
      pip: options.adapters?.pip === true,
      uv: options.adapters?.uv === true,
    },
    createDirectories: options.createDirectories !== false,
    credentials: options.credentials ?? {},
    extras,
    platform: options.platform ?? process.platform,
    root: options.root,
    source: options.source ?? process.env,
  };
}

function collectCredentials(
  credentials: ProviderProbeCredentials,
  source: Readonly<Record<string, string | undefined>>,
  reserved: ReadonlySet<string>,
  platform: NodeJS.Platform
): Record<string, string> {
  const required = credentials.required ?? [];
  const optional = credentials.optional ?? [];
  const selected: Record<string, string> = {};
  const seen = new Set<string>();

  for (const name of [...required, ...optional]) {
    assertEnvironmentName(name, "credential");
    const key = environmentNameKey(name, platform);
    if (reserved.has(key)) {
      throw new Error(
        `skillset: provider probe credential ${name} overlaps the isolation or allowlist contract`
      );
    }
    if (seen.has(key)) {
      throw new Error(
        `skillset: provider probe credential ${name} is declared more than once`
      );
    }
    seen.add(key);
  }

  for (const name of required) {
    const value = source[name];
    if (value === undefined || value === "") {
      throw new Error(
        `skillset: provider probe requires credential ${name}`
      );
    }
    selected[name] = value;
  }
  for (const name of optional) {
    const value = source[name];
    if (value !== undefined && value !== "") selected[name] = value;
  }
  return selected;
}

function reservedNames(
  adapters: Required<ProviderProbeAdapters>,
  platform: NodeJS.Platform
): Set<string> {
  const names = new Set<string>(
    PROVIDER_PROBE_ISOLATION_VARIABLES.map((name) =>
      environmentNameKey(name, platform)
    )
  );
  if (adapters.npm) {
    for (const name of PROVIDER_PROBE_NPM_VARIABLES)
      names.add(environmentNameKey(name, platform));
  }
  if (adapters.uv) {
    for (const name of PROVIDER_PROBE_UV_VARIABLES)
      names.add(environmentNameKey(name, platform));
  }
  if (adapters.pip) {
    for (const name of PROVIDER_PROBE_PIP_VARIABLES)
      names.add(environmentNameKey(name, platform));
  }
  return names;
}

function environmentNameKey(name: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? name.toUpperCase() : name;
}

function nullDevice(platform: NodeJS.Platform): string {
  return platform === "win32" ? "NUL" : "/dev/null";
}

function assertAbsoluteRoot(root: string): void {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
    throw new Error(
      "skillset: provider probe environment root must be an absolute path"
    );
  }
}

function assertEnvironmentName(name: string, kind: "credential" | "extra"): void {
  if (!CREDENTIAL_NAME.test(name)) {
    throw new Error(`skillset: provider probe ${kind} name is invalid: ${name}`);
  }
}
