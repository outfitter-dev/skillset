import { readdir, readFile } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PublicClosureRule =
  | "contributor-skill"
  | "development-docs"
  | "fixture-path"
  | "internal-package"
  | "internal-script";

export interface PublicClosureViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: PublicClosureRule;
  readonly text: string;
}

export interface PublicClosureScanResult {
  readonly scannedFiles: number;
  readonly skippedBinaryFiles: number;
  readonly violations: readonly PublicClosureViolation[];
}

interface ClosurePattern {
  readonly pattern: RegExp;
  readonly rule: PublicClosureRule;
}

interface ProtectedPathOwner {
  readonly path: string;
  readonly rule: PublicClosureRule;
}

interface SearchCommandDialect {
  readonly commandValueFlags: ReadonlySet<string>;
  readonly optionalAttachedValueFlags: ReadonlySet<string>;
  readonly pathOnlyFlags: ReadonlySet<string>;
  readonly pathValueFlags: ReadonlySet<string>;
  readonly patternValueFlags: ReadonlySet<string>;
  readonly valueFlags: ReadonlySet<string>;
}

type PackageScripts = Readonly<Record<string, string>>;
type PackageRunner = "bun" | "npm" | "pnpm" | "yarn";
type ProtectedBoundaryContext = "generated" | "package-script";

interface ShellLogicalLine {
  readonly line: number;
  readonly shellCommand: boolean;
  readonly text: string;
}

interface MarkdownFence {
  readonly character: "`" | "~";
  readonly length: number;
  readonly shell: boolean;
}

interface MarkdownFenceDelimiter {
  readonly character: "`" | "~";
  readonly info: string;
  readonly length: number;
}

const PUBLIC_ROOT = "plugins/skillset/";
const CLOSURE_PATTERNS: readonly ClosurePattern[] = [
  {
    pattern:
      /(?:^|[^a-z0-9-])skillset-dev(?:-[a-z0-9][a-z0-9-]*)?(?=$|[^a-z0-9-])/iu,
    rule: "contributor-skill",
  },
  {
    pattern:
      /@skillset\/[a-z0-9._-]+\/(?:internal|src)(?![a-z0-9_-]|\.[a-z0-9_-])/iu,
    rule: "internal-package",
  },
] as const;
const PROTECTED_PATH_OWNERS: readonly ProtectedPathOwner[] = [
  { path: "docs/development", rule: "development-docs" },
  { path: "fixtures", rule: "fixture-path" },
  { path: "packages", rule: "internal-package" },
  { path: "apps/skillset/src", rule: "internal-package" },
  { path: "scripts", rule: "internal-script" },
];
const PUBLIC_CLOSURE_RULE_ORDER: readonly PublicClosureRule[] = [
  "contributor-skill",
  "development-docs",
  "fixture-path",
  "internal-package",
  "internal-script",
];
const PROTECTED_PATH_ACTIONS =
  "browse|cd|edit|enter|inspect|list|open|read|visit";
const PUBLIC_REPOSITORY_OWNER = "outfitter-dev";
const PUBLIC_REPOSITORY_NAME = "skillset";
// Canonical `github.com/<owner>/<repo>/<route>/<ref>/<path>` file views.
const GITHUB_FILE_VIEW_ROUTES: ReadonlySet<string> = new Set([
  "blame",
  "blob",
  "edit",
  "raw",
  "tree",
]);
const LITERAL_OPEN_BRACE = "\u{e000}";
const LITERAL_CLOSE_BRACE = "\u{e001}";
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
const RIPGREP_PATTERN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--file",
  "--regexp",
  "-e",
  "-f",
]);
const RIPGREP_PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--file",
  "--ignore-file",
  "-f",
]);
const RIPGREP_COMMAND_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--hostname-bin",
  "--pre",
]);
const RIPGREP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...RIPGREP_PATTERN_VALUE_FLAGS,
  "--after-context",
  "--before-context",
  "--color",
  "--colors",
  "--context",
  "--context-separator",
  "--dfa-size-limit",
  "--encoding",
  "--engine",
  "--field-context-separator",
  "--field-match-separator",
  "--generate",
  "--glob",
  "--hostname-bin",
  "--hyperlink-format",
  "--iglob",
  "--ignore-file",
  "--max-columns",
  "--max-count",
  "--max-depth",
  "--max-filesize",
  "--path-separator",
  "--pre",
  "--pre-glob",
  "--regex-size-limit",
  "--replace",
  "--sort",
  "--sortr",
  "--threads",
  "--type",
  "--type-add",
  "--type-clear",
  "--type-not",
  "-A",
  "-B",
  "-C",
  "-d",
  "-E",
  "-g",
  "-j",
  "-m",
  "-M",
  "-r",
  "-t",
  "-T",
]);
const GREP_PATTERN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--file",
  "--regexp",
  "-e",
  "-f",
]);
const GREP_PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--exclude-from",
  "--file",
  "-f",
]);
const GREP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...GREP_PATTERN_VALUE_FLAGS,
  "--after-context",
  "--before-context",
  "--binary-files",
  "--color",
  "--colour",
  "--context",
  "--devices",
  "--directories",
  "--exclude",
  "--exclude-dir",
  "--exclude-from",
  "--group-separator",
  "--include",
  "--label",
  "--max-count",
  "-A",
  "-B",
  "-C",
  "-d",
  "-D",
  "-m",
]);
// `fd --help` documents `fd [OPTIONS] [pattern] [path]...`, so fd shares the
// generic "first operand is the pattern, later operands are search roots"
// shape already used for grep and ripgrep.
const FD_PATTERN_VALUE_FLAGS: ReadonlySet<string> = new Set(["--and"]);
const FD_PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--base-directory",
  "--ignore-file",
  "--search-path",
]);
const FD_COMMAND_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--exec",
  "--exec-batch",
  "-X",
  "-x",
]);
const FD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...FD_COMMAND_VALUE_FLAGS,
  ...FD_PATH_VALUE_FLAGS,
  ...FD_PATTERN_VALUE_FLAGS,
  "--batch-size",
  "--changed-after",
  "--changed-before",
  "--changed-within",
  "--color",
  "--exact-depth",
  "--exclude",
  "--extension",
  "--format",
  "--max-depth",
  "--max-results",
  "--min-depth",
  "--newer",
  "--older",
  "--owner",
  "--path-separator",
  "--size",
  "--threads",
  "--type",
  "-c",
  "-d",
  "-E",
  "-e",
  "-j",
  "-o",
  "-S",
  "-t",
]);
const FD_SEARCH_COMMAND_DIALECT: SearchCommandDialect = {
  commandValueFlags: FD_COMMAND_VALUE_FLAGS,
  optionalAttachedValueFlags: new Set(),
  pathOnlyFlags: new Set(),
  pathValueFlags: FD_PATH_VALUE_FLAGS,
  patternValueFlags: FD_PATTERN_VALUE_FLAGS,
  valueFlags: FD_VALUE_FLAGS,
};
const SEARCH_COMMAND_DIALECTS: Readonly<Record<string, SearchCommandDialect>> =
  {
    fd: FD_SEARCH_COMMAND_DIALECT,
    fdfind: FD_SEARCH_COMMAND_DIALECT,
    grep: {
      commandValueFlags: new Set(),
      optionalAttachedValueFlags: new Set(["--color", "--colour"]),
      pathOnlyFlags: new Set(),
      pathValueFlags: GREP_PATH_VALUE_FLAGS,
      patternValueFlags: GREP_PATTERN_VALUE_FLAGS,
      valueFlags: GREP_VALUE_FLAGS,
    },
    rg: {
      commandValueFlags: RIPGREP_COMMAND_VALUE_FLAGS,
      optionalAttachedValueFlags: new Set(),
      pathOnlyFlags: new Set(["--files"]),
      pathValueFlags: RIPGREP_PATH_VALUE_FLAGS,
      patternValueFlags: RIPGREP_PATTERN_VALUE_FLAGS,
      valueFlags: RIPGREP_VALUE_FLAGS,
    },
  };
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

