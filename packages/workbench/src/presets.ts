import type {
  WorkbenchDiagnostic,
  WorkbenchDiagnosticSelection,
  WorkbenchPreset,
  WorkbenchPresetId,
  WorkbenchScope,
} from "./types";

export const WORKBENCH_PRESET_IDS = Object.freeze(["standard", "strict"] as const) satisfies readonly WorkbenchPresetId[];

export const WORKBENCH_SCOPE_IDS = Object.freeze([
  "generated",
  "provider",
  "release",
  "resource",
  "runtime",
  "source",
  "workspace",
] as const) satisfies readonly WorkbenchScope[];

const workbenchPresets: readonly WorkbenchPreset[] = [
  {
    description: "Default correctness checks for authored Skillset source and workspace state.",
    id: "standard",
    ruleLevels: ["standard"],
    scopes: WORKBENCH_SCOPE_IDS,
  },
  {
    description: "Standard checks plus stricter convention checks.",
    id: "strict",
    ruleLevels: ["standard", "strict"],
    scopes: WORKBENCH_SCOPE_IDS,
  },
];

export function listWorkbenchPresets(): readonly WorkbenchPreset[] {
  return workbenchPresets.map(clonePreset);
}

export function getWorkbenchPreset(id: WorkbenchPresetId): WorkbenchPreset {
  const found = workbenchPresets.find((preset) => preset.id === id);
  if (found === undefined) throw new Error(`unknown workbench preset: ${id}`);
  return clonePreset(found);
}

export function parseWorkbenchPresetId(id: string): WorkbenchPresetId {
  if (!isWorkbenchPresetId(id)) throw new Error(`unknown workbench preset: ${id}`);
  return id;
}

export function selectWorkbenchDiagnostics(
  diagnostics: readonly WorkbenchDiagnostic[],
  selection: WorkbenchDiagnosticSelection = {}
): readonly WorkbenchDiagnostic[] {
  const preset = getWorkbenchPreset(parseWorkbenchPresetId(selection.preset ?? "standard"));
  const allowedRuleLevels = new Set(preset.ruleLevels);
  const allowedScopes = new Set((selection.scopes ?? preset.scopes).map(parseWorkbenchScope));
  const allowedRuleIds = selection.ruleIds === undefined ? undefined : new Set(selection.ruleIds);

  return diagnostics.filter((diagnostic) => {
    if (!allowedScopes.has(diagnostic.scope)) return false;
    if (allowedRuleIds !== undefined && !allowedRuleIds.has(diagnostic.ruleId)) return false;
    if (allowedRuleIds === undefined && !allowedRuleLevels.has(diagnostic.ruleLevel ?? "standard")) return false;
    return true;
  });
}

export function isWorkbenchPresetId(id: string): id is WorkbenchPresetId {
  return WORKBENCH_PRESET_IDS.includes(id as WorkbenchPresetId);
}

export function isWorkbenchScope(scope: string): scope is WorkbenchScope {
  return WORKBENCH_SCOPE_IDS.includes(scope as WorkbenchScope);
}

export function parseWorkbenchScope(scope: string): WorkbenchScope {
  if (!isWorkbenchScope(scope)) throw new Error(`unknown workbench scope: ${scope}`);
  return scope;
}

function clonePreset(preset: WorkbenchPreset): WorkbenchPreset {
  return {
    description: preset.description,
    id: preset.id,
    ruleLevels: [...preset.ruleLevels],
    scopes: [...preset.scopes],
  };
}
