# Phase 0: Monorepo Conversion

## Scope

Restructure the skillset project from a flat package structure into a Bun workspaces monorepo with:
- `packages/core` - Core library (tokenizer, resolver, indexer, cache, config, format, types)
- `apps/cli` - CLI application
- `apps/mcp` - MCP server (future, scaffold only)

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
│   └── core/
│       ├── package.json      # @outfitter/skillset-core
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts      # Core exports
│           ├── types.ts
│           ├── tokenizer/
│           ├── resolver/
│           ├── indexer/
│           ├── cache/
│           ├── config/
│           ├── format/
│           ├── hooks/
│           ├── logger/
│           └── tree/
├── apps/
│   ├── cli/
│   │   ├── package.json      # skillset (CLI)
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts      # CLI entry
│   │       ├── hook.ts       # Hook entry
│   │       ├── cli.ts
│   │       └── doctor.ts
│   └── mcp/
│       ├── package.json      # @outfitter/skillset-mcp
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

### packages/core/package.json

| Field | Value |
| ----- | ----- |
| `name` | `@skillset/core` |
| `version` | `0.0.1` |
| `type` | `module` |
| `main` | `./dist/index.js` |
| `types` | `./dist/types/index.d.ts` |
| `exports."."` | `{ "types": "./dist/types/index.d.ts", "import": "./dist/index.js" }` |
| `dependencies` | (none - core is dependency-free) |

### apps/cli/package.json

| Field | Value |
| ----- | ----- |
| `name` | `skillset` |
| `version` | `0.0.1` |
| `type` | `module` |
| `bin.skillset` | `./dist/index.js` |
| `dependencies` | `@skillset/core: "workspace:*"`, `chalk`, `commander`, `inquirer`, `ora`, `object-treeify` |
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
    { "path": "./packages/core" },
    { "path": "./apps/cli" },
    { "path": "./apps/mcp" }
  ]
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
    { "path": "../../packages/core" }
  ],
  "include": ["src/**/*"]
}
```

## Module Migration Table

| Current Location | Target Location | Notes |
| ---------------- | ---------------- | ------ |
| `src/types.ts` | `packages/core/src/types.ts` | Core types |
| `src/tokenizer/` | `packages/core/src/tokenizer/` | Token extraction |
| `src/resolver/` | `packages/core/src/resolver/` | Skill resolution |
| `src/indexer/` | `packages/core/src/indexer/` | Skill indexing |
| `src/cache/` | `packages/core/src/cache/` | Cache management |
| `src/config/` | `packages/core/src/config/` | Config management |
| `src/format/` | `packages/core/src/format/` | Output formatting |
| `src/hooks/` | `packages/core/src/hooks/` | Hook runner |
| `src/logger/` | `packages/core/src/logger/` | Logging |
| `src/tree/` | `packages/core/src/tree/` | Tree utilities |
| `src/cli.ts` | `apps/cli/src/cli.ts` | CLI implementation |
| `src/index.ts` | `apps/cli/src/index.ts` | CLI entry |
| `src/hook.ts` | `apps/cli/src/hook.ts` | Hook entry |
| `src/doctor.ts` | `apps/cli/src/doctor.ts` | Diagnostics |

## Core Library Exports

The `packages/core/src/index.ts` barrel export:

```typescript
// Types
export type {
  Mode,
  Skill,
  CacheSchema,
  MappingEntry,
  ConfigSchema,
  ResolveResult,
  InvocationToken,
  InjectOutcome,
} from "./types";

// Tokenizer
export { tokenizePrompt } from "./tokenizer";

// Resolver
export { resolveToken, resolveTokens } from "./resolver";

// Indexer
export { indexSkills } from "./indexer";

// Cache
export {
  CACHE_PATHS,
  loadCaches,
  writeCacheSync,
  updateCacheSync,
  isStructureFresh,
} from "./cache";

// Config
export {
  CONFIG_PATHS,
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

// Logger
export { logResults } from "./logger";

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
| `from "./types"` | `from "@skillset/core"` |

## npm Publishing Strategy

### Packages to Publish

| Package | npm Name | Access | Notes |
| --------- | --------- | ------ | ----- |
| `packages/core` | `@skillset/core` | public | Core library for programmatic use |
| `apps/cli` | `skillset` | public | CLI tool (main package) |
| `apps/mcp` | `@skillset/mcp` | private (for now) | Future MCP server |

### Publishing Order

```bash
# Publish core first (it's a dependency)
cd packages/core && bun run build && npm publish --access public

# Publish CLI
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

- [ ] Create directory structure: `packages/core/src/`, `apps/cli/src/`, `apps/mcp/src/`
- [ ] Create root `package.json` with workspaces config
- [ ] Create `packages/core/package.json`
- [ ] Create `apps/cli/package.json`
- [ ] Create `apps/mcp/package.json` (scaffold)
- [ ] Update root `tsconfig.json` to be solution file
- [ ] Create `packages/core/tsconfig.json` with composite
- [ ] Create `apps/cli/tsconfig.json` with references
- [ ] Create `apps/mcp/tsconfig.json` (scaffold)

### Migration Phase

- [ ] Move core modules to `packages/core/src/`
- [ ] Create `packages/core/src/index.ts` with exports
- [ ] Move CLI modules to `apps/cli/src/`
- [ ] Update imports in `apps/cli/src/` to use `@outfitter/skillset-core`
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
- [ ] CLI runs correctly: `bun run apps/cli/src/index.ts --help`
- [ ] Workspace dependencies resolve: `bun run apps/cli/src/index.ts index`

## Validation Commands

```bash
# Install workspace dependencies
bun install

# Build all packages
bun run build

# Verify core builds
ls packages/core/dist/

# Verify CLI builds
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