// Package-runner options whose operand is a directory the runner then installs
// into or runs its command inside, so the operand is a route into that
// directory rather than an opaque value. These runners are not
// {@link PROTECTED_ROOT_PATH_COMMANDS} members, and a bare owner name carries
// no separator for the generic path scan to read, so without this table
// `npm --prefix packages install` reaches into the protected tree unreported.
//
// Verified against the installed tools:
// - npm 11.12.1: `prefix` is defined with `short: 'C'`, and nopt resolves both
//   `--prefix packages` and `-C packages` to the prefix path.
// - pnpm 11.7.0: `pnpm -C dir root` and `pnpm --dir=dir root` both report the
//   directory's `node_modules`.
// - Yarn's global `--cwd`, already tracked in RUNNER_VALUE_FLAGS.
//
// Only the detached (`--prefix packages`) and attached-long
// (`--prefix=packages`) spellings are routes. The fused short spelling is
// rejected by both parsers (nopt reads `-Cpackages` as the unknown option
// `Cpackages`; pnpm errors with "Unknown option: 'Cpackages'"), matching
// `git -C`. `bun --cwd` needs no entry: bun is a
// {@link PROTECTED_ROOT_PATH_COMMANDS} member, so its detached operand is
// already a checked token and its attached operand is covered by
// {@link COMMAND_DIRECTORY_VALUE_FLAGS}.
const RUNNER_DIRECTORY_ROUTE_FLAGS: Readonly<
  Record<string, readonly string[]>
> = {
  npm: ["--prefix", "-C"],
  pnpm: ["--dir", "-C"],
  yarn: ["--cwd"],
};

const PACKAGE_RUNNER_PATTERN =
  /(?<![a-z0-9_-])(?<runner>bun|npm|pnpm|yarn)(?![a-z0-9_-])/giu;
const PATH_CANDIDATE_PATTERN =
  /(?<![a-z0-9_.:\\/-])(?:[a-z]:)?[\\/]?(?:[a-z0-9._-]+[\\/])+[a-z0-9._-]+/giu;
// Literal shell working-directory expansions. `$(pwd)` and the backtick
// equivalent are command substitutions that Bash resolves to the same directory
// as `$PWD`, and `$(PWD)` is the Make spelling of the same variable, so all of
// them normalize together. Bare `$pwd` stays untouched: it is a different
// variable, and `` `PWD` `` would be a differently named command.
const WORKING_DIRECTORY_VARIABLE_PATTERN =
  /\$\{PWD\}|\$\(\s*(?:pwd|PWD)\s*\)|`\s*pwd\s*`|\$PWD(?![A-Za-z0-9_])/gu;
// Markdown inline destinations, Markdown reference definitions, and HTML
// `href`/`src` attributes. The destination stops at shell/Markdown delimiters.
const LINK_DESTINATION_PATTERN =
  /(\][(:]\s*<?|\b(?:href|src)\s*=\s*["']?)([^\s()<>"'`\r\n]+)/giu;
const ABSOLUTE_LINK_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
// Value-taking forms from `bun run --help`. Keeping this finite prevents an
// unknown flag from swallowing the package-script token.
const BUN_RUN_REQUIRED_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--conditions",
  "--console-depth",
  "--cpu-prof-dir",
  "--cpu-prof-interval",
  "--cpu-prof-name",
  "--cron-period",
  "--cron-title",
  "--cwd",
  "--define",
  "--dns-result-order",
  "--drop",
  "--elide-lines",
  "--env-file",
  "--eval",
  "--extension-order",
  "--feature",
  "--fetch-preconnect",
  "--filter",
  "--heap-prof-dir",
  "--heap-prof-name",
  "--import",
  "--install",
  "--jsx-factory",
  "--jsx-fragment",
  "--jsx-import-source",
  "--jsx-runtime",
  "--loader",
  "--main-fields",
  "--max-http-header-size",
  "--port",
  "--preload",
  "--print",
  "--require",
  "--shell",
  "--title",
  "--tsconfig-override",
  "--unhandled-rejections",
  "--user-agent",
  "-d",
  "-e",
  "-F",
  "-l",
  "-p",
  "-r",
]);
const YARN_RUN_REQUIRED_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--require",
]);
const RUNNER_VALUE_FLAGS: Readonly<Record<PackageRunner, ReadonlySet<string>>> =
  {
    bun: BUN_RUN_REQUIRED_VALUE_FLAGS,
    npm: new Set([
      "--cache",
      "--fetch-retries",
      "--location",
      "--loglevel",
      "--prefix",
      "--registry",
      "--script-shell",
      "--userconfig",
      "--workspace",
      "-L",
      "-w",
    ]),
    pnpm: new Set([
      "--changed-files-ignore-pattern",
      "--dir",
      "--filter",
      "--filter-prod",
      "--loglevel",
      "--network-concurrency",
      "--reporter",
      "--resume-from",
      "--script-shell",
      "--store-dir",
      "--test-pattern",
      "--workspace-concurrency",
      "-C",
      "-F",
    ]),
    yarn: new Set(["--cwd"]),
  };
const RUNNER_BUILTINS: Readonly<Record<PackageRunner, ReadonlySet<string>>> = {
  bun: new Set([
    "add",
    "build",
    "create",
    "install",
    "link",
    "pm",
    "remove",
    "test",
    "unlink",
    "update",
    "upgrade",
    "x",
  ]),
  npm: new Set(),
  pnpm: new Set([
    "add",
    "audit",
    "config",
    "create",
    "dlx",
    "exec",
    "fetch",
    "import",
    "init",
    "install",
    "link",
    "publish",
    "remove",
    "store",
    "unlink",
    "update",
  ]),
  yarn: new Set([
    "add",
    "cache",
    "config",
    "create",
    "dlx",
    "exec",
    "init",
    "install",
    "link",
    "plugin",
    "remove",
    "set",
    "unlink",
    "up",
  ]),
};
const NPM_RUN_COMMANDS: ReadonlySet<string> = new Set([
  "run",
  "run-script",
  "rum",
  "urn",
]);
const NPM_PRE_COMMAND_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--audit",
  "--dry-run",
  "--force",
  "--foreground-scripts",
  "--fund",
  "--if-present",
  "--ignore-scripts",
  "--include-workspace-root",
  "--json",
  "--silent",
  "--workspaces",
  "-s",
]);
const PNPM_RUN_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--aggregate-output",
  "--color",
  "--fail-if-no-match",
  "--if-present",
  "--parallel",
  "--recursive",
  "--report-summary",
  "--reporter-hide-prefix",
  "--sequential",
  "--silent",
  "--stream",
  "--use-stderr",
  "--workspace-root",
  "--yes",
  "-r",
  "-s",
  "-w",
  "-y",
]);
const PNPM_RUN_COMMANDS: ReadonlySet<string> = new Set(["run", "run-script"]);
const NPM_LIFECYCLE_SCRIPTS: Readonly<Record<string, string>> = {
  restart: "restart",
  start: "start",
  stop: "stop",
  t: "test",
  test: "test",
  tst: "test",
};

