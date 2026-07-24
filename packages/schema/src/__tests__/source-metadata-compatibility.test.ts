import { describe, expect, test } from "bun:test";

import { diagnoseSourceMetadataCompatibility } from "../source-metadata-compatibility";

describe("source metadata compatibility", () => {
  test("reports legacy listing fields with canonical replacements", () => {
    const diagnostics = diagnoseSourceMetadataCompatibility({
      category: "developer-tools",
      presentation: { displayName: "Example" },
      summary: "Short description",
      title: "Example",
    });

    expect(diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      {
        code: "source-metadata/legacy-title",
        path: "$.skillset.title",
      },
      {
        code: "source-metadata/legacy-summary",
        path: "$.skillset.summary",
      },
      {
        code: "source-metadata/legacy-category",
        path: "$.skillset.category",
      },
      {
        code: "source-metadata/legacy-presentation",
        path: "$.skillset.presentation",
      },
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  test("explains the advanced owner and version compatibility roles", () => {
    const diagnostics = diagnoseSourceMetadataCompatibility({
      author: { name: "Author" },
      owner: { name: "Publisher" },
      version: "1.2.3",
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "source-metadata/legacy-owner",
      "source-metadata/legacy-version",
    ]);
  });

  test("does not warn for canonical listing metadata", () => {
    expect(
      diagnoseSourceMetadataCompatibility({
        author: { name: "Author" },
        listing: {
          display_name: "Example",
          summary: "Short description",
        },
      })
    ).toEqual([]);
  });
});
