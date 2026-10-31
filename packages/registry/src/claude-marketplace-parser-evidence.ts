import { createHash } from "node:crypto";
import { getProviderValidationLane, type ProviderValidationLane } from "./provider-validation";

export type ClaudeMarketplaceParserPredicateId = "monitor-references" | "monitor-required" | "monitor-closed-when" | "monitor-unique" | "lsp-references" | "lsp-required" | "lsp-fields" | "lsp-values" | "component-references" | "dependency-extra-fields" | "mcp-references" | "mcp-variants" | "mcp-records" | "mcp-oauth-fields" | "mcp-oauth-values" | "channel-shape" | "user-config-types" | "user-config-closed" | "command-map-fields" | "command-map-source" | "archive-digest" | "command-limits" | "entry-name-strict" | "entry-name-unique" | "metadata-closed-strict" | "rename-values" | "header-shape" | "header-helper-strict" | "header-source-digest" | "header-restricted";

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
  "id": "strict-object-helper",
  "start": 181149000,
  "end": 181149720,
  "contentHash": "sha256:4ba2d2b0eee9ea6c36bc78de067343acd83916b4657650755f76aff80fbb22ae"
},
{
  "id": "lsp-string-predicates",
  "start": 181285700,
  "end": 181286050,
  "contentHash": "sha256:fc0fc249d9e6a29fb060af43538fc0df2121aec22bc63a6f4820d6d6417955d3"
},
{
  "id": "lsp-monitor-schemas",
  "start": 181288500,
  "end": 181293791,
  "contentHash": "sha256:03dec0ce45f1409284fc37b0278792b131709ab93ae21e4edc34c38437da2e62"
},
  {
    "id": "simple-component-paths",
    "start": 181275990,
    "end": 181276550,
    "contentHash": "sha256:068daeff493f00ca01204887497649ad085fe16aa7195f335f9313f6dcf0e5b8"
  },
  {
    "id": "simple-component-fields",
    "start": 181281186,
    "end": 181285700,
    "contentHash": "sha256:4688c277d4c9c080d325ebc7d5f0b7374db57c7cec9e0062e21f8044ddfa4f9d"
  }
