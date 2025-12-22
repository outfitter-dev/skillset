# Phase 0: Monorepo Conversion

## Scope

Restructure the skillset project from a flat package structure into a Bun workspaces monorepo with:
- `packages/types` - Shared type definitions (type-fest re-exports, common types)
- `packages/shared` - Shared utilities (Pino logger, XDG paths)
- `packages/core` - Core library (tokenizer, resolver, indexer, cache, config, format)
- `apps/cli` - CLI application
- `apps/mcp` - MCP server (future, scaffold only)

**Dependency graph:**

```text
types ← shared ← core ← cli
                     ↖ mcp
```

## Dependencies

- **None** - This phase must run first before all other phases
- This phase represents a significant structural change that establishes the foundation for the `wskill` → `skillset` rename

## Current vs Target Structure

### Current Structure

```text
skillset/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts           # CLI entry
│   ├── hook.ts            # Hook entry
│   ├── cli.ts             # CLI implementation
│   ├── doctor.ts          # Diagnostics
│   ├── types.ts           # Core types
│   ├── tokenizer/
│   ├── resolver/
│   ├── indexer/
│   ├── cache/
│   ├── config/
│   ├── format/
│   ├── hooks/
│   ├── logger/
│   └── tree/
├── plugins/
└── dist/
```

### Target Structure

```text
skillset/
├── package.json              # Root workspace config
├── tsconfig.json             # Root tsconfig (solution file)
├── biome.json                # Shared linting (root)
├── packages/
│   ├── types/
│   │   ├── package.json      # @skillset/types
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts      # Type exports + type-fest re-exports
│   │       ├── skill.ts      # Skill-related types
│   │       ├── config.ts     # Config types
│   │       └── common.ts     # Common utility types
│   ├── shared/
│   │   ├── package.json      # @skillset/shared
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts      # Shared exports
│   │       ├── logger.ts     # Pino logger setup
│   │       ├── paths.ts      # XDG path resolution
│   │       └── env.ts        # Environment variable helpers
│   └── core/
│       ├── package.json      # @skillset/core
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts      # Core exports
│           ├── tokenizer/
│           ├── resolver/
│           ├── indexer/
│           ├── cache/
│           ├── config/
│           ├── format/
│           ├── hooks/
│           └── tree/
├── apps/
│   ├── cli/
│   │   ├── package.json      # skillset (CLI)
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts      # CLI entry
│   │       ├── hook.ts       # Hook entry
│   │       ├── cli.ts
│   │       ├── doctor.ts
│   │       └── commands/     # Command implementations
│   └── mcp/
│       ├── package.json      # @skillset/mcp
│       ├── tsconfig.json
│       └── src/
│           └── index.ts      # Placeholder
└── plugins/
```

## Package Configuration

### Root package.json

| Field | Value |
| ----- | ----- |
| `name` | `skillset-monorepo` |
| `private` | `true` |
| `workspaces` | `["packages/*", "apps/*"]` |
| `scripts.build` | `bun run build:core && bun run build:cli` |
| `scripts.test` | `bun run test:core && bun run test:cli` |
| `scripts.check` | `ultracite check` |
| `scripts.fix` | `ultracite fix` |
| `devDependencies` | Shared dev deps (biome, ultracite, typescript, bun-types) |

### packages/types/package.json

| Field | Value |
| ----- | ----- |
| `name` | `@skillset/types` |
| `version` | `0.0.1` |
| `type` | `module` |
| `main` | `./dist/index.js` |
| `types` | `./dist/types/index.d.ts` |
| `exports."."` | `{ "types": "./dist/types/index.d.ts", "import": "./dist/index.js" }` |
| `dependencies` | `type-fest: "^4.x"` |

### packages/shared/package.json

| Field | Value |
| ----- | ----- |
| `name` | `@skillset/shared` |
| `version` | `0.0.1` |
| `type` | `module` |
| `main` | `./dist/index.js` |
| `types` | `./dist/types/index.d.ts` |
| `exports."."` | `{ "types": "./dist/types/index.d.ts", "import": "./dist/index.js" }` |
| `dependencies` | `@skillset/types: "workspace:*"`, `pino: "^9.x"`, `pino-pretty: "^11.x"` |

### packages/core/package.json

