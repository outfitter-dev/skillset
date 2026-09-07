import { posix } from "node:path";

import { pathMatchesOwner } from "./owner-paths";
import { shellOperandCandidates } from "./shell-tokens";

// These values identify patterns, names, or presentation settings. Unknown
// options remain candidates; adding a path-valued option needs no guard change.
const NON_PATH_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set(["--config-env", "--namespace", "-c"]),
  npm: new Set([
    "--fetch-retries",
    "--location",
    "--loglevel",
    "--registry",
    "--workspace",
    "-L",
    "-w",
  ]),
  pnpm: new Set([
    "--changed-files-ignore-pattern",
    "--filter",
    "--filter-prod",
    "--loglevel",
    "--network-concurrency",
    "--reporter",
    "--resume-from",
    "--test-pattern",
    "--workspace-concurrency",
    "-F",
  ]),
  bun: new Set([
    "--conditions",
    "--console-depth",
    "--cpu-prof-interval",
    "--cron-period",
    "--cron-title",
    "--define",
    "--dns-result-order",
    "--drop",
    "--elide-lines",
    "--eval",
    "--print",
    "-e",
    "-p",
    "--extension-order",
    "--feature",
    "--filter",
    "--install",
    "--jsx-factory",
    "--jsx-fragment",
    "--jsx-runtime",
    "--loader",
    "--main-fields",
    "--max-http-header-size",
    "--port",
    "--shell",
    "--title",
    "--unhandled-rejections",
    "--user-agent",
    "-d",
    "-F",
    "-l",
  ]),
};

export function commandName(token: string | undefined): string {
  return posix.basename(token?.replaceAll("\\", "/") ?? "").toLowerCase();
}

/** Bare scripts is a repository route in a command; descendants can be public
 * plugin companions and still rely on the script inventory in generated text. */
export function shellPathMatchesOwner(
  value: string,
  owner: string,
  repoRoot: string | undefined,
  allowDirectOwner: boolean
): boolean {
  return (
    pathMatchesOwner(value, owner, repoRoot, allowDirectOwner) ||
    (!allowDirectOwner &&
      owner === "scripts" &&
      /^(?:\.\/)?scripts\/?$/iu.test(value))
  );
}

/** Extracts operands by default, skipping only known non-path positions. */
export function commandOperandCandidates(
  tokens: readonly string[]
): readonly string[] {
  const command = commandName(tokens[0]);
  if (
    tokens[0]?.toLowerCase() === "skillset" ||
    ["echo", "printf"].includes(command)
  )
    return [];
  const nonPaths = NON_PATH_VALUE_FLAGS[command];
  const runner = ["bun", "npm", "pnpm", "yarn"].includes(command);
  // A path whose basename is skillset is itself a route, including when
  // a wrapper cwd supplies its protected parent.
  const operands: string[] =
    command === "skillset" && tokens[0] ? [tokens[0]] : [];
  let optionValueNext = false;
  let parseOptions = true;
  let runnerCommandSeen = false;
  let scriptNameNext = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (parseOptions && token.startsWith("-")) {
      const flag = token.split("=", 1)[0] ?? token;
      const nonPath =
        nonPaths?.has(flag) === true ||
        [...(nonPaths ?? [])].some(
          (entry) => entry.length === 2 && token.startsWith(entry)
        );
      if (nonPath) {
        if (nonPaths?.has(token)) index += 1;
        continue;
      }
      operands.push(...shellOperandCandidates(token));
      optionValueNext =
        (!token.includes("=") && token.length === 2) ||
        (token.startsWith("--") && !token.includes("="));
      continue;
    }
    if (optionValueNext) {
      operands.push(token);
      optionValueNext = false;
      continue;
    }
    if (runner && !runnerCommandSeen) {
      runnerCommandSeen = true;
      scriptNameNext = ["run", "run-script", "rum", "urn"].includes(token);
      // A command/alias name is not a path. A slashed script remains a path.
      if (command !== "bun" && !token.includes("/")) continue;
    } else if (scriptNameNext) {
      scriptNameNext = false;
      if (!token.includes("/")) continue;
    }
    operands.push(...(parseOptions ? shellOperandCandidates(token) : [token]));
  }
  return operands;
}
