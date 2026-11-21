---
description: Pin and consume Skillset's v1 Claude, Codex, and Cursor hook catalog without installing Skillset.
---

# Hook Catalog

The [v1 hook catalog](v1/hooks.json) and its [JSON Schema](v1/hooks.schema.json) describe the provider evidence recorded at a Skillset commit. They are data files, not an authoring interface or a complete inventory of the providers' current releases.

## Download And Validate

Download both files from the **same full Skillset Git commit SHA**. If starting from a tag, resolve it to its commit and pin that SHA; do not pin a moving branch.

```bash
ref=YOUR_FULL_SKILLSET_GIT_COMMIT_SHA
base="https://raw.githubusercontent.com/outfitter-dev/skillset/$ref/docs/reference/registry/v1"
curl -fsSLO "$base/hooks.json"
curl -fsSLO "$base/hooks.schema.json"
```

Once downloaded, validate and query the files offline. This example requires Python and the `jsonschema` library, not Skillset or a provider runtime.

```python
import json
from pathlib import Path

from jsonschema import Draft202012Validator

catalog = json.loads(Path("hooks.json").read_text())
schema = json.loads(Path("hooks.schema.json").read_text())
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema).validate(catalog)

for target in catalog["targets"]:
    prompt = catalog["events"]["UserPromptSubmit"]["providers"][target]
    tool = catalog["events"]["PreToolUse"]["providers"][target]
    native = catalog["providers"][target]["events"][tool["nativeName"]]
    print(target, prompt["nativeName"], native["matcher"], native["handlerTypes"])

cursor = catalog["providers"]["cursor"]
names = cursor["nativeNamesByAlias"]["beforeSubmitPrompt"]
ids = sorted({event_id for name in names for event_id in cursor["events"][name]["skillsetEventIds"]})
assert "UserPromptSubmit" in ids and "BeforeSubmitPrompt" in ids
print("Cursor reverse lookup:", ids)

workspace = catalog["events"]["WorkspaceOpen"]["providers"]
assert workspace["cursor"]["fidelity"] == "provider-only"
assert workspace["codex"]["fidelity"] == "unavailable"
assert catalog["events"]["BeforeSubmitPrompt"]["providers"]["cursor"]["fidelity"] == "unknown"
```

## Read The Results

- `events[id].providers[target]` resolves a Skillset event ID. A `nativeName` records name resolution, not behavioral equivalence or a guarantee that an arbitrary hook definition renders. Read `fidelity` together with `scope` and `reason`.
- `providers[target].events[nativeName]` records native matcher, handler, and payload facts and all matching `skillsetEventIds`. Use `nativeNamesByAlias` for exact alias lookup. Keep every returned match instead of choosing the first one.
- `provider-only` is a reviewed native relationship without a portability claim. `unavailable` is a reviewed absence within the stated scope. `unknown` means no current reviewed claim, even when name resolution is known.
- `placement.skillsetWrites.plugin` is relative to the generated plugin. It is not a provider read location. Installed runtime behavior is outside this catalog.
- `field-inventory` lists observed fields, not an upstream schema or a validation contract. A null `required` flag means requiredness is unknown. Where provided, `schemaRef` pins upstream schema bytes separately.
- `evidenceIds` join to `evidence`. Its digests fingerprint the recorded facts, not the live documentation pages. Documentation URLs help you find the source; the Skillset SHA pins the catalog facts.