| Field | Value |
| ----- | ----- |
| `name` | `@skillset/core` |
| `version` | `0.0.1` |
| `type` | `module` |
| `main` | `./dist/index.js` |
| `types` | `./dist/types/index.d.ts` |
| `exports."."` | `{ "types": "./dist/types/index.d.ts", "import": "./dist/index.js" }` |
| `dependencies` | `@skillset/types: "workspace:*"`, `@skillset/shared: "workspace:*"` |

### apps/cli/package.json

| Field | Value |
| ----- | ----- |
| `name` | `skillset` |
| `version` | `0.0.1` |
| `type` | `module` |
| `bin.skillset` | `./dist/index.js` |
| `dependencies` | `@skillset/core: "workspace:*"`, `@skillset/shared: "workspace:*"`, `chalk`, `commander`, `@inquirer/prompts`, `ora`, `object-treeify` |
| `exports."."` | Main CLI export |
| `exports."./hook"` | Hook entry for plugins |

### apps/mcp/package.json (Scaffold)

| Field | Value |
| ----- | ----- |
| `name` | `@skillset/mcp` |
| `version` | `0.0.1` |
| `private` | `true` (until ready) |
| `type` | `module` |
| `dependencies` | `@skillset/core: "workspace:*"` |

## TypeScript Configuration

### Root tsconfig.json (Solution File)

```json
{
  "files": [],
  "references": [
    { "path": "./packages/types" },
    { "path": "./packages/shared" },
    { "path": "./packages/core" },
    { "path": "./apps/cli" },
    { "path": "./apps/mcp" }
  ]
}
```

### packages/types/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist/types",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

### packages/shared/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist/types",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "references": [
    { "path": "../types" }
  ],
  "include": ["src/**/*"]
}
```

### packages/core/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist/types",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "references": [
    { "path": "../types" },
    { "path": "../shared" }
  ],
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

### apps/cli/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist/types",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "references": [
    { "path": "../../packages/types" },
    { "path": "../../packages/shared" },
    { "path": "../../packages/core" }
  ],
  "include": ["src/**/*"]
}
```

## Module Migration Table

| Current Location | Target Location | Notes |
| ---------------- | ---------------- | ------ |
| `src/types.ts` | `packages/types/src/` | Split into skill.ts, config.ts, common.ts |
| `src/logger/` | `packages/shared/src/logger.ts` | Replace with Pino logger |
| (new) | `packages/shared/src/paths.ts` | XDG path resolution |
| (new) | `packages/shared/src/env.ts` | Environment variable helpers |
| `src/tokenizer/` | `packages/core/src/tokenizer/` | Token extraction |
| `src/resolver/` | `packages/core/src/resolver/` | Skill resolution |
| `src/indexer/` | `packages/core/src/indexer/` | Skill indexing |
| `src/cache/` | `packages/core/src/cache/` | Cache management |
| `src/config/` | `packages/core/src/config/` | Config management |
| `src/format/` | `packages/core/src/format/` | Output formatting |
| `src/hooks/` | `packages/core/src/hooks/` | Hook runner |
| `src/tree/` | `packages/core/src/tree/` | Tree utilities |
| `src/cli.ts` | `apps/cli/src/cli.ts` | CLI implementation |
| `src/index.ts` | `apps/cli/src/index.ts` | CLI entry |
| `src/hook.ts` | `apps/cli/src/hook.ts` | Hook entry |
| `src/doctor.ts` | `apps/cli/src/doctor.ts` | Diagnostics |

## Package Exports

### packages/types/src/index.ts

```typescript
// Re-export useful type-fest utilities
export type {
  JsonValue,
  JsonObject,
  Simplify,
  SetRequired,
  SetOptional,
  PartialDeep,
  RequiredDeep,
} from "type-fest";

// Skill types
export type {
  Skill,
  SkillRef,
  SkillSource,
  InvocationToken,
  ResolveResult,
} from "./skill";

// Config types
export type {
  Mode,
  ConfigSchema,
  MappingEntry,
  CacheSchema,
} from "./config";

// Common types
export type {
  InjectOutcome,
} from "./common";
```

### packages/shared/src/index.ts

```typescript
// Logger (Pino)
export { logger, createLogger } from "./logger";

// XDG Paths
export {
  getConfigDir,
  getDataDir,
  getCacheDir,
  getSkillsetPaths,
} from "./paths";

// Environment
export {
  getEnv,
  getEnvBool,
  SKILLSET_ENV,
} from "./env";
```

