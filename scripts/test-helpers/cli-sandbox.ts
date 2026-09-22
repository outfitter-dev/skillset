import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import {
  TEST_SANDBOX_ENV,
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxGit,
  testSandboxXdg,
  validateTestSandbox,
  type ValidatedTestSandbox,
} from "../../apps/skillset/src/verification-sandbox";

export interface OwnedCliTestEnvironment {
  readonly env: Record<string, string>;
  readonly git: ValidatedTestSandbox["git"];
  readonly home: string;
  readonly provider: {
    readonly claude: string;
    readonly codex: string;
    readonly cursor: string;
  };
  readonly sandbox: ValidatedTestSandbox;
  readonly tmp: string;
  readonly xdg: ValidatedTestSandbox["xdg"];
}

export interface OwnedCliTestEnvironmentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isolate?: boolean;
}

export interface FixedSharedTestStateRoot {
  readonly file: string;
  readonly kind: "join-tmpdir" | "literal-xdg";
  readonly line: number;
  readonly text: string;
}

export interface FixedSharedTestStateRootAllowance {
  readonly file: string;
  readonly prefix: string;
  readonly reason: string;
}

/**
 * Remaining CLI spawn files left for SET-629 (central spawn target) and
 * SET-625 (behavior vs real-spawn classification). SET-650 only migrates the
 * marketplace runner that used a fixed shared XDG root.
 */
export const RECORDED_CLI_TEST_RUNNER_SITES = [
  "apps/skillset/src/__tests__/ad-hoc-test.test.ts",
  "apps/skillset/src/__tests__/adopt.test.ts",
  "apps/skillset/src/__tests__/change-ignore.test.ts",
  "apps/skillset/src/__tests__/change-refresh.test.ts",
  "apps/skillset/src/__tests__/change-scope-history.test.ts",
  "apps/skillset/src/__tests__/ci.test.ts",
  "apps/skillset/src/__tests__/cli-output.test.ts",
  "apps/skillset/src/__tests__/cli-version.test.ts",
  "apps/skillset/src/__tests__/contract.test.ts",
  "apps/skillset/src/__tests__/dev-watch.test.ts",
  "apps/skillset/src/__tests__/eval-cli.test.ts",
  "apps/skillset/src/__tests__/finite-read-json.test.ts",
  "apps/skillset/src/__tests__/interactive-cli-pty.test.ts",
  "apps/skillset/src/__tests__/isolated-build.test.ts",
  "apps/skillset/src/__tests__/known-skillsets-cli.test.ts",
  "apps/skillset/src/__tests__/lookup-cli.test.ts",
  "apps/skillset/src/__tests__/lookup-pty.test.ts",
  "apps/skillset/src/__tests__/marketplace-check-cli.test.ts",
  "apps/skillset/src/__tests__/marketplace-pty.test.ts",
  "apps/skillset/src/__tests__/new-interactive.test.ts",
  "apps/skillset/src/__tests__/new-source.test.ts",
  "apps/skillset/src/__tests__/operation-receipt.test.ts",
  "apps/skillset/src/__tests__/plugin-adoption.test.ts",
  "apps/skillset/src/__tests__/project-use-status.test.ts",
  "apps/skillset/src/__tests__/provider-format-updates.test.ts",
  "apps/skillset/src/__tests__/reconcile-pty.test.ts",
  "apps/skillset/src/__tests__/report-cli.test.ts",
  "apps/skillset/src/__tests__/resolve.test.ts",
  "apps/skillset/src/__tests__/runtime-hooks.test.ts",
  "apps/skillset/src/__tests__/skillset.test.ts",
  "apps/skillset/src/__tests__/standard-profile-bundle.test.ts",
  "apps/skillset/src/__tests__/test-interactive.test.ts",
] as const;

/**
 * Remaining hand-built sandbox descriptor sites left for SET-629 / SET-625.
 * `scripts/test-sandbox.ts` remains the canonical producer; the validator is
 * not a construction site.
 */
