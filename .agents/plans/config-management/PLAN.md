# Config Management Overhaul

## Overview

Redesign the skillset configuration system with:

1. **Snake_case naming** throughout
2. **Layered config** with user-editable YAML and CLI-generated JSON
3. **Per-key change detection** using value hashing for "last writer wins"
4. **JSON Schema** for validation and editor support
5. **Hardcoded namespace shortcuts** (no config needed)
6. **Tool compatibility filtering** (claude, codex, etc.)
7. **Per-skill output overrides** (include_full, include_layout)

## File Structure

```text
~/.skillset/
├── config.yaml              # User-editable global config
├── config.generated.json    # CLI-managed (projects, hashes, overrides)
└── cache.json               # Indexed skills cache (existing)

.skillset/                   # Project-level
└── config.yaml              # Project config (checked into repo)
```

## Schema Definition

### TypeScript Types (`packages/types/src/config.ts`)

```typescript
/**
 * Supported tools for compatibility filtering
 */
export type Tool = "claude" | "codex" | "copilot" | "cursor" | "amp" | "goose";

/**
 * Skill resolution scopes
 */
export type Scope = "project" | "user" | "plugin";

/**
 * Rule severity levels (matches ESLint/Biome convention)
 */
export type RuleSeverity = "ignore" | "warn" | "error";

/**
 * Main configuration schema
 */
export interface ConfigSchema {
  version: number;

  /**
   * Rule behaviors for resolution issues
   */
  rules: {
    /** What to do when a $alias cannot be resolved */
    unresolved: RuleSeverity;
    /** What to do when multiple skills match an alias */
    ambiguous: RuleSeverity;
  };

  /**
   * Skill resolution settings
   */
  resolution?: {
    /** Enable fuzzy matching when exact match not found (default: true) */
    fuzzy_matching?: boolean;
    /** Default scope priority when not specified (default: ["project", "user", "plugin"]) */
    default_scope_priority?: Scope[];
  };

  /**
   * Output formatting settings
   */
  output: {
    /** Maximum lines per skill (default: 500) */
    max_lines: number;
    /** Include layout/structure info (default: false) */
    include_layout: boolean;
  };

  /**
   * Scopes to ignore at project level
   * Example: ["user", "plugin"] to only use project skills
   */
  ignore_scopes?: Scope[];

  /**
   * Only include skills compatible with these tools
   * If omitted, no filtering applied
   */
  tools?: Tool[];

  /**
   * Skill alias definitions
   */
  skills: Record<string, SkillEntry>;

  /**
   * Named sets of skills
   */
  sets?: Record<string, SetDefinition>;
}

/**
 * Skill entry - string shorthand or object with overrides
 */
export type SkillEntry =
  | string // skill name or explicit path
  | {
      /** Skill name (mutually exclusive with path) */
      skill?: string;
      /** Explicit file path (mutually exclusive with skill) */
      path?: string;
      /** Resolution scope or priority order */
      scope?: Scope | Scope[];
      /** Ignore max_lines, include entire file */
      include_full?: boolean;
      /** Override output.include_layout for this skill */
      include_layout?: boolean;
    };

/**
 * Set of skills that can be invoked together
 */
export interface SetDefinition {
  name: string;
  description?: string;
  /** Skill aliases (references keys from skills section) */
  skills: string[];
}

/**
 * CLI-generated settings file schema
 */
export interface GeneratedSettingsSchema {
  /** Hashes of YAML values when CLI set overrides */
  _yaml_hashes: Record<string, string>;

  /** Global CLI overrides */
  skills?: Record<string, SkillEntry>;
  output?: Partial<ConfigSchema["output"]>;
  rules?: Partial<ConfigSchema["rules"]>;

  /** Per-project CLI overrides, keyed by absolute path */
  projects: Record<string, ProjectSettings>;
}

/**
 * Per-project settings in generated file
 */
export interface ProjectSettings {
  _yaml_hashes: Record<string, string>;
  skills?: Record<string, SkillEntry>;
  output?: Partial<ConfigSchema["output"]>;
  rules?: Partial<ConfigSchema["rules"]>;
  ignore_scopes?: Scope[];
  tools?: Tool[];
}
```

