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

  it("classifies the closed ChatGPT root manifest as generated", () => {
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
      path: "plugins/demo/chatgpt/plugin.json",
      target: "codex",
    });

    expect(classification.file.owner).toBe("generated");
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "generated",
      selector: "plugin.json#/name",
    }));
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "generated",
      selector: "plugin.json#/interface",
    }));
    expect(classification.fields).toContainEqual(expect.objectContaining({
      owner: "generated",
      selector: "plugin.json#/xMarketplaceReviewId",
    }));
  });

  it("classifies a custom-root ChatGPT manifest from semantic target context", () => {
    const classification = classifyDestinationOwnership({
      chatGptManifest: true,
      content: encoder.encode(JSON.stringify({ name: "demo" })),
      path: "generated/openai/plugins/demo/plugin.json",
      target: "codex",
    });

    expect(classification.file.owner).toBe("generated");
    expect(classification.fields).toContainEqual(
      expect.objectContaining({ owner: "generated", selector: "plugin.json#/name" })
    );
  });

  it("classifies the closed ChatGPT marketplace catalog as generated", () => {
    const classification = classifyDestinationOwnership({
      content: encoder.encode(
        JSON.stringify({
          interface: { displayName: "Demo plugins" },
          name: "demo",
          plugins: [],
        })
      ),
      path: ".agents/plugins/marketplace.json",
      target: "codex",
    });

    expect(classification.file.owner).toBe("generated");
    expect(classification.fields).toEqual([
      expect.objectContaining({ owner: "generated", selector: "marketplace.json#/interface" }),
      expect.objectContaining({ owner: "generated", selector: "marketplace.json#/name" }),
      expect.objectContaining({ owner: "generated", selector: "marketplace.json#/plugins" }),
    ]);
  });
});
