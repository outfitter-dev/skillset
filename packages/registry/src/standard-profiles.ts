import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const STANDARD_PROFILE_REGISTRY_SCHEMA = "skillset-standard-profile@1";
export const STANDARD_PROFILE_IDS = [
  "agent-instructions",
  "agent-skills",
  "agent-plugins-1.0",
] as const;
export type StandardProfileId = (typeof STANDARD_PROFILE_IDS)[number];

export const STANDARD_PROFILE_LIFECYCLE_STATES = [
  "candidate",
  "adopted",
  "retired",
] as const;
export type StandardProfileLifecycleState =
  (typeof STANDARD_PROFILE_LIFECYCLE_STATES)[number];

export const STANDARD_PROFILE_ENVELOPE_EXPECTATIONS = [
  "required",
  "unsupported",
] as const;
export type StandardProfileEnvelopeExpectation =
  (typeof STANDARD_PROFILE_ENVELOPE_EXPECTATIONS)[number];

export type StandardProfileSnapshotKind = "schema" | "specification";

export interface StandardProfileSnapshot {
  readonly body: string;
  readonly contentHash: string;
  /** Mutable raw source compared by explicit maintenance commands. */
  readonly currentUrl: string;
  readonly kind: StandardProfileSnapshotKind;
  readonly observedAt: string;
  /** Immutable raw revision from which the stored body was recorded. */
  readonly url: string;
}

export interface StandardProfileSupportEnvelope {
  readonly expectation: StandardProfileEnvelopeExpectation;
  readonly featureId: string;
  readonly note: string;
}

export interface StandardProfileProvenance {
  readonly contentHash: string;
  readonly observedAt: string;
  readonly snapshots: readonly StandardProfileSnapshot[];
}

export interface StandardProfile {
  readonly envelopes: readonly StandardProfileSupportEnvelope[];
  readonly id: StandardProfileId;
  readonly lifecycle: StandardProfileLifecycleState;
  readonly provenance: StandardProfileProvenance;
  readonly schema: typeof STANDARD_PROFILE_REGISTRY_SCHEMA;
  readonly summary: string;
  readonly title: string;
  readonly version: string;
}

const OBSERVED_AT = "2026-09-12T15:34:39.000Z";
const AGENT_INSTRUCTIONS_SPECIFICATION = decodeSnapshot(
  "H4sIAAlxpWoC/31VwW4bNxC971dM40MT1Fq5zU0wgrqJUxho08JW20NgVNRytEuLSxIkV7Ju+Yhe+nv5kr7hSrblBgEEaJdLzrz35s3whC5+vvwwv6l7XVXffHx4Ietbf/uynoZhaU0z9W0dXPuqqh633L7scg5pNp2qll1OWHpFJpGiZPpg+ZR8YEcrH3uV5Y/awWjjWmp8+dsfq6p5Z9ya/OoRCymJc3158e7Xy3J03DvDomZtGpVZn1KI8pzV0jIFqxqussei3xjNSOIy32dSTpNxKcehyca7RNjTsQ10cXUMhLY+AoWjnR+ihLnjJgPdT2z9diTWG2d6ZYnvlTAUyMo9Qb0ylmdVtVgsehXX2m9ddUI3497jXVV1ckLveEPsNiZ61wMBZRNSNaE/EtMiuNCTtveUh7j0FAdH244j0/ke2d9O9fxmIXTuhj7Iv6KgmjXYFMKstABMjXJOWG5N7mhh06JGjmvEG3PIVmUtTSbAlTl+KYHSmnLHD+GxVEQSxRIWmZKnP01GzS9vfjEunxbZ57vAN000IRNAUGIAy/URwyYyakkbnP3R4inlZ/mBC7/M0FA2YnuTJzkVWCkYR0MAb8dbupZP9F3B8YC0kH6Ko+NmnSSM3gmSt/JeuEk2lIZtsYs4CPG6Q6Bv0+GpvkvwCLLDYCsT+3I4mrbLJcTnT/+ktQllNfswsbxhC1dxXUo+B0MpxlNHAsZ740aF316Jkx2+l9e6Bf5hORWhV7BhQjNYzfG4hI8WKQJ+rZKyCYjiblQC3bQyjnXpsdyhTw8sBVT0/VHZo/dZCl+qeTckKSucsweB1Iua5p20Xt+bTKnzA9QMKqF3sE92JFoycnEJ03McM809ADRDku6DVATzhtMH10lBkyDLIOVm+3ybcVUITTK9OC9vheiL4vD35h4m3I2SCDuYgDhGHxMNLhtbYm87j95Mg3gGLd5GZienL1YiYI9RgmJJwyaJ0XTKtaV8ffAxp9OSfsRjYfuvSr+UPGA+dsjzBomD5IA5IJQoVkBAAGQdghbrj/KNhRKN9ShiwYTGQ1VhmxU5v/R6hwG6Zj167vfr53abmwzW42Se0cdjsLd0Xr6/EQR2q3bpGctFwf6k6oeajnUXf9cyA0vyv3iZIG4Z8tJ3wePVw3/KYmYY19hBs8zWpUqmoQ8Y2egw2o7HqPPwAq6DTP+7bKZVMSzfo2GMzHVx6kjk86d/UUuPFNJIhwuJwGUcTCsMnSFKIZNH1+/HeSpynUhjlYEpAVUIuArF5rvq+5qu9sNSM642za4xnGYVEYEuCHTy+HSq7j9VP9R0k1XMJaaWkeBDGfmJI7rxiyFEdGw9hHhd029yn5bBu4yYBbCZkGl9udIgD9QpWEW02euzs7PqP9CE6ZffBwAA"
);
const AGENT_SKILLS_SPECIFICATION = decodeSnapshot(
  "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"
);
const AGENT_PLUGINS_SPECIFICATION = decodeSnapshot(
  "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"
);

