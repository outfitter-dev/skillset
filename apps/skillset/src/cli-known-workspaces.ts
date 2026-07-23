import { recordKnownSkillsetWorkspace } from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { resolveWorkspaceRegistrationPolicy } from "./verification-sandbox";

export async function rememberKnownSkillsetWorkspace(
  rootPath: string,
  options: SkillsetOptions,
  quiet = false
): Promise<void> {
  const policy = await resolveWorkspaceRegistrationPolicy();
  if (policy === "suppressed") return;
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
