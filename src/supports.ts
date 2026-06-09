import { readFile } from "node:fs/promises";

import { readString } from "./config";
import { resolveInside } from "./path";
import type { JsonRecord, JsonValue } from "./types";
import { isJsonRecord } from "./yaml";

export interface SupportsValidationContext {
  readonly label: string;
  readonly rootPath: string;
  readonly warnings: string[];
}

interface PackageSupport {
  readonly name: string;
  readonly onMismatch: "error" | "warn";
  readonly range: string;
  readonly source?: string;
}

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

type Comparator = (version: Semver) => boolean;

const COMPARATOR_PATTERN = /^(>=|<=|>|<|=)?(.+)$/;

export async function validateSupports(
  value: JsonValue | undefined,
  context: SupportsValidationContext
): Promise<void> {
  if (value === undefined) return;
  const packages = readPackageSupports(value, context.label);
  for (const item of packages) {
    validateRange(item.range, `${context.label} supports ${item.name}`);
    await checkPackageSource(item, context);
  }
}

function readPackageSupports(value: JsonValue, label: string): readonly PackageSupport[] {
  if (typeof value === "string") return [parseCompactSupport(value, label)];
  if (Array.isArray(value)) return value.map((item) => readPackageSupport(item, label));
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label}.supports to be a string, array, or object`);
  }

  const packages = value.packages;
  for (const key of Object.keys(value)) {
    if (key !== "packages") {
      throw new Error(`skillset: unsupported ${label}.supports key ${key}; v1 supports packages`);
    }
  }
  if (packages === undefined) {
    throw new Error(`skillset: expected ${label}.supports.packages to be an array`);
  }
  if (!Array.isArray(packages)) {
    throw new Error(`skillset: expected ${label}.supports.packages to be an array`);
  }
  return packages.map((item) => readPackageSupport(item, `${label}.supports.packages`));
}

function readPackageSupport(value: JsonValue, label: string): PackageSupport {
  if (typeof value === "string") return parseCompactSupport(value, label);
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} support entries to be strings or objects`);
  }

  const name = readString(value, "name");
  const range = readString(value, "range");
  if (name === undefined) throw new Error(`skillset: expected ${label} support entry to include name`);
  if (range === undefined) throw new Error(`skillset: expected ${label} support entry ${name} to include range`);
  const onMismatch = readOnMismatch(value, `${label} support entry ${name}`);
  const source = readString(value, "source");
  return { name, onMismatch, range, ...(source === undefined ? {} : { source }) };
}

function parseCompactSupport(value: string, label: string): PackageSupport {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex > 0) {
    const name = trimmed.slice(0, atIndex).trim();
    const range = trimmed.slice(atIndex + 1).trim();
    if (name.length > 0 && range.length > 0) return { name, onMismatch: "warn", range };
  }

  const [name, ...rangeParts] = trimmed.split(/\s+/);
  const range = rangeParts.join(" ").trim();
  if (name === undefined || name.length === 0 || range.length === 0) {
    throw new Error(`skillset: expected ${label} compact support to look like "<package> <range>"`);
  }
  return { name, onMismatch: "warn", range };
}

function readOnMismatch(record: JsonRecord, label: string): "error" | "warn" {
  const value = readString(record, "onMismatch");
  if (value === undefined || value === "warn") return "warn";
  if (value === "error") return "error";
  throw new Error(`skillset: expected ${label}.onMismatch to be warn or error`);
}

async function checkPackageSource(
  support: PackageSupport,
  context: SupportsValidationContext
): Promise<void> {
  if (support.source === undefined) return;
  if (!support.source.startsWith("repo:")) {
    throw new Error(`skillset: ${context.label} supports ${support.name} source must use repo:<path>`);
  }

  const relativeSource = support.source.slice("repo:".length);
  if (relativeSource.trim().length === 0) {
    throw new Error(`skillset: ${context.label} supports ${support.name} source must include a repo path`);
  }

  const sourcePath = resolveInside(context.rootPath, relativeSource);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnOrThrow(support, context, `${support.source} could not be read as package JSON: ${message}`);
    return;
  }
  if (!isJsonRecord(parsed)) {
    warnOrThrow(support, context, `${support.source} is not a package JSON object`);
    return;
  }

  const packageName = readString(parsed, "name");
  if (packageName !== undefined && packageName !== support.name) {
    warnOrThrow(
      support,
      context,
      `${support.source} is package ${packageName}, expected ${support.name}`
    );
    return;
  }

  const version = readString(parsed, "version");
  if (version === undefined) {
    warnOrThrow(support, context, `${support.source} has no version`);
    return;
  }
  if (!satisfiesRange(version, support.range)) {
    warnOrThrow(
      support,
      context,
      `${support.name} supports ${support.range}, but ${support.source} is ${version}`
    );
  }
}

