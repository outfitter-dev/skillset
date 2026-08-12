import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { nativeManifestName, parseNativeManifest } from "./native-artifacts";

function readValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export async function renderDistributionSizeReport(options: {
  readonly assetsDir: string;
  readonly cliTarball: string;
  readonly version: string;
}): Promise<string> {
  const manifest = parseNativeManifest(
    JSON.parse(
      await readFile(
        join(options.assetsDir, nativeManifestName(options.version)),
        "utf8"
      )
    )
  );
  if (manifest.version !== options.version) {
    throw new Error(
      `Native manifest version ${manifest.version} does not match ${options.version}`
    );
  }
  const cliSize = (await stat(options.cliTarball)).size;
  const lines = [
    `# Skillset ${options.version} distribution sizes`,
    "",
    "| Distribution | Raw executable | Published archive |",
    "| --- | ---: | ---: |",
    ...manifest.artifacts.map(
      (artifact) =>
        `| ${artifact.suffix} | ${megabytes(artifact.rawSize)} | ${megabytes(artifact.archiveSize)} |`
    ),
    `| @skillset/cli npm tarball | — | ${megabytes(cliSize)} |`,
    "",
    `CLI contract SHA-256: \`${manifest.cliContractSha256}\``,
    "",
  ];
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const output = readValue(args, "--output");
  const report = await renderDistributionSizeReport({
    assetsDir: readValue(args, "--assets-dir"),
    cliTarball: readValue(args, "--cli-tarball"),
    version: readValue(args, "--version"),
  });
  await writeFile(output, report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  }
  console.error(`skillset: wrote distribution size report ${basename(output)}`);
}
