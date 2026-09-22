/**
 * Fail-closed on-disk JSON reads. Only `ENOENT` may mean absence, and only
 * when the caller opts into that. Invalid JSON and every other filesystem
 * error stay errors.
 */

import { readFile } from "node:fs/promises";

export type OnDiskJsonMissingPolicy = "absent" | "error";

export type OnDiskJsonFailureKind = "missing" | "unreadable" | "invalid-json";

export interface OnDiskJsonFailure {
  readonly cause: unknown;
  readonly code?: string;
  readonly kind: OnDiskJsonFailureKind;
  readonly label: string;
  readonly path: string;
}

export interface ReadOnDiskJsonOptions {
  readonly label: string;
  readonly missing?: OnDiskJsonMissingPolicy;
  readonly readText?: (path: string) => Promise<string>;
}

export type OnDiskJsonResult =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly value: unknown };

export class OnDiskJsonError extends Error {
  readonly failure: OnDiskJsonFailure;

  constructor(failure: OnDiskJsonFailure) {
    super(formatOnDiskJsonFailure(failure));
    this.name = "OnDiskJsonError";
    this.failure = failure;
  }
}

export async function readOnDiskJson(
  path: string,
  options: ReadOnDiskJsonOptions
): Promise<OnDiskJsonResult> {
  const missing = options.missing ?? "error";
  const readText = options.readText ?? defaultReadText;
  let text: string;
  try {
    text = await readText(path);
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" && missing === "absent") {
      return { kind: "absent" };
    }
    throw new OnDiskJsonError({
      cause,
      ...(code === undefined ? {} : { code }),
      kind: code === "ENOENT" ? "missing" : "unreadable",
      label: options.label,
      path,
    });
  }

  try {
    return { kind: "present", value: JSON.parse(text) as unknown };
  } catch (cause) {
    throw new OnDiskJsonError({
      cause,
      kind: "invalid-json",
      label: options.label,
      path,
    });
  }
}

export function formatOnDiskJsonFailure(failure: OnDiskJsonFailure): string {
  if (failure.kind === "missing") {
    return `${failure.label} is missing`;
  }
  if (failure.kind === "invalid-json") {
    return `${failure.label} is not valid JSON: ${causeMessage(failure.cause)}`;
  }
  const code = failure.code === undefined ? "" : ` (${failure.code})`;
  return `${failure.label} cannot be read${code}: ${causeMessage(failure.cause)}`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function defaultReadText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
