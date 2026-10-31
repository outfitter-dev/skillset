/** Input fields from pinned Claude 2.1.269 qd/w6; static parsing, not runtime support. */
const common = { timeout: "number", alwaysLoad: "boolean" } as const;
const remote = { ...common, url: "string", headers: "object", headersHelper: "string" } as const;
const http = { ...remote, oauth: "object", tools: "array", discoveryCache: "boolean", toolPermissions: "object" } as const;
const ide = { ...common, url: "string", ideName: "string", ideRunningInWindows: "boolean" } as const;

export const CLAUDE_MCP_VARIANTS = {
  stdio: { required: ["command"], fields: { ...common, command: "string", args: "string-array", env: "object" } },
  sse: { required: ["url"], fields: http },
  http: { required: ["url"], fields: http },
  "streamable-http": { required: ["url"], fields: http },
  ws: { required: ["url"], fields: remote },
  "sse-ide": { required: ["url", "ideName"], fields: ide },
  "ws-ide": { required: ["url", "ideName"], fields: { ...ide, authToken: "string" } },
  sdk: { required: ["name"], fields: { ...common, name: "string" } },
  "claudeai-proxy": {
    required: ["url", "id"],
    fields: { ...common, url: "string", id: "string", displayName: "string", iconUrl: "string", toolPermissions: "object", stateless: "boolean", enterpriseManaged: "boolean" },
  },
} as const;

export const CLAUDE_MCP_PROXY_NULLABLE_FIELDS = {
  cachedInitResponse: "object", cachedDiscoverResponse: "object", eligible: "boolean", ineligibleReason: "string",
} as const;
export const CLAUDE_MCP_OAUTH_FIELD_TYPES = {
  clientId: "string", callbackPort: "number", authServerMetadataUrl: "string", scopes: "string", xaa: "boolean",
} as const;
export const CLAUDE_MCP_TOOL_POLICIES = ["always_allow", "always_ask", "always_deny"] as const;
export const CLAUDE_MCP_TOOL_PERMISSIONS = ["allow", "ask", "blocked"] as const;
// role, request_timeout_ms and discoverSupport catch invalid input to undefined.
// Unknown keys are stripped by each object schema, so they do not cause rejection.
