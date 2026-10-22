import { describe, expect, it } from "bun:test";

import { listProviderPluginManifestFields } from "@skillset/registry";

import { checkProviderFormatConformance } from "../provider-format-conformance";
import {
  agentPluginManifestFields,
  CHATGPT_INTERFACE_FIELD_TYPES,
  CHATGPT_INTERFACE_FIELDS,
  CHATGPT_MARKETPLACE_POLICY,
  CLAUDE_PLUGIN_FIELD_TYPES,
  CLAUDE_UNPINNED_PLUGIN_FIELDS,
} from "../manifest-field-contracts";
import { jsonSchemaSummary } from "../provider-format-conformance-validation";

describe("SET-541: one manifest field contract per provider", () => {
  it("types exactly the pinned ChatGPT interface fields", () => {
    expect(Object.keys(CHATGPT_INTERFACE_FIELD_TYPES).toSorted()).toEqual(
      [...CHATGPT_INTERFACE_FIELDS].toSorted()
    );
  });

  it("types only fields a pinned Claude plugin or marketplace schema declares", () => {
    const pinned = new Set([
      ...(jsonSchemaSummary("claude-plugin-manifest-schema").properties ?? []),
      ...(jsonSchemaSummary("claude-marketplace-schema").properties ?? []),
      ...listProviderPluginManifestFields("claude"),
      ...CLAUDE_UNPINNED_PLUGIN_FIELDS,
      // Marketplace plugin entries nest under `plugins[]`, which the summary
      // flattens away; these entry-only fields come from the entry schema.
      "category", "channels", "defaultEnabled", "metadata", "relevance", "strict", "tags",
    ]);
    expect(Object.keys(CLAUDE_PLUGIN_FIELD_TYPES).filter((key) => !pinned.has(key))).toEqual([]);
  });

  it("derives the ChatGPT product enum from the schema's lower-case products", () => {
    expect(CHATGPT_MARKETPLACE_POLICY.products).toEqual(["ATLAS", "CHATGPT", "CODEX"]);
  });

  it("reads Agent Plugins root fields from the pinned schema", () => {
    const fields = agentPluginManifestFields();
    expect(fields.required).toEqual(expect.arrayContaining(["$schema", "name"]));
    expect(fields.allowed).toEqual(expect.arrayContaining(["$schema", "extensions", "name", "version"]));
  });

  it("accepts array and object component forms in a Claude plugin.json, as in a marketplace entry", () => {
    const report = checkProviderFormatConformance([
      {
        content: new TextEncoder().encode(`${JSON.stringify({
          commands: { hello: { source: "./commands/hello.md" } },
          dependencies: ["other-plugin"],
          description: "Alpha tools.",
          name: "alpha",
          settings: { agent: "reviewer" },
          skills: ["./skills/a", "./skills/b"],
        })}\n`),
        path: "plugins/alpha/.claude-plugin/plugin.json",
      },
    ]);
    expect(report.issues).toEqual([]);
  });
});
