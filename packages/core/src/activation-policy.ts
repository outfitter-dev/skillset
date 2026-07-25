import {
  ACTIVATION_CAPABILITIES,
  ACTIVATION_REQUIREMENT_STAGES,
} from "@skillset/schema";
import type {
  ActivationCapability,
  ActivationObservationEffect,
  ActivationRequirementStage,
  ActivationTarget,
} from "@skillset/schema";

import {
  getProviderRuntimeEvidence,
  getProviderRuntimeInspectorEvidence,
  PROVIDER_SCHEMA_TARGETS,
} from "@skillset/registry";
import type {
  ProviderRuntimeCommandSurface,
  ProviderRuntimeEvidence,
} from "@skillset/registry";

export const PROVIDER_ACTIVATION_CAPABILITIES = ACTIVATION_CAPABILITIES;

export type ProviderActivationCapability = ActivationCapability;

export type ProviderActivationTarget = ActivationTarget;

export const PROVIDER_ACTIVATION_STAGES = ACTIVATION_REQUIREMENT_STAGES;

export type ProviderActivationStage = ActivationRequirementStage;

export const PROVIDER_ACTIVATION_CLAIMS = [
  "authenticated",
  "availability",
  "bundled-mcp-connection",
  "connected",
  "credentials",
  "current-session-load",
  "discoverable",
  "enabled",
  "hosted-policy",
  "provider-policy",
  "proven",
] as const;

export type ProviderActivationClaim =
  (typeof PROVIDER_ACTIVATION_CLAIMS)[number];

export type ProviderActivationEffect = ActivationObservationEffect;

export type ProviderActivationEvidence = Omit<
  ProviderRuntimeEvidence,
  "inspectors" | "target"
>;

export type ProviderActivationCommandSurface = ProviderRuntimeCommandSurface;

export interface ProviderActivationUnavailableSurface {
  readonly kind: "unavailable";
}

export type ProviderActivationSurface =
  | ProviderActivationCommandSurface
  | ProviderActivationUnavailableSurface;

export interface ProviderActivationInspector {
  readonly allowedClaims: readonly ProviderActivationClaim[];
  readonly effect: ProviderActivationEffect;
  readonly forbiddenClaims: readonly ProviderActivationClaim[];
  readonly id: string;
  readonly scope: "capability" | "provider";
  readonly surface: ProviderActivationSurface;
}

export interface ProviderActivationReasonDescriptor {
  readonly code: string;
  readonly message: string;
  readonly stage: "authenticated" | "connected" | "discoverable" | "enabled";
}

export interface ProviderActivationActionDescriptor {
  readonly code: string;
  readonly label: string;
  readonly mutatesProviderState: boolean;
  readonly reasonCode: string;
  readonly url: string;
}

export interface ProviderActivationDescriptor {
  readonly actions: readonly ProviderActivationActionDescriptor[];
  readonly allowedClaims: readonly ProviderActivationClaim[];
  readonly capability: ProviderActivationCapability;
  readonly evidence: ProviderActivationEvidence;
  readonly forbiddenClaims: readonly ProviderActivationClaim[];
  readonly id: string;
  readonly inspectors: readonly ProviderActivationInspector[];
  readonly observationFallback: "unverified";
  readonly reasons: readonly ProviderActivationReasonDescriptor[];
  readonly stages: readonly ProviderActivationStage[];
  readonly target: ProviderActivationTarget;
}

const CAPABILITY_STAGES: Readonly<
  Record<ProviderActivationCapability, readonly ProviderActivationStage[]>
> = {
  app: [
    "declared",
    "rendered",
    "discoverable",
    "enabled",
    "authenticated",
    "proven",
  ],
  "mcp-server": [
    "declared",
    "rendered",
    "discoverable",
    "authenticated",
    "connected",
    "proven",
  ],
  "plugin-dependency": [
    "declared",
    "rendered",
    "discoverable",
    "enabled",
    "proven",
  ],
};

