import { describe, expect, test } from "bun:test";
import { getProviderHookEvidence } from "@skillset/registry";

import {
  CODEX_HOOK_EVENTS,
  canonicalHookEventName,
  classifyAdaptiveHookUnitPath,
  deriveCursorHookEventNames,
  hookEventSupported,
  hookHandlerTypesForEvent,
  hookProviderCapabilities,
  nativeHookEventName,
  validateAdaptiveHookUnitPaths,
} from "../hook-capabilities";
import {
  adaptiveHookEventDefinitions,
  appendAdaptiveHookAttachment,
  appendAdaptiveHookAttachmentToMarkdown,
  appendAdaptiveHookAttachmentToYaml,
  planAdaptiveHookCompatibility,
} from "../adaptive-hook-authoring";

describe("hook provider capabilities", () => {
  test("derives authoring events and compatible scopes from registry-backed capabilities", () => {
    const events = adaptiveHookEventDefinitions();
    expect(events.find((event) => event.id === "PreToolUse")?.providers).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
    expect(events.find((event) => event.id === "Notification")?.providers).toEqual([
      "claude",
    ]);
    expect(planAdaptiveHookCompatibility({
      events: ["PreToolUse"],
      run: { command: "true" },
      scope: { kind: "plugin", pluginId: "guard" },
    }).providers).toEqual(["claude", "codex", "cursor"]);
    expect(planAdaptiveHookCompatibility({
      events: ["PreToolUse"],
      run: { command: "true" },
      scope: { kind: "skill", skillId: "writer" },
    }).providers).toEqual(["claude"]);
    expect(planAdaptiveHookCompatibility({
      events: ["WorkspaceOpen"],
      run: { command: "true" },
      scope: { kind: "skill", skillId: "writer" },
    }).providers).toEqual([]);
    expect(planAdaptiveHookCompatibility({
      events: ["PreToolUse"],
      run: { script: "{{scripts.dir}}/check.sh" },
      scope: { kind: "skill", skillId: "writer" },
    }).providers).toEqual([]);
  });

  test("appends schema-valid auto attachments without replacing existing entries", () => {
    expect(appendAdaptiveHookAttachment({
      hooks: { Stop: ["existing"] },
      skillset: { name: "guard" },
    }, "shell-policy")).toEqual({
      hooks: { Stop: ["existing"], auto: ["shell-policy"] },
      skillset: { name: "guard" },
    });
    expect(() => appendAdaptiveHookAttachment({
      hooks: { auto: ["shell-policy"] },
    }, "shell-policy")).toThrow("hook attachment shell-policy already exists");
    const yaml = appendAdaptiveHookAttachmentToYaml(
      "# heading\ndescription: Guard. # keep description\ncustom:\n  beta: 2 # keep nested\n  alpha: 1\nskillset:\n  # keep name\n  name: guard\ntail: true\n",
      "shell-policy"
    );
    expect(yaml.startsWith("skillset:\n  # keep name\n  name: guard\n")).toBe(true);
    expect(yaml).toContain("# heading\ndescription: Guard. # keep description");
    expect(yaml).toContain("beta: 2 # keep nested\n  alpha: 1");
    expect(yaml.indexOf("description:")).toBeLessThan(yaml.indexOf("custom:"));
    expect(yaml.indexOf("custom:")).toBeLessThan(yaml.indexOf("tail:"));

    const markdown = appendAdaptiveHookAttachmentToMarkdown(
      "---\n# keep this comment\nname: writer\ndescription: Writer.\n---\n\nBody.\n",
      "shell-policy"
    );
    expect(markdown).toContain("# keep this comment\nname: writer");
    expect(markdown).toEndWith("---\n\nBody.\n");
  });
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
    expect(codex.matcherValuesByEvent.PreCompact).toEqual(["manual", "auto"]);
    expect(codex.matcherValuesByEvent.SessionStart).toEqual(["startup", "resume", "clear", "compact"]);
    expect(codex.runtimeNotesByEvent.PreToolUse).toContain("matcher-values-provider-native");
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

  test("records Cursor handler, scope, and native event-name constraints", () => {
    const cursorEvidence = getProviderHookEvidence("cursor");
    for (const { name } of cursorEvidence.events) {
      const native = `${name[0]?.toLowerCase()}${name.slice(1)}`;
      expect(nativeHookEventName("cursor", name), name).toBe(native);
      expect(canonicalHookEventName("cursor", native), native).toBe(name);
    }
    const extended = deriveCursorHookEventNames([
      ...cursorEvidence.events.map((event) => event.name),
      "FutureCursorEvent",
    ]);
    expect(extended.nativeByCanonical.FutureCursorEvent).toBe("futureCursorEvent");
    expect(extended.canonicalByNative.futureCursorEvent).toBe("FutureCursorEvent");
    expect(nativeHookEventName("cursor", "AfterMCPExecution")).toBe("afterMCPExecution");

    const cursor = hookProviderCapabilities.cursor;
    expect(hookEventSupported("cursor", "SessionStart")).toBe(true);
    expect(hookEventSupported("cursor", "sessionStart")).toBe(true);
    expect(nativeHookEventName("cursor", "SessionStart")).toBe("sessionStart");
    expect(canonicalHookEventName("cursor", "sessionStart")).toBe("SessionStart");
    expect([...hookHandlerTypesForEvent("cursor", "sessionStart")]).toEqual(["command"]);
    expect(cursor.asyncCommand).toBe(false);
    expect(cursor.scopeSupport.plugin).toBe("native");
    expect(cursor.scopeSupport.skill).toBe("unsupported");
    expect(cursor.scopeSupport.agent).toBe("unsupported");
    expect(cursor.runtimeNotesByEvent.SessionStart).toContain("native-event-names-are-lower-camel");
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

  test("dogfoods provider hook evidence for payload and runtime facts", () => {
    const claude = hookProviderCapabilities.claude;
    const codex = hookProviderCapabilities.codex;
    const cursor = hookProviderCapabilities.cursor;

    expect(claude.providerRefByEvent.PreToolUse).toBe("claude-hooks-overlay");
    expect(claude.matcherEvaluationByEvent.PreToolUse).toBe("exact-list-or-regex");
    expect(claude.inputFieldsByEvent.PreToolUse).toEqual(expect.arrayContaining([
      { name: "tool_input", required: false },
      { name: "tool_name", required: false },
    ]));
    expect(claude.outputFieldsByEvent.PreToolUse).toEqual(expect.arrayContaining(["permissionDecision", "permissionDecisionReason"]));
    expect(claude.canBlockByEvent.PreToolUse).toBe(true);

    expect(codex.providerRefByEvent.PreToolUse).toBe("codex-hook-event-schemas");
    expect(codex.inputFieldsByEvent.PreToolUse).toEqual(expect.arrayContaining([
      { name: "cwd", required: true },
      { name: "tool_name", required: true },
    ]));
    expect(codex.outputFieldsByEvent.PreToolUse).toEqual(["decision", "hookSpecificOutput", "reason", "systemMessage"]);
    expect(codex.rawOutputFieldsByEvent.PreToolUse).toEqual(expect.arrayContaining(["continue", "decision", "hookSpecificOutput", "stopReason", "suppressOutput"]));
    expect(codex.unsupportedOutputFieldsByEvent.PreToolUse).toEqual(["continue", "stopReason", "suppressOutput"]);
    expect(codex.handlerSkippedFieldsByType.command).toEqual(["async"]);

    expect(cursor.providerRefByEvent.BeforeSubmitPrompt).toBe("cursor-hooks-docs");
    expect(cursor.matcherEvaluationByEvent.BeforeSubmitPrompt).toBe("ignored");
    expect(cursor.canBlockByEvent.BeforeSubmitPrompt).toBe(true);
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
