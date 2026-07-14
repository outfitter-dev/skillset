import { recordKnownSkillsetWorkspace } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

export async function rememberKnownSkillsetWorkspace(
  rootPath: string,
  options: SkillsetOptions,
  quiet = false
): Promise<void> {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.XDG_CONFIG_HOME === undefined
  ) {
    return;
  }
  try {
    await recordKnownSkillsetWorkspace(rootPath, options.xdg);
  } catch (error) {
    if (quiet) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `  warning: could not update known Skillsets index: ${message}`
    );
  }
}
