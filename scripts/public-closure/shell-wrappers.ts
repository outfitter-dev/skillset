import { posix } from "node:path";

import { pathMatchesOwner } from "./owner-paths";

/**
 * The wrapper prefix grammar (`sudo env -C dir …`). Wrappers are the commands
 * that run another command, so the guard has to walk past their options to find
 * the real command — and has to read the directory operands it walks past.
 */

const SHELL_WRAPPERS: ReadonlySet<string> = new Set([
  "command",
  "env",
  "exec",
  "nice",
  "nohup",
  "sudo",
  "time",
]);
const SHELL_WRAPPER_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> =
  {
    env: new Set(["--chdir", "--split-string", "--unset", "-C", "-S", "-u"]),
    exec: new Set(["-a"]),
    nice: new Set(["--adjustment", "-n"]),
    sudo: new Set([
      "--chdir",
      "--chroot",
      "--close-from",
      "--command-timeout",
      "--group",
      "--host",
      "--other-user",
      "--prompt",
      "--role",
      "--type",
      "--user",
      "-C",
      "-D",
      "-g",
      "-h",
      "-p",
      "-r",
      "-R",
      "-t",
      "-T",
      "-u",
      "-U",
    ]),
    time: new Set(["--format", "--output", "-f", "-o"]),
  };
// The subset of wrapper options whose operand is a directory the wrapped
// command then runs inside. `env -C/--chdir` and `sudo -D/--chdir` change the
// working directory; `sudo -R/--chroot` changes the filesystem root. The other
// wrappers this guard unwraps take no directory operand: `command` and `nohup`
// take no value flags, `exec -a` takes a process name, `nice -n` takes a number,
// `sudo -C` is `--close-from` (a descriptor number, not a directory), and
// `time -f/-o` take a format string and an output file.
const SHELL_WRAPPER_DIRECTORY_VALUE_FLAGS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  env: new Set(["--chdir", "-C"]),
  sudo: new Set(["--chdir", "--chroot", "-D", "-R"]),
};

/**
 * Reads the directory operand a wrapper option routes into, covering the
 * detached (`-C dir`, `--chdir dir`), attached long (`--chdir=dir`), and
 * attached short (`-Cdir`) spellings GNU option parsing accepts.
 */
function shellWrapperDirectoryOperand(
  wrapper: string,
  token: string,
  operand: string | undefined
): string | undefined {
  const directoryFlags = SHELL_WRAPPER_DIRECTORY_VALUE_FLAGS[wrapper];
  if (!directoryFlags) return undefined;
  if (directoryFlags.has(token)) {
    return operand === undefined || operand.startsWith("-")
      ? undefined
      : operand;
  }
  const separator = token.indexOf("=");
  if (
    token.startsWith("--") &&
    separator > 0 &&
    directoryFlags.has(token.slice(0, separator))
  ) {
    const attached = token.slice(separator + 1);
    return attached.length > 0 ? attached : undefined;
  }
  for (const flag of directoryFlags) {
    if (
      flag.length === 2 &&
      !flag.startsWith("--") &&
      token.startsWith(flag) &&
      token.length > flag.length
    ) {
      return token.slice(flag.length);
    }
  }
  return undefined;
}

/**
 * Walks the wrapper prefix (`sudo env -C dir …`) that precedes the real command
 * and reports both where the command starts and the directory operands the
 * wrappers route through. The directories are returned rather than discarded so
 * callers can check them before {@link unwrapShellCommand} drops them.
 */
function readShellWrapperPrefix(tokens: readonly string[]): {
  readonly directories: readonly string[];
  readonly index: number;
} {
  const directories: string[] = [];
  let index = 0;
  if (["$", "%", ">"].includes(tokens[index] ?? "")) index += 1;
  while (tokens[index] === "!") index += 1;
  const skipAssignments = (): void => {
    while (/^[a-z_][a-z0-9_]*=/iu.test(tokens[index] ?? "")) index += 1;
  };
  skipAssignments();

  while (index < tokens.length) {
    const wrapper = (tokens[index] ?? "").toLowerCase();
    if (!SHELL_WRAPPERS.has(wrapper)) break;
    index += 1;

    while (index < tokens.length) {
      const token = tokens[index] ?? "";
      if (token === "--") {
        index += 1;
        break;
      }
      if (wrapper === "command" && (token === "-v" || token === "-V")) {
        return { directories, index: tokens.length };
      }
      if (wrapper === "env" && /^[a-z_][a-z0-9_]*=/iu.test(token)) {
        index += 1;
        continue;
      }
      if (!token.startsWith("-")) break;
      const directory = shellWrapperDirectoryOperand(
        wrapper,
        token,
        tokens[index + 1]
      );
      if (directory !== undefined) directories.push(directory);
      const valueFlags = SHELL_WRAPPER_VALUE_FLAGS[wrapper];
      index += valueFlags?.has(token) === true && !token.includes("=") ? 2 : 1;
    }
    skipAssignments();
  }

  return { directories, index };
}

export function unwrapShellCommand(
  tokens: readonly string[]
): readonly string[] {
  return tokens.slice(readShellWrapperPrefix(tokens).index);
}

/**
 * Reports whether a wrapper prefix changes into a protected directory before
 * the wrapped command runs, so `env -C packages pwd` cannot pass the closure
 * check by hiding the route in an operand {@link unwrapShellCommand} skips.
 * Direct owner routes always count here, matching `git -C`: an explicit
 * `chdir` into the owner is a repository route even where a bare owner-named
 * path would be read as plugin-local.
 */
export function hasShellWrapperProtectedDirectoryArgument(
  tokens: readonly string[],
  normalizedOwner: string,
  repoRoot?: string
): boolean {
  let directory = ".";
  for (const operand of readShellWrapperPrefix(tokens).directories) {
    const normalizedOperand = operand.replaceAll("\\", "/");
    directory = posix.isAbsolute(normalizedOperand)
      ? posix.normalize(normalizedOperand)
      : posix.normalize(posix.join(directory, normalizedOperand));
    if (pathMatchesOwner(directory, normalizedOwner, repoRoot)) return true;
  }
  return false;
}
