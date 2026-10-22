import {
  listStandardProfileSchemaSnapshots,
  OPENAI_MARKETPLACE_FIELD_MATRIX,
  OPENAI_MARKETPLACE_POLICY_MATRIX,
} from "@skillset/registry";
import { CODEX_MARKETPLACE_PRODUCTS } from "@skillset/schema";

import { AGENT_PLUGIN_MANIFEST_SCHEMA } from "./agent-plugin-manifest";
import type { FieldType } from "./provider-format-conformance-validation";
import { isJsonRecord } from "./yaml";

/**
 * One manifest field contract per provider surface, shared by rendering and
 * conformance. Field names come from registry pins; only the field types are
 * hand-maintained, because the pinned schema snapshots carry property names
 * but not types. Tests assert every hand-typed key exists in its pin.
 */

/**
 * Claude plugin manifest field types, shared by `plugin.json` and marketplace
 * plugin entries: a marketplace entry may carry any manifest field, so the
 * same content must validate the same way in either file. Types follow the
 * Claude Code plugin manifest reference.
 */
export const CLAUDE_PLUGIN_FIELD_TYPES = {
  $schema: "string",
  agents: "string-or-string-array",
  author: "object",
  category: "string",
  channels: "array",
  commands: "string-object-or-array",
  defaultEnabled: "boolean",
  dependencies: "array",
  description: "string",
  displayName: "string",
  experimental: "object",
  homepage: "string",
  hooks: "string-object-or-array",
  keywords: "string-array",
  license: "string",
  lspServers: "string-object-or-array",
  mcpServers: "string-object-or-array",
  metadata: "object",
  monitors: "string-or-array",
  outputStyles: "string-or-string-array",
  relevance: "object",
  repository: "string",
  settings: "object",
  skills: "string-or-string-array",
  strict: "boolean",
  tags: "string-array",
  themes: "string-or-string-array",
  userConfig: "object",
  version: "string",
  workflows: "string-or-string-array",
} as const satisfies Readonly<Record<string, FieldType>>;

/**
 * Claude fields the docs accept but no pinned snapshot lists yet: the
 * `experimental` container (for `monitors` and `themes`) and `workflows`.
 * Refresh the Claude snapshots through provider maintenance to retire these.
 */
export const CLAUDE_UNPINNED_PLUGIN_FIELDS = ["experimental", "workflows"] as const;

/** ChatGPT `extensions.com.openai.interface` fields, from the pinned OpenAI marketplace evidence. */
export const CHATGPT_INTERFACE_FIELDS: readonly string[] = OPENAI_MARKETPLACE_FIELD_MATRIX.pluginInterface;

/** Types for {@link CHATGPT_INTERFACE_FIELDS}; a test pins the key sets equal. */
export const CHATGPT_INTERFACE_FIELD_TYPES = {
  brandColor: "string",
  capabilities: "string-array",
  category: "string",
  composerIcon: "string",
  defaultPrompt: "string-array",
  developerName: "string",
  displayName: "string",
  logo: "string",
  logoDark: "string",
  longDescription: "string",
  privacyPolicyUrl: "string",
  screenshots: "string-array",
  shortDescription: "string",
  termsOfServiceUrl: "string",
  websiteUrl: "string",
} as const satisfies Readonly<Record<string, FieldType>>;

/** ChatGPT marketplace policy enums: registry pins, with products upper-cased from schema. */
export const CHATGPT_MARKETPLACE_POLICY = {
  authentication: OPENAI_MARKETPLACE_POLICY_MATRIX.authentication,
  installation: OPENAI_MARKETPLACE_POLICY_MATRIX.installation,
  products: CODEX_MARKETPLACE_PRODUCTS.map((product) => product.toUpperCase()),
} as const;

/** Allowed and required root fields of the pinned Agent Plugins 1.0 manifest schema. */
export function agentPluginManifestFields(): {
  readonly allowed: readonly string[];
  readonly required: readonly string[];
} {
  for (const snapshot of listStandardProfileSchemaSnapshots("agent-plugins-1.0")) {
    const schema: unknown = JSON.parse(snapshot.body);
    if (!isJsonRecord(schema) || schema.$id !== AGENT_PLUGIN_MANIFEST_SCHEMA) continue;
    if (!isJsonRecord(schema.properties) || !Array.isArray(schema.required)) break;
    return {
      allowed: Object.keys(schema.properties),
      required: schema.required.filter((field): field is string => typeof field === "string"),
    };
  }
  throw new Error("skillset: pinned Agent Plugins manifest schema is missing");
}
