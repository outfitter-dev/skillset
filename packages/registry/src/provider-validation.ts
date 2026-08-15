import { PROVIDER_SCHEMA_TARGETS } from "./schema-snapshots";

export type ProviderValidationLaneId =
  | "agent-skills-reference"
  | "claude-product"
  | "codex-authoring"
  | "cursor-authoring";

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
  readonly negativeCanary: string;
  readonly pin: string;
  readonly targets: readonly (typeof PROVIDER_SCHEMA_TARGETS)[number][];
  readonly tool: string;
  readonly version: string;
}

const validationLanes = [
  {
    acquisitions: [
      {
        integrity:
          "sha512-WS0ZSsNu2zkQonC+rW7HdByMCkPQ2l+hO1G0LdvWTj40kiYr0qAiSJjCBNRIbi0foBol4IFTCKwLHAN83qxxUQ==",
        kind: "npm",
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.233.tgz",
      },
      {
        integrity:
          "sha512-ubMVvBBlsks5NE0EmucELB2h/XZ64L86JgmMBUWShLgDAkrrzCh1zIf5qX1+SPskXAnMfKBFTMNeaT6UruxRkQ==",
        kind: "npm",
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.233.tgz",
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
    limitations: [
      "Product validation proves authoring ingestion shape, not installation, trust, activation, or runtime behavior.",
    ],
    negativeCanary: "invalid JSON in .claude-plugin/plugin.json",
    pin: "@anthropic-ai/claude-code@2.1.233",
    targets: ["claude"],
    tool: "claude plugin validate --strict",
    version: "2.1.233",
  },
  {
    acquisitions: [
      {
        integrity:
          "sha256:ebda00d55d7518b127f675f062fb5c6e7a1ffdc0a99df1a55ac594400d7d3228",
        kind: "source",
        blob: "88fae0fd00998ea32fa2393869042f0231a2b43b",
        revision: "be6e8eac029b183056b7e4402879f15d2c85f61b",
        url: "https://raw.githubusercontent.com/openai/codex/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/skills/src/assets/samples/plugin-creator/scripts/validate_plugin.py",
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
    limitations: [
      "The released plugin-creator script is an authoring validator, not a whole-provider or runtime-hook validator.",
    ],
    negativeCanary: "missing name in .codex-plugin/plugin.json",
    pin: "be6e8eac029b183056b7e4402879f15d2c85f61b",
    targets: ["codex"],
    tool: "validate_plugin.py",
    version: "Codex 0.147.0 source",
  },
  {
    acquisitions: [
      {
        integrity:
          "sha256:1b38ddfecf37f292acfa80a3c575f13bfca07d9e06f0ddfc9b72df3ed4dbb929",
        kind: "source",
        blob: "6a7870854d7c82a900a936fd0e34610c86702723",
        revision: "2a8044425c7bddf429c3bdedf3ab61e791d34d65",
        url: "https://raw.githubusercontent.com/cursor/plugins/2a8044425c7bddf429c3bdedf3ab61e791d34d65/scripts/validate-plugins.mjs",
      },
      {
        integrity:
          "sha256:a393b758901803fcf5cfe0d77bda8a83e987d32c3377dfce2d9edf445af884ed",
        kind: "source",
        revision: "2a8044425c7bddf429c3bdedf3ab61e791d34d65",
        url: "https://raw.githubusercontent.com/cursor/plugins/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json",
      },
      {
        integrity:
          "sha256:1aae96a24c2796419933bc8bfe3a1255394e7199c35740b36325e0ce6dbc253d",
        kind: "source",
        revision: "2a8044425c7bddf429c3bdedf3ab61e791d34d65",
        url: "https://raw.githubusercontent.com/cursor/plugins/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/marketplace.schema.json",
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
    limitations: [
      "The provider-owned source validator is not a whole-provider runtime validator.",
      "The public schema and shipped Cursor Agent 2026.07.23-e383d2b disagree on category and tags placement; Skillset preserves the conflict and does not synthesize either field from keywords.",
      "The shipped Cursor Agent bundle is recorded as runtime-consumer evidence only (sha256:b3b9931f3817c1b269b49148be70965830811d52b2aee98b9513247675838040).",
    ],
    negativeCanary: "missing name in .cursor-plugin/plugin.json",
    pin: "2a8044425c7bddf429c3bdedf3ab61e791d34d65",
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
    limitations: [
      "Agent Skills is a portable standards-floor reference check, not proof of any provider runtime contract.",
    ],
    negativeCanary: "SKILL.md without required description frontmatter",
    pin: "69ef37e9424c0a7ea9dd2293b559e43ec8176379",
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
