import { pathMatchesOwner } from "./owner-paths";
import { attachedOptionValue } from "./shell-tokens";

/**
 * Commands whose bare operands are paths, plus the options on those commands
 * that fuse a directory operand into the option token.
 */

const PROTECTED_ROOT_PATH_COMMANDS: ReadonlySet<string> = new Set([
  "bash",
  "bun",
  "cat",
  "cd",
  "chmod",
  "chown",
  "cp",
  "deno",
  "du",
  "find",
  // `install [-D] SOURCE... DIRECTORY`, `install -d DIRECTORY...`, and
  // `ln TARGET... DIRECTORY` all name a directory the command writes into
  // through a plain operand, so the generic
  // `normalizedTokens.slice(1).includes(normalizedOwner)` membership check
  // reaches both the trailing operand and the detached `-t packages` spelling.
  "install",
  "ln",
  "ls",
  "mv",
  "node",
  // `pushd [-n] [+N | -N | dir]` changes the working directory like `cd`
  // (bash `help pushd`); `-n` only suppresses the directory change on stack
  // rotation and is not a value-taking flag, so the generic
  // `normalizedTokens.slice(1).includes(normalizedOwner)` membership check
  // already reaches a trailing `dir` operand. `popd` takes no directory
  // operand (only `+N`/`-N` stack positions), so it is intentionally
  // excluded.
  "pushd",
  "realpath",
  "rm",
  "rsync",
  "sh",
  "stat",
  "tar",
  "tree",
  "tsx",
  "zsh",
]);
// Options on {@link PROTECTED_ROOT_PATH_COMMANDS} whose operand names a
// directory the command then runs inside, reads through, or writes into, so the
// operand is a route rather than an opaque value. The detached spellings
// (`cp -t packages`) already surface the owner as its own token, so these tables
// exist for the attached spellings (`--target-directory=packages`,
// `-tpackages`) that fuse the operand into the option token.
//
// Verified against the installed help output:
// - `cp --help` / `mv --help` (GNU coreutils): `-t, --target-directory=DIRECTORY`.
// - `ln --help` / `install --help` (GNU coreutils): `-t,
//   --target-directory=DIRECTORY` names the directory links are created in and
//   the directory sources are copied into, respectively. Their `-T` is
//   `--no-target-directory`, which takes no value, so it stays out.
// - `tar` (bsdtar) man page: `-C directory, --cd directory, --directory directory`.
// - `rsync` man page: `--backup-dir directory`, `--compare-dest=directory`,
//   `--copy-dest=directory`, `--link-dest=directory`, `--partial-dir=DIR`, and
//   `-T, --temp-dir=directory`.
// - `bun --help`: `--cwd=<val>` "Absolute path to resolve files & entry points
//   from. This just changes the process' cwd."
// - `realpath --help` (GNU coreutils): `--relative-to=DIR`, `--relative-base=DIR`.
//
// File-valued options stay out. A bare owner name in `tar -f packages`,
// `du --files0-from=packages`, or `chmod --reference=packages` names a file the
// command opens rather than a directory it routes through, and any real path
// under the owner carries a separator the generic path scan already reads.
const COMMAND_DIRECTORY_VALUE_FLAGS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  bun: new Set(["--cwd"]),
  cp: new Set(["--target-directory", "-t"]),
  install: new Set(["--target-directory", "-t"]),
  ln: new Set(["--target-directory", "-t"]),
  mv: new Set(["--target-directory", "-t"]),
  realpath: new Set(["--relative-base", "--relative-to"]),
  rsync: new Set([
    "--backup-dir",
    "--compare-dest",
    "--copy-dest",
    "--link-dest",
    "--partial-dir",
    "--temp-dir",
    "-T",
  ]),
  tar: new Set(["--cd", "--directory", "-C"]),
};

export function isProtectedRootPathCommand(command: string): boolean {
  return PROTECTED_ROOT_PATH_COMMANDS.has(command);
}

/**
 * Reports whether a generic command routes into a protected directory through
 * an attached directory-valued option, so `cp README.md
 * --target-directory=packages` cannot write into the protected tree while the
 * closure check passes. Detached operands are already their own tokens, so the
 * caller's owner-token check covers `cp -t packages`; only the fused spellings
 * need parsing here. Direct owner routes count, matching `git -C` and the
 * wrapper `chdir` options: naming the owner as a command's working, target, or
 * destination directory is a repository route even where a bare owner-named
 * path would read as plugin-local.
 */
export function hasCommandDirectoryOptionRoute(
  tokens: readonly string[],
  normalizedOwner: string,
  repoRoot?: string
): boolean {
  const directoryFlags =
    COMMAND_DIRECTORY_VALUE_FLAGS[tokens[0]?.toLowerCase() ?? ""];
  if (!directoryFlags) return false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    // Everything after `--` is a file operand, never an option.
    if (token === "--") break;
    if (!token.startsWith("-")) continue;
    const operand = attachedOptionValue(token, directoryFlags);
    if (
      operand !== undefined &&
      pathMatchesOwner(operand, normalizedOwner, repoRoot)
    ) {
      return true;
    }
  }
  return false;
}

const RUNNER_DIRECTORY_ROUTE_FLAGS: Readonly<
  Record<string, readonly string[]>
> = {
  npm: ["--prefix", "-C"],
  pnpm: ["--dir", "-C"],
  yarn: ["--cwd"],
};

/**
 * Reports whether a package-runner invocation routes into a protected directory
 * through a directory-valued runner option, so `npm --prefix packages install`
 * cannot install into the protected tree while the closure check passes. The
 * runners are not PROTECTED_ROOT_PATH_COMMANDS members, so no bare owner token
 * is checked for them, and the operand carries no separator for the generic
 * path scan to read. Direct owner routes count, matching `git -C` and the
 * wrapper `chdir` options: naming the owner as a runner's working directory is
 * a repository route even where a bare owner-named path would read as
 * plugin-local.
 */
export function hasPackageRunnerProtectedDirectoryArgument(
  tokens: readonly string[],
  normalizedOwner: string,
  repoRoot?: string
): boolean {
  const routeFlags =
    RUNNER_DIRECTORY_ROUTE_FLAGS[tokens[0]?.toLowerCase() ?? ""];
  if (!routeFlags) return false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    // Everything after `--` is forwarded to the invoked script, never parsed as
    // a runner option.
    if (token === "--") break;
    const routeFlag = routeFlags.find(
      (flag) =>
        token === flag ||
        (flag.startsWith("--") && token.startsWith(`${flag}=`))
    );
    if (routeFlag === undefined) continue;
    let operand: string | undefined;
    if (token === routeFlag) {
      const detached = tokens[index + 1];
      if (detached === undefined || detached.startsWith("-")) continue;
      operand = detached;
      index += 1;
    } else {
      operand = token.slice(routeFlag.length + 1);
      if (operand.length === 0) continue;
    }
    if (pathMatchesOwner(operand, normalizedOwner, repoRoot)) {
      return true;
    }
  }
  return false;
}