### JSON Schema (`packages/types/schemas/config.schema.json`)

Create a JSON Schema file for editor validation. This enables:
- Autocomplete in VS Code/editors
- Validation on save
- Documentation on hover

The schema should be referenced in YAML files:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@skillset/types/schemas/config.schema.json
version: 1
# ...
```

## Skill Source Paths (`packages/shared/src/paths.ts`)

Add named path constants for all supported tools:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Skill source paths by tool
 */
export const SKILL_PATHS = {
  claude: {
    project: (root: string) => join(root, ".claude", "skills"),
    user: () => join(homedir(), ".claude", "skills"),
  },
  codex: {
    project: (root: string) => join(root, ".codex", "skills"),
    user: () =>
      process.env.CODEX_HOME
        ? join(process.env.CODEX_HOME, "skills")
        : join(homedir(), ".codex", "skills"),
  },
  copilot: {
    project: (root: string) => join(root, ".github", "skills"),
    user: () => join(homedir(), ".github", "skills"),
  },
  cursor: {
    project: (root: string) => join(root, ".cursor", "skills"),
    user: () => join(homedir(), ".cursor", "skills"),
  },
  amp: {
    project: (root: string) => join(root, ".amp", "skills"),
    user: () => join(homedir(), ".amp", "skills"),
  },
  goose: {
    project: (root: string) => join(root, ".goose", "skills"),
    user: () => join(homedir(), ".goose", "skills"),
  },
} as const;

export type ToolName = keyof typeof SKILL_PATHS;

/**
 * Get all skill paths for a given scope
 */
export function getSkillPaths(
  scope: "project" | "user",
  projectRoot?: string
): Record<ToolName, string> {
  const result: Record<string, string> = {};
  for (const [tool, paths] of Object.entries(SKILL_PATHS)) {
    result[tool] =
      scope === "project" && projectRoot
        ? paths.project(projectRoot)
        : paths.user();
  }
  return result as Record<ToolName, string>;
}
```

## Hardcoded Namespace Shortcuts

Remove `namespaceAliases` from config. Implement in resolver:

```typescript
const NAMESPACE_SHORTCUTS: Record<string, Scope> = {
  // Project scope
  p: "project",
  proj: "project",
  project: "project",

  // User scope
  u: "user",
  g: "user", // global
  user: "user",
  global: "user",

  // Plugin scope
  plugin: "plugin",
};

export function resolveNamespace(input: string): Scope | undefined {
  return NAMESPACE_SHORTCUTS[input.toLowerCase()];
}
```

## Config Resolution Pipeline

### Load Order (later wins)

1. **Defaults** - hardcoded sensible defaults
2. **Global config.yaml** - `~/.skillset/config.yaml`
3. **Global config.generated.json** - `~/.skillset/config.generated.json` (with hash check)
4. **Project config.yaml** - `.skillset/config.yaml`
5. **Project entry in global generated** - `projects[projectId]` (with hash check)

### Merge Strategy (Field-Aware)

Different fields use different merge strategies to avoid surprises:

| Field Type | Strategy | Example |
| ---------- | -------- | ------- |
| `skills`, `sets` | Map merge (key-level replace) | Later layer replaces specific alias, preserves others |
| `rules`, `output`, `resolution` | Shallow merge (one level) | Later layer overrides specific properties |
| Arrays (`ignore_scopes`, `tools`, `default_scope_priority`) | Full replace | Later layer completely replaces array |
| Scalars (`version`, `fuzzy_matching`) | Replace | Later layer wins |

```typescript
function mergeConfigs(base: ConfigSchema, overlay: Partial<ConfigSchema>): ConfigSchema {
  return {
    ...base,
    // Scalars: replace
    version: overlay.version ?? base.version,

    // Shallow merge objects
    rules: { ...base.rules, ...overlay.rules },
    output: { ...base.output, ...overlay.output },
    resolution: { ...base.resolution, ...overlay.resolution },

    // Arrays: replace entirely if present
    ignore_scopes: overlay.ignore_scopes ?? base.ignore_scopes,
    tools: overlay.tools ?? base.tools,

    // Maps: key-level merge
    skills: { ...base.skills, ...overlay.skills },
    sets: { ...base.sets, ...overlay.sets },
  };
}
```