const descriptors = [
  descriptor({
    actions: [
      action(
        "claude.plugin.install-or-enable",
        "claude.plugin.not-discoverable",
        "Install or enable the plugin in Claude",
        "https://code.claude.com/docs/en/discover-plugins",
        true
      ),
      action(
        "claude.plugin.enable",
        "claude.plugin.not-enabled",
        "Enable the plugin in Claude",
        "https://code.claude.com/docs/en/discover-plugins",
        true
      ),
    ],
    allowedClaims: ["discoverable", "enabled"],
    capability: "plugin-dependency",
    evidence: providerEvidence("claude"),
    forbiddenClaims: ["authenticated", "current-session-load", "proven"],
    inspectors: [
      inspector({
        allowedClaims: ["discoverable", "enabled"],
        forbiddenClaims: ["authenticated", "current-session-load", "proven"],
        id: "claude.plugin.list",
      }),
    ],
    reasons: [
      reason(
        "claude.plugin.not-discoverable",
        "discoverable",
        "Claude plugin inventory did not report the required plugin."
      ),
      reason(
        "claude.plugin.not-enabled",
        "enabled",
        "Claude plugin inventory reported the required plugin as disabled."
      ),
    ],
    target: "claude",
  }),
  descriptor({
    actions: [
      action(
        "claude.mcp.configure",
        "claude.mcp.not-discoverable",
        "Configure the MCP server in Claude",
        "https://code.claude.com/docs/en/mcp",
        true
      ),
      action(
        "claude.mcp.reconnect",
        "claude.mcp.not-connected",
        "Reconnect the MCP server in Claude",
        "https://code.claude.com/docs/en/mcp",
        true
      ),
    ],
    allowedClaims: ["connected", "discoverable"],
    capability: "mcp-server",
    evidence: providerEvidence("claude"),
    forbiddenClaims: ["authenticated", "provider-policy", "proven"],
    inspectors: [
      inspector({
        allowedClaims: ["connected", "discoverable"],
        forbiddenClaims: ["authenticated", "provider-policy", "proven"],
        id: "claude.mcp.list",
      }),
    ],
    reasons: [
      reason(
        "claude.mcp.not-connected",
        "connected",
        "Claude did not report the required MCP server as connected."
      ),
      reason(
        "claude.mcp.not-discoverable",
        "discoverable",
        "Claude did not report the required MCP server as configured."
      ),
    ],
    target: "claude",
  }),
  unavailableDescriptor({
    actions: [
      action(
        "claude.app.review-activation",
        "claude.app.observability-unavailable",
        "Review app activation in Claude",
        "https://code.claude.com/docs"
      ),
    ],
    capability: "app",
    evidence: providerEvidence("claude"),
    forbiddenClaims: [
      "authenticated",
      "availability",
      "discoverable",
      "enabled",
      "proven",
    ],
    reason: reason(
      "claude.app.observability-unavailable",
      "discoverable",
      "Claude exposes no stable CLI inventory for app activation."
    ),
    target: "claude",
  }),
  descriptor({
    actions: [
      action(
        "codex.plugin.install-or-enable",
        "codex.plugin.not-discoverable",
        "Install or enable the plugin in Codex",
        "https://developers.openai.com/codex/plugins",
        true
      ),
      action(
        "codex.plugin.enable",
        "codex.plugin.not-enabled",
        "Enable the plugin in Codex",
        "https://developers.openai.com/codex/plugins",
        true
      ),
    ],
    allowedClaims: ["discoverable", "enabled"],
    capability: "plugin-dependency",
    evidence: providerEvidence("codex"),
    forbiddenClaims: ["bundled-mcp-connection", "hosted-policy", "proven"],
    inspectors: [
      inspector({
        allowedClaims: ["discoverable", "enabled"],
        forbiddenClaims: ["bundled-mcp-connection", "hosted-policy", "proven"],
        id: "codex.plugin.list",
      }),
    ],
    reasons: [
      reason(
        "codex.plugin.not-discoverable",
        "discoverable",
        "Codex plugin inventory did not report the required plugin."
      ),
      reason(
        "codex.plugin.not-enabled",
        "enabled",
        "Codex plugin inventory reported the required plugin as disabled."
      ),
    ],
    target: "codex",
  }),
  descriptor({
    actions: [
      action(
        "codex.mcp.configure",
        "codex.mcp.not-discoverable",
        "Configure the MCP server in Codex",
        "https://developers.openai.com/codex/mcp",
        true
      ),
    ],
    allowedClaims: ["discoverable"],
    capability: "mcp-server",
    evidence: providerEvidence("codex"),
    forbiddenClaims: ["authenticated", "connected", "credentials", "proven"],
    inspectors: [
      inspector({
        allowedClaims: ["discoverable"],
        forbiddenClaims: [
          "authenticated",
          "connected",
          "credentials",
          "proven",
        ],
        id: "codex.mcp.list",
      }),
    ],
    reasons: [
      reason(
        "codex.mcp.not-discoverable",
        "discoverable",
        "Codex did not report the required MCP server as configured."
      ),
    ],
    target: "codex",
  }),
  unavailableDescriptor({
    actions: [
      action(
        "codex.app.review-activation",
        "codex.app.observability-unavailable",
        "Review app activation in Codex",
        "https://developers.openai.com/codex"
      ),
    ],
    capability: "app",
    evidence: providerEvidence("codex"),
    forbiddenClaims: [
      "authenticated",
      "availability",
      "discoverable",
      "enabled",
      "hosted-policy",
      "proven",
    ],
    reason: reason(
      "codex.app.observability-unavailable",
      "discoverable",
      "Codex exposes no authoritative local host-policy surface for app activation."
    ),
    target: "codex",
  }),
  unavailableDescriptor({
    actions: [
      action(
        "cursor.plugin.review-activation",
        "cursor.plugin.observability-unavailable",
        "Review plugin activation in Cursor",
        "https://cursor.com/docs/plugins"
      ),
    ],
    capability: "plugin-dependency",
    evidence: providerEvidence("cursor"),
    forbiddenClaims: [
      "current-session-load",
      "discoverable",
      "enabled",
      "proven",
    ],
    reason: reason(
      "cursor.plugin.observability-unavailable",
      "discoverable",
      "Cursor Agent exposes no persistent plugin inventory."
    ),
    target: "cursor",
  }),
  descriptor({
    actions: [
      action(
        "cursor.mcp.authenticate",
        "cursor.mcp.authentication-unverified",
        "Authenticate Cursor Agent",
        "https://cursor.com/docs/cli/headless",
        true
      ),
      action(
        "cursor.mcp.configure",
        "cursor.mcp.not-discoverable",
        "Configure the MCP server in Cursor",
        "https://cursor.com/docs/cli/headless",
        true
      ),
      action(
        "cursor.mcp.reconnect",
        "cursor.mcp.not-connected",
        "Reconnect the MCP server in Cursor",
        "https://cursor.com/docs/cli/headless",
        true
      ),
    ],
    allowedClaims: ["authenticated", "connected", "discoverable"],
    capability: "mcp-server",
    evidence: providerEvidence("cursor"),
    forbiddenClaims: ["credentials", "provider-policy", "proven"],
    inspectors: [
      inspector({
        allowedClaims: ["connected", "discoverable"],
        forbiddenClaims: [
          "authenticated",
          "credentials",
          "provider-policy",
          "proven",
        ],
        id: "cursor.mcp.list",
      }),
      inspector({
        allowedClaims: ["authenticated"],
        forbiddenClaims: [
          "availability",
          "connected",
          "discoverable",
          "proven",
        ],
        id: "cursor.status",
        scope: "provider",
      }),
    ],
    reasons: [
      reason(
        "cursor.mcp.authentication-unverified",
        "authenticated",
        "Cursor Agent authentication could not be verified."
      ),
      reason(
        "cursor.mcp.not-connected",
        "connected",
        "Cursor Agent did not report the required MCP server as connected."
      ),
      reason(
        "cursor.mcp.not-discoverable",
        "discoverable",
        "Cursor Agent did not report the required MCP server as configured."
      ),
    ],
    target: "cursor",
  }),
  unavailableDescriptor({
    actions: [
      action(
        "cursor.app.review-activation",
        "cursor.app.observability-unavailable",
        "Review app activation in Cursor",
        "https://cursor.com/docs"
      ),
    ],
    capability: "app",
    evidence: providerEvidence("cursor"),
    forbiddenClaims: [
      "authenticated",
      "availability",
      "discoverable",
      "enabled",
      "proven",
    ],
    reason: reason(
      "cursor.app.observability-unavailable",
      "discoverable",
      "Cursor Agent exposes no stable CLI inventory for app activation."
    ),
    target: "cursor",
  }),
] as const satisfies readonly ProviderActivationDescriptor[];

