import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function publicationFailureHooks(): readonly [string, string][] {
  return [
    ["beforeTemporaryWrite", "injected temporary write failure"],
    ["beforeTemporarySync", "injected temporary sync failure"],
    ["beforeTemporaryClose", "injected temporary close failure"],
    ["beforePublish", "injected pre-rename failure"],
  ];
}

export async function seedPublishedFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function publicationArtifacts(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(dirname(path))).filter((file) => file.includes(".tmp-"));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
