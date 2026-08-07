import { TARGET_NAMES } from "./contracts";
import type {
  SkillsetSourceReferenceDescriptor,
  SkillsetSourceReferenceExclusion,
} from "./types";

const targetOverridePaths = TARGET_NAMES.map((target) => `${target}.skills[*]`);
const targetRunScriptPaths = TARGET_NAMES.map((target) => `${target}.run.script`);

function freezeDescriptor(
  descriptor: SkillsetSourceReferenceDescriptor
): SkillsetSourceReferenceDescriptor {
  return Object.freeze({
    ...descriptor,
    contracts: Object.freeze([...descriptor.contracts]),
    notes: Object.freeze([...descriptor.notes]),
    pathPatterns: Object.freeze([...descriptor.pathPatterns]),
  });
}

function freezeExclusion(
  exclusion: SkillsetSourceReferenceExclusion
): SkillsetSourceReferenceExclusion {
  return Object.freeze({ ...exclusion });
}

/**
 * Declarative inventory of authored Skillset reference fields.
 *
 * These descriptors intentionally identify structural source fields only.
 * Core owns resolving a value against a workspace graph, choosing a rename
 * target, and applying a mutation plan.
 */
export const skillsetSourceReferenceDescriptors = Object.freeze([
  freezeDescriptor({
    contracts: ["agent-frontmatter"],
    id: "agent-skills",
    kind: "source-unit-identity",
    mutationPolicy: "rewrite",
    notes: [
      "Includes shared skills and provider-specific overrides.",
      "Schema records identities only; Core resolves standalone and qualified plugin selectors.",
      "Provider-specific { native: <name> } entries are external identities and remain unchanged during managed skill renames.",
    ],
    pathPatterns: ["skills[*]", ...targetOverridePaths],
    scope: "agent-visible-skills",
  }),
  freezeDescriptor({
    contracts: ["skill-frontmatter"],
    id: "skill-resource-source",
    kind: "source-path",
    mutationPolicy: "rewrite",
    notes: [
      "String resource declarations are source-path shorthand.",
      "Object declarations use from as the authored source path.",
    ],
    pathPatterns: [
      "resources",
      "resources[*]",
      "resources[*].from",
      "resources.<group>",
      "resources.<group>[*]",
      "resources.<group>[*].from",
    ],
    scope: "skill-resource",
  }),
  freezeDescriptor({
    contracts: ["skill-frontmatter"],
    id: "skill-resource-destination",
    kind: "generated-destination",
    mutationPolicy: "warning-only",
    notes: [
      "Only explicit resource declaration destinations are included.",
      "A destination can be an intentional stable output name, so Core must not rewrite it without an explicit policy.",
    ],
    pathPatterns: ["resources[*].to", "resources.<group>[*].to"],
    scope: "skill-resource",
  }),
  freezeDescriptor({
    contracts: ["agent-frontmatter", "skill-frontmatter"],
    id: "hook-attachment",
    kind: "source-unit-identity",
    mutationPolicy: "rewrite",
    notes: [
      "String attachment entries are hook identity shorthand.",
      "Object attachment entries store the identity in hook.",
    ],
    pathPatterns: ["hooks.<event>[*]", "hooks.<event>[*].hook"],
    scope: "owner-visible-hooks",
  }),
  freezeDescriptor({
    contracts: ["adaptive-hook"],
    id: "adaptive-hook-run-script",
    kind: "source-path",
    mutationPolicy: "rewrite",
    notes: [
      "Includes shared run.script and provider-specific run.script overrides.",
      "Schema validates the allowed authored path grammar; Core resolves it against the hook source layout.",
    ],
    pathPatterns: ["run.script", ...targetRunScriptPaths],
    scope: "adaptive-hook-runtime",
  }),
  freezeDescriptor({
    contracts: ["skill-eval"],
    id: "skill-eval-skill-name",
    kind: "source-unit-identity",
    mutationPolicy: "rewrite",
    notes: [
      "The eval document identifies its owning skill.",
    ],
    pathPatterns: ["skill_name"],
    scope: "skill-local-eval",
  }),
  freezeDescriptor({
    contracts: ["skill-eval"],
    id: "skill-eval-file",
    kind: "source-path",
    mutationPolicy: "rewrite",
    notes: [
      "Eval files are authored relative to the owning skill root.",
    ],
    pathPatterns: ["evals[*].files[*]"],
    scope: "skill-local-eval",
  }),
  freezeDescriptor({
    contracts: [
      "workspace-config",
      "root-source-manifest",
      "plugin-config",
      "skill-frontmatter",
    ],
    id: "internal-plugin-dependency",
    kind: "source-unit-identity",
    mutationPolicy: "preserve",
    notes: [
      "This describes plugin dependency identities when Core determines that a dependency is local to the workspace.",
      "External dependency values and plugin-directory rename behavior are outside this descriptor API and must not be rewritten by default.",
    ],
    pathPatterns: ["dependencies.plugins[*]", "dependencies.plugins[*].name", "dependencies.plugins[*].plugin"],
    scope: "workspace-or-plugin-config",
  }),
] as const satisfies readonly SkillsetSourceReferenceDescriptor[]);

export type SkillsetSourceReferenceDescriptorId =
  (typeof skillsetSourceReferenceDescriptors)[number]["id"];

export function getSkillsetSourceReferenceDescriptor(
  id: SkillsetSourceReferenceDescriptorId
): (typeof skillsetSourceReferenceDescriptors)[number] {
  const descriptor = skillsetSourceReferenceDescriptors.find(
    (candidate) => candidate.id === id
  );
  if (descriptor === undefined) {
    throw new Error(`Unknown Skillset source reference descriptor: ${id}`);
  }
  return descriptor;
}

/** Source surfaces intentionally outside the first reference and rename contract. */
export const skillsetSourceReferenceExclusions = Object.freeze([
  freezeExclusion({
    id: "provider-native-opaque-values",
    reason: "Provider-native configuration is structurally accepted but has no shared Skillset reference grammar.",
  }),
  freezeExclusion({
    id: "unmarked-prose-and-markdown",
    reason: "Unmarked prose, Markdown links, and code spans are not structured references; marked {{@...}} tokens remain in the first reference contract.",
  }),
  freezeExclusion({
    id: "append-only-history",
    reason: "Change, release, and ledger history preserve provenance rather than acting as mutable source aliases.",
  }),
  freezeExclusion({
    id: "workspace-test-declarations",
    reason: "Workspace test selectors and activation paths are test contracts, not part of the first source rename mutation scope.",
  }),
  freezeExclusion({
    id: "plugin-rename",
    reason: "Plugin-directory and plugin-identity rename behavior requires a separate contract; dependency identities remain preserve-only here.",
  }),
] as const satisfies readonly SkillsetSourceReferenceExclusion[]);