interface CommandToken {
  readonly end: number;
  readonly value: string;
}

export function isGeneratedPublicPath(path: string): boolean {
  return path.startsWith(PUBLIC_ROOT) && path.length > PUBLIC_ROOT.length;
}

export function scanGeneratedPublicContent(
  file: string,
  content: string,
  repoInternalScripts: readonly string[] = [],
  repoInternalScriptAliases: ReadonlySet<string> = new Set(),
  packageScriptNames?: ReadonlySet<string>,
  repoRoot?: string
): readonly PublicClosureViolation[] {
  if (!isGeneratedPublicPath(file)) return [];
  const violations: PublicClosureViolation[] = [];
  for (const { line, shellCommand, text } of shellLogicalLines(content, true)) {
    for (const rule of matchingProtectedBoundaryRules(
      text,
      repoRoot,
      "generated",
      shellCommand
    )) {
      violations.push({ file, line, rule, text: text.trim() });
    }
    if (
      !violations.some(
        (violation) =>
          violation.line === line && violation.rule === "internal-script"
      ) &&
      repoInternalScripts.some((path) =>
        hasRepoInternalScriptReference(text, path, repoRoot, shellCommand)
      )
    ) {
      violations.push({
        file,
        line,
        rule: "internal-script",
        text: text.trim(),
      });
    } else if (
      !violations.some(
        (violation) =>
          violation.line === line && violation.rule === "internal-script"
      ) &&
      invokedPackageScripts(text, packageScriptNames).some((name) =>
        repoInternalScriptAliases.has(name)
      )
    ) {
      violations.push({
        file,
        line,
        rule: "internal-script",
        text: text.trim(),
      });
    }
  }
  return violations;
}

function matchingProtectedBoundaryRules(
  text: string,
  repoRoot: string | undefined,
  context: ProtectedBoundaryContext,
  shellCommand = false
): readonly PublicClosureRule[] {
  const shellText = expandWorkingDirectoryVariables(text, repoRoot);
  const normalizedTextWithUrls = normalizeLiteralShellPathQuotes(
    expandWorkingDirectoryVariables(
      decodeRelativeLinkDestinations(text),
      repoRoot
    ).replaceAll("\\", "/")
  );
  const normalizedText = withoutHttpUrls(normalizedTextWithUrls);
  const repositoryPaths = repositoryHttpPaths(normalizedTextWithUrls);
  const rules = new Set<PublicClosureRule>(
    CLOSURE_PATTERNS.filter(({ pattern }) => pattern.test(normalizedText)).map(
      ({ rule }) => rule
    )
  );
  for (const owner of PROTECTED_PATH_OWNERS) {
    if (
      hasProtectedPathOwnerReference(
        normalizedText,
        owner.path,
        repoRoot,
        context,
        repositoryPaths,
        shellCommand,
        shellText
      )
    ) {
      rules.add(owner.rule);
    }
  }
  return PUBLIC_CLOSURE_RULE_ORDER.filter((rule) => rules.has(rule));
}

function hasProtectedPathOwnerReference(
  normalizedText: string,
  ownerPath: string,
  repoRoot: string | undefined,
  context: ProtectedBoundaryContext,
  repositoryPaths: readonly string[],
  shellCommand: boolean,
  shellText: string
): boolean {
  const normalizedOwner = ownerPath.toLowerCase();
  const owns = (candidate: string): boolean =>
    candidate === normalizedOwner ||
    candidate.startsWith(`${normalizedOwner}/`);
  const normalizedRoot = repoRoot
    ?.replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
  const absoluteOwnerPath = normalizedRoot
    ? posix.normalize(`${normalizedRoot}/${normalizedOwner}`)
    : undefined;

  const pathCandidateText = collapseRepeatedPathSeparators(
    withoutSearchCommandSegments(
      normalizedText,
      context === "package-script" || shellCommand
    )
  );
  for (const match of pathCandidateText.matchAll(PATH_CANDIDATE_PATTERN)) {
    if (match[0].endsWith("/.")) continue;
    const candidate = posix
      .normalize(match[0].replace(/[!,.?:;]+$/u, ""))
      .toLowerCase();
    const repositoryRelative = candidate.replace(/^(?:\.\.\/)+/u, "");
    const isParentRelative = candidate !== repositoryRelative;
    const isRepoAbsolute =
      absoluteOwnerPath !== undefined &&
      (candidate === absoluteOwnerPath ||
        candidate.startsWith(`${absoluteOwnerPath}/`));
    const directOwnerIsInternal =
      ownerPath !== "scripts" || context === "package-script";
    if (
      isRepoAbsolute ||
      (owns(repositoryRelative) && (directOwnerIsInternal || isParentRelative))
    ) {
      return true;
    }
  }

  if (
    absoluteOwnerPath !== undefined &&
    fileUrlPaths(normalizedText).some(
      (candidate) =>
        candidate === absoluteOwnerPath ||
        candidate.startsWith(`${absoluteOwnerPath}/`)
    )
  ) {
    return true;
  }

  if (repositoryPaths.some(owns)) return true;

  if (
    (context === "package-script" &&
      hasProtectedRootCommandArgument(shellText, normalizedOwner, repoRoot)) ||
    (context === "generated" &&
      (hasGeneratedShellOwnerToken(
        shellText,
        normalizedOwner,
        repoRoot,
        ownerPath !== "scripts"
      ) ||
        (shellCommand &&
          hasProtectedRootCommandArgument(
            shellText,
            normalizedOwner,
            repoRoot,
            ownerPath !== "scripts"
          ))))
  ) {
    return true;
  }

  const escapedOwner = ownerPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const actionPattern = new RegExp(
    `\\b(?:${PROTECTED_PATH_ACTIONS})\\s+(?:[\\x60<{[(])?(?:\\./)?${escapedOwner}\\/?(?=$|[\\x60>\\]})]|\\.{2,}|[.,?:!](?=$|\\s)|\\s*(?:&&|\\|\\||\\d*[<>]|[;&|#])|\\s+(?:directory|folder)\\b)`,
    "iu"
  );
  const repoPattern = new RegExp(
    `\\brepo:${escapedOwner}(?=$|/|[^a-z0-9_.-])`,
    "iu"
  );
  const wrappedPattern = new RegExp(
    `(?:\\x60${escapedOwner}\\/?\\x60|<${escapedOwner}\\/?>|\\[${escapedOwner}\\/?\\]|\\{${escapedOwner}\\/?\\})`,
    "iu"
  );
  return (
    actionPattern.test(normalizedText) ||
    repoPattern.test(normalizedText) ||
    (ownerPath !== "scripts" && wrappedPattern.test(normalizedText))
  );
}

/**
 * Resolves literal `$PWD`, `${PWD}`, `$(pwd)`, and `` `pwd` ``
 * working-directory expansions against the repository root so shell guidance
 * cannot conceal a protected route behind the expansion prefix. Without a known
 * root the expansion becomes `.`, which keeps the remainder
 * repository-relative.
 */
