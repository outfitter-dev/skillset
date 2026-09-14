import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  runStandardProfileMaintenance,
  type StandardProfileFetch,
} from "../index";

const CURRENT_FIXTURES = {
  "https://raw.githubusercontent.com/agentsmd/agents.md/main/README.md":
    "agent-instructions.md",
  "https://raw.githubusercontent.com/agentskills/agentskills/main/docs/specification.mdx":
    "agent-skills.mdx",
  "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/spec/1.0.0.md":
    "agent-plugins.md",
  "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json":
    "mcp.schema.json",
  "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json":
    "plugin.schema.json",
} as const;

describe("SET-397 standard profile maintenance", () => {
  test("matches recorded upstream bytes through the current raw source URLs", async () => {
    const fetcher = fixtureFetcher();
    const report = await runStandardProfileMaintenance("check", { fetcher });

    expect(report).toMatchObject({
      changed: 0,
      command: "check",
      errors: 0,
      ok: true,
      wrote: false,
    });
    expect(report.results.every((result) => result.status === "matched")).toBe(
      true
    );
  });

  test("reports drift and never adopts it from either diff or update", async () => {
    const fetcher = fixtureFetcher(
      "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json"
    );
    const report = await runStandardProfileMaintenance("update", { fetcher });

    expect(report).toMatchObject({
      changed: 1,
      command: "update",
      errors: 0,
      ok: true,
      wrote: false,
    });
    expect(
      report.results.find((result) => result.id === "agent-plugins-1.0")
    ).toMatchObject({ lifecycle: "candidate", status: "changed" });
  });

  test("distinguishes an unavailable current source from a changed source", async () => {
    const unavailable =
      "https://raw.githubusercontent.com/agentsmd/agents.md/main/README.md";
    const fetcher: StandardProfileFetch = async (url) =>
      url === unavailable
        ? {
            ok: false,
            status: 503,
            statusText: "Unavailable",
            text: async () => "",
          }
        : fixtureResponse(url);
    const report = await runStandardProfileMaintenance("check", { fetcher });

    expect(report).toMatchObject({
      changed: 0,
      errors: 1,
      ok: false,
      wrote: false,
    });
    expect(
      report.results.find((result) => result.id === "agent-instructions")
    ).toMatchObject({ status: "error" });
  });
});

function fixtureFetcher(changedUrl?: string): StandardProfileFetch {
  return async (url) => fixtureResponse(url, url === changedUrl);
}

async function fixtureResponse(url: string, changed = false) {
  const fixture = CURRENT_FIXTURES[url as keyof typeof CURRENT_FIXTURES];
  if (fixture === undefined) {
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    };
  }
  const body = await readFile(
    join(import.meta.dir, "fixtures/standard-profiles", fixture),
    "utf8"
  );
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => body + (changed ? "upstream drift" : ""),
  };
}
