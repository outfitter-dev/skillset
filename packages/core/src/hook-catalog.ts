import {
  getCodexHookSchemaSummaries,
  getProviderHookEvidence,
  type ProviderHookEventEvidence,
} from "@skillset/registry";
import { HOOK_CATALOG_VERSION } from "@skillset/schema";

import { adaptiveHookEventDefinitions } from "./adaptive-hook-authoring";
import {
  assessPinnedCapabilityJudgment,
  capabilityAuthorityHash,
  type ScopedCapabilityJudgment,
} from "./capability-fidelity";
import {
  canonicalHookEventName,
  hookEventSourceAliases,
  hookEventSupported,
  nativeHookEventName,
} from "./hook-capabilities";
import { pluginPackageComponentFile } from "./plugin-component-paths";
import { targetNames } from "./targets";
import type { TargetName } from "./types";

type ByTarget<T> = { readonly [Target in TargetName]: T };
type Inventory = ReturnType<typeof getProviderHookEvidence>;
type SchemaSummary = NonNullable<ReturnType<typeof getCodexHookSchemaSummaries>["input"]>;
type Evidence = {
  readonly basis: "provider-docs" | "provider-schema";
  readonly target: TargetName;
  readonly scope: string;
  readonly urls: readonly string[];
  readonly contentHash: string;
};

type Payload =
  | { readonly coverage: "unknown" }
  | {
      readonly coverage: "field-inventory";
      readonly fields: readonly { readonly name: string; readonly required: boolean | null }[];
      readonly schemaRef?: { readonly url: string; readonly contentHash: string };
    };

type Relationship = ReturnType<typeof assessPinnedCapabilityJudgment> & {
  readonly nativeName?: string;
  readonly evidenceIds: readonly string[];
};

export interface HookCatalog {
  readonly schemaVersion: typeof HOOK_CATALOG_VERSION;
  readonly targets: readonly TargetName[];
  readonly events: Readonly<Record<string, {
    readonly meaning?: string;
    readonly providers: ByTarget<Relationship>;
  }>>;
  readonly providers: ByTarget<ReturnType<typeof projectProvider>>;
  readonly evidence: Readonly<Record<string, Evidence>>;
}

type ReviewedEvent = {
  readonly meaning: string;
  readonly targets: ByTarget<ScopedCapabilityJudgment>;
};

const TRIGGER = "trigger only; not matcher, payload, output effects, or runtime behavior";
const INVENTORY = "pinned native event inventory and Skillset source name resolution";

const reviewedEvents: Readonly<Record<string, ReviewedEvent>> = {
  UserPromptSubmit: {
    meaning: "Runs as the user submits a prompt, before agent processing.",
    targets: {
      claude: { fidelity: "equivalent", scope: TRIGGER, reason: "Claude documents the prompt submission trigger before processing.", authorityHash: "sha256:6e9b3363ba282dc57efe7e189a6ceeab087caffb7a143e92b2fbd6b33d59038d" },
      codex: { fidelity: "equivalent", scope: TRIGGER, reason: "Codex documents the prompt submission trigger before processing.", authorityHash: "sha256:20ab0afeefec68269210ba19dd813ec55a38d215babeb0951ab665df8f6b4770" },
      cursor: { fidelity: "equivalent", scope: TRIGGER, reason: "Cursor documents the pre-submission trigger and Core resolves the source alias.", authorityHash: "sha256:925bc86923a9d4f9efbd6d557023151f8097a78357fd522002fa93a17fa80c30" },
    },
  },
  PreToolUse: {
    meaning: "Runs before a tool call and can block it.",
    targets: {
      claude: { fidelity: "partial", scope: "trigger and native matcher/handler constraints", reason: "The trigger is established; Claude documents exact-list or regex matchers and multiple handler types.", authorityHash: "sha256:64919fd3e5fb65eaaf326169eb202ed3e9ae36cba6e858625ec12ca9dce4ff74" },
      codex: { fidelity: "partial", scope: "trigger and native matcher/handler constraints", reason: "The trigger is established; pinned Codex evidence covers command handlers and leaves matcher values provider-native.", authorityHash: "sha256:6982953f032918c72be7adc37a24700900b6dbea77ba88f611abd64effb173a0" },
      cursor: { fidelity: "partial", scope: "trigger and native matcher/handler constraints", reason: "The trigger is established; Cursor keeps matcher values provider-native and prompt handlers are not available in cloud.", authorityHash: "sha256:1cdb87dcddc29002b8f9ad40121b8d8eff80eb72819a07a775a76c7fab4b9374" },
    },
  },
  WorkspaceOpen: {
    meaning: "Runs when a workspace opens in the IDE.",
    targets: {
      claude: { fidelity: "unavailable", scope: INVENTORY, reason: "There is no WorkspaceOpen source resolution in the pinned Claude inventory.", authorityHash: "sha256:c988ec2c0b030ddeecc0e5a573dfb417a06e4eebc5587a34ff326f956beb2f4d" },
      codex: { fidelity: "unavailable", scope: INVENTORY, reason: "There is no WorkspaceOpen source resolution in the pinned Codex inventory.", authorityHash: "sha256:2149d6433353977ed0ff309b129d1e44d4f800085ccf0a6d90e5c26653e428ec" },
      cursor: { fidelity: "provider-only", scope: INVENTORY, reason: "Cursor documents this as an IDE-only event; it is not a portable session-start alias.", authorityHash: "sha256:8ed15dcc89b2a4e473510be98a1fb18778acad09fbe4206d49819095f18850b2" },
    },
  },
};

