import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NativeArtifactManifest } from "../native-artifacts";
import {
  NPM_BOOTSTRAP_PACKAGE_SPECS,
  NPM_BOOTSTRAP_VERSION,
  npmBootstrapEnvironment,
  npmBootstrapFilename,
  npmBootstrapLoginCommand,
  npmBootstrapPublishCommand,
  planNpmBootstrap,
  readNpmBootstrapStageForNpmVersion,
  validateBootstrapNativeManifest,
  validateBootstrapPublicationSourceCommit,
  validateBootstrapSourceState,
  validateBootstrapStageSourceState,
  validateBootstrapTarball,
  writeNpmBootstrapStage,
  type NpmBootstrapRegistryState,
} from "../npm-bootstrap";
import { RELEASE_PACKAGE_SPECS } from "../release-packages";
import {
  expectedReleaseTarballFiles,
  type StagedReleaseTarball,
} from "../release-tarballs";

const names = NPM_BOOTSTRAP_PACKAGE_SPECS.map((spec) => spec.name);
const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceCommit = "a".repeat(40);

function states(
  publishedNames: readonly string[],
  integrity: Readonly<Record<string, string>>,
  options: { readonly registeredOnly?: string; readonly tag?: string } = {}
): NpmBootstrapRegistryState[] {
  const published = new Set(publishedNames);
  return names.map((name) => ({
    integrity: published.has(name) ? integrity[name] : undefined,
    name,
    published: published.has(name),
    registered: published.has(name) || options.registeredOnly === name,
    taggedVersion: published.has(name)
      ? (options.tag ?? NPM_BOOTSTRAP_VERSION)
      : undefined,
  }));
}

