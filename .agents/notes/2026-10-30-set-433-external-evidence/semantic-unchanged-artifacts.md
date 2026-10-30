# SET-433: source comparison for 83 repeat-identical projection files

Static comparison of the 83 files that were byte-identical between compiler captures `364f7235b1bedab3a6543af4f641e95ff1c1bcb8` and `8a5d5b282ade4f5aa2fa8e506fe1297890bce037`. This tests those files against each pinned `original.tar`, not merely against each other. The companion `/private/tmp/set433-semantic-unchanged-artifacts.json` contains **one entry per file**: fixture/output path, explicit source path and role, output/source SHA-256, source tar and pinned Git modes where applicable, byte or parsed YAML/body/JSON comparisons, exact added/removed/changed fields, classification, disposition and caveat. No source path is unclassified in this bounded set. The five changed/added before/after artifacts are separately reviewed in `set433-semantic-changed-artifacts.md`; blocked fixtures have no selected projection.

| Fixture | Count | Original-relative classification |
|---|---:|---|
| Browserbase | 6 | Five source-byte-preserved; one generated standard plugin manifest. |
| Review-loop | 5 | Three source-byte-preserved; one generated standard manifest; one derived license notice. |
| Cursor browser motion | 8 | One source-byte-preserved README; two derived license notices; two structured MCP projections; one native plugin manifest; one standard plugin manifest; one skill with source fields/body preserved plus metadata/license. |
| Matt Pocock skills | 64 | 28 source-byte-preserved; 34 skills preserve all original parsed frontmatter fields and exact body with additional metadata; one Claude native manifest differs; one standard manifest generated. |
| **Total** | **83** | **37 byte-preserved; 35 source fields and body preserved; 4 generated standard manifests; 3 derived license notices; 2 structured MCP projections; 1 native Cursor manifest; 1 native Claude manifest.** |

## Specific material differences and verdicts

### MIT notices in Cursor selected output — D5 concrete source-content loss

The pinned root `LICENSE` contains the full MIT text and `Copyright (c) 2026 Browser Motion Proof contributors`. Neither selected output `LICENSE.txt` nor `skills/browser-motion-proof/LICENSE.txt` contains that text or copyright; both instead contain a generated short SPDX identification and a link to canonical terms. The original root `LICENSE` is not present elsewhere in the eight-file projection, and a content search of that projection finds neither the original copyright nor the permission notice. The original archive still retains the file. The source string `MIT` is retained in plugin and skill metadata, but is not a copy of the original notice.

