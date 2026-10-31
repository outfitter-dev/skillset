import { createHash } from "node:crypto";
import { getProviderValidationLane, type ProviderValidationLane } from "./provider-validation";

export type ClaudeMarketplaceParserPredicateId = "archive-digest" | "command-limits" | "entry-name-strict" | "entry-name-unique";

export interface ClaudeMarketplaceParserEvidence {
  readonly id: "claude-marketplace-parser-2.1.269";
  readonly authority: "static-parser-inspection";
  readonly target: "claude";
  readonly schemaSnapshotId: "claude-marketplace-schema";
  readonly validationLaneId: "claude-product";
  readonly version: "2.1.269";
  readonly reviewedAt: string;
  readonly archive: { readonly url: string; readonly integrity: string; readonly contentHash: string };
  readonly member: { readonly path: string; readonly bytes: number; readonly contentHash: string };
  readonly windows: readonly { readonly id: string; readonly start: number; readonly end: number; readonly contentHash: string }[];
  readonly predicates: Readonly<Record<ClaudeMarketplaceParserPredicateId, {
    readonly stage: "schema-predicate" | "strict-warning" | "validator-error"; readonly ruleId: string; readonly windows: readonly string[]; readonly claim: string;
  }>>;
  readonly limitation: string;
}

/** Captured from integrity-verified, nonexecuted 2.1.269 bytes on 2026-10-31. */
export const CLAUDE_MARKETPLACE_PARSER_EVIDENCE: ClaudeMarketplaceParserEvidence = {
  "id": "claude-marketplace-parser-2.1.269",
  "authority": "static-parser-inspection",
  "target": "claude",
  "schemaSnapshotId": "claude-marketplace-schema",
  "validationLaneId": "claude-product",
  "version": "2.1.269",
  "reviewedAt": "2026-10-31",
  "archive": {
    "url": "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.269.tgz",
    "integrity": "sha512-Ti+9oKbf2p9pJuMMj1Fv+6YzljREpy9cx6SN7NV7Zik/vaaXPxC8u+cDiGF7HnPPJ5HsLbmwKoh3BnE3IhdAeQ==",
    "contentHash": "sha256:556de237572f052c4597ac6a466573e26c60d2301a27e3c79b739d050b3a62a7"
  },
  "member": {
    "path": "package/claude",
    "bytes": 219651568,
    "contentHash": "sha256:25e44883f54419569a3d739f38cbbdaebe83b09895da0f343e1b003710a4775b"
  },
  "windows": [
    {
      "id": "command-max-and-pattern",
      "start": 181272200,
      "end": 181273900,
      "contentHash": "sha256:381b33b0bf200a5ad3ee8a967c9048c42f342038c812edf5265bc3ec484e63f1"
    },
    {
      "id": "archive-schema",
      "start": 181298900,
      "end": 181300200,
      "contentHash": "sha256:99d90e26f67abbdd86085e308b4d245d935f83f7155ca14a104d2d30e7084fe8"
    },
    {
      "id": "source-union-forms",
      "start": 181300985,
      "end": 181304100,
      "contentHash": "sha256:a4517015e0133b77bd0f2747aed4bdd36ee6c0da5b1f9533609ef48db87f7695"
    },
    {
      "id": "entry-schema-caller",
      "start": 181308616,
      "end": 181309050,
      "contentHash": "sha256:8a3e83f0cfbd435d35c646d16f52bbc9f351f4794af4ecd673ca0633fa329863"
    },
    {
      "id": "entry-safeparse-transform",
      "start": 181309900,
      "end": 181310550,
      "contentHash": "sha256:3398eb32b386f8d3d91450230e69831b54aa2c5b05e115524428bee89a12206b"
    },
    {
      "id": "marketplace-schema-caller",
      "start": 181312531,
      "end": 181313450,
      "contentHash": "sha256:5382d18080afc2d9825d3db83d44cf4cf64793f3452040a457982b388d19afec"
    },
    {
      "id": "export-validate-handler",
      "start": 208330955,
      "end": 208331410,
      "contentHash": "sha256:074f3d3109cb9bc62e5042111440d4895b56c1dcf7a40cfa6441ba4d651942d4"
    },
    {
      "id": "cli-strict-aggregate",
      "start": 208302950,
      "end": 208304220,
      "contentHash": "sha256:c89d0bb32aa8d491aedac05d0c168407e3be2d467cf1fd6140fafdf43556ad33"
    },
    {
      "id": "strict-success-policy",
      "start": 208253347,
      "end": 208253550,
      "contentHash": "sha256:4e59fbbcab3a094d3d341dc22939eb2ab15caa05ec3cc2233ff7f894569c6e81"
    },
    {
      "id": "dispatch-marketplace",
      "start": 208281849,
      "end": 208283000,
      "contentHash": "sha256:ee7bf790fbc3cf830dd6f933c5d3514a66db446a11644440cf7fb77b2b18e1ab"
    },
    {
      "id": "marketplace-validator-schema",
      "start": 208261077,
      "end": 208261350,
      "contentHash": "sha256:5a4c2348b1a4a0b106dcab883e7fe42f61b43755a366844610adfd36c957d43a"
    },
    {
      "id": "marketplace-validator-parse",
      "start": 208263350,
      "end": 208263930,
      "contentHash": "sha256:5294a76d6efc0ef70c3fda4dcea5cb43407a7f5c74a7447f9d02ad8d8a19ae59"
    },
    {
      "id": "marketplace-name-warning",
      "start": 208264150,
      "end": 208265850,
      "contentHash": "sha256:c7f0272128de9bb23df8e7e06d4f4f5026deced74fa248b76f2d7b073685fdea"
    },
    {
      "id": "marketplace-validator-return",
      "start": 208269800,
      "end": 208270450,
      "contentHash": "sha256:3d9655814c800d75487a6b77063444521da8f0447c47a493ebc8326a400c9d8e"
    },
    {
      "id": "strict-name-pattern",
      "start": 208260989,
      "end": 208261077,
      "contentHash": "sha256:49cc01ab308ded5c73adaa63f178d53e1fdfa0c154ea496e7c2482e547a93a72"
    },
    {
      "id": "marketplace-duplicate-names",
      "start": 208266450,
      "end": 208266950,
      "contentHash": "sha256:e6f14085d3f61922f7c71c41daa43f389509d8feb1477199038d8576c3d1ff51"
    }
  ],
  "predicates": {
    "archive-digest": {
      "ruleId": "marketplace.source.archive.digest",
      "windows": [
        "archive-schema",
        "source-union-forms",
        "entry-schema-caller",
        "entry-safeparse-transform",
        "marketplace-schema-caller"
      ],
      "claim": "The optional archive sha256 field uses Hs, a 64-character hexadecimal string predicate, in ic within the marketplace source union.",
      "stage": "schema-predicate"
    },
    "command-limits": {
      "ruleId": "marketplace.source.command.limits",
      "windows": [
        "command-max-and-pattern",
        "source-union-forms",
        "entry-schema-caller",
        "entry-safeparse-transform",
        "marketplace-schema-caller"
      ],
      "claim": "The command source uses maximum length 500, printable ASCII with no four consecutive spaces, optional mode copy/link and optional positive integer timeout at most 600.",
      "stage": "schema-predicate"
    },
    "entry-name-strict": {
      "stage": "strict-warning",
      "ruleId": "marketplace.entry.name.pattern",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "strict-success-policy",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-parse",
        "marketplace-name-warning",
        "marketplace-validator-return",
        "strict-name-pattern"
      ],
      "claim": "The marketplace validator tests nonempty plugin entry names against ze: ASCII alphanumeric first, then ASCII alphanumeric/dot/underscore/hyphen, at most 128 characters. A mismatch is a Claude Desktop compatibility warning. K8n makes warnings fail only under --strict; oa uses that aggregate for CLI status. This is a static condition, not observed execution or ordinary Claude Code runtime rejection."
    },
    "entry-name-unique": {
      "stage": "validator-error",
      "ruleId": "marketplace.entry.name.unique",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-parse",
        "marketplace-duplicate-names",
        "marketplace-validator-return"
      ],
      "claim": "After schema parsing succeeds, the marketplace validator compares plugin names with exact equality and records duplicate names as errors. Core diagnoses each later occurrence against the first, while the pinned validator diagnoses every member of a duplicate group. Static inspection does not establish observed execution or runtime behavior."
    }
  },
  "limitation": "Embedded bundled JavaScript inspection only. Schema-predicate records do not establish command exit status because entry recovery and later validation stages differ. The strict-warning record traces one warning-to-status condition; it does not establish whole-command acceptance, installation, trust or runtime behavior. No provider code was executed."
};