function expandWorkingDirectoryVariables(
  text: string,
  repoRoot: string | undefined
): string {
  if (!(text.includes("$") || text.includes("`"))) return text;
  const normalizedRoot = repoRoot
    ?.replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .trim();
  const replacement =
    normalizedRoot === undefined || normalizedRoot.length === 0
      ? "."
      : normalizedRoot;
  return text.replace(WORKING_DIRECTORY_VARIABLE_PATTERN, () => replacement);
}

/**
 * Percent-decodes relative Markdown and HTML link destinations before the
 * closure rules run. Absolute URLs keep their own decoding path, and malformed
 * escapes degrade to per-escape decoding so a single invalid sequence neither
 * throws nor hides the valid escapes around it.
 */
function decodeRelativeLinkDestinations(text: string): string {
  if (!text.includes("%")) return text;
  return text.replace(
    LINK_DESTINATION_PATTERN,
    (match: string, prefix: string, destination: string) =>
      isRelativeLinkDestination(destination)
        ? `${prefix}${decodePercentEncodedPath(destination)}`
        : match
  );
}

function isRelativeLinkDestination(destination: string): boolean {
  if (destination.length === 0 || destination.startsWith("#")) return false;
  if (destination.startsWith("//")) return false;
  return !ABSOLUTE_LINK_SCHEME_PATTERN.test(destination);
}

function decodePercentEncodedPath(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%[0-9a-f]{2}/giu, (escape) => {
      try {
        return decodeURIComponent(escape);
      } catch {
        return escape;
      }
    });
  }
}

