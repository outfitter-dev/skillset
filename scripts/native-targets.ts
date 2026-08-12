export type NativeArchiveKind = "tar.gz" | "zip";

export interface NativeTarget {
  readonly archiveKind: NativeArchiveKind;
  readonly bunTarget:
    | "bun-darwin-arm64"
    | "bun-darwin-x64-baseline"
    | "bun-linux-arm64"
    | "bun-linux-arm64-musl"
    | "bun-linux-x64-baseline"
    | "bun-linux-x64-musl-baseline"
    | "bun-windows-x64-baseline";
  readonly executable: "skillset" | "skillset.exe";
  readonly npmPackage: `@skillset/native-${string}`;
  readonly required: boolean;
  readonly suffix:
    | "darwin-arm64"
    | "darwin-x64"
    | "linux-arm64-glibc"
    | "linux-arm64-musl"
    | "linux-x64-glibc"
    | "linux-x64-musl"
    | "windows-x64";
}

export const NATIVE_TARGETS: readonly NativeTarget[] = [
  {
    archiveKind: "tar.gz",
    bunTarget: "bun-darwin-arm64",
    executable: "skillset",
    npmPackage: "@skillset/native-darwin-arm64",
    required: true,
    suffix: "darwin-arm64",
  },
  {
    archiveKind: "tar.gz",
    bunTarget: "bun-darwin-x64-baseline",
    executable: "skillset",
    npmPackage: "@skillset/native-darwin-x64",
    required: true,
    suffix: "darwin-x64",
  },
  {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-arm64",
    executable: "skillset",
    npmPackage: "@skillset/native-linux-arm64-glibc",
    required: true,
    suffix: "linux-arm64-glibc",
  },
  {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-x64-baseline",
    executable: "skillset",
    npmPackage: "@skillset/native-linux-x64-glibc",
    required: true,
    suffix: "linux-x64-glibc",
  },
  {
    archiveKind: "zip",
    bunTarget: "bun-windows-x64-baseline",
    executable: "skillset.exe",
    npmPackage: "@skillset/native-win32-x64",
    required: true,
    suffix: "windows-x64",
  },
  {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-arm64-musl",
    executable: "skillset",
    npmPackage: "@skillset/native-linux-arm64-musl",
    required: false,
    suffix: "linux-arm64-musl",
  },
  {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-x64-musl-baseline",
    executable: "skillset",
    npmPackage: "@skillset/native-linux-x64-musl",
    required: false,
    suffix: "linux-x64-musl",
  },
] as const;

const targetBySuffix = new Map(
  NATIVE_TARGETS.map((target) => [target.suffix, target])
);

export const REQUIRED_NATIVE_TARGETS = NATIVE_TARGETS.filter(
  (target) => target.required
);

export function getNativeTarget(suffix: string): NativeTarget {
  const target = targetBySuffix.get(suffix as NativeTarget["suffix"]);
  if (!target) {
    throw new Error(
      `Unsupported native target "${suffix}"; expected ${NATIVE_TARGETS.map((entry) => entry.suffix).join(", ")}`
    );
  }
  return target;
}

export function nativeArchiveName(
  version: string,
  target: NativeTarget
): string {
  return `skillset-v${version}-${target.suffix}.${target.archiveKind}`;
}

export function assertNativeTargetRegistry(): void {
  const fields = ["suffix", "bunTarget", "npmPackage"] as const;
  for (const field of fields) {
    const values = NATIVE_TARGETS.map((target) => target[field]);
    if (new Set(values).size !== values.length) {
      throw new Error(
        `Native target registry contains duplicate ${field} values`
      );
    }
  }

  if (REQUIRED_NATIVE_TARGETS.length !== 5) {
    throw new Error(
      `Native target registry must declare exactly five required targets, found ${REQUIRED_NATIVE_TARGETS.length}`
    );
  }
}

assertNativeTargetRegistry();
