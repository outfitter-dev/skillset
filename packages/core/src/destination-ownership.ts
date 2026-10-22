import { basename } from "node:path";

import { compareStrings } from "./path";
import {
  isLegacyChatGptManifestPath,
  isLegacyCodexPluginManifestPath,
  isTargetMarketplacePath,
  isTargetPluginManifestPath,
} from "./plugin-output";
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
  readonly chatGptManifest?: boolean;
  readonly content?: Uint8Array;
  readonly path: string;
  readonly target: TargetName;
}): DestinationOwnershipClassification {
  const file = classifyFileOwnership(
    args.path,
    args.target,
    args.chatGptManifest === true
  );
  const fields = args.content === undefined
    ? []
    : classifyFieldOwnership(
        args.path,
        args.target,
        args.content,
        args.chatGptManifest === true
      );
  return { fields, file };
}

type OwnedManifestKind =
  | "chatgpt-catalog"
  | "chatgpt-manifest"
  | "claude-catalog"
  | "claude-manifest"
  | "codex-legacy-manifest";

/** The one classifier both file and field ownership consult, so they cannot drift apart. */
function ownedManifestKind(
  path: string,
  target: TargetName,
  chatGptManifest: boolean
): OwnedManifestKind | undefined {
  if (target === "codex" && isTargetMarketplacePath(path, "codex")) return "chatgpt-catalog";
  if (chatGptManifest || isLegacyChatGptManifestPath(path)) return "chatgpt-manifest";
  if (isLegacyCodexPluginManifestPath(path)) return "codex-legacy-manifest";
  if (isTargetPluginManifestPath(path, "claude")) return "claude-manifest";
  if (target === "claude" && isTargetMarketplacePath(path, "claude")) return "claude-catalog";
  return undefined;
}

const OWNED_FILE_REASONS: Readonly<Record<OwnedManifestKind, string>> = {
  "chatgpt-catalog": "ChatGPT marketplace catalogs are generated from the typed Skillset marketplace contract.",
  "chatgpt-manifest": "ChatGPT Agent Plugins root manifests are generated from portable Skillset source.",
  "claude-catalog": "Claude marketplace indexes are generated from the source plugin set.",
  "claude-manifest": "Claude plugin manifests are generated from Skillset source.",
  "codex-legacy-manifest": "Codex plugin manifests are generated from Skillset source, while selected metadata fields may be destination-owned.",
};

function classifyFileOwnership(
  path: string,
  target: TargetName,
  chatGptManifest: boolean
): DestinationOwnershipEntry {
  const kind = ownedManifestKind(path, target, chatGptManifest);
  if (kind !== undefined) {
    return { owner: "generated", reason: OWNED_FILE_REASONS[kind], selector: path };
  }
  return {
    owner: "source-owned",
    reason: "Distribution selected this generated file from Skillset source output.",
    selector: path,
  };
}

function classifyFieldOwnership(
  path: string,
  target: TargetName,
  content: Uint8Array,
  chatGptManifest: boolean
): readonly DestinationOwnershipEntry[] {
  const kind = ownedManifestKind(path, target, chatGptManifest);
  if (kind === undefined) return [];
  let record;
  try {
    const parsed = JSON.parse(textDecoder.decode(content)) as unknown;
    if (!isJsonRecord(parsed)) return [];
    record = parsed;
  } catch {
    return [];
  }
  switch (kind) {
    case "chatgpt-manifest":
      return generatedFields(path, record, "Skillset owns the closed ChatGPT Agent Plugins manifest contract.");
    case "chatgpt-catalog":
      return generatedFields(path, record, "Skillset owns the closed ChatGPT marketplace catalog contract.");
    case "codex-legacy-manifest":
      return classifyCodexPluginManifest(path, record);
    case "claude-manifest":
      return classifyClaudePluginManifest(path, record);
    case "claude-catalog":
      return classifyClaudeMarketplace(path, record);
  }
}

function generatedFields(
  path: string,
  record: Record<string, unknown>,
  reason: string
): readonly DestinationOwnershipEntry[] {
  return Object.keys(record).sort(compareStrings).map((key) => ({
    owner: "generated" as const,
    reason,
    selector: fieldSelector(path, key),
  }));
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
