import { expect, test } from "bun:test";

import {
  RUNTIME_ACTIVATION_EVIDENCE_CAPABILITIES,
  runtimeActivationEvidence,
  supportsRuntimeActivationEvidence,
} from "../runtime-activation-evidence";

test("declares the proof capabilities structured runtime evidence can corroborate", () => {
  expect(RUNTIME_ACTIVATION_EVIDENCE_CAPABILITIES).toEqual(["mcp-server"]);
  expect(
    supportsRuntimeActivationEvidence({
      capability: "mcp-server",
      subject: "github",
    })
  ).toBe(true);
  expect(
    supportsRuntimeActivationEvidence({ capability: "app", subject: "demo" })
  ).toBe(false);
  expect(
    supportsRuntimeActivationEvidence({
      capability: "plugin-dependency",
      subject: "demo",
    })
  ).toBe(false);
});

test("extracts completed Codex MCP calls without trusting response text", () => {
  const stdout = [
    "github was definitely used",
    JSON.stringify({
      item: {
        server: "github",
        tool: "get_issue",
        type: "mcp_tool_call",
      },
      type: "item.completed",
    }),
    JSON.stringify({
      item: {
        error: "failed",
        server: "linear",
        type: "mcp_tool_call",
      },
      type: "item.completed",
    }),
  ].join("\n");

  expect(runtimeActivationEvidence("codex", stdout)).toEqual([
    { capability: "mcp-server", subject: "github" },
  ]);
});

test("extracts completed Claude and Cursor MCP tool-use blocks", () => {
  const stdout = [
    JSON.stringify({
      message: {
        content: [
          {
            id: "toolu_github",
            name: "mcp__github__get_issue",
            type: "tool_use",
          },
          { id: "toolu_bash", name: "Bash", type: "tool_use" },
        ],
      },
      type: "assistant",
    }),
    JSON.stringify({
      message: {
        content: [
          {
            content: "issue details",
            is_error: false,
            tool_use_id: "toolu_github",
            type: "tool_result",
          },
          {
            content: "shell output",
            tool_use_id: "toolu_bash",
            type: "tool_result",
          },
        ],
      },
      type: "user",
    }),
  ].join("\n");

  expect(runtimeActivationEvidence("claude", stdout)).toEqual([
    { capability: "mcp-server", subject: "github" },
  ]);
  expect(runtimeActivationEvidence("cursor", stdout)).toEqual([
    { capability: "mcp-server", subject: "github" },
  ]);
});

test("rejects failed and uncorrelated Claude and Cursor MCP tool results", () => {
  const stdout = [
    JSON.stringify({
      message: {
        content: [
          {
            id: "toolu_failed",
            name: "mcp__github__get_issue",
            type: "tool_use",
          },
          {
            id: "toolu_missing",
            name: "mcp__linear__get_issue",
            type: "tool_use",
          },
        ],
      },
      type: "assistant",
    }),
    JSON.stringify({
      message: {
        content: [
          {
            content: "permission denied",
            is_error: true,
            tool_use_id: "toolu_failed",
            type: "tool_result",
          },
          {
            content: "unrelated",
            tool_use_id: "toolu_unknown",
            type: "tool_result",
          },
        ],
      },
      type: "user",
    }),
  ].join("\n");

  expect(runtimeActivationEvidence("claude", stdout)).toEqual([]);
  expect(runtimeActivationEvidence("cursor", stdout)).toEqual([]);
});

test("rejects malformed Claude and Cursor tool-result error markers", () => {
  for (const isError of ["true", 1, { code: "failed" }, null]) {
    const stdout = [
      JSON.stringify({
        message: {
          content: [
            {
              id: "toolu_malformed_error",
              name: "mcp__github__get_issue",
              type: "tool_use",
            },
          ],
        },
        type: "assistant",
      }),
      JSON.stringify({
        message: {
          content: [
            {
              content: "failed",
              is_error: isError,
              tool_use_id: "toolu_malformed_error",
              type: "tool_result",
            },
          ],
        },
        type: "user",
      }),
    ].join("\n");

    expect(runtimeActivationEvidence("claude", stdout)).toEqual([]);
    expect(runtimeActivationEvidence("cursor", stdout)).toEqual([]);
  }
});

test("rejects tool-shaped blocks outside provider message roles", () => {
  const wrongRequestRole = [
    JSON.stringify({
      message: {
        content: [
          {
            id: "toolu_wrong_request",
            name: "mcp__github__get_issue",
            type: "tool_use",
          },
        ],
      },
      type: "metadata",
    }),
    JSON.stringify({
      message: {
        content: [
          {
            content: "issue details",
            tool_use_id: "toolu_wrong_request",
            type: "tool_result",
          },
        ],
      },
      type: "user",
    }),
  ].join("\n");
  const wrongResultRole = [
    JSON.stringify({
      message: {
        content: [
          {
            id: "toolu_wrong_result",
            name: "mcp__github__get_issue",
            type: "tool_use",
          },
        ],
      },
      type: "assistant",
    }),
    JSON.stringify({
      message: {
        content: [
          {
            content: "issue details",
            tool_use_id: "toolu_wrong_result",
            type: "tool_result",
          },
        ],
      },
      type: "metadata",
    }),
  ].join("\n");

  for (const target of ["claude", "cursor"] as const) {
    expect(runtimeActivationEvidence(target, wrongRequestRole)).toEqual([]);
    expect(runtimeActivationEvidence(target, wrongResultRole)).toEqual([]);
  }
});

test("ignores generic and malformed provider output", () => {
  expect(
    runtimeActivationEvidence(
      "codex",
      [
        JSON.stringify({
          item: { server: "github", type: "mcp_tool_call" },
          type: "item.started",
        }),
        JSON.stringify({
          message: {
            content: [{ name: "mcp__github__read", type: "tool_use" }],
          },
          type: "assistant",
        }),
        "Used github successfully.",
      ].join("\n")
    )
  ).toEqual([]);
  expect(
    runtimeActivationEvidence(
      "claude",
      JSON.stringify({
        message: {
          content: [{ name: "mcp____tool", type: "tool_use" }],
        },
      })
    )
  ).toEqual([]);
});
