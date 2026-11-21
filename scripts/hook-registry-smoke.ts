import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitSafeEnv } from "../packages/core/src/git-env";
import {
  buildHookRegistry,
  hookRegistryDir,
  hookRegistryJsonFiles,
  hookRegistrySource,
} from "./build-hook-registry";

const root = path.join(import.meta.dir, "..");
export const verifyTarball = async (
  tarball: string,
  ref: string,
  expectedManifest: Record<string, unknown>,
  publicSource?: ReadonlyMap<string, Buffer>
) => {
  const files = await new Bun.Archive(
    Bun.gunzipSync(await Bun.file(tarball).bytes())
  ).files();
  assert.deepEqual([...files.keys()].toSorted(), [
    "package/LICENSE",
    "package/README.md",
    "package/dist/hooks.d.ts",
    "package/dist/hooks.js",
    "package/dist/hooks.json",
    "package/dist/hooks.schema.json",
    "package/package.json",
  ]);
  const manifest = await files.get("package/package.json")?.json();
  assert.equal(manifest?.name, "@skillset/registry");
  assert.deepEqual(manifest, expectedManifest);
  assert.deepEqual(manifest.exports, {
    "./hooks": { types: "./dist/hooks.d.ts", import: "./dist/hooks.js" },
    "./hooks.json": "./dist/hooks.json",
    "./hooks.schema.json": "./dist/hooks.schema.json",
  });
  for (const key of [
    "bin",
    "bundleDependencies",
    "bundledDependencies",
    "dependencies",
    "devDependencies",
    "overrides",
    "optionalDependencies",
    "peerDependencies",
    "scripts",
  ]) {
    assert.equal(
      Object.hasOwn(manifest, key),
      false,
      `Unexpected ${key} in packed manifest`
    );
  }

  const gitEnv = gitSafeEnv();
  await Promise.all(
    hookRegistryJsonFiles.map(async (name) => {
      const blob = `${ref}:${hookRegistrySource}/${name}`;
      const [{ stdout: source }, packed] = await Promise.all([
        Bun.$`git cat-file blob ${blob}`.cwd(root).env(gitEnv).quiet(),
        files.get(`package/dist/${name}`)?.arrayBuffer(),
      ]);
      assert.ok(
        packed && source.equals(Buffer.from(packed)),
        `${name} differs from ${blob}`
      );
      if (publicSource) {
        assert.ok(
          source.equals(publicSource.get(name) ?? Buffer.alloc(0)),
          `${blob} differs from public Git`
        );
      }
      console.error(
        `skillset: packed ${name} matches ${ref} (SHA-256 ${createHash("sha256").update(source).digest("hex")})`
      );
    })
  );
};

export const checkConsumer = async (
  runtime: "bun" | "node",
  scratch: string,
  packageSpec: string,
  published?: { version: string; source: ReadonlyMap<string, Buffer> }
) => {
  const cwd = path.join(scratch, runtime);
  const executable =
    runtime === "node"
      ? (process.env.SKILLSET_REGISTRY_NODE ?? runtime)
      : runtime;
  await mkdir(cwd);
  await Promise.all([
    writeFile(
      path.join(cwd, "package.json"),
      '{"name":"registry-consumer","private":true,"type":"module"}\n'
    ),
    writeFile(
      path.join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          noEmit: true,
          noUncheckedIndexedAccess: false,
          strict: true,
          types: [],
        },
        files: ["types.mts"],
      })
    ),
    ...["check.mjs", "types.mts"].map((file) =>
      copyFile(
        path.join(root, "scripts/fixtures/registry-consumer", file),
        path.join(cwd, file)
      )
    ),
  ]);

  const registry = "https://registry.npmjs.org";
  const install =
    runtime === "node"
      ? Bun.$`npm install ${published ? "--prefer-online" : "--offline"} --registry=${registry} --ignore-scripts --no-audit --no-fund ${packageSpec}`
      : Bun.$`bun add --no-cache --ignore-scripts --registry ${registry} ${packageSpec}`;
  await install.cwd(cwd).quiet();
  if (published) {
    const installedDir = path.join(cwd, "node_modules/@skillset/registry");
    const manifest = await Bun.file(
      path.join(installedDir, "package.json")
    ).json();
    assert.equal(manifest.version, published.version);
    for (const [name, source] of published.source) {
      const installed = await readFile(path.join(installedDir, "dist", name));
      assert.ok(
        installed.equals(source),
        `Installed ${name} differs from public Git`
      );
    }
  }
  await Bun.$`${executable} check.mjs`.cwd(cwd);
  await Bun.$`bun ${path.join(root, "node_modules/typescript/bin/tsc")} --project tsconfig.json`.cwd(
    cwd
  );
  const version = await Bun.$`${executable} --version`.cwd(cwd).quiet();
  console.error(
    `skillset: @skillset/registry passed clean ${runtime} ${version.text().trim()} ESM and TypeScript checks`
  );
};

export async function packRegistry(packageDir: string, smoke: string) {
  await Bun.$`bun pm pack --destination ${smoke} --quiet --ignore-scripts`.cwd(
    packageDir
  );
  const entries = await readdir(smoke);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
  const [file] = tarballs;
  if (!file || tarballs.length !== 1) {
    throw new Error("Expected one @skillset/registry tarball");
  }
  return path.join(smoke, file);
}

if (import.meta.main) {
  const smoke = await mkdtemp(path.join(tmpdir(), "skillset-registry-pack-"));
  try {
    await buildHookRegistry(root);
    const packageDir = path.join(root, hookRegistryDir);
    const tarball = await packRegistry(packageDir, smoke);
    const manifest = await Bun.file(
      path.join(packageDir, "package.json")
    ).json();
    assert.equal(manifest.private, true, "Registry publishing is not enabled");
    const ref = (
      await Bun.$`git rev-parse HEAD`.cwd(root).env(gitSafeEnv()).quiet()
    )
      .text()
      .trim();
    await verifyTarball(tarball, ref, manifest);
    await checkConsumer("node", smoke, tarball);
    await checkConsumer("bun", smoke, tarball);
  } finally {
    await rm(smoke, { force: true, recursive: true });
  }
}
