import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const hookRegistryDir = "packages/registry-data";
export const hookRegistrySource = "docs/reference/registry/v1";
export const hookRegistryJsonFiles = [
  "hooks.json",
  "hooks.schema.json",
] as const;

export const buildHookRegistry = async (root: string) => {
  const packageDir = path.join(root, hookRegistryDir);
  const dist = path.join(packageDir, "dist");
  const [catalogFile, schemaFile] = hookRegistryJsonFiles;
  const catalogPath = path.join(root, hookRegistrySource, catalogFile);
  const schemaPath = path.join(root, hookRegistrySource, schemaFile);
  const [catalog, schema] = await Promise.all([
    readFile(catalogPath, "utf-8"),
    readFile(schemaPath, "utf-8"),
  ]);
  const declarationSource = Buffer.from(
    JSON.stringify({ ...JSON.parse(schema), title: "HookCatalog" })
  );
  const banner = "// Generated from hooks.schema.json.";
  const generated =
    await Bun.$`bun run --bun --silent json2ts --no-format --strictIndexSignatures --bannerComment ${banner} < ${declarationSource}`
      .cwd(root)
      .quiet();

  await rm(dist, { force: true, recursive: true });
  await mkdir(dist, { recursive: true });
  await Promise.all([
    copyFile(path.join(root, "LICENSE"), path.join(packageDir, "LICENSE")),
    copyFile(catalogPath, path.join(dist, catalogFile)),
    copyFile(schemaPath, path.join(dist, schemaFile)),
    writeFile(
      path.join(dist, "hooks.js"),
      `export const hooks = JSON.parse(${JSON.stringify(catalog.trim())});\n`
    ),
    writeFile(
      path.join(dist, "hooks.d.ts"),
      `${generated.text()}\nexport declare const hooks: HookCatalog;\n`
    ),
  ]);
};

if (import.meta.main) {
  await buildHookRegistry(path.join(import.meta.dir, ".."));
}
