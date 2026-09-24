import { compareStrings } from "./path";
import type {
  InternalUseConfig,
  ProjectDraftPolicy,
  SourcePlugin,
} from "./types";

export interface InternalUseDecision {
  readonly draftPolicy?: ProjectDraftPolicy;
  readonly pluginId: string;
  readonly rule: string;
  readonly selected: boolean;
  readonly skillId?: string;
  readonly status?: "draft" | "live";
}

export interface ResolvedInternalUseSelection {
  readonly decisions: readonly InternalUseDecision[];
  readonly pluginIds: readonly string[];
  readonly drafts: readonly { readonly pluginId: string; readonly skillId: string }[];
  readonly skills: readonly { readonly pluginId: string; readonly skillId: string }[];
}

interface SelectorResolution {
  readonly excluded: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  readonly ruleFor: (id: string) => string;
}

export function resolveInternalUseSelection(
  config: InternalUseConfig,
  plugins: readonly SourcePlugin[]
): ResolvedInternalUseSelection {
  const pluginIds = plugins.map((plugin) => plugin.id).sort(compareStrings);
  const pluginsResolution = resolveSelector(
    config.plugins,
    pluginIds,
    "plugins.internal_use.plugins"
  );
  validatePluginKeys(config.skills, pluginIds, "skills");
  validatePluginKeys(config.drafts, pluginIds, "drafts");

  const decisions: InternalUseDecision[] = [];
  const selectedPluginIds: string[] = [];
  const selectedSkills: { pluginId: string; skillId: string }[] = [];
  const selectedDrafts: { pluginId: string; skillId: string }[] = [];

  for (const plugin of [...plugins].sort((left, right) => compareStrings(left.id, right.id))) {
    const pluginExcluded = pluginsResolution.excluded.has(plugin.id);
    const pluginSelected = pluginsResolution.selected.has(plugin.id) && !pluginExcluded;
    if (pluginSelected) selectedPluginIds.push(plugin.id);
    decisions.push({
      pluginId: plugin.id,
      rule: pluginsResolution.ruleFor(plugin.id),
      selected: pluginSelected,
    });

    const inventory = plugin.discoveredSkills ?? plugin.skills;
    const liveIds = uniqueIds(inventory.filter((skill) => skill.status !== "draft"));
    const draftIds = uniqueIds(inventory.filter((skill) => skill.status === "draft"));
    const skillsResolution = resolveSelector(
      config.skills[plugin.id] ?? false,
      liveIds,
      `plugins.internal_use.skills.${plugin.id}`
    );
    const draftPolicy = config.drafts[plugin.id];
    const appliedDraftPolicy =
      draftPolicy === "only" || draftPolicy === "override"
        ? draftPolicy
        : undefined;
    const draftsResolution = resolveSelector(
      typeof draftPolicy === "string" ? false : (draftPolicy ?? false),
      draftIds,
      `plugins.internal_use.drafts.${plugin.id}`
    );
    const selectedLiveIds = new Set<string>();

    for (const skillId of liveIds) {
      const explicitlyExcluded = skillsResolution.excluded.has(skillId);
      const selected =
        !pluginExcluded &&
        !explicitlyExcluded &&
        (pluginSelected || skillsResolution.selected.has(skillId));
      const rule = pluginExcluded
        ? `plugins.internal_use.plugins: !${plugin.id}`
        : explicitlyExcluded || skillsResolution.selected.has(skillId)
          ? skillsResolution.ruleFor(skillId)
          : pluginSelected
            ? pluginsResolution.ruleFor(plugin.id)
            : `plugins.internal_use: omitted`;
      decisions.push({ pluginId: plugin.id, rule, selected, skillId, status: "live" });
      if (selected) selectedLiveIds.add(skillId);
    }

    for (const skillId of draftIds) {
      const hasShippedSibling = liveIds.includes(skillId);
      const shippedSiblingSelected = selectedLiveIds.has(skillId);
      const shippedSiblingExcluded = skillsResolution.excluded.has(skillId);
      const selectedByDraftPolicy = appliedDraftPolicy === undefined
        ? draftPolicy === undefined
          ? hasShippedSibling && shippedSiblingSelected
          : draftsResolution.selected.has(skillId)
        : hasShippedSibling
          ? shippedSiblingSelected
          : pluginSelected;
      const selected =
        !pluginExcluded &&
        !draftsResolution.excluded.has(skillId) &&
        selectedByDraftPolicy &&
        !shippedSiblingExcluded;
      const rule = pluginExcluded
        ? `plugins.internal_use.plugins: !${plugin.id}`
        : hasShippedSibling &&
            (shippedSiblingExcluded || (draftPolicy === undefined && !shippedSiblingSelected))
          ? decisions.find(
              (decision) =>
                decision.pluginId === plugin.id &&
                decision.skillId === skillId &&
                decision.status === "live"
            )?.rule ?? draftsResolution.ruleFor(skillId)
          : appliedDraftPolicy !== undefined && hasShippedSibling
            ? decisions.find(
                (decision) =>
                  decision.pluginId === plugin.id &&
                  decision.skillId === skillId &&
                  decision.status === "live"
              )?.rule ?? pluginsResolution.ruleFor(plugin.id)
          : appliedDraftPolicy !== undefined
            ? pluginsResolution.ruleFor(plugin.id)
          : draftPolicy === undefined && hasShippedSibling
            ? `plugins.internal_use.drafts.${plugin.id}: omitted (side-by-side)`
            : draftPolicy === false
              ? `plugins.internal_use.drafts.${plugin.id}: false`
              : draftsResolution.ruleFor(skillId);
      decisions.push({
        ...(appliedDraftPolicy === undefined
          ? {}
          : { draftPolicy: appliedDraftPolicy }),
        pluginId: plugin.id,
        rule,
        selected,
        skillId,
        status: "draft",
      });
      if (selected) selectedDrafts.push({ pluginId: plugin.id, skillId });
    }

    const emittedLiveIds = appliedDraftPolicy === "only"
      ? []
      : appliedDraftPolicy === "override"
        ? [...selectedLiveIds].filter((skillId) => !draftIds.includes(skillId))
        : [...selectedLiveIds];
    selectedSkills.push(
      ...emittedLiveIds.map((skillId) => ({ pluginId: plugin.id, skillId }))
    );
  }

  return {
    decisions,
    drafts: selectedDrafts,
    pluginIds: selectedPluginIds,
    skills: selectedSkills,
  };
}

