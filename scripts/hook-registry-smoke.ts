import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import {
  buildHookRegistry,
  hookRegistryDir,
  hookRegistryJsonFiles,
  hookRegistrySource,
} from "./build-hook-registry";

const root = path.join(import.meta.dir, "..");
const verifyTarball = async (tarball: string) => {
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
  assert.equal(manifest.private, true, "Registry publishing is not enabled");
  assert.deepEqual(Object.keys(manifest.exports).toSorted(), [
    "./hooks",
    "./hooks.json",
    "./hooks.schema.json",
  ]);
  for (const key of [
    "bin",
    "bundleDependencies",
    "bundledDependencies",
    "dependencies",
    "devDependencies",
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
  const revision = await Bun.$`git rev-parse HEAD`
    .cwd(root)
    .env(gitEnv)
    .quiet();
  const ref = revision.text().trim();
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
      console.error(
        `skillset: packed ${name} matches ${ref} (SHA-256 ${createHash("sha256").update(source).digest("hex")})`
      );
    })
  );
};

const checkConsumer = async (runtime: "bun" | "node", tarball: string) => {
  const cwd = path.join(path.dirname(tarball), runtime);
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

  const install =
    runtime === "node"
      ? Bun.$`npm install --offline --ignore-scripts --no-audit --no-fund ${tarball}`
      : Bun.$`bun add --ignore-scripts ${tarball}`;
  await install.cwd(cwd).quiet();
  await Bun.$`${executable} check.mjs`.cwd(cwd);
  await Bun.$`bun ${path.join(root, "node_modules/typescript/bin/tsc")} --project tsconfig.json`.cwd(
    cwd
  );
  const version = await Bun.$`${executable} --version`.cwd(cwd).quiet();
  console.error(
    `skillset: packed @skillset/registry passed clean ${runtime} ${version.text().trim()} ESM and TypeScript checks`
  );
};

const smoke = await mkdtemp(path.join(tmpdir(), "skillset-registry-pack-"));
try {
  await buildHookRegistry(root);
  await Bun.$`bun pm pack --destination ${smoke} --quiet --ignore-scripts`.cwd(
    path.join(root, hookRegistryDir)
  );
  const entries = await readdir(smoke);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
  const [file] = tarballs;
  if (!file || tarballs.length !== 1) {
    throw new Error("Expected one @skillset/registry tarball");
  }
  const tarball = path.join(smoke, file);
  await verifyTarball(tarball);
  await checkConsumer("node", tarball);
  await checkConsumer("bun", tarball);
} finally {
  await rm(smoke, { force: true, recursive: true });
}
