import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(author: unknown) {
  return checkProviderFormatConformance([{
    path: "plugins/example/plugin.json",
    content: new TextEncoder().encode(JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "example", version: "1.0.0", author,
      extensions: { "com.openai": { interface: {} } },
    })),
  }]);
}

describe("Agent Plugins standard author conformance", () => {
  for (const field of ["name", "email", "url"]) {
    for (const value of [42, null, false, [], {}]) {
      it(`rejects ${field} with ${JSON.stringify(value)}`, () => {
        const report = check({ [field]: value });
        expect(report.ok).toBe(false);
        expect(report.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "invalid-field-type", outputPath: "plugins/example/plugin.json", message: expect.stringContaining(`author.${field} must be a string`) }),
        ]));
      });
    }
  }
  it("rejects unknown members", () => {
    const report = check({ name: "Example", organization: "Example" });
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.message).toContain("unknown destination field author.organization");
  });
  for (const author of [undefined, {}, { email: "a@example.com" }, { url: "https://example.com" }, { name: "" }, { name: "Example", email: "a@example.com", url: "https://example.com" }]) {
    it(`preserves optional author members: ${JSON.stringify(author)}`, () => {
      expect(check(author).ok).toBe(true);
    });
  }
});
