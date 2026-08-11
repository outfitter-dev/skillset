import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseCliRequest } from "../../apps/skillset/src/cli-args";
import { extractInlineMarkdownLinks } from "./markdown";

const PACKAGE_COMMAND =
  /^\s*(?:bunx|npx) (?:skillset|@skillset\/cli)(?:@\S+)?\s+(.+?)\s*$/gmu;
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

export function readmeCommandDiagnostics(source: string): readonly string[] {
  const diagnostics: string[] = [];
  for (const match of source.matchAll(PACKAGE_COMMAND)) {
    const commandLine = match[1];
    if (!commandLine) continue;
    try {
      parseCliRequest(commandLine.split(/\s+/u), {
        cwd: "/tmp/skillset-readme-contract",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.split("\n", 1)[0]
          : String(error);
      diagnostics.push(
        `README.md documents an invalid command (${commandLine}): ${message}`
      );
    }
  }
  return diagnostics;
}

export async function checkReadmeCommands(
  root: string
): Promise<readonly string[]> {
  return readmeCommandDiagnostics(
    await readFile(path.join(root, "README.md"), "utf8")
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