### Project Identification

Projects are identified by a stable ID to handle symlinks, path variations, and optional sharing:

```typescript
type ProjectIdStrategy = "path" | "remote";

interface GeneratedSettingsSchema {
  // ...
  project_id_strategy?: ProjectIdStrategy; // default: "path"
  projects: Record<string, ProjectSettings>; // keyed by project_id
}

/**
 * Generate project ID based on strategy
 * - "path": hash(realpath(repo_root)) - isolated per clone (default)
 * - "remote": hash(remote.origin.url) - shared across clones of same repo
 */
function getProjectId(projectPath: string, strategy: ProjectIdStrategy = "path"): string {
  const repoRoot = findGitRoot(projectPath);
  const realPath = realpathSync(repoRoot);

  if (strategy === "remote") {
    // Use git to get remote URL (implementation uses execFileNoThrow for safety)
    const remoteUrl = getGitRemoteUrl(realPath);
    return hashString(remoteUrl).slice(0, 16);
  }

  return hashString(realPath).slice(0, 16);
}
```

### Hash-Based Override Resolution

**Canonicalization**: Use stable JSON serialization to avoid hash instability from key ordering:

```typescript
import { createHash } from "node:crypto";
import stableStringify from "json-stable-stringify";

function hashValue(value: unknown): string {
  // Use stable stringify to ensure consistent key ordering
  const canonical = stableStringify(value) ?? "undefined";
  return createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 12);
}

interface GeneratedSettings {
  _yaml_hashes: Record<string, string>;
  [key: string]: unknown;
}

function applyGeneratedOverrides(
  yamlConfig: ConfigSchema,
  generated: GeneratedSettings,
  keyPath: string[] = []
): ConfigSchema {
  const result = { ...yamlConfig };

  for (const [key, genValue] of Object.entries(generated)) {
    if (key === "_yaml_hashes" || key === "projects") continue;

    const fullPath = [...keyPath, key].join(".");
    const storedHash = generated._yaml_hashes[fullPath];

    if (storedHash) {
      // Get current YAML value for this path
      const yamlValue = getValueAtPath(yamlConfig, fullPath);
      const currentHash = hashValue(yamlValue);

      if (currentHash === storedHash) {
        // YAML unchanged since CLI set this → use generated value
        setValueAtPath(result, fullPath, genValue);
      }
      // else: YAML was edited → YAML wins, generated value ignored
    }
  }

  return result;
}
```

### CLI Write Flow

When CLI sets a value:

```typescript
async function cliSetValue(
  keyPath: string,
  newValue: unknown,
  projectPath?: string
): Promise<void> {
  const generated = await loadGenerated();
  const yamlConfig = await loadYamlConfig(projectPath);

  // Get current YAML value and hash it
  const yamlValue = getValueAtPath(yamlConfig, keyPath);
  const yamlHash = hashValue(yamlValue);

  // Store in appropriate location
  const target = projectPath
    ? (generated.projects[projectPath] ??= { _yaml_hashes: {} })
    : generated;

  target._yaml_hashes[keyPath] = yamlHash;
  setValueAtPath(target, keyPath, newValue);

  await saveGenerated(generated);
}
```

### Key Path Handling

Key paths use dot notation but must handle aliases containing dots:

```typescript
/**
 * Escape dots in key segments to avoid ambiguity
 * "skills.tools.debug" with alias "tools.debug" becomes "skills.tools\.debug"
 */
function escapeKeySegment(segment: string): string {
  return segment.replace(/\./g, "\\.");
}

function unescapeKeySegment(segment: string): string {
  return segment.replace(/\\\./g, ".");
}

/**
 * Split key path respecting escaped dots
 * "skills.tools\.debug" → ["skills", "tools.debug"]
 */
function splitKeyPath(path: string): string[] {
  return path.split(/(?<!\\)\./).map(unescapeKeySegment);
}

/**
 * Join key path with proper escaping
 * ["skills", "tools.debug"] → "skills.tools\.debug"
 */
function joinKeyPath(segments: string[]): string {
  return segments.map(escapeKeySegment).join(".");
}
```

### File Locking & Atomic Writes

Concurrent CLI processes can corrupt `config.generated.json`. Use atomic writes with locking:

