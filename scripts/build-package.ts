import { chmod, copyFile, mkdir, rm } from "node:fs/promises";

const cliPackageDir = "apps/cli";
const legacyPackageDir = "apps/skillset";
const outdir = `${cliPackageDir}/dist`;

await Promise.all(
  [cliPackageDir, legacyPackageDir].map(async (packageDir) => {
    await rm(`${packageDir}/dist`, { force: true, recursive: true });
    await mkdir(packageDir, { recursive: true });
  })
);

const result = await Bun.build({
  entrypoints: ["apps/skillset/src/cli.ts"],
  naming: { entry: "[name].js" },
  outdir,
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const output of result.outputs) {
  await chmod(output.path, 0o755);
  console.error(`skillset: built ${output.path}`);
}

const canonicalCli = `${outdir}/cli.js`;
const legacyCli = `${legacyPackageDir}/dist/cli.js`;
await mkdir(`${legacyPackageDir}/dist`, { recursive: true });
await copyFile(canonicalCli, legacyCli);
await chmod(legacyCli, 0o755);
console.error(`skillset: projected ${legacyCli}`);

for (const packageDir of [cliPackageDir, legacyPackageDir]) {
  for (const file of ["README.md", "LICENSE"]) {
    const destination = `${packageDir}/${file}`;
    await copyFile(file, destination);
    console.error(`skillset: projected ${destination}`);
  }
}