### packages/shared/src/paths.ts

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * XDG-compliant path resolution with macOS fallback
 */
export function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ?? (process.platform === "darwin"
      ? join(homedir(), ".skillset")
      : join(homedir(), ".config", "skillset"));
}

export function getDataDir(): string {
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "skillset")
    : (process.platform === "darwin"
      ? join(homedir(), ".skillset")
      : join(homedir(), ".local", "share", "skillset"));
}

export function getCacheDir(): string {
  return process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, "skillset")
    : (process.platform === "darwin"
      ? join(homedir(), ".skillset", "cache")
      : join(homedir(), ".cache", "skillset"));
}

export function getSkillsetPaths() {
  return {
    config: getConfigDir(),
    data: getDataDir(),
    cache: getCacheDir(),
    logs: join(getDataDir(), "logs"),
  };
}
```

### packages/core/src/index.ts

```typescript
// Re-export types from @skillset/types
export type {
  Mode,
  Skill,
  SkillRef,
  CacheSchema,
  MappingEntry,
  ConfigSchema,
  ResolveResult,
  InvocationToken,
  InjectOutcome,
} from "@skillset/types";

// Tokenizer
export { tokenizePrompt } from "./tokenizer";

// Resolver
export { resolveToken, resolveTokens } from "./resolver";

// Indexer
export { indexSkills } from "./indexer";

// Cache
export {
  loadCaches,
  writeCacheSync,
  updateCacheSync,
  isStructureFresh,
} from "./cache";

// Config
export {
  loadConfig,
  writeConfig,
  readConfigByScope,
  getConfigPath,
  getConfigValue,
  setConfigValue,
  modeLabel,
} from "./config";

// Format
export { formatOutcome, stripFrontmatter } from "./format";

// Hooks
export { runUserPromptSubmitHook } from "./hooks/hook-runner";

// Tree
export {
  buildSkillTree,
  buildNamespaceTree,
  buildPathTree,
  isNamespaceRef,
  parseMarkdownHeadings,
  headingsToTreeObject,
} from "./tree";
```

## Import Updates (apps/cli)

All imports in CLI code must be updated from relative to package imports:

| Old Import | New Import |
| ---------- | ---------- |
| `from "./cache"` | `from "@skillset/core"` |
| `from "./config"` | `from "@skillset/core"` |
| `from "./resolver"` | `from "@skillset/core"` |
| `from "./tokenizer"` | `from "@skillset/core"` |
| `from "./indexer"` | `from "@skillset/core"` |
| `from "./format"` | `from "@skillset/core"` |
| `from "./tree"` | `from "@skillset/core"` |
| `from "./types"` | `from "@skillset/types"` (or via `@skillset/core` re-export) |
| `from "./logger"` | `from "@skillset/shared"` |
| (new) XDG paths | `from "@skillset/shared"` |
| (new) env helpers | `from "@skillset/shared"` |

## npm Publishing Strategy

### Packages to Publish

| Package | npm Name | Access | Notes |
| --------- | --------- | ------ | ----- |
| `packages/types` | `@skillset/types` | public | Shared type definitions |
| `packages/shared` | `@skillset/shared` | public | Shared utilities (logger, paths) |
| `packages/core` | `@skillset/core` | public | Core library for programmatic use |
| `apps/cli` | `skillset` | public | CLI tool (main package) |
| `apps/mcp` | `@skillset/mcp` | private (for now) | Future MCP server |

### Publishing Order

```bash
# Publish in dependency order: types → shared → core → cli

# 1. Types (no dependencies)
cd packages/types && bun run build && npm publish --access public

# 2. Shared (depends on types)
cd packages/shared && bun run build && npm publish --access public

# 3. Core (depends on types, shared)
cd packages/core && bun run build && npm publish --access public

