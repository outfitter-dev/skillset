import { isTargetName, TARGET_LIST_TEXT } from "@skillset/core";
import type { TargetName } from "@skillset/core/internal/types";

export type ImportKind = "plugin" | "plugins" | "skill" | "skills";
export type ImportProvider =
  | "agents"
  | TargetName
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
  if (value === "agents" || isTargetName(value) || value === "skillset") {
    return value;
  }
  throw new Error(
    `skillset: expected --from ${TARGET_LIST_TEXT}; also agents or skillset`
  );
};
