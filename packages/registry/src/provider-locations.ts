import { PROVIDER_SCHEMA_TARGETS } from "./schema-snapshots";

export const PROVIDER_LOCATION_KINDS = [
  "config",
  "marketplace",
  "plugin-storage",
  "skill-discovery",
] as const;

/** Static consumers planned by SET-468; none of them gain write or launch authority here. */
export const PROVIDER_LOCATION_CONSUMERS = [
  "doctor",
  "install-verification",
  "router-preflight",
] as const;

export type ProviderLocationKind = (typeof PROVIDER_LOCATION_KINDS)[number];
export type ProviderLocationTarget = (typeof PROVIDER_SCHEMA_TARGETS)[number];

export const PROVIDER_LOCATION_SURFACE_TARGETS = {
  "chatgpt-desktop": "codex",
  "chatgpt-web": "codex",
  "claude-code-cli": "claude",
  "claude-code-cloud": "claude",
  "claude-desktop": "claude",
  "claude-web": "claude",
  "codex-cli": "codex",
  "codex-cloud": "codex",
  "codex-ide": "codex",
  "cursor-agent-cli": "cursor",
  "cursor-cloud": "cursor",
  "cursor-ide": "cursor",
} as const satisfies Readonly<Record<string, ProviderLocationTarget>>;

export type ProviderLocationSurface =
  keyof typeof PROVIDER_LOCATION_SURFACE_TARGETS;

export interface ProviderLocationSource {
  readonly note?: string;
  readonly url: string;
}

export interface ProviderLocationObservation {
  readonly fields: Readonly<Record<string, string>>;
  readonly kind: "installed-app-metadata";
  readonly observedAt: string;
  readonly path: string;
}

export type ProviderLocationFact =
  | {
      readonly kind: ProviderLocationKind;
      readonly note?: string;
      readonly path: string;
      readonly status: "verified";
    }
  | {
      readonly kind: ProviderLocationKind;
      readonly reason: string;
      readonly status: "unknown";
    };

export interface ProviderLocationEvidence {
  readonly facts: readonly ProviderLocationFact[];
  readonly observations?: readonly ProviderLocationObservation[];
  readonly providerName: string;
  readonly providerVersion: string;
  readonly sources: readonly ProviderLocationSource[];
  readonly surface: ProviderLocationSurface;
  readonly target: ProviderLocationTarget;
  readonly verifiedAt: string;
}

export interface ProviderLocationQuery {
  readonly providerVersion: string;
  readonly surface: ProviderLocationSurface;
  readonly target: ProviderLocationTarget;
}

export type ProviderLocationSelection =
  | { readonly evidence: ProviderLocationEvidence; readonly kind: "matched" }
  | {
      readonly kind: "unknown";
      readonly providerVersion: string;
      readonly reason: string;
      readonly surface: ProviderLocationSurface;
      readonly target: ProviderLocationTarget;
    };

const VERIFIED_AT = "2026-09-11";
const UNKNOWN_REASON =
  "Current primary evidence does not establish an on-disk location for this provider surface.";

