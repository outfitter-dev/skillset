---
description: Inventories source listing, native manifest import, and marketplace field mappings and their evidence boundaries.
---

# SET-433 manifest and marketplace field projections

Code baseline `5b53799f470916d97eac13a4b7ecb8ab96762648`; historical inspections and fixture baselines are named where they differ. Test names cite evidence and are not claims that this documentation pass ran them. See the [overview](./2026-10-30-set-433-transform-inventory.md) for disposition categories and acceptance status.

## Canonical listing schema and read-time compatibility

`packages/schema/src/contracts.ts:sourceListingSchema` and `validate.ts:checkSourceListing` own the shared shape: strict listing keys; scalar strings nonempty, arrays of nonempty strings. `presentation` is a legacy object, not an automatically portable provider format. `packages/core/src/source-listing.ts:readSourceListing` creates source-only derived listing; ordered merge is **legacy top-level < normalized presentation < canonical listing**, where undefined keys do not overwrite and nested objects recursively merge (`config.ts:mergeRecords`). `readString` trims nonblank strings, treats blank/non-string as absent; `readStringArray` accepts arrays containing only strings (including empty string in this low-level reader) and throws for non-array/non-string elements. Shared schema validation is the authoritative stricter acceptance boundary; do not mistake permissive low-level readers as guaranteed valid inputs. Conflict is first/last precedence, not a conflict diagnostic. `source-listing.test.ts`, `schema.test.ts`, `source-metadata-compatibility.test.ts` test examples and migration guidance, not every alias collision/type pair.

| Canonical field | Legacy input precedence before canonical `listing` | Disposition / qualification |
|---|---|---|
| `display_name` | presentation `display_name`, `displayName`; then top-level `title` | D2 explicit alias + trimming; schema requires nonempty string. Unknown `ui.displayName` is not consulted. |
| `summary` | presentation `summary`, `short_description`, `shortDescription`; then top-level `summary` | D2; first nonblank alias, no unequal-value conflict report. |
| `description` | presentation `description`, `long_description`, `longDescription` | D2; nonblank string; no top-level alias here. |
| `category` | presentation `category`; then top-level `category` | D2; nonblank string. |
| `keywords` | top-level `keywords` only; canonical listing can replace | D2; string array copied. Legacy `presentation.keywords` not read. |
| `capabilities`, `screenshots` | corresponding presentation array | D2; copied string array; canonical schema rejects empty element. |
| `default_prompt` | presentation `default_prompt`, then `defaultPrompt` | D2; first defined array; malformed first array throws rather than trying second. |
| `color` | presentation `color`, `brand_color`, `brandColor` | D2; first nonblank. |
| `website_url` | presentation `website_url`, `websiteURL`; then top-level `homepage` | D2; aliasing is Skillset's own compatibility contract, not proof homepage/repository provider semantics. |
| `privacy_policy_url`, `terms_of_service_url` | presentation snake_case then `privacyPolicyURL`, `termsOfServiceURL` | D2; first nonblank. |
| `composer_icon`, `logo_dark` | presentation snake_case then `composerIcon`, `logoDark` | D2; first nonblank. |
| `logo` | presentation `logo` | D2; nonblank. |

## Native manifest → canonical import

`apps/skillset/src/import.ts:readNativePluginManifests` iterates schema `targetNames` in canonical order; `plugin-manifest-authority.ts` detects portable `description`, `homepage`, `repository`, `license`, `keywords` disagreement by stable JSON and errors; `author` is compared per key after canonical validation and merged by first valid contribution. Native author that cannot be represented is retained as provider override with warning. Version must agree among discovered native manifests including missing-versus-present, then validates and seeds baseline rather than a second source version authority. First present manifest description is used if string (including empty string in this branch); otherwise Codex `shortDescription` → `longDescription` nonblank trimmed → selected name. Normalization observations represent actual assignments, not values or runtime semantic proof. Tests `import-manifest-observations.test.ts`, `import-author-observations.test.ts`, `import-metadata-observations.test.ts`, `adopt-manifest-roundtrip.test.ts`.

