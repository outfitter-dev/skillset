---
description: Introduces Skillset's source-first journey and the executable first-author example.
---

# Start with Skillset

Skillset's complete author journey is **Start → Adopt → Work → Ship**. This initial path establishes the first build; the later stages are expanded in the task guides as the documentation overhaul proceeds.

## Start

1. Read [why Skillset exists](../why-skillset.md).
2. Run the checked-in [first-author example](../../examples/first-author/README.md).
3. Learn why [building and activation are separate](build-versus-activation.md).
4. Use the [CLI reference](../reference/cli/README.md) when a command detail matters.

## Adopt

Initialize an existing repository with `skillset init`, then use `skillset import` for selected provider-native skills or plugins. Both operations preserve a preview and explicit-write boundary.

## Work

Keep `.skillset/` as source truth. Run `skillset check`, preview changes with `skillset build` or `skillset diff`, and confirm writes with `skillset build --yes`.

## Ship

Commit and review the provider-native outputs your repository owns. Publishing, marketplace distribution, and runtime activation remain separate explicit workflows.