const entries = [
  evidence({
    facts: [
      verified(
        "plugin-storage",
        "~/.claude/plugins/cache/<marketplace>/<plugin>/<version>"
      ),
      verified(
        "plugin-storage",
        "~/.claude/skills/<plugin>",
        "Skills-directory plugins are discovered in place."
      ),
      verified("skill-discovery", "~/.claude/skills/<skill>/SKILL.md"),
      verified("skill-discovery", "<project>/.claude/skills/<skill>/SKILL.md"),
      verified(
        "skill-discovery",
        "<installed-plugin-root>/skills/<skill>/SKILL.md"
      ),
      verified("marketplace", "~/.claude/plugins/known_marketplaces.json"),
      verified("marketplace", "~/.claude/plugins/marketplaces/<marketplace>"),
      verified("config", "~/.claude/settings.json"),
      verified("config", "<project>/.claude/settings.json"),
      verified("config", "<project>/.claude/settings.local.json"),
    ],
    providerName: "Claude Code",
    providerVersion: "2.1.269",
    sources: [
      {
        note: "Claude Code 2.1.269 package metadata; tarball SHA-256 5a7234b0418bfc821dedae7726c04326f89f140d1299eb70bce2c144bc03c021.",
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.269",
      },
      { url: "https://code.claude.com/docs/en/plugin-marketplaces" },
      { url: "https://code.claude.com/docs/en/plugins-reference" },
      { url: "https://code.claude.com/docs/en/settings" },
      { url: "https://code.claude.com/docs/en/skills" },
    ],
    surface: "claude-code-cli",
    target: "claude",
  }),
  unknownEvidence(
    "claude",
    "Claude Code cloud",
    "unversioned@2026-09-11",
    "claude-code-cloud",
    [{ url: "https://code.claude.com/docs/en/claude-code-on-the-web" }]
  ),
  unknownEvidence(
    "claude",
    "Claude desktop",
    "unversioned@2026-09-11",
    "claude-desktop",
    [{ url: "https://code.claude.com/docs/en/desktop" }]
  ),
  unknownEvidence(
    "claude",
    "Claude web",
    "unversioned@2026-09-11",
    "claude-web",
    [{ url: "https://claude.ai" }]
  ),
  evidence({
    facts: [
      verified(
        "plugin-storage",
        "${CODEX_HOME}/plugins/cache/<marketplace>/<plugin>/<version>"
      ),
      verified(
        "skill-discovery",
        "<cwd-or-parent-through-repo-root>/.agents/skills/<skill>/SKILL.md"
      ),
      verified("skill-discovery", "$HOME/.agents/skills/<skill>/SKILL.md"),
      verified("skill-discovery", "/etc/codex/skills/<skill>/SKILL.md"),
      verified(
        "skill-discovery",
        "<installed-plugin-root>/skills/<skill>/SKILL.md"
      ),
      verified("marketplace", "${CODEX_HOME}/.tmp/marketplaces/<marketplace>"),
      verified(
        "marketplace",
        "${CODEX_HOME}/config.toml",
        "Marketplace declarations live in the marketplaces table."
      ),
      verified("config", "${CODEX_HOME}/config.toml"),
      verified("config", "<project-or-ancestor>/.codex/config.toml"),
    ],
    providerName: "Codex",
    providerVersion: "0.154.0",
    sources: codexSources(),
    surface: "codex-cli",
    target: "codex",
  }),
  unknownEvidence(
    "codex",
    "Codex IDE extension",
    "unversioned@2026-09-11",
    "codex-ide",
    [
      { url: "https://developers.openai.com/codex/ide" },
      { url: "https://developers.openai.com/codex/config-basic" },
      { url: "https://developers.openai.com/codex/skills" },
    ]
  ),
  unknownEvidence(
    "codex",
    "Codex cloud",
    "unversioned@2026-09-11",
    "codex-cloud",
    [{ url: "https://developers.openai.com/codex/cloud" }]
  ),
  unknownEvidence(
    "codex",
    "ChatGPT desktop",
    "unversioned@2026-09-11",
    "chatgpt-desktop",
    [{ url: "https://learn.chatgpt.com/docs/app" }]
  ),
  unknownEvidence(
    "codex",
    "ChatGPT web",
    "unversioned@2026-09-11",
    "chatgpt-web",
    [{ url: "https://chatgpt.com" }]
  ),
  evidence({
    facts: [
      verified(
        "plugin-storage",
        "~/.cursor/plugins/local/<plugin>",
        "Local development plugins are discovered in place."
      ),
      unknown(
        "plugin-storage",
        "Cursor documents local plugin imports but not the on-disk root for marketplace-installed plugins."
      ),
      verified("skill-discovery", "~/.cursor/skills/<skill>/SKILL.md"),
      verified("skill-discovery", "<project>/.cursor/skills/<skill>/SKILL.md"),
      verified("skill-discovery", "<plugin-root>/skills/<skill>/SKILL.md"),
      unknown(
        "marketplace",
        "Cursor documents marketplace management in Customize but not an on-disk marketplace catalog location."
      ),
      unknown(
        "config",
        "Current Cursor plugin documentation does not establish a supported on-disk plugin configuration file."
      ),
    ],
    providerName: "Cursor",
    providerVersion: "3.17.8",
    observations: [
      {
        fields: {
          CFBundleShortVersionString: "3.17.8",
          CFBundleVersion: "3.17.8",
        },
        kind: "installed-app-metadata",
        observedAt: VERIFIED_AT,
        path: "/Applications/Cursor.app/Contents/Info.plist",
      },
    ],
    sources: [
      {
        note: "Rolling official documentation for plugin paths; it does not pin Cursor 3.17.8.",
        url: "https://cursor.com/docs/plugins",
      },
      {
        note: "Rolling official plugin reference; it does not pin Cursor 3.17.8.",
        url: "https://cursor.com/docs/reference/plugins",
      },
      {
        note: "Rolling official documentation for skill paths; it does not pin Cursor 3.17.8.",
        url: "https://cursor.com/docs/skills",
      },
    ],
    surface: "cursor-ide",
    target: "cursor",
  }),
  unknownEvidence(
    "cursor",
    "Cursor Agent CLI",
    "2026.07.23-e383d2b",
    "cursor-agent-cli",
    [
      { url: "https://cursor.com/docs/cli/headless" },
      { url: "https://cursor.com/docs/plugins" },
    ]
  ),
  unknownEvidence(
    "cursor",
    "Cursor Cloud Agents",
    "unversioned@2026-09-11",
    "cursor-cloud",
    [
      { url: "https://cursor.com/docs/cloud-agent" },
      { url: "https://cursor.com/docs/plugins" },
    ]
  ),
] as const satisfies readonly ProviderLocationEvidence[];

