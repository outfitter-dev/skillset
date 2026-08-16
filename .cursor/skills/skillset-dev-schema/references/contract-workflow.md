# Schema Contract Workflow

## Owning Files

- `packages/schema/src/contracts.ts`: descriptors, exported vocabularies, and generated artifact shape.
- `packages/schema/src/value-contracts.ts`: reusable scalar and presentation contracts.
- `packages/schema/src/validate.ts`: shared structural diagnostics.
- `packages/schema/src/examples.ts`: maximal examples validated against the same contracts.
- `packages/schema/src/artifacts.ts` and `scripts/schema-artifacts.ts`: generated schemas, examples, and freshness checks.
- `docs/reference/schemas/` and `docs/reference/examples/`: generated evidence, never authoring inputs.

## Field Checklist

1. Verify the meaning against tenets, ADRs, existing configuration vocabulary, and the feature registry.
2. Add the descriptor and any shared exported vocabulary.
3. Add shared structural validation.
4. Extend maximal examples and schema-package tests.
5. Route compiler and Workbench consumers through Schema.
6. Regenerate artifacts and inspect the diff.
7. Add package release intent and self-hosted source-change intent where required.
8. Run schema, affected-consumer, type, self-hosted-output, and aggregate checks.

## Drift Signals

- Another package has an allowed-key list for a Schema-owned shape.
- Compiler and Workbench disagree about structural validity.
- A generated schema accepts an example that runtime validation rejects.
- Documentation names a field absent from the descriptor.
- A provider-specific key appears at the adaptive top level without an explicit portability decision.