function resolveSelector(
  selector: InternalUseConfig["plugins"],
  knownIds: readonly string[],
  label: string
): SelectorResolution {
  const known = new Set(knownIds);
  if (selector === true) {
    const selected = new Set(knownIds);
    return {
      excluded: new Set(),
      selected,
      ruleFor: (id) => selected.has(id) ? `${label}: true` : `${label}: omitted`,
    };
  }
  if (selector === false) {
    return {
      excluded: new Set(),
      selected: new Set(),
      ruleFor: () => `${label}: omitted`,
    };
  }

  const positive = new Set<string>();
  const negative = new Set<string>();
  for (const raw of selector) {
    const excluded = raw.startsWith("!");
    const id = excluded ? raw.slice(1) : raw;
    if (id.length === 0 || !known.has(id)) {
      throw new Error(
        `skillset: ${label} names unknown id ${JSON.stringify(id)}; known ids: ${knownIds.join(", ") || "none"}`
      );
    }
    (excluded ? negative : positive).add(id);
  }
  const contradictions = [...positive].filter((id) => negative.has(id)).sort(compareStrings);
  if (contradictions.length > 0) {
    throw new Error(
      `skillset: ${label} selects and excludes ${contradictions.join(", ")}`
    );
  }
  const negativeOnly = positive.size === 0 && negative.size > 0;
  const selected = negativeOnly ? new Set(knownIds) : positive;
  return {
    excluded: negative,
    selected,
    ruleFor: (id) => negative.has(id)
      ? `${label}: !${id}`
      : selected.has(id)
        ? `${label}: ${negativeOnly ? `all except exclusions` : id}`
        : `${label}: omitted`,
  };
}

function validatePluginKeys(
  selections: Readonly<Record<string, unknown>>,
  pluginIds: readonly string[],
  field: "drafts" | "skills"
): void {
  const known = new Set(pluginIds);
  for (const pluginId of Object.keys(selections).sort(compareStrings)) {
    if (known.has(pluginId)) continue;
    throw new Error(
      `skillset: plugins.internal_use.${field} names unknown plugin ${JSON.stringify(pluginId)}; known plugins: ${pluginIds.join(", ") || "none"}`
    );
  }
}

function uniqueIds(skills: readonly { readonly id: string }[]): readonly string[] {
  return [...new Set(skills.map((skill) => skill.id))].sort(compareStrings);
}
