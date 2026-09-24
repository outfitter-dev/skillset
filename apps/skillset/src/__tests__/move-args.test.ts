import { describe, expect, test } from "bun:test";

import { parseCliRequest } from "../cli-args";
import { parseMoveCommandRequest } from "../move-args";

const CONTEXT = { cwd: "/workspaces/skillset" };

describe("SET-588 move arguments", () => {
  test("parses two source paths and plan-first flags in any order", () => {
    expect(
      parseMoveCommandRequest(
        [
          "move",
          "--root",
          "nested",
          ".skillset/skills/demo",
          "--yes",
          ".skillset/plugins/tools/skills/demo",
          "--json",
        ],
        CONTEXT
      )
    ).toEqual({
      from: ".skillset/skills/demo",
      jsonOutput: true,
      rootPath: "/workspaces/skillset/nested",
      to: ".skillset/plugins/tools/skills/demo",
      yes: true,
    });
  });

  test("routes move through the canonical parser facade", () => {
    expect(
      parseCliRequest(["move", "old", "new", "--root", "/workspace"], CONTEXT)
    ).toEqual({
      command: "move",
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
      [["move", "old"], "skillset: move requires <from> and <to>"],
      [
        ["move", "old", "new", "other"],
        "skillset: move accepts exactly <from> and <to>",
      ],
      [
        ["move", "old", "new", "--scope", "repo"],
        "skillset: move only supports --json, --root, and --yes; received --scope",
      ],
    ] as const) {
      expect(() => parseMoveCommandRequest(args, CONTEXT)).toThrow(message);
    }
  });
});
