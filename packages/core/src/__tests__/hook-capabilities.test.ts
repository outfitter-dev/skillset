import { describe, expect, test } from "bun:test";

import {
  CODEX_HOOK_EVENTS,
  classifyAdaptiveHookUnitPath,
  hookEventSupported,
  hookProviderCapabilities,
  validateAdaptiveHookUnitPaths,
} from "../hook-capabilities";

describe("hook provider capabilities", () => {
  test("records event-level Claude and Codex hook support", () => {
    expect(hookEventSupported("claude", "Notification")).toBe(true);
    expect(hookEventSupported("codex", "Notification")).toBe(false);
    expect([...CODEX_HOOK_EVENTS].sort()).toEqual([
      "PermissionRequest",
      "PostCompact",
      "PostToolUse",
      "PreCompact",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);
  });

  test("records Codex handler, matcher, and scope constraints", () => {
    const codex = hookProviderCapabilities.codex;
    expect([...codex.handlerTypes]).toEqual(["command"]);
    expect(codex.asyncCommand).toBe(false);
    expect(codex.matcherByEvent.PreToolUse).toBe("tool");
    expect(codex.matcherByEvent.Stop).toBe("ignored");
    expect(codex.matcherByEvent.UserPromptSubmit).toBe("ignored");
    expect(codex.scopeSupport.plugin).toBe("native");
    expect(codex.scopeSupport.skill).toBe("unsupported");
    expect(codex.scopeSupport.agent).toBe("unsupported");
  });
});

describe("adaptive hook unit path rules", () => {
  test("classifies flat units, directory units, and native aggregate source", () => {
    expect(classifyAdaptiveHookUnitPath("hooks/source-change-guard.json")).toEqual({
      kind: "adaptive-unit",
      name: "source-change-guard",
      path: "hooks/source-change-guard.json",
      shape: "flat",
    });
    expect(classifyAdaptiveHookUnitPath("hooks/source-change-guard/hook.json")).toEqual({
      kind: "adaptive-unit",
      name: "source-change-guard",
      path: "hooks/source-change-guard/hook.json",
      shape: "directory-hook",
    });
    expect(classifyAdaptiveHookUnitPath("hooks/source-change-guard/source-change-guard.json")).toEqual({
      kind: "adaptive-unit",
      name: "source-change-guard",
      path: "hooks/source-change-guard/source-change-guard.json",
      shape: "directory-named",
    });
    expect(classifyAdaptiveHookUnitPath("hooks/hooks.json")).toEqual({
      kind: "native-aggregate",
      path: "hooks/hooks.json",
    });
  });

  test("reports duplicate names, ambiguous directory manifests, and aggregate collisions", () => {
    expect(validateAdaptiveHookUnitPaths([
      "hooks/hooks.json",
      "hooks/.json",
      "hooks/source-change-guard.json",
      "hooks/source-change-guard/hook.json",
      "hooks/session/session.json",
      "hooks/session/hook.json",
    ])).toEqual([
      {
        code: "hook-aggregate-collision",
        message: "hooks/hooks.json is native aggregate source and cannot be combined with adaptive hook units for the same destination",
        paths: [
          "hooks/hooks.json",
          "hooks/session/hook.json",
          "hooks/session/session.json",
          "hooks/source-change-guard.json",
          "hooks/source-change-guard/hook.json",
        ],
      },
      {
        code: "hook-directory-ambiguous",
        message: "adaptive hook directory session contains both hook.json and session.json",
        paths: ["hooks/session/hook.json", "hooks/session/session.json"],
      },
      {
        code: "hook-name-duplicate",
        message: "adaptive hook name session is defined more than once",
        paths: ["hooks/session/hook.json", "hooks/session/session.json"],
      },
      {
        code: "hook-name-duplicate",
        message: "adaptive hook name source-change-guard is defined more than once",
        paths: ["hooks/source-change-guard.json", "hooks/source-change-guard/hook.json"],
      },
      {
        code: "hook-name-invalid",
        message: "adaptive hook path must derive a non-empty hook name",
        paths: ["hooks/.json"],
      },
    ]);
  });
});
