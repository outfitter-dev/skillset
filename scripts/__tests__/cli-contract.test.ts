import { describe, expect, test } from "bun:test";

import {
  CLI_COMMANDS,
  CLI_ENVIRONMENT,
  CLI_FLAGS,
  FINITE_JSON_ROUTES,
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
      "init",
      "import",
      "new",
      "check",
      "dev",
      "reconcile",
      "build",
      "update",
      "diff",
      "restore",
      "status",
      "list",
      "explain",
      "lookup",
      "test",
      "change",
      "release",
      "marketplace",
      "distribute",
      "hooks",
    ]);
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

  test("classifies every top-level command for structured output", () => {
    const classifiedRoutes = [
      ...FINITE_JSON_ROUTES,
      ...JSONL_ROUTES,
      ...STRUCTURED_OUTPUT_EXCEPTIONS.map(
        (entry) => entry.split(":", 1)[0] ?? ""
      ),
    ];
    for (const command of CLI_COMMANDS) {
      expect(
        classifiedRoutes.some(
          (route) => route === command || route.startsWith(`${command} `)
        )
      ).toBe(true);
    }
    expect(CLI_FLAGS["--json"].meaning).toContain("exactly one");
    expect(CLI_FLAGS["--jsonl"].meaning).toContain("newline-delimited");
    expect(JSONL_ROUTES).toEqual(["dev"]);
    expect(FINITE_JSON_ROUTES).not.toContain("change");
    expect(FINITE_JSON_ROUTES).not.toContain("release");
  });
});