function byTarget<T>(project: (target: TargetName) => T): ByTarget<T> {
  return Object.fromEntries(targetNames().map((target) => [target, project(target)])) as ByTarget<T>;
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function index<T>(rows: Iterable<readonly [string, T]>): Record<string, T> {
  const entries = [...rows];
  const result = Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  if (Object.keys(result).length !== entries.length) {
    throw new Error("Hook catalog contains duplicate identifiers");
  }
  return result;
}

function resolveSourceEvent(target: TargetName, id: string, inventory: Inventory) {
  const canonicalName = canonicalHookEventName(target, id);
  if (!hookEventSupported(target, id)) return undefined;
  const event = inventory.events.find(({ name }) => name === canonicalName);
  if (!event) throw new Error(`Missing ${target} hook authority for ${id}`);
  return { event, nativeName: nativeHookEventName(target, id) };
}

function inventoryEvidenceId(inventory: Inventory): string {
  return `${inventory.target}:inventory`;
}

function eventEvidenceId(target: TargetName, event: ProviderHookEventEvidence): string {
  return `${target}:${event.name}`;
}

function eventSchemas(target: TargetName, event: ProviderHookEventEvidence) {
  return target === "codex" ? getCodexHookSchemaSummaries(event.name) : undefined;
}

function inventoryEvidence(inventory: Inventory): Evidence {
  return {
    basis: "provider-docs",
    target: inventory.target,
    scope: "Provider documentation and config sources for the inventory committed with this catalog",
    urls: sorted(inventory.sources.filter((url) => !url.endsWith("/"))),
    contentHash: capabilityAuthorityHash(inventory),
  };
}

function eventAuthority(inventory: Inventory, event: ProviderHookEventEvidence) {
  return {
    event,
    sources: sorted(inventory.sources),
    schemaSummaries: eventSchemas(inventory.target, event),
  };
}

function hookRelationshipAuthorityHash(target: TargetName, id: string): string {
  const inventory = getProviderHookEvidence(target);
  const resolved = resolveSourceEvent(target, id, inventory);
  return capabilityAuthorityHash({
    target,
    id,
    nativeName: resolved?.nativeName,
    authority: resolved && eventAuthority(inventory, resolved.event),
    sources: sorted(inventory.sources),
  });
}

function projectRelationship(target: TargetName, id: string): Relationship {
  const inventory = getProviderHookEvidence(target);
  const resolved = resolveSourceEvent(target, id, inventory);
  const judgment = Object.hasOwn(reviewedEvents, id) ? reviewedEvents[id]?.targets[target] : undefined;
  const relationship = assessPinnedCapabilityJudgment(
    judgment, judgment && hookRelationshipAuthorityHash(target, id)
  );

  return {
    ...relationship,
    ...(resolved === undefined ? {} : { nativeName: resolved.nativeName }),
    evidenceIds: [
      resolved === undefined ? inventoryEvidenceId(inventory) : eventEvidenceId(target, resolved.event),
    ],
  };
}

function summarizePayload(
  fields: readonly { readonly name: string; readonly required: boolean | null }[],
  schema?: SchemaSummary
): Payload {
  if (fields.length === 0 && schema === undefined) return { coverage: "unknown" };
  const orderedNames = index(fields.map((field) => [field.name, field] as const));
  return {
    coverage: "field-inventory",
    fields: Object.values(orderedNames),
    ...(schema === undefined ? {} : { schemaRef: { url: schema.url, contentHash: schema.contentHash } }),
  };
}

function projectNativeEvent(
  target: TargetName,
  event: ProviderHookEventEvidence,
  sourceIds: readonly string[]
) {
  const schemas = eventSchemas(target, event);
  return {
    sourceAliases: hookEventSourceAliases(target, event.name),
    skillsetEventIds: sorted(sourceIds),
    canBlock: event.canBlock,
    matcher: {
      subject: event.matcherKind,
      evaluation: event.matcherEvaluation,
      values: sorted(event.matcherValues),
    },
    handlerTypes: sorted(event.handlerTypes),
    input: summarizePayload(event.inputFields, schemas?.input),
    output: {
      contract: summarizePayload(event.rawOutputFields.map((name) => ({
        name,
        required: schemas?.output ? schemas.output.required.includes(name) : null,
      })), schemas?.output),
      recognizedFields: sorted(event.outputFields),
      fieldsWithoutEstablishedEffect: sorted(event.unsupportedOutputFields),
    },
    runtimeNotes: sorted(event.runtimeNotes),
    evidenceIds: [eventEvidenceId(target, event)],
  };
}

function projectProvider(target: TargetName, events: HookCatalog["events"]) {
  const inventory = getProviderHookEvidence(target);
  const byNativeName = new Map<string, string[]>();
  for (const [id, { providers }] of Object.entries(events)) {
    const nativeName = providers[target].nativeName;
    if (nativeName === undefined) continue;
    const ids = byNativeName.get(nativeName) ?? [];
    ids.push(id);
    byNativeName.set(nativeName, ids);
  }
  const nativeEvents = index(inventory.events.map((event) => {
    const name = nativeHookEventName(target, event.name);
    return [name, projectNativeEvent(target, event, byNativeName.get(name) ?? [])] as const;
  }));
  const byAlias = new Map<string, string[]>();
  for (const [name, event] of Object.entries(nativeEvents)) {
    for (const alias of event.sourceAliases) {
      const names = byAlias.get(alias) ?? [];
      names.push(name);
      byAlias.set(alias, names);
    }
  }
  return {
    config: {
      handlerEnvelope: inventory.config.handlerEnvelope,
      groupFields: sorted(inventory.config.groupFields),
      handlerCommonFields: sorted(inventory.config.handlerCommonFields),
      rootFields: sorted(inventory.config.rootFields),
    },
    handlers: Object.values(index(inventory.handlerTypes.map((handler) => [handler.type, {
      ...handler,
      fields: sorted(handler.fields),
      ...(handler.skippedFields === undefined ? {} : { skippedFields: sorted(handler.skippedFields) }),
    }] as const))),
    outputLimits: inventory.outputLimits,
    placement: {
      providerReads: "unknown" as const,
      skillsetWrites: { plugin: pluginPackageComponentFile(target, "hooks") },
    },
    installedRuntime: "unknown" as const,
    events: nativeEvents,
    nativeNamesByAlias: index([...byAlias].map(([alias, names]) => [alias, sorted(names)])),
    evidenceIds: [inventoryEvidenceId(inventory)],
  };
}

export function buildHookCatalog(): HookCatalog {
  const events = index(adaptiveHookEventDefinitions().map(({ id }) => {
    const review = Object.hasOwn(reviewedEvents, id) ? reviewedEvents[id] : undefined;
    const providers = byTarget((target) => projectRelationship(target, id));
    return [id, {
      ...(review === undefined || Object.values(providers).every(({ fidelity }) => fidelity === "unknown")
        ? {}
        : { meaning: review.meaning }),
      providers,
    }] as const;
  }));

  const evidence = index<Evidence>(targetNames().flatMap((target) => {
    const inventory = getProviderHookEvidence(target);
    const source = inventoryEvidence(inventory);
    return [
      [inventoryEvidenceId(inventory), source] as const,
      ...inventory.events.map((event) => {
        const schemas = eventSchemas(target, event);
        const urls = sorted([...source.urls, ...[schemas?.input?.url, schemas?.output?.url]
          .filter((url): url is string => url !== undefined)]);
        return [eventEvidenceId(target, event), {
          basis: event.evidenceKind === "schema-backed" ? "provider-schema" : "provider-docs",
          target,
          scope: "Native event facts pinned in the Skillset checkout; links identify upstream sources",
          urls,
          contentHash: capabilityAuthorityHash(eventAuthority(inventory, event)),
        }] as const;
      }),
    ];
  }));

  return {
    schemaVersion: HOOK_CATALOG_VERSION,
    targets: targetNames(),
    events,
    providers: byTarget((target) => projectProvider(target, events)),
    evidence,
  };
}