```typescript
import { writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Atomically write JSON file with lock
 */
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const lockPath = `${filePath}.lock`;
  const tempPath = join(tmpdir(), `skillset-${Date.now()}-${Math.random().toString(36)}.json`);

  // Acquire lock (use proper-lockfile or similar in implementation)
  await acquireLock(lockPath, { retries: 3, stale: 10000 });

  try {
    // Write to temp file
    writeFileSync(tempPath, JSON.stringify(data, null, 2));
    // Atomic rename
    renameSync(tempPath, filePath);
  } finally {
    await releaseLock(lockPath);
  }
}
```

### Garbage Collection for Stale Hashes

When YAML keys are deleted or renamed, orphan entries remain in `_yaml_hashes`. Run cleanup:

```typescript
/**
 * Remove stale hash entries that no longer correspond to YAML keys
 */
function cleanupStaleHashes(
  generated: GeneratedSettings,
  yamlConfig: ConfigSchema
): GeneratedSettings {
  const cleaned = { ...generated, _yaml_hashes: { ...generated._yaml_hashes } };

  for (const keyPath of Object.keys(cleaned._yaml_hashes)) {
    // Check if key path exists in YAML
    const yamlValue = getValueAtPath(yamlConfig, keyPath);
    if (yamlValue === undefined) {
      // Key no longer exists in YAML - remove hash and override
      delete cleaned._yaml_hashes[keyPath];
      deleteValueAtPath(cleaned, keyPath);
    }
  }

  return cleaned;
}
```

Run cleanup on:
- `skillset config gc` command (explicit)
- Periodically during `config set` operations (every N writes)
- During `skillset sync` / `skillset init`

### Edge Cases & Error Handling

| Scenario | Behavior |
| -------- | -------- |
| YAML value changes type (string → object) | Compare hashes; if different, YAML wins. Log warning if generated override is incompatible type. |
| YAML section deleted entirely | Cleanup removes orphan hashes. Generated overrides for that section are dropped. |
| YAML value set to `null` | Treat as explicit "unset". Hash of `null` is valid. |
| Array reordering in YAML | Different hash → YAML wins (arrays are order-sensitive) |
| Missing `_yaml_hashes` (corrupt file) | Treat all generated overrides as stale; YAML wins for everything. Log warning. |
| Concurrent writes | File locking prevents corruption. Last successful write wins. |
| Project path changes (symlink, move) | Project ID based on realpath; moving repo creates new project entry. |

## Default Values

```typescript
export const CONFIG_DEFAULTS: ConfigSchema = {
  version: 1,
  rules: {
    unresolved: "warn",
    ambiguous: "warn",
  },
  resolution: {
    fuzzy_matching: true,
    default_scope_priority: ["project", "user", "plugin"],
  },
  output: {
    max_lines: 500,
    include_layout: false,
  },
  skills: {},
  sets: {},
};
```

## Example Configurations

### User config (`~/.skillset/config.yaml`)

```yaml
# yaml-language-server: $schema=https://unpkg.com/@skillset/types/schemas/config.schema.json
version: 1

rules:
  unresolved: warn
  ambiguous: warn

resolution:
  fuzzy_matching: true

output:
  max_lines: 500
  include_layout: false

skills:
  tdd: tdd
  debug:
    skill: debugging
    scope: user
    include_full: true
    include_layout: true

sets:
  dev:
    name: Development
    skills: [tdd, debug]
```

### Project config (`.skillset/config.yaml`)

```yaml
version: 1

# Only use project skills, ignore user/plugin
ignore_scopes: [user, plugin]

# Only claude-compatible skills
tools: [claude]

rules:
  unresolved: error  # Strict in CI

skills:
  api:
    path: ./docs/api-guidelines.md
    include_full: true
  review: code-review

sets:
  pr:
    name: PR Review
    skills: [api, review]
```

### Generated settings (`~/.skillset/config.generated.json`)

```json
{
  "_yaml_hashes": {
    "output.max_lines": "a1b2c3d4e5f6"
  },
  "output": {
    "max_lines": 300
  },
  "projects": {
    "/Users/mg/Developer/outfitter/skillset": {
      "_yaml_hashes": {
        "skills.custom": "f6e5d4c3b2a1"
      },
      "skills": {
        "custom": "project:custom-workflow"
      }
    }
  }
}
```