export const providerActivationDescriptors =
  defineProviderActivationDescriptors(descriptors);

export function defineProviderActivationDescriptors(
  entries: readonly ProviderActivationDescriptor[]
): readonly ProviderActivationDescriptor[] {
  assertProviderActivationDescriptors(entries);
  const normalized = entries.map(normalizeDescriptor);
  assertProviderActivationDescriptors(normalized);
  return deepFreeze(
    normalized.toSorted((left, right) => compareStrings(left.id, right.id))
  );
}

export function listProviderActivationDescriptors(): readonly ProviderActivationDescriptor[] {
  return providerActivationDescriptors;
}

export function getProviderActivationDescriptor(
  target: ProviderActivationTarget,
  capability: ProviderActivationCapability
): ProviderActivationDescriptor {
  const entry = providerActivationDescriptors.find(
    (candidate) =>
      candidate.target === target && candidate.capability === capability
  );
  if (entry === undefined) {
    throw new Error(
      `skillset: missing provider activation descriptor ${target}:${capability}`
    );
  }
  return entry;
}

export function normalizeProviderActivationDescriptors(
  entries: readonly ProviderActivationDescriptor[] = providerActivationDescriptors
): string {
  return `${JSON.stringify(sortJson(entries), null, 2)}\n`;
}