function warnOrThrow(
  support: PackageSupport,
  context: SupportsValidationContext,
  message: string
): void {
  const fullMessage = `${context.label}: ${message}`;
  if (support.onMismatch === "error") {
    throw new Error(`skillset: ${fullMessage}`);
  }
  context.warnings.push(fullMessage);
}

function validateRange(range: string, label: string): void {
  try {
    rangeComparators(range, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: invalid ${label} range ${JSON.stringify(range)}: ${message}`);
  }
}

function satisfiesRange(version: string, range: string): boolean {
  const parsedVersion = parseVersion(version, "package version");
  return rangeComparators(range, "range").every((comparator) => comparator(parsedVersion));
}

function rangeComparators(range: string, label: string): readonly Comparator[] {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "x") return [() => true];
  if (trimmed.includes("||")) throw new Error("OR ranges are not supported in v1");

  const comparators = trimmed.split(/\s+/).filter((token) => token.length > 0).map((token) =>
    comparatorForToken(token, label)
  );
  if (comparators.length === 0) throw new Error("range is empty");
  return comparators;
}

function comparatorForToken(token: string, label: string): Comparator {
  if (token.startsWith("^")) return caretComparator(parseVersion(token.slice(1), label));
  if (token.startsWith("~")) return tildeComparator(parseVersion(token.slice(1), label));

  const match = token.match(COMPARATOR_PATTERN);
  if (match === null) throw new Error(`unsupported comparator ${token}`);
  const operator = match[1] ?? "=";
  const version = parseVersion(match[2] ?? "", label);
  return (actual) => compareVersions(actual, version, operator);
}

function caretComparator(version: Semver): Comparator {
  const upper = version.major > 0
    ? { major: version.major + 1, minor: 0, patch: 0 }
    : version.minor > 0
      ? { major: 0, minor: version.minor + 1, patch: 0 }
      : { major: 0, minor: 0, patch: version.patch + 1 };
  return (actual) => compareSemver(actual, version) >= 0 && compareSemver(actual, upper) < 0;
}

function tildeComparator(version: Semver): Comparator {
  const upper = { major: version.major, minor: version.minor + 1, patch: 0 };
  return (actual) => compareSemver(actual, version) >= 0 && compareSemver(actual, upper) < 0;
}

function parseVersion(value: string, label: string): Semver {
  const normalized = value.trim().replace(/[+-].*$/, "");
  const parts = normalized.split(".");
  if (
    normalized.length === 0 ||
    parts.length < 1 ||
    parts.length > 3 ||
    parts.some((part) => !/^\d+$/.test(part))
  ) {
    throw new Error(`${label} version ${value} is not semver-like`);
  }
  const [major, minor = "0", patch = "0"] = parts;
  const numbers = [major, minor, patch].map((part) => Number(part));
  if (numbers.some((number) => !Number.isInteger(number) || number < 0)) {
    throw new Error(`${label} version ${value} is not semver-like`);
  }
  return { major: numbers[0] ?? 0, minor: numbers[1] ?? 0, patch: numbers[2] ?? 0 };
}

function compareVersions(left: Semver, right: Semver, operator: string): boolean {
  const order = compareSemver(left, right);
  if (operator === ">") return order > 0;
  if (operator === ">=") return order >= 0;
  if (operator === "<") return order < 0;
  if (operator === "<=") return order <= 0;
  if (operator === "=") return order === 0;
  throw new Error(`unsupported comparator operator ${operator}`);
}

function compareSemver(left: Semver, right: Semver): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
