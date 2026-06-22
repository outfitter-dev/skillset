import { describe, expect, test } from "bun:test";

import {
  readSkillsetWorkspaceConfig,
  resolveRepoCacheKey,
  resolveRepoCachePath,
  resolveSkillsetXdgPaths,
} from "../xdg";

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
  test("uses explicit workspace cache keys before remote-derived keys", () => {
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

  test("derives owner repo keys from hosted git remotes", () => {
    expect(resolveRepoCacheKey({
      remoteUrl: "git@github.com:Acme/docs-cli.git",
      rootPath: "/work/docs-cli",
    })).toEqual({ key: "acme--docs-cli", source: "remote" });

    expect(resolveRepoCacheKey({
      remoteUrl: "https://github.com/Acme/docs-cli.git",
      rootPath: "/work/docs-cli",
    })).toEqual({ key: "acme--docs-cli", source: "remote" });

    expect(resolveRepoCacheKey({
      remoteUrl: "https://github.com/Acme/docs-cli.git/",
      rootPath: "/work/docs-cli",
    })).toEqual({ key: "acme--docs-cli", source: "remote" });
  });

  test("can qualify remote keys by host to avoid cross-host collisions", () => {
    expect(resolveRepoCacheKey({
      hostQualified: true,
      remoteUrl: "ssh://git@gitlab.com/Acme/docs-cli.git",
      rootPath: "/work/docs-cli",
    })).toEqual({ key: "gitlab.com--acme--docs-cli", source: "remote" });
  });

  test("preserves nested remote namespaces in repo cache keys", () => {
    expect(resolveRepoCacheKey({
      hostQualified: true,
      remoteUrl: "https://gitlab.com/group-a/team/docs-cli.git",
      rootPath: "/work/docs-cli",
    })).toEqual({ key: "gitlab.com--group-a--team--docs-cli", source: "remote" });

    expect(resolveRepoCacheKey({
      hostQualified: true,
      remoteUrl: "https://gitlab.com/group-b/team/docs-cli.git",
      rootPath: "/work/docs-cli",
    })).toEqual({ key: "gitlab.com--group-b--team--docs-cli", source: "remote" });
  });

  test("uses a durable local fallback when no canonical remote exists", () => {
    const first = resolveRepoCacheKey({ rootPath: "/work/private/docs-cli" });
    const second = resolveRepoCacheKey({ rootPath: "/work/private/docs-cli" });
    const other = resolveRepoCacheKey({ rootPath: "/work/private/other" });

    expect(first).toEqual(second);
    expect(first.source).toBe("fallback");
    expect(first.key).toMatch(/^docs-cli--[0-9a-f]{12}$/);
    expect(other.key).not.toBe(first.key);
  });
});

describe("workspace cache key config", () => {
  test("reads workspace.cacheKey and rejects unsupported workspace keys", () => {
    expect(readSkillsetWorkspaceConfig({ workspace: { cacheKey: "acme--docs-cli" } }, "skillset.yaml")).toEqual({
      cacheKey: "acme--docs-cli",
    });

    expect(() => readSkillsetWorkspaceConfig({ workspace: { other: true } }, "skillset.yaml")).toThrow(
      "unsupported workspace key other"
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
