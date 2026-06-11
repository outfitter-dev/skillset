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
export function gitSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {continue;}
    if (
      key === "GIT_DIR" ||
      key === "GIT_WORK_TREE" ||
      key === "GIT_INDEX_FILE" ||
      key === "GIT_OBJECT_DIRECTORY" ||
      key === "GIT_COMMON_DIR" ||
      key === "GIT_NAMESPACE" ||
      key.startsWith("GIT_ALTERNATE_OBJECT")
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}
