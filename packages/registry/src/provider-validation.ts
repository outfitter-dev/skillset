import { PROVIDER_SCHEMA_TARGETS } from "./schema-snapshots";

export type ProviderValidationLaneId =
  | "agent-skills-reference"
  | "claude-product"
  | "codex-authoring"
  | "cursor-authoring";

export const PROVIDER_VALIDATION_MAX_AGE_DAYS = 30;

export type ProviderValidationFreshnessStatus =
  | "refresh-failed"
  | "stale-verification"
  | "upstream-changed"
  | "validation-current"
  | "validation-pending";

export interface ProviderValidationRefreshObservation {
  readonly error?: string;
  readonly upstreamPin?: string;
}

export interface ProviderValidationFreshness {
  readonly ageDays: number;
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly lane: ProviderValidationLaneId;
  readonly pin: string;
  readonly sourcePublishedAt: string;
  readonly status: ProviderValidationFreshnessStatus;
  readonly lastSuccessfulValidationAt: string;
}

export interface ProviderValidationReceipt {
  readonly at: string;
  readonly pin: string;
  readonly url: string;
}

export interface ProviderValidationAcquisition {
  readonly blob?: string;
  readonly integrity: `sha512-${string}` | `sha256:${string}`;
  readonly kind: "archive" | "npm" | "source";
  readonly revision?: string;
  readonly url: string;
}

export interface ProviderValidationDependency {
  readonly integrity: `sha512-${string}` | `sha256:${string}`;
  readonly name: string;
  readonly url?: string;
  readonly version: string;
}

export interface ProviderValidationFallback {
  readonly owner: string;
  readonly refs: readonly string[];
  readonly surfaces: readonly string[];
}

export interface ProviderValidationLane {
  readonly acquisitions: readonly ProviderValidationAcquisition[];
  readonly authority:
    | "product-validator"
    | "provider-source"
    | "standards-reference";
  readonly coveredSurfaces: readonly string[];
  readonly dependencies: readonly ProviderValidationDependency[];
  readonly fallback: ProviderValidationFallback;
  readonly id: ProviderValidationLaneId;
  readonly limitations: readonly string[];
  readonly lastSuccessfulValidation: ProviderValidationReceipt;
  readonly negativeCanary: string;
  readonly pin: string;
  readonly retrievedAt: string;
  readonly sourcePublishedAt: string;
  readonly targets: readonly (typeof PROVIDER_SCHEMA_TARGETS)[number][];
  readonly tool: string;
  readonly version: string;
}

const RETRIEVED_AT = "2026-09-11T23:20:27.000Z";
const LAST_SUCCESSFUL_VALIDATION_AT = "2026-09-12T00:01:37.000Z";
const LAST_SUCCESSFUL_VALIDATION_URL =
  "https://github.com/outfitter-dev/skillset/actions/runs/34660165890/job/103460818080";

