/**
 * Environment for spawning git against an explicit repository path.
 *
 * Git hooks (pre-push, pre-commit) run with `GIT_DIR` — and sometimes
 * `GIT_WORK_TREE` and `GIT_INDEX_FILE` — exported, and those variables
 * override `git -C <path>` repository discovery. Any git subprocess spawned
 * from inside a hook would silently operate on the hook's repository instead
 * of the intended one; this is how test fixtures once rewrote the real repo's
 * `.git/config` (setting `core.bare = true`) when the test suite ran under a
 * lefthook pre-push gate. Strip repository-targeting variables so explicit
 * paths always win.
 */
export function gitSafeEnv(
  sourceEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined || isGitRepositoryTargetingKey(key)) continue;
    env[key] = value;
  }
  return env;
}

/**
 * Sanitized environment for read-only Git inspections.
 *
 * Sets `GIT_OPTIONAL_LOCKS=0` so status and similar probes do not contend on
 * Git's optional index lock. Do not use this for mutation commands; it does
 * not authorize bypassing a required lock.
 */
export function gitReadOnlyEnv(
  sourceEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  return { ...gitSafeEnv(sourceEnv), GIT_OPTIONAL_LOCKS: "0" };
}

export function gitRepositoryTargetingKeys(
  env: Record<string, string | undefined>
): readonly string[] {
  return Object.keys(env)
    .filter((key) => env[key] !== undefined && isGitRepositoryTargetingKey(key))
    .sort();
}

function isGitRepositoryTargetingKey(key: string): boolean {
  return (
    key === "GIT_DIR" ||
    key === "GIT_WORK_TREE" ||
    key === "GIT_INDEX_FILE" ||
    key === "GIT_OBJECT_DIRECTORY" ||
    key === "GIT_COMMON_DIR" ||
    key === "GIT_NAMESPACE" ||
    key.startsWith("GIT_ALTERNATE_OBJECT")
  );
}
