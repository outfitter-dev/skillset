import { lstat, readFile, realpath } from "node:fs/promises";
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
  const localLicenseExists = await safeLocalLicenseExists(
    args,
    localLicensePath
  );
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
      content: await readFile(localLicensePath, "utf8"),
      sourcePath: relative(args.graph.rootPath, localLicensePath),
    };
  }

  return args.parent;
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

async function safeLocalLicenseExists(
  args: ResolveLicenseArgs,
  licensePath: string
): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(licensePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
  const displayPath = relative(args.graph.rootPath, licensePath);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `skillset: license source ${displayPath} must not be a symbolic link`
    );
  }
  if (!stats.isFile()) return false;

  const [sourceRoot, scopeRoot, resolvedLicense] = await Promise.all([
    realpath(args.graph.sourceRootPath),
    realpath(args.scopePath),
    realpath(licensePath),
  ]);
  assertContained(sourceRoot, scopeRoot, args.scopePath);
  assertContained(scopeRoot, resolvedLicense, licensePath);
  return true;
}

function assertContained(root: string, candidate: string, label: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  ) {
    return;
  }
  throw new Error(
    `skillset: license source ${label} resolves outside its declared source scope`
  );
}