The [SPDX MIT text](https://spdx.org/licenses/MIT.html) states that the copyright and permission notice must be included in copies or substantial portions. This report establishes precisely what is absent from the selected artifact; it does not make a legal conclusion about any distribution. The smallest follow-up is to preserve the authored license text and attribution when source `LICENSE` and SPDX metadata coexist, or make any intentional omission visible for review; test both plugin and inherited skill outputs, source original preservation and source/metadata conflict. Owner: license/import provenance and distribution; this is not resolved by identifying the license name.

Review-loop's generated `LICENSE.txt` is also a short SPDX notice derived from its plugin manifest's `license: MIT`; no `LICENSE`, `LICENSE.md` or `LICENSE.txt` file exists in the pinned original tar. Do not attribute Cursor's concrete dropped copyright text to review-loop without such a source file.

### Cursor native MCP command points to an absent selected file — D5 dependency gap

Original `mcp.json` declares `browser-motion-proof` with command `node` and args `["server/dist/index.js"]`. Output native `.cursor-plugin/mcp.json` retains those fields and adds `type: "stdio"`; generated root standard `mcp.json` additionally contains its Agent Plugins `$schema`. Output `.cursor-plugin/plugin.json` retains the original fields and adds `skills: "./skills/"` and `mcpServers: "./.cursor-plugin/mcp.json"`. [Cursor's plugin reference](https://cursor.com/docs/reference/plugins#plugin-component-discovery) says an explicit component path replaces default discovery, and [its MCP section](https://cursor.com/docs/reference/plugins#mcp-servers) distinguishes Cursor's inferred transport from the standard representation.

`server/dist/index.js` exists in original tar, but is absent from the eight-file output, as the fixture's original-only report also records. Therefore the selected package cannot supply the referenced relative entrypoint as captured; this is an output/dependency observation, not a claim about how `node` resolves or what a provider actually does. SET-439 owns dependency/curation; smallest follow-up is to record and preserve or explicitly block the reachable local MCP entrypoint and inspect its own necessary resources, with a targeted selected-package test. Do not infer the full dependency graph from this one reference.

### Matt Pocock native manifest and generated identity — D4 scope / D5 unaccounted inventory difference

Pinned `.claude-plugin/plugin.json` explicitly lists 17 nested skill paths; output replaces that list with `skills: "./skills/"`, adds fallback `description: "mattpocock-skills"` and `version: "0.1.0"`, and emits 34 flattened immediate skill directories. All 17 originally listed leaf IDs are present; the other 17 output IDs are listed in the JSON delta and manifest (including deprecated and in-progress source locations). This is a real declared-versus-output inventory difference, but not proof that the original runtime loaded exactly 17: [Claude's reference](https://code.claude.com/docs/en/plugins-reference#how-each-key-combines-with-its-default-location) says manifest `skills` adds to its default scan, and the source repository also has a default `skills/` tree. Exact nested original discovery and runtime activation remain unproven.

The standard `plugin.json` likewise contains generated name, fallback description/version and `$schema`, and omits Claude-specific `skills` declarations. SET-439 owns source curation and dependency boundaries; smallest follow-up is to classify the original explicit references **and** documented default discovery separately, then ensure any emitted extra scope has explicit review/reporting rather than assuming the 17-item declaration is an exclusive provider list. Do not call all 34 semantically equivalent based on filenames or before/after byte identity.

### 35 skill frontmatter rewrites — D2/D3 with exact local controls

For each of the 34 Matt Pocock `SKILL.md` files, the JSON manifest names the unique original nested `skills/<group>/<id>/SKILL.md`; output uses flattened `skills/<id>/SKILL.md`. PyYAML parsing found every original frontmatter field equal to its corresponding output field (including native `disable-model-invocation` and `argument-hint` where present), and each Markdown body byte-identical. Output adds `metadata.skillset.schema: "1"` and `metadata.version: "0.1.0"`; serialization reorders/quotes YAML. Cursor's one skill likewise preserves all original fields and body, adds version/schema metadata and `license: MIT`. This is field/body evidence for those 35 specific files, not a blanket runtime or provider policy equivalence. The exact per-file keys and deltas are recorded in JSON.

### Standard wrapper manifests and copied files

Browserbase, review-loop and Cursor generated root `plugin.json` each contain all source manifest fields with equal parsed values and add the Agent Plugins `$schema`; Matt's additionally uses the fallback fields and omits the native skill path list described above. Standard representation is D2, not provider activation evidence.

The 37 byte-preserved files have explicit original paths and matching SHA-256 values. For these, 29 source files are Git `100644` → output `0644`, and eight are Git `100755` → output `0755`. Original tar headers sometimes carry group-write bits (`0664`/`0775`), so tar filesystem-mode identity is not claimed; output matches pinned Git executable intent. Copied file bytes do not prove referenced tools or dependencies exist or execute.

## Provenance and evidence limits

The original inputs come from the retained fixture-specific `original.tar` at the after capture; `provenance.json` records the exact seven refs and common fixture manifest hash `18086bcdd282790fa62ac1215d366dd1ce370312821df27e0226f9e2e6439814`. Git modes came from read-only `git ls-tree` on those exact pinned fixture refs. Skill mapping uses exact relative source path or a unique `<skill-id>/<relative-file>` suffix under original `skills/`; JSON retains candidate paths so the mapping can be audited. Counts cover the selected 83 files only; original-only material and whole-fixture dependency closure are not included. No external provider was executed and source tar files were not edited.

Local working evidence: `/private/tmp/set433-semantic-unchanged-artifacts.json`, `/private/tmp/set433-classify-available.py`, `/private/tmp/set433-classify-available-final.py`, `/private/tmp/set433-external-8a5d-a/`; these are temporary paths. The owner's ignored `.skillset/cache/evidence/set433-8a5d/raw-captures.tar.gz` retains the A/B/C capture but is not a portable publication artifact; retain a durable copy and hash before external acceptance.
