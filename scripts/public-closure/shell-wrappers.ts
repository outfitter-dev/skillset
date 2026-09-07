import {
  resolveShellPath,
  wrapperRootOperand,
  wrapperWorkingDirectory,
} from "./cwd-context";
import { shellOperandCandidates } from "./shell-tokens";

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
// Known non-path wrapper values. Everything else remains a candidate, including
// flags this scanner has never seen. Path-bearing options need no registry.
const SHELL_WRAPPER_NON_PATH_FLAGS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  env: new Set(["--unset", "-u", "--split-string", "-S"]),
  exec: new Set(["-a"]),
  nice: new Set(["--adjustment", "-n"]),
  sudo: new Set([
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
    "-g",
    "-h",
    "-p",
    "-r",
    "-t",
    "-T",
    "-u",
    "-U",
  ]),
  time: new Set(["--format", "-f"]),
};

/**
 * Walks the wrapper prefix (`sudo env -C dir …`) that precedes the real command
 * and reports both where the command starts and the directory operands the
 * wrappers route through. The directories are returned rather than discarded so
 * callers can check them before {@link unwrapShellCommand} drops them.
 */
export function readShellWrapperPrefix(
  tokens: readonly string[],
  incomingCwd = "."
): {
  readonly directories: readonly string[];
  readonly cwd: string;
  readonly repositoryPaths: readonly string[];
  readonly assignmentPaths: readonly string[];
  readonly index: number;
} {
  const directories: string[] = [];
  let cwd = incomingCwd;
  const repositoryPaths: string[] = [];
  const assignmentPaths: string[] = [];
  let index = 0;
  if (["$", "%", ">"].includes(tokens[index] ?? "")) index += 1;
  while (tokens[index] === "!") index += 1;
  const skipAssignments = (): void => {
    while (/^[a-z_][a-z0-9_]*=/iu.test(tokens[index] ?? "")) {
      const assignment = tokens[index] ?? "";
      const separator = assignment.indexOf("=");
      const name = assignment.slice(0, separator);
      const value = assignment.slice(separator + 1);
      // Bare environment labels are data; a slash supplies path evidence.
      // PATH is a shell search list, so even its bare entries name directories.
      if (name === "PATH")
        assignmentPaths.push(...value.split(":").filter(Boolean));
      else if (/[/\\]/u.test(value)) assignmentPaths.push(value);
      index += 1;
    }
  };
  skipAssignments();

  while (index < tokens.length) {
    const wrapper = (tokens[index] ?? "").toLowerCase();
    if (!SHELL_WRAPPERS.has(wrapper)) break;
    index += 1;
    let selectedDirectory: string | undefined;

    while (index < tokens.length) {
      const token = tokens[index] ?? "";
      if (token === "--") {
        index += 1;
        break;
      }
      if (wrapper === "command" && (token === "-v" || token === "-V")) {
        return {
          directories,
          cwd,
          repositoryPaths,
          assignmentPaths,
          index: tokens.length,
        };
      }
      if (wrapper === "env" && /^[a-z_][a-z0-9_]*=/iu.test(token)) {
        skipAssignments();
        continue;
      }
      if (!token.startsWith("-")) break;
      selectedDirectory =
        wrapperWorkingDirectory(wrapper, token, tokens[index + 1]) ??
        selectedDirectory;
      const root = wrapperRootOperand(wrapper, token, tokens[index + 1]);
      if (root !== undefined) repositoryPaths.push(resolveShellPath(cwd, root));
      const nonPaths = SHELL_WRAPPER_NON_PATH_FLAGS[wrapper];
      const flag = token.split("=", 1)[0] ?? token;
      const nonPath =
        nonPaths?.has(flag) === true ||
        [...(nonPaths ?? [])].some(
          (entry) => entry.length === 2 && token.startsWith(entry)
        );
      if (!nonPath) {
        directories.push(
          ...shellOperandCandidates(token).flatMap((value) => [
            value,
            resolveShellPath(cwd, value),
          ])
        );
        if (SHELL_WRAPPER_VALUE_FLAGS[wrapper]?.has(token)) {
          const operand = tokens[index + 1];
          if (operand !== undefined && !operand.startsWith("-"))
            directories.push(operand, resolveShellPath(cwd, operand));
        }
      }
      const valueFlags = SHELL_WRAPPER_VALUE_FLAGS[wrapper];
      if (!nonPath && !token.includes("=") && !valueFlags?.has(token)) {
        const possibleValue = tokens[index + 1];
        if (possibleValue && !possibleValue.startsWith("-"))
          directories.push(possibleValue, resolveShellPath(cwd, possibleValue));
      }
      index += valueFlags?.has(token) === true && !token.includes("=") ? 2 : 1;
    }
    if (selectedDirectory !== undefined) {
      cwd = resolveShellPath(cwd, selectedDirectory);
      repositoryPaths.push(cwd);
    }
    skipAssignments();
  }

  return { directories, cwd, repositoryPaths, assignmentPaths, index };
}

export function unwrapShellCommand(
  tokens: readonly string[]
): readonly string[] {
  return tokens.slice(readShellWrapperPrefix(tokens).index);
}
