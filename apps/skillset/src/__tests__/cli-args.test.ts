import { describe, expect, test } from "bun:test";

import { CLI_ROUTE_FLAGS } from "../../../../scripts/cli-contract";
import { parseCliRequest } from "../cli-args";
import { CliOutputError } from "../cli-output";

const ROOT = "/tmp/skillset-cli-args";

function canonical(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("SET-299 CLI request characterization", () => {
  const changeRequest = (request: Record<string, unknown>) => ({
    command: "change",
    request: {
      changeAppend: false,
      changeStaged: false,
      jsonOutput: true,
      options: {},
      rootPath: ROOT,
      yes: false,
      ...request,
    },
  });
  const testRequest = (request: Record<string, unknown>) => ({
    command: "test",
    request: {
      jsonOutput: true,
      options: {},
      rootPath: ROOT,
      tryBackground: false,
      tryPlugins: [],
      ...request,
    },
  });
  const cases: readonly {
    readonly args: readonly string[];
    readonly expected: unknown;
    readonly route: string;
  }[] = [
    {
      route: "build",
      args: ["build", "--root", ROOT],
      expected: {
        command: "build",
        request: { jsonOutput: false, options: {}, rootPath: ROOT, yes: false },
      },
    },
    {
      route: "change status",
      args: ["change", "status", "--root", ROOT],
      expected: {
        command: "change",
        request: {
          changeAppend: false,
          changeStaged: false,
          changeSubcommand: "status",
          jsonOutput: false,
          options: {},
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "check",
      args: ["check", "--root", ROOT],
      expected: {
        command: "check",
        request: {
          checkWrite: false,
          ciFix: false,
          ciMode: false,
          jsonOutput: false,
          options: {},
          rootPath: ROOT,
        },
      },
    },
    {
      route: "create",
      args: ["create", "demo", "--root", ROOT],
      expected: {
        command: "create",
        request: {
          jsonOutput: false,
          name: "demo",
          options: {},
          parentExplicit: true,
          parentPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "dev",
      args: ["dev", "--root", ROOT],
      expected: {
        command: "dev",
        request: {
          jsonlOutput: false,
          options: {},
          rootPath: ROOT,
          write: false,
        },
      },
    },
    {
      route: "diff",
      args: ["diff", "--root", ROOT],
      expected: {
        command: "diff",
        request: { jsonOutput: false, options: {}, rootPath: ROOT },
      },
    },
    {
      route: "distribute plan",
      args: ["distribute", "plan", "--root", ROOT],
      expected: {
        command: "distribute",
        request: {
          distributionSubcommand: "plan",
          jsonOutput: false,
          options: {},
          rootPath: ROOT,
        },
      },
    },
    {
      route: "explain",
      args: ["explain", "skill.md", "--root", ROOT],
      expected: {
        command: "explain",
        request: {
          jsonOutput: false,
          options: {},
          path: "skill.md",
          rootPath: ROOT,
        },
      },
    },
    {
      route: "hooks print",
      args: ["hooks", "print", "--runner", "git", "--pre-commit"],
      expected: {
        command: "hooks",
        request: {
          hookAgentRuntime: false,
          hookPreCommit: true,
          hookPrePush: false,
          hookRunner: "git",
          hookSubcommand: "print",
          rootPath: process.cwd(),
        },
      },
    },
    {
      route: "import",
      args: ["import", "source", "--root", ROOT],
      expected: {
        command: "import",
        request: {
          jsonOutput: false,
          options: {},
          rootPath: ROOT,
          sourcePath: "source",
        },
      },
    },
    {
      route: "init",
      args: ["init", "--root", ROOT],
      expected: {
        command: "init",
        request: {
          jsonOutput: false,
          options: {},
          rootExplicit: true,
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "list",
      args: ["list", "--root", ROOT],
      expected: {
        command: "list",
        request: {
          details: false,
          jsonOutput: false,
          options: {},
          rootPath: ROOT,
        },
      },
    },
    {
      route: "lookup",
      args: ["lookup"],
      expected: {
        command: "lookup",
        request: {
          kind: "query",
          value: {
            jsonOutput: false,
            lookupAspects: [],
            lookupTargets: [],
            lookupViews: [],
          },
        },
      },
    },
    {
      route: "marketplace check",
      args: ["marketplace", "check", "--root", ROOT],
      expected: {
        command: "marketplace",
        request: {
          jsonOutput: false,
          marketplaceSubcommand: "check",
          options: {},
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "new",
      args: ["new", "skill", "--root", ROOT],
      expected: {
        command: "new",
        request: {
          jsonOutput: false,
          newKind: "skill",
          options: {},
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "reconcile",
      args: ["reconcile", "managed.md", "--root", ROOT],
      expected: {
        command: "reconcile",
        request: {
          jsonOutput: false,
          managedPath: "managed.md",
          options: {},
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "release plan",
      args: ["release", "plan", "--root", ROOT],
      expected: {
        command: "release",
        request: {
          jsonOutput: false,
          options: {},
          releaseSubcommand: "plan",
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "restore",
      args: ["restore", "backup-1", "--root", ROOT],
      expected: {
        command: "restore",
        request: {
          backupId: "backup-1",
          jsonOutput: false,
          list: false,
          options: {},
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "status",
      args: ["status", "--root", ROOT],
      expected: {
        command: "status",
        request: { jsonOutput: false, options: {}, rootPath: ROOT },
      },
    },
    {
      route: "test",
      args: ["test", "--root", ROOT],
      expected: {
        command: "test",
        request: {
          jsonOutput: false,
          options: {},
          rootPath: ROOT,
          tryBackground: false,
          tryPlugins: [],
        },
      },
    },
    {
      route: "update",
      args: ["update", "--root", ROOT],
      expected: {
        command: "update",
        request: { jsonOutput: false, options: {}, rootPath: ROOT, yes: false },
      },
    },
  ];

  const leafCases: typeof cases = [
    {
      route: "change add",
      args: [
        "change",
        "add",
        "--scope",
        "plugin:demo",
        "--bump",
        "minor",
        "--reason",
        "why",
        "--root",
        ROOT,
        "--json",
      ],
      expected: changeRequest({
        changeBump: "minor",
        changeReason: { kind: "inline", value: "why" },
        changeScopes: ["plugin:demo"],
        changeSubcommand: "add",
      }),
    },
    {
      route: "change amend",
      args: [
        "change",
        "amend",
        "@a",
        "--ref",
        "@b",
        "--reason-file",
        "why.md",
        "--root",
        ROOT,
        "--json",
      ],
      expected: changeRequest({
        changeReason: { kind: "file", path: "why.md" },
        changeRef: "@b",
        changeSubcommand: "amend",
      }),
    },
    {
      route: "change check",
      args: [
        "change",
        "check",
        "@a",
        "--ref",
        "@b",
        "--since",
        "HEAD~1",
        "--staged",
        "--root",
        ROOT,
        "--json",
      ],
      expected: changeRequest({
        changeRef: "@b",
        changeSince: "HEAD~1",
        changeStaged: true,
        changeSubcommand: "check",
      }),
    },
    {
      route: "change history",
      args: ["change", "history", "@a", "--root", ROOT, "--json"],
      expected: changeRequest({ changeRef: "@a", changeSubcommand: "history" }),
    },
    {
      route: "change ignore",
      args: ["change", "ignore", "@a", "--yes", "--root", ROOT, "--json"],
      expected: changeRequest({ changeRef: "@a", changeSubcommand: "ignore", yes: true }),
    },
    {
      route: "change list",
      args: ["change", "list", "--group", "g", "--root", ROOT, "--json"],
      expected: changeRequest({ changeGroup: "g", changeSubcommand: "list" }),
    },
    {
      route: "change migrate",
      args: ["change", "migrate", "--yes", "--root", ROOT, "--json"],
      expected: changeRequest({ changeSubcommand: "migrate", yes: true }),
    },
    {
      route: "change reason",
      args: [
        "change",
        "reason",
        "@a",
        "--append",
        "--reason",
        "-",
        "--root",
        ROOT,
        "--json",
      ],
      expected: changeRequest({
        changeAppend: true,
        changeReason: { kind: "stdin" },
        changeRef: "@a",
        changeSubcommand: "reason",
      }),
    },
    {
      route: "change refresh",
      args: ["change", "refresh", "@a", "--since", "origin/main", "--yes", "--root", ROOT, "--json"],
      expected: changeRequest({
        changeRef: "@a",
        changeSince: "origin/main",
        changeSubcommand: "refresh",
        yes: true,
      }),
    },
    {
      route: "change show",
      args: ["change", "show", "@a", "--root", ROOT, "--json"],
      expected: changeRequest({ changeRef: "@a", changeSubcommand: "show" }),
    },
    {
      route: "hooks context",
      args: [
        "hooks",
        "context",
        "--event",
        "Stop",
        "--format",
        "json",
        "--context-fields",
        "provider,hook.event,session.id",
        "--root",
        ROOT,
      ],
      expected: {
        command: "hooks",
        request: {
          hookAgentRuntime: false,
          hookContextEvent: "Stop",
          hookContextFields: ["provider", "hook.event", "session.id"],
          hookContextFormat: "json",
          hookPreCommit: false,
          hookPrePush: false,
          hookSubcommand: "context",
          rootPath: ROOT,
        },
      },
    },
    {
      route: "hooks run",
      args: ["hooks", "run", "stop", "--root", ROOT],
      expected: {
        command: "hooks",
        request: {
          hookAgentRuntime: false,
          hookPreCommit: false,
          hookPrePush: false,
          hookRunEvent: "stop",
          hookSubcommand: "run",
          rootPath: ROOT,
        },
      },
    },
    {
      route: "lookup features",
      args: ["lookup", "features", "hooks", "--json"],
      expected: {
        command: "lookup",
        request: {
          kind: "features",
          value: { featureId: "hooks", jsonOutput: true },
        },
      },
    },
    {
      route: "marketplace update",
      args: [
        "marketplace",
        "update",
        "demo",
        "--yes",
        "--root",
        ROOT,
        "--json",
      ],
      expected: {
        command: "marketplace",
        request: {
          jsonOutput: true,
          marketplaceName: "demo",
          marketplaceSubcommand: "update",
          options: {},
          rootPath: ROOT,
          yes: true,
        },
      },
    },
    {
      route: "release amend",
      args: [
        "release",
        "amend",
        "@a",
        "--ref",
        "@b",
        "--reason",
        "why",
        "--root",
        ROOT,
        "--json",
      ],
      expected: {
        command: "release",
        request: {
          jsonOutput: true,
          options: {},
          releaseReason: { kind: "inline", value: "why" },
          releaseRef: "@b",
          releaseSubcommand: "amend",
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "release apply",
      args: ["release", "apply", "--yes", "--root", ROOT, "--json"],
      expected: {
        command: "release",
        request: {
          jsonOutput: true,
          options: {},
          releaseSubcommand: "apply",
          rootPath: ROOT,
          yes: true,
        },
      },
    },
    {
      route: "release audit",
      args: ["release", "audit", "--root", ROOT, "--json"],
      expected: {
        command: "release",
        request: {
          jsonOutput: true,
          options: {},
          releaseSubcommand: "audit",
          rootPath: ROOT,
          yes: false,
        },
      },
    },
    {
      route: "test list",
      args: ["test", "list", "--root", ROOT, "--json"],
      expected: testRequest({ trySubcommand: "list" }),
    },
    {
      route: "test status",
      args: ["test", "status", "run-1", "--root", ROOT, "--json"],
      expected: testRequest({ tryRunId: "run-1", trySubcommand: "status" }),
    },
    {
      route: "test tail",
      args: [
        "test",
        "tail",
        "run-1",
        "--lines",
        "10",
        "--root",
        ROOT,
        "--json",
      ],
      expected: testRequest({
        tryLines: 10,
        tryRunId: "run-1",
        trySubcommand: "tail",
      }),
    },
  ];

  for (const { args, expected, route } of [...cases, ...leafCases]) {
    test(`projects the complete ${route} request`, () => {
      expect(canonical(parseCliRequest(args))).toEqual(expected);
    });
  }

  test("projects restore list mode without a backup id", () => {
    expect(canonical(parseCliRequest(["restore", "--list", "--root", ROOT, "--json"]))).toEqual({
      command: "restore",
      request: {
        backupId: undefined,
        jsonOutput: true,
        list: true,
        options: {},
        rootPath: ROOT,
        yes: false,
      },
    });
  });

  test("covers every maintained public route exactly once", () => {
    expect(
      [...cases, ...leafCases].map(({ route }) => route).toSorted()
    ).toEqual(Object.keys(CLI_ROUTE_FLAGS).toSorted());
  });

  test("keeps the hidden test worker executable with explicit protocol grammar", () => {
    expect(
      canonical(parseCliRequest(["test", "worker", "run-1", "--root", ROOT]))
    ).toEqual({
      command: "test",
      request: {
        jsonOutput: false,
        options: {},
        rootPath: ROOT,
        tryBackground: false,
        tryPlugins: [],
        tryRunId: "run-1",
        trySubcommand: "worker",
      },
    });
  });

  test("pins inline values, flags after positionals, and lookup optional values", () => {
    expect(
      canonical(
        parseCliRequest(["explain", "skill.md", `--root=${ROOT}`, "--json"])
      )
    ).toEqual({
      command: "explain",
      request: {
        jsonOutput: true,
        options: {},
        path: "skill.md",
        rootPath: ROOT,
      },
    });
    expect(
      canonical(
        parseCliRequest([
          "lookup",
          "skill",
          "tools",
          "--compat",
          "claude,codex",
          "cursor",
          "--fields",
          "--json",
        ])
      )
    ).toEqual({
      command: "lookup",
      request: {
        kind: "query",
        value: {
          jsonOutput: true,
          lookupAspects: ["tools"],
          lookupSubject: "skill",
          lookupTargets: ["claude", "codex", "cursor"],
          lookupViews: ["compat", "fields"],
        },
      },
    });
  });

  test("pins append, deduplicate, last-wins, and idempotent repeat policies", () => {
    const init = parseCliRequest([
      "init",
      "dest",
      "--adopt",
      "one",
      "--adopt=two",
      "--include",
      "ci",
      "--include",
      "ci",
      "--root",
      "/tmp/first",
      "--root",
      ROOT,
      "--json",
      "--json",
    ]);
    expect(canonical(init)).toMatchObject({
      request: {
        initAdopt: ["one", "two"],
        setupIncludes: ["ci"],
        rootPath: ROOT,
        jsonOutput: true,
      },
    });
    expect(() => parseCliRequest(["build", "--updated", "--all"])).toThrow(
      "skillset: conflicting build mode flags --updated and --all"
    );
    expect(() =>
      parseCliRequest([
        "import",
        "source",
        "--kind",
        "skill",
        "--kind",
        "plugin",
      ])
    ).toThrow("skillset: conflicting import kinds skill and plugin");
  });

  test("pins append and deduplicate policy by flag family", () => {
    const rows = [
      {
        args: ["init", "--adopt", "one", "--adopt=two"],
        expected: { request: { initAdopt: ["one", "two"] } },
      },
      {
        args: ["new", "skill", "--preset", "support", "--preset=evals"],
        expected: { request: { newPresets: ["support", "evals"] } },
      },
      {
        args: [
          "test",
          "--target",
          "codex",
          "--prompt",
          "go",
          "--plugin",
          "one",
          "--plugin=two",
        ],
        expected: { request: { tryPlugins: ["one", "two"] } },
      },
      {
        args: [
          "change",
          "add",
          "--scope",
          "plugin:one,skill:two",
          "--scope",
          "plugin:three",
          "--bump",
          "patch",
          "--reason",
          "why",
        ],
        expected: {
          request: {
            changeScopes: ["plugin:one", "skill:two", "plugin:three"],
          },
        },
      },
      {
        args: ["init", "--include", "ci", "--include=ci"],
        expected: { request: { setupIncludes: ["ci"] } },
      },
      {
        args: [
          "lookup",
          "skill",
          "--fields",
          "--fields",
          "--compat",
          "claude,codex",
          "--compat=claude",
        ],
        expected: {
          request: {
            value: {
              lookupTargets: ["claude", "codex"],
              lookupViews: ["fields", "compat"],
            },
          },
        },
      },
    ] as const;
    for (const { args, expected } of rows) {
      expect(canonical(parseCliRequest(args))).toMatchObject(expected);
    }
  });

  test("pins scalar last-wins policy across command families", () => {
    const rows = [
      {
        args: ["build", "--root", "/first", "--root", ROOT],
        expected: { rootPath: ROOT },
      },
      {
        args: ["new", "skill", "--name", "first", "--name", "second"],
        expected: { newName: "second" },
      },
      {
        args: ["new", "skill", "--id", "first", "--id", "second"],
        expected: { newId: "second" },
      },
      {
        args: ["new", "skill", "--in", "first", "--in", "second"],
        expected: { newContainer: "second" },
      },
      {
        args: ["change", "status", "--since", "first", "--since", "second"],
        expected: { changeSince: "second" },
      },
      {
        args: ["change", "list", "--group", "first", "--group", "second"],
        expected: { changeGroup: "second" },
      },
      {
        args: [
          "change",
          "add",
          "--scope",
          "plugin:a",
          "--bump",
          "patch",
          "--bump",
          "minor",
          "--reason",
          "why",
        ],
        expected: { changeBump: "minor" },
      },
      {
        args: ["check", "--ci", "--report", "first", "--report", "second"],
        expected: { ciReportPath: "second" },
      },
      {
        args: [
          "reconcile",
          "path",
          "--use",
          "source",
          "--use",
          "output",
          "--yes",
        ],
        expected: { reconcileChoice: "output" },
      },
      {
        args: [
          "hooks",
          "print",
          "--runner",
          "git",
          "--runner",
          "husky",
          "--pre-commit",
        ],
        expected: { hookRunner: "husky" },
      },
      {
        args: [
          "test",
          "--target",
          "claude",
          "--target",
          "codex",
          "--prompt",
          "go",
        ],
        expected: { tryTarget: "codex" },
      },
      {
        args: ["init", "--targets", "claude", "--targets", "codex,cursor"],
        expected: { setupTargets: ["codex", "cursor"] },
      },
      {
        args: [
          "hooks",
          "context",
          "--event",
          "Stop",
          "--format",
          "env",
          "--format",
          "json",
        ],
        expected: { hookContextFormat: "json" },
      },
      {
        args: [
          "test",
          "--target",
          "codex",
          "--prompt",
          "first",
          "--prompt",
          "second",
        ],
        expected: { tryPrompt: "second" },
      },
      {
        args: [
          "test",
          "--target",
          "codex",
          "--prompt",
          "go",
          "--timeout-ms",
          "1",
          "--timeout-ms",
          "2",
        ],
        expected: { tryTimeoutMs: 2 },
      },
      {
        args: ["test", "tail", "run", "--lines", "1", "--lines", "2"],
        expected: { tryLines: 2 },
      },
      {
        args: ["import", "source", "--from", "claude", "--from", "codex"],
        expected: { importProvider: "codex" },
      },
    ] as const;
    for (const { args, expected } of rows) {
      expect(canonical(parseCliRequest(args))).toMatchObject({
        request: expected,
      });
    }
  });

  test("pins conflict and idempotent duplicate policy", () => {
    const idempotentRows = [
      ["build", "--updated", "--updated"],
      ["build", "--json", "--json"],
      ["restore", "backup", "--yes", "--yes"],
    ] as const;
    for (const args of idempotentRows) {
      expect(() => parseCliRequest(args)).not.toThrow();
    }
    const conflictRows = [
      {
        args: ["build", "--updated", "--all"],
        message: "skillset: conflicting build mode flags --updated and --all",
      },
      {
        args: ["import", "source", "--kind", "skill", "--kind", "plugin"],
        message: "skillset: conflicting import kinds skill and plugin",
      },
      {
        args: [
          "change",
          "add",
          "--scope",
          "plugin:a",
          "--bump",
          "patch",
          "--reason",
          "one",
          "--reason-file",
          "two",
        ],
        message: "skillset: pass only one of --reason or --reason-file",
      },
      {
        args: ["lookup", "skill", "--field", "one", "--field", "two"],
        message: "skillset: pass only one --field value",
      },
    ] as const;
    for (const { args, message } of conflictRows) {
      expect(() => parseCliRequest(args)).toThrow(message);
    }
  });
});

describe("SET-300 CLI parse context", () => {
  test("resolves default and relative roots against the injected cwd", () => {
    expect(canonical(parseCliRequest(["build"], { cwd: ROOT }))).toEqual({
      command: "build",
      request: {
        jsonOutput: false,
        options: {},
        rootPath: ROOT,
        yes: false,
      },
    });
    expect(
      canonical(parseCliRequest(["build", "--root", "nested"], { cwd: ROOT }))
    ).toEqual({
      command: "build",
      request: {
        jsonOutput: false,
        options: {},
        rootPath: `${ROOT}/nested`,
        yes: false,
      },
    });
  });
});

describe("SET-299 parser failure contract", () => {
  const cases = [
    ...[
      {
        args: ["change", "add", "--scope", "plugin:demo", "--bump", "patch"],
        command: "change add",
      },
      { args: ["release", "plan"], command: "release plan" },
      { args: ["restore", "backup-id"], command: "restore" },
      { args: ["distribute", "plan"], command: "distribute plan" },
      { args: ["list"], command: "list" },
      { args: ["lookup", "hooks", "events"], command: "lookup" },
      { args: ["test"], command: "test" },
      { args: ["hooks", "print"], command: "hooks print" },
    ].flatMap(({ args, command }) => [
      {
        args: [...args, "--from", "typo"],
        command,
        message:
          "skillset: expected --from claude, codex, or cursor; also agents or skillset",
      },
      {
        args: [...args, "--kind", "typo"],
        command,
        message: "skillset: expected --kind skill, skills, plugin, or plugins",
      },
    ]),
    {
      args: ["missing"],
      command: "cli",
      message: "skillset: expected command",
    },
    {
      args: ["build", "--root"],
      command: "build",
      message: "skillset: expected value after --root",
    },
    {
      args: ["build", "--dry-run"],
      command: "build",
      message: "skillset: unknown option --dry-run",
    },
    {
      args: ["change", "add", "--jsonl"],
      command: "change add",
      message: "skillset: unknown option --jsonl",
    },
    {
      args: ["change", "add"],
      command: "change add",
      message: "skillset: change add requires at least one --scope",
    },
    {
      args: ["change", "add", "--scope", "plugin:demo"],
      command: "change add",
      message:
        "skillset: change add requires --bump major, minor, patch, or none",
    },
    {
      args: ["change", "reason", "--reason", "why"],
      command: "change reason",
      message: "skillset: change reason requires @ref",
    },
    {
      args: ["change", "amend", "--reason", "why"],
      command: "change amend",
      message: "skillset: change amend requires @ref",
    },
    {
      args: ["change", "show"],
      command: "change show",
      message: "skillset: change show requires @ref",
    },
    {
      args: ["release", "amend", "--reason", "why"],
      command: "release amend",
      message: "skillset: release amend requires @ref",
    },
    {
      args: ["build", "--json=true"],
      command: "build",
      message: "skillset: --json does not take a value",
    },
    {
      args: ["lookup", "skill", "--root", ROOT],
      command: "lookup",
      message: "skillset: --root is not supported with lookup",
    },
    {
      args: ["hooks", "print", "--runner", "git", "--root", ROOT],
      command: "hooks print",
      message: "skillset: --root is not supported with hooks print",
    },
    {
      args: ["test", "worker"],
      command: "test worker",
      message: "skillset: test worker requires run id",
    },
    {
      args: ["test", "worker", "run-1", "--json"],
      command: "test worker",
      message: "skillset: test worker only supports <run-id> and --root <path>",
    },
  ] as const;

  for (const { args, command, message } of cases) {
    test(`normalizes ${command} failures as exit 2`, () => {
      try {
        parseCliRequest(args);
        throw new Error("expected parseCliRequest to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(CliOutputError);
        expect(error).toMatchObject({ command, exitCode: 2 });
        expect((error as Error).message).toStartWith(message);
      }
    });
  }

  test("pins validation precedence for representative multiple-invalidity cases", () => {
    const rows = [
      {
        args: ["check", "--fix", "--scope", "repo"],
        message: "skillset: check --fix requires --ci",
      },
      {
        args: ["release", "plan", "--yes", "--scope", "repo"],
        message: "skillset: --scope is not supported with release commands yet",
      },
      {
        args: ["test", "declared", "--target", "codex"],
        message:
          "skillset: declared test declared cannot be combined with ad hoc test flags",
      },
      {
        args: ["init", "--adopt", "all", "--updated"],
        message:
          "skillset: build mode and scope flags are not supported with adopt; adoption always builds the full projection isolated",
      },
      {
        args: ["marketplace", "check", "--yes", "--updated"],
        message:
          "skillset: build/write options are not supported with marketplace check; it is always read-only",
      },
      {
        args: ["distribute", "plan", "--yes", "--updated"],
        message:
          "skillset: build/write options are not supported with distribute plan; it is always read-only",
      },
      {
        args: ["hooks", "context", "--scope", "repo"],
        message: "skillset: hooks context requires --event",
      },
      {
        args: ["lookup", "features", "--root", ROOT, "--fields"],
        message:
          "skillset: expected lookup features to use only an optional feature id and --json",
      },
      {
        args: ["reconcile", "path", "--yes", "--scope", "repo"],
        message: "skillset: --scope is not supported with reconcile",
      },
      {
        args: ["change", "add", "--yes", "--scope", "plugin:a"],
        message: "skillset: --yes is only supported with change ignore, change migrate, or change refresh",
      },
      {
        args: ["change", "refresh", "--updated"],
        message: "skillset: change refresh only supports @ref, --ref, --since, --yes, --json, and --root",
      },
      {
        args: ["new", "skill", "--from", "claude", "--updated"],
        message: "skillset: --updated and --all are not supported with new",
      },
    ] as const;
    for (const { args, message } of rows) {
      try {
        parseCliRequest(args);
        throw new Error("expected parseCliRequest to throw");
      } catch (error) {
        expect(error).toMatchObject({ exitCode: 2 });
        expect((error as Error).message).toBe(message);
      }
    }
  });
});
