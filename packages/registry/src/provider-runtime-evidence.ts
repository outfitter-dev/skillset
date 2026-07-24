import type {
  ActivationObservationEffect,
  ActivationTarget,
} from "@skillset/schema";

import { PROVIDER_SCHEMA_TARGETS } from "./schema-snapshots";

export interface ProviderRuntimeEvidenceSource {
  readonly note?: string;
  readonly url: string;
}

export interface ProviderRuntimeCommandSurface {
  readonly argv: readonly [string, ...string[]];
  readonly kind: "command";
  readonly output: "json" | "text";
  readonly versionArgv: readonly [string, ...string[]];
}

export interface ProviderRuntimeInspectorEvidence {
  readonly effect: Exclude<ActivationObservationEffect, "none">;
  readonly fields: readonly string[];
  readonly id: string;
  readonly surface: ProviderRuntimeCommandSurface;
}

export interface ProviderRuntimeEvidence {
  readonly inspectors: readonly ProviderRuntimeInspectorEvidence[];
  readonly providerName: string;
  readonly providerVersion: string;
  readonly sources: readonly ProviderRuntimeEvidenceSource[];
  readonly target: ActivationTarget;
  readonly verifiedAt: string;
}

const VERIFIED_AT = "2026-07-24";

const evidence = [
  {
    inspectors: [
      {
        effect: "active",
        fields: ["mcp.connection", "mcp.name"],
        id: "claude.mcp.list",
        surface: command(["claude", "mcp", "list"], "text"),
      },
      {
        effect: "passive",
        fields: ["plugin.enabled", "plugin.name"],
        id: "claude.plugin.list",
        surface: command(["claude", "plugin", "list", "--json"], "json"),
      },
    ],
    providerName: "Claude Code",
    providerVersion: "2.1.219",
    sources: [
      { url: "https://code.claude.com/docs/en/discover-plugins" },
      { url: "https://code.claude.com/docs/en/mcp" },
    ],
    target: "claude",
    verifiedAt: VERIFIED_AT,
  },
  {
    inspectors: [
      {
        effect: "passive",
        fields: ["mcp.name"],
        id: "codex.mcp.list",
        surface: command(["codex", "mcp", "list", "--json"], "json"),
      },
      {
        effect: "passive",
        fields: ["plugin.enabled", "plugin.name"],
        id: "codex.plugin.list",
        surface: command(["codex", "plugin", "list", "--json"], "json"),
      },
    ],
    providerName: "Codex",
    providerVersion: "0.146.0-alpha.3.1",
    sources: [
      { url: "https://developers.openai.com/codex/cli/reference" },
      { url: "https://developers.openai.com/codex/mcp" },
    ],
    target: "codex",
    verifiedAt: VERIFIED_AT,
  },
  {
    inspectors: [
      {
        effect: "active",
        fields: ["mcp.connection", "mcp.name"],
        id: "cursor.mcp.list",
        surface: command(["cursor-agent", "mcp", "list"], "text"),
      },
      {
        effect: "passive",
        fields: ["session.authenticated"],
        id: "cursor.status",
        surface: command(
          ["cursor-agent", "status", "--format", "json"],
          "json"
        ),
      },
    ],
    providerName: "Cursor Agent",
    providerVersion: "2026.07.23-e383d2b",
    sources: [
      { url: "https://cursor.com/docs/cli/headless" },
      { url: "https://cursor.com/docs/plugins" },
    ],
    target: "cursor",
    verifiedAt: VERIFIED_AT,
  },
] as const satisfies readonly ProviderRuntimeEvidence[];

export const providerRuntimeEvidence = defineProviderRuntimeEvidence(evidence);

export function defineProviderRuntimeEvidence(
  entries: readonly ProviderRuntimeEvidence[]
): readonly ProviderRuntimeEvidence[] {
  assertProviderRuntimeEvidence(entries);
  return deepFreeze(
    entries
      .map((entry) => ({
        ...entry,
        inspectors: [...entry.inspectors]
          .map((inspector) => ({
            ...inspector,
            fields: [...new Set(inspector.fields)].toSorted(compareStrings),
            surface: {
              ...inspector.surface,
              argv: [...inspector.surface.argv] as [string, ...string[]],
            },
          }))
          .toSorted((left, right) => compareStrings(left.id, right.id)),
        sources: [...entry.sources].toSorted((left, right) =>
          compareStrings(left.url, right.url)
        ),
      }))
      .toSorted((left, right) => compareStrings(left.target, right.target))
  );
}

