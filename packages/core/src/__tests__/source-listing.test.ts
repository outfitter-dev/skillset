import { describe, expect, test } from "bun:test";

import { readSourceListing } from "../source-listing";

describe("source listing resolution", () => {
  test("prefers canonical listing over presentation and top-level aliases", () => {
    expect(
      readSourceListing({
        category: "Legacy category",
        presentation: {
          displayName: "Presentation title",
          summary: "Presentation summary",
        },
        summary: "Legacy summary",
        title: "Legacy title",
        listing: {
          category: "Canonical category",
          display_name: "Canonical title",
          summary: "Canonical summary",
        },
      })
    ).toEqual(
      expect.objectContaining({
        category: "Canonical category",
        display_name: "Canonical title",
        summary: "Canonical summary",
      })
    );
  });

  test("normalizes legacy presentation aliases during compatibility", () => {
    expect(
      readSourceListing({
        homepage: "https://example.com",
        presentation: {
          brandColor: "#123456",
          defaultPrompt: ["Start here"],
          privacyPolicyURL: "https://example.com/privacy",
        },
      })
    ).toEqual(
      expect.objectContaining({
        color: "#123456",
        default_prompt: ["Start here"],
        privacy_policy_url: "https://example.com/privacy",
        website_url: "https://example.com",
      })
    );
  });

  test("does not imply support for the provider-native ui alias", () => {
    expect(
      readSourceListing({
        ui: { displayName: "Unsupported title" },
      })
    ).not.toHaveProperty("display_name");
  });
});
