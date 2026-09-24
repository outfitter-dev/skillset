import { rm } from "node:fs/promises";

type RemoveTemporaryRoot = (
  path: string,
  options: { readonly force: true; readonly recursive: true }
) => Promise<void>;

/** Cleanup must not replace a completed operation or its primary failure. */
export async function removeTemporaryRootBestEffort(
  path: string,
  remove: RemoveTemporaryRoot = rm,
  warn: (message: string) => void = (message) => process.emitWarning(message)
): Promise<boolean> {
  try {
    await remove(path, { force: true, recursive: true });
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      warn(`skillset: could not remove temporary root ${path}: ${detail}`);
    } catch {
      // A broken warning sink must not replace the primary outcome either.
    }
    return false;
  }
}
