import { describe, expect, it } from "bun:test";

import { assertNoHostLeaks, detectHostLeaks } from "@skillset/core";

describe("host leak detection", () => {
  it("detects POSIX host paths without dumping the full path", () => {
    const issues = detectHostLeaks("report.json", [
      "path=/Users/matt/project/.skillset/config.yaml",
      "temp=/private/var/folders/zz/abc/T/project/file.txt",
    ].join("\n"));

    expect(issues).toEqual([
      {
        kind: "posix-host-path",
        path: "report.json",
        redacted: "/Users/.../config.yaml",
      },
      {
        kind: "posix-host-path",
        path: "report.json",
        redacted: "/private/.../file.txt",
      },
    ]);
  });

  it("detects Windows host paths", () => {
    const issues = detectHostLeaks("report.json", "path=C:\\Users\\matt\\project\\file.txt\n");

    expect(issues).toEqual([
      {
        kind: "windows-host-path",
        path: "report.json",
        redacted: "C:/.../file.txt",
      },
    ]);
  });

  it("detects configured repo, temp, home, and workspace paths as categories", () => {
    const issues = detectHostLeaks("operation-result.json", [
      "repo=/repo/skillset",
      "temp=/tmp/skillset-projection-abc",
      "home=/Users/matt",
      "workspace=/tmp/skillset-projection-abc/left/workspace",
    ].join("\n"), {
      homePath: "/Users/matt",
      repoRootPath: "/repo/skillset",
      tempRootPath: "/tmp/skillset-projection-abc",
      workspacePaths: ["/tmp/skillset-projection-abc/left/workspace"],
    });

    expect(issues.map((issue) => issue.kind)).toContain("repo-path");
    expect(issues.map((issue) => issue.kind)).toContain("temp-path");
    expect(issues.map((issue) => issue.kind)).toContain("home-path");
    expect(issues.map((issue) => issue.kind)).toContain("workspace-path");
    expect(issues.filter((issue) => issue.kind === "posix-host-path")).toHaveLength(3);
  });

  it("redacts non-path forbidden substrings without echoing the value", () => {
    const issues = detectHostLeaks("report.json", "token=secret-token\n", {
      forbiddenSubstrings: ["secret-token"],
    });

    expect(issues).toEqual([
      {
        kind: "forbidden-substring",
        path: "report.json",
        redacted: "[redacted]",
      },
    ]);
    expect(JSON.stringify(issues)).not.toContain("secret-token");
  });

  it("keeps ordinary docs paths and URLs out of the leak set", () => {
    const issues = detectHostLeaks("docs.md", [
      "See https://example.com/docs/path",
      "Use docs/features/skills.md",
      "Generated output is under .skillset/build/out",
      "A POSIX-looking option like /docs/reference is not host-specific.",
    ].join("\n"));

    expect(issues).toEqual([]);
  });

  it("throws a concise error for assertion callers", () => {
    const bytes = new TextEncoder().encode("workspace=/tmp/skillset-projection-abc/left/workspace\n");

    expect(() => assertNoHostLeaks("report.json", bytes)).toThrow(
      "skillset: report.json contains posix-host-path leak (/tmp/.../workspace)"
    );
  });
});
