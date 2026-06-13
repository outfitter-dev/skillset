import { basename } from "node:path";

import { compareStrings } from "./path";
import type { TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export const DESTINATION_OWNERSHIP_VALUES = [
  "destination-owned",
  "generated",
  "ignored",
  "overlay",
  "source-owned",
] as const;

export type DestinationOwnership = (typeof DESTINATION_OWNERSHIP_VALUES)[number];

export interface DestinationOwnershipEntry {
  readonly owner: DestinationOwnership;
  readonly reason: string;
  readonly selector: string;
}

export interface DestinationOwnershipClassification {
  readonly fields: readonly DestinationOwnershipEntry[];
  readonly file: DestinationOwnershipEntry;
}

const textDecoder = new TextDecoder();

export function classifyDestinationOwnership(args: {
  readonly content?: Uint8Array;
  readonly path: string;
  readonly target: TargetName;
}): DestinationOwnershipClassification {
  const file = classifyFileOwnership(args.path, args.target);
  const fields = args.content === undefined ? [] : classifyFieldOwnership(args.path, args.target, args.content);
  return { fields, file };
}

function classifyFileOwnership(path: string, target: TargetName): DestinationOwnershipEntry {
  if (path.endsWith("/.codex-plugin/plugin.json") || path === ".codex-plugin/plugin.json") {
    return {
      owner: "generated",
      reason: "Codex plugin manifests are generated from Skillset source, while selected metadata fields may be destination-owned.",
      selector: path,
    };
  }
  if (path.endsWith("/.claude-plugin/plugin.json") || path === ".claude-plugin/plugin.json") {
    return {
      owner: "generated",
      reason: "Claude plugin manifests are generated from Skillset source.",
      selector: path,
    };
  }
  if (target === "claude" && (path.endsWith("/.claude-plugin/marketplace.json") || path === ".claude-plugin/marketplace.json")) {
    return {
      owner: "generated",
      reason: "Claude marketplace indexes are generated from the source plugin set.",
      selector: path,
    };
  }
  return {
    owner: "source-owned",
    reason: "Distribution selected this generated file from Skillset source output.",
    selector: path,
  };
}

function classifyFieldOwnership(path: string, target: TargetName, content: Uint8Array): readonly DestinationOwnershipEntry[] {
  if (!path.endsWith("plugin.json") && !path.endsWith("marketplace.json")) return [];
  let record;
  try {
    const parsed = JSON.parse(textDecoder.decode(content)) as unknown;
    if (!isJsonRecord(parsed)) return [];
    record = parsed;
  } catch {
    return [];
  }
  if (path.endsWith("/.codex-plugin/plugin.json") || path === ".codex-plugin/plugin.json") {
    return classifyCodexPluginManifest(path, record);
  }
  if (path.endsWith("/.claude-plugin/plugin.json") || path === ".claude-plugin/plugin.json") {
    return classifyClaudePluginManifest(path, record);
  }
  if (target === "claude" && (path.endsWith("/.claude-plugin/marketplace.json") || path === ".claude-plugin/marketplace.json")) {
    return classifyClaudeMarketplace(path, record);
  }
  return [];
}

function classifyCodexPluginManifest(path: string, record: Record<string, unknown>): readonly DestinationOwnershipEntry[] {
  const entries: DestinationOwnershipEntry[] = [];
  for (const key of Object.keys(record).sort(compareStrings)) {
    if (key === "interface" && isJsonRecord(record.interface)) {
      entries.push(...classifyCodexInterface(path, record.interface));
      continue;
    }
    entries.push({
      owner: codexTopLevelGeneratedFields.has(key) ? "generated" : "destination-owned",
      reason: codexTopLevelGeneratedFields.has(key)
        ? "Skillset owns core Codex plugin manifest structure."
        : "Unknown Codex plugin top-level metadata is preserved by default during distribution sync.",
      selector: fieldSelector(path, key),
    });
  }
  return entries;
}

function classifyCodexInterface(path: string, record: Record<string, unknown>): readonly DestinationOwnershipEntry[] {
  const entries: DestinationOwnershipEntry[] = [];
  for (const key of Object.keys(record).sort(compareStrings)) {
    const owner = codexInterfaceDestinationFields.has(key)
      ? "destination-owned"
      : codexInterfaceOverlayFields.has(key)
        ? "overlay"
        : "destination-owned";
    entries.push({
      owner,
      reason: codexInterfaceReason(owner, key),
      selector: fieldSelector(path, "interface", key),
    });
  }
  return entries;
}

function classifyClaudePluginManifest(path: string, record: Record<string, unknown>): readonly DestinationOwnershipEntry[] {
  return Object.keys(record).sort(compareStrings).map((key) => ({
    owner: claudeGeneratedFields.has(key) ? "generated" : "destination-owned",
    reason: claudeGeneratedFields.has(key)
      ? "Skillset owns Claude plugin manifest fields generated from source."
      : "Unknown Claude plugin manifest metadata is preserved by default during distribution sync.",
    selector: fieldSelector(path, key),
  }));
}

function classifyClaudeMarketplace(path: string, record: Record<string, unknown>): readonly DestinationOwnershipEntry[] {
  return Object.keys(record).sort(compareStrings).map((key) => ({
    owner: key === "plugins" ? "generated" : "overlay",
    reason: key === "plugins"
      ? "Skillset owns the plugin index generated from source."
      : "Marketplace presentation metadata can be overlaid by a distribution destination.",
    selector: fieldSelector(path, key),
  }));
}

function codexInterfaceReason(owner: DestinationOwnership, key: string): string {
  if (owner === "destination-owned") {
    return codexInterfaceDestinationFields.has(key)
      ? "Marketplace-owned Codex presentation assets and policy URLs are preserved by default."
      : "Unknown Codex interface metadata is preserved by default during distribution sync.";
  }
  return "Codex interface presentation can be explicitly overlaid by the distribution destination.";
}

function fieldSelector(path: string, ...parts: readonly string[]): string {
  return `${basename(path)}#/${parts.map(escapePointerSegment).join("/")}`;
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

const codexTopLevelGeneratedFields = new Set([
  "apps",
  "author",
  "description",
  "homepage",
  "hooks",
  "keywords",
  "license",
  "mcpServers",
  "name",
  "repository",
  "skills",
  "version",
]);

const codexInterfaceDestinationFields = new Set([
  "composerIcon",
  "logo",
  "privacyPolicyURL",
  "screenshots",
  "termsOfServiceURL",
]);

const codexInterfaceOverlayFields = new Set([
  "brandColor",
  "capabilities",
  "category",
  "defaultPrompt",
  "developerName",
  "displayName",
  "longDescription",
  "shortDescription",
  "websiteURL",
]);

const claudeGeneratedFields = new Set([
  "author",
  "commands",
  "dependencies",
  "description",
  "homepage",
  "hooks",
  "keywords",
  "license",
  "mcpServers",
  "name",
  "repository",
  "skills",
  "version",
]);