export function assertProviderActivationDescriptors(
  entries: readonly ProviderActivationDescriptor[]
): void {
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const inspectorIds = new Set<string>();
  const reasonCodes = new Set<string>();
  const actionCodes = new Set<string>();

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(
        `skillset: duplicate provider activation descriptor ${entry.id}`
      );
    }
    ids.add(entry.id);
    if (!PROVIDER_SCHEMA_TARGETS.includes(entry.target)) {
      throw new Error(
        `skillset: unsupported provider activation target ${entry.target}`
      );
    }
    if (!PROVIDER_ACTIVATION_CAPABILITIES.includes(entry.capability)) {
      throw new Error(
        `skillset: unsupported provider activation capability ${entry.capability}`
      );
    }

    const pair = `${entry.target}:${entry.capability}`;
    if (pairs.has(pair)) {
      throw new Error(
        `skillset: duplicate provider activation target capability ${pair}`
      );
    }
    pairs.add(pair);
    if (entry.id !== pair) {
      throw new Error(
        `skillset: provider activation descriptor ${entry.id} must use id ${pair}`
      );
    }

    assertEvidence(entry);
    assertClaims(entry.id, entry.allowedClaims, entry.forbiddenClaims);
    assertStages(entry);
    assertReasonsAndActions(entry, reasonCodes, actionCodes);

    for (const inspectorEntry of entry.inspectors) {
      if (inspectorIds.has(inspectorEntry.id)) {
        throw new Error(
          `skillset: duplicate provider activation inspector ${inspectorEntry.id}`
        );
      }
      inspectorIds.add(inspectorEntry.id);
      assertClaims(
        inspectorEntry.id,
        inspectorEntry.allowedClaims,
        inspectorEntry.forbiddenClaims
      );
      for (const claim of inspectorEntry.allowedClaims) {
        if (!entry.allowedClaims.includes(claim)) {
          throw new Error(
            `skillset: provider activation inspector ${inspectorEntry.id} allows undeclared descriptor claim ${claim}`
          );
        }
      }
      assertInspectorSurface(inspectorEntry);
    }
  }

  for (const target of PROVIDER_SCHEMA_TARGETS) {
    for (const capability of PROVIDER_ACTIVATION_CAPABILITIES) {
      const pair = `${target}:${capability}`;
      if (!pairs.has(pair)) {
        throw new Error(
          `skillset: missing provider activation descriptor ${pair}`
        );
      }
    }
  }
}

function descriptor(
  input: Omit<
    ProviderActivationDescriptor,
    "id" | "observationFallback" | "stages"
  >
): ProviderActivationDescriptor {
  return {
    ...input,
    id: `${input.target}:${input.capability}`,
    observationFallback: "unverified",
    stages: CAPABILITY_STAGES[input.capability],
  };
}

