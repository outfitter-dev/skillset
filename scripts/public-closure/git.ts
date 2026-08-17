import { posix } from "node:path";

/**
 * Git's top-level option grammar. Git is the one tool here whose options both
 * change the directory the rest of the command reads through and accumulate, so
 * its route check resolves each operand against the directory in effect.
 */

// Git options whose operand names a directory the command then reads or writes
// through, so the operand is a route into that directory rather than an opaque
// value. Both are also listed in GIT_GLOBAL_VALUE_FLAGS, which keeps the flag
// table complete; the route check runs first and consumes them.
const GIT_DIRECTORY_ROUTE_FLAGS = ["--git-dir", "--work-tree"] as const;
const GIT_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--config-env",
  "--git-dir",
  "--namespace",
  "--work-tree",
  "-c",
]);
const GIT_PATHSPEC_OPERAND_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "add",
  "check-ignore",
  "clean",
  "ls-files",
  "mv",
  "rm",
  "status",
]);

const GIT_GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--bare",
  "--glob-pathspecs",
  "--icase-pathspecs",
  "--literal-pathspecs",
  "--no-advice",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "--noglob-pathspecs",
  "--paginate",
  "-P",
  "-p",
]);

/**
 * Collects the pathspec operands a Git subcommand reads or writes through, so
 * `git ls-files packages` and `git grep TODO -- packages` cannot enumerate or
 * search the protected tree while the closure check passes. Two operand shapes
 * carry pathspecs:
 *
 * - Every plain operand of a {@link GIT_PATHSPEC_OPERAND_SUBCOMMANDS} member,
 *   whose synopsis has no revision positional to disambiguate.
 * - Every operand after `--`, which Git universally reads as a pathspec.
 *
 * Option tokens are skipped rather than parsed for arity: Git's per-subcommand
 * option tables are too large to model, and a detached option value that spells
 * the owner (`git ls-files -x packages`) still names the protected tree in
 * public guidance, so treating it as a route errs toward reporting.
 */
function gitPathspecOperandRoutes(
  tokens: readonly string[],
  subcommandIndex: number,
  resolveAgainstDirectory: (operand: string) => string
): string[] {
  let pathspecsOnly = GIT_PATHSPEC_OPERAND_SUBCOMMANDS.has(
    tokens[subcommandIndex]?.toLowerCase() ?? ""
  );
  const routes: string[] = [];
  for (let index = subcommandIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      pathspecsOnly = true;
      continue;
    }
    if (!pathspecsOnly || token.length === 0 || token.startsWith("-")) continue;
    routes.push(resolveAgainstDirectory(token));
  }
  return routes;
}
export function hasGitProtectedDirectoryArgument(
  tokens: readonly string[],
  normalizedOwner: string
): boolean {
  if (tokens[0]?.toLowerCase() !== "git") return false;
  let directory = ".";
  const routes: string[] = [];
  const resolveAgainstDirectory = (operand: string): string => {
    const normalizedOperand = operand.replaceAll("\\", "/");
    return posix.isAbsolute(normalizedOperand)
      ? posix.normalize(normalizedOperand)
      : posix.normalize(posix.join(directory, normalizedOperand));
  };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    // Only the detached spelling is a route. Git's top-level option parser is
    // hand-rolled (`handle_options` in git.c compares whole arguments) rather
    // than parse-options or getopt, so it rejects both the attached-short
    // spelling (`git -Cscripts` -> "unknown option: -Cscripts") and bundling
    // (`git -pC scripts`). This is why `-Cdir` is handled for shell wrappers,
    // whose GNU getopt parsing does accept it, but deliberately not here.
    if (token === "-C") {
      const operand = tokens[index + 1];
      if (operand === undefined || operand.startsWith("-")) return false;
      directory = resolveAgainstDirectory(operand);
      index += 1;
      continue;
    }
    // `git --work-tree=<path>` points Git at a tree and `git --git-dir=<path>`
    // points it at a repository, so both spellings of both options route into
    // the named directory the way `-C` does. Git resolves each operand relative
    // to the directory in effect where the option appears.
    const routeFlag = GIT_DIRECTORY_ROUTE_FLAGS.find(
      (flag) => token === flag || token.startsWith(`${flag}=`)
    );
    if (routeFlag !== undefined) {
      let operand: string;
      if (token === routeFlag) {
        const detached = tokens[index + 1];
        if (detached === undefined || detached.startsWith("-")) return false;
        operand = detached;
        index += 1;
      } else {
        operand = token.slice(routeFlag.length + 1);
        if (operand.length === 0) continue;
      }
      routes.push(resolveAgainstDirectory(operand));
      continue;
    }
    if (token === "--") break;
    // The first plain token ends Git's global option parsing and names the
    // subcommand, whose own operands can still be pathspecs into the protected
    // tree.
    if (!token.startsWith("-")) {
      routes.push(
        ...gitPathspecOperandRoutes(tokens, index, resolveAgainstDirectory)
      );
      break;
    }
    if (GIT_GLOBAL_VALUE_FLAGS.has(token)) {
      if (!tokens[index + 1]) return false;
      index += 1;
      continue;
    }
    if (
      GIT_GLOBAL_BOOLEAN_FLAGS.has(token) ||
      token.startsWith("--exec-path=") ||
      [...GIT_GLOBAL_VALUE_FLAGS].some(
        (flag) => flag.startsWith("--") && token.startsWith(`${flag}=`)
      )
    ) {
      continue;
    }
    return false;
  }
  return [directory, ...routes].some((route) => {
    const normalizedRoute = route.toLowerCase();
    return (
      normalizedRoute === normalizedOwner ||
      normalizedRoute.startsWith(`${normalizedOwner}/`)
    );
  });
}
