import { chmod, stat } from "node:fs/promises";

import type { GeneratedFileMode, RenderedFile } from "./types";

export const EXECUTABLE_OUTPUT_MODE = 0o755;
export const REGULAR_OUTPUT_MODE = 0o644;

/** Normalize source permissions to the portable generated-file contract. */
export function normalizeGeneratedFileMode(mode: number): GeneratedFileMode {
  return (mode & 0o111) === 0 ? REGULAR_OUTPUT_MODE : EXECUTABLE_OUTPUT_MODE;
}

/** Windows does not expose a portable chmod contract for generated files. */
export function supportsGeneratedFileModes(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform !== "win32";
}

export function generatedFileModeMatches(
  actualMode: number,
  expectedMode: GeneratedFileMode,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!supportsGeneratedFileModes(platform)) return true;
  return (actualMode & 0o777) === expectedMode;
}

export async function generatedFileOnDiskMatchesMode(
  path: string,
  file: RenderedFile
): Promise<boolean> {
  if (!supportsGeneratedFileModes()) return true;
  return generatedFileModeMatches((await stat(path)).mode, file.mode);
}

export async function applyGeneratedFileMode(
  path: string,
  file: RenderedFile
): Promise<void> {
  if (!supportsGeneratedFileModes()) return;
  await chmod(path, file.mode);
}

export function formatGeneratedFileMode(mode: GeneratedFileMode): "0644" | "0755" {
  return mode === EXECUTABLE_OUTPUT_MODE ? "0755" : "0644";
}