function unavailableDescriptor(input: {
  readonly actions: readonly ProviderActivationActionDescriptor[];
  readonly capability: ProviderActivationCapability;
  readonly evidence: ProviderActivationEvidence;
  readonly forbiddenClaims: readonly ProviderActivationClaim[];
  readonly reason: ProviderActivationReasonDescriptor;
  readonly target: ProviderActivationTarget;
}): ProviderActivationDescriptor {
  return descriptor({
    actions: input.actions,
    allowedClaims: [],
    capability: input.capability,
    evidence: input.evidence,
    forbiddenClaims: input.forbiddenClaims,
    inspectors: [
      {
        allowedClaims: [],
        effect: "none",
        forbiddenClaims: input.forbiddenClaims,
        id: `${input.target}.${input.capability}.unavailable`,
        scope: "capability",
        surface: { kind: "unavailable" },
      },
    ],
    reasons: [input.reason],
    target: input.target,
  });
}

function inspector(
  input: Omit<ProviderActivationInspector, "effect" | "scope" | "surface"> & {
    readonly scope?: ProviderActivationInspector["scope"];
  }
): ProviderActivationInspector {
  const evidence = getProviderRuntimeInspectorEvidence(input.id);
  return {
    effect: evidence.effect,
    scope: "capability",
    surface: evidence.surface,
    ...input,
  };
}

function providerEvidence(
  target: ProviderActivationTarget
): ProviderActivationEvidence {
  const { providerName, providerVersion, sources, verifiedAt } =
    getProviderRuntimeEvidence(target);
  return { providerName, providerVersion, sources, verifiedAt };
}

function reason(
  code: string,
  stage: ProviderActivationReasonDescriptor["stage"],
  message: string
): ProviderActivationReasonDescriptor {
  return { code, message, stage };
}

function action(
  code: string,
  reasonCode: string,
  label: string,
  url: string,
  mutatesProviderState = false
): ProviderActivationActionDescriptor {
  return {
    code,
    label,
    mutatesProviderState,
    reasonCode,
    url,
  };
}

function normalizeDescriptor(
  entry: ProviderActivationDescriptor
): ProviderActivationDescriptor {
  return {
    ...entry,
    actions: [...entry.actions].toSorted((left, right) =>
      compareStrings(left.code, right.code)
    ),
    allowedClaims: uniqueSorted(entry.allowedClaims),
    evidence: {
      ...entry.evidence,
      sources: [...entry.evidence.sources].toSorted((left, right) =>
        compareStrings(left.url, right.url)
      ),
    },
    forbiddenClaims: uniqueSorted(entry.forbiddenClaims),
    inspectors: [...entry.inspectors]
      .map((entry) => ({
        ...entry,
        allowedClaims: uniqueSorted(entry.allowedClaims),
        forbiddenClaims: uniqueSorted(entry.forbiddenClaims),
        surface:
          entry.surface.kind === "command"
            ? {
                ...entry.surface,
                argv: [...entry.surface.argv] as [string, ...string[]],
              }
            : entry.surface,
      }))
      .toSorted((left, right) => compareStrings(left.id, right.id)),
    reasons: [...entry.reasons].toSorted((left, right) =>
      compareStrings(left.code, right.code)
    ),
  };
}

