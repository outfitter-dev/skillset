import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(value: unknown) {
  return checkProviderFormatConformance([{
    path: "plugins/example/.codex-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify({ name: "example", interface: value })),
  }]);
}
const strings = ["displayName", "shortDescription", "longDescription", "developerName", "category",
  "websiteUrl", "websiteURL", "privacyPolicyUrl", "privacyPolicyURL", "termsOfServiceUrl",
  "termsOfServiceURL", "brandColor", "composerIcon", "logo", "logoDark"];

describe("legacy Codex interface parser conformance", () => {
  for (const field of strings) {
    it(`checks nullable string ${field}`, () => {
      for (const value of [42, false, [], {}]) {
        const report = check({ [field]: value });
        expect(report.ok).toBe(false);
        expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
          code: "invalid-field-type", message: expect.stringContaining(`interface.${field}`),
        })]));
      }
      for (const value of [null, "", "text"]) expect(check({ [field]: value }).ok).toBe(true);
    });
  }
  for (const field of ["capabilities", "screenshots"]) {
    it(`requires a string array for ${field}`, () => {
      for (const value of [null, 42, "text", {}, [42], ["ok", null]]) {
        expect(check({ [field]: value }).ok).toBe(false);
      }
      for (const value of [[], [""], ["one", "two"]]) expect(check({ [field]: value }).ok).toBe(true);
    });
  }
  for (const [canonical, alias] of [["websiteUrl", "websiteURL"], ["privacyPolicyUrl", "privacyPolicyURL"], ["termsOfServiceUrl", "termsOfServiceURL"]]) {
    it(`rejects both spellings of ${canonical}, even equal or null`, () => {
      for (const value of ["same", null]) {
        const report = check({ [canonical!]: value, [alias!]: value });
        expect(report.ok).toBe(false);
        expect(report.issues.some((entry) => entry.code === "invalid-shape")).toBe(true);
      }
    });
  }
  it("accepts absent and null interface but rejects other nonobjects", () => {
    for (const value of [undefined, null, {}]) expect(check(value).ok).toBe(true);
    for (const value of [42, false, "", []]) expect(check(value).ok).toBe(false);
  });
  it("retains the loader's tolerant defaultPrompt parsing", () => {
    for (const value of [null, 42, false, {}, [], ["good", 42, null], ""]) {
      expect(check({ defaultPrompt: value }).ok).toBe(true);
    }
  });
  it("keeps existing unknown-member diagnostics", () => {
    expect(check({ futureField: 42 }).issues[0]?.code).toBe("unknown-destination-field");
  });
  it("does not broaden the modern OpenAI extension contract", () => {
    const report = checkProviderFormatConformance([{
      path: "plugins/example/plugin.json",
      content: new TextEncoder().encode(JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "example", version: "1.0.0",
        extensions: { "com.openai": { interface: { displayName: null, defaultPrompt: 42 } } },
      })),
    }]);
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(2);
  });
});
