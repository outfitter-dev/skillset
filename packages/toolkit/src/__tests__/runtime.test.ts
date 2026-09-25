import { describe, expect, test } from "bun:test";

import {
  readRuntimeContext,
  renderRuntimeContext,
  RUNTIME_CONTEXT_FIELD_DEFINITIONS,
  runtimeContextFieldValue,
} from "@skillset/toolkit/runtime";

describe("@skillset/toolkit runtime", () => {
  test("exports field metadata with provider availability and confidence", () => {
    expect(RUNTIME_CONTEXT_FIELD_DEFINITIONS.map((definition) => definition.field)).toEqual([
      "provider",
      "hook.event",
      "session.id",
    ]);
    expect(RUNTIME_CONTEXT_FIELD_DEFINITIONS.find((definition) => definition.field === "session.id")).toMatchObject({
      availability: { claude: "available", codex: "available", cursor: "available", unknown: "unknown" },
      confidence: "provider",
      envName: "SKILLSET_SESSION_ID",
    });
  });

  test("reads unknown, Claude, Codex, Cursor, missing, and conflicting provider context", async () => {
    const unknown = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: {},
      event: "post-tool-use",
      rootPath: "/tmp/repo",
    });
    expect(unknown.provider).toBe("unknown");
    expect(unknown.repoRoot).toBe("/tmp/repo");
    expect(runtimeContextFieldValue(unknown, "session.id")).toBeUndefined();

    const claude = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: { CLAUDE_PROJECT_DIR: "/tmp/claude", CLAUDE_SESSION_ID: "session-1" },
      event: "post-tool-use",
      stdinText: "{\"tool\":\"Write\"}",
    });
    expect(claude.provider).toBe("claude");
    expect(claude.repoRoot).toBe("/tmp/claude");
    expect(claude.payload).toEqual({ tool: "Write" });
    expect(claude.rawEnv).toEqual({
      CLAUDE_PROJECT_DIR: "/tmp/claude",
      CLAUDE_SESSION_ID: "session-1",
    });

    const codex = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: { CODEX_REPO_ROOT: "/tmp/codex", CODEX_SESSION_ID: "session-2" },
      event: "stop",
      stdinText: "{not json",
    });
    expect(codex.provider).toBe("codex");
    expect(codex.repoRoot).toBe("/tmp/codex");
    expect(codex.payload).toBeUndefined();
    expect(codex.payloadError).toContain("JSON");

    const cursor = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: { CURSOR_SESSION_ID: "session-3", SKILLSET_PROVIDER: "cursor" },
      event: "afterAgentResponse",
      rootPath: "/tmp/repo",
    });
    expect(cursor.provider).toBe("cursor");
    expect(runtimeContextFieldValue(cursor, "session.id")).toBe("session-3");
    expect(cursor.rawEnv).toEqual({
      CURSOR_SESSION_ID: "session-3",
      SKILLSET_PROVIDER: "cursor",
    });

    const nativeCursor = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: { CURSOR_SESSION_ID: "native-cursor-session" },
      event: "afterAgentResponse",
      rootPath: "/tmp/repo",
    });
    expect(nativeCursor.provider).toBe("cursor");
    expect(runtimeContextFieldValue(nativeCursor, "session.id")).toBe("native-cursor-session");

    const cursorPayload = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: {
        CURSOR_SESSION_ID: "fallback-cursor-session",
        SKILLSET_PROVIDER: "cursor",
      },
      event: "afterAgentResponse",
      rootPath: "/tmp/repo",
      stdinText: JSON.stringify({
        conversation_id: "cursor-conversation",
        generation_id: "not-a-session-id",
      }),
    });
    expect(runtimeContextFieldValue(cursorPayload, "session.id")).toBe("cursor-conversation");

    const explicitCursorSession = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: {
        CURSOR_SESSION_ID: "fallback-cursor-session",
        SKILLSET_PROVIDER: "cursor",
        SKILLSET_SESSION_ID: "explicit-session",
      },
      event: "afterAgentResponse",
      rootPath: "/tmp/repo",
      stdinText: JSON.stringify({ conversation_id: "cursor-conversation" }),
    });
    expect(runtimeContextFieldValue(explicitCursorSession, "session.id")).toBe("explicit-session");

    const explicitCursorWithMixedEnv = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: {
        CLAUDE_SESSION_ID: "wrong-claude-session",
        CURSOR_SESSION_ID: "right-cursor-session",
        SKILLSET_PROVIDER: "cursor",
      },
      event: "afterAgentResponse",
      rootPath: "/tmp/repo",
    });
    expect(explicitCursorWithMixedEnv.provider).toBe("cursor");
    expect(runtimeContextFieldValue(explicitCursorWithMixedEnv, "session.id")).toBe("right-cursor-session");

    const explicitCodexWithMixedEnv = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: {
        CLAUDE_SESSION_ID: "wrong-claude-session",
        CODEX_SESSION_ID: "right-codex-session",
        SKILLSET_PROVIDER: "codex",
      },
      event: "Stop",
      rootPath: "/tmp/repo",
    });
    expect(explicitCodexWithMixedEnv.provider).toBe("codex");
    expect(runtimeContextFieldValue(explicitCodexWithMixedEnv, "session.id")).toBe("right-codex-session");

    const conflicting = await readRuntimeContext({
      cwd: "/tmp/repo",
      env: {
        CLAUDE_SESSION_ID: "claude-session",
        CODEX_SESSION_ID: "codex-session",
        SKILLSET_PROVIDER: "codex",
        SKILLSET_SESSION_ID: "skillset-session",
      },
      event: "Stop",
      rootPath: "/tmp/repo",
    });
    expect(conflicting.provider).toBe("codex");
    expect(runtimeContextFieldValue(conflicting, "session.id")).toBe("skillset-session");
  });

  test("renders env and JSON for generated wrappers while preserving raw provider data", async () => {
    const envText = await renderRuntimeContext({
      env: {
        CLAUDE_PROJECT_DIR: "/tmp/claude",
        CLAUDE_SESSION_ID: "session 1",
        SKILLSET_HOOK_EVENT: "Stop",
        SKILLSET_PROVIDER: "claude",
      },
      event: "Stop",
      fields: ["provider", "hook.event", "session.id"],
      format: "env",
      rootPath: "/tmp/repo",
    });
    expect(envText).toBe([
      "export SKILLSET_PROVIDER=claude",
      "export SKILLSET_HOOK_EVENT=Stop",
      "export SKILLSET_SESSION_ID='session 1'",
      "",
    ].join("\n"));

    const jsonText = await renderRuntimeContext({
      env: { CODEX_REPO_ROOT: "/tmp/codex" },
      event: "PreToolUse",
      fields: ["provider", "hook.event", "session.id"],
      format: "json",
      rootPath: "/tmp/repo",
    });
    const report = JSON.parse(jsonText) as {
      readonly fields: readonly { readonly field: string }[];
      readonly hook: { readonly event: string };
      readonly provider: string;
      readonly raw: { readonly env: Record<string, string> };
      readonly session: { readonly id?: string };
    };
    expect(report.provider).toBe("codex");
    expect(report.hook.event).toBe("PreToolUse");
    expect(report.session).toEqual({});
    expect(report.raw.env.CODEX_REPO_ROOT).toBe("/tmp/codex");
    expect(report.fields.map((field) => field.field)).toEqual(["provider", "hook.event", "session.id"]);
  });
});
