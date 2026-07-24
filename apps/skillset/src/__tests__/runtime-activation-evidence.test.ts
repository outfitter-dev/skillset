import { expect, test } from "bun:test";

import { runtimeActivationEvidence } from "../runtime-activation-evidence";

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

test("extracts Claude and Cursor MCP tool-use blocks", () => {
  const stdout = JSON.stringify({
    message: {
      content: [
        { name: "mcp__github__get_issue", type: "tool_use" },
        { name: "Bash", type: "tool_use" },
      ],
    },
    type: "assistant",
  });

  expect(runtimeActivationEvidence("claude", stdout)).toEqual([
    { capability: "mcp-server", subject: "github" },
  ]);
  expect(runtimeActivationEvidence("cursor", stdout)).toEqual([
    { capability: "mcp-server", subject: "github" },
  ]);
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
