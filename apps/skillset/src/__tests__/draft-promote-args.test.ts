import { describe, expect, test } from "bun:test";

import { parseCliRequest } from "../cli-args";

const CONTEXT = { cwd: "/cwd" } as const;

describe("SET-587 draft and promote arguments", () => {
  test("routes the canonical paths and mutation flags", () => {
    expect(
      parseCliRequest(
        [
          "draft",
          ".skillset/skills/demo",
          "--yes",
          "--json",
          "--root",
          "/workspace",
        ],
        CONTEXT
      )
    ).toEqual({
      command: "draft",
      request: {
        jsonOutput: true,
        rootPath: "/workspace",
        shippedPath: ".skillset/skills/demo",
        yes: true,
      },
    });
    expect(
      parseCliRequest(
        ["promote", ".skillset/skills/_drafts/demo", "--root", "/workspace"],
        CONTEXT
      )
    ).toEqual({
      command: "promote",
      request: {
        draftPath: ".skillset/skills/_drafts/demo",
        jsonOutput: false,
        rootPath: "/workspace",
        yes: false,
      },
    });
  });

  test("rejects missing, extra, and non-canonical arguments", () => {
    for (const [args, message] of [
      [["draft"], "skillset: draft requires <shipped-path>"],
      [["promote"], "skillset: promote requires <draft-path>"],
      [
        ["draft", "one", "two"],
        "skillset: draft accepts exactly <shipped-path>",
      ],
      [
        ["promote", "one", "two"],
        "skillset: promote accepts exactly <draft-path>",
      ],
      [
        ["draft", "one", "--from", "two"],
        "skillset: draft only supports --json, --root, and --yes",
      ],
      [
        ["promote", "one", "--force"],
        "skillset: promote only supports --json, --root, and --yes",
      ],
    ] as const) {
      expect(() => parseCliRequest(args, CONTEXT)).toThrow(message);
    }
  });
});
