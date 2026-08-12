import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseCliRequest } from "../../apps/skillset/src/cli-args";
import { extractInlineMarkdownLinks } from "./markdown";

const PACKAGE_COMMAND =
  /^\s*(?:(?:bunx|npx) (?:skillset|@skillset\/cli)(?:@\S+)?|skillset)\s+(.+?)\s*$/gmu;
const AUTHORED_COMMAND_PATTERNS = [
  "docs/start/**/*.md",
  "docs/guides/**/*.md",
  "examples/**/README.md",
] as const;
const DISTRIBUTION_INSTALL_PATH = "docs/start/installation.md";
const GLOBAL_INSTALL_COMMAND = "npm install --global skillset";
const GLOBAL_FIRST_RUN = "skillset init";
const INSTALLATION_CONTRACT = [
  "npm install --global skillset",
  "brew install outfitter-dev/tap/skillset",
  "https://github.com/outfitter-dev/skillset/releases",
  "skillset-v<version>-darwin-arm64.tar.gz",
  "skillset-v<version>-darwin-x64.tar.gz",
  "skillset-v<version>-linux-arm64-glibc.tar.gz",
  "skillset-v<version>-linux-x64-glibc.tar.gz",
  "skillset-v<version>-windows-x64.zip",
  "skillset-v<version>-manifest.json",
  "skillset-v<version>-SHA256SUMS",
  "gh attestation verify <archive> --repo outfitter-dev/skillset",
  "bun add --global @skillset/cli",
  "bunx @skillset/cli --version",
  "bun add --dev @skillset/cli",
  "./scripts/bootstrap.sh repo",
  "Node 18 launcher; no Bun",
  "Neither Bun nor Node",
  "complete Skillset command surface in the slimmer Bun distribution",
] as const;
const RETIRED_DISTRIBUTION_NAMES = [
  ["skillset-toolkit", /skillset-toolkit(?![\w.-])/u],
  ["skillset-ci", /skillset-ci(?![\w.-])/u],
  ["@skillset/bun", /@skillset\/bun(?![\w.-])/u],
  ["@skillset/ci", /@skillset\/ci(?![\w.-])/u],
] as const;
const ACTIVATION_INVARIANT =
  "Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration.";
const ACTIVATION_PAGE = "docs/start/build-versus-activation.md";
const REQUIRED_INVARIANT_PAGES = [
  "README.md",
  "docs/README.md",
  "docs/start/build-versus-activation.md",
  "docs/why-skillset.md",
  "examples/first-author/README.md",
] as const;

export function authoredCommandDiagnostics(
  pagePath: string,
  source: string
): readonly string[] {
  const diagnostics: string[] = [];
  for (const match of source.matchAll(PACKAGE_COMMAND)) {
    const commandLine = match[1];
    if (!commandLine) continue;
    if (["--help", "-h", "--version"].includes(commandLine)) continue;
    try {
      parseCliRequest(tokenizeShellWords(commandLine), {
        cwd: "/tmp/skillset-readme-contract",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.split("\n", 1)[0]
          : String(error);
      diagnostics.push(
        `${pagePath} documents an invalid command (${commandLine}): ${message}`
      );
    }
  }
  return diagnostics;
}

function tokenizeShellWords(source: string): readonly string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    words.push(current);
    current = "";
  };

  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      pushCurrent();
      continue;
    }
    current += character;
  }

  if (escaped) current += "\\";
  if (quote) throw new Error(`unterminated ${quote} quote`);
  pushCurrent();
  return words;
}

export function readmeCommandDiagnostics(source: string): readonly string[] {
  return authoredCommandDiagnostics("README.md", source);
}

export async function checkAuthoredCommands(
  root: string
): Promise<readonly string[]> {
  const paths = ["README.md", "docs/troubleshooting.md"];
  for (const pattern of AUTHORED_COMMAND_PATTERNS) {
    const glob = new Bun.Glob(pattern);
    for await (const pagePath of glob.scan({ cwd: root, onlyFiles: true })) {
      paths.push(pagePath);
    }
  }
  const diagnostics = await Promise.all(
    [...new Set(paths)].toSorted().map(async (pagePath) =>
      authoredCommandDiagnostics(
        pagePath,
        await readFile(path.join(root, pagePath), "utf8")
      )
    )
  );
  return diagnostics.flat();
}

