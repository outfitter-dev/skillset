import { describe, expect, test } from "bun:test";

import {
  readSkillsetWorkspaceConfig,
  resolveRepoCacheKey,
  resolveRepoCachePath,
  resolveSkillsetXdgPaths,
} from "../xdg";
import {
  createOperationalPathContext,
  isRepoOperationalCachePath,
  logicalOperationalPath,
  REPO_OPERATIONAL_CACHE_ROOT,
  resolveOperationalPath,
} from "../operational-cache";

describe("XDG path helpers", () => {
  test("resolves Skillset-owned XDG bases without dot-prefixed global paths", () => {
    const paths = resolveSkillsetXdgPaths({
      env: {
        XDG_CACHE_HOME: "/xdg/cache",
        XDG_CONFIG_HOME: "/xdg/config",
        XDG_DATA_HOME: "/xdg/data",
        XDG_STATE_HOME: "/xdg/state",
      },
      homeDir: "/home/matt",
    });

    expect(paths).toEqual({
      cache: "/xdg/cache/skillset",
      config: "/xdg/config/skillset",
      data: "/xdg/data/skillset",
      state: "/xdg/state/skillset",
    });
    expect(Object.values(paths).some((path) => path.includes("/.skillset"))).toBe(false);
  });

  test("falls back to home-relative XDG bases", () => {
    expect(resolveSkillsetXdgPaths({ env: {}, homeDir: "/home/matt" })).toEqual({
      cache: "/home/matt/.cache/skillset",
      config: "/home/matt/.config/skillset",
      data: "/home/matt/.local/share/skillset",
      state: "/home/matt/.local/state/skillset",
    });
  });

  test("ignores relative XDG base values and falls back to home defaults", () => {
    expect(resolveSkillsetXdgPaths({
      env: {
        XDG_CACHE_HOME: "relative-cache",
        XDG_CONFIG_HOME: "relative-config",
        XDG_DATA_HOME: "relative-data",
        XDG_STATE_HOME: "relative-state",
      },
      homeDir: "/home/matt",
    })).toEqual({
      cache: "/home/matt/.cache/skillset",
      config: "/home/matt/.config/skillset",
      data: "/home/matt/.local/share/skillset",
      state: "/home/matt/.local/state/skillset",
    });
  });
});

describe("repo cache keys", () => {
  test("uses explicit workspace cache keys before automatic keys", () => {
    expect(resolveRepoCachePath({
      env: { XDG_CACHE_HOME: "/xdg/cache" },
      homeDir: "/home/matt",
      remoteUrl: "git@github.com:other/repo.git",
      rootPath: "/work/acme/docs-cli",
      workspaceCacheKey: "acme-docs-cli",
    })).toEqual({
      key: "acme-docs-cli",
      path: "/xdg/cache/skillset/acme-docs-cli",
      source: "explicit",
      xdgCacheBase: "/xdg/cache/skillset",
    });
  });

  test("uses a durable host-and-path automatic key", () => {
    const first = resolveRepoCacheKey({ hostName: "devbox.local", rootPath: "/work/private/docs-cli" });
    const second = resolveRepoCacheKey({ hostName: "devbox.local", rootPath: "/work/private/docs-cli" });
    const otherPath = resolveRepoCacheKey({ hostName: "devbox.local", rootPath: "/work/private/other" });
    const otherHost = resolveRepoCacheKey({ hostName: "laptop.local", rootPath: "/work/private/docs-cli" });

    expect(first).toEqual(second);
    expect(first.source).toBe("fallback");
    expect(first.key).toMatch(/^docs-cli--local-[0-9a-f]{12}$/);
    expect(otherPath.key).not.toBe(first.key);
    expect(otherHost.key).not.toBe(first.key);
  });

  test("derives automatic keys from local storage identity instead of remotes", () => {
    const github = resolveRepoCacheKey({
      hostName: "devbox.local",
      remoteUrl: "git@github.com:Acme/docs-cli.git",
      rootPath: "/work/private/docs-cli",
    });
    const gitlab = resolveRepoCacheKey({
      hostName: "devbox.local",
      remoteUrl: "ssh://git@gitlab.com/Other/docs-cli.git",
      rootPath: "/work/private/docs-cli",
    });
    const otherCheckout = resolveRepoCacheKey({
      hostName: "devbox.local",
      remoteUrl: "git@github.com:Acme/docs-cli.git",
      rootPath: "/work/other/docs-cli",
    });

    expect(github).toEqual(gitlab);
    expect(github.source).toBe("fallback");
    expect(otherCheckout.key).not.toBe(github.key);
  });
});

describe("operational cache paths", () => {
  test("maps logical repo cache paths into the repo XDG cache bucket", () => {
    const context = createOperationalPathContext("/work/docs-cli", {
      env: { XDG_CACHE_HOME: "/xdg/cache" },
      homeDir: "/home/matt",
      workspaceCacheKey: "acme--docs-cli",
    });
    const physicalPath = resolveOperationalPath(context, ".skillset/cache/latest/AGENTS.md");

    expect(REPO_OPERATIONAL_CACHE_ROOT).toBe(".skillset/cache");
    expect(isRepoOperationalCachePath(".skillset/cache/latest/AGENTS.md")).toBe(true);
    expect(physicalPath).toBe("/xdg/cache/skillset/acme--docs-cli/latest/AGENTS.md");
    expect(logicalOperationalPath(context, physicalPath)).toBe(".skillset/cache/latest/AGENTS.md");
  });
});

describe("workspace cache key config", () => {
  test("reads workspace.cacheKey, runtime tester settings, and rejects unsupported workspace keys", () => {
    expect(readSkillsetWorkspaceConfig({
      runtimeTester: { claude: { settingSources: "project" } },
      workspace: { cacheKey: "acme--docs-cli" },
    }, "skillset.yaml")).toEqual({
      cacheKey: "acme--docs-cli",
      runtimeTester: { claude: { settingSources: "project" } },
    });

    expect(() => readSkillsetWorkspaceConfig({ workspace: { other: true } }, "skillset.yaml")).toThrow(
      "unsupported workspace key other"
    );
    expect(() => readSkillsetWorkspaceConfig({ runtimeTester: { claude: { settingSources: "team" } } }, "skillset.yaml")).toThrow(
      "runtimeTester.claude.settingSources"
    );
    expect(() => readSkillsetWorkspaceConfig({ workspace: { cacheKey: 123 } }, "skillset.yaml")).toThrow(
      "workspace.cacheKey"
    );
    expect(() => readSkillsetWorkspaceConfig({ workspace: { cacheKey: " acme" } }, "skillset.yaml")).toThrow(
      "workspace.cacheKey"
    );
    expect(() => readSkillsetWorkspaceConfig({ workspace: { cacheKey: "../docs" } }, "skillset.yaml")).toThrow(
      "workspace.cacheKey"
    );
  });
});
