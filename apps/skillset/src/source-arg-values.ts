export type ImportKind = "plugin" | "plugins" | "skill" | "skills";
export type ImportProvider =
  | "agents"
  | "claude"
  | "codex"
  | "cursor"
  | "skillset";

export const readImportKind = (value: string): ImportKind => {
  if (
    value === "skill" ||
    value === "skills" ||
    value === "plugin" ||
    value === "plugins"
  ) {
    return value;
  }
  throw new Error(
    "skillset: expected --kind skill, skills, plugin, or plugins"
  );
};

export const readImportProvider = (value: string): ImportProvider => {
  if (
    value === "agents" ||
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "skillset"
  ) {
    return value;
  }
  throw new Error(
    "skillset: expected --from claude, codex, cursor, agents, or skillset"
  );
};