export function distributionFrontDoorDiagnostics(
  pages: readonly { readonly path: string; readonly source: string }[]
): readonly string[] {
  const diagnostics: string[] = [];
  const pageMap = new Map(pages.map((page) => [page.path, page.source]));
  const readme = pageMap.get("README.md") ?? "";
  const installIndex = readme.indexOf(GLOBAL_INSTALL_COMMAND);
  const firstRunIndex = readme.indexOf(GLOBAL_FIRST_RUN);
  const earlierAlternative = [
    "brew install outfitter-dev/tap/skillset",
    "bun add --global @skillset/cli",
    "bun add --dev @skillset/cli",
    "bunx @skillset/cli",
  ].some((command) => {
    const alternativeIndex = readme.indexOf(command);
    return alternativeIndex >= 0 && alternativeIndex < installIndex;
  });
  if (installIndex < 0 || earlierAlternative) {
    diagnostics.push(`README.md must lead with ${GLOBAL_INSTALL_COMMAND}`);
  }
  if (installIndex < 0 || firstRunIndex <= installIndex) {
    diagnostics.push(
      `README.md must run ${GLOBAL_FIRST_RUN} after the global install`
    );
  }
  if (!readme.includes("docs/start/installation.md")) {
    diagnostics.push("README.md must link to docs/start/installation.md");
  }

  const installation = pageMap.get(DISTRIBUTION_INSTALL_PATH) ?? "";
  for (const required of INSTALLATION_CONTRACT) {
    if (!installation.includes(required)) {
      diagnostics.push(
        `${DISTRIBUTION_INSTALL_PATH}: missing distribution contract ${required}`
      );
    }
  }

  for (const page of pages) {
    for (const [name, pattern] of RETIRED_DISTRIBUTION_NAMES) {
      if (pattern.test(page.source)) {
        diagnostics.push(
          `${page.path}: retired public distribution name ${name}`
        );
      }
    }
  }
  return diagnostics;
}

export async function checkDistributionFrontDoor(
  root: string
): Promise<readonly string[]> {
  const paths = ["README.md"];
  for (const pattern of ["docs/**/*.md", "examples/**/README.md"]) {
    const glob = new Bun.Glob(pattern);
    for await (const pagePath of glob.scan({ cwd: root, onlyFiles: true })) {
      if (
        pagePath.startsWith("docs/adrs/") ||
        pagePath.startsWith("docs/project/plans/archive/")
      ) {
        continue;
      }
      paths.push(pagePath);
    }
  }
  return distributionFrontDoorDiagnostics(
    await Promise.all(
      [...new Set(paths)].toSorted().map(async (pagePath) => ({
        path: pagePath,
        source: await readFile(path.join(root, pagePath), "utf8"),
      }))
    )
  );
}

export function invariantLinkDiagnostics(
  pages: readonly { readonly path: string; readonly source: string }[]
): readonly string[] {
  const diagnostics: string[] = [];
  const pageMap = new Map(pages.map((page) => [page.path, page.source]));
  for (const requiredPath of REQUIRED_INVARIANT_PAGES) {
    if (!pageMap.get(requiredPath)?.includes(ACTIVATION_INVARIANT)) {
      diagnostics.push(
        `${requiredPath}: missing the canonical activation invariant`
      );
    }
  }
  for (const page of pages) {
    if (
      !page.source.includes(ACTIVATION_INVARIANT) ||
      page.path === ACTIVATION_PAGE ||
      page.path.startsWith("docs/project/plans/")
    ) {
      continue;
    }
    const linked = extractInlineMarkdownLinks(page.source).some((link) => {
      const destination = link.destination.split("#", 1)[0];
      if (!destination || /^[a-z][a-z+.-]*:/iu.test(destination)) return false;
      return (
        path.posix.normalize(
          path.posix.join(path.posix.dirname(page.path), destination)
        ) === ACTIVATION_PAGE
      );
    });
    if (!linked) {
      diagnostics.push(
        `${page.path}: activation invariant must link to ${ACTIVATION_PAGE}`
      );
    }
  }
  return diagnostics;
}

export async function checkInvariantLinks(
  root: string
): Promise<readonly string[]> {
  const paths = ["README.md"];
  for (const pattern of ["docs/**/*.md", "examples/**/README.md"]) {
    const glob = new Bun.Glob(pattern);
    for await (const pagePath of glob.scan({ cwd: root, onlyFiles: true })) {
      paths.push(pagePath);
    }
  }
  return invariantLinkDiagnostics(
    await Promise.all(
      paths.toSorted().map(async (pagePath) => ({
        path: pagePath,
        source: await readFile(path.join(root, pagePath), "utf8"),
      }))
    )
  );
}
