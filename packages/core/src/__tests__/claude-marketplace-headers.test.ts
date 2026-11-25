import { describe, expect, test } from "bun:test";
import { checkProviderFormatConformance } from "@skillset/core";
import { checkClaudeMarketplace } from "../claude-format-conformance";

const archive = { source: "archive", url: "https://example.com/plugin.zip", sha256: "a".repeat(64) };
function file(extra: Record<string, unknown>) {
  return { path: ".claude-plugin/marketplace.json", content: new TextEncoder().encode(JSON.stringify({
    name: "example", owner: { name: "Publisher" }, plugins: [{ name: "demo", source: archive, ...extra }],
  })) };
}
const check = (extra: Record<string, unknown>) => checkProviderFormatConformance([file(extra)]);

describe("SET-801 marketplace archive headers", () => {
  test.each([{}, { Accept: "application/zip" }, { Authorization: "placeholder" }, { "x-forwarded": "nearby", "proxy": "nearby", "host-extra": "nearby" }])("accepts ordinary maps %j", (headers) => {
    expect(check({ headers })).toEqual({ checkedFiles: 1, issues: [], ok: true });
    expect(checkClaudeMarketplace(file({ headers }))).toEqual([]);
  });
  test.each([null, [], "header", 3, { Accept: 3 }, { Accept: null }].map((value) => [value] as const))("rejects invalid map %j", (headers) => {
    const result = check({ headers });
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "invalid-field-type")).toBe(true);
  });
  test.each(["HOST", "Cookie", "forwarded", "X_Real_IP", "x-client-ip", "true-client-ip", "client-ip", "cf-connecting-ip", "fastly-client-ip", "x-originating-ip", "x-remote-ip", "x-remote-addr", "x-cluster-client-ip", "connection", "upgrade", "transfer-encoding", "Content_Length", "te", "trailer", "expect", "Via", "x_forwarded_for", "proxy-authorization", "x-original-url"])("rejects restricted header %s", (key) => {
    const result = check({ headers: { [key]: "value" } });
    expect(result.issues.some(({ message, code }) => code === "invalid-shape" && message.includes(`headers.${key}`))).toBe(true);
  });
  test.each(["./demo", { source: "github", repo: "example/demo" }, { source: "command", command: "echo demo" }])("rejects even empty headers for nonarchive %j", (source) => {
    const result = check({ source, headers: {} });
    expect(result.issues.some(({ message, code }) => code === "invalid-shape" && message.includes("only apply to archive"))).toBe(true);
  });
  test.each(["", "echo '{}'", "x".repeat(500), "a   b"])("accepts helper within exact text limits", (headersHelper) => {
    expect(check({ headersHelper, strict: false }).ok).toBe(true);
  });
  test.each([null, 1, {}, [], "x".repeat(501), "a    b", "a\tb", "a\nb", "é"].map((value) => [value] as const))("rejects malformed helper %j", (headersHelper) => {
    const result = check({ headersHelper, strict: false });
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "invalid-field-type" || code === "invalid-shape")).toBe(true);
  });
  test.each([undefined, true])("requires explicit strict false for active helper (%j)", (strict) => {
    const result = check({ headersHelper: "echo '{}'", strict });
    expect(result.issues.some(({ message, code }) => code === "invalid-shape" && message.includes("strict: false"))).toBe(true);
  });
  test("requires a digest for the active helper's strict-validation path", () => {
    const result = check({ source: { source: "archive", url: archive.url }, headersHelper: "echo '{}'", strict: false });
    expect(result.issues.some(({ message, code }) => code === "invalid-shape" && message.includes("source.sha256"))).toBe(true);
  });
  test("empty helper has no active-helper source, digest or strict condition", () => {
    for (const source of ["./demo", { source: "archive", url: archive.url }]) expect(check({ source, headersHelper: "" }).ok).toBe(true);
  });
  test("nonarchive active helper uses one source-condition diagnostic even alongside headers", () => {
    const result = check({ source: "./demo", headers: {}, headersHelper: "echo '{}'", strict: false });
    expect(result.issues.filter(({ message }) => message.includes("only apply to archive"))).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("headersHelper");
  });
  test("does not infer conditional header violations from malformed source or strict types", () => {
    for (const patch of [{ source: null }, { source: 3 }, { source: {} }, { source: { source: "unknown" } }, { strict: "false" }]) {
      const result = check({ headersHelper: "echo '{}'", strict: false, ...patch });
      expect(result.ok).toBe(false);
      expect(result.issues.some(({ message }) => message.includes("only apply to archive") || message.includes("must set strict: false"))).toBe(false);
    }
  });
  test("does not import separate runtime header syntax filtering", () => {
    expect(check({ headers: { "space key": "line\nvalue" } }).ok).toBe(true);
  });
  test("keeps standalone manifests and unqualified binaries outside this slice", () => {
    for (const key of ["headers", "headersHelper"]) {
      const manifest = { path: ".claude-plugin/plugin.json", content: new TextEncoder().encode(JSON.stringify({ name: "demo", [key]: key === "headers" ? {} : "" })) };
      expect(checkProviderFormatConformance([manifest]).issues.some(({ code }) => code === "unknown-destination-field")).toBe(true);
    }
    expect(check({ binaries: {} }).issues.some(({ code }) => code === "unknown-destination-field")).toBe(true);
  });
});
