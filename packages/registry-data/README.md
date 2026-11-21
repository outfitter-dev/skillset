# @skillset/registry

The v1 Skillset hook catalog describes recorded hook evidence for Claude, Codex, and Cursor. It does not install hooks, load provider runtimes, or expose the Skillset compiler.

```js
import { hooks } from "@skillset/registry/hooks";

const prompt = hooks.events["UserPromptSubmit"];
console.log(prompt?.providers.cursor.nativeName);
```

The package requires Node 18 or later for Node ESM consumers and also works in Bun. Raw data and schema are available at `@skillset/registry/hooks.json` and `@skillset/registry/hooks.schema.json`, matching the [commit-pinned Git contract](https://github.com/outfitter-dev/skillset/tree/main/docs/reference/registry). Treat the exported data as read-only and check for absent keys when looking up dynamic names.

This package is currently available as a locally built tarball only. It is not in Skillset's active npm release set.
