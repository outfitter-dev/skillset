import { registerTransformEntry } from "../registry";
import type { TransformEntry } from "../types";
import { projectInstructionsEntry } from "./docs";
import {
  dynamicArgumentsEntry,
  dynamicEnvSubstitutionEntry,
  dynamicPositionalEntry,
  dynamicPreResolutionEntry,
} from "./dynamics";
import { projectConfigDirEntry, skillsDirEntry, userConfigDirEntry } from "./paths";
import { fileMentionEntry } from "./references";
import { subagentInvokeEntry } from "./subagents";

/** Built-in entries, registered on package import. */
export const builtinTransformEntries: readonly TransformEntry[] = [
  projectConfigDirEntry,
  userConfigDirEntry,
  skillsDirEntry,
  projectInstructionsEntry,
  subagentInvokeEntry,
  dynamicArgumentsEntry,
  dynamicPositionalEntry,
  dynamicEnvSubstitutionEntry,
  dynamicPreResolutionEntry,
  fileMentionEntry,
];

for (const entry of builtinTransformEntries) {
  registerTransformEntry(entry);
}

export {
  dynamicArgumentsEntry,
  dynamicEnvSubstitutionEntry,
  dynamicPositionalEntry,
  dynamicPreResolutionEntry,
  fileMentionEntry,
  projectConfigDirEntry,
  projectInstructionsEntry,
  skillsDirEntry,
  subagentInvokeEntry,
  userConfigDirEntry,
};