export function assertClaudeMarketplaceParserEvidence(evidence: ClaudeMarketplaceParserEvidence): void {
  const invalid = (message: string): never => { throw new Error(`skillset: Claude marketplace parser evidence ${message}`); };
  const digest = (value: string) => /^sha256:[a-f0-9]{64}$/u.test(value);
  if (evidence.id !== "claude-marketplace-parser-2.1.269" || evidence.version !== "2.1.269" || evidence.authority !== "static-parser-inspection") invalid("has an invalid identity or authority");
  if (evidence.target !== "claude" || evidence.schemaSnapshotId !== "claude-marketplace-schema" || evidence.validationLaneId !== "claude-product") invalid("has invalid target/schema/lane linkage");
  if (!/^https:\/\//u.test(evidence.archive.url) || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(evidence.archive.integrity) || !digest(evidence.archive.contentHash)) invalid("requires pinned archive hashes");
  if (evidence.member.path !== "package/claude" || !Number.isSafeInteger(evidence.member.bytes) || evidence.member.bytes <= 0 || !digest(evidence.member.contentHash)) invalid("requires a pinned regular member");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(evidence.reviewedAt) || evidence.limitation.trim() === "") invalid("requires a review date and limitation");
  if (evidence.windows.length === 0) invalid("requires source windows");
  const ids = new Set<string>();
  for (const window of evidence.windows) {
    if (window.id.trim() === "" || ids.has(window.id)) invalid("has a duplicate or empty source window");
    ids.add(window.id);
    if (!Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end) || window.start < 0 || window.end <= window.start || window.end > evidence.member.bytes || !digest(window.contentHash)) invalid(`has an invalid source window ${window.id}`);
  }
  for (const id of ["archive-digest", "command-limits", "entry-name-strict", "entry-name-unique"] as const) {
    const predicate = evidence.predicates[id];
    if (predicate === undefined || predicate.stage !== (id === "entry-name-strict" ? "strict-warning" : id === "entry-name-unique" ? "validator-error" : "schema-predicate") || predicate.ruleId.trim() === "" || predicate.claim.trim() === "" || predicate.windows.length === 0 || predicate.windows.some((window) => !ids.has(window))) invalid(`has unqualified predicate ${id}`);
  }
  if (Object.keys(evidence.predicates).length !== 4) invalid("has an unreviewed predicate");
}