# 4. CLI (depends on core, shared)
cd apps/cli && bun run build && npm publish --access public
```

### Version Management (Optional)

Consider `changesets` for coordinated version management:

```bash
bunx @changesets/cli init
bunx changeset           # Create changeset
bunx changeset version   # Update versions
bunx changeset publish   # Publish all
```

## Checklist

### Setup Phase

- [ ] Create directory structure: `packages/types/src/`, `packages/shared/src/`, `packages/core/src/`, `apps/cli/src/`, `apps/mcp/src/`
- [ ] Create root `package.json` with workspaces config
- [ ] Create `packages/types/package.json` (type-fest dependency)
- [ ] Create `packages/shared/package.json` (pino, pino-pretty dependencies)
- [ ] Create `packages/core/package.json`
- [ ] Create `apps/cli/package.json`
- [ ] Create `apps/mcp/package.json` (scaffold)
- [ ] Update root `tsconfig.json` to be solution file
- [ ] Create `packages/types/tsconfig.json` with composite
- [ ] Create `packages/shared/tsconfig.json` with composite, references types
- [ ] Create `packages/core/tsconfig.json` with composite, references types + shared
- [ ] Create `apps/cli/tsconfig.json` with references
- [ ] Create `apps/mcp/tsconfig.json` (scaffold)

### Migration Phase

- [ ] Create `packages/types/src/` with type definitions split from `src/types.ts`
- [ ] Create `packages/types/src/index.ts` with type-fest re-exports
- [ ] Create `packages/shared/src/logger.ts` with Pino logger
- [ ] Create `packages/shared/src/paths.ts` with XDG path resolution
- [ ] Create `packages/shared/src/env.ts` with environment helpers
- [ ] Create `packages/shared/src/index.ts` with exports
- [ ] Move core modules to `packages/core/src/`
- [ ] Update core modules to import from `@skillset/types` and `@skillset/shared`
- [ ] Create `packages/core/src/index.ts` with exports
- [ ] Move CLI modules to `apps/cli/src/`
- [ ] Update imports in `apps/cli/src/` to use `@skillset/core`, `@skillset/shared`
- [ ] Create `apps/mcp/src/index.ts` placeholder
- [ ] Remove old `src/` directory

### Configuration Phase

- [ ] Update `biome.json` for monorepo (add workspace ignore patterns)
- [ ] Update `lefthook.yml` for new structure
- [ ] Update `.gitignore` for workspace dist directories
- [ ] Run `bun install` to create workspace links

### Validation Phase

- [ ] `bun run build` succeeds for all packages
- [ ] `bun run test` passes for all packages
- [ ] `bun run check` passes
- [ ] Types package builds: `ls packages/types/dist/`
- [ ] Shared package builds: `ls packages/shared/dist/`
- [ ] Core package builds: `ls packages/core/dist/`
- [ ] CLI runs correctly: `bun run apps/cli/src/index.ts --help`
- [ ] Workspace dependencies resolve: `bun run apps/cli/src/index.ts index`
- [ ] XDG paths resolve correctly (test on macOS and Linux if possible)

## Validation Commands

```bash
# Install workspace dependencies
bun install

# Build all packages (in dependency order)
bun run build

# Verify each package builds
ls packages/types/dist/
ls packages/shared/dist/
ls packages/core/dist/
ls apps/cli/dist/

# Run all tests
bun run test

# Lint all packages
bun run check

# Test CLI functionality
bun run apps/cli/src/index.ts --help
bun run apps/cli/src/index.ts doctor
bun run apps/cli/src/index.ts index

# Verify workspace linking
bun pm ls

# Verify XDG paths resolve correctly
bun run apps/cli/src/index.ts config --show-paths
```

## Notes

### Dependency Considerations

**Core package should be dependency-free** - all external dependencies (`chalk`, `commander`, `inquirer`, `ora`, `object-treeify`) stay in the CLI package. This keeps the core library lightweight for programmatic use.

If any core module currently imports these, refactor:
- `chalk` usage in core modules should be removed (let consumers handle formatting)
- Any CLI-specific formatting logic should move to CLI

### Backward Compatibility

The CLI package (`skillset`) maintains the same binary name and behavior. Users installing `npm i -g skillset` get the same experience.

### Future MCP Server

The `apps/mcp` scaffold allows future development of an MCP server that:
- Imports `@skillset/core` for skill resolution
- Exposes skills via MCP protocol
- Can run alongside or instead of the CLI hook

### TypeScript Project References Benefits

1. **Incremental builds**: Only rebuild changed packages
2. **Type safety**: Catch cross-package type errors at compile time
3. **IDE support**: Go-to-definition works across packages
4. **Build order**: TypeScript enforces correct dependency order
