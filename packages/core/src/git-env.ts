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

// Repository-local overrides from `git rev-parse --local-env-vars`, plus
// `GIT_NAMESPACE`. The `GIT_CONFIG*` entries that command also lists are left
// alone: test sandboxes inject Git config through them on purpose, and callers
// that must refuse injected config strip it themselves.
const GIT_REPOSITORY_TARGETING_KEYS = new Set([
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
]);

function isGitRepositoryTargetingKey(key: string): boolean {
  return GIT_REPOSITORY_TARGETING_KEYS.has(key) || key.startsWith("GIT_ALTERNATE_OBJECT");
}
