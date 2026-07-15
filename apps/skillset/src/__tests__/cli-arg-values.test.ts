import { describe, expect, test } from "bun:test";

import {
  mergeBuildMode,
  readBuildScopes,
  readPositiveInteger,
  readTargetName,
  readTargetNames,
  resolveCliRoot,
  tokenizeCsv,
} from "../cli-arg-values";

describe("SET-300 CLI scalar values", () => {
  test("normalizes roots against the injected cwd", () => {
    expect(resolveCliRoot({ cwd: "/workspace/repo" })).toBe("/workspace/repo");
    expect(resolveCliRoot({ cwd: "/workspace/repo" }, "../other")).toBe(
      "/workspace/other"
    );
  });

  test("reads positive integers with stable diagnostics", () => {
    expect(readPositiveInteger("42", "--lines")).toBe(42);
    for (const value of ["0", "-1", "1.5", "text"]) {
      expect(() => readPositiveInteger(value, "--lines")).toThrow(
        "skillset: expected --lines to be a positive integer"
      );
    }
  });

  test("reads target names and deduplicated target lists", () => {
    expect(readTargetName("claude")).toBe("claude");
    expect(readTargetNames("claude, codex,claude")).toEqual([
      "claude",
      "codex",
    ]);
    expect(() => readTargetName("other")).toThrow(
      "skillset: expected --target"
    );
    expect(() => readTargetNames("")).toThrow(
      "skillset: --targets requires at least one target"
    );
  });

  test("merges build modes and rejects conflicts", () => {
    expect(mergeBuildMode(undefined, "updated")).toBe("updated");
    expect(mergeBuildMode("updated", "updated")).toBe("updated");
    expect(() => mergeBuildMode("updated", "all")).toThrow(
      "skillset: conflicting build mode flags --updated and --all"
    );
  });

  test("reads build scopes with all expansion and stable ordering", () => {
    expect(readBuildScopes("user, repo,user")).toEqual(["user", "repo"]);
    expect(readBuildScopes("all")).toEqual([
      "repo",
      "plugins",
      "project",
      "user",
    ]);
    expect(() => readBuildScopes("all,repo")).toThrow(
      "skillset: --scope all cannot be combined with other scopes"
    );
  });

  test("tokenizes comma-separated values without adding policy", () => {
    expect(tokenizeCsv(" one, two ,,three ")).toEqual(["one", "two", "three"]);
    expect(tokenizeCsv(" , ")).toEqual([]);
  });
});