function assertEvidence(entry: ProviderActivationDescriptor): void {
  const { evidence } = entry;
  if (
    evidence.providerName.length === 0 ||
    evidence.providerVersion.length === 0
  ) {
    throw new Error(
      `skillset: provider activation descriptor ${entry.id} requires provider name and version evidence`
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(evidence.verifiedAt)) {
    throw new Error(
      `skillset: provider activation descriptor ${entry.id} has invalid verification date ${evidence.verifiedAt}`
    );
  }
  if (evidence.sources.length === 0) {
    throw new Error(
      `skillset: provider activation descriptor ${entry.id} requires at least one evidence source`
    );
  }
  for (const source of evidence.sources) {
    if (!source.url.startsWith("https://")) {
      throw new Error(
        `skillset: provider activation descriptor ${entry.id} source must be an https URL`
      );
    }
  }
}

function assertStages(entry: ProviderActivationDescriptor): void {
  const expected = CAPABILITY_STAGES[entry.capability];
  if (
    entry.stages.length !== expected.length ||
    entry.stages.some((stage, index) => stage !== expected[index])
  ) {
    throw new Error(
      `skillset: provider activation descriptor ${entry.id} stages must be ${expected.join(", ")}`
    );
  }
}

function assertClaims(
  id: string,
  allowedClaims: readonly ProviderActivationClaim[],
  forbiddenClaims: readonly ProviderActivationClaim[]
): void {
  const allowed = new Set<ProviderActivationClaim>();
  for (const claim of allowedClaims) {
    if (!PROVIDER_ACTIVATION_CLAIMS.includes(claim)) {
      throw new Error(
        `skillset: provider activation ${id} has unsupported allowed claim ${claim}`
      );
    }
    if (allowed.has(claim)) {
      throw new Error(
        `skillset: provider activation ${id} repeats allowed claim ${claim}`
      );
    }
    allowed.add(claim);
  }
  const forbidden = new Set<ProviderActivationClaim>();
  for (const claim of forbiddenClaims) {
    if (!PROVIDER_ACTIVATION_CLAIMS.includes(claim)) {
      throw new Error(
        `skillset: provider activation ${id} has unsupported forbidden claim ${claim}`
      );
    }
    if (forbidden.has(claim)) {
      throw new Error(
        `skillset: provider activation ${id} repeats forbidden claim ${claim}`
      );
    }
    if (allowed.has(claim)) {
      throw new Error(
        `skillset: provider activation ${id} both allows and forbids claim ${claim}`
      );
    }
    forbidden.add(claim);
  }
}

function assertReasonsAndActions(
  entry: ProviderActivationDescriptor,
  reasonCodes: Set<string>,
  actionCodes: Set<string>
): void {
  const entryReasonCodes = new Set(entry.reasons.map((reason) => reason.code));
  if (entry.reasons.length === 0) {
    throw new Error(
      `skillset: provider activation descriptor ${entry.id} requires at least one reason`
    );
  }
  if (entry.actions.length === 0) {
    throw new Error(
      `skillset: provider activation descriptor ${entry.id} requires at least one action`
    );
  }
  for (const reasonEntry of entry.reasons) {
    if (reasonCodes.has(reasonEntry.code)) {
      throw new Error(
        `skillset: duplicate provider activation reason ${reasonEntry.code}`
      );
    }
    reasonCodes.add(reasonEntry.code);
  }
  for (const actionEntry of entry.actions) {
    if (actionCodes.has(actionEntry.code)) {
      throw new Error(
        `skillset: duplicate provider activation action ${actionEntry.code}`
      );
    }
    actionCodes.add(actionEntry.code);
    if (!entryReasonCodes.has(actionEntry.reasonCode)) {
      throw new Error(
        `skillset: provider activation action ${actionEntry.code} references unknown reason ${actionEntry.reasonCode}`
      );
    }
    if (!actionEntry.url.startsWith("https://")) {
      throw new Error(
        `skillset: provider activation action ${actionEntry.code} URL must use https`
      );
    }
  }
}

function assertInspectorSurface(entry: ProviderActivationInspector): void {
  if (entry.surface.kind === "unavailable") {
    if (entry.effect !== "none" || entry.allowedClaims.length > 0) {
      throw new Error(
        `skillset: unavailable provider activation inspector ${entry.id} must have no effect or allowed claims`
      );
    }
    return;
  }
  if (entry.effect === "none") {
    throw new Error(
      `skillset: command provider activation inspector ${entry.id} must declare passive or active effect`
    );
  }
  const [executable, ...args] = entry.surface.argv;
  if (
    executable === undefined ||
    executable.length === 0 ||
    ["bash", "sh", "zsh"].includes(executable)
  ) {
    throw new Error(
      `skillset: provider activation inspector ${entry.id} must use a fixed provider executable`
    );
  }
  for (const arg of args) {
    if (arg.length === 0 || /[\0\r\n]/u.test(arg)) {
      throw new Error(
        `skillset: provider activation inspector ${entry.id} has invalid argv`
      );
    }
  }
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].toSorted(compareStrings);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).toSorted()) {
    sorted[key] = sortJson(record[key]);
  }
  return sorted;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}