const AGENT_PLUGINS_PLUGIN_SCHEMA = Buffer.from(
  "ewogICIkc2NoZW1hIjogImh0dHBzOi8vanNvbi1zY2hlbWEub3JnL2RyYWZ0LzIwMjAtMTIvc2NoZW1hIiwKICAiJGlkIjogImh0dHBzOi8vYWdlbnQtcGx1Z2lucy5vcmcvc2NoZW1hcy8xLjAuMC9wbHVnaW4uc2NoZW1hLmpzb24iLAogICJ0aXRsZSI6ICJBZ2VudCBQbHVnaW5zIE1hbmlmZXN0IiwKICAiZGVzY3JpcHRpb24iOiAiTWFjaGluZS1yZWFkYWJsZSBzY2hlbWEgZm9yIHBsdWdpbi5qc29uIGluIEFnZW50IFBsdWdpbnMgMS4wLjAuIFRoZSBBZ2VudCBQbHVnaW5zIHNwZWNpZmljYXRpb24gZGVmaW5lcyBhZGRpdGlvbmFsIHNlbWFudGljIGFuZCBvcGVyYXRpb25hbCByZXF1aXJlbWVudHMuIiwKICAidHlwZSI6ICJvYmplY3QiLAogICJwcm9wZXJ0aWVzIjogewogICAgIiRzY2hlbWEiOiB7CiAgICAgICJjb25zdCI6ICJodHRwczovL2FnZW50LXBsdWdpbnMub3JnL3NjaGVtYXMvMS4wLjAvcGx1Z2luLnNjaGVtYS5qc29uIiwKICAgICAgImRlc2NyaXB0aW9uIjogIkNhbm9uaWNhbCBpZGVudGlmaWVyIG9mIHRoZSBwbHVnaW4gbWFuaWZlc3Qgc2NoZW1hIGZvciB0aGUgQWdlbnQgUGx1Z2lucyB2ZXJzaW9uIHRhcmdldGVkIGJ5IHRoaXMgZG9jdW1lbnQuIgogICAgfSwKICAgICJuYW1lIjogewogICAgICAidHlwZSI6ICJzdHJpbmciLAogICAgICAibWluTGVuZ3RoIjogMSwKICAgICAgIm1heExlbmd0aCI6IDY0LAogICAgICAicGF0dGVybiI6ICJeKD8hLiooPzotLXxcXC5cXC4pKVthLXowLTldKD86W2EtejAtOS4tXSpbYS16MC05XSk/JCIsCiAgICAgICJkZXNjcmlwdGlvbiI6ICJIdW1hbi1yZWFkYWJsZSBwbHVnaW4gbmFtZS4iCiAgICB9LAogICAgInZlcnNpb24iOiB7CiAgICAgICJ0eXBlIjogInN0cmluZyIKICAgIH0sCiAgICAiZGVzY3JpcHRpb24iOiB7CiAgICAgICJ0eXBlIjogInN0cmluZyIKICAgIH0sCiAgICAiYXV0aG9yIjogewogICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAibmFtZSI6IHsKICAgICAgICAgICJ0eXBlIjogInN0cmluZyIKICAgICAgICB9LAogICAgICAgICJlbWFpbCI6IHsKICAgICAgICAgICJ0eXBlIjogInN0cmluZyIKICAgICAgICB9LAogICAgICAgICJ1cmwiOiB7CiAgICAgICAgICAidHlwZSI6ICJzdHJpbmciCiAgICAgICAgfQogICAgICB9LAogICAgICAiYWRkaXRpb25hbFByb3BlcnRpZXMiOiBmYWxzZQogICAgfSwKICAgICJob21lcGFnZSI6IHsKICAgICAgInR5cGUiOiAic3RyaW5nIgogICAgfSwKICAgICJyZXBvc2l0b3J5IjogewogICAgICAidHlwZSI6ICJzdHJpbmciCiAgICB9LAogICAgImxpY2Vuc2UiOiB7CiAgICAgICJ0eXBlIjogInN0cmluZyIKICAgIH0sCiAgICAia2V5d29yZHMiOiB7CiAgICAgICJ0eXBlIjogImFycmF5IiwKICAgICAgIml0ZW1zIjogewogICAgICAgICJ0eXBlIjogInN0cmluZyIKICAgICAgfQogICAgfSwKICAgICJleHRlbnNpb25zIjogewogICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAiZGVzY3JpcHRpb24iOiAiQ2xpZW50LXNwZWNpZmljIG1hbmlmZXN0IGRhdGEga2V5ZWQgYnkgcmV2ZXJzZS1kb21haW4gZXh0ZW5zaW9uIG5hbWVzcGFjZS4gQWdlbnQgUGx1Z2lucyBhc3NpZ25zIG5vIHNlbWFudGljcyB0byBuYW1lc3BhY2Ugb2JqZWN0IGNvbnRlbnRzLiIsCiAgICAgICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IHsKICAgICAgICAidHlwZSI6ICJvYmplY3QiCiAgICAgIH0KICAgIH0KICB9LAogICJyZXF1aXJlZCI6IFsiJHNjaGVtYSIsICJuYW1lIl0sCiAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogZmFsc2UKfQo=",
  "base64"
).toString("utf8");
const AGENT_PLUGINS_MCP_SCHEMA = Buffer.from(
  "ewogICIkc2NoZW1hIjogImh0dHBzOi8vanNvbi1zY2hlbWEub3JnL2RyYWZ0LzIwMjAtMTIvc2NoZW1hIiwKICAiJGlkIjogImh0dHBzOi8vYWdlbnQtcGx1Z2lucy5vcmcvc2NoZW1hcy8xLjAuMC9tY3Auc2NoZW1hLmpzb24iLAogICJ0aXRsZSI6ICJBZ2VudCBQbHVnaW5zIE1DUCBDb25maWd1cmF0aW9uIiwKICAiZGVzY3JpcHRpb24iOiAiTWFjaGluZS1yZWFkYWJsZSBzY2hlbWEgZm9yIG1jcC5qc29uIGluIEFnZW50IFBsdWdpbnMgMS4wLjAuIFRoZSBBZ2VudCBQbHVnaW5zIHNwZWNpZmljYXRpb24gZGVmaW5lcyBhZGRpdGlvbmFsIHNlbWFudGljIGFuZCBvcGVyYXRpb25hbCByZXF1aXJlbWVudHMuIiwKICAidHlwZSI6ICJvYmplY3QiLAogICJwcm9wZXJ0aWVzIjogewogICAgIiRzY2hlbWEiOiB7CiAgICAgICJjb25zdCI6ICJodHRwczovL2FnZW50LXBsdWdpbnMub3JnL3NjaGVtYXMvMS4wLjAvbWNwLnNjaGVtYS5qc29uIiwKICAgICAgImRlc2NyaXB0aW9uIjogIkNhbm9uaWNhbCBpZGVudGlmaWVyIG9mIHRoZSBNQ1AgY29uZmlndXJhdGlvbiBzY2hlbWEgZm9yIHRoZSBBZ2VudCBQbHVnaW5zIHZlcnNpb24gdGFyZ2V0ZWQgYnkgdGhpcyBkb2N1bWVudC4iCiAgICB9LAogICAgIm1jcFNlcnZlcnMiOiB7CiAgICAgICJ0eXBlIjogIm9iamVjdCIsCiAgICAgICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IHsKICAgICAgICAiJHJlZiI6ICIjLyRkZWZzL3NlcnZlciIKICAgICAgfQogICAgfQogIH0sCiAgInJlcXVpcmVkIjogWyIkc2NoZW1hIiwgIm1jcFNlcnZlcnMiXSwKICAiYWRkaXRpb25hbFByb3BlcnRpZXMiOiBmYWxzZSwKICAiJGRlZnMiOiB7CiAgICAic2VydmVyIjogewogICAgICAidGl0bGUiOiAiTUNQIHNlcnZlciIsCiAgICAgICJvbmVPZiI6IFsKICAgICAgICB7CiAgICAgICAgICAiJHJlZiI6ICIjLyRkZWZzL3N0ZGlvU2VydmVyIgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIiRyZWYiOiAiIy8kZGVmcy9zdHJlYW1hYmxlSHR0cFNlcnZlciIKICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICIkcmVmIjogIiMvJGRlZnMvc3NlU2VydmVyIgogICAgICAgIH0KICAgICAgXQogICAgfSwKICAgICJzdGRpb1NlcnZlciI6IHsKICAgICAgInRpdGxlIjogInN0ZGlvIE1DUCBzZXJ2ZXIiLAogICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidHlwZSI6IHsKICAgICAgICAgICJjb25zdCI6ICJzdGRpbyIKICAgICAgICB9LAogICAgICAgICJjb21tYW5kIjogewogICAgICAgICAgInR5cGUiOiAic3RyaW5nIiwKICAgICAgICAgICJtaW5MZW5ndGgiOiAxLAogICAgICAgICAgImRlc2NyaXB0aW9uIjogIkV4ZWN1dGFibGUgdG9rZW4uIFJlc29sdXRpb24gcnVsZXMgYXJlIGRlZmluZWQgYnkgdGhlIEFnZW50IFBsdWdpbnMgc3BlY2lmaWNhdGlvbi4iCiAgICAgICAgfSwKICAgICAgICAiYXJncyI6IHsKICAgICAgICAgICJ0eXBlIjogImFycmF5IiwKICAgICAgICAgICJpdGVtcyI6IHsKICAgICAgICAgICAgInR5cGUiOiAic3RyaW5nIgogICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgImVudiI6IHsKICAgICAgICAgICJ0eXBlIjogIm9iamVjdCIsCiAgICAgICAgICAicHJvcGVydHlOYW1lcyI6IHsKICAgICAgICAgICAgIm5vdCI6IHsKICAgICAgICAgICAgICAiZW51bSI6IFsiUExVR0lOX1JPT1QiLCAiUExVR0lOX0RBVEEiXQogICAgICAgICAgICB9CiAgICAgICAgICB9LAogICAgICAgICAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogewogICAgICAgICAgICAidHlwZSI6ICJzdHJpbmciCiAgICAgICAgICB9CiAgICAgICAgfSwKICAgICAgICAiY3dkIjogewogICAgICAgICAgInR5cGUiOiAic3RyaW5nIiwKICAgICAgICAgICJwYXR0ZXJuIjogIl4oPzpcXC4vfFxcJFxce1BMVUdJTl9ST09UXFx9KD86L3wkKXxcXCRcXHtQTFVHSU5fREFUQVxcfSg/Oi98JCkpIiwKICAgICAgICAgICJkZXNjcmlwdGlvbiI6ICJQbHVnaW4tcmVsYXRpdmUsIFBMVUdJTl9ST09ULXJvb3RlZCwgb3IgUExVR0lOX0RBVEEtcm9vdGVkIHdvcmtpbmcgZGlyZWN0b3J5LiBGaWxlc3lzdGVtIGNvbnRhaW5tZW50IGlzIHZhbGlkYXRlZCBzZXBhcmF0ZWx5LiIKICAgICAgICB9CiAgICAgIH0sCiAgICAgICJyZXF1aXJlZCI6IFsidHlwZSIsICJjb21tYW5kIl0sCiAgICAgICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IGZhbHNlCiAgICB9LAogICAgInN0cmVhbWFibGVIdHRwU2VydmVyIjogewogICAgICAidGl0bGUiOiAiU3RyZWFtYWJsZSBIVFRQIE1DUCBzZXJ2ZXIiLAogICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidHlwZSI6IHsKICAgICAgICAgICJjb25zdCI6ICJzdHJlYW1hYmxlLWh0dHAiCiAgICAgICAgfSwKICAgICAgICAidXJsIjogewogICAgICAgICAgInR5cGUiOiAic3RyaW5nIiwKICAgICAgICAgICJtaW5MZW5ndGgiOiAxLAogICAgICAgICAgImRlc2NyaXB0aW9uIjogIk1DUCBlbmRwb2ludCBVUkwuIFVSTCBzZW1hbnRpY3MgYXJlIGRlZmluZWQgYnkgdGhlIEFnZW50IFBsdWdpbnMgc3BlY2lmaWNhdGlvbi4iCiAgICAgICAgfSwKICAgICAgICAiaGVhZGVycyI6IHsKICAgICAgICAgICIkcmVmIjogIiMvJGRlZnMvaGVhZGVycyIKICAgICAgICB9CiAgICAgIH0sCiAgICAgICJyZXF1aXJlZCI6IFsidHlwZSIsICJ1cmwiXSwKICAgICAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogZmFsc2UKICAgIH0sCiAgICAic3NlU2VydmVyIjogewogICAgICAidGl0bGUiOiAiTGVnYWN5IEhUVFArU1NFIE1DUCBzZXJ2ZXIiLAogICAgICAidHlwZSI6ICJvYmplY3QiLAogICAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidHlwZSI6IHsKICAgICAgICAgICJjb25zdCI6ICJzc2UiCiAgICAgICAgfSwKICAgICAgICAidXJsIjogewogICAgICAgICAgInR5cGUiOiAic3RyaW5nIiwKICAgICAgICAgICJtaW5MZW5ndGgiOiAxLAogICAgICAgICAgImRlc2NyaXB0aW9uIjogIk1DUCBlbmRwb2ludCBVUkwuIFVSTCBzZW1hbnRpY3MgYXJlIGRlZmluZWQgYnkgdGhlIEFnZW50IFBsdWdpbnMgc3BlY2lmaWNhdGlvbi4iCiAgICAgICAgfSwKICAgICAgICAiaGVhZGVycyI6IHsKICAgICAgICAgICIkcmVmIjogIiMvJGRlZnMvaGVhZGVycyIKICAgICAgICB9CiAgICAgIH0sCiAgICAgICJyZXF1aXJlZCI6IFsidHlwZSIsICJ1cmwiXSwKICAgICAgImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjogZmFsc2UKICAgIH0sCiAgICAiaGVhZGVycyI6IHsKICAgICAgInRpdGxlIjogIkhUVFAgaGVhZGVycyIsCiAgICAgICJ0eXBlIjogIm9iamVjdCIsCiAgICAgICJhZGRpdGlvbmFsUHJvcGVydGllcyI6IHsKICAgICAgICAidHlwZSI6ICJzdHJpbmciCiAgICAgIH0KICAgIH0KICB9Cn0K",
  "base64"
).toString("utf8");

