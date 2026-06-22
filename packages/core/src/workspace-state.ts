import { join } from "node:path";

export const WORKSPACE_CHANGES_DIR = "changes";

export function workspaceChangesDir(sourceDir?: string): string {
  const root = sourceDir ?? ".skillset";
  const path = root === "." ? join("skillset", WORKSPACE_CHANGES_DIR) : join(root, WORKSPACE_CHANGES_DIR);
  return path.replaceAll("\\", "/");
}

export function workspaceChangeFile(sourceDir: string | undefined, file: string): string {
  return join(workspaceChangesDir(sourceDir), file).replaceAll("\\", "/");
}
