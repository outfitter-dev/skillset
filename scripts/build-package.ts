import { chmod, copyFile, mkdir, rm } from "node:fs/promises";

const cliPackageDir = "apps/cli";
const launcherPackageDir = "apps/skillset";
const outdir = `${cliPackageDir}/dist`;

await Promise.all(
  [cliPackageDir, launcherPackageDir].map(async (packageDir) => {
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

const launcher = `${launcherPackageDir}/dist/cli.js`;
const launcherResult = await Bun.build({
  entrypoints: ["apps/skillset/src/launcher.ts"],
  external: ["@skillset/native-*"],
  naming: { entry: "cli.js" },
  outdir: `${launcherPackageDir}/dist`,
  target: "node",
});
if (!launcherResult.success) {
  for (const log of launcherResult.logs) console.error(log);
  process.exit(1);
}
await chmod(launcher, 0o755);
console.error(`skillset: built ${launcher}`);

for (const packageDir of [cliPackageDir, launcherPackageDir]) {
  for (const file of ["README.md", "LICENSE"]) {
    const destination = `${packageDir}/${file}`;
    await copyFile(file, destination);
    console.error(`skillset: projected ${destination}`);
  }
}