function normalizeLiteralShellPathQuotes(text: string): string {
  let normalized = text;
  while (true) {
    const next = normalized.replace(/(["'])([a-z0-9._@:+\/-]*)\1/giu, "$2");
    if (next === normalized) return normalized;
    normalized = next;
  }
}

function collapseRepeatedPathSeparators(text: string): string {
  return text.replace(/\/{2,}/gu, "/");
}

function withoutHttpUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s`"'<>]+/giu, " ");
}

function fileUrlPaths(text: string): readonly string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(/\bfile:\/\/\/[^\s`"'<>]+/giu)) {
    const value = match[0].replace(/[!,.?:;]+$/u, "");
    try {
      let path = decodeURIComponent(new URL(value).pathname).replaceAll(
        "\\",
        "/"
      );
      if (/^\/[a-z]:\//iu.test(path)) path = path.slice(1);
      paths.push(posix.normalize(path).toLowerCase());
    } catch {
      // Malformed file URLs are not treated as repository paths.
    }
  }
  return paths;
}

function repositoryHttpPaths(text: string): readonly string[] {
  const paths: string[] = [];
  const appendSuffixes = (
    segments: readonly string[],
    firstPathIndex: number
  ): void => {
    for (let index = firstPathIndex; index < segments.length; index += 1) {
      paths.push(
        posix.normalize(segments.slice(index).join("/")).toLowerCase()
      );
    }
  };
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s`"'<>]+/giu)) {
    const value = trimUrlClosingDelimiters(match[0].replace(/[!,.?:;]+$/u, ""));
    try {
      const url = new URL(value);
      const segments = decodeURIComponent(url.pathname)
        .split("/")
        .filter(Boolean);
      const host = url.hostname.toLowerCase();
      const isRepository =
        segments[0]?.toLowerCase() === PUBLIC_REPOSITORY_OWNER &&
        segments[1]?.toLowerCase() === PUBLIC_REPOSITORY_NAME;
      if (!isRepository) continue;

      if (
        host === "github.com" &&
        GITHUB_FILE_VIEW_ROUTES.has(segments[2]?.toLowerCase() ?? "") &&
        segments.length > 4
      ) {
        appendSuffixes(segments, 4);
      } else if (host === "raw.githubusercontent.com" && segments.length > 3) {
        appendSuffixes(segments, 3);
      }
    } catch {
      // Malformed or undecodable URLs are not treated as repository paths.
    }
  }
  return paths;
}

function trimUrlClosingDelimiters(value: string): string {
  let trimmed = value;
  for (const [opening, closing] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    while (
      trimmed.endsWith(closing) &&
      [...trimmed].filter((character) => character === closing).length >
        [...trimmed].filter((character) => character === opening).length
    ) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}

function normalizeShellToken(token: string): string {
  return token.replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function hasProtectedRootCommandArgument(
  command: string,
  normalizedOwner: string,
  repoRoot?: string,
  allowDirectOwner = true
): boolean {
  return readShellCommandSegments(markLiteralShellBraces(command)).some(
    (segment) => {
      const tokens = unwrapShellCommand(segment);
      const normalizedTokens = tokens.map((token) =>
        normalizeShellToken(token).toLowerCase()
      );
      return (
        (PROTECTED_ROOT_PATH_COMMANDS.has(normalizedTokens[0] ?? "") &&
          (normalizedTokens.slice(1).includes(normalizedOwner) ||
            hasCommandDirectoryOptionRoute(
              tokens,
              normalizedOwner,
              repoRoot
            ))) ||
        hasSearchCommandProtectedPathArgument(
          tokens,
          normalizedOwner,
          repoRoot,
          allowDirectOwner
        ) ||
        hasGitProtectedDirectoryArgument(tokens, normalizedOwner) ||
        hasPackageRunnerProtectedDirectoryArgument(
          tokens,
          normalizedOwner,
          repoRoot
        ) ||
        hasShellWrapperProtectedDirectoryArgument(
          segment,
          normalizedOwner,
          repoRoot
        )
      );
    }
  );
}

function hasSearchCommandProtectedPathArgument(
  tokens: readonly string[],
  normalizedOwner: string,
  repoRoot?: string,
  allowDirectOwner = true
): boolean {
  const dialect = SEARCH_COMMAND_DIALECTS[tokens[0]?.toLowerCase() ?? ""];
  if (!dialect) return false;
  let hasPattern = false;
  let pathsOnly = false;
  let parseOptions = true;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (parseOptions && token.startsWith("-") && token !== "-") {
      if (dialect.pathOnlyFlags.has(token)) {
        pathsOnly = true;
        continue;
      }
      const longFlag = token.split("=", 1)[0] ?? token;
      const shortValue = searchCommandShortValueFlag(token, dialect.valueFlags);
      const valueFlag = dialect.valueFlags.has(token)
        ? token
        : dialect.valueFlags.has(longFlag)
          ? longFlag
          : shortValue?.flag;
      if (!valueFlag) continue;
      if (dialect.patternValueFlags.has(valueFlag)) hasPattern = true;
      const hasAttachedValue = token.startsWith("--")
        ? token.includes("=")
        : shortValue?.attached === true;
      if (
        dialect.optionalAttachedValueFlags.has(valueFlag) &&
        !hasAttachedValue
      ) {
        continue;
      }
      let operand: ReturnType<typeof readSearchCommandShellWord>;
      if (hasAttachedValue) {
        const value = token.startsWith("--")
          ? token.slice(token.indexOf("=") + 1)
          : token.slice(shortValue?.valueStart ?? token.length);
        operand = { lastIndex: index, values: [value] };
      } else {
        operand = readSearchCommandShellWord(tokens, index + 1);
      }
      if (!operand) return false;
      if (
        dialect.pathValueFlags.has(valueFlag) &&
        operand.values.some((value) =>
          searchCommandPathMatchesOwner(
            value,
            normalizedOwner,
            repoRoot,
            allowDirectOwner
          )
        )
      ) {
        return true;
      }
      if (
        dialect.commandValueFlags.has(valueFlag) &&
        operand.values.some(
          (value) =>
            searchCommandPathMatchesOwner(
              value,
              normalizedOwner,
              repoRoot,
              allowDirectOwner
            ) ||
            searchCommandValueMatchesOwner(
              value,
              normalizedOwner,
              repoRoot,
              allowDirectOwner
            ) ||
            hasProtectedRootCommandArgument(
              value,
              normalizedOwner,
              repoRoot,
              allowDirectOwner
            )
        )
      ) {
        return true;
      }
      if (!hasAttachedValue) {
        index = operand.lastIndex;
      }
      continue;
    }

    const operand = readSearchCommandShellWord(tokens, index);
    if (!operand) return false;
    index = operand.lastIndex;
    if (!(pathsOnly || hasPattern)) {
      hasPattern = true;
      continue;
    }
    if (
      operand.values.some((value) =>
        searchCommandPathMatchesOwner(
          value,
          normalizedOwner,
          repoRoot,
          allowDirectOwner
        )
      )
    )
      return true;
  }
  return false;
}

function searchCommandValueMatchesOwner(
  command: string,
  normalizedOwner: string,
  repoRoot?: string,
  allowDirectOwner = true
): boolean {
  return readShellCommandSegments(markLiteralShellBraces(command)).some(
    (segment) => {
      const tokens = unwrapShellCommand(segment);
      return (
        PROTECTED_ROOT_PATH_COMMANDS.has(tokens[0]?.toLowerCase() ?? "") &&
        tokens
          .slice(1)
          .some((token) =>
            searchCommandPathMatchesOwner(
              token,
              normalizedOwner,
              repoRoot,
              allowDirectOwner
            )
          )
      );
    }
  );
}

function readSearchCommandShellWord(
  tokens: readonly string[],
  index: number
):
  | { readonly lastIndex: number; readonly values: readonly string[] }
  | undefined {
  const first = tokens[index];
  if (first === undefined) return undefined;
  const opening = first.indexOf("{");
  if (opening < 0) return { lastIndex: index, values: [first] };

  let lastIndex = index;
  while (
    lastIndex < tokens.length &&
    !(tokens[lastIndex] ?? "").includes("}")
  ) {
    lastIndex += 1;
  }
  if (lastIndex >= tokens.length) return { lastIndex: index, values: [first] };
  const combined = tokens.slice(index, lastIndex + 1).join(",");
  const closing = combined.indexOf("}", opening + 1);
  if (closing < 0) return { lastIndex: index, values: [first] };
  const prefix = combined.slice(0, opening);
  const suffix = combined.slice(closing + 1);
  const alternatives = combined.slice(opening + 1, closing).split(",");
  return {
    lastIndex,
    values: alternatives.map(
      (alternative) => `${prefix}${alternative}${suffix}`
    ),
  };
}

function searchCommandPathMatchesOwner(
  operand: string,
  normalizedOwner: string,
  repoRoot?: string,
  allowDirectOwner = true
): boolean {
  const normalizedPath = posix
    .normalize(
      collapseRepeatedPathSeparators(
        normalizeShellToken(operand.replaceAll("\\", "/"))
      )
    )
    .toLowerCase();
  const normalizedRoot = repoRoot
    ?.replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
  const absoluteOwner = normalizedRoot
    ? posix.normalize(`${normalizedRoot}/${normalizedOwner}`)
    : undefined;
  if (posix.isAbsolute(normalizedPath)) {
    if (!normalizedRoot) return false;
    if (
      absoluteOwner &&
      (normalizedPath === absoluteOwner ||
        normalizedPath.startsWith(`${absoluteOwner}/`))
    ) {
      return true;
    }
    if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return false;
    return searchCommandGlobContainsOwner(
      normalizedPath.slice(normalizedRoot.length + 1),
      normalizedOwner
    );
  }
  const repositoryRelative = normalizedPath.replace(/^(?:\.\.\/)+/u, "");
  const isParentRelative = repositoryRelative !== normalizedPath;
  return (
    ((allowDirectOwner || isParentRelative) &&
      (repositoryRelative === normalizedOwner ||
        repositoryRelative.startsWith(`${normalizedOwner}/`))) ||
    (allowDirectOwner &&
      searchCommandGlobContainsOwner(repositoryRelative, normalizedOwner))
  );
}

function searchCommandGlobContainsOwner(
  operand: string,
  normalizedOwner: string
): boolean {
  if (!/(?:\*|\?|\[)/u.test(operand)) return false;
  const segments = operand.split("/");
  const ownerSegments = normalizedOwner.split("/");
  return segments.some((_, index) =>
    ownerSegments.every(
      (ownerSegment, offset) => segments[index + offset] === ownerSegment
    )
  );
}

function searchCommandShortValueFlag(
  token: string,
  valueFlags: ReadonlySet<string>
):
  | {
      readonly attached: boolean;
      readonly flag: string;
      readonly valueStart: number;
    }
  | undefined {
  if (!/^-[^-]/u.test(token)) return undefined;
  for (let index = 1; index < token.length; index += 1) {
    const flag = `-${token[index] ?? ""}`;
    if (valueFlags.has(flag)) {
      return {
        attached: index + 1 < token.length,
        flag,
        valueStart: index + 1,
      };
    }
  }
  return undefined;
}

function withoutSearchCommandSegments(
  text: string,
  assumeShellCommand: boolean
): string {
  const withoutSegments = (command: string): string =>
    readShellCommandSegments(markLiteralShellBraces(command))
      .filter(
        (segment) =>
          SEARCH_COMMAND_DIALECTS[
            unwrapShellCommand(segment)[0]?.toLowerCase() ?? ""
          ] === undefined
      )
      .map((segment) => segment.join(" "))
      .join(" ");
  if (assumeShellCommand) return withoutSegments(text);
  return text.replace(/`([^`\r\n]+)`/gu, (wrapped, command: string) => {
    const remaining = withoutSegments(command);
    return remaining === command ? wrapped : remaining;
  });
}

function markLiteralShellBraces(text: string): string {
  return text.replace(/'(?:[^']*)'|"(?:\\.|[^"])*"|\\[{}]/gu, (literal) =>
    literal
      .replaceAll("\\{", LITERAL_OPEN_BRACE)
      .replaceAll("\\}", LITERAL_CLOSE_BRACE)
      .replaceAll("{", LITERAL_OPEN_BRACE)
      .replaceAll("}", LITERAL_CLOSE_BRACE)
  );
}

function searchCommandSegments(
  text: string,
  assumeShellCommand: boolean
): readonly (readonly string[])[] {
  const commands = assumeShellCommand
    ? [text]
    : [...text.matchAll(/`([^`\r\n]+)`/gu)].map((match) => match[1] ?? "");
  return commands.flatMap((command) =>
    readShellCommandSegments(markLiteralShellBraces(command))
      .map(unwrapShellCommand)
      .filter(
        (tokens) =>
          SEARCH_COMMAND_DIALECTS[tokens[0]?.toLowerCase() ?? ""] !== undefined
      )
  );
}

function hasGitProtectedDirectoryArgument(
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
    if (token === "--" || !token.startsWith("-")) break;
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

/**
 * Reads the operand fused into an option token, covering the attached long
 * (`--target-directory=dir`) and attached short (`-tdir`, including the bundled
 * `-rtdir`) spellings GNU option parsing accepts.
 */
function attachedOptionValue(
  token: string,
  flags: ReadonlySet<string>
): string | undefined {
  if (token.startsWith("--")) {
    const separator = token.indexOf("=");
    if (separator <= 0 || !flags.has(token.slice(0, separator))) {
      return undefined;
    }
    const attached = token.slice(separator + 1);
    return attached.length > 0 ? attached : undefined;
  }
  const shortValue = searchCommandShortValueFlag(token, flags);
  return shortValue?.attached === true
    ? token.slice(shortValue.valueStart)
    : undefined;
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
function hasCommandDirectoryOptionRoute(
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
      searchCommandPathMatchesOwner(operand, normalizedOwner, repoRoot)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Reports whether a package-runner invocation routes into a protected directory
 * through a directory-valued runner option, so `npm --prefix packages install`
 * cannot install into the protected tree while the closure check passes. The
 * runners are not {@link PROTECTED_ROOT_PATH_COMMANDS} members, so no bare
 * owner token is checked for them, and the operand carries no separator for the
 * generic path scan to read. Direct owner routes count, matching `git -C` and
 * the wrapper `chdir` options: naming the owner as a runner's working directory
 * is a repository route even where a bare owner-named path would read as
 * plugin-local.
 */
function hasPackageRunnerProtectedDirectoryArgument(
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
    if (searchCommandPathMatchesOwner(operand, normalizedOwner, repoRoot)) {
      return true;
    }
  }
  return false;
}

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
    if (
      !["command", "env", "exec", "nice", "nohup", "sudo", "time"].includes(
        wrapper
      )
    ) {
      break;
    }
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

function unwrapShellCommand(tokens: readonly string[]): readonly string[] {
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
function hasShellWrapperProtectedDirectoryArgument(
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
    if (searchCommandPathMatchesOwner(directory, normalizedOwner, repoRoot)) {
      return true;
    }
  }
  return false;
}

function hasGeneratedShellOwnerToken(
  text: string,
  normalizedOwner: string,
  repoRoot?: string,
  allowDirectOwner = true
): boolean {
  return [...text.matchAll(/`([^`\r\n]+)`/gu)].some((match) => {
    const command = match[1] ?? "";
    return (
      /\s/u.test(command) &&
      hasProtectedRootCommandArgument(
        command,
        normalizedOwner,
        repoRoot,
        allowDirectOwner
      )
    );
  });
}

function shellLogicalLines(
  content: string,
  recognizeMarkdownFences = false
): readonly ShellLogicalLine[] {
  const lines = content.split(/\r?\n/u);
  const logicalLines: ShellLogicalLine[] = [];
  let fence: MarkdownFence | undefined;
  let line = 1;
  let shellCommand = false;
  let text = "";

  for (const [index, physicalLine] of lines.entries()) {
    if (text.length === 0) {
      line = index + 1;
      if (recognizeMarkdownFences) {
        const delimiter = markdownFenceDelimiter(physicalLine);
        if (delimiter && fence) {
          if (
            delimiter.character === fence.character &&
            delimiter.length >= fence.length &&
            delimiter.info.length === 0
          ) {
            fence = undefined;
            logicalLines.push({
              line,
              shellCommand: false,
              text: physicalLine,
            });
            continue;
          }
        } else if (delimiter) {
          fence = {
            character: delimiter.character,
            length: delimiter.length,
            shell:
              /^(?:(?:bash|sh|shell|zsh)(?:\s|$)|\{\.(?:bash|sh|shell|zsh)(?:\s|\}))/iu.test(
                delimiter.info
              ),
          };
          logicalLines.push({
            line,
            shellCommand: false,
            text: physicalLine,
          });
          continue;
        }
      }
      shellCommand = fence?.shell === true;
    }
    if (physicalLine.endsWith("\\")) {
      text += physicalLine.slice(0, -1);
    } else {
      logicalLines.push({ line, shellCommand, text: text + physicalLine });
      text = "";
    }
  }
  if (text.length > 0) logicalLines.push({ line, shellCommand, text });
  return logicalLines;
}

function markdownFenceDelimiter(
  line: string
): MarkdownFenceDelimiter | undefined {
  const match = /^(?: {0,3})(?<marker>`{3,}|~{3,})(?<info>.*)$/u.exec(line);
  const marker = match?.groups?.marker;
  if (!marker) return undefined;
  return {
    character: marker[0] as "`" | "~",
    info: (match?.groups?.info ?? "").trim(),
    length: marker.length,
  };
}

function readCommandToken(text: string, offset: number): CommandToken | null {
  let start = offset;
  while (/\s/u.test(text[start] ?? "")) start += 1;
  while (text[start] === "`") start += 1;
  let end = start;
  let value = "";
  let consumed = false;
  while (end < text.length) {
    const character = text[end] ?? "";
    if (/[\s`();,<>|&]/u.test(character)) break;
    if (character === '"' || character === "'") {
      const quote = character;
      consumed = true;
      end += 1;
      let closed = false;
      while (end < text.length) {
        const quotedCharacter = text[end] ?? "";
        if (quotedCharacter === quote) {
          closed = true;
          end += 1;
          break;
        }
        if (
          quote === '"' &&
          quotedCharacter === "\\" &&
          end + 1 < text.length &&
          /[$`"\\\n]/u.test(text[end + 1] ?? "")
        ) {
          end += 1;
          value += text[end];
        } else {
          value += quotedCharacter;
        }
        end += 1;
      }
      if (!closed) return null;
      continue;
    }
    if (character === "\\" && end + 1 < text.length) {
      end += 1;
      value += text[end];
    } else {
      value += character;
    }
    consumed = true;
    end += 1;
  }
  return consumed ? { end, value } : null;
}

