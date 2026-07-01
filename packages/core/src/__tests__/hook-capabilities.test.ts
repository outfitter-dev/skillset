import { describe, expect, test } from "bun:test";

import {
  CODEX_HOOK_EVENTS,
  classifyAdaptiveHookUnitPath,
  hookEventSupported,
  hookHandlerTypesForEvent,
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

  test("records provider matcher constraints", () => {
    const claude = hookProviderCapabilities.claude;
    expect(claude.matcherByEvent.PreToolUse).toBe("tool");
    expect(claude.matcherByEvent.PermissionDenied).toBe("tool");
    expect(claude.matcherByEvent.SessionStart).toBe("session-source");
    expect(claude.matcherByEvent.PreCompact).toBe("compact-trigger");
    expect(claude.matcherByEvent.PostCompact).toBe("compact-trigger");
    expect(claude.matcherByEvent.SubagentStart).toBe("agent-type");
    expect(claude.matcherByEvent.Setup).toBe("setup-trigger");
    expect(claude.matcherByEvent.Notification).toBe("notification-type");
    expect(claude.matcherByEvent.InstructionsLoaded).toBe("instructions-load-reason");
    expect(claude.matcherByEvent.Stop).toBe("ignored");
    expect(claude.matcherByEvent.UserPromptSubmit).toBe("ignored");
    expect(claude.matcherValuesByEvent.PreCompact).toEqual(["manual", "auto"]);
    expect(claude.matcherValuesByEvent.SessionStart).toEqual(["startup", "resume", "clear", "compact"]);
    expect(claude.matcherValuesByEvent.StopFailure).toContain("rate_limit");

    const codex = hookProviderCapabilities.codex;
    expect(codex.matcherByEvent.PreToolUse).toBe("tool");
    expect(codex.matcherByEvent.PermissionRequest).toBe("tool");
    expect(codex.matcherByEvent.SessionStart).toBe("session-source");
    expect(codex.matcherByEvent.PreCompact).toBe("compact-trigger");
    expect(codex.matcherByEvent.Stop).toBe("ignored");
    expect(codex.matcherByEvent.UserPromptSubmit).toBe("ignored");
    expect(codex.matcherValuesByEvent.PreCompact).toEqual([]);
  });

  test("records Codex handler and scope constraints", () => {
    const codex = hookProviderCapabilities.codex;
    expect([...codex.handlerTypes]).toEqual(["command"]);
    expect(codex.asyncCommand).toBe(false);
    expect([...hookHandlerTypesForEvent("codex", "PreToolUse")]).toEqual(["command"]);
    expect(codex.scopeSupport.plugin).toBe("native");
    expect(codex.scopeSupport.skill).toBe("unsupported");
    expect(codex.scopeSupport.agent).toBe("unsupported");
  });

  test("records Claude event-specific handler constraints", () => {
    for (const event of hookProviderCapabilities.claude.documentedEvents) {
      expect([...hookHandlerTypesForEvent("claude", event)], event).not.toEqual([]);
    }
    expect([...hookHandlerTypesForEvent("claude", "PreToolUse")].sort()).toEqual(["agent", "command", "http", "mcp_tool", "prompt"]);
    expect([...hookHandlerTypesForEvent("claude", "PreCompact")].sort()).toEqual(["command", "http", "mcp_tool"]);
    expect([...hookHandlerTypesForEvent("claude", "SessionStart")].sort()).toEqual(["command", "mcp_tool"]);
    expect([...hookHandlerTypesForEvent("claude", "MessageDisplay")].sort()).toEqual(["command", "http", "mcp_tool"]);
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
    expect(classifyAdaptiveHookUnitPath("hooks/hooks-cursor.json")).toEqual({
      kind: "ignored",
      path: "hooks/hooks-cursor.json",
    });
  });

  test("reports duplicate names, ambiguous directory manifests, and aggregate collisions", () => {
    expect(validateAdaptiveHookUnitPaths([
      "hooks/hooks.json",
      "hooks/hooks-cursor.json",
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