| Imported input → source field | Selection, conflicts and disposition |
|---|---|
| Manifest name → `skillset.name` | Selected name and possible remap separately observed; actual unchanged Claude source→canonical→selected same-provider rendered equality is only the narrow ADR-0048 D1 positive; remapped/trimmed/default/override cases lack that qualification. |
| Manifest `description` → `skillset.description` | First present provider per above, else Codex short then long then name. Unequal portable native description fails conflict; D2 selection/fallback and D4 unknown fidelity except guarded direct same-provider D1. |
| `author`, Codex `interface.developerName` → `skillset.author` | Valid native authors combine first contribution per key; conflicting value for any shared key fails. If no valid native author, nonblank trimmed developerName is fallback; differing developerName kept native. Unreadable native author retained provider override and warned. D2 normalization/D3 override, no broad identity claim. |
| `homepage`, `repository`, `license`, `keywords` → same source metadata | First present provider order; unequal source JSON fails before lift; source values observed and canonical schema determines valid type. `keywords` also selected for listing from same first provider when it is an all-string array. D2/D4 for semantic fidelity; a malformed native value needs full import validation tracing before claiming preserved or lost. |
| Codex interface `displayName`; Claude/Cursor `displayName` → `listing.display_name` | Codex then Claude then Cursor, nonblank trimmed; provider disagreement on listing display name prevents common lift and retains native override. D2 selected assignment / D3 conflicting native. |
| Codex `shortDescription`/`longDescription` → `listing.summary`/`description` | Summary only if short equals chosen canonical manifest description. Description lifted if summary was selected **or** long equals canonical description. Unequal unlifted values retained in Codex interface override. D2/D3; explicit source-selection rules, not all description fields interchangeable. |
| Codex interface `category`; Codex/Cursor `logo` → listing | Category Codex only; Cursor native category is explicitly not shared authority and remains native. Logo Codex then Cursor. Disagreement for supported shared fields prevents common lift and retains respective override. D2/D3. |
| Codex `brandColor`, `websiteURL`, `privacyPolicyURL`, `termsOfServiceURL`, `composerIcon` → `color`, `website_url`, `privacy_policy_url`, `terms_of_service_url`, `composer_icon` | Nonblank trimmed string, selected Codex only; observations point source/destination; D2 with destination semantics D4 until evidenced. Legacy uppercase `URL` recognized at this native import boundary; modern camel `Url` handling remains provider override/legacy-validation concern, not a generalized case converter. |
| Codex `capabilities`, `defaultPrompt`, `screenshots` → corresponding snake_case listing | Copy only if array and every member is a string; empty array allowed by this reader. Canonical schema requires nonempty elements; no coercion of malformed arrays. D2 for valid data; tested scalar/mixed values survive in copied legacy native manifest and fail the subsequent build; empty-string entries land in canonical listing and fail schema validation after claim. No silent output loss was observed. |
| Unknown/non-source-owned native fields | `importedManifestOverride` preserves native fields except registry-owned component paths; Claude hooks declaration is special-cased. Codex interface preserves unlifted/unequal fields and conflicts. Cursor category/tags retained native and warned. D3; no cross-provider claim. |

## Canonical → plugin manifests

`packages/core/src/render-plugin-manifest.ts`, `agent-plugin-manifest.ts`, `source-author.ts`, `plugin-manifest-identity.ts`; registry schema snapshots, `provider-format-conformance.test.ts` and `render-result-build.test.ts` show shape/loss examples. Below `L` means resolved `readSourceListing`; `M` plugin source metadata; `R` root source metadata; `>` means first nonblank/defined unless stated.

| Output field | Exact derivation and override | Disposition |
|---|---|---|
| Claude/Cursor `name` | Native manifest `name` override > portable `M.manifest.name` > plugin ID; final manifest override merged. | D3 provider-specific identity; never assume display name is namespace. |
| Claude/Cursor `version` | `pluginVersion` forced again after target manifest override. | D2 managed release baseline authority; no arbitrary native override. |
| Claude/Cursor `description` | `L.summary > L.description > M.description > plugin ID`; target manifest override later wins. | D2/D3 fallback/override; not equivalent field semantics. |
| Claude/Cursor `author` | Project plugin author if readable, else root author; Claude allows `name,email,url`, Cursor `name,email`; target override record merges or scalar replaces. | D3; omissions reported by collector including Cursor URL and extension keys as applicable (D5); values replaced by explicit native override are separate. |
| Claude/Cursor `homepage`, `repository`, `license`, `keywords` | M homepage/repository; resolved license manifest value; `L.keywords > M.keywords`; native manifest override may replace each. | D2/D3; source read and native output validity scoped by schema; use actual effective author/manifest for loss diagnostics. |
| Claude `displayName` | `L.display_name`, then `claude.manifest.displayName` override. | D3 native display label, not name identity. |
| Cursor `displayName`, `logo` | portable `M.manifest.displayName/logo > L.display_name/logo`, then `cursor.manifest` override. | D3 native display fields; provider discovery support is separate. |
| Standard Agent Plugins root | name plugin ID; version managed; description `L.summary > L.description > M.description > id`; author plugin > root projected name/email/url; homepage/repository from M, license resolved, keywords `L > M`; fixed `$schema`. | D2 standardized structural serialization, D5 any reported omitted fields, not runtime semantics. Codex manifest cannot override portable root: only reviewed interface/extensions accepted. |

## Canonical → Codex interface and catalog

