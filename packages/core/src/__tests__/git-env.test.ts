import { describe, expect, test } from "bun:test";

import { gitReadOnlyEnv, gitRepositoryTargetingKeys, gitSafeEnv } from "../git-env";

describe("gitSafeEnv", () => {
  test("SET-632: strips every repository-targeting Git variable", () => {
    const sanitized = gitSafeEnv({
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/tmp/alt",
      GIT_COMMON_DIR: "/tmp/common",
      GIT_DIR: ".git",
      GIT_INDEX_FILE: "/tmp/index",
      GIT_NAMESPACE: "hooks",
      GIT_OBJECT_DIRECTORY: "/tmp/objects",
      GIT_OPTIONAL_LOCKS: "1",
      GIT_WORK_TREE: "/tmp/work",
      HOME: "/home/skillset",
      PATH: "/usr/bin",
    });

    expect(sanitized).toEqual({
      GIT_OPTIONAL_LOCKS: "1",
      HOME: "/home/skillset",
      PATH: "/usr/bin",
    });
    expect(gitRepositoryTargetingKeys({
      GIT_DIR: ".git",
      GIT_WORK_TREE: "/tmp/work",
      HOME: "/home/skillset",
    })).toEqual(["GIT_DIR", "GIT_WORK_TREE"]);
  });

  test("SET-632: strips every repository-local override git rev-parse --local-env-vars lists", () => {
    const repositoryLocal = {
      GIT_GRAFT_FILE: "/tmp/grafts",
      GIT_IMPLICIT_WORK_TREE: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_PREFIX: "sub/",
      GIT_REPLACE_REF_BASE: "refs/other-replace/",
      GIT_SHALLOW_FILE: "/tmp/shallow",
    };

    expect(gitSafeEnv({ ...repositoryLocal, PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
    expect(gitRepositoryTargetingKeys(repositoryLocal)).toEqual(Object.keys(repositoryLocal).sort());
  });

  test("SET-632: keeps deliberate Git config injection for callers to handle", () => {
    const config = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Skillset" };

    expect(gitSafeEnv(config)).toEqual(config);
  });

  test("SET-632: read-only probes disable optional locks after sanitizing", () => {
    expect(gitReadOnlyEnv({
      GIT_DIR: ".git",
      GIT_OPTIONAL_LOCKS: "1",
      PATH: "/usr/bin",
    })).toEqual({
      GIT_OPTIONAL_LOCKS: "0",
      PATH: "/usr/bin",
    });
  });
});
