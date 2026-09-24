import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

import {
  createProviderProbeEnvironment,
  isProviderProbeIsolationVariable,
  isProviderProbePassthroughVariable,
  PROVIDER_PROBE_ISOLATION_VARIABLES,
  PROVIDER_PROBE_PASSTHROUGH_VARIABLES,
  providerProbeRoots,
} from "../provider-probe-environment";

const BUILDERS = [
  "scripts/conformance/standards/agent-instructions.ts",
  "scripts/conformance/standards/agent-plugins.ts",
  "scripts/conformance/standards/agent-skills.ts",
  "scripts/provider-validation-artifacts.ts",
  "scripts/provider-validation-hosted.ts",
] as const;

const SECRET_SOURCE = {
  ANTHROPIC_API_KEY: "anthropic-should-not-leak",
  AWS_SECRET_ACCESS_KEY: "aws-should-not-leak",
  GITHUB_TOKEN: "github-should-not-leak",
  HTTPS_PROXY: "http://proxy.example:8080",
  LANG: "en_US.UTF-8",
  NPM_TOKEN: "npm-should-not-leak",
  PATH: "/usr/bin:/bin",
  SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
  USER: "probe-user",
} as const;

describe("SET-646 provider probe environment", () => {
  test("documents the PATH, proxy, CA, locale, and platform allowlist", () => {
    expect([...PROVIDER_PROBE_PASSTHROUGH_VARIABLES]).toEqual([
      "PATH",
      "ALL_PROXY",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "all_proxy",
      "http_proxy",
      "https_proxy",
      "no_proxy",
      "CURL_CA_BUNDLE",
      "GIT_SSL_CAINFO",
      "NODE_EXTRA_CA_CERTS",
      "REQUESTS_CA_BUNDLE",
      "SSL_CERT_DIR",
      "SSL_CERT_FILE",
      "LANG",
      "LANGUAGE",
      "LC_ALL",
      "LC_CTYPE",
      "LC_MESSAGES",
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
    ]);
    expect(isProviderProbePassthroughVariable("HTTPS_PROXY")).toBe(true);
    expect(isProviderProbePassthroughVariable("AWS_SECRET_ACCESS_KEY")).toBe(
      false
    );
    expect(isProviderProbeIsolationVariable("CODEX_HOME")).toBe(true);
  });

  test("isolates provider roots and omits unrelated secret-shaped ambient variables", async () => {
    const root = await createTestFixtureRoot("skillset-provider-probe-env-");
    const { env, roots } = await createProviderProbeEnvironment({
      adapters: { npm: true, pip: true, uv: true },
      extras: { LANG: "C", TERM: "dumb" },
      root,
      source: SECRET_SOURCE,
    });

    expect(roots).toEqual(providerProbeRoots(root));
    expect(env.HOME).toBe(join(root, "home"));
    expect(env.TMPDIR).toBe(join(root, "tmp"));
    expect(env.XDG_CONFIG_HOME).toBe(join(root, "config"));
    expect(env.CODEX_HOME).toBe(join(root, "config", "codex"));
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(root, "config", "claude"));
    expect(env.CURSOR_CONFIG_DIR).toBe(join(root, "config", "cursor"));
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.APPDATA).toBe(env.XDG_CONFIG_HOME);
    expect(env.LOCALAPPDATA).toBe(env.XDG_DATA_HOME);
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HTTPS_PROXY).toBe("http://proxy.example:8080");
    expect(env.SSL_CERT_FILE).toBe("/etc/ssl/certs/ca-certificates.crt");
    expect(env.LANG).toBe("C");
    expect(env.USER).toBe("probe-user");
    expect(env.npm_config_cache).toBe(join(root, "cache", "npm"));
    expect(env.npm_config_globalconfig).toBe("/dev/null");
    expect(env.UV_CACHE_DIR).toBe(join(root, "cache", "uv"));
    expect(env.UV_NO_CONFIG).toBe("1");
    expect(env.PIP_CACHE_DIR).toBe(join(root, "cache", "pip"));
    expect(env.PIP_CONFIG_FILE).toBe("/dev/null");
    expect(env.DO_NOT_TRACK).toBe("1");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(Object.keys(env).every(isAllowedProbeKey)).toBe(true);

    const created = await readdir(root);
    expect(created.toSorted()).toEqual(
      ["cache", "config", "data", "home", "npm-prefix", "state", "tmp"].toSorted()
    );
    expect((await readdir(join(root, "config"))).toSorted()).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
  });

  test("opts in to declared credentials and fails closed when a required credential is missing", async () => {
    const root = await createTestFixtureRoot("skillset-provider-probe-cred-");

    const present = await createProviderProbeEnvironment({
      credentials: {
        optional: ["OPTIONAL_PROVIDER_TOKEN"],
        required: ["REQUIRED_PROVIDER_TOKEN"],
      },
      extras: { PATH: "/bin" },
      root,
      source: {
        ANTHROPIC_API_KEY: "must-stay-out",
        REQUIRED_PROVIDER_TOKEN: "required-value",
      },
    });
    expect(present.env.REQUIRED_PROVIDER_TOKEN).toBe("required-value");
    expect(present.env.OPTIONAL_PROVIDER_TOKEN).toBeUndefined();
    expect(present.env.ANTHROPIC_API_KEY).toBeUndefined();

    await expect(
      createProviderProbeEnvironment({
        createDirectories: false,
        credentials: { required: ["REQUIRED_PROVIDER_TOKEN"] },
        root,
        source: { REQUIRED_PROVIDER_TOKEN: "" },
      })
    ).rejects.toThrow("requires credential REQUIRED_PROVIDER_TOKEN");

    await expect(
      createProviderProbeEnvironment({
        createDirectories: false,
        credentials: { required: ["HOME"] },
        root,
        source: { HOME: "/tmp/leaky-home" },
      })
    ).rejects.toThrow("overlaps the isolation or allowlist contract");
  });

  test("does not let extras replace isolated provider roots", async () => {
    const root = await createTestFixtureRoot("skillset-provider-probe-extra-");
    const { env } = await createProviderProbeEnvironment({
      extras: {
        HOME: "/tmp/leaky-home",
        LANG: "C",
        PATH: "/usr/bin:/bin",
      },
      root,
      source: { HOME: "/Users/maintainer", PATH: "/leaky/bin" },
    });
    expect(env.HOME).toBe(join(root, "home"));
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.LANG).toBe("C");
  });

  test("preserves Windows Path spelling and protects reserved names case-insensitively", async () => {
    const root = await createTestFixtureRoot("skillset-provider-probe-win-");
    const { env } = await createProviderProbeEnvironment({
      adapters: { npm: true, pip: true },
      extras: {
        home: "C:\\leaky-home",
        NPM_CONFIG_CACHE: "C:\\leaky-cache",
      },
      platform: "win32",
      root,
      source: { Path: "C:\\Windows\\System32" },
    });

    expect(env.Path).toBe("C:\\Windows\\System32");
    expect(env.PATH).toBeUndefined();
    expect(env.home).toBeUndefined();
    expect(env.HOME).toBe(join(root, "home"));
    expect(env.NPM_CONFIG_CACHE).toBeUndefined();
    expect(env.npm_config_globalconfig).toBe("NUL");
    expect(env.PIP_CONFIG_FILE).toBe("NUL");
    expect(isProviderProbePassthroughVariable("Path", "win32")).toBe(true);
    expect(isProviderProbePassthroughVariable("Path", "linux")).toBe(false);
    expect(isProviderProbeIsolationVariable("home", "win32")).toBe(true);

    await expect(
      createProviderProbeEnvironment({
        createDirectories: false,
        credentials: { required: ["home"] },
        platform: "win32",
        root,
        source: { home: "C:\\leaky-home" },
      })
    ).rejects.toThrow("overlaps the isolation or allowlist contract");
  });

  test("rejects a relative root before creating directories", async () => {
    await expect(
      createProviderProbeEnvironment({
        createDirectories: false,
        root: "relative-probe-root",
      })
    ).rejects.toThrow("root must be an absolute path");
  });

  test("migrates the six provider-probe builders onto the shared helper", async () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const sources = await Promise.all(
      BUILDERS.map(async (relativePath) => ({
        relativePath,
        text: await readFile(join(repoRoot, relativePath), "utf8"),
      }))
    );
    expect(
      sources.map(({ relativePath, text }) => ({
        relativePath,
        usesHelper: text.includes("createProviderProbeEnvironment"),
        spreadsProcessEnv:
          text.includes("...process.env") ||
          text.includes("Object.entries(process.env)") ||
          text.includes("stringEnvironment(process.env)"),
      }))
    ).toEqual(
      BUILDERS.map((relativePath) => ({
        relativePath,
        usesHelper: true,
        spreadsProcessEnv: false,
      }))
    );
  });
});

const ADAPTER_KEYS = new Set([
  "DO_NOT_TRACK",
  "PIP_CACHE_DIR",
  "PIP_CONFIG_FILE",
  "UV_CACHE_DIR",
  "UV_NO_CONFIG",
  "npm_config_cache",
  "npm_config_globalconfig",
  "npm_config_prefix",
  "npm_config_userconfig",
]);

function isAllowedProbeKey(name: string): boolean {
  return (
    isProviderProbeIsolationVariable(name) ||
    isProviderProbePassthroughVariable(name) ||
    ADAPTER_KEYS.has(name)
  );
}