const validationLanes = [
  {
    acquisitions: [
      {
        integrity:
          "sha512-osSbRU1KjlAfhVSgso7g+KxCr5DLNlfm7xeRPpm/c9s+7HGqQLHbkUYvjepbe6TiHJa9iSeirW/t7vW4sZhTIQ==",
        kind: "npm",
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.269.tgz",
      },
      {
        integrity:
          "sha512-Ti+9oKbf2p9pJuMMj1Fv+6YzljREpy9cx6SN7NV7Zik/vaaXPxC8u+cDiGF7HnPPJ5HsLbmwKoh3BnE3IhdAeQ==",
        kind: "npm",
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.269.tgz",
      },
    ],
    authority: "product-validator",
    coveredSurfaces: [
      "claude marketplace",
      "claude plugin manifest",
      "claude plugin skills",
    ],
    dependencies: [],
    fallback: {
      owner: "packages/core/src/provider-format-conformance.ts",
      refs: [
        "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
        "packages/core/src/__tests__/adapter-conformance.test.ts",
        "packages/core/src/__tests__/provider-format-conformance.test.ts",
      ],
      surfaces: [
        "render-result coverage",
        "Skillset output ownership and provenance",
      ],
    },
    id: "claude-product",
    lastSuccessfulValidation: validationReceipt(
      "@anthropic-ai/claude-code@2.1.269"
    ),
    limitations: [
      "Product validation proves authoring ingestion shape, not installation, trust, activation, or runtime behavior.",
    ],
    negativeCanary: "invalid JSON in .claude-plugin/plugin.json",
    pin: "@anthropic-ai/claude-code@2.1.269",
    retrievedAt: RETRIEVED_AT,
    sourcePublishedAt: "2026-09-11T18:12:49.253Z",
    targets: ["claude"],
    tool: "claude plugin validate --strict",
    version: "2.1.269",
  },
  {
    acquisitions: [
      {
        integrity:
          "sha256:f4eeadb733b28b0c3e714de263a76d6542866a672f3e99bdffcf4dbcdf85e944",
        kind: "source",
        blob: "b5be462c3b4fe3ea6083cca948ccf52e05301546",
        revision: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340",
        url: "https://raw.githubusercontent.com/openai/codex/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/skills/src/assets/samples/plugin-creator/scripts/validate_plugin.py",
      },
      {
        integrity:
          "sha256:a6d51ce4a9a7e8f85626ff5808a467a67574e7f8cdf1167ffb467c5f67e57223",
        kind: "source",
        blob: "41a1a2f1b503c165f5d4b93f7f0e99eb0b3add6e",
        revision: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340",
        url: "https://raw.githubusercontent.com/openai/codex/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/skills/src/assets/samples/plugin-creator/scripts/identifier_validation.py",
      },
    ],
    authority: "provider-source",
    coveredSurfaces: ["codex plugin manifest", "codex plugin skills"],
    dependencies: [
      {
        integrity:
          "sha256:ba1cc08a7ccde2d2ec775841541641e4548226580ab850948cbfda66a1befcdc",
        name: "PyYAML",
        url: "https://files.pythonhosted.org/packages/8b/9d/b3589d3877982d4f2329302ef98a8026e7f4443c765c46cfecc8858c6b4b/pyyaml-6.0.3-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl",
        version: "6.0.3",
      },
    ],
    fallback: {
      owner: "packages/core/src/provider-format-conformance.ts",
      refs: [
        "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
        "packages/core/src/__tests__/adapter-conformance.test.ts",
        "packages/core/src/__tests__/provider-format-conformance.test.ts",
      ],
      surfaces: ["hooks", "runtime consumption", "render-result coverage"],
    },
    id: "codex-authoring",
    lastSuccessfulValidation: validationReceipt(
      "6b9826e3aa83b1a5947db50f4332cb9c65f1b340"
    ),
    limitations: [
      "The released plugin-creator script is an authoring validator, not a whole-provider or runtime-hook validator.",
    ],
    negativeCanary: "missing name in .codex-plugin/plugin.json",
    pin: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340",
    retrievedAt: RETRIEVED_AT,
    sourcePublishedAt: "2026-09-09T21:43:48.000Z",
    targets: ["codex"],
    tool: "validate_plugin.py",
    version: "Codex 0.154.0 source",
  },
  {
    acquisitions: [
      {
        integrity:
          "sha256:1b38ddfecf37f292acfa80a3c575f13bfca07d9e06f0ddfc9b72df3ed4dbb929",
        kind: "source",
        blob: "6a7870854d7c82a900a936fd0e34610c86702723",
        revision: "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d",
        url: "https://raw.githubusercontent.com/cursor/plugins/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d/scripts/validate-plugins.mjs",
      },
      {
        integrity:
          "sha256:31db124b1c7e43c22abb13ebf7e7c74556482e480fd492b80638d815c85b96b1",
        kind: "source",
        revision: "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d",
        url: "https://raw.githubusercontent.com/cursor/plugins/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d/schemas/plugin.schema.json",
      },
      {
        integrity:
          "sha256:50c85058bf329588401fd2fc93180a574fa64abbb6c2606400febfb6f4d094e8",
        kind: "source",
        revision: "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d",
        url: "https://raw.githubusercontent.com/cursor/plugins/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d/schemas/marketplace.schema.json",
      },
    ],
    authority: "provider-source",
    coveredSurfaces: ["cursor marketplace", "cursor plugin manifest"],
    dependencies: [
      {
        integrity:
          "sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==",
        name: "ajv",
        url: "https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz",
        version: "8.20.0",
      },
      {
        integrity:
          "sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==",
        name: "ajv-formats",
        url: "https://registry.npmjs.org/ajv-formats/-/ajv-formats-3.0.1.tgz",
        version: "3.0.1",
      },
      {
        integrity:
          "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==",
        name: "fast-deep-equal",
        url: "https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz",
        version: "3.1.3",
      },
      {
        integrity:
          "sha512-gHwA1O9LDIcKunMKhObS/HimwtehO1nPUECKAu5TpKgaO19fcWEl4bliWe1jWxVFvIXztJjjQ4L8XQ1EU9f7Jw==",
        name: "fast-uri",
        url: "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.5.tgz",
        version: "3.1.5",
      },
      {
        integrity:
          "sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==",
        name: "json-schema-traverse",
        url: "https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-1.0.0.tgz",
        version: "1.0.0",
      },
      {
        integrity:
          "sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==",
        name: "require-from-string",
        url: "https://registry.npmjs.org/require-from-string/-/require-from-string-2.0.2.tgz",
        version: "2.0.2",
      },
    ],
    fallback: {
      owner: "packages/core/src/provider-format-conformance.ts",
      refs: [
        "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
        "packages/core/src/__tests__/adapter-conformance.test.ts",
        "packages/core/src/__tests__/provider-format-conformance.test.ts",
      ],
      surfaces: [
        "runtime consumption",
        "render-result coverage",
        "category and tags authority conflict",
      ],
    },
    id: "cursor-authoring",
    lastSuccessfulValidation: validationReceipt(
      "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d"
    ),
    limitations: [
      "The provider-owned source validator is not a whole-provider runtime validator.",
      "The public schema and shipped Cursor Agent 2026.07.23-e383d2b disagree on category and tags placement; Skillset preserves the conflict and does not synthesize either field from keywords.",
      "The shipped Cursor Agent bundle is recorded as runtime-consumer evidence only (sha256:b3b9931f3817c1b269b49148be70965830811d52b2aee98b9513247675838040).",
    ],
    negativeCanary: "missing name in .cursor-plugin/plugin.json",
    pin: "f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d",
    retrievedAt: RETRIEVED_AT,
    sourcePublishedAt: "2026-09-11T01:17:03.000Z",
    targets: ["cursor"],
    tool: "validate-plugins.mjs",
    version: "cursor/plugins source",
  },
  {
    acquisitions: [
      {
        integrity:
          "sha256:0c9eabbe602095c4f4d771ee55bf74f6bc7e1c770f25d4fe29ce9802981daa20",
        kind: "archive",
        revision: "69ef37e9424c0a7ea9dd2293b559e43ec8176379",
        url: "https://codeload.github.com/agentskills/agentskills/tar.gz/69ef37e9424c0a7ea9dd2293b559e43ec8176379",
      },
    ],
    authority: "standards-reference",
    coveredSurfaces: ["every generated SKILL.md"],
    dependencies: [
      {
        integrity:
          "sha256:c2d1b9a8638e81f763f04928e8107741886160b6bda2b8cb9784336bebeec94a",
        name: "skills-ref frozen upstream lock",
        version: "0.1.0",
      },
    ],
    fallback: {
      owner: "packages/core/src/provider-format-conformance.ts",
      refs: [
        "packages/core/src/__tests__/adapter-conformance-coverage.test.ts",
        "packages/core/src/__tests__/adapter-conformance.test.ts",
        "packages/core/src/__tests__/provider-format-conformance.test.ts",
      ],
      surfaces: ["provider-specific skill metadata and runtime behavior"],
    },
    id: "agent-skills-reference",
    lastSuccessfulValidation: validationReceipt(
      "69ef37e9424c0a7ea9dd2293b559e43ec8176379"
    ),
    limitations: [
      "Agent Skills is a portable standards-floor reference check, not proof of any provider runtime contract.",
    ],
    negativeCanary: "SKILL.md without required description frontmatter",
    pin: "69ef37e9424c0a7ea9dd2293b559e43ec8176379",
    retrievedAt: RETRIEVED_AT,
    sourcePublishedAt: "2026-08-09T20:36:04.000Z",
    targets: PROVIDER_SCHEMA_TARGETS,
    tool: "skills-ref validate",
    version: "0.1.0",
  },
] as const satisfies readonly ProviderValidationLane[];

