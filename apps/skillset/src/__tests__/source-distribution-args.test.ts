import { describe, expect, test } from "bun:test";

import {
  parseDistributionCommandRequest,
  parseMarketplaceCommandRequest,
} from "../distribution-args";
import { parseInitCommandRequest } from "../init-args";
import {
  parseImportCommandRequest,
  parseNewCommandRequest,
} from "../source-args";

const CONTEXT = { cwd: "/workspace/repo" } as const;

describe("SET-302 source and distribution route parsers", () => {
  test("validates recognized distribution import metadata before ignoring it", () => {
    for (const [flag, value, message] of [
      [
        "--from",
        "typo",
        "skillset: expected --from claude, codex, cursor, agents, or skillset",
      ],
      [
        "--kind",
        "typo",
        "skillset: expected --kind skill, skills, plugin, or plugins",
      ],
    ] as const) {
      expect(() =>
        parseDistributionCommandRequest(
          ["distribute", "plan", flag, value],
          CONTEXT
        )
      ).toThrow(message);
    }

    expect(
      parseDistributionCommandRequest(
        ["distribute", "plan", "--from", "codex", "--kind", "skill"],
        CONTEXT
      )
    ).toMatchObject({ distributionSubcommand: "plan" });
  });

  test("init owns acquisition, adoption, setup, and confirmation inputs", () => {
    expect(
      parseInitCommandRequest(
        [
          "init",
          "destination",
          "--root",
          "nested",
          "--from",
          "source",
          "--adopt",
          "first",
          "--adopt=second",
          "--name",
          "Workspace",
          "--targets",
          "claude,codex",
          "--include",
          "ci",
          "--include=ci",
          "--json",
          "--yes",
        ],
        CONTEXT
      )
    ).toEqual({
      destination: "destination",
      importName: "Workspace",
      initAdopt: ["first", "second"],
      initFrom: "source",
      jsonOutput: true,
      options: {},
      rootExplicit: true,
      rootPath: "/workspace/repo/nested",
      setupIncludes: ["ci"],
      setupTargets: ["claude", "codex"],
      yes: true,
    });
  });

  test("import owns positional inference and explicit source metadata", () => {
    expect(
      parseImportCommandRequest(
        [
          "import",
          "claude",
          "source",
          "--kind",
          "skill",
          "--kind=skill",
          "--from",
          "codex",
          "--name",
          "portable",
          "--root=target",
          "--json",
        ],
        CONTEXT
      )
    ).toEqual({
      importKind: "skill",
      importName: "portable",
      importProvider: "codex",
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo/target",
      sourcePath: "source",
    });
    expect(
      parseImportCommandRequest(
        ["import", "source", "--updated", "--scope", "plugins"],
        CONTEXT
      ).options
    ).toEqual({ buildMode: "updated", scopes: ["plugins"] });
  });

  test("new owns source placement, presentation, presets, and write policy", () => {
    expect(
      parseNewCommandRequest(
        [
          "new",
          "agent",
          "reviewer",
          "--id",
          "review-agent",
          "--name",
          "Reviewer",
          "--in",
          "quality",
          "--preset",
          "base",
          "--preset=security",
          "--scope",
          "repo",
          "--root",
          "nested",
          "--json",
          "--yes",
        ],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      newContainer: "quality",
      newId: "review-agent",
      newKind: "agent",
      newName: "Reviewer",
      newPresets: ["base", "security"],
      newScope: "repo",
      options: {},
      positionalName: "reviewer",
      rootPath: "/workspace/repo/nested",
      yes: true,
    });
  });

  test("distribution routes own subcommands, names, machine mode, and writes", () => {
    expect(
      parseDistributionCommandRequest(
        ["distribute", "plan", "release", "--root", "nested", "--json"],
        CONTEXT
      )
    ).toEqual({
      distributionName: "release",
      distributionSubcommand: "plan",
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo/nested",
    });
    expect(
      parseMarketplaceCommandRequest(
        ["marketplace", "update", "catalog", "--json", "--yes"],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      marketplaceName: "catalog",
      marketplaceSubcommand: "update",
      options: {},
      rootPath: "/workspace/repo",
      yes: true,
    });
  });

  test("preserves route validation and diagnostic precedence", () => {
    const cases = [
      {
        run: () => parseInitCommandRequest(["init", "--updated"], CONTEXT),
        message:
          "skillset: build mode and scope flags are not supported with adopt; adoption always builds the full projection isolated",
      },
      {
        run: () => parseImportCommandRequest(["import", "skill"], CONTEXT),
        message: "skillset: import kind must be passed with --kind",
      },
      {
        run: () =>
          parseImportCommandRequest(
            ["import", "source", "--kind", "skill", "--kind", "plugin"],
            CONTEXT
          ),
        message: "skillset: conflicting import kinds skill and plugin",
      },
      {
        run: () =>
          parseNewCommandRequest(
            ["new", "skill", "--from", "claude", "--updated"],
            CONTEXT
          ),
        message: "skillset: --updated and --all are not supported with new",
      },
      {
        run: () =>
          parseDistributionCommandRequest(
            ["distribute", "plan", "Not-Lowercase"],
            CONTEXT
          ),
        message: "skillset: expected distribution name to be a lowercase id",
      },
      {
        run: () =>
          parseMarketplaceCommandRequest(
            ["marketplace", "check", "--yes"],
            CONTEXT
          ),
        message:
          "skillset: build/write options are not supported with marketplace check; it is always read-only",
      },
    ] as const;
    for (const { message, run } of cases) {
      expect(run).toThrow(message);
    }
  });
});