async function packFixture(
  root: string,
  index: number,
  spec: (typeof RELEASE_PACKAGE_SPECS)[number],
  packageName = spec.name
): Promise<StagedReleaseTarball> {
  const packageDir = join(root, `package-${index}`);
  await mkdir(packageDir, { recursive: true });
  for (const path of expectedReleaseTarballFiles(spec)) {
    const target = join(packageDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      path === "package.json"
        ? `${JSON.stringify({
            name: packageName,
            publishConfig: { access: "public" },
            version: NPM_BOOTSTRAP_VERSION,
          })}\n`
        : `${path}\n`
    );
  }
  const subprocess = Bun.spawn(
    ["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", root],
    { cwd: packageDir, stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  const result = JSON.parse(stdout) as Array<{
    filename: string;
    integrity: string;
  }>;
  const packed = result[0]!;
  return {
    directory: spec.directory,
    filename: packed.filename,
    integrity: packed.integrity,
    name: spec.name,
    path: join(root, packed.filename),
  };
}

describe("one-time npm package bootstrap", () => {
  test("contains exactly the five native packages and Bun CLI, never the launcher", () => {
    expect(names).toEqual([
      "@skillset/native-darwin-arm64",
      "@skillset/native-darwin-x64",
      "@skillset/native-linux-arm64-glibc",
      "@skillset/native-linux-x64-glibc",
      "@skillset/native-win32-x64",
      "@skillset/cli",
    ]);
    expect(names).not.toContain("skillset");
    expect(NPM_BOOTSTRAP_PACKAGE_SPECS.map(npmBootstrapFilename)).toEqual([
      "skillset-native-darwin-arm64-0.22.2.tgz",
      "skillset-native-darwin-x64-0.22.2.tgz",
      "skillset-native-linux-arm64-glibc-0.22.2.tgz",
      "skillset-native-linux-x64-glibc-0.22.2.tgz",
      "skillset-native-win32-x64-0.22.2.tgz",
      "skillset-cli-0.22.2.tgz",
    ]);
  });

  test("uses an interactive first-publish command without weakening the OIDC publisher", () => {
    expect(
      npmBootstrapPublishCommand(
        "/tmp/package.tgz",
        "/tmp/user.npmrc",
        "/tmp/global.npmrc"
      )
    ).toEqual([
      "npm",
      "publish",
      "/tmp/package.tgz",
      "--access",
      "public",
      "--tag",
      "latest",
      "--registry",
      "https://registry.npmjs.org",
      "--userconfig",
      "/tmp/user.npmrc",
      "--globalconfig",
      "/tmp/global.npmrc",
    ]);
    expect(
      npmBootstrapPublishCommand(
        "/tmp/package.tgz",
        "/tmp/user.npmrc",
        "/tmp/global.npmrc"
      )
    ).not.toContain("--provenance");
    expect(
      npmBootstrapLoginCommand("/tmp/user.npmrc", "/tmp/global.npmrc")
    ).toEqual([
      "npm",
      "login",
      "--auth-type",
      "web",
      "--registry",
      "https://registry.npmjs.org",
      "--userconfig",
      "/tmp/user.npmrc",
      "--globalconfig",
      "/tmp/global.npmrc",
    ]);
  });

  test("isolates interactive npm authentication from ambient token configuration", () => {
    expect(
      npmBootstrapEnvironment({
        HOME: "/tmp/home",
        NODE_AUTH_TOKEN: "node-token",
        NPM_CONFIG_REGISTRY: "https://example.invalid",
        NPM_TOKEN: "npm-token",
        PATH: "/bin",
      })
    ).toEqual({ HOME: "/tmp/home", PATH: "/bin" });
  });

  test("plans an empty bootstrap and exact canonical-prefix recovery", () => {
    const integrity = Object.fromEntries(
      names.map((name) => [name, `sha512-${name}`])
    );
    expect(planNpmBootstrap(states([], integrity), integrity)).toEqual({
      missing: names,
      mode: "publish",
      published: [],
    });
    expect(
      planNpmBootstrap(states(names.slice(0, 2), integrity), integrity)
    ).toEqual({
      missing: names.slice(2),
      mode: "recover",
      published: names.slice(0, 2),
    });
    expect(planNpmBootstrap(states(names, integrity), integrity)).toEqual({
      missing: [],
      mode: "complete",
      published: names,
    });
  });

  test("blocks occupied identities, non-prefix state, tag drift, and byte drift", () => {
    const integrity = Object.fromEntries(
      names.map((name) => [name, `sha512-${name}`])
    );
    expect(() =>
      planNpmBootstrap(
        states([], integrity, { registeredOnly: names[0]! }),
        integrity
      )
    ).toThrow("already registered without 0.22.2");
    expect(() =>
      planNpmBootstrap(states([names[1]!], integrity), integrity)
    ).toThrow("appears after a missing bootstrap prerequisite");
    expect(() =>
      planNpmBootstrap(
        states([names[0]!], integrity, { tag: "0.23.0" }),
        integrity
      )
    ).toThrow("latest points to 0.23.0");
    expect(() =>
      planNpmBootstrap(states([names[0]!], integrity), {
        ...integrity,
        [names[0]!]: "sha512-different",
      })
    ).toThrow("integrity does not match");
  });

  test("requires clean synchronized main for the mutating command", () => {
    expect(() =>
      validateBootstrapSourceState({
        branch: "main",
        head: "abc",
        originMain: "abc",
        status: "",
      })
    ).not.toThrow();
    expect(() =>
      validateBootstrapSourceState({
        branch: "feature",
        head: "abc",
        originMain: "abc",
        status: "",
      })
    ).toThrow("must run from main");
    expect(() =>
      validateBootstrapSourceState({
        branch: "main",
        head: "abc",
        originMain: "abc",
        status: "M docs.md",
      })
    ).toThrow("clean worktree");
    expect(() =>
      validateBootstrapSourceState({
        branch: "main",
        head: "abc",
        originMain: "def",
        status: "",
      })
    ).toThrow("to equal origin/main");
    expect(() =>
      validateBootstrapStageSourceState({ head: sourceCommit, status: "" })
    ).not.toThrow();
    expect(() =>
      validateBootstrapStageSourceState({ head: "uncommitted", status: "" })
    ).toThrow("committed source revision");
    expect(() =>
      validateBootstrapStageSourceState({
        head: sourceCommit,
        status: "M package.json",
      })
    ).toThrow("staging requires a clean worktree");
  });

  test("revalidates the staged source immediately before every immutable publish", async () => {
    expect(() =>
      validateBootstrapPublicationSourceCommit(sourceCommit, sourceCommit)
    ).not.toThrow();
    expect(() =>
      validateBootstrapPublicationSourceCommit(sourceCommit, "b".repeat(40))
    ).toThrow("expected live main");

    const source = await readFile(
      join(rootDir, "scripts/npm-bootstrap.ts"),
      "utf8"
    );
    const commandStart = source.indexOf("async function commandPublish");
    const publishLoop = source.slice(
      source.indexOf(
        "for (const spec of NPM_BOOTSTRAP_PACKAGE_SPECS)",
        commandStart
      ),
      source.indexOf("  } finally {", commandStart)
    );
    const sourceCheck = publishLoop.indexOf(
      "await assertStagedPublicationSource(staged.sourceCommit);"
    );
    const registryCheck = publishLoop.indexOf(
      "if (currentPlan.missing[0] !== spec.name)"
    );
    const publish = publishLoop.indexOf("npmBootstrapPublishCommand(");
    expect(registryCheck).toBeGreaterThan(-1);
    expect(sourceCheck).toBeGreaterThan(-1);
    expect(registryCheck).toBeLessThan(sourceCheck);
    expect(sourceCheck).toBeLessThan(publish);
  });

  test("binds native input artifacts to the exact staged source commit", () => {
    const manifest = {
      artifacts: [],
      bunVersion: "1.4.0",
      cliContractSha256: "a".repeat(64),
      commit: sourceCommit,
      schemaVersion: 1,
      version: NPM_BOOTSTRAP_VERSION,
    } satisfies NativeArtifactManifest;
    expect(() =>
      validateBootstrapNativeManifest(manifest, sourceCommit)
    ).not.toThrow();
    expect(() =>
      validateBootstrapNativeManifest(
        { ...manifest, commit: "b".repeat(40) },
        sourceCommit
      )
    ).toThrow("expected staged source");
    expect(() =>
      validateBootstrapNativeManifest(
        { ...manifest, version: "0.23.0" },
        sourceCommit
      )
    ).toThrow("must be 0.22.2");
  });

  test("documents the bounded bootstrap without adding a release token", async () => {
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const releaseDocs = await readFile(
      join(rootDir, "docs/development/package-releases.md"),
      "utf8"
    );

    expect(packageJson.scripts?.["publish:bootstrap"]).toBe(
      "bun scripts/npm-bootstrap.ts"
    );
    expect(releaseDocs).toContain("--confirm-version 0.22.2");
    expect(releaseDocs).toContain("all seven packages");
    expect(releaseDocs).toContain("does not republish or replace");
    expect(releaseDocs).not.toContain("NPM_TOKEN=");
  });

  test("projects and validates an exact six-package bootstrap stage", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-bootstrap-test-"));
    const source = join(root, "source");
    const stage = join(root, "stage");
    await mkdir(source, { recursive: true });
    try {
      const packages: StagedReleaseTarball[] = [];
      for (const [index, spec] of RELEASE_PACKAGE_SPECS.entries()) {
        packages.push(await packFixture(source, index, spec));
      }

      const projected = await writeNpmBootstrapStage({
        packages,
        sourceCommit,
        stageDir: stage,
        version: NPM_BOOTSTRAP_VERSION,
      });
      expect(projected.map((entry) => entry.name)).toEqual(names);
      expect(await readdir(stage)).toHaveLength(7);
      await expect(
        readNpmBootstrapStageForNpmVersion(stage, "10.9.8")
      ).rejects.toThrow("requires npm 11.12.1");
      const read = await readNpmBootstrapStageForNpmVersion(stage, "11.12.1");
      expect(read.version).toBe(NPM_BOOTSTRAP_VERSION);
      expect(read.sourceCommit).toBe(sourceCommit);
      expect(read.packages.map((entry) => entry.name)).toEqual(names);

      await writeFile(join(stage, projected[0]!.filename), "changed");
      await expect(
        readNpmBootstrapStageForNpmVersion(stage, "11.12.1")
      ).rejects.toThrow("integrity changed");
      await expect(
        validateBootstrapTarball(
          NPM_BOOTSTRAP_PACKAGE_SPECS[0]!,
          packages.at(-1)!.path
        )
      ).rejects.toThrow("identity or exact payload is invalid");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