`renderCodexInterface` base is then overlaid, in order: `codex.interface` > `codex.manifest.interface` > legacy native extension interface > `codex.manifest.extensions.com.openai.interface` (last wins through recursive `mergeRecords`). `renderEffectiveOpenAiInterface` is shared by render and loss collectors; legacy uppercase URL aliases are converted with unequal simultaneous spelling rejected (`render-plugin-manifest.ts:460–482`). Tests `render-agent-plugins-standard.test.ts`, `render-result-build.test.ts`, `openai-marketplace.test.ts`. All rows D2/D3 unless qualified; native target shape and precedence are not blanket D1 behavior.

| Native interface field | Canonical base (before the four overlays) |
|---|---|
| `displayName` | `L.display_name`. |
| `shortDescription` | `L.summary > L.description > M.description > plugin ID`. |
| `longDescription` | `L.description > M.description > L.summary > plugin ID`. |
| `developerName` | plugin author name > root author name > root owner name. |
| `category`, `capabilities` | corresponding `L` field; capabilities array copied. |
| `brandColor` | `codex.color > L.color`. |
| `websiteUrl` | `L.website_url > M.homepage > M.repository` (derived fallback; semantically unknown). |
| `privacyPolicyUrl`, `termsOfServiceUrl` | matching listing snake_case value. |
| `defaultPrompt`, `screenshots` | matching listing array, copied. |
| `composerIcon`, `logo`, `logoDark` | matching listing field. |

`openai-marketplace.ts:renderOpenAiMarketplacePlugin`: local entry version/description/keywords/author/homepage come from rendered local manifest; remote configured corresponding fields override inherited manifest when present. Interface merges generated then configured; legacy `codex.displayName` applies only absent configured `interface.displayName`; configured homepage fills website only absent configured website; category `codex.category > effective interface.category > Other`, applied at both entry/interface. Defaults `AVAILABLE` and `ON_INSTALL`, products uppercased; native source validates local matching path and credentials. Remote interface asset fields are filtered and **D5 loss reported** from actual renderer snapshot (`marketplace-asset-loss.ts`, `marketplace-asset-loss.test.ts`); local assets validated. Local/remote field precedence is native serialization, not proof defaults or remote behavior equal provider runtime. `render-marketplaces.ts` catalog name selected key > root id > root name > `skillset`; catalog interface displayName selected title > root listing display_name > root name > catalog name. Multiple Codex catalogs throw.

## Claude / Cursor marketplace render and adoption

| Field / branch | Current behavior, evidence and disposition |
|---|---|
| Claude catalog `name`, owner, description | `render-marketplaces.ts:432–461`: name selected catalog key; owner projected root owner > author > `{name: root.name > catalogName}`; description emitted only if declared; `metadata.description` declared description > root listing summary > description > root metadata description > fixed default. Root version managed. D2/D3, not inferred equivalence. |
| Claude entry | Plugin id, generated source, description `L.summary > L.description > M.description > id`, version, projected author plugin > root, repository/license/keywords/category/strict then `claude.marketplace` native override. D3; author omitted fields have collector diagnostics; whole-array root overrides change selected projection and are accounted against actual rendered list. |
| Cursor catalog/entry | Generated entry id/source (leading `./` removed)/description fallback, then plugin native marketplace override; root name `root.marketplace.name > root.name > root.id > skillset`, projected owner root owner > author, root metadata description fallback, then root Cursor marketplace override. D3; Cursor owner loses unsupported keys with render result where applicable. |
| Adopt catalog identity/description | `marketplace-adoption.ts`: JSON must be object with string name; name regex lowercase alnum then alnum/dot/underscore/hyphen. Invalid name/no selected plugin/already Claude target return warning, no assignment. Description uses direct `??` nested metadata fallback: direct empty/non-string suppresses fallback; only nonblank string emitted, preserving original spaces. Existing normalizations record selected pointer and fidelity unknown. Tests `marketplace-normalization-evidence.test.ts:56–75,95+`; D2 selection/D4 metadata semantics. |
| Adopt owner | Full-record equality is required to reuse an existing author; unequal same-name owner is stored separately without changing author. Existing explicit conflicting owner is retained with value-free warning. `marketplace-owner-preservation.test.ts`; correction 002e / PR 798. D2 selection/D5 explicit conflict; no provider runtime assertion. |
| Adopt membership | Valid named entries match adopted ID and slug; named unmatched entries are reported as skipped. Nonobject and nameless entries now produce index-based warnings; exact duplicate selected names remain retained. Additional per-entry fields are not all mapped. `marketplace-owner-preservation.test.ts`; fix 002e / PR 798. D5 disclosed omissions/D4 curated fidelity; provider validity of malformed entries is not inferred. |
| Same-key non-Claude catalog collision | Previously overwrote a same-key catalog; fixed in 135c / PR 797 by prewrite key guard and warning. D5 fail-safe preservation; regression tests cover Codex/Cursor collisions and original bytes. |