## Implementation Tasks

### Phase 1: Schema & Types

1. **Update `packages/types/src/config.ts`**
   - Replace existing types with new schema
   - Add Tool, Scope, RuleSeverity types
   - Add SkillEntry union type
   - Add GeneratedSettingsSchema
   - Export all types

2. **Create `packages/types/schemas/config.schema.json`**
   - Full JSON Schema matching TypeScript types
   - Include descriptions for documentation
   - Add examples

3. **Update `packages/types/src/index.ts`**
   - Export new types
   - Remove deprecated types (Mode, MappingEntry, namespaceAliases)

### Phase 2: Path Constants

4. **Update `packages/shared/src/paths.ts`**
   - Add SKILL_PATHS constant
   - Add getSkillPaths helper
   - Add ToolName type export

5. **Update `packages/shared/src/index.ts`**
   - Export new path utilities

### Phase 3: Config Loading

6. **Create `packages/core/src/config/utils.ts`**
   - Key path escaping/unescaping for dots
   - `splitKeyPath()` and `joinKeyPath()` functions
   - `getValueAtPath()` and `setValueAtPath()` with escaped path support
   - `deleteValueAtPath()` for cleanup

7. **Create `packages/core/src/config/hash.ts`**
   - Canonical hashing with `json-stable-stringify`
   - `hashValue()` function

8. **Create `packages/core/src/config/merge.ts`**
   - Field-aware merge strategy implementation
   - `mergeConfigs()` function
   - Handle maps (skills, sets), shallow objects (rules, output), arrays (replace)

9. **Create `packages/core/src/config/loader.ts`**
   - YAML loading with js-yaml
   - JSON loading for generated file
   - Hash-based override resolution with `applyGeneratedOverrides()`
   - Garbage collection for stale hashes

10. **Create `packages/core/src/config/writer.ts`**
    - Atomic writes with `proper-lockfile`
    - CLI write operations with hash storage
    - Project ID generation (path vs remote strategy)

11. **Create `packages/core/src/config/project.ts`**
    - `getProjectId()` with path/remote strategies
    - `findGitRoot()` helper
    - `getGitRemoteUrl()` helper (using execFileNoThrow)

12. **Update `packages/core/src/config/index.ts`**
    - Integrate new modules
    - Export unified API

### Phase 4: Resolver Updates

13. **Update `packages/core/src/resolver/index.ts`**
    - Implement hardcoded namespace shortcuts
    - Handle new SkillEntry format (string | object)
    - Support path-based skill entries
    - Add scope priority resolution

14. **Update `packages/core/src/resolver/fuzzy.ts`** (if exists)
    - Respect `resolution.fuzzy_matching` setting

### Phase 5: CLI Commands

15. **Update `apps/cli/src/commands/config.ts`**
    - `skillset config get <key>` - show resolved value
    - `skillset config set <key> <value>` - write to generated
    - `skillset config reset <key>` - remove from generated
    - `skillset config show` - show merged config
    - `skillset config edit` - open YAML in editor
    - `skillset config gc` - garbage collect stale hashes

16. **Update `apps/cli/src/commands/alias.ts`** (rename to skills?)
    - `skillset skills add <alias> <skill>` - add skill mapping
    - `skillset skills remove <alias>` - remove mapping
    - `skillset skills list` - list all skill mappings

17. **Update `apps/cli/src/commands/init.ts`**
    - Generate config.yaml with sensible defaults
    - Add schema reference comment

### Phase 6: Migration

18. **Create `packages/core/src/config/migrate.ts`**
    - Detect old config format
    - Transform to new schema:
      - `mode` → `rules.unresolved`
      - `mappings` → `skills`
      - `showStructure` → `output.include_layout`
      - `maxLines` → `output.max_lines`
      - Remove `namespaceAliases`
    - Backup old config before migration

19. **Update `apps/cli/src/commands/doctor.ts`**
    - Check for old config format
    - Suggest migration command

### Phase 7: Tests

20. **Create `packages/core/src/config/__tests__/utils.test.ts`**
    - Key path escaping/unescaping
    - Get/set/delete value at path

