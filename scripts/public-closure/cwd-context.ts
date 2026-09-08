import { posix } from "node:path";

/** Path context supplements default operand scanning; it never selects paths. */
export function resolveShellPath(directory: string, operand: string): string {
  const path = operand.replaceAll("\\", "/");
  return posix.isAbsolute(path)
    ? posix.normalize(path)
    : posix.join(directory, path);
}

/** Only actual cwd syntax belongs here. Repeated env/sudo cwd options select
 * the last value; nested wrappers and Git -C resolve against the incoming cwd. */
export function wrapperWorkingDirectory(
  wrapper: string,
  token: string,
  next: string | undefined
): string | undefined {
  const short =
    wrapper === "env" ? "-C" : wrapper === "sudo" ? "-D" : undefined;
  if (!short) return undefined;
  if (token === short || token === "--chdir") {
    return next?.startsWith("-") ? undefined : next;
  }
  if (token.startsWith("--chdir=")) return token.slice("--chdir=".length);
  if (token.startsWith(short)) return token.slice(short.length);
  return undefined;
}

/** A chroot operand names an explicit repository boundary, not a cwd change. */
export function wrapperRootOperand(
  wrapper: string,
  token: string,
  next: string | undefined
): string | undefined {
  if (wrapper !== "sudo") return undefined;
  if (token === "-R" || token === "--chroot")
    return next?.startsWith("-") ? undefined : next;
  if (token.startsWith("--chroot=")) return token.slice("--chroot=".length);
  if (token.startsWith("-R")) return token.slice(2);
  return undefined;
}

export function gitPathContext(
  tokens: readonly string[],
  incoming: string
): {
  readonly cwd: string;
  readonly repositoryPaths: readonly string[];
} {
  let directory = incoming;
  const paths: string[] = [];
  const workTrees: string[] = [];
  // Git fixes --git-dir before later -C options, but resolves --work-tree
  // against the final cwd. Preserve that distinction rather than joining all
  // option operands indiscriminately.
  const recordRepositoryOperand = (flag: string, operand: string): void => {
    if (flag === "--git-dir") paths.push(resolveShellPath(directory, operand));
    else workTrees.push(operand);
  };
  if (tokens[0] !== "git") return { cwd: directory, repositoryPaths: paths };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "-C") {
      const operand = tokens[++index];
      if (operand && !operand.startsWith("-")) {
        directory = resolveShellPath(directory, operand);
        paths.push(directory);
      }
    } else if (token === "--git-dir" || token === "--work-tree") {
      const operand = tokens[++index];
      if (operand && !operand.startsWith("-"))
        recordRepositoryOperand(token, operand);
    } else if (
      token.startsWith("--git-dir=") ||
      token.startsWith("--work-tree=")
    ) {
      const separator = token.indexOf("=");
      recordRepositoryOperand(
        token.slice(0, separator),
        token.slice(separator + 1)
      );
    } else if (["-c", "--config-env", "--namespace"].includes(token)) {
      index += 1;
    } else if (!token.startsWith("-") || token === "--") {
      break;
    }
  }
  return {
    cwd: directory,
    repositoryPaths: [
      ...paths,
      ...workTrees.map((operand) => resolveShellPath(directory, operand)),
    ],
  };
}
