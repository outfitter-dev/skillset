import { describe, expect, test } from "bun:test";
import { checkProviderFormatConformance } from "@skillset/core";
import { checkClaudeMarketplace } from "../claude-format-conformance";

function marketplace(source: Record<string, unknown>) {
  return { path: ".claude-plugin/marketplace.json", content: new TextEncoder().encode(JSON.stringify({
    name: "example", owner: { name: "Publisher" }, plugins: [{ name: "demo", source }],
  })) };
}

describe("SET-799 marketplace source discriminator ownership", () => {
  test.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "unsupported-source", ""])("rejects %s through the normal diagnostic", (source) => {
    const file = marketplace({ source });
    const direct = checkClaudeMarketplace(file);
    const publicReport = checkProviderFormatConformance([file]);
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ code: "invalid-shape", target: "claude", providerRef: "claude-marketplace-schema",
      message: "destination field plugins[0].source.source must be archive, command, github, git-subdir, npm, or url" });
    expect(publicReport).toEqual({ checkedFiles: 1, issues: direct, ok: false });
  });
  test.each([
    { source: "archive", url: "https://example.com/demo.zip" },
    { source: "command", command: "printf /plugin", mode: "copy", timeout: 60 },
    { source: "github", repo: "owner/repo" },
    { source: "git-subdir", url: "https://example.com/repo.git", path: "plugins/demo" },
    { source: "npm", package: "demo-plugin" },
    { source: "url", url: "https://example.com/repo.git" },
  ])("preserves supported source $source", (source) => {
    const file = marketplace(source);
    expect(checkClaudeMarketplace(file)).toEqual([]);
    expect(checkProviderFormatConformance([file])).toEqual({ checkedFiles: 1, issues: [], ok: true });
  });
});