export const RECORDED_SANDBOX_DESCRIPTOR_SITES = [
  "apps/skillset/src/__tests__/interactive-cli-pty.test.ts",
  "apps/skillset/src/__tests__/known-skillsets-cli.test.ts",
  "apps/skillset/src/__tests__/report-export-request.test.ts",
  "apps/skillset/src/__tests__/report-parent-export.test.ts",
  "apps/skillset/src/__tests__/verification-sandbox.test.ts",
  "scripts/__tests__/test-sandbox-runner.test.ts",
  "scripts/fixtures/__tests__/external.test.ts",
] as const;

export const FIXED_SHARED_TEST_STATE_ROOT_ALLOWLIST: readonly FixedSharedTestStateRootAllowance[] =
  [
    {
      file: "apps/skillset/src/__tests__/interactive-cli-pty.test.ts",
      prefix: "/tmp/skillset-test-owned/",
      reason:
        "unit-test expected values for inherited PTY environment composition",
    },
  ];

const JOIN_TMPDIR_PATTERN =
  /(?<wrapper>\bmkdtemp\s*\(\s*)?join\(\s*tmpdir\(\)\s*,\s*(["'`])(?<literal>[^"'`]+)\2\s*\)/gu;
const LITERAL_XDG_PATTERN =
  /\b(?:XDG_(?:CACHE|CONFIG|DATA|STATE)_HOME|TMPDIR|\bTMP\b|\bTEMP\b|CLAUDE_CONFIG_DIR|CODEX_HOME|CURSOR_CONFIG_DIR)\s*:\s*(["'`])(?<literal>\/tmp\/skillset-[^"'`]+)\1/gu;

export async function createOwnedCliTestEnvironment(
  options: OwnedCliTestEnvironmentOptions = {}
): Promise<OwnedCliTestEnvironment> {
  const sandbox = options.isolate
    ? await materializeNestedSandbox()
    : await validateTestSandbox();
  const owned = await ownedRoots(sandbox);
  const merged: Record<string, string | undefined> = {
    ...gitSafeEnv(process.env),
    CLAUDE_CONFIG_DIR: owned.provider.claude,
    CODEX_HOME: owned.provider.codex,
    CURSOR_CONFIG_DIR: owned.provider.cursor,
    GIT_CONFIG_GLOBAL: sandbox.git.global,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: sandbox.git.system,
    GIT_TERMINAL_PROMPT: "0",
    HOME: owned.home,
    NODE_ENV: "test",
    TEMP: owned.tmp,
    TMP: owned.tmp,
    TMPDIR: owned.tmp,
    [TEST_SANDBOX_ENV]: sandbox.descriptorPath,
    XDG_CACHE_HOME: sandbox.xdg.cache,
    XDG_CONFIG_HOME: sandbox.xdg.config,
    XDG_DATA_HOME: sandbox.xdg.data,
    XDG_STATE_HOME: sandbox.xdg.state,
    ...options.env,
  };
  const env = gitSafeEnv(merged);
  env.CLAUDE_CONFIG_DIR = requireOwnedPath(
    env.CLAUDE_CONFIG_DIR,
    sandbox.descriptor.sandboxPath,
    "CLAUDE_CONFIG_DIR"
  );
  env.CODEX_HOME = requireOwnedPath(
    env.CODEX_HOME,
    sandbox.descriptor.sandboxPath,
    "CODEX_HOME"
  );
  env.CURSOR_CONFIG_DIR = requireOwnedPath(
    env.CURSOR_CONFIG_DIR,
    sandbox.descriptor.sandboxPath,
    "CURSOR_CONFIG_DIR"
  );
  env.TEMP = requireOwnedPath(env.TEMP, sandbox.descriptor.sandboxPath, "TEMP");
  env.TMP = requireOwnedPath(env.TMP, sandbox.descriptor.sandboxPath, "TMP");
  env.TMPDIR = requireOwnedPath(
    env.TMPDIR,
    sandbox.descriptor.sandboxPath,
    "TMPDIR"
  );
  env.XDG_CACHE_HOME = requireOwnedPath(
    env.XDG_CACHE_HOME,
    sandbox.descriptor.sandboxPath,
    "XDG_CACHE_HOME"
  );
  env.XDG_CONFIG_HOME = requireOwnedPath(
    env.XDG_CONFIG_HOME,
    sandbox.descriptor.sandboxPath,
    "XDG_CONFIG_HOME"
  );
  env.XDG_DATA_HOME = requireOwnedPath(
    env.XDG_DATA_HOME,
    sandbox.descriptor.sandboxPath,
    "XDG_DATA_HOME"
  );
  env.XDG_STATE_HOME = requireOwnedPath(
    env.XDG_STATE_HOME,
    sandbox.descriptor.sandboxPath,
    "XDG_STATE_HOME"
  );
  env.GIT_CONFIG_GLOBAL = sandbox.git.global;
  env.GIT_CONFIG_SYSTEM = sandbox.git.system;
  env.GIT_TERMINAL_PROMPT = "0";
  env[TEST_SANDBOX_ENV] = sandbox.descriptorPath;
  await Promise.all(
    [
      env.CLAUDE_CONFIG_DIR,
      env.CODEX_HOME,
      env.CURSOR_CONFIG_DIR,
      env.TMPDIR,
      env.XDG_CACHE_HOME,
      env.XDG_CONFIG_HOME,
      env.XDG_DATA_HOME,
      env.XDG_STATE_HOME,
    ].map((path) => mkdir(path, { recursive: true }))
  );
  return {
    env,
    git: sandbox.git,
    home: env.HOME ?? owned.home,
    provider: {
      claude: env.CLAUDE_CONFIG_DIR,
      codex: env.CODEX_HOME,
      cursor: env.CURSOR_CONFIG_DIR,
    },
    sandbox,
    tmp: env.TMPDIR,
    xdg: {
      cache: env.XDG_CACHE_HOME,
      config: env.XDG_CONFIG_HOME,
      data: env.XDG_DATA_HOME,
      state: env.XDG_STATE_HOME,
    },
  };
}

export function scanFixedSharedTestStateRoots(
  file: string,
  content: string
): readonly FixedSharedTestStateRoot[] {
  const findings: FixedSharedTestStateRoot[] = [];
  for (const match of content.matchAll(JOIN_TMPDIR_PATTERN)) {
    const literal = match.groups?.literal;
    if (literal === undefined || match.index === undefined) continue;
    if (match.groups?.wrapper !== undefined) continue;
    if (literal.endsWith("-")) continue;
    const text = match[0] ?? "";
    if (isAllowlisted(file, literal) || isAllowlisted(file, text)) continue;
    findings.push({
      file,
      kind: "join-tmpdir",
      line: lineNumber(content, match.index),
      text,
    });
  }
  for (const match of content.matchAll(LITERAL_XDG_PATTERN)) {
    const literal = match.groups?.literal;
    if (literal === undefined || match.index === undefined) continue;
    const text = match[0] ?? "";
    if (isAllowlisted(file, literal) || isAllowlisted(file, text)) continue;
    findings.push({
      file,
      kind: "literal-xdg",
      line: lineNumber(content, match.index),
      text,
    });
  }
  return findings;
}

export function isCliTestRunnerSite(content: string): boolean {
  if (!/\bcli\.ts\b/u.test(content) || !/\bBun\.spawn(?:Sync)?\b/u.test(content)) {
    return false;
  }
  return (
    /Bun\.spawn(?:Sync)?\s*\(\s*(?:\[[^\]]*)?["'`][^"'`]*cli\.ts/u.test(content) ||
    /Bun\.spawn(?:Sync)?\s*\(\s*(?:\[[^\]]*)?(?:process\.execPath|["'`]bun["'`])/u.test(
      content
    ) &&
      /(?:const|let)\s+(?:CLI|cli|cliPath)\b[\s\S]{0,400}cli\.ts/u.test(content) ||
    /cmd:\s*\[["'`]bun["'`]\s*,\s*join\([^)]*cli\.ts/u.test(content) ||
    /\[["'`]bun["'`]\s*,\s*join\([^)]*cli\.ts/u.test(content)
  );
}

export function isSandboxDescriptorConstructionSite(
  file: string,
  content: string
): boolean {
  if (
    file === "scripts/test-sandbox.ts" ||
    file === "apps/skillset/src/verification-sandbox.ts" ||
    file === "scripts/test-helpers/cli-sandbox.ts"
  ) {
    return false;
  }
  return (
    content.includes("descriptor.json") &&
    content.includes("schemaVersion") &&
    /writeFile\(|Bun\.write\(/.test(content)
  );
}

async function materializeNestedSandbox(): Promise<ValidatedTestSandbox> {
  const parent = await validateTestSandbox();
  const sandboxPath = await mkdtemp(
    join(parent.descriptor.sandboxPath, "skillset-test-cli-")
  );
  const git = testSandboxGit(sandboxPath);
  const xdg = testSandboxXdg(sandboxPath);
  await Promise.all(
    Object.values(xdg).map((path) => mkdir(path, { recursive: true }))
  );
  await mkdir(join(sandboxPath, "git"), { recursive: true });
  await Promise.all(
    Object.values(git).map((path) => writeFile(path, "", { flag: "wx" }))
  );
  const descriptorPath = join(sandboxPath, "descriptor.json");
  await writeFile(
    descriptorPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        invocationId: crypto.randomUUID(),
        repoRoot: parent.descriptor.repoRoot,
        sandboxPath,
        schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
      },
      null,
      2
    )}\n`,
    { flag: "wx" }
  );
  return validateTestSandbox(
    {
      GIT_CONFIG_GLOBAL: git.global,
      GIT_CONFIG_SYSTEM: git.system,
      GIT_TERMINAL_PROMPT: "0",
      HOME: process.env.HOME,
      NODE_ENV: "test",
      [TEST_SANDBOX_ENV]: descriptorPath,
      XDG_CACHE_HOME: xdg.cache,
      XDG_CONFIG_HOME: xdg.config,
      XDG_DATA_HOME: xdg.data,
      XDG_STATE_HOME: xdg.state,
    },
    parent.descriptor.repoRoot
  );
}

async function ownedRoots(sandbox: ValidatedTestSandbox): Promise<{
  readonly home: string;
  readonly provider: OwnedCliTestEnvironment["provider"];
  readonly tmp: string;
}> {
  const tmp = join(sandbox.descriptor.sandboxPath, "tmp");
  const provider = {
    claude: join(sandbox.xdg.config, "claude"),
    codex: join(sandbox.xdg.config, "codex"),
    cursor: join(sandbox.xdg.config, "cursor"),
  };
  await Promise.all(
    [tmp, provider.claude, provider.codex, provider.cursor].map((path) =>
      mkdir(path, { recursive: true })
    )
  );
  return {
    home: process.env.HOME ?? homedir(),
    provider,
    tmp,
  };
}

function requireOwnedPath(
  value: string | undefined,
  sandboxPath: string,
  label: string
): string {
  if (!value || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path inside the owned test sandbox`);
  }
  const canonical = resolve(value);
  if (!isInside(sandboxPath, canonical) && canonical !== sandboxPath) {
    throw new Error(`${label} must stay inside the owned test sandbox`);
  }
  return canonical;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function isAllowlisted(file: string, text: string): boolean {
  return FIXED_SHARED_TEST_STATE_ROOT_ALLOWLIST.some(
    (entry) => file === entry.file && text.includes(entry.prefix)
  );
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/u).length;
}
