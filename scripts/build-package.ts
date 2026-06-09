import { chmod, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: ["src/cli.ts", "src/create.ts"],
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
