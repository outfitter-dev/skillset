export { lowerTransform, recognizeTransforms } from "./engine";
export {
  builtinTransformEntries,
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
} from "./entries";
export { listTransformEntries, registerTransformEntry, transformEntries } from "./registry";
export type {
  TransformDialect,
  TransformEntry,
  TransformEvidence,
  TransformForm,
  TransformMatch,
  TransformTarget,
} from "./types";
