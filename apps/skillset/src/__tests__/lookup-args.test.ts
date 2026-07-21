import { describe, expect, test } from "bun:test";

import { parseCliRequest } from "../cli-args";
import { parseLookupCommandRequest } from "../lookup-args";

const CONTEXT = { cwd: "/workspace/repo" } as const;

describe("SET-336 lookup route parser", () => {
  test("owns query positionals, optional compatibility values, and views", () => {
    expect(
      parseLookupCommandRequest([
        "lookup",
        "hooks",
        "events",
        "--compat",
        "claude",
        "codex,cursor",
        "--compat=codex",
        "--fields",
        "--field",
        "payload.command",
        "--json",
      ])
    ).toEqual({
      kind: "query",
      value: {
        jsonOutput: true,
        lookupAspects: ["events"],
        lookupField: "payload.command",
        lookupSubject: "hooks",
        lookupTargets: ["claude", "codex", "cursor"],
        lookupViews: ["compat", "fields"],
      },
    });
    expect(parseLookupCommandRequest(["lookup", "--compat"])).toEqual({
      kind: "query",
      value: {
        jsonOutput: false,
        lookupAspects: [],
        lookupField: undefined,
        lookupSubject: undefined,
        lookupTargets: [],
        lookupViews: ["compat"],
      },
    });
  });

  test("owns features grammar without inheriting query options", () => {
    expect(
      parseLookupCommandRequest([
        "lookup",
        "features",
        "hooks.runtime-context",
        "--json",
      ])
    ).toEqual({
      kind: "features",
      value: { featureId: "hooks.runtime-context", jsonOutput: true },
    });
    for (const args of [
      ["lookup", "features", "id", "--fields"],
      ["lookup", "features", "id", "--scope", "plugins"],
      ["lookup", "features", "id", "--root", "nested"],
    ] as const) {
      expect(() => parseLookupCommandRequest(args)).toThrow(
        "skillset: expected lookup features to use only an optional feature id and --json"
      );
    }
  });

  test("preserves lookup-specific ignored options and root and yes diagnostics", () => {
    expect(
      parseLookupCommandRequest([
        "lookup",
        "--scope",
        "plugins",
        "--updated",
        "--yes",
        "--name",
        "ignored",
      ])
    ).toEqual({
      kind: "query",
      value: {
        jsonOutput: false,
        lookupAspects: [],
        lookupField: undefined,
        lookupSubject: undefined,
        lookupTargets: [],
        lookupViews: [],
      },
    });
    expect(() =>
      parseLookupCommandRequest(["lookup", "--root", "nested"])
    ).toThrow("skillset: --root is not supported with lookup");
    expect(() => parseLookupCommandRequest(["lookup", "--yes=true"])).toThrow(
      "skillset: --yes does not take a value"
    );
  });

  test("preserves foreign-option validation and diagnostic precedence", () => {
    expect(() =>
      parseLookupCommandRequest([
        "lookup",
        "--target",
        "codex",
        "--append",
        "--isolated",
      ])
    ).toThrow(
      "skillset: change options are only supported with change commands"
    );
    expect(() =>
      parseLookupCommandRequest([
        "lookup",
        "--isolated",
        "--use",
        "source",
        "--id",
        "example",
      ])
    ).toThrow(
      "skillset: --isolated is only supported with build, check --only outputs, or diff"
    );
    expect(() =>
      parseLookupCommandRequest(["lookup", "--field", "one", "--field", "two"])
    ).toThrow("skillset: pass only one --field value");
    expect(() => parseLookupCommandRequest(["lookup", "--jsonl"])).toThrow(
      "skillset: unknown option --jsonl"
    );
  });

  test("matches the explicit CLI facade", () => {
    const cases = [
      ["lookup"],
      ["lookup", "hooks", "events", "--compat=codex", "--json"],
      ["lookup", "features", "hooks.runtime-context", "--json"],
      ["lookup", "--root", "nested"],
      ["lookup", "features", "id", "--fields"],
    ] as const;
    for (const args of cases) {
      expect(readOutcome(() => parseLookupCommandRequest(args))).toEqual(
        readOutcome(() => parseCliRequest(args, CONTEXT).request)
      );
    }
  });
});

const readOutcome = (run: () => unknown) => {
  try {
    return { ok: true, value: run() } as const;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    } as const;
  }
};