function readShellCommandSegments(
  text: string
): readonly (readonly string[])[] {
  const segments: string[][] = [[]];
  let offset = 0;
  while (offset < text.length) {
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
    if (
      (segments.at(-1)?.length ?? 0) === 0 &&
      text[offset] === ">" &&
      /\s/u.test(text[offset + 1] ?? "")
    ) {
      segments.at(-1)?.push(">");
      offset += 1;
      continue;
    }
    const boundary = /^(?:&&|\|\||[;&|])/u.exec(text.slice(offset));
    if (boundary) {
      if ((segments.at(-1)?.length ?? 0) > 0) segments.push([]);
      offset += boundary[0].length;
      continue;
    }
    const redirection = /^(?:\d+)?(?:<>|>&|<&|>>|<<|>|<)/u.exec(
      text.slice(offset)
    );
    if (redirection) {
      offset += redirection[0].length;
      const target = readCommandToken(text, offset);
      offset = target?.end ?? offset;
      continue;
    }
    const token = readCommandToken(text, offset);
    if (token) {
      segments.at(-1)?.push(token.value);
      offset = token.end;
    } else {
      offset += 1;
    }
  }
  return segments.filter((segment) => segment.length > 0);
}

function readRunnerTokens(
  text: string,
  offset: number,
  runner: PackageRunner,
  options: {
    readonly consumeYarnRequireBeforeRun?: boolean;
    readonly requiredValueFlags?: ReadonlySet<string>;
    readonly skipArgumentDelimiter?: boolean;
  } = {}
): readonly CommandToken[] {
  const visit = (
    token: CommandToken | null,
    maySkipArgumentDelimiter: boolean,
    requiresExplicitRun = false
  ): readonly CommandToken[] => {
    if (!token) return [];
    if (token.value === "--") {
      const script = readCommandToken(text, token.end);
      return maySkipArgumentDelimiter && script ? [script] : [];
    }
    if (!token.value.startsWith("-")) {
      return requiresExplicitRun && token.value.toLowerCase() !== "run"
        ? []
        : [token];
    }

    const next = readCommandToken(text, token.end);
    if (
      runner === "yarn" &&
      options.consumeYarnRequireBeforeRun === true &&
      (token.value === "--require" || token.value.startsWith("--require="))
    ) {
      const command =
        token.value === "--require"
          ? next
            ? readCommandToken(text, next.end)
            : null
          : next;
      return visit(command, maySkipArgumentDelimiter, true);
    }
    if (
      RUNNER_VALUE_FLAGS[runner].has(token.value) ||
      options.requiredValueFlags?.has(token.value) === true
    ) {
      return next
        ? visit(
            readCommandToken(text, next.end),
            maySkipArgumentDelimiter,
            requiresExplicitRun
          )
        : [];
    }
    return visit(next, maySkipArgumentDelimiter, requiresExplicitRun);
  };

  return visit(
    readCommandToken(text, offset),
    options.skipArgumentDelimiter === true
  );
}

