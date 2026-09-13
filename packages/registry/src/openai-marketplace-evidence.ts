import {
  OPENAI_AGENT_PLUGIN_EVIDENCE,
  OPENAI_AGENT_PLUGIN_EVIDENCE_TAG,
} from "./openai-agent-plugin-evidence";

/**
 * Immutable evidence for the released OpenAI marketplace parser used by
 * SET-530. Current documentation may move independently; widening the
 * compiler contract requires a new parser pin and reviewed field matrix.
 */
export const OPENAI_MARKETPLACE_EVIDENCE_TAG = OPENAI_AGENT_PLUGIN_EVIDENCE_TAG;

export const OPENAI_MARKETPLACE_PARSER_EVIDENCE = (() => {
  const evidence = OPENAI_AGENT_PLUGIN_EVIDENCE.find(
    ({ id }) => id === "marketplace"
  );
  if (evidence === undefined) {
    throw new Error("skillset: missing immutable OpenAI marketplace evidence");
  }
  return evidence;
})();

export const OPENAI_MARKETPLACE_DOCUMENTATION = [
  {
    note: "Current package, catalog, source, policy, discovery, and CLI registration contract.",
    url: "https://developers.openai.com/plugins/build/plugins",
  },
  {
    note: "Current GitHub workspace import and sync boundary.",
    url: "https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github",
  },
] as const;

/** Fields reviewed for Skillset's closed ChatGPT catalog projection. */
export const OPENAI_MARKETPLACE_FIELD_MATRIX = {
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
  pluginComponentAuthorityExcluded: ["skills", "mcpServers", "apps", "hooks"],
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
} as const;

export const OPENAI_MARKETPLACE_SOURCE_MATRIX = {
  "git-subdir": {
    optional: ["ref", "sha"],
    required: ["source", "url", "path"],
  },
  local: {
    optional: [],
    required: ["source", "path"],
  },
  npm: {
    optional: ["version", "registry"],
    required: ["source", "package"],
  },
  url: {
    optional: ["ref", "sha"],
    required: ["source", "url"],
  },
} as const;

export const OPENAI_MARKETPLACE_POLICY_MATRIX = {
  authentication: ["ON_INSTALL", "ON_USE"],
  defaults: {
    authentication: "ON_INSTALL",
    installation: "AVAILABLE",
  },
  installation: ["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"],
  optional: ["products"],
  required: ["installation", "authentication"],
} as const;

export const OPENAI_MARKETPLACE_PATH_RULES = {
  assetFields: ["composerIcon", "logo", "logoDark", "screenshots"],
  catalogPath: ".agents/plugins/marketplace.json",
  relativeTo: "marketplace-root",
  requiresDotSlash: ["local.path", "git-subdir.path"],
} as const;
