import { describe, expect, test } from "bun:test";

import { parseCliRequest } from "../cli-args";
import { parseHooksCommandRequest } from "../hooks-args";
import {
  parseExplainCommandRequest,
  parseListCommandRequest,
  parseLookupCommandRequest,
  parseStatusCommandRequest,
} from "../inspect-args";
import { parseTestCommandRequest } from "../test-args";

const CONTEXT = { cwd: "/workspace/repo" } as const;

const parseDirectRequest = (args: readonly string[]) => {
  switch (args[0]) {
    case "list":
      return parseListCommandRequest(args, CONTEXT);
    case "status":
      return parseStatusCommandRequest(args, CONTEXT);
    case "explain":
      return parseExplainCommandRequest(args, CONTEXT);
    case "lookup":
      return parseLookupCommandRequest(args);
    case "test":
      return parseTestCommandRequest(args, CONTEXT);
    default:
      return parseHooksCommandRequest(args, CONTEXT);
  }
};

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

describe("SET-304 inspection and runtime route parsers", () => {
  test("validates recognized import metadata across inspection and runtime owners", () => {
    const routes = [
      ["list"],
      ["lookup", "hooks", "events"],
      ["test"],
      ["hooks", "print"],
    ] as const;

    for (const args of routes) {
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
        const input = [...args, flag, value];
        expect(() => parseDirectRequest(input)).toThrow(message);
        expect(() => parseCliRequest(input, CONTEXT)).toThrow(message);
      }
    }

    expect(
      parseListCommandRequest(["list", "--from", "codex"], CONTEXT)
    ).toMatchObject({ options: {} });
  });

  test("inspection routes own roots, scopes, machine mode, and paths", () => {
    expect(
      parseListCommandRequest(
        ["list", "--root", "nested", "--scope", "plugins", "--json"],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      options: { scopes: ["plugins"] },
      rootPath: "/workspace/repo/nested",
    });
    expect(
      parseStatusCommandRequest(["status", "--root=nested", "--json"], CONTEXT)
    ).toEqual({
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo/nested",
    });
    expect(
      parseExplainCommandRequest(
        ["explain", "plugins/example", "--scope=plugins", "--json", "--yes"],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      options: { scopes: ["plugins"] },
      path: "plugins/example",
      rootPath: "/workspace/repo",
    });
  });

  test("lookup owns optional compatibility values and feature grammar", () => {
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
    ).toMatchObject({ kind: "query" });
  });

  test("test owns declared, ad hoc, retained, and hidden worker grammar", () => {
    expect(
      parseTestCommandRequest(
        ["test", "declared", "--root", "nested", "--json"],
        CONTEXT
      )
    ).toMatchObject({
      jsonOutput: true,
      rootPath: "/workspace/repo/nested",
      testName: "declared",
      tryPlugins: [],
    });
    expect(
      parseTestCommandRequest(
        [
          "test",
          "--target",
          "codex",
          "--prompt",
          "Run it",
          "--plugin",
          "first",
          "--plugin=second",
          "--background",
          "--timeout-ms",
          "5000",
        ],
        CONTEXT
      )
    ).toMatchObject({
      tryBackground: true,
      tryPlugins: ["first", "second"],
      tryPrompt: "Run it",
      tryTarget: "codex",
      tryTimeoutMs: 5000,
    });
    expect(
      parseTestCommandRequest(
        ["test", "tail", "run-id", "--lines=25", "--json"],
        CONTEXT
      )
    ).toMatchObject({
      jsonOutput: true,
      tryLines: 25,
      tryRunId: "run-id",
      trySubcommand: "tail",
    });
    expect(
      parseTestCommandRequest(
        ["test", "worker", "run-id", "--root", "nested"],
        CONTEXT
      )
    ).toMatchObject({
      rootPath: "/workspace/repo/nested",
      tryRunId: "run-id",
      trySubcommand: "worker",
    });
  });

  test("hooks owns context, print, and run protocol grammar", () => {
    expect(
      parseHooksCommandRequest(
        [
          "hooks",
          "context",
          "--event",
          "Stop",
          "--format",
          "env",
          "--context-fields",
          "provider,hook.event",
          "--root",
          "nested",
        ],
        CONTEXT
      )
    ).toMatchObject({
      hookContextEvent: "Stop",
      hookContextFields: ["provider", "hook.event"],
      hookContextFormat: "env",
      hookSubcommand: "context",
      rootPath: "/workspace/repo/nested",
    });
    expect(
      parseHooksCommandRequest(
        [
          "hooks",
          "print",
          "--runner",
          "lefthook",
          "--target",
          "codex",
          "--pre-push",
        ],
        CONTEXT
      )
    ).toMatchObject({
      hookPrePush: true,
      hookRunner: "lefthook",
      hookSubcommand: "print",
      hookTarget: "codex",
    });
    expect(
      parseHooksCommandRequest(
        ["hooks", "run", "stop", "--root", "nested"],
        CONTEXT
      )
    ).toMatchObject({
      hookRunEvent: "stop",
      hookSubcommand: "run",
      rootPath: "/workspace/repo/nested",
    });
  });

  test("preserves exceptional validation and diagnostic precedence", () => {
    const cases = [
      {
        message: "skillset: status only supports --root and --json",
        run: () =>
          parseStatusCommandRequest(["status", "--scope", "plugins"], CONTEXT),
      },
      {
        message:
          "skillset: expected lookup features to use only an optional feature id and --json",
        run: () =>
          parseLookupCommandRequest(["lookup", "features", "id", "--fields"]),
      },
      {
        message:
          "skillset: expected lookup features to use only an optional feature id and --json",
        run: () =>
          parseLookupCommandRequest([
            "lookup",
            "features",
            "id",
            "--scope",
            "plugins",
          ]),
      },
      {
        message: "skillset: --root is not supported with lookup",
        run: () => parseLookupCommandRequest(["lookup", "--root", "nested"]),
      },
      {
        message:
          "skillset: declared test declared cannot be combined with ad hoc test flags",
        run: () =>
          parseTestCommandRequest(
            ["test", "declared", "--target", "codex", "--prompt", "run"],
            CONTEXT
          ),
      },
      {
        message: "skillset: test worker requires run id",
        run: () => parseTestCommandRequest(["test", "worker"], CONTEXT),
      },
      {
        message:
          "skillset: test worker only supports <run-id> and --root <path>",
        run: () =>
          parseTestCommandRequest(
            ["test", "worker", "run-id", "--json"],
            CONTEXT
          ),
      },
      {
        message: "skillset: hook options are only supported with hooks print",
        run: () =>
          parseHooksCommandRequest(
            ["hooks", "context", "--runner", "git"],
            CONTEXT
          ),
      },
      {
        message: "skillset: --root is not supported with hooks print",
        run: () =>
          parseHooksCommandRequest(
            ["hooks", "print", "--root", "nested", "--updated"],
            CONTEXT
          ),
      },
      {
        message: "skillset: unknown option --jsonl",
        run: () => parseListCommandRequest(["list", "--jsonl"], CONTEXT),
      },
      {
        message: "skillset: unknown option --jsonl",
        run: () => parseTestCommandRequest(["test", "--jsonl"], CONTEXT),
      },
      {
        message: "skillset: unknown option --jsonl",
        run: () =>
          parseHooksCommandRequest(
            ["hooks", "run", "stop", "--jsonl"],
            CONTEXT
          ),
      },
    ] as const;
    for (const { message, run } of cases) {
      expect(run).toThrow(message);
    }
  });

  test("matches facade compatibility across owned routes and known flag families", () => {
    const routes = [
      ["list"],
      ["status"],
      ["explain", "managed/path"],
      ["lookup"],
      ["lookup", "hooks", "events"],
      ["lookup", "features", "hooks.runtime-context"],
      ["test"],
      ["test", "declared"],
      ["test", "list"],
      ["test", "status", "run-id"],
      ["test", "tail", "run-id"],
      ["test", "worker", "run-id"],
      ["hooks", "context", "--event", "Stop"],
      ["hooks", "print"],
      ["hooks", "run", "stop"],
    ] as const;
    const options = [
      ["--root", "nested"],
      ["--root=nested"],
      ["--json"],
      ["--jsonl"],
      ["--scope", "plugins"],
      ["--updated"],
      ["--all"],
      ["--yes"],
      ["--compat"],
      ["--compat", "claude", "codex,cursor"],
      ["--compat=codex"],
      ["--frontmatter"],
      ["--fields"],
      ["--field", "payload.command"],
      ["--values"],
      ["--events"],
      ["--examples"],
      ["--schema"],
      ["--target", "codex"],
      ["--prompt", "Run it"],
      ["--prompt-file", "prompt.md"],
      ["--plugin", "example"],
      ["--claude-setting-sources", "user,project"],
      ["--timeout-ms", "5000"],
      ["--lines", "25"],
      ["--name", "named"],
      ["--background"],
      ["--runner", "git"],
      ["--event", "Stop"],
      ["--format", "env"],
      ["--context-fields", "provider,hook.event"],
      ["--agent-runtime"],
      ["--pre-commit"],
      ["--pre-push"],
      ["--id", "source-id"],
      ["--in", "plugin-id"],
      ["--adopt", "candidate"],
      ["--preset", "default"],
      ["--append"],
      ["--bump", "patch"],
      ["--group", "group-id"],
      ["--reason", "because"],
      ["--reason-file", "reason.md"],
      ["--ref", "change-ref"],
      ["--since", "origin/main"],
      ["--staged"],
      ["--isolated"],
      ["--targets", "codex"],
      ["--include", "ci"],
      ["--fix"],
      ["--ci"],
      ["--only", "outputs"],
      ["--use", "source"],
      ["--report", "report.md"],
      ["--write"],
    ] as const;
    const scenarios = routes.flatMap((route) => [
      ...options.map((option) => [...route, ...option]),
      ...options.flatMap((first) =>
        options.map((second) => [...route, ...first, ...second])
      ),
    ]);

    for (const args of scenarios) {
      const direct = readOutcome(() => parseDirectRequest(args));
      const facade = readOutcome(() => parseCliRequest(args, CONTEXT).request);
      expect(direct).toEqual(facade);
    }
  });
});
