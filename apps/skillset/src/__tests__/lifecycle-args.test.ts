import { describe, expect, test } from "bun:test";

import { parseChangeCommandRequest } from "../change-args";
import {
  parseReconcileCommandRequest,
  parseRestoreCommandRequest,
} from "../recovery-args";
import { parseReleaseCommandRequest } from "../release-args";

const CONTEXT = { cwd: "/workspace/repo" } as const;

describe("SET-303 lifecycle and recovery route parsers", () => {
  test("validates recognized import metadata before ignoring it", () => {
    const cases = [
      {
        run: (flag: string, value: string) =>
          parseChangeCommandRequest(
            [
              "change",
              "add",
              "--scope",
              "plugin:demo",
              "--bump",
              "patch",
              flag,
              value,
            ],
            CONTEXT
          ),
      },
      {
        run: (flag: string, value: string) =>
          parseReleaseCommandRequest(["release", "plan", flag, value], CONTEXT),
      },
      {
        run: (flag: string, value: string) =>
          parseRestoreCommandRequest(
            ["restore", "backup-id", flag, value],
            CONTEXT
          ),
      },
    ] as const;

    for (const { run } of cases) {
      expect(() => run("--from", "typo")).toThrow(
        "skillset: expected --from claude, codex, or cursor; also agents or skillset"
      );
      expect(() => run("--kind", "typo")).toThrow(
        "skillset: expected --kind skill, skills, plugin, or plugins"
      );
    }

    expect(
      parseChangeCommandRequest(
        [
          "change",
          "add",
          "--scope",
          "plugin:demo",
          "--bump",
          "patch",
          "--from",
          "codex",
          "--kind",
          "skill",
        ],
        CONTEXT
      )
    ).toMatchObject({ changeBump: "patch", changeScopes: ["plugin:demo"] });

    expect(
      parseChangeCommandRequest(
        [
          "change",
          "add",
          "--scope",
          "plugin:demo",
          "--bump",
          "patch",
          "--from",
          "cursor",
          "--kind",
          "skill",
        ],
        CONTEXT
      )
    ).toMatchObject({ changeBump: "patch", changeScopes: ["plugin:demo"] });
  });

  test("change owns subcommands, refs, reasons, scopes, and repeat policy", () => {
    expect(
      parseChangeCommandRequest(
        [
          "change",
          "add",
          "--root",
          "nested",
          "--scope",
          "skills:first",
          "--scope=plugins:second",
          "--group",
          "release",
          "--reason",
          "why",
          "--bump",
          "minor",
          "--json",
        ],
        CONTEXT
      )
    ).toEqual({
      changeAppend: false,
      changeBump: "minor",
      changeGroup: "release",
      changeReason: { kind: "inline", value: "why" },
      changeRef: undefined,
      changeScopes: ["skills:first", "plugins:second"],
      changeSince: undefined,
      changeStaged: false,
      changeSubcommand: "add",
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo/nested",
      yes: false,
    });

    expect(
      parseChangeCommandRequest(
        [
          "change",
          "amend",
          "first",
          "--ref=second",
          "--reason-file",
          "note.md",
        ],
        CONTEXT
      )
    ).toMatchObject({
      changeReason: { kind: "file", path: "note.md" },
      changeRef: "second",
      changeSubcommand: "amend",
    });
  });

  test("release owns amend input and apply confirmation", () => {
    expect(
      parseReleaseCommandRequest(
        [
          "release",
          "amend",
          "first",
          "--ref",
          "second",
          "--reason=-",
          "--root",
          "nested",
          "--json",
        ],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      options: {},
      releaseReason: { kind: "stdin" },
      releaseRef: "second",
      releaseSubcommand: "amend",
      rootPath: "/workspace/repo/nested",
      yes: false,
    });

    expect(
      parseReleaseCommandRequest(
        ["release", "apply", "--yes", "--updated"],
        CONTEXT
      )
    ).toMatchObject({
      options: { buildMode: "updated" },
      releaseSubcommand: "apply",
      yes: true,
    });
  });

  test("recovery routes own required paths, choices, and confirmation", () => {
    expect(
      parseReconcileCommandRequest(
        [
          "reconcile",
          "plugins/example/codex",
          "--use",
          "source",
          "--root=nested",
          "--json",
          "--yes",
        ],
        CONTEXT
      )
    ).toEqual({
      jsonOutput: true,
      managedPath: "plugins/example/codex",
      options: {},
      reconcileChoice: "source",
      rootPath: "/workspace/repo/nested",
      yes: true,
    });
    expect(
      parseRestoreCommandRequest(
        ["restore", "backup-id", "--root", "nested", "--json", "--yes"],
        CONTEXT
      )
    ).toEqual({
      backupId: "backup-id",
      jsonOutput: true,
      options: {},
      rootPath: "/workspace/repo/nested",
      yes: true,
    });
  });

  test("preserves lifecycle and recovery validation precedence", () => {
    const cases = [
      {
        run: () => parseChangeCommandRequest(["change", "unknown"], CONTEXT),
        message:
          "skillset: expected change subcommand add, amend, check, history, list, reason, show, or status",
      },
      {
        run: () =>
          parseChangeCommandRequest(
            ["change", "add", "--reason", "one", "--reason-file", "two"],
            CONTEXT
          ),
        message: "skillset: pass only one of --reason or --reason-file",
      },
      {
        run: () =>
          parseChangeCommandRequest(
            ["change", "check", "--scope", "skills"],
            CONTEXT
          ),
        message:
          "skillset: change check is a whole-source command; --scope is not supported",
      },
      {
        run: () =>
          parseChangeCommandRequest(
            ["change", "add", "--use", "source"],
            CONTEXT
          ),
        message: "skillset: --use is only supported with reconcile",
      },
      {
        run: () => parseChangeCommandRequest(["change", "add"], CONTEXT),
        message: "skillset: change add requires at least one --scope",
      },
      {
        run: () =>
          parseChangeCommandRequest(
            ["change", "add", "--scope", "plugin:demo"],
            CONTEXT
          ),
        message:
          "skillset: change add requires --bump major, minor, patch, or none",
      },
      {
        run: () =>
          parseChangeCommandRequest(
            ["change", "reason", "--reason", "why"],
            CONTEXT
          ),
        message: "skillset: change reason requires @ref",
      },
      {
        run: () =>
          parseChangeCommandRequest(
            ["change", "amend", "--reason", "why"],
            CONTEXT
          ),
        message: "skillset: change amend requires @ref",
      },
      {
        run: () => parseChangeCommandRequest(["change", "show"], CONTEXT),
        message: "skillset: change show requires @ref",
      },
      {
        run: () =>
          parseReleaseCommandRequest(
            ["release", "plan", "--reason", "why", "--scope", "plugins"],
            CONTEXT
          ),
        message:
          "skillset: change options are only supported with change commands",
      },
      {
        run: () =>
          parseReleaseCommandRequest(
            ["release", "plan", "--ref", "entry", "--yes"],
            CONTEXT
          ),
        message:
          "skillset: change options are only supported with change commands",
      },
      {
        run: () =>
          parseReleaseCommandRequest(
            ["release", "plan", "--since", "origin/main"],
            CONTEXT
          ),
        message:
          "skillset: --since is only supported with check --ci or change commands",
      },
      {
        run: () =>
          parseReleaseCommandRequest(
            ["release", "plan", "--scope", "plugins", "--yes"],
            CONTEXT
          ),
        message: "skillset: --scope is not supported with release commands yet",
      },
      {
        run: () =>
          parseReleaseCommandRequest(
            ["release", "plan", "--use", "source"],
            CONTEXT
          ),
        message: "skillset: --use is only supported with reconcile",
      },
      {
        run: () =>
          parseReleaseCommandRequest(
            ["release", "amend", "--reason", "why"],
            CONTEXT
          ),
        message: "skillset: release amend requires @ref",
      },
      {
        run: () => parseReconcileCommandRequest(["reconcile"], CONTEXT),
        message: "skillset: expected a path to reconcile",
      },
      {
        run: () => parseRestoreCommandRequest(["restore"], CONTEXT),
        message: "skillset: expected backup id to restore",
      },
      {
        run: () =>
          parseReconcileCommandRequest(
            ["reconcile", "managed", "--ref", "entry"],
            CONTEXT
          ),
        message:
          "skillset: change options are only supported with change commands",
      },
      {
        run: () =>
          parseReconcileCommandRequest(
            ["reconcile", "managed", "--updated", "--since", "origin/main"],
            CONTEXT
          ),
        message:
          "skillset: --since is only supported with check --ci or change commands",
      },
      {
        run: () =>
          parseReconcileCommandRequest(
            ["reconcile", "managed", "--yes"],
            CONTEXT
          ),
        message:
          "skillset: reconcile --yes requires --use source or --use output",
      },
      {
        run: () =>
          parseRestoreCommandRequest(
            ["restore", "backup", "--updated", "--since", "origin/main"],
            CONTEXT
          ),
        message:
          "skillset: --since is only supported with check --ci or change commands",
      },
      {
        run: () =>
          parseRestoreCommandRequest(
            ["restore", "backup", "--use", "source"],
            CONTEXT
          ),
        message: "skillset: --use is only supported with reconcile",
      },
      {
        run: () =>
          parseRestoreCommandRequest(
            ["restore", "backup", "--updated", "--use", "source"],
            CONTEXT
          ),
        message: "skillset: restore only supports --root and --yes",
      },
      {
        run: () =>
          parseRestoreCommandRequest(
            ["restore", "backup", "--updated", "--scope", "plugins"],
            CONTEXT
          ),
        message: "skillset: restore only supports --root and --yes",
      },
    ] as const;
    for (const { message, run } of cases) {
      expect(run).toThrow(message);
    }
  });
});
