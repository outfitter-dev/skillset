# Managing ADRs without the script

Manual instructions for ADR lifecycle operations when the skill-local `scripts/adr.ts` helper is not available.

## Creating a new draft ADR

1. Create the file at `docs/adrs/drafts/YYYYMMDD-slug.md` using today's date
2. Add frontmatter with `status: draft`, `created`, `updated`, `owners`
3. Use `# ADR: Title` (no number) for the heading
4. Fill in the four required sections: Context, Decision, Consequences, References

## Promoting a draft

1. Assign the next ADR number (check `docs/adrs/README.md` for the current highest, zero-padded to 4 digits)
2. Rename: `docs/adrs/drafts/YYYYMMDD-slug.md` → `docs/adrs/NNNN-slug.md` (use `git mv` to preserve history)
3. Update frontmatter: set `status` to `proposed` or `accepted`, update `updated` date
4. Update the title: `# ADR: Title` → `# ADR-NNNN: Title`
5. Add a row to the index table in `docs/adrs/README.md`
6. Update any other ADRs that reference this one as "(draft)" to use the numbered link
7. If the script is available, regenerate `docs/adrs/decision-map.json`, `docs/adrs/drafts/decision-map.json`, and `docs/adrs/drafts/README.md`

## Demoting a numbered ADR

1. Rename: `docs/adrs/NNNN-slug.md` → `docs/adrs/drafts/YYYYMMDD-slug.md` (use `git mv`)
2. Update frontmatter: set `status: draft`, update `updated` date
3. Update the title: `# ADR-NNNN: Title` → `# ADR: Title`
4. Remove the row from `docs/adrs/README.md`
5. Update any ADRs that reference the numbered link

## Superseding an ADR

1. Create a new ADR (the successor) following the normal process
2. In the old ADR's frontmatter, set `status: superseded` and add `superseded_by: ['NNNN']`
3. Update the old ADR's index entry status to `Superseded`
4. In the new ADR's References, link to the predecessor

## Amending an ADR

1. Create the successor through the normal draft workflow
2. Add `amends: [NNNN]` to the successor, targeting an existing accepted numbered ADR with a lower ID
3. Describe the narrow change and link the predecessor in References
4. Promote the successor when the amendment is approved; draft and proposed declarations are prospective only
5. Regenerate the decision maps so the accepted successor's `amends` and the predecessor's derived `amended_by` appear together

Do not edit the predecessor's body, status, or frontmatter for an amendment, and never author `amended_by`. Use supersession instead when the successor replaces the earlier decision as a whole. Accepted later replacements in the lifecycle's `superseded_by` chain preserve amendment history; bare superseded status and proposed or rejected replacements do not.

## Rejecting a draft

1. Promote the draft to a numbered ADR (it needs a number to preserve in the index)
2. Set `status: rejected` in the frontmatter
3. Add to the index with status `Rejected`
4. Preserve the Context and Decision sections — the reasoning for rejection is the value

## ADR index format

The index lives at `docs/adrs/README.md`:

```markdown
| ADR | Title | Status |
| --- | --- | --- |
| [NNNN](NNNN-slug.md) | Title | Accepted |
```

Rules:

- Every numbered ADR (proposed, accepted, rejected, superseded) MUST appear
- Drafts do NOT appear — they live in `docs/adrs/drafts/` until promoted
- Order by ADR number ascending
- Status column reflects current frontmatter status, capitalized

## Decision map

`docs/adrs/decision-map.json` catalogs numbered ADR metadata, while `docs/adrs/drafts/decision-map.json` catalogs draft ADR metadata. The script's `map` command regenerates both maps and the generated draft index.
