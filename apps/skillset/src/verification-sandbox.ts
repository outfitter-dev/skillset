import { lstat, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const TEST_SANDBOX_ENV = "SKILLSET_TEST_SANDBOX";
export const TEST_SANDBOX_RETAIN_ENV = "SKILLSET_TEST_SANDBOX_RETAIN";
export const SUPPRESS_WORKSPACE_REGISTRATION_ENV =
  "SKILLSET_INTERNAL_SUPPRESS_WORKSPACE_REGISTRATION";
export const TEST_SANDBOX_SCHEMA_VERSION = 1;
export const TEST_SANDBOX_RUNNER = "bun run test:sandbox -- <command>";

export interface TestSandboxDescriptor {
  readonly createdAt: string;
  readonly invocationId: string;
  readonly repoRoot: string;
  readonly sandboxPath: string;
  readonly schemaVersion: 1;
}

export interface ValidatedTestSandbox {
  readonly descriptor: TestSandboxDescriptor;
  readonly descriptorPath: string;
  readonly xdg: {
    readonly cache: string;
    readonly config: string;
    readonly data: string;
    readonly state: string;
  };
}

export type WorkspaceRegistrationPolicy = "isolated" | "normal" | "suppressed";

const XDG_ENV = {
  cache: "XDG_CACHE_HOME",
  config: "XDG_CONFIG_HOME",
  data: "XDG_DATA_HOME",
  state: "XDG_STATE_HOME",
} as const;

export async function resolveWorkspaceRegistrationPolicy(
  env: Record<string, string | undefined> = process.env
): Promise<WorkspaceRegistrationPolicy> {
  const marker = env[TEST_SANDBOX_ENV]?.trim();
  if (marker) {
    await validateTestSandbox(env);
    if (env[SUPPRESS_WORKSPACE_REGISTRATION_ENV] === "1") return "suppressed";
    return "isolated";
  }
  if (env[SUPPRESS_WORKSPACE_REGISTRATION_ENV] === "1") return "suppressed";
  if (env.NODE_ENV === "test") {
    throw new Error(
      `refusing to update the known Skillsets index: NODE_ENV=test requires the canonical repository verification runner (${TEST_SANDBOX_RUNNER})`
    );
  }
  return "normal";
}

export async function validateTestSandbox(
  env: Record<string, string | undefined> = process.env,
  expectedRepoRoot?: string
): Promise<ValidatedTestSandbox> {
  const marker = env[TEST_SANDBOX_ENV]?.trim();
  if (!marker) throw new Error(`${TEST_SANDBOX_ENV} is not set`);
  if (!isAbsolute(marker))
    throw new Error(`${TEST_SANDBOX_ENV} must be an absolute path`);

  const markerStat = await lstat(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error(`${TEST_SANDBOX_ENV} must name a regular descriptor file`);
  }
  const descriptorPath = await realpath(marker);
  const raw = await Bun.file(descriptorPath)
    .json()
    .catch((error: unknown) => {
      throw new Error(`invalid ${TEST_SANDBOX_ENV} descriptor JSON`, {
        cause: error,
      });
    });
  const descriptor = parseDescriptor(raw);

  const sandboxStat = await lstat(descriptor.sandboxPath);
  if (!sandboxStat.isDirectory() || sandboxStat.isSymbolicLink()) {
    throw new Error("test sandbox must be a real directory");
  }
  const sandboxPath = await realpath(descriptor.sandboxPath);
  if (sandboxPath !== descriptor.sandboxPath) {
    throw new Error("test sandbox path must be canonical");
  }

  const tempRoot = await realpath(tmpdir());
  if (!isInside(tempRoot, sandboxPath)) {
    throw new Error(
      "test sandbox must be inside the canonical OS temporary directory"
    );
  }
  if (
    !basename(sandboxPath).startsWith("skillset-test-") ||
    dirname(descriptorPath) !== sandboxPath ||
    basename(descriptorPath) !== "descriptor.json"
  ) {
    throw new Error(
      "test sandbox descriptor does not identify an owned sandbox"
    );
  }
  if (await hasGitAncestor(sandboxPath, tempRoot)) {
    throw new Error("test sandbox must not be a Git worktree or live inside one");
  }

  const repoRoot = await realpath(descriptor.repoRoot);
  if (repoRoot !== descriptor.repoRoot)
    throw new Error("descriptor repoRoot must be canonical");
  if (
    expectedRepoRoot !== undefined &&
    repoRoot !== (await realpath(expectedRepoRoot))
  ) {
    throw new Error("test sandbox belongs to a different repository root");
  }

  const home = resolve(env.HOME ?? homedir());
  const canonicalHome = await realpath(home).catch(() => home);
  if (
    pathsOverlap(sandboxPath, repoRoot) ||
    pathsOverlap(sandboxPath, canonicalHome)
  ) {
    throw new Error("test sandbox overlaps a repository or HOME directory");
  }

  const xdg = {
    cache: await validateXdgRoot(env, "cache", sandboxPath),
    config: await validateXdgRoot(env, "config", sandboxPath),
    data: await validateXdgRoot(env, "data", sandboxPath),
    state: await validateXdgRoot(env, "state", sandboxPath),
  };
  return { descriptor, descriptorPath, xdg };
}

export function testSandboxXdg(sandboxPath: string) {
  const root = resolve(sandboxPath, "xdg");
  return {
    cache: resolve(root, "cache"),
    config: resolve(root, "config"),
    data: resolve(root, "data"),
    state: resolve(root, "state"),
  };
}

function parseDescriptor(value: unknown): TestSandboxDescriptor {
  if (typeof value !== "object" || value === null)
    throw new Error("test sandbox descriptor must be an object");
  const descriptor = value as Record<string, unknown>;
  const keys = Object.keys(descriptor).sort();
  const expectedKeys = [
    "createdAt",
    "invocationId",
    "repoRoot",
    "sandboxPath",
    "schemaVersion",
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("test sandbox descriptor has unknown or missing fields");
  }
  if (descriptor.schemaVersion !== TEST_SANDBOX_SCHEMA_VERSION) {
    throw new Error(
      `unsupported test sandbox descriptor schemaVersion: ${String(descriptor.schemaVersion)}`
    );
  }
  for (const key of [
    "createdAt",
    "invocationId",
    "repoRoot",
    "sandboxPath",
  ] as const) {
    if (typeof descriptor[key] !== "string" || descriptor[key].length === 0) {
      throw new Error(
        `test sandbox descriptor ${key} must be a non-empty string`
      );
    }
  }
  if (
    !isAbsolute(descriptor.repoRoot as string) ||
    !isAbsolute(descriptor.sandboxPath as string)
  ) {
    throw new Error("test sandbox descriptor paths must be absolute");
  }
  const createdAt = descriptor.createdAt as string;
  if (
    Number.isNaN(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  ) {
    throw new Error(
      "test sandbox descriptor createdAt must be an ISO timestamp"
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      descriptor.invocationId as string
    )
  ) {
    throw new Error("test sandbox descriptor invocationId must be a UUID");
  }
  return descriptor as unknown as TestSandboxDescriptor;
}

async function validateXdgRoot(
  env: Record<string, string | undefined>,
  kind: keyof typeof XDG_ENV,
  sandboxPath: string
): Promise<string> {
  const name = XDG_ENV[kind];
  const value = env[name];
  if (!value || !isAbsolute(value))
    throw new Error(`${name} must be an absolute path`);
  const canonical = await realpath(value).catch((error: unknown) => {
    throw new Error(`${name} must name an existing sandbox directory`, {
      cause: error,
    });
  });
  const expected = resolve(sandboxPath, "xdg", kind);
  if (canonical !== expected || !isInside(sandboxPath, canonical)) {
    throw new Error(`${name} does not match the owned test sandbox`);
  }
  return canonical;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

async function hasGitAncestor(
  sandboxPath: string,
  tempRoot: string
): Promise<boolean> {
  let current = sandboxPath;
  while (current !== tempRoot) {
    try {
      await lstat(resolve(current, ".git"));
      return true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    current = dirname(current);
  }
  return false;
}

function pathsOverlap(first: string, second: string): boolean {
  return first === second || isInside(first, second) || isInside(second, first);
}