,
{
  "id": "dependency-input-schema",
  "start": 181314000,
  "end": 181315100,
  "contentHash": "sha256:bcd2cd1f3213b810ef11d81e2d89024806e3abbb425402364a8565a809790070"
},
{
  "id": "shared-plugin-fields",
  "start": 181278016,
  "end": 181281186,
  "contentHash": "sha256:8520ce50c69a6f8c9d09f09470a2318315bfd2dfc5f191f7c9110f05ac14e4a6"
},
{
  "id": "mcp-reference-forms",
  "start": 181275990,
  "end": 181276800,
  "contentHash": "sha256:7452ce61ca0b51a8105d01b18a25b59b6e368ef685ab5a61f0cbdd1f87d6f039"
},
{
  "id": "mcp-container-forms",
  "start": 181285700,
  "end": 181286370,
  "contentHash": "sha256:b6156b87514d6f13b10bb5e86b82ea82abad0c7419fab1e4f01c280b70153506"
},
{
  "id": "mcp-main-variants",
  "start": 181222950,
  "end": 181224900,
  "contentHash": "sha256:ce63e3f70c42761c6b030a4bd4f190b4e5b0a07e03892636663eb5d56367f40f"
},
{
  "id": "mcp-late-variants",
  "start": 181227193,
  "end": 181228015,
  "contentHash": "sha256:13de2f79ed4ef1ab63ab5fbe1bb00c93938e5090113a2ef295019cbf8d0f7607"
},
{
  "id": "shared-user-config-channels",
  "start": 181286350,
  "end": 181288550,
  "contentHash": "sha256:83a7bd378c5cdf2f8828bac93ff7199d3635407f7d3a4d8487d14d02428f1313"
},
{
  "id": "shared-command-path",
  "start": 181275990,
  "end": 181276550,
  "contentHash": "sha256:068daeff493f00ca01204887497649ad085fe16aa7195f335f9313f6dcf0e5b8"
},
{
  "id": "shared-command-map",
  "start": 181281186,
  "end": 181282512,
  "contentHash": "sha256:be916aa965d324c9ff2f0787f361de0855c9bf7fed79f0ae322a61453eceb845"
},
{
  "id": "shared-plugin-base",
  "start": 181293791,
  "end": 181294400,
  "contentHash": "sha256:50afe06e4df777bc5486a5da5a4d46dfd29abe589cb4513011f3b622f09ff32c"
},
{
  "id": "standalone-plugin-parser",
  "start": 186903305,
  "end": 186905500,
  "contentHash": "sha256:4a26f29dd60e3f7c7e9a5b697d10a7cbb8f0cd715454956e1f9ef4d7fc32784c"
},
{
  "id": "standalone-plugin-loader",
  "start": 208256010,
  "end": 208258650,
  "contentHash": "sha256:95a3fc650ed46ce312ca233838779d841031621208257e844e23bec19e586cc9"
},
{
  "id": "marketplace-shared-base",
  "start": 181308616,
  "end": 181309750,
  "contentHash": "sha256:5b7a6bd60549bcc58b40e84692bce235a759ae67e945eb21b52e55515f7c4f7c"
},
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
    },
    {
      "id": "marketplace-metadata-shape",
      "start": 181312531,
      "end": 181314017,
      "contentHash": "sha256:90067633aa85cc84aacdaa24c5fc6d5f9b0702f53c768d875c9be1d7d9f726a5"
    },
    {
      "id": "strict-validator-overrides-and-unknown",
      "start": 208263350,
      "end": 208265800,
      "contentHash": "sha256:ec968f65baa3785da49d03e64f3484548f9a85c442a584b56672d0bd144c6815"
    },
    {
      "id": "unknown-warning-helper",
      "start": 208254850,
      "end": 208255195,
      "contentHash": "sha256:debad8fffcd9f1ccd97a117fb53b6b2294878011a880a6529ac9704e666f83da"
    },
    {
      "id": "entry-fields",
      "start": 181308616,
      "end": 181309750,
      "contentHash": "sha256:5b7a6bd60549bcc58b40e84692bce235a759ae67e945eb21b52e55515f7c4f7c"
    },
    {
      "id": "marketplace-conditional-checks",
      "start": 208266550,
      "end": 208268250,
      "contentHash": "sha256:cf9c0ab18dca3c2099bbe72d578a757382dd4be9c05a62d8462f56af38d875e3"
    },
    {
      "id": "helper-nonempty",
      "start": 185055450,
      "end": 185055750,
      "contentHash": "sha256:c12c95bbc069509283886c1700125a9d3713f37cfa99f94c5f16cde078a02a0a"
    },
    {
      "id": "restricted-headers",
      "start": 185062050,
      "end": 185063350,
      "contentHash": "sha256:00a3fe69908947e6152dea56c112e1078dd3a85463a8082b865bb96eb74e5e00"
    }
  ],
  "predicates": {
"monitor-references": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.monitors.references",
  "windows": [
    "strict-object-helper",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Shared Ns input accepts a relative ./ JSON reference or an array of strict monitor records. No filesystem or runtime claim."
},
"monitor-required": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.monitors.required",
  "windows": [
    "strict-object-helper",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Strict ec requires nonempty name, command and description strings without trimming."
},
"monitor-closed-when": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.monitors.closed_when",
  "windows": [
    "strict-object-helper",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Strict ec allows only name/command/description/when. Optional when equals always or begins on-skill-invoke: with length greater than 16."
},
"monitor-unique": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.monitors.unique",
  "windows": [
    "strict-object-helper",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Tzn requires exact case-sensitive unique monitor names. Core reports duplicate string names independently of other invalid entries; provider error cardinality on malformed records is not claimed."
},
"lsp-references": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.lsp.references",
  "windows": [
    "strict-object-helper",
    "lsp-string-predicates",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Shared tc input is a ./ JSON path, named server map, or array of those forms. No filesystem existence or runtime loading claim."
},
"lsp-required": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.lsp.required",
  "windows": [
    "strict-object-helper",
    "lsp-string-predicates",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Strict tut config requires command and extensionToLanguage; map entries must be objects."
},
"lsp-fields": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.lsp.fields",
  "windows": [
    "strict-object-helper",
    "lsp-string-predicates",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Qe uses the same never catchall as strict; tut closes known typed fields, permits arbitrary initializationOptions/settings, and transport is stdio or socket. No default is applied by conformance."
},
"lsp-values": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.lsp.values",
  "windows": [
    "strict-object-helper",
    "lsp-string-predicates",
    "lsp-monitor-schemas",
    "simple-component-paths",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Command is nonempty and forbids ASCII spaces unless starting slash; extension map is nonempty with dotted keys of length at least two and nonempty language strings. Args are nonempty strings, env values strings, timeouts positive integers and restarts nonnegative integers."
},
"component-references": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.components.simple_paths",
  "windows": [
    "simple-component-paths",
    "simple-component-fields",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "marketplace-shared-base"
  ],
  "claim": "Shared agents references start ./ and end .md; commands, outputStyles, themes and workflows references start ./; skills also allow literal dot. String and array input forms only; command maps have separate ownership. Static input predicates do not prove filesystem existence, containment or runtime loading."
},
"dependency-extra-fields": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.dependencies.object_extra_fields",
  "windows": [
    "dependency-input-schema",
    "shared-plugin-fields",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Shared zd dependencies use Ec: patterned strings or objects requiring patterned nonempty name and optional patterned nonempty marketplace. Ec objects are loose and do not constrain extra values including version. The provider subsequently transforms to an identifier string; conformance validates input only and does not promise preservation or apply normalization."
},
"mcp-references": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.components.mcp_reference",
  "windows": [
    "mcp-reference-forms",
    "mcp-container-forms",
    "mcp-main-variants",
    "mcp-late-variants",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "qd accepts a relative ./ JSON path, a relative or URL MCPB/DXT path, a string-keyed map of w6 configs, or an array of those forms. Bundle strings must end exactly .mcpb or .dxt; remote JSON references are not this union."
},
"mcp-variants": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.mcp.variants",
  "windows": [
    "mcp-reference-forms",
    "mcp-container-forms",
    "mcp-main-variants",
    "mcp-late-variants",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "w6 accepts stdio (including absent type), sse, http/streamable-http, ws, sse-ide, ws-ide, sdk and claudeai-proxy. Required strings and optional fields are variant-specific; stdio command is nonempty, timeout is positive integer, tools and permission values use finite enums. Proxy response maps, eligible and ineligibleReason are nullish. role, request_timeout_ms and discoverSupport catch invalid values; objects strip unknown keys. Core validates inputs without reproducing transforms or promising runtime usability."
},
"mcp-records": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.mcp.records",
  "windows": [
    "mcp-reference-forms",
    "mcp-container-forms",
    "mcp-main-variants",
    "mcp-late-variants",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Declared env and headers records use arbitrary string keys and string values; toolPermissions values use allow/ask/blocked. Fields not declared by the chosen w6 branch are stripped rather than validated as another branch."
},
"mcp-oauth-fields": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.mcp.oauth.fields",
  "windows": [
    "mcp-reference-forms",
    "mcp-container-forms",
    "mcp-main-variants",
    "mcp-late-variants",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "HTTP/SSE xo OAuth uses optional string clientId/authServerMetadataUrl/scopes, numeric callbackPort and boolean xaa. Unknown keys are stripped. ws and other branches do not declare oauth."
},
"mcp-oauth-values": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.mcp.oauth.values",
  "windows": [
    "mcp-reference-forms",
    "mcp-container-forms",
    "mcp-main-variants",
    "mcp-late-variants",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "xo callbackPort is a positive integer; authServerMetadataUrl must pass URL parsing and start with literal lowercase https://; scopes is a nonempty string. Static schema predicates only."
},
"channel-shape": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.channels.shape",
  "windows": [
    "shared-user-config-channels",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Shared Qd accepts arrays of strict objects with nonempty string server, optional string displayName and string-keyed userConfig records of Ls. Channel config keys have no identifier restriction; no server-reference existence check is established by this schema."
},
"user-config-types": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.userconfig.types",
  "windows": [
    "shared-user-config-channels",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Shared Ls requires object entries with type enum string/number/boolean/directory/file and string title/description; optional required/multiple/sensitive booleans, min/max numbers and default string/number/boolean/string-array. Empty strings and uncorrelated min/max/default are accepted. Zd applies identifier keys at root only."
},
"user-config-closed": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.userconfig.closed",
  "windows": [
    "shared-user-config-channels",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Ls is strict: only type/title/description/required/default/multiple/sensitive/min/max are accepted in the pinned 2.1.269 schema. This version-specific predicate does not resolve changes in newer provider versions."
},
"command-map-fields": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.commands.object",
  "windows": [
    "shared-command-path",
    "shared-command-map",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Shared Kd command-map entries are objects with optional string source/content/description/argumentHint/model and string-array allowedTools. Kd uses default object stripping, not strict unknown-key rejection. He calls sQ, which parses mwe; marketplace H$t extends mwe. These static call paths establish shared field parsing, not runtime behavior."
},
"command-map-source": {
  "stage": "schema-predicate",
  "ruleId": "marketplace.commands.source",
  "windows": [
    "shared-command-path",
    "shared-command-map",
    "shared-plugin-base",
    "standalone-plugin-parser",
    "standalone-plugin-loader",
    "marketplace-shared-base"
  ],
  "claim": "Kd requires exactly one truthy source/content value. Source uses vn (An or fe), requiring ./ prefix; an empty content alongside a valid source is accepted. This is schema input validation only."
},
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
    },
    "metadata-closed-strict": {
      "stage": "strict-warning",
      "ruleId": "marketplace.metadata.closed",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-return",
        "strict-validator-overrides-and-unknown",
        "marketplace-metadata-shape",
        "unknown-warning-helper",
        "strict-success-policy"
      ],
      "claim": "The validator compares raw object-valued metadata keys to LMe metadata keys pluginRoot/version/description using U. Other keys produce warnings, which fail only under --strict. Core reports an unknown-field diagnostic. This qualifies the exact key set, not ordinary non-strict validation, value types or runtime behavior."
    },
    "rename-values": {
      "stage": "validator-error",
      "ruleId": "marketplace.renames.values",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-return",
        "strict-validator-overrides-and-unknown",
        "marketplace-metadata-shape"
      ],
      "claim": "The validator overrides the base loader renames schema with an optional string-keyed record of string-or-null values and sends parse failures to errors. This qualifies JSON object member value shape only. The base loader catches invalid renames; additional validator rename-chain resolution and target-name checks are separate and not claimed as Core behavior."
    },
    "header-shape": {
      "stage": "schema-predicate",
      "ruleId": "marketplace.headers.shape",
      "windows": [
        "entry-fields",
        "command-max-and-pattern",
        "marketplace-schema-caller"
      ],
      "claim": "Optional marketplace headers is a string-valued record; headersHelper is a string of at most 500 printable ASCII code units with no four consecutive spaces. Empty helper is permitted. Standalone plugin fields are not broadened."
    },
    "header-helper-strict": {
      "stage": "validator-error",
      "ruleId": "marketplace.headers.helper_strict",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-parse",
        "marketplace-validator-return",
        "entry-fields",
        "helper-nonempty",
        "marketplace-conditional-checks"
      ],
      "claim": "After parsing, an archive entry with a nonempty helper and strict not false produces an error. Omitted entry strict defaults true. No helper is executed by this evidence."
    },
    "header-source-digest": {
      "stage": "strict-warning",
      "ruleId": "marketplace.headers.source_digest",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-parse",
        "marketplace-validator-return",
        "strict-success-policy",
        "helper-nonempty",
        "marketplace-conditional-checks"
      ],
      "claim": "After parsing, present headers or an active helper on nonarchive sources produces one warning attributed to the helper when active. An archive active helper without sha256 produces a warning. Warnings fail strict validation; Core uses invalid-shape diagnostics."
    },
    "header-restricted": {
      "stage": "strict-warning",
      "ruleId": "marketplace.headers.restricted",
      "windows": [
        "export-validate-handler",
        "cli-strict-aggregate",
        "dispatch-marketplace",
        "marketplace-validator-schema",
        "marketplace-validator-parse",
        "marketplace-validator-return",
        "strict-success-policy",
        "restricted-headers",
        "marketplace-conditional-checks"
      ],
      "claim": "For archive entries the validator checks header keys after lowercase and underscore-to-hyphen normalization against 21 exact routing/identity names and three prefixes. Matches warn and fail strict validation. Runtime syntax/value filtering is a separate path and is not asserted here."
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
  for (const [id, stage] of [
    ["monitor-references", "schema-predicate"], ["monitor-required", "schema-predicate"], ["monitor-closed-when", "schema-predicate"], ["monitor-unique", "schema-predicate"],
    ["lsp-references", "schema-predicate"], ["lsp-required", "schema-predicate"], ["lsp-fields", "schema-predicate"], ["lsp-values", "schema-predicate"],
    ["component-references", "schema-predicate"], ["dependency-extra-fields", "schema-predicate"], ["mcp-references", "schema-predicate"], ["mcp-variants", "schema-predicate"], ["mcp-records", "schema-predicate"], ["mcp-oauth-fields", "schema-predicate"], ["mcp-oauth-values", "schema-predicate"],
    ["channel-shape", "schema-predicate"], ["user-config-types", "schema-predicate"], ["user-config-closed", "schema-predicate"],
    ["command-map-fields", "schema-predicate"], ["command-map-source", "schema-predicate"],
    ["archive-digest", "schema-predicate"], ["command-limits", "schema-predicate"],
    ["entry-name-strict", "strict-warning"], ["entry-name-unique", "validator-error"],
    ["metadata-closed-strict", "strict-warning"], ["rename-values", "validator-error"],
    ["header-shape", "schema-predicate"], ["header-helper-strict", "validator-error"],
    ["header-source-digest", "strict-warning"], ["header-restricted", "strict-warning"],
  ] as const) {
    const predicate = evidence.predicates[id];
    if (predicate === undefined || predicate.stage !== stage || predicate.ruleId.trim() === "" || predicate.claim.trim() === "" || predicate.windows.length === 0 || predicate.windows.some((window) => !ids.has(window))) invalid(`has unqualified predicate ${id}`);
  }
  if (Object.keys(evidence.predicates).length !== 30) invalid("has an unreviewed predicate");
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
