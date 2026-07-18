import { validateHookAttachmentsSource } from "@skillset/schema";
import YAML from "yaml";

import {
  adaptiveHookIntentIsRenderable,
  classifyAdaptiveHookIntent,
  type AdaptiveHookIntentClassification,
} from "./adaptive-hook-classifier";
import { hookProviderCapabilities } from "./hook-capabilities";
import { compareStrings } from "./path";
import { targetNames } from "./targets";
import type {
  AdaptiveHookScope,
  JsonRecord,
  SourceAdaptiveHook,
  SourceHookAttachment,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

export interface AdaptiveHookEventDefinition {
  readonly id: string;
  readonly providers: readonly TargetName[];
}

export interface AdaptiveHookCompatibilityPlan {
  readonly classifications: readonly AdaptiveHookIntentClassification[];
  readonly providers: readonly TargetName[];
}

export function adaptiveHookEventDefinitions(): readonly AdaptiveHookEventDefinition[] {
  const events = new Set<string>();
  for (const target of targetNames()) {
    for (const event of hookProviderCapabilities[target].documentedEvents) {
      events.add(event);
    }
  }
  return [...events]
    .sort(compareStrings)
    .map((id) => ({
      id,
      providers: targetNames().filter((target) =>
        hookProviderCapabilities[target].documentedEvents.has(id)
      ),
    }));
}

export function planAdaptiveHookCompatibility(input: {
  readonly events: readonly string[];
  readonly providers?: readonly TargetName[];
  readonly run: JsonRecord;
  readonly scope: AdaptiveHookScope;
}): AdaptiveHookCompatibilityPlan {
  const requested = input.providers ?? targetNames();
  const definition = hookDefinition(
    input.events,
    input.run,
    input.scope,
    requested
  );
  const attachment = hookAttachment(input.scope, requested);
  const surface = input.scope.kind === "plugin" ? "plugin" : "frontmatter";
  const classifications = requested.flatMap((target) =>
    input.events.map((event) =>
      classifyAdaptiveHookIntent({ attachment, definition, event }, target, surface)
    )
  );
  return {
    classifications,
    providers: requested.filter((target) =>
      classifications
        .filter((classification) => classification.target === target)
        .every(adaptiveHookIntentIsRenderable)
    ),
  };
}

export function appendAdaptiveHookAttachment(
  document: JsonRecord,
  hook: string
): JsonRecord {
  const current = document.hooks;
  if (current !== undefined && !isJsonRecord(current)) {
    throw new Error("skillset: hook attachment owner has non-object hooks");
  }
  const hooks = current ?? {};
  const auto = hooks.auto;
  if (auto !== undefined && !Array.isArray(auto)) {
    throw new Error("skillset: hook attachment owner has non-array hooks.auto");
  }
  const entries = auto ?? [];
  if (entries.some((entry) => entry === hook || (isJsonRecord(entry) && entry.hook === hook))) {
    throw new Error(`skillset: hook attachment ${hook} already exists`);
  }
  const next = {
    ...document,
    hooks: {
      ...hooks,
      auto: [...entries, hook],
    },
  };
  const diagnostics = validateHookAttachmentsSource(next.hooks).diagnostics;
  if (diagnostics.length > 0) {
    throw new Error(
      `skillset: hook attachment failed schema validation: ${diagnostics.map((item) => item.message).join("; ")}`
    );
  }
  return next;
}

export function appendAdaptiveHookAttachmentToYaml(
  source: string,
  hook: string
): string {
  const document = YAML.parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`skillset: hook attachment owner is not valid YAML: ${document.errors[0]?.message ?? "unknown error"}`);
  }
  const current = document.toJS() as unknown;
  if (!isJsonRecord(current)) {
    throw new Error("skillset: hook attachment owner must contain a YAML object");
  }
  const next = appendAdaptiveHookAttachment(current, hook);
  document.setIn(["hooks", "auto"], (next.hooks as JsonRecord).auto);
  return document.toString({ lineWidth: 0 });
}

export function appendAdaptiveHookAttachmentToMarkdown(
  source: string,
  hook: string
): string {
  const normalized = source.replaceAll(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    throw new Error("skillset: hook attachment owner requires Markdown frontmatter");
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    throw new Error("skillset: hook attachment owner has unclosed Markdown frontmatter");
  }
  const frontmatter = lines.slice(1, closingIndex).join("\n");
  const updated = appendAdaptiveHookAttachmentToYaml(frontmatter, hook).trimEnd();
  return ["---", updated, "---", ...lines.slice(closingIndex + 1)].join("\n");
}

function hookDefinition(
  events: readonly string[],
  run: JsonRecord,
  scope: AdaptiveHookScope,
  providers: readonly TargetName[]
): SourceAdaptiveHook {
  return {
    events,
    frontmatter: { events: [...events], providers: [...providers], run },
    name: "authoring-preview",
    providers,
    scope,
    scriptReferences: [],
    sourcePath: "authoring-preview/hooks/authoring-preview.json",
  };
}

function hookAttachment(
  scope: AdaptiveHookScope,
  providers: readonly TargetName[]
): SourceHookAttachment {
  return {
    hook: "authoring-preview",
    providers,
    scope,
    sourcePath: "authoring-preview/owner",
  };
}