function readConfiguredRunnerTokens(
  text: string,
  offset: number,
  valueFlags: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string>,
  acceptsToken: (token: CommandToken) => boolean
): readonly CommandToken[] {
  const memo = new Map<number, readonly CommandToken[]>();

  function visit(token: CommandToken | null): readonly CommandToken[] {
    if (!token) return [];
    const cached = memo.get(token.end);
    if (cached) return cached;
    const result = visitUncached(token);
    memo.set(token.end, result);
    return result;
  }

  function visitUncached(token: CommandToken): readonly CommandToken[] {
    if (token.value === "--") {
      const selected = readCommandToken(text, token.end);
      return selected && acceptsToken(selected) ? [selected] : [];
    }
    if (!token.value.startsWith("-")) {
      return acceptsToken(token) ? [token] : [];
    }

    const next = readCommandToken(text, token.end);
    if (valueFlags.has(token.value)) {
      return next ? visit(readCommandToken(text, next.end)) : [];
    }
    if (
      token.value.includes("=") ||
      token.value.startsWith("--no-") ||
      booleanFlags.has(token.value)
    ) {
      return visit(next);
    }

    const candidates = [...visit(next)];
    if (next) candidates.push(...visit(readCommandToken(text, next.end)));
    return candidates.filter(
      (candidate, index) =>
        candidates.findIndex(
          (item) => item.end === candidate.end && item.value === candidate.value
        ) === index
    );
  }

  return visit(readCommandToken(text, offset));
}

function readNpmPreCommandTokens(
  text: string,
  offset: number
): readonly CommandToken[] {
  const commandNames = new Set([
    ...NPM_RUN_COMMANDS,
    ...Object.keys(NPM_LIFECYCLE_SCRIPTS),
  ]);
  return readConfiguredRunnerTokens(
    text,
    offset,
    RUNNER_VALUE_FLAGS.npm,
    NPM_PRE_COMMAND_BOOLEAN_FLAGS,
    (token) => commandNames.has(token.value.toLowerCase())
  );
}

function readNpmRunScriptTokens(
  text: string,
  offset: number,
  packageScriptNames?: ReadonlySet<string>
): readonly CommandToken[] {
  return readConfiguredRunnerTokens(
    text,
    offset,
    RUNNER_VALUE_FLAGS.npm,
    NPM_PRE_COMMAND_BOOLEAN_FLAGS,
    (token) => packageScriptNames?.has(token.value) !== false
  );
}

function readPnpmRunScriptTokens(
  text: string,
  offset: number,
  packageScriptNames?: ReadonlySet<string>
): readonly CommandToken[] {
  return readConfiguredRunnerTokens(
    text,
    offset,
    RUNNER_VALUE_FLAGS.pnpm,
    PNPM_RUN_BOOLEAN_FLAGS,
    (token) => packageScriptNames?.has(token.value) !== false
  );
}

/**
 * Statically recognizes `runner [flags] run [flags] script` for Bun, pnpm,
 * and Yarn; npm also accepts its `run-script`, `rum`, and `urn` aliases, while
 * pnpm also accepts `run-script`. Bun, pnpm, and Yarn accept non-builtin
 * `runner [flags] script` shorthand. npm accepts only its finite lifecycle
 * shorthand (`start`, `stop`, `restart`, and `test` plus `t`/`tst`). Script
 * names may be bare or single-/double-quoted.
 * Bounded required-value flags (`npm --prefix`, `-w`/`--workspace`,
 * `--script-shell`; the corresponding Bun forms; Yarn's global `--cwd` and
 * run-scoped `--require`; and `pnpm --dir`, `-C`, `--filter`, or `-F`) consume
 * one following token. Other
 * flags must be self-contained (for example `--silent` or `--cwd=path`). npm
 * additionally branches unknown config flags as boolean-or-value and filters
 * possible script tokens through the package-script inventory. npm, Bun, and
 * pnpm package-script execution includes
 * bounded pre/post lifecycle edges; npm `restart` chooses restart or stop/start
 * fallback edges from the supplied script inventory. This does not expand
 * variables or parse general shell syntax.
 */
function invokedPackageScripts(
  text: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  return shellLogicalLines(text).flatMap((line) =>
    invokedPackageScriptsOnLine(line.text, packageScriptNames)
  );
}

function invokedPackageScriptsOnLine(
  text: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  const scripts: string[] = [];
  for (const match of text.matchAll(PACKAGE_RUNNER_PATTERN)) {
    const runner = match.groups?.runner?.toLowerCase() as
      | PackageRunner
      | undefined;
    if (!(runner && match.index !== undefined)) continue;
    const commandTokens =
      runner === "npm"
        ? readNpmPreCommandTokens(text, match.index + match[0].length)
        : readRunnerTokens(text, match.index + match[0].length, runner, {
            consumeYarnRequireBeforeRun: runner === "yarn",
          });
    for (const commandToken of commandTokens) {
      scripts.push(
        ...invokedPackageScriptsForCommand(
          text,
          runner,
          commandToken,
          packageScriptNames
        )
      );
    }
  }
  return [...new Set(scripts)];
}

function invokedPackageScriptsForCommand(
  text: string,
  runner: PackageRunner,
  commandToken: CommandToken,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  const scripts: string[] = [];
  const command = commandToken.value.toLowerCase();
  const isRunCommand =
    runner === "npm"
      ? NPM_RUN_COMMANDS.has(command)
      : runner === "pnpm"
        ? PNPM_RUN_COMMANDS.has(command)
        : command === "run";
  if (isRunCommand) {
    const scriptTokens =
      runner === "npm"
        ? readNpmRunScriptTokens(text, commandToken.end, packageScriptNames)
        : runner === "pnpm"
          ? readPnpmRunScriptTokens(text, commandToken.end, packageScriptNames)
          : readRunnerTokens(text, commandToken.end, runner, {
              ...(runner === "yarn"
                ? { requiredValueFlags: YARN_RUN_REQUIRED_VALUE_FLAGS }
                : {}),
              skipArgumentDelimiter: runner !== "yarn",
            });
    for (const token of scriptTokens) {
      if (runner === "npm") {
        scripts.push(...npmLifecycleEdges(token.value, packageScriptNames));
      } else if (runner === "bun" || runner === "pnpm") {
        scripts.push(...packageLifecycleEdges(token.value, packageScriptNames));
      } else {
        scripts.push(token.value);
      }
    }
    return scripts;
  }
  if (runner === "npm") {
    const lifecycleScript = NPM_LIFECYCLE_SCRIPTS[command];
    if (lifecycleScript) {
      scripts.push(...npmLifecycleEdges(lifecycleScript, packageScriptNames));
    }
    return scripts;
  }
  if (RUNNER_BUILTINS[runner].has(command)) return scripts;
  if (runner === "bun" || runner === "pnpm") {
    scripts.push(
      ...packageLifecycleEdges(commandToken.value, packageScriptNames)
    );
  } else {
    scripts.push(commandToken.value);
  }
  return scripts;
}