export function listProviderRuntimeEvidence(): readonly ProviderRuntimeEvidence[] {
  return providerRuntimeEvidence;
}

export function getProviderRuntimeEvidence(
  target: ActivationTarget
): ProviderRuntimeEvidence {
  const entry = providerRuntimeEvidence.find(
    (candidate) => candidate.target === target
  );
  if (entry === undefined) {
    throw new Error(`skillset: missing provider runtime evidence ${target}`);
  }
  return entry;
}

export function getProviderRuntimeInspectorEvidence(
  id: string
): ProviderRuntimeInspectorEvidence {
  for (const entry of providerRuntimeEvidence) {
    const inspector = entry.inspectors.find((candidate) => candidate.id === id);
    if (inspector !== undefined) return inspector;
  }
  throw new Error(`skillset: missing provider runtime inspector evidence ${id}`);
}

export function normalizeProviderRuntimeEvidence(
  entries: readonly ProviderRuntimeEvidence[] = providerRuntimeEvidence
): string {
  return `${JSON.stringify(sortJson(entries), null, 2)}\n`;
}

export function assertProviderRuntimeEvidence(
  entries: readonly ProviderRuntimeEvidence[]
): void {
  const targets = new Set<ActivationTarget>();
  const inspectorIds = new Set<string>();
  for (const entry of entries) {
    if (!PROVIDER_SCHEMA_TARGETS.includes(entry.target)) {
      throw new Error(
        `skillset: unsupported provider runtime evidence target ${entry.target}`
      );
    }
    if (targets.has(entry.target)) {
      throw new Error(
        `skillset: duplicate provider runtime evidence target ${entry.target}`
      );
    }
    targets.add(entry.target);
    if (
      entry.providerName.length === 0 ||
      entry.providerVersion.length === 0
    ) {
      throw new Error(
        `skillset: provider runtime evidence ${entry.target} requires provider name and version`
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry.verifiedAt)) {
      throw new Error(
        `skillset: provider runtime evidence ${entry.target} has invalid verification date ${entry.verifiedAt}`
      );
    }
    if (entry.sources.length === 0) {
      throw new Error(
        `skillset: provider runtime evidence ${entry.target} requires at least one source`
      );
    }
    for (const source of entry.sources) {
      if (!source.url.startsWith("https://")) {
        throw new Error(
          `skillset: provider runtime evidence ${entry.target} source must use https`
        );
      }
    }
    for (const inspector of entry.inspectors) {
      if (inspectorIds.has(inspector.id)) {
        throw new Error(
          `skillset: duplicate provider runtime inspector evidence ${inspector.id}`
        );
      }
      inspectorIds.add(inspector.id);
      if (inspector.fields.length === 0) {
        throw new Error(
          `skillset: provider runtime inspector evidence ${inspector.id} requires observed fields`
        );
      }
      assertCommandSurface(inspector);
    }
  }
  for (const target of PROVIDER_SCHEMA_TARGETS) {
    if (!targets.has(target)) {
      throw new Error(`skillset: missing provider runtime evidence ${target}`);
    }
  }
}

function command(
  argv: readonly [string, ...string[]],
  output: ProviderRuntimeCommandSurface["output"]
): ProviderRuntimeCommandSurface {
  return {
    argv,
    kind: "command",
    output,
    versionArgv: [argv[0], "--version"],
  };
}

function assertCommandSurface(entry: ProviderRuntimeInspectorEvidence): void {
  const [executable, ...args] = entry.surface.argv;
  if (
    executable === undefined ||
    executable.length === 0 ||
    ["bash", "sh", "zsh"].includes(executable)
  ) {
    throw new Error(
      `skillset: provider runtime inspector evidence ${entry.id} must use a fixed provider executable`
    );
  }
  for (const arg of args) {
    if (arg.length === 0 || /[\0\r\n]/u.test(arg)) {
      throw new Error(
        `skillset: provider runtime inspector evidence ${entry.id} has invalid argv`
      );
    }
  }
  const [versionExecutable, ...versionArgs] = entry.surface.versionArgv;
  if (
    versionExecutable !== executable ||
    versionArgs.length !== 1 ||
    versionArgs[0] !== "--version"
  ) {
    throw new Error(
      `skillset: provider runtime inspector evidence ${entry.id} must use the matching fixed --version surface`
    );
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).toSorted()) {
    sorted[key] = sortJson(record[key]);
  }
  return sorted;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
