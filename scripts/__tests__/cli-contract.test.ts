import { describe, expect, test } from "bun:test";

import {
  CLI_COMMANDS as RUNTIME_CLI_COMMANDS,
  CLI_LEAF_SUBCOMMANDS,
} from "../../apps/skillset/src/cli-commands";
import { USAGE } from "../../apps/skillset/src/cli-usage";
import {
  CLI_COMMANDS,
  CLI_ENVIRONMENT,
  CLI_FLAGS,
  FINITE_JSON_ROUTES,
  HIDDEN_CLI_ROUTES,
  JSONL_ROUTES,
  CLI_ROUTE_FLAGS,
  RETIRED_CLI_COMMANDS,
  RETIRED_CLI_ENVIRONMENT,
  RETIRED_CLI_FLAGS,
  STRUCTURED_OUTPUT_EXCEPTIONS,
} from "../cli-contract";

describe("SET-275 final CLI contract", () => {
  test("pins the exact 20-command top-level roster without retired aliases", () => {
    expect(CLI_COMMANDS).toHaveLength(20);
    expect(new Set(CLI_COMMANDS).size).toBe(CLI_COMMANDS.length);
    expect(CLI_COMMANDS).toEqual([
      "build",
      "change",
      "check",
      "dev",
      "diff",
      "distribute",
      "explain",
      "hooks",
      "import",
      "init",
      "list",
      "lookup",
      "marketplace",
      "new",
      "release",
      "reconcile",
      "restore",
      "status",
      "test",
      "update",
    ]);
    expect(CLI_COMMANDS).toEqual(RUNTIME_CLI_COMMANDS);
    for (const retired of RETIRED_CLI_COMMANDS) {
      expect(CLI_COMMANDS).not.toContain(retired as never);
    }
  });

  test("gives every route flag one canonical meaning", () => {
    for (const [route, flags] of Object.entries(CLI_ROUTE_FLAGS)) {
      expect(route.length).toBeGreaterThan(0);
      expect(new Set(flags).size).toBe(flags.length);
      for (const flag of flags) {
        expect(CLI_FLAGS[flag]).toBeDefined();
      }
    }
  });

  test("removes compatibility and redundant mutation flags", () => {
    for (const retiredAlias of ["--claude", "--codex", "--cursor"] as const) {
      expect(RETIRED_CLI_FLAGS).toContain(retiredAlias);
    }
    for (const retired of RETIRED_CLI_FLAGS) {
      expect(CLI_FLAGS[retired as keyof typeof CLI_FLAGS]).toBeUndefined();
    }
    expect(CLI_ROUTE_FLAGS.check).toContain("--write");
    expect(CLI_ROUTE_FLAGS.check).toContain("--ci");
    expect(CLI_ROUTE_FLAGS.check).toContain("--fix");
    expect(CLI_ROUTE_FLAGS.update).toEqual(["--json", "--root", "--yes"]);
    expect(CLI_ROUTE_FLAGS.reconcile).toEqual([
      "--json",
      "--root",
      "--use",
      "--yes",
    ]);
    expect(CLI_ROUTE_FLAGS["lookup features"]).toEqual(["--json"]);
    expect(CLI_ROUTE_FLAGS.lookup).not.toContain("--root");
  });

  test("records hidden protocol grammar outside public help routes", () => {
    expect(HIDDEN_CLI_ROUTES).toEqual({ "test worker": ["--root"] });
    expect(CLI_ROUTE_FLAGS).not.toHaveProperty("test worker");
    expect(FINITE_JSON_ROUTES).not.toContain("test worker");
    expect(CLI_LEAF_SUBCOMMANDS.test).toContain("worker");
    expect(USAGE).not.toContain("test worker");
  });

  test("renders one global prefix for legacy usage", () => {
    const lines = USAGE.split("\n");

    expect(lines[0]).toStartWith("usage: skillset ");
    expect(lines.filter((line) => line.startsWith("usage:"))).toHaveLength(1);
    expect(lines.slice(1).every((line) => /^ {7}skillset /.test(line))).toBe(
      true
    );
  });

  test("renders the reconciled finite JSON routes in public help", () => {
    const helpFragmentByRoute = {
      build: "skillset build ",
      "change add": "skillset change add ",
      "change amend": "skillset change amend ",
      "change check": "skillset change check ",
      "change history": "skillset change history ",
      "change list": "skillset change list ",
      "change migrate": "skillset change migrate ",
      "change reason": "skillset change reason ",
      "change show": "skillset change show ",
      "change status": "skillset change status ",
      check: "skillset check ",
      diff: "skillset diff ",
      "distribute plan": "skillset distribute plan ",
      explain: "skillset explain ",
      import: "skillset import <path> ",
      init: "skillset init ",
      list: "skillset list ",
      lookup: "skillset lookup [subject] ",
      "lookup features": "skillset lookup features ",
      "marketplace check": "skillset marketplace check ",
      "marketplace update": "skillset marketplace update ",
      new: "skillset new ",
      reconcile: "skillset reconcile ",
      "release amend": "skillset release amend ",
      "release apply": "skillset release apply ",
      "release audit": "skillset release audit ",
      "release plan": "skillset release plan ",
      restore: "skillset restore ",
      status: "skillset status ",
      test: "skillset test [name] ",
      "test list": "skillset test list ",
      "test status": "skillset test status ",
      "test tail": "skillset test tail ",
      update: "skillset update ",
    } as const satisfies Record<(typeof FINITE_JSON_ROUTES)[number], string>;
    expect(Object.keys(helpFragmentByRoute).toSorted()).toEqual(
      [...FINITE_JSON_ROUTES].toSorted()
    );
    for (const [route, fragment] of Object.entries(helpFragmentByRoute)) {
      const line = USAGE.split("\n").find((entry) => entry.includes(fragment));
      expect(line, route).toContain("[--json]");
    }
    for (const fragment of ["skillset import <claude|codex|cursor|agents> "]) {
      const line = USAGE.split("\n").find((entry) => entry.includes(fragment));
      expect(line).toContain("[--json]");
    }
    for (const fragment of [
      "skillset change status ",
      "skillset change check ",
    ]) {
      const line = USAGE.split("\n").find((entry) => entry.includes(fragment));
      expect(line).toContain("[--staged]");
      expect(line).toContain("[--json]");
    }
  });

  test("hard-cuts try environment overrides to the test family", () => {
    expect(Object.keys(CLI_ENVIRONMENT).toSorted()).toEqual([
      "SKILLSET_HOOK_COMMAND",
      "SKILLSET_HOOK_EVENT",
      "SKILLSET_PROVIDER",
      "SKILLSET_SESSION_ID",
      "SKILLSET_TEST_CLAUDE_BIN",
      "SKILLSET_TEST_CLAUDE_SETTING_SOURCES",
      "SKILLSET_TEST_CODEX_BIN",
      "SKILLSET_TEST_CURSOR_BIN",
    ]);
    for (const retired of RETIRED_CLI_ENVIRONMENT) {
      expect(
        CLI_ENVIRONMENT[retired as keyof typeof CLI_ENVIRONMENT]
      ).toBeUndefined();
    }
  });

  test("classifies every final route for structured output", () => {
    const classifiedRoutes = new Set([
      ...FINITE_JSON_ROUTES,
      ...JSONL_ROUTES,
      ...STRUCTURED_OUTPUT_EXCEPTIONS.map(
        (entry) => entry.split(":", 1)[0] ?? ""
      ),
    ]);
    expect([...classifiedRoutes].toSorted()).toEqual(
      Object.keys(CLI_ROUTE_FLAGS).toSorted()
    );
    expect(CLI_FLAGS["--json"].meaning).toContain("exactly one");
    expect(CLI_FLAGS["--jsonl"].meaning).toContain("newline-delimited");
    expect(JSONL_ROUTES).toEqual(["dev"]);
    expect(FINITE_JSON_ROUTES).not.toContain("change");
    expect(FINITE_JSON_ROUTES).not.toContain("release");
  });
});
