import { describe, expect, it } from "bun:test";

import { TARGET_NAMES } from "@skillset/schema";

import { classifyDestinationOwnership } from "../destination-ownership";
import {
  claudeMarketplacePath,
  chatGptMarketplacePath,
  cursorMarketplacePath,
  isTargetMarketplacePath,
  isTargetPluginManifestPath,
  LEGACY_CODEX_PLUGIN_MANIFEST,
  pluginManifestPath,
} from "../plugin-output";
import { checkProviderFormatConformance } from "../provider-format-conformance";

const encoder = new TextEncoder();

/** Every manifest and catalog path a build can write, plus the legacy Codex manifest it still validates. */
function manifestAndCatalogPaths(): readonly string[] {
  return [
    ...TARGET_NAMES.map((target) => pluginManifestPath("plugins", target, { id: "alpha" })),
    `plugins/alpha/${LEGACY_CODEX_PLUGIN_MANIFEST}`,
    claudeMarketplacePath("plugins"),
    cursorMarketplacePath("plugins"),
    chatGptMarketplacePath(),
  ];
}

describe("SET-542: manifest and marketplace path predicates", () => {
  it("matches each target's own manifest and catalog and nothing else", () => {
    for (const target of TARGET_NAMES) {
      for (const other of TARGET_NAMES) {
        const manifest = pluginManifestPath("plugins", other, { id: "alpha" });
        expect(isTargetPluginManifestPath(manifest, target)).toBe(
          target === other && target !== "codex"
        );
      }
    }
    expect(isTargetMarketplacePath(claudeMarketplacePath("plugins"), "claude")).toBe(true);
    expect(isTargetMarketplacePath(cursorMarketplacePath("plugins"), "cursor")).toBe(true);
    expect(isTargetMarketplacePath(chatGptMarketplacePath(), "codex")).toBe(true);
    expect(isTargetMarketplacePath(claudeMarketplacePath("plugins"), "cursor")).toBe(false);
  });

  it("keeps file and field ownership in agreement for every manifest and catalog", () => {
    for (const path of manifestAndCatalogPaths()) {
      for (const target of TARGET_NAMES) {
        const classification = classifyDestinationOwnership({
          content: encoder.encode(`${JSON.stringify({ name: "alpha" })}\n`),
          path,
          target,
        });
        expect(classification.fields.length > 0).toBe(classification.file.owner === "generated");
      }
    }
  });

  it("dispatches a conformance validator for every manifest and catalog path", () => {
    for (const path of manifestAndCatalogPaths()) {
      const report = checkProviderFormatConformance([
        { content: encoder.encode("not json"), path },
      ]);
      expect({ path, validated: report.issues.length > 0 }).toEqual({ path, validated: true });
    }
  });
});
