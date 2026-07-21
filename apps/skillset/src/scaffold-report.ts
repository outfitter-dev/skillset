export type ScaffoldFileState = "create" | "exists" | "update";

const SCAFFOLD_FILE_MARKERS: Readonly<Record<ScaffoldFileState, string>> = {
  create: "+",
  exists: "=",
  update: "~",
};

export const formatScaffoldFileLine = (
  path: string,
  state: ScaffoldFileState
): string => `  ${SCAFFOLD_FILE_MARKERS[state]} ${path}`;

export const scaffoldWriteReason = (
  write: boolean,
  written = write
): "blocked before write" | "write confirmation required" | "written" => {
  if (!write) {
    return "write confirmation required";
  }
  return written ? "written" : "blocked before write";
};

export const formatScaffoldNextStep = (command: string): string =>
  `  next: ${command}`;

export const formatScaffoldWriteHint = (
  invocation: string,
  subject: string
): string => `skillset: rerun ${invocation} to write ${subject}`;
