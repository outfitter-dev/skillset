import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { SOURCE_LICENSE_IDS, SOURCE_LICENSE_NONE } from "@skillset/schema";

import { readString } from "./config";
import type { BuildGraph, JsonRecord } from "./types";

export interface ResolvedLicense {
  readonly content: string;
  readonly manifestValue?: string;
  readonly sourcePath: string;
}

interface ResolveLicenseArgs {
  readonly graph: BuildGraph;
  readonly label: string;
  readonly metadata: JsonRecord;
  readonly parent?: ResolvedLicense;
  readonly scopePath: string;
  readonly sourcePath: string;
}

const licenseNotices: Readonly<Record<(typeof SOURCE_LICENSE_IDS)[number], {
  readonly name: string;
  readonly url: string;
}>> = {
  "Apache-2.0": {
    name: "Apache License 2.0",
    url: "https://spdx.org/licenses/Apache-2.0.html",
  },
  "BSD-2-Clause": {
    name: "BSD 2-Clause Simplified License",
    url: "https://spdx.org/licenses/BSD-2-Clause.html",
  },
  "BSD-3-Clause": {
    name: "BSD 3-Clause New or Revised License",
    url: "https://spdx.org/licenses/BSD-3-Clause.html",
  },
  ISC: {
    name: "ISC License",
    url: "https://spdx.org/licenses/ISC.html",
  },
  MIT: {
    name: "MIT License",
    url: "https://spdx.org/licenses/MIT.html",
  },
  "MPL-2.0": {
    name: "Mozilla Public License 2.0",
    url: "https://spdx.org/licenses/MPL-2.0.html",
  },
};

export async function resolveLicense(args: ResolveLicenseArgs): Promise<ResolvedLicense | undefined> {
  const localLicensePath = join(args.scopePath, "LICENSE.txt");
  const localLicenseExists = await fileExists(localLicensePath);
  const setting = readString(args.metadata, "license");

  if (setting === SOURCE_LICENSE_NONE) {
    if (localLicenseExists) {
      throw new Error(
        `skillset: ${args.label} sets skillset.license to none but also has ${relative(args.graph.rootPath, localLicensePath)}; remove one of them`
      );
    }
    return undefined;
  }

  if (setting !== undefined) {
    return {
      content: renderLicenseNotice(setting, args.label),
      manifestValue: canonicalLicenseId(setting, args.label),
      sourcePath: relative(args.graph.rootPath, args.sourcePath),
    };
  }

  if (localLicenseExists) {
    return {
      content: await readContainedLicenseFile({
        label: args.label,
        licensePath: localLicensePath,
        rootPath: args.graph.rootPath,
        scopePath: args.scopePath,
        sourceRootPath: args.graph.sourceRootPath,
      }),
      sourcePath: relative(args.graph.rootPath, localLicensePath),
    };
  }

  return args.parent;
}

export interface ContainedLicenseReadTestHooks {
  readonly afterOpen?: (licensePath: string) => Promise<void> | void;
  readonly afterRead?: (licensePath: string) => Promise<void> | void;
}

export interface ContainedLicenseReadArgs {
  readonly label: string;
  readonly licensePath: string;
  readonly rootPath: string;
  readonly scopePath: string;
  readonly sourceRootPath: string;
  readonly testHooks?: ContainedLicenseReadTestHooks;
}

export async function readContainedLicenseFile(
  args: ContainedLicenseReadArgs
): Promise<string> {
  const [canonicalSourceRoot, canonicalScope, canonicalLicense] =
    await Promise.all([
      realpath(args.sourceRootPath),
      realpath(args.scopePath),
      realpath(args.licensePath),
    ]);
  if (
    !isContainedPath(canonicalSourceRoot, canonicalScope) ||
    !isContainedPath(canonicalScope, canonicalLicense)
  ) {
    throw new Error(
      `skillset: ${args.label} license file resolves outside its source scope: ${relative(args.rootPath, args.licensePath)}`
    );
  }

  const handle = await open(
    canonicalLicense,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = await handle.stat();
    await args.testHooks?.afterOpen?.(canonicalLicense);
    const [currentScope, currentLicense, pathEntry] = await Promise.all([
      realpath(args.scopePath),
      realpath(canonicalLicense),
      lstat(canonicalLicense),
    ]);
    if (
      !before.isFile() ||
      pathEntry.isSymbolicLink() ||
      !pathEntry.isFile() ||
      before.dev !== pathEntry.dev ||
      before.ino !== pathEntry.ino ||
      currentScope !== canonicalScope ||
      currentLicense !== canonicalLicense ||
      !isContainedPath(canonicalSourceRoot, currentScope) ||
      !isContainedPath(currentScope, currentLicense)
    ) {
      throw new Error(
        `skillset: ${args.label} license file changed during containment validation`
      );
    }

    const content = await handle.readFile("utf8");
    await args.testHooks?.afterRead?.(canonicalLicense);
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.ctimeMs !== after.ctimeMs ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error(
        `skillset: ${args.label} license file changed while it was being read`
      );
    }
    return content;
  } finally {
    await handle.close();
  }
}

function isContainedPath(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function renderLicenseNotice(id: string, label: string): string {
  const canonicalId = canonicalLicenseId(id, label);
  const license = licenseNotices[canonicalId];
  return [
    `SPDX-License-Identifier: ${canonicalId}`,
    "",
    license.name,
    "",
    `This generated Skillset output inherits the ${canonicalId} license declaration from source.`,
    `Canonical terms: ${license.url}`,
    "",
  ].join("\n");
}

function canonicalLicenseId(id: string, label: string): keyof typeof licenseNotices {
  const license = licenseNotices[id as keyof typeof licenseNotices];
  if (license === undefined) {
    throw new Error(
      `skillset: ${label} declares unsupported skillset.license ${JSON.stringify(id)}; supported values are ${[...SOURCE_LICENSE_IDS, SOURCE_LICENSE_NONE].join(", ")}`
    );
  }
  return id as keyof typeof licenseNotices;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
