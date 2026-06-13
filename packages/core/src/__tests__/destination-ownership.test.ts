import { describe, expect, it } from "bun:test";

import {
  DESTINATION_OWNERSHIP_VALUES,
  classifyDestinationOwnership,
} from "../destination-ownership";

const encoder = new TextEncoder();

describe("destination ownership classifier", () => {
  it("pins the ownership vocabulary", () => {
    expect(DESTINATION_OWNERSHIP_VALUES).toEqual([
      "destination-owned",
      "generated",
      "ignored",
      "overlay",
      "source-owned",
    ]);
  });

  it("classifies Codex manifest presentation assets as destination-owned", () => {
    const classification = classifyDestinationOwnership({
      content: encoder.encode(JSON.stringify({
        interface: {
          brandColor: "#10A37F",
          logo: "./assets/logo.png",
          screenshots: ["./assets/screenshot.png"],
        },
        name: "demo",
        version: "1.2.3",
        xMarketplaceReviewId: "openai-owned",
      })),
      path: ".codex-plugin/plugin.json",
      target: "codex",
    });

    expect(classification.file.owner).toBe("generated");
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "generated",
      selector: "plugin.json#/name",
    }));
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "overlay",
      selector: "plugin.json#/interface/brandColor",
    }));
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "destination-owned",
      selector: "plugin.json#/interface/logo",
    }));
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "destination-owned",
      selector: "plugin.json#/xMarketplaceReviewId",
    }));
  });
});
