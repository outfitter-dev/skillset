import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(metadata: unknown) {
  return checkProviderFormatConformance([{
    path: ".cursor-plugin/marketplace.json",
    content: new TextEncoder().encode(JSON.stringify({ name: "example", plugins: [], metadata })),
  }]);
}

describe("Cursor marketplace metadata", () => {
  for (const description of [42, null, false, [], {}]) {
    it(`rejects malformed description ${JSON.stringify(description)}`, () => {
      const report = check({ description });
      expect(report.ok).toBe(false);
      expect(report.issues).toEqual([expect.objectContaining({
        code: "invalid-field-type", outputPath: ".cursor-plugin/marketplace.json",
        providerRef: "cursor-marketplace-schema",
        message: expect.stringContaining("metadata.description must be a string"),
      })]);
    });
  }
  for (const metadata of [undefined, {}, { description: "" }, { description: "Example" }, { arbitrary: { numbers: [1, 2], enabled: false } }, { description: "Example", arbitrary: null }]) {
    it(`preserves optional description and open extras ${JSON.stringify(metadata)}`, () => {
      expect(check(metadata).ok).toBe(true);
    });
  }
});