export const providerValidationLanes =
  defineProviderValidationLanes(validationLanes);

export function defineProviderValidationLanes(
  lanes: readonly ProviderValidationLane[]
): readonly ProviderValidationLane[] {
  assertProviderValidationLanes(lanes);
  return deepFreeze(
    lanes
      .map((lane) => ({
        ...lane,
        acquisitions: [...lane.acquisitions],
        coveredSurfaces: [...lane.coveredSurfaces].toSorted(),
        dependencies: [...lane.dependencies].toSorted((left, right) =>
          left.name.localeCompare(right.name)
        ),
        fallback: {
          ...lane.fallback,
          refs: [...lane.fallback.refs].toSorted(),
          surfaces: [...lane.fallback.surfaces].toSorted(),
        },
        limitations: [...lane.limitations],
        targets: [...lane.targets].toSorted(),
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id))
  );
}

export function listProviderValidationLanes(): readonly ProviderValidationLane[] {
  return providerValidationLanes;
}

export function getProviderValidationLane(
  id: ProviderValidationLaneId
): ProviderValidationLane {
  const lane = providerValidationLanes.find((candidate) => candidate.id === id);
  if (lane === undefined)
    throw new Error(`skillset: missing provider validation lane ${id}`);
  return lane;
}

export function assessProviderValidationFreshness(
  lane: ProviderValidationLane,
  checkedAt: string,
  observation: ProviderValidationRefreshObservation = {}
): ProviderValidationFreshness {
  const checkedAtMs = parseTimestamp(checkedAt, "checkedAt");
  const validatedAtMs = parseTimestamp(
    lane.lastSuccessfulValidation.at,
    "lastSuccessfulValidation.at"
  );
  const maxAgeMs = PROVIDER_VALIDATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const ageMs = checkedAtMs - validatedAtMs;
  if (ageMs < 0)
    throw new Error(
      `skillset: provider validation lane ${lane.id} was validated in the future`
    );
  const status =
    observation.error !== undefined
      ? "refresh-failed"
      : observation.upstreamPin !== undefined &&
          observation.upstreamPin !== lane.pin
        ? "upstream-changed"
        : lane.lastSuccessfulValidation.pin !== lane.pin
          ? "validation-pending"
          : ageMs > maxAgeMs
            ? "stale-verification"
            : "validation-current";
  return {
    ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    checkedAt,
    expiresAt: new Date(validatedAtMs + maxAgeMs).toISOString(),
    lane: lane.id,
    pin: lane.pin,
    sourcePublishedAt: lane.sourcePublishedAt,
    status,
    lastSuccessfulValidationAt: lane.lastSuccessfulValidation.at,
  };
}

export function listProviderValidationFreshness(
  checkedAt: string
): readonly ProviderValidationFreshness[] {
  return providerValidationLanes.map((lane) =>
    assessProviderValidationFreshness(lane, checkedAt)
  );
}

export function assertProviderValidationFreshness(checkedAt: string): void {
  const stale = listProviderValidationFreshness(checkedAt).filter(
    (item) => item.status === "stale-verification"
  );
  if (stale.length === 0) return;
  throw new Error(
    `skillset: provider validation evidence is stale: ${stale
      .map(
        (item) =>
          `${item.lane} last passed ${item.lastSuccessfulValidationAt} (${item.ageDays} days old; maximum ${PROVIDER_VALIDATION_MAX_AGE_DAYS})`
      )
      .join("; ")}`
  );
}

export function assertProviderValidationLanes(
  lanes: readonly ProviderValidationLane[]
): void {
  const ids = new Set<string>();
  for (const lane of lanes) {
    if (ids.has(lane.id))
      throw new Error(
        `skillset: duplicate provider validation lane ${lane.id}`
      );
    ids.add(lane.id);
    if (!isExactPin(lane.pin))
      throw new Error(
        `skillset: provider validation lane ${lane.id} requires an exact pin`
      );
    parseTimestamp(lane.retrievedAt, "retrievedAt");
    parseTimestamp(lane.sourcePublishedAt, "sourcePublishedAt");
    parseTimestamp(
      lane.lastSuccessfulValidation.at,
      "lastSuccessfulValidation.at"
    );
    if (!isExactPin(lane.lastSuccessfulValidation.pin))
      throw new Error(
        `skillset: provider validation lane ${lane.id} success receipt requires an exact pin`
      );
    if (!lane.lastSuccessfulValidation.url.startsWith("https://"))
      throw new Error(
        `skillset: provider validation lane ${lane.id} success receipt requires a URL`
      );
    if (
      lane.coveredSurfaces.length === 0 ||
      lane.limitations.length === 0 ||
      lane.fallback.surfaces.length === 0 ||
      lane.fallback.refs.length === 0
    ) {
      throw new Error(
        `skillset: provider validation lane ${lane.id} requires coverage, limitations, and fallback`
      );
    }
    if (lane.negativeCanary.length === 0) {
      throw new Error(
        `skillset: provider validation lane ${lane.id} requires a negative canary`
      );
    }
    for (const acquisition of lane.acquisitions) {
      if (
        !acquisition.url.startsWith("https://") ||
        !/^(?:sha256:[a-f0-9]{64}|sha512-[A-Za-z0-9+/]+={0,2})$/u.test(
          acquisition.integrity
        )
      ) {
        throw new Error(
          `skillset: provider validation lane ${lane.id} has an unsafe acquisition`
        );
      }
      if (
        acquisition.revision !== undefined &&
        !/^[a-f0-9]{40}$/u.test(acquisition.revision)
      ) {
        throw new Error(
          `skillset: provider validation lane ${lane.id} has an invalid immutable revision`
        );
      }
      if (
        acquisition.blob !== undefined &&
        !/^[a-f0-9]{40}$/u.test(acquisition.blob)
      ) {
        throw new Error(
          `skillset: provider validation lane ${lane.id} has an invalid blob pin`
        );
      }
    }
    for (const dependency of lane.dependencies) {
      if (!isExactVersion(dependency.version)) {
        throw new Error(
          `skillset: provider validation lane ${lane.id} dependency ${dependency.name} requires an exact version`
        );
      }
      if (
        !/^(?:sha256:[a-f0-9]{64}|sha512-[A-Za-z0-9+/]+={0,2})$/u.test(
          dependency.integrity
        ) ||
        (dependency.url !== undefined && !dependency.url.startsWith("https://"))
      ) {
        throw new Error(
          `skillset: provider validation lane ${lane.id} dependency ${dependency.name} has unsafe integrity evidence`
        );
      }
    }
  }
  for (const id of [
    "agent-skills-reference",
    "claude-product",
    "codex-authoring",
    "cursor-authoring",
  ] as const) {
    if (!ids.has(id))
      throw new Error(`skillset: missing provider validation lane ${id}`);
  }
}

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  )
    throw new Error(
      `skillset: provider validation ${field} must be an ISO timestamp`
    );
  return timestamp;
}

function validationReceipt(pin: string): ProviderValidationReceipt {
  return {
    at: LAST_SUCCESSFUL_VALIDATION_AT,
    pin,
    url: LAST_SUCCESSFUL_VALIDATION_URL,
  };
}

function isExactPin(value: string): boolean {
  return (
    /^@[a-z0-9-]+(?:\/[a-z0-9-]+)?@\d+\.\d+\.\d+$/u.test(value) ||
    /^[a-f0-9]{40}$/u.test(value)
  );
}

function isExactVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:\.post\d+)?$/u.test(value) || value === "0.1.0";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
