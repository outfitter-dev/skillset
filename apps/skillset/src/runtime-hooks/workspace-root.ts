import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/** Discover only within the event's repository; never consult Git config or home contents. */
export async function discoverHookWorkspace(
  stdinText: string | undefined,
  homePath = homedir()
): Promise<string | undefined> {
  try {
    const event = JSON.parse(stdinText ?? "null");
    if (event?.hook_event_name !== "PreToolUse" || typeof event.cwd !== "string" || !isAbsolute(event.cwd)) return undefined;
    let current = await realpath(event.cwd);
    if (!(await lstat(current)).isDirectory()) return undefined;
    const home = await realpath(homePath);
    while (current !== home && dirname(current) !== current) {
      const config = await entry(join(current, "skillset.yaml"));
      const source = await entry(join(current, ".skillset"));
      // A suspicious marker must not fall through to a parent workspace.
      if (config !== undefined && !config.isFile()) return undefined;
      if (source !== undefined && !source.isDirectory()) return undefined;
      if (config !== undefined || source !== undefined) return current;
      if (await entry(join(current, ".git")) !== undefined) return undefined;
      current = dirname(current);
    }
  } catch {
    // Missing, unreadable or malformed input cannot authorize an edit denial.
  }
  return undefined;
}

async function entry(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