export const providerLocationEvidence = defineProviderLocationEvidence(entries);

export function defineProviderLocationEvidence(
  values: readonly ProviderLocationEvidence[]
): readonly ProviderLocationEvidence[] {
  assertProviderLocationEvidence(values);
  return deepFreeze(
    values
      .map((entry) => ({
        ...entry,
        facts: [...entry.facts],
        ...(entry.observations === undefined
          ? {}
          : {
              observations: entry.observations.map((observation) => ({
                ...observation,
                fields: { ...observation.fields },
              })),
            }),
        sources: [...entry.sources].toSorted((left, right) =>
          compareStrings(left.url, right.url)
        ),
      }))
      .toSorted((left, right) =>
        compareStrings(
          `${left.target}\0${left.surface}\0${left.providerVersion}`,
          `${right.target}\0${right.surface}\0${right.providerVersion}`
        )
      )
  );
}

export function listProviderLocationEvidence(): readonly ProviderLocationEvidence[] {
  return providerLocationEvidence;
}

export function selectProviderLocationEvidence(
  query: ProviderLocationQuery
): ProviderLocationSelection {
  const entry = providerLocationEvidence.find(
    (candidate) =>
      candidate.target === query.target &&
      candidate.surface === query.surface &&
      candidate.providerVersion === query.providerVersion
  );
  if (entry !== undefined) return { evidence: entry, kind: "matched" };
  return {
    kind: "unknown",
    providerVersion: query.providerVersion,
    reason: `No provider-location evidence is registered for ${query.target} ${query.surface} at version ${query.providerVersion}.`,
    surface: query.surface,
    target: query.target,
  };
}

