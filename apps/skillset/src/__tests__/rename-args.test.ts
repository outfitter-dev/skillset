import { describe, expect, test } from "bun:test";

import { parseCliRequest } from "../cli-args";
import { parseRenameCommandRequest } from "../rename-args";

const CONTEXT = { cwd: "/workspaces/skillset" };

describe("SET-370 rename arguments", () => {
  test("parses the two source paths and supported flags in any order", () => {
    expect(
      parseRenameCommandRequest(
        [
          "rename",
          "--root",
          "nested",
          ".skillset/skills/old",
          "--yes",
          ".skillset/skills/new",
          "--json",
        ],
        CONTEXT
      )
    ).toEqual({
      from: ".skillset/skills/old",
      jsonOutput: true,
      rootPath: "/workspaces/skillset/nested",
      to: ".skillset/skills/new",
      yes: true,
    });
  });

  test("is routed through the canonical parser facade", () => {
    expect(
      parseCliRequest(["rename", "old", "new", "--root", "/workspace"], CONTEXT)
    ).toEqual({
      command: "rename",
      request: {
        from: "old",
        jsonOutput: false,
        rootPath: "/workspace",
        to: "new",
        yes: false,
      },
    });
  });

  test("rejects missing, additional, and foreign arguments", () => {
    for (const [args, message] of [
      [["rename", "old"], "skillset: rename requires <from> and <to>"],
      [
        ["rename", "old", "new", "other"],
        "skillset: rename accepts exactly <from> and <to>",
      ],
      [
        ["rename", "old", "new", "--scope", "repo"],
        "skillset: rename only supports --json, --root, and --yes; received --scope",
      ],
    ] as const) {
      expect(() => parseRenameCommandRequest(args, CONTEXT)).toThrow(message);
    }
  });
});