const profiles = [
  makeProfile({
    envelopes: [
      required(
        "project-instructions",
        "AGENTS.md is the portable instruction baseline."
      ),
    ],
    id: "agent-instructions",
    lifecycle: "candidate",
    observedAt: OBSERVED_AT,
    snapshots: [
      specification(
        "https://raw.githubusercontent.com/agentsmd/agents.md/d001185d792eb6402a58e4cbef1c228b309ec25d/README.md",
        "https://raw.githubusercontent.com/agentsmd/agents.md/main/README.md",
        AGENT_INSTRUCTIONS_SPECIFICATION
      ),
    ],
    summary:
      "Portable repository and nested AGENTS.md instruction files, without client discovery or precedence claims.",
    title: "Agent Instructions",
    version: "unversioned",
  }),
  makeProfile({
    envelopes: [
      required(
        "standalone-skills",
        "A portable skill directory contains SKILL.md."
      ),
    ],
    id: "agent-skills",
    lifecycle: "candidate",
    observedAt: OBSERVED_AT,
    snapshots: [
      specification(
        "https://raw.githubusercontent.com/agentskills/agentskills/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx",
        "https://raw.githubusercontent.com/agentskills/agentskills/main/docs/specification.mdx",
        AGENT_SKILLS_SPECIFICATION
      ),
    ],
    summary:
      "Portable skill directories and SKILL.md baseline semantics before provider-specific metadata.",
    title: "Agent Skills",
    version: "unversioned",
  }),
  makeProfile({
    envelopes: [
      required(
        "plugin-manifests",
        "The portable package owns a root plugin.json."
      ),
      required(
        "plugin-skills",
        "The portable package owns immediate-child skills/ entries."
      ),
      required("plugin-mcp", "The portable package may own a root mcp.json."),
    ],
    id: "agent-plugins-1.0",
    lifecycle: "candidate",
    observedAt: OBSERVED_AT,
    snapshots: [
      specification(
        "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/spec/1.0.0.md",
        "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/spec/1.0.0.md",
        AGENT_PLUGINS_SPECIFICATION
      ),
      schema(
        "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/schemas/1.0.0/plugin.schema.json",
        "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json",
        AGENT_PLUGINS_PLUGIN_SCHEMA
      ),
      schema(
        "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/schemas/1.0.0/mcp.schema.json",
        "https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json",
        AGENT_PLUGINS_MCP_SCHEMA
      ),
    ],
    summary:
      "Portable Agent Plugins 1.0 package structure with exact offline plugin and MCP JSON Schema snapshots.",
    title: "Agent Plugins 1.0",
    version: "1.0.0",
  }),
] as const satisfies readonly StandardProfile[];