export function assertProviderLocationEvidence(
  values: readonly ProviderLocationEvidence[]
): void {
  const keys = new Set<string>();
  for (const entry of values) {
    if (!PROVIDER_SCHEMA_TARGETS.includes(entry.target)) {
      throw new Error(
        `skillset: unsupported provider-location target ${entry.target}`
      );
    }
    if (!isProviderLocationSurface(entry.surface)) {
      throw new Error(
        `skillset: unsupported provider-location surface ${entry.surface}`
      );
    }
    const surfaceTarget = PROVIDER_LOCATION_SURFACE_TARGETS[entry.surface];
    if (surfaceTarget !== entry.target) {
      throw new Error(
        `skillset: provider-location surface ${entry.surface} belongs to ${surfaceTarget}, not ${entry.target}`
      );
    }
    const key = `${entry.target}\0${entry.surface}\0${entry.providerVersion}`;
    if (keys.has(key))
      throw new Error(
        `skillset: duplicate provider-location evidence ${entry.target} ${entry.surface} ${entry.providerVersion}`
      );
    keys.add(key);
    if (entry.providerName.length === 0 || entry.providerVersion.length === 0) {
      throw new Error(
        `skillset: provider-location evidence ${entry.surface} requires provider name and version`
      );
    }
    if (!isCalendarDate(entry.verifiedAt)) {
      throw new Error(
        `skillset: provider-location evidence ${entry.surface} has invalid verification date ${entry.verifiedAt}`
      );
    }
    if (entry.facts.length === 0 || entry.sources.length === 0) {
      throw new Error(
        `skillset: provider-location evidence ${entry.surface} requires facts and sources`
      );
    }
    for (const source of entry.sources) {
      if (!source.url.startsWith("https://"))
        throw new Error(
          `skillset: provider-location evidence ${entry.surface} source must use https`
        );
    }
    for (const observation of entry.observations ?? []) {
      if (
        observation.kind !== "installed-app-metadata" ||
        observation.path.length === 0 ||
        Object.keys(observation.fields).length === 0 ||
        !isCalendarDate(observation.observedAt)
      ) {
        throw new Error(
          `skillset: provider-location evidence ${entry.surface} has invalid observation provenance`
        );
      }
    }
    for (const fact of entry.facts) {
      const runtimeStatus: unknown = (
        fact as unknown as { readonly status?: unknown }
      ).status;
      if (!PROVIDER_LOCATION_KINDS.includes(fact.kind))
        throw new Error(
          `skillset: unsupported provider-location kind ${fact.kind}`
        );
      if (runtimeStatus !== "verified" && runtimeStatus !== "unknown") {
        throw new Error(
          `skillset: unsupported provider-location status ${String(runtimeStatus)}`
        );
      }
      if (fact.status === "verified" && fact.path.length === 0)
        throw new Error(
          `skillset: verified provider-location fact ${entry.surface} requires a path`
        );
      if (fact.status === "unknown" && fact.reason.length === 0)
        throw new Error(
          `skillset: unknown provider-location fact ${entry.surface} requires a reason`
        );
    }
  }
}

export function getProviderLocationSurfaceTarget(
  surface: string
): ProviderLocationTarget | undefined {
  return isProviderLocationSurface(surface)
    ? PROVIDER_LOCATION_SURFACE_TARGETS[surface]
    : undefined;
}

function evidence(
  entry: Omit<ProviderLocationEvidence, "verifiedAt">
): ProviderLocationEvidence {
  return { ...entry, verifiedAt: VERIFIED_AT };
}

function unknownEvidence(
  target: ProviderLocationTarget,
  providerName: string,
  providerVersion: string,
  surface: ProviderLocationSurface,
  sources: readonly ProviderLocationSource[]
): ProviderLocationEvidence {
  return evidence({
    facts: PROVIDER_LOCATION_KINDS.map((kind) => unknown(kind, UNKNOWN_REASON)),
    providerName,
    providerVersion,
    sources,
    surface,
    target,
  });
}

function verified(
  kind: ProviderLocationKind,
  path: string,
  note?: string
): ProviderLocationFact {
  return {
    kind,
    ...(note === undefined ? {} : { note }),
    path,
    status: "verified",
  };
}

function unknown(
  kind: ProviderLocationKind,
  reason: string
): ProviderLocationFact {
  return { kind, reason, status: "unknown" };
}

function codexSources(): readonly ProviderLocationSource[] {
  const revision = "6b9826e3aa83b1a5947db50f4332cb9c65f1b340";
  return [
    { url: "https://developers.openai.com/codex/config-basic" },
    { url: "https://developers.openai.com/codex/skills" },
    {
      note: "Released Codex 0.154.0 plugin cache and version layout.",
      url: `https://github.com/openai/codex/blob/${revision}/codex-rs/core-plugins/src/store.rs`,
    },
    {
      note: "Released Codex 0.154.0 marketplace installation root.",
      url: `https://github.com/openai/codex/blob/${revision}/codex-rs/core-plugins/src/installed_marketplaces.rs`,
    },
  ];
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isProviderLocationSurface(
  value: string
): value is ProviderLocationSurface {
  return Object.hasOwn(PROVIDER_LOCATION_SURFACE_TARGETS, value);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
