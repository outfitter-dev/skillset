# Config Management

Skillset uses a layered configuration model with user-edited YAML and CLI-generated overrides.

## File locations

- User config: `~/.skillset/config.yaml`
- Project config: `.skillset/config.yaml` (checked into repo)
- Generated overrides: `~/.skillset/config.generated.json`

## Schema

Add the schema comment at the top of YAML for editor validation:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@skillset/types/schemas/config.schema.json
version: 1
```

The config uses snake_case throughout. Key areas:

- `rules`: control unresolved/ambiguous behavior (`ignore`, `warn`, `error`)
- `resolution`: fuzzy matching and default scope priority
- `output`: global output formatting defaults
- `skills`: alias map (string or object with overrides)
- `sets`: named groups of skills
- `ignore_scopes` / `tools`: filtering

## Example

```yaml
# yaml-language-server: $schema=https://unpkg.com/@skillset/types/schemas/config.schema.json
version: 1

rules:
  unresolved: warn
  ambiguous: warn

resolution:
  fuzzy_matching: true
  default_scope_priority: [project, user, plugin]

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

## Merge order

Later layers win:

1. Defaults (hardcoded)
2. User YAML
3. User generated overrides (hash-aware)
4. Project YAML
5. Project generated overrides (hash-aware)

### Field-aware merge

- Maps (`skills`, `sets`) merge by key
- Objects (`rules`, `output`, `resolution`) shallow merge
- Arrays (`ignore_scopes`, `tools`, `default_scope_priority`) replace
- Scalars replace

## Generated overrides (hash-aware)

`config.generated.json` stores a hash of the YAML value when you use `skillset config set`.
Overrides only apply if the YAML value is unchanged; if the YAML value changes, YAML wins.

## Key paths with dots

Use escaped dots for aliases that contain `.`:

- `skills.tools\\.debug` refers to alias `tools.debug`

## CLI commands

```bash
skillset config show
skillset config get <key>
skillset config set <key> <value>
skillset config reset <key>
skillset config gc
```