21. **Create `packages/core/src/config/__tests__/hash.test.ts`**
    - Canonical hashing stability
    - Object key ordering independence

22. **Create `packages/core/src/config/__tests__/merge.test.ts`**
    - Field-aware merge strategy
    - Map merge vs array replace vs shallow merge

23. **Create `packages/core/src/config/__tests__/loader.test.ts`**
    - YAML loading
    - JSON loading
    - Hash-based resolution
    - Garbage collection

24. **Create `packages/core/src/config/__tests__/writer.test.ts`**
    - Atomic writes
    - Hash storage
    - Project isolation
    - Concurrent write handling

25. **Update resolver tests**
    - Namespace shortcuts
    - New SkillEntry format
    - Scope priority

### Phase 8: Documentation

26. **Update `docs/config.md`** (create if needed)
    - Full schema reference
    - Merge strategy explanation
    - Hash-based override behavior
    - Examples
    - Migration guide

27. **Update `README.md`**
    - Config section
    - Quick examples

## File Changes Summary

| File | Action | Description |
| ---- | ------ | ----------- |
| `packages/types/src/config.ts` | Replace | New schema types |
| `packages/types/schemas/config.schema.json` | Create | JSON Schema |
| `packages/shared/src/paths.ts` | Update | Add SKILL_PATHS |
| `packages/core/src/config/utils.ts` | Create | Key path utilities |
| `packages/core/src/config/hash.ts` | Create | Canonical hashing |
| `packages/core/src/config/merge.ts` | Create | Field-aware merge |
| `packages/core/src/config/loader.ts` | Create | Config loading + GC |
| `packages/core/src/config/writer.ts` | Create | Atomic writes + locking |
| `packages/core/src/config/project.ts` | Create | Project ID generation |
| `packages/core/src/config/migrate.ts` | Create | Migration logic |
| `packages/core/src/config/index.ts` | Update | New exports |
| `packages/core/src/resolver/index.ts` | Update | Namespace shortcuts, new format |
| `apps/cli/src/commands/config.ts` | Update | New subcommands + gc |
| `apps/cli/src/commands/alias.ts` | Rename/Update | → skills.ts |
| `apps/cli/src/commands/init.ts` | Update | Generate YAML |
| `apps/cli/src/commands/doctor.ts` | Update | Migration check |

## Dependencies

Add to workspace root or relevant packages:

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0",
    "json-stable-stringify": "^1.1.1",
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/json-stable-stringify": "^1.0.36",
    "@types/proper-lockfile": "^4.1.4"
  }
}
```

## Success Criteria

- [ ] All config files use snake_case
- [ ] YAML configs load and validate correctly
- [ ] CLI can set/get values with hash tracking
- [ ] Canonical hashing is stable (key order independent)
- [ ] Field-aware merge works correctly (maps, arrays, shallow objects)
- [ ] Project ID generation handles symlinks and path variations
- [ ] Garbage collection removes stale hashes
- [ ] Atomic writes prevent corruption from concurrent access
- [ ] Key paths with dots are properly escaped
- [ ] Project overrides work correctly
- [ ] Old configs migrate cleanly
- [ ] JSON Schema provides editor autocomplete
- [ ] All tests pass
- [ ] Documentation updated

## Open Questions

1. Should we support TOML as an alternative to YAML?
2. Should `config.generated.json` be gitignored by default in `skillset init`?
3. How to handle config in monorepos (workspace root vs package)?
4. Should `project_id_strategy` be configurable per-project, or only global?

## Codex Review Notes

This plan was reviewed by Codex CLI with the following key feedback incorporated:

1. **Hash stability** - Using `json-stable-stringify` for canonical hashing to avoid key order issues
2. **Merge strategy** - Field-aware merge (maps: key-level, objects: shallow, arrays: replace)
3. **Project identification** - Using realpath + optional remote URL strategy for stable project IDs
4. **Stale hash cleanup** - Garbage collection to remove orphan `_yaml_hashes` entries
5. **Key path escaping** - Escape dots in alias names to avoid path ambiguity
6. **Concurrent writes** - File locking with `proper-lockfile` for atomic writes
7. **Edge cases** - Defined behavior for type changes, null values, array reordering, corrupt files