export interface ClaudeMarketplaceParserPinReview {
  readonly id: ClaudeMarketplaceParserEvidence["id"];
  readonly status: "pin-changed" | "pin-matched";
  readonly expectedVersion: string;
  readonly actualVersion: string;
  readonly reason: string;
}

/** Pin equality is a static evidence freshness check, not a provider run. */
export function inspectClaudeMarketplaceParserPin(
  evidence: ClaudeMarketplaceParserEvidence = CLAUDE_MARKETPLACE_PARSER_EVIDENCE,
  lane: ProviderValidationLane = getProviderValidationLane("claude-product")
): ClaudeMarketplaceParserPinReview {
  assertClaudeMarketplaceParserEvidence(evidence);
  const matched = lane.id === evidence.validationLaneId && lane.authority === "product-validator" &&
    lane.targets.includes(evidence.target) && lane.version === evidence.version &&
    lane.pin === `@anthropic-ai/claude-code@${evidence.version}` &&
    lane.acquisitions.some((source) => source.url === evidence.archive.url && source.integrity === evidence.archive.integrity);
  return { id: evidence.id, expectedVersion: evidence.version, actualVersion: lane.version,
    status: matched ? "pin-matched" : "pin-changed",
    reason: matched ? "Recorded static parser pin matches the validation lane; not runtime acceptance." : "Validation lane identity or artifact pin changed; re-inspect the static evidence before qualification." };
}

/** Reproduce byte identity from a local member; never executes or installs it. */
export function verifyClaudeMarketplaceParserMember(
  bytes: Uint8Array,
  evidence: ClaudeMarketplaceParserEvidence = CLAUDE_MARKETPLACE_PARSER_EVIDENCE
): { readonly ok: boolean; readonly problems: readonly string[] } {
  assertClaudeMarketplaceParserEvidence(evidence);
  const hash = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const problems: string[] = [];
  if (bytes.byteLength !== evidence.member.bytes) problems.push("member byte length differs from the pin");
  if (hash(bytes) !== evidence.member.contentHash) problems.push("member digest differs from the pin");
  for (const window of evidence.windows) {
    if (window.end > bytes.byteLength || hash(bytes.subarray(window.start, window.end)) !== window.contentHash) problems.push(`source window ${window.id} differs from the pin`);
  }
  return { ok: problems.length === 0, problems };
}

assertClaudeMarketplaceParserEvidence(CLAUDE_MARKETPLACE_PARSER_EVIDENCE);