function packageLifecycleEdges(
  script: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  if (packageScriptNames && !packageScriptNames.has(script)) return [];
  return [`pre${script}`, script, `post${script}`];
}

function npmLifecycleEdges(
  script: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  if (script !== "restart") return [`pre${script}`, script, `post${script}`];
  const restartEdges = ["prerestart", "restart", "postrestart"];
  const fallbackEdges = [
    ...(packageScriptNames?.has("stop") === false
      ? []
      : ["prestop", "stop", "poststop"]),
    ...(packageScriptNames?.has("start") === false
      ? []
      : ["prestart", "start", "poststart"]),
  ];
  if (!packageScriptNames) {
    return [...restartEdges, "prerestart", ...fallbackEdges, "postrestart"];
  }
  if (packageScriptNames.has("restart")) return restartEdges;
  return fallbackEdges.length > 0
    ? ["prerestart", ...fallbackEdges, "postrestart"]
    : [];
}

export function findRepoInternalScriptAliases(
  packageScripts: PackageScripts,
  repoInternalScripts: readonly string[],
  repoRoot?: string
): ReadonlySet<string> {
  const aliases = new Set<string>();
  const packageScriptNames = new Set(Object.keys(packageScripts));
  let changed = true;

  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(packageScripts)) {
      if (aliases.has(name)) continue;
      const commandLines = shellLogicalLines(command).map((line) => line.text);
      const referencesInternalBoundary = commandLines.some(
        (line) =>
          matchingProtectedBoundaryRules(line, repoRoot, "package-script")
            .length > 0 ||
          repoInternalScripts.some((path) =>
            hasRepoInternalScriptReference(line, path, repoRoot, true)
          )
      );
      const referencesInternalAlias = invokedPackageScripts(
        command,
        packageScriptNames
      ).some((dependency) => aliases.has(dependency));
      if (referencesInternalBoundary || referencesInternalAlias) {
        aliases.add(name);
        changed = true;
      }
    }
  }

  return aliases;
}

function hasRepoInternalScriptReference(
  text: string,
  path: string,
  repoRoot?: string,
  shellCommand = false
): boolean {
  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  if (
    searchCommandSegments(
      expandWorkingDirectoryVariables(text, repoRoot),
      shellCommand
    ).some((tokens) =>
      hasSearchCommandProtectedPathArgument(tokens, normalizedPath, repoRoot)
    )
  ) {
    return true;
  }
  const normalizedText = collapseRepeatedPathSeparators(
    withoutHttpUrls(
      withoutSearchCommandSegments(
        normalizeLiteralShellPathQuotes(
          expandWorkingDirectoryVariables(
            decodeRelativeLinkDestinations(text),
            repoRoot
          ).replaceAll("\\", "/")
        ),
        shellCommand
      )
    )
  ).toLowerCase();
  if (
    hasBarePathReference(normalizedText, normalizedPath) ||
    hasBarePathReference(normalizedText, `./${normalizedPath}`)
  ) {
    return true;
  }

  const escapedPath = normalizedPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const parentRelativePattern = new RegExp(
    `^(?:\\.\\./)+${escapedPath}$`,
    "iu"
  );
  const absoluteRepoPath =
    repoRoot === undefined
      ? undefined
      : posix.normalize(
          `${repoRoot.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()}/${normalizedPath}`
        );

  for (const match of normalizedText.matchAll(PATH_CANDIDATE_PATTERN)) {
    const candidate = posix.normalize(match[0].replace(/[!,.?:;]+$/u, ""));
    if (
      candidate === normalizedPath ||
      parentRelativePattern.test(candidate) ||
      candidate === absoluteRepoPath
    ) {
      return true;
    }
  }
  return false;
}

function hasBarePathReference(text: string, path: string): boolean {
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(path, offset);
    if (index < 0) return false;
    const before = text[index - 1];
    const after = text[index + path.length];
    if (
      (before === undefined || !/[a-z0-9_./:-]/iu.test(before)) &&
      (after === undefined || !/[a-z0-9_/-]/iu.test(after))
    ) {
      return true;
    }
    offset = index + path.length;
  }
  return false;
}

async function filesBelow(directory: string): Promise<readonly string[]> {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else if (entry.isSymbolicLink()) {
        throw new Error(
          `skillset: public closure guard refuses symbolic link ${path}`
        );
      } else {
        throw new Error(
          `skillset: public closure guard refuses unsupported filesystem entry ${path}`
        );
      }
    }
  };

  await visit(directory);
  return files.toSorted();
}

export async function scanGeneratedPublicTree(
  rootDir: string
): Promise<PublicClosureScanResult> {
  const violations: PublicClosureViolation[] = [];
  let skippedBinaryFiles = 0;
  const files = await filesBelow(resolve(rootDir, PUBLIC_ROOT));
  const repoInternalScripts = (
    await filesBelow(resolve(rootDir, "scripts"))
  ).map((path) => relative(rootDir, path).replaceAll("\\", "/"));
  const packageJson = JSON.parse(
    await readFile(resolve(rootDir, "package.json"), "utf8")
  ) as { readonly scripts?: PackageScripts };
  const repoInternalScriptAliases = findRepoInternalScriptAliases(
    packageJson.scripts ?? {},
    repoInternalScripts,
    rootDir
  );
  const packageScriptNames = new Set(Object.keys(packageJson.scripts ?? {}));
  for (const path of files) {
    const content = await readFile(path);
    if (content.includes(0)) {
      skippedBinaryFiles += 1;
      continue;
    }
    const file = relative(rootDir, path).replaceAll("\\", "/");
    violations.push(
      ...scanGeneratedPublicContent(
        file,
        content.toString("utf8"),
        repoInternalScripts,
        repoInternalScriptAliases,
        packageScriptNames,
        rootDir
      )
    );
  }
  return {
    scannedFiles: files.length - skippedBinaryFiles,
    skippedBinaryFiles,
    violations,
  };
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const result = await scanGeneratedPublicTree(rootDir);
  if (result.violations.length > 0) {
    console.error(
      `skillset: public closure guard found ${result.violations.length} contributor or internal reference(s):`
    );
    for (const violation of result.violations) {
      console.error(
        `  ${violation.file}:${violation.line}: [${violation.rule}] ${violation.text}`
      );
    }
    process.exit(1);
  }
  const binaryNote =
    result.skippedBinaryFiles > 0
      ? `; skipped ${result.skippedBinaryFiles} binary file(s)`
      : "";
  console.error(
    `skillset: public closure guard scanned ${result.scannedFiles} generated public file(s)${binaryNote}; boundary is closed`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