export const standardProfiles = defineStandardProfiles(profiles);
export function listStandardProfiles(): readonly StandardProfile[] {
  return standardProfiles;
}
export function getStandardProfile(id: StandardProfileId): StandardProfile {
  const profile = standardProfiles.find((candidate) => candidate.id === id);
  if (profile === undefined)
    throw new Error("skillset: missing standard profile " + id);
  return profile;
}
export function getStandardProfileSupportEnvelope(
  profileId: StandardProfileId,
  featureId: string
): StandardProfileSupportEnvelope | undefined {
  return getStandardProfile(profileId).envelopes.find(
    (envelope) => envelope.featureId === featureId
  );
}
export function listStandardProfileSchemaSnapshots(
  profileId: StandardProfileId
): readonly StandardProfileSnapshot[] {
  return getStandardProfile(profileId).provenance.snapshots.filter(
    (snapshot) => snapshot.kind === "schema"
  );
}
export function defineStandardProfiles(
  entries: readonly StandardProfile[]
): readonly StandardProfile[] {
  assertStandardProfiles(entries);
  return deepFreeze(
    entries
      .map((profile) => ({
        ...profile,
        envelopes: [...profile.envelopes].toSorted((left, right) =>
          left.featureId.localeCompare(right.featureId)
        ),
        provenance: {
          ...profile.provenance,
          snapshots: [...profile.provenance.snapshots].toSorted((left, right) =>
            left.url.localeCompare(right.url)
          ),
        },
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id))
  );
}
export function assertStandardProfiles(
  entries: readonly StandardProfile[]
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id))
      throw new Error("skillset: duplicate standard profile " + entry.id);
    ids.add(entry.id);
    if (!STANDARD_PROFILE_IDS.includes(entry.id))
      throw new Error("skillset: unknown standard profile " + entry.id);
    if (!STANDARD_PROFILE_LIFECYCLE_STATES.includes(entry.lifecycle))
      throw new Error(
        "skillset: standard profile " + entry.id + " has an invalid lifecycle"
      );
    if (entry.schema !== STANDARD_PROFILE_REGISTRY_SCHEMA)
      throw new Error(
        "skillset: unsupported standard profile schema " + entry.schema
      );
    assertTimestamp(entry.provenance.observedAt, "observedAt");
    if (entry.provenance.snapshots.length === 0)
      throw new Error(
        "skillset: standard profile " +
          entry.id +
          " requires immutable snapshots"
      );
    const features = new Set<string>();
    for (const envelope of entry.envelopes) {
      if (envelope.featureId.length === 0 || envelope.note.length === 0)
        throw new Error(
          "skillset: standard profile " +
            entry.id +
            " has an invalid support envelope"
        );
      if (features.has(envelope.featureId))
        throw new Error(
          "skillset: standard profile " +
            entry.id +
            " has a duplicate envelope for " +
            envelope.featureId
        );
      features.add(envelope.featureId);
      if (
        !STANDARD_PROFILE_ENVELOPE_EXPECTATIONS.includes(envelope.expectation)
      )
        throw new Error(
          "skillset: standard profile " +
            entry.id +
            " has an invalid support envelope expectation"
        );
    }
    for (const snapshot of entry.provenance.snapshots) {
      assertTimestamp(snapshot.observedAt, "snapshot.observedAt");
      if (
        !snapshot.url.startsWith("https://") ||
        !snapshot.currentUrl.startsWith("https://") ||
        snapshot.body.length === 0
      )
        throw new Error(
          "skillset: standard profile " +
            entry.id +
            " has an invalid immutable snapshot"
        );
      if (snapshot.contentHash !== hashStandardProfileSnapshot(snapshot))
        throw new Error(
          "skillset: standard profile " +
            entry.id +
            " snapshot hash drifted for " +
            snapshot.url
        );
    }
    if (entry.provenance.contentHash !== hashStandardProfile(entry))
      throw new Error(
        "skillset: standard profile " +
          entry.id +
          " hash drifted; expected " +
          entry.provenance.contentHash
      );
  }
}
export function hashStandardProfileSnapshot(
  snapshot: Pick<StandardProfileSnapshot, "body">
): string {
  return "sha256:" + createHash("sha256").update(snapshot.body).digest("hex");
}
export function hashStandardProfile(profile: StandardProfile): string {
  return (
    "sha256:" +
    createHash("sha256").update(normalizeStandardProfile(profile)).digest("hex")
  );
}
export function normalizeStandardProfile(profile: StandardProfile): string {
  const { contentHash: _contentHash, ...provenance } = profile.provenance;
  return (
    stableStringify({
      envelopes: [...profile.envelopes].toSorted((left, right) =>
        left.featureId.localeCompare(right.featureId)
      ),
      id: profile.id,
      lifecycle: profile.lifecycle,
      provenance: {
        ...provenance,
        snapshots: [...provenance.snapshots].toSorted((left, right) =>
          left.url.localeCompare(right.url)
        ),
      },
      schema: profile.schema,
      summary: profile.summary,
      title: profile.title,
      version: profile.version,
    }) + "\n"
  );
}
function makeProfile(
  input: Omit<StandardProfile, "provenance" | "schema"> & {
    readonly observedAt: string;
    readonly snapshots: readonly Omit<
      StandardProfileSnapshot,
      "contentHash" | "observedAt"
    >[];
  }
): StandardProfile {
  const snapshots = input.snapshots.map((snapshot) => ({
    ...snapshot,
    contentHash: hashStandardProfileSnapshot(snapshot),
    observedAt: input.observedAt,
  }));
  const { observedAt, snapshots: _snapshots, ...profileInput } = input;
  const profile: StandardProfile = {
    ...profileInput,
    provenance: { contentHash: "", observedAt, snapshots },
    schema: STANDARD_PROFILE_REGISTRY_SCHEMA,
  };
  return {
    ...profile,
    provenance: {
      ...profile.provenance,
      contentHash: hashStandardProfile(profile),
    },
  };
}
function required(
  featureId: string,
  note: string
): StandardProfileSupportEnvelope {
  return { expectation: "required", featureId, note };
}
function schema(
  url: string,
  currentUrl: string,
  body: string
): Omit<StandardProfileSnapshot, "contentHash" | "observedAt"> {
  return { body, currentUrl, kind: "schema", url };
}
function specification(
  url: string,
  currentUrl: string,
  body: string
): Omit<StandardProfileSnapshot, "contentHash" | "observedAt"> {
  return { body, currentUrl, kind: "specification", url };
}
function decodeSnapshot(compressed: string): string {
  return gunzipSync(Buffer.from(compressed, "base64")).toString("utf8");
}
function assertTimestamp(value: string, field: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new Error(
      "skillset: standard profile " + field + " must be an ISO timestamp"
    );
}
function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort())
    sorted[key] = sortJson(record[key] ?? null);
  return sorted;
}
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
