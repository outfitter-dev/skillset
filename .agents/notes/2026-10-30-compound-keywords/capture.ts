import { lstat, readdir, readFile, readlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
const [compilerRoot, root, destination] = process.argv.slice(2) as [string, string, string];
const { adoptSkillset } = await import(`${compilerRoot}/apps/skillset/src/adopt.ts`);
const { createOperationalPathContext, ISOLATED_OUT_ROOT, resolveOperationalPath } = await import(`${compilerRoot}/packages/core/src/index.ts`);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Entry = { path: string; mode: number; sha256?: string; link?: string; content?: string };
async function inventory(base: string, includeBytes = false, prefix = ""): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const name of (await readdir(join(base, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const absolute = join(base, path);
    const st = await lstat(absolute);
    if (st.isSymbolicLink()) entries.push({ path, mode: st.mode & 0o777, link: await readlink(absolute) });
    else if (st.isDirectory()) entries.push(...await inventory(base, includeBytes, path));
    else if (st.isFile()) {
      const bytes = await readFile(absolute);
      entries.push({ path, mode: st.mode & 0o777, sha256: digest(bytes), ...(includeBytes ? { content: bytes.toString("base64") } : {}) });
    }
  }
  return entries;
}
await mkdir(destination, { recursive: true });
const before = await inventory(root);
const report = await adoptSkillset(root, { write: true });
const afterAll = new Map((await inventory(root)).map((entry) => [entry.path, entry]));
const after = before.map((entry) => afterAll.get(entry.path));
const originalsUnchanged = JSON.stringify(before) === JSON.stringify(after);
const outputRoot = resolveOperationalPath(createOperationalPathContext(root), ISOLATED_OUT_ROOT);
const outputs = await inventory(outputRoot, true);
const summary = {
  originalFilesAndLinks: before.length, originalsUnchanged,
  ok: report.ok, imports: report.imports.map((item: any) => ({ ok: item.ok, detail: item.detail })),
  diagnostics: report.surveyDiagnostics, builtFiles: report.builtFiles,
  buildError: report.buildError ?? null, migrationError: report.migrationError ?? null,
  outputFiles: outputs.length,
};
for (const [name, value] of Object.entries({ report, before, after, outputs, summary })) {
  await Bun.write(join(destination, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
}
console.log(JSON.stringify(summary, null, 2));
if (!originalsUnchanged) process.exitCode = 1;
