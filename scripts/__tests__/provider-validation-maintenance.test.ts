import { describe, expect, test } from "bun:test";

import {
  checkProviderValidationUpstreams,
  renderProviderValidationUpstreamReport,
} from "../provider-validation-maintenance";
import type { ProviderValidationUpstreamFetch } from "../provider-validation-maintenance";

const CHECKED_AT = "2026-09-12T00:02:00.000Z";

describe("SET-500 provider validation upstream maintenance", () => {
  test("resolves all four authoritative upstream identities", async () => {
    const report = await checkProviderValidationUpstreams(
      CHECKED_AT,
      upstreamFetch()
    );

    expect(
      report.results.map(({ lane, status }) => ({ lane, status }))
    ).toEqual([
      { lane: "agent-skills-reference", status: "current" },
      { lane: "claude-product", status: "current" },
      { lane: "codex-authoring", status: "current" },
      { lane: "cursor-authoring", status: "current" },
    ]);
    expect(report.results.map(({ freshness }) => freshness)).toEqual([
      "validation-current",
      "validation-current",
      "validation-current",
      "validation-current",
    ]);
    expect(report.ok).toBe(true);
  });

  test("reports upstream change and refresh failure separately", async () => {
    const report = await checkProviderValidationUpstreams(
      CHECKED_AT,
      upstreamFetch({ claudeVersion: "2.1.270", failCursor: true })
    );
    const byLane = Object.fromEntries(
      report.results.map((result) => [result.lane, result])
    );

    expect(byLane["claude-product"]).toMatchObject({
      freshness: "upstream-changed",
      status: "changed",
      upstreamPin: "@anthropic-ai/claude-code@2.1.270",
    });
    expect(byLane["cursor-authoring"]).toMatchObject({
      freshness: "refresh-failed",
      status: "refresh-failed",
    });
    expect(byLane["cursor-authoring"]?.error).toContain("503 Unavailable");
    expect(report.ok).toBe(false);
    const rendered = renderProviderValidationUpstreamReport(report);
    expect(rendered).toContain("| changed | upstream-changed |");
    expect(rendered).toContain("| refresh-failed | refresh-failed |");
  });
});

function upstreamFetch(
  options: {
    readonly claudeVersion?: string;
    readonly failCursor?: boolean;
  } = {}
): ProviderValidationUpstreamFetch {
  return async (url) => {
    if (url.includes("cursor/plugins") && options.failCursor === true)
      return response({}, false, 503, "Unavailable");
    if (url.includes("claude-code/latest"))
      return response({ version: options.claudeVersion ?? "2.1.269" });
    if (url.endsWith("openai/codex/releases/latest"))
      return response({ tag_name: "rust-v0.154.0" });
    if (url.includes("openai/codex/commits/"))
      return response({ sha: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340" });
    if (url.includes("cursor/plugins"))
      return response({ sha: "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d" });
    if (url.includes("agentskills/agentskills"))
      return response({ sha: "69ef37e9424c0a7ea9dd2293b559e43ec8176379" });
    throw new Error(`unexpected URL ${url}`);
  };
}

function response(
  value: Record<string, unknown>,
  ok = true,
  status = 200,
  statusText = "OK"
) {
  return {
    ok,
    status,
    statusText,
    text: async () => JSON.stringify(value),
  };
}
