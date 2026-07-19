import { describe, expect, test } from "bun:test";

import {
  parseBuildCommandRequest,
  parseDiffCommandRequest,
} from "../build-args";
import { parseCheckCommandRequest } from "../check-args";
import { parseCliRequest } from "../cli-args";
import { parseDevCommandRequest } from "../dev-args";
import { parseUpdateCommandRequest } from "../update-args";

const CONTEXT = { cwd: "/workspace/repo" } as const;

describe("SET-301 projection and readiness route parsers", () => {
  test("build owns projection options and request construction", () => {
    expect(
      parseBuildCommandRequest(
        [
          "build",
          "--root",
          "nested",
          "--scope",
          "repo,plugins",
          "--updated",
          "--isolated",
          "--json",
          "--yes",
        ],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      options: {
        buildMode: "updated",
        isolated: true,
        scopes: ["repo", "plugins"],
      },
      rootPath: "/workspace/repo/nested",
      yes: true,
    });
  });

  test("diff owns projection options while preserving ignored confirmation", () => {
    expect(
      parseDiffCommandRequest(
        ["diff", "--all", "--scope=all", "--isolated", "--json", "--yes"],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      options: {
        buildMode: "all",
        isolated: true,
        scopes: ["repo", "plugins", "project", "user"],
      },
      rootPath: "/workspace/repo",
    });
  });

  test("check owns CI and narrow-output request construction", () => {
    expect(
      parseCheckCommandRequest(
        [
          "check",
          "--ci",
          "--fix",
          "--since",
          "HEAD",
          "--report=report.md",
          "--json",
        ],
        CONTEXT
      )
    ).toEqual({
      changeSince: "HEAD",
      checkOnly: undefined,
      checkWrite: false,
      ciFix: true,
      ciMode: true,
      ciReportPath: "report.md",
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo",
    });
    expect(
      parseCheckCommandRequest(
        [
          "check",
          "--only",
          "outputs",
          "--updated",
          "--scope",
          "repo",
          "--isolated",
        ],
        CONTEXT
      )
    ).toMatchObject({
      checkOnly: "outputs",
      options: { buildMode: "updated", isolated: true, scopes: ["repo"] },
    });
  });

  test("dev and update own their write and machine modes", () => {
    expect(
      parseDevCommandRequest(
        ["dev", "--root=watch", "--write", "--jsonl"],
        CONTEXT
      )
    ).toEqual({
      jsonlOutput: true,
      options: {},
      rootPath: "/workspace/repo/watch",
      write: true,
    });
    expect(
      parseUpdateCommandRequest(
        ["update", "--root", "target", "--json", "--yes"],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo/target",
      yes: true,
    });
  });

  test("preserves representative validation order and diagnostics", () => {
    const cases = [
      {
        args: ["check", "--fix", "--scope", "repo"],
        message: "skillset: check --fix requires --ci",
      },
      {
        args: ["check", "--jsonl", "--updated"],
        message: "skillset: --jsonl is only supported with dev",
      },
      {
        args: ["dev", "--fix", "--updated"],
        message: "skillset: readiness flags are only supported with check",
      },
      {
        args: ["dev", "--json", "--isolated"],
        message: "skillset: --json is not supported for this command route",
      },
      {
        args: ["update", "--scope", "plugins", "--isolated"],
        message:
          "skillset: update does not support --scope; provider format updates require a whole-workspace safety preflight",
      },
      {
        args: ["build", "--include", "ci"],
        message: "skillset: setup options are only supported with init",
      },
    ] as const;

    for (const { args, message } of cases) {
      expect(() => parseCliRequest(args, CONTEXT)).toThrow(message);
    }
  });

  test("preserves known cross-route ownership and lexical diagnostics", () => {
    const routes = ["build", "check", "dev", "diff", "update"] as const;
    const cases = [
      {
        args: ["--append"],
        message:
          "skillset: change options are only supported with change commands",
      },
      {
        args: ["--runner", "git"],
        message: "skillset: hook options are only supported with hooks print",
      },
      {
        args: ["--event", "SessionStart"],
        message:
          "skillset: hook context options are only supported with hooks context",
      },
      {
        args: ["--frontmatter"],
        message: "skillset: lookup flags are only supported with lookup",
      },
      {
        args: ["--background"],
        message: "skillset: ad hoc test options are only supported with test",
      },
      {
        args: ["--adopt", "demo"],
        message:
          "skillset: --adopt and init acquisition --from are only supported with init",
      },
      {
        args: ["--id", "demo"],
        message: "skillset: new options are only supported with new",
      },
      {
        args: ["--use", "source"],
        message: "skillset: --use is only supported with reconcile",
      },
      {
        args: ["--include", "invalid"],
        message: "skillset: expected --include ci",
      },
      {
        args: ["--targets", "invalid"],
        message: "skillset: expected --targets",
      },
      {
        args: ["--only", "invalid"],
        message: "skillset: expected --only outputs",
      },
      {
        args: ["--kind", "invalid"],
        message: "skillset: expected --kind skill, skills, plugin, or plugins",
      },
      {
        args: ["--from", "invalid"],
        message:
          "skillset: expected --from claude, codex, or cursor; also agents or skillset",
      },
    ] as const;

    for (const route of routes) {
      for (const { args, message } of cases) {
        expect(() => parseCliRequest([route, ...args], CONTEXT)).toThrow(
          message
        );
      }
    }
    for (const route of ["build", "check", "dev", "diff", "update"] as const) {
      expect(() =>
        parseCliRequest(
          [route, "--from", "claude", "--kind", "skill", "--name", "demo"],
          CONTEXT
        )
      ).not.toThrow();
    }
    expect(() => parseCliRequest(["diff", "--yes"], CONTEXT)).not.toThrow();
    expect(() => parseCliRequest(["dev", "--since", "HEAD"], CONTEXT)).toThrow(
      "skillset: --since is only supported with check --ci or change commands"
    );
  });
});
