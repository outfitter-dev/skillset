import { chmod, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

import { extractNativeArchive } from "./native-archive";

function readValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

const args = process.argv.slice(2);
const archive = readValue(args, "--archive");
const output = readValue(args, "--output");
const kind = extname(archive) === ".zip" ? "zip" : "tar.gz";
const extracted = extractNativeArchive(
  kind,
  new Uint8Array(await readFile(archive))
);
await writeFile(output, extracted.bytes);
if (kind === "tar.gz") await chmod(output, extracted.mode);
