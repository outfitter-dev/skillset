import { describe, expect, test } from "bun:test";

import {
  OPENAI_MARKETPLACE_DOCUMENTATION,
  OPENAI_MARKETPLACE_EVIDENCE_TAG,
  OPENAI_MARKETPLACE_FIELD_MATRIX,
  OPENAI_MARKETPLACE_PATH_RULES,
  OPENAI_MARKETPLACE_PARSER_EVIDENCE,
  OPENAI_MARKETPLACE_POLICY_MATRIX,
  OPENAI_MARKETPLACE_SOURCE_MATRIX,
} from "../openai-marketplace-evidence";

describe("SET-530 immutable OpenAI marketplace evidence", () => {
  test("pins the released parser independently of mutable documentation", () => {
    expect(OPENAI_MARKETPLACE_EVIDENCE_TAG).toBe(
      "36eab01061df3cde5f95ec20a526777b430091ba"
    );
    expect(OPENAI_MARKETPLACE_PARSER_EVIDENCE).toEqual({
      hash: "sha256:eba7fed810eed705a2ff6bf73af2b7a879cabaca7807f5df36a73a01b6ff9795",
      id: "marketplace",
      path: "codex-rs/core-plugins/src/marketplace.rs",
    });
    expect(
      OPENAI_MARKETPLACE_DOCUMENTATION.every(({ url }) =>
        url.startsWith("https://")
      )
    ).toBe(true);
  });

  test("keeps the reviewed catalog field boundary closed", () => {
    expect(OPENAI_MARKETPLACE_FIELD_MATRIX).toEqual({
      catalog: ["name", "interface", "plugins"],
      catalogInterface: ["displayName"],
      plugin: [
        "name",
        "source",
        "policy",
        "category",
        "version",
        "description",
        "keywords",
        "author",
        "homepage",
        "interface",
      ],
      pluginAuthor: ["name", "email", "url"],
      pluginCompatibilityInput: ["displayName"],
      pluginComponentAuthorityExcluded: [
        "skills",
        "mcpServers",
        "apps",
        "hooks",
      ],
      pluginInterface: [
        "brandColor",
        "capabilities",
        "category",
        "composerIcon",
        "defaultPrompt",
        "developerName",
        "displayName",
        "logo",
        "logoDark",
        "longDescription",
        "privacyPolicyUrl",
        "screenshots",
        "shortDescription",
        "termsOfServiceUrl",
        "websiteUrl",
      ],
      workspaceImportOnly: ["pluginId"],
    });
  });

  test("pins the source unions and policy defaults", () => {
    expect(OPENAI_MARKETPLACE_SOURCE_MATRIX).toEqual({
      "git-subdir": {
        optional: ["ref", "sha"],
        required: ["source", "url", "path"],
      },
      local: { optional: [], required: ["source", "path"] },
      npm: {
        optional: ["version", "registry"],
        required: ["source", "package"],
      },
      url: {
        optional: ["path", "ref", "sha"],
        required: ["source", "url"],
      },
    });
    expect(OPENAI_MARKETPLACE_POLICY_MATRIX).toEqual({
      authentication: ["ON_INSTALL", "ON_USE"],
      defaults: {
        authentication: "ON_INSTALL",
        installation: "AVAILABLE",
      },
      installation: ["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"],
      optional: ["products"],
      required: ["installation", "authentication"],
    });
    expect(OPENAI_MARKETPLACE_PATH_RULES).toEqual({
      assetFields: ["composerIcon", "logo", "logoDark", "screenshots"],
      catalogPath: ".agents/plugins/marketplace.json",
      relativeTo: "marketplace-root",
      requiresDotSlash: ["local.path", "git-subdir.path", "url.path"],
    });
  });
});
