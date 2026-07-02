import { schemaUri } from "./contracts";
import type { SchemaJsonRecord, SkillsetSchemaContractId } from "./types";

export interface SkillsetSchemaExample {
  readonly description: string;
  readonly id: SkillsetSchemaContractId;
  readonly path: string;
  readonly value: SchemaJsonRecord;
}

export interface SkillsetExampleArtifact {
  readonly contractId: SkillsetSchemaContractId;
  readonly description: string;
  readonly format: "yaml";
  readonly path: string;
  readonly value: SchemaJsonRecord;
}

export const skillsetSchemaExamples = [
  {
    description: "Maximal workspace manifest for Skillset repos.",
    id: "workspace-config",
    path: "workspace-config.yaml",
    value: {
      agents: {
        defaults: {
          skillsPrompt: "Load the following skills first, if available:",
        },
      },
      changes: {
        minimumRefLength: 6,
      },
      claude: true,
      codex: {
        plugins: {
          path: "generated/codex",
        },
      },
      compile: {
        build: "updated",
        features: {
          promptArguments: true,
        },
        skillset: {
          metadata: true,
        },
        targets: ["claude", "codex", "cursor"],
        unsupportedDestination: "error",
      },
      defaults: {
        codex: {
          agents: {
            model: "gpt-5.1-codex",
          },
        },
      },
      dependencies: {
        plugins: [
          "acme-tools",
          {
            marketplace: "acme",
            name: "docs",
            plugin: "docs",
            range: "^2.4.0",
            unversioned: false,
          },
        ],
      },
      distributions: {
        plugins: {
          path: "dist/plugins",
        },
      },
      marketplaces: {
        outfitter: {
          description: "Curated Outfitter provider plugins.",
          plugins: [
            {
              plugin: "outfitter-core",
            },
            {
              channel: "latest",
              plugin: "trails-review",
              repo: "github:outfitter-dev/trails",
            },
            {
              plugin: "skillset",
              ref: "main",
              repo: "github:outfitter-dev/skillset",
              targets: ["claude"],
            },
          ],
          targets: ["claude", "codex", "cursor"],
          title: "Outfitter",
        },
      },
      skillset: {
        author: {
          email: "team@example.com",
          name: "Example Team",
        },
        category: "Developer Tools",
        description: "Source-first agent loadout for the example team.",
        homepage: "https://example.com/skillset",
        keywords: ["agents", "docs"],
        license: "MIT",
        name: "example-team",
        owner: {
          name: "Example Team",
        },
        presentation: {
          capabilities: ["Read", "Write"],
          displayName: "Example Team",
        },
        preprocess: true,
        repository: "https://github.com/example/team-skillset",
        schema: 1,
        strict: true,
        summary: "Example team Skillset source.",
        title: "Example Team Skillset",
        version: "0.1.0",
      },
      supports: {
        packages: [
          "@acme/docs-cli >=2.4.0 <3.0.0",
          {
            name: "@acme/api",
            onMismatch: "warn",
            range: "^1.0.0",
            source: "repo:package.json",
          },
        ],
      },
    },
  },
  {
    description: "Shared source metadata used under the skillset key.",
    id: "source-metadata",
    path: "source-metadata.yaml",
    value: {
      author: {
        email: "team@example.com",
        name: "Example Team",
      },
      category: "Developer Tools",
      description: "Reusable source metadata example.",
      homepage: "https://example.com",
      keywords: ["agents", "skillset"],
      license: "Apache-2.0",
      manifest: {
        source: "repo:skillset.yaml",
      },
      name: "example",
      origin: {
        path: "skillset.yaml",
        ref: "main",
        repo: "https://github.com/example/team-skillset",
      },
      owner: {
        name: "Example Team",
      },
      outputs: {
        claude: "plugins",
        codex: "plugins",
      },
      presentation: {
        displayName: "Example",
      },
      preprocess: false,
      repository: "https://github.com/example/team-skillset",
      schema: 1,
      strict: true,
      summary: "Metadata summary.",
      title: "Example Metadata",
      version: "1.2.3",
    },
  },
  {
    description: "Adaptive skill frontmatter.",
    id: "skill-frontmatter",
    path: "skill-frontmatter.yaml",
    value: {
      allowed_tools: {
        claude: ["Read", "Write"],
        codex: false,
      },
      bin: {
        source: "repo:tools/docs-cli/bin",
      },
      claude: {
        allowed_tools: ["Read", "Write"],
      },
      codex: {
        model: "gpt-5.1-codex",
      },
      dependencies: {
        plugins: [
          {
            name: "docs",
            range: "^1.0.0",
          },
        ],
      },
      description: "Use when working with the docs CLI.",
      dialect: "claude",
      hooks: {
        PreToolUse: ["shell-policy"],
        Stop: [
          {
            hook: "source-change-guard",
            match: {
              tool: ["Bash"],
            },
            providers: ["claude", "codex"],
            status: "Checking shell changes",
          },
        ],
        auto: ["session-metadata"],
      },
      implicit_invocation: {
        claude: true,
        codex: false,
      },
      mcp: {
        source: "repo:.mcp.json",
      },
      metadata: {
        generated: "skillset-schema@0.1.0",
        version: "1.0.0",
      },
      model: "sonnet",
      name: "docs-cli",
      resources: {
        references: ["references/api.md"],
      },
      schema: schemaUri("skill-frontmatter"),
      skillset: {
        origin: {
          path: ".skillset/skills/docs-cli/SKILL.md",
        },
        schema: 1,
        version: "1.0.0",
      },
      summary: "Docs CLI skill.",
      supports: {
        packages: [
          {
            name: "@acme/docs-cli",
            onMismatch: "error",
            range: "^2.4.0",
          },
        ],
      },
      title: "Docs CLI",
      tools: {
        read: true,
        search: true,
        write: false,
      },
      version: "1.0.0",
    },
  },
  {
    description: "Adaptive project-agent frontmatter.",
    id: "agent-frontmatter",
    path: "agent-frontmatter.yaml",
    value: {
      claude: {
        model: "sonnet",
      },
      codex: {
        model: "gpt-5.1-codex",
      },
      description: "Use this agent for release review.",
      hooks: {
        auto: ["session-metadata"],
      },
      initialPrompt: "Review the release notes before changing code.",
      metadata: {
        generated: "skillset-schema@0.1.0",
        version: "1.0.0",
      },
      model: "release-review",
      name: "release-reviewer",
      skillset: {
        origin: {
          path: ".skillset/agents/release-reviewer.md",
        },
        schema: 1,
      },
      skills: ["changelog", "release-policy"],
      supports: ["@acme/release-cli ^1.0.0"],
    },
  },
  {
    description: "Adaptive instruction/rules frontmatter.",
    id: "instruction-frontmatter",
    path: "instruction-frontmatter.yaml",
    value: {
      claude: {
        path: ".claude/rules/source.md",
      },
      codex: {
        path: ".codex/rules/source.rules",
      },
      dialect: "claude",
      metadata: {
        generated: "skillset-schema@0.1.0",
        version: "1.0.0",
      },
      name: "source-rules",
      skillset: {
        origin: {
          path: ".skillset/rules/source.md",
        },
        schema: 1,
      },
      supports: {
        packages: ["@acme/source-kit >=1.0.0 <2.0.0"],
      },
    },
  },
  {
    description: "Hook definition source object.",
    id: "hook",
    path: "hook.yaml",
    value: {
      hooks: {
        PostToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|apply_patch",
            hooks: [
              {
                type: "command",
                command: "bun ./apps/skillset/src/cli.ts hooks run post-tool-use",
                statusMessage: "Checking Skillset source changes",
                timeout: 120,
              },
            ],
          },
        ],
      },
    },
  },
  {
    description: "Adaptive reusable hook unit.",
    id: "adaptive-hook",
    path: "adaptive-hook.yaml",
    value: {
      claude: {
        if: "Bash(git *)",
      },
      codex: {
        matcher: "Bash",
      },
      context: {
        env: ["provider", "hook.event", "session.id"],
        strategy: "toolkit",
      },
      description: "Checks shell commands before they run.",
      events: ["PreToolUse"],
      match: {
        tool: ["Bash"],
      },
      name: "shell-policy",
      providers: ["claude", "codex"],
      run: {
        args: ["--event", "pre-tool-use"],
        command: "node ./hooks/shell-policy/check.js",
        cwd: ".",
        env: {
          SKILLSET_HOOK: "shell-policy",
        },
        script: "./check.js",
      },
      status: "Checking shell policy",
    },
  },
  {
    description: "Compatibility-only legacy pending change-entry frontmatter.",
    id: "change-entry",
    path: "change-entry.yaml",
    value: {
      bump: "minor",
      evidence: [
        {
          scope: "skill:docs-cli",
          sourceHash: "sha256:123456",
        },
      ],
      group: {
        id: "SET-182",
        provider: "linear",
      },
      id: "01abcdef1234",
      ignored: false,
      scopes: ["skill:docs-cli", "plugin:docs"],
    },
  },
] as const satisfies readonly SkillsetSchemaExample[];

export function deriveSkillsetExampleArtifacts(): readonly SkillsetExampleArtifact[] {
  return skillsetSchemaExamples.map((example) => ({
    contractId: example.id,
    description: example.description,
    format: "yaml",
    path: `docs/reference/examples/${example.path}`,
    value: example.value,
  }));
}
