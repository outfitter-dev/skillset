export const CURSOR_PARITY_EVIDENCE_FETCHED_AT = "2026-09-16";

export const cursorParitySources = {
  "cli-permissions": {
    contentHash:
      "sha256:675f5a0b750998e2c61e05898f06c12da465b699b4df3c6be7558e33a43f1fde",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/cli/reference/permissions",
  },
  hooks: {
    contentHash:
      "sha256:fff5a34ab893f93289e7c246b1bdb15272d075fc3eddf34fa4881224d5918ccd",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/hooks",
  },
  permissions: {
    contentHash:
      "sha256:74dc27ec885a3b113bd6a746e574445a494600d17b78143fa27bc6811bacc8d1",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/reference/permissions",
  },
  plugins: {
    contentHash:
      "sha256:30e4da171ccc6a809227e667bf3c67c05ba44fe8c62ab427cba29f85068e87b5",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/reference/plugins",
  },
  rules: {
    contentHash:
      "sha256:9ef699e09092dcee7901fff6b06f80212bf4876f505c63826504d9d9afec7acc",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/rules",
  },
  skills: {
    contentHash:
      "sha256:70b3cae045211e56c1974f96b92269db0e01ded43d4941258e9bccb0505e5825",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/skills",
  },
  subagents: {
    contentHash:
      "sha256:a1bab646408aebe5a3b5dc82430f0641204d6ca858fda8e811c35ada874b08cf",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/subagents",
  },
  "third-party-hooks": {
    contentHash:
      "sha256:02e8ee310c20406886440daac67a5927ad5734c103f469d5695d877c2c8c2c70",
    fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
    url: "https://cursor.com/docs/reference/third-party-hooks",
  },
} as const;

export const cursorParityClaims = [
  {
    id: "cursor-rules-frontmatter",
    owners: ["SET-557"],
    sources: ["rules"],
    status: "verified",
  },
  {
    id: "cursor-rules-globs-escaping",
    owners: ["SET-557", "SET-574"],
    sources: ["rules"],
    status: "not-documented",
  },
  {
    id: "cursor-rules-nested-dirs",
    owners: ["SET-557"],
    sources: ["rules"],
    status: "partial",
  },
  {
    id: "cursor-agents-md-root",
    owners: ["SET-551", "SET-557"],
    sources: ["rules"],
    status: "evidence-only",
  },
  {
    id: "cursor-skills-path",
    owners: ["SET-553", "SET-554"],
    sources: ["skills"],
    status: "verified",
  },
  {
    id: "cursor-subagents-path",
    owners: ["SET-551"],
    sources: ["subagents"],
    status: "verified",
  },
  {
    id: "cursor-plugin-assets",
    owners: ["SET-558"],
    sources: ["plugins"],
    status: "partial",
  },
  {
    id: "cursor-plugin-rules",
    owners: ["SET-568"],
    sources: ["plugins"],
    status: "verified",
  },
  {
    id: "cursor-hooks-events",
    owners: ["SET-559"],
    sources: ["hooks", "third-party-hooks"],
    status: "verified",
  },
  {
    id: "cursor-settings-allow-deny",
    owners: ["SET-564"],
    sources: ["cli-permissions", "permissions"],
    status: "partial",
  },
] as const;

export const cursorPluginComponentsObservation = {
  components: [
    "agents",
    "commands",
    "hooks",
    "mcpServers",
    "rules",
    "skills",
    "variables",
  ],
  fetchedAt: CURSOR_PARITY_EVIDENCE_FETCHED_AT,
  id: "cursor-plugin-components",
  source: "plugins",
} as const;
