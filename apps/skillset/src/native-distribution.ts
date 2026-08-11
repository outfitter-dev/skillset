export interface NativeDistribution {
  readonly arch: "arm64" | "x64";
  readonly executable: "skillset" | "skillset.exe";
  readonly libc?: "glibc" | "musl";
  readonly npmPackage: `@skillset/native-${string}`;
  readonly os: "darwin" | "linux" | "win32";
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

export const NATIVE_DISTRIBUTIONS: readonly NativeDistribution[] = [
  {
    arch: "arm64",
    executable: "skillset",
    npmPackage: "@skillset/native-darwin-arm64",
    os: "darwin",
    required: true,
    suffix: "darwin-arm64",
  },
  {
    arch: "x64",
    executable: "skillset",
    npmPackage: "@skillset/native-darwin-x64",
    os: "darwin",
    required: true,
    suffix: "darwin-x64",
  },
  {
    arch: "arm64",
    executable: "skillset",
    libc: "glibc",
    npmPackage: "@skillset/native-linux-arm64-glibc",
    os: "linux",
    required: true,
    suffix: "linux-arm64-glibc",
  },
  {
    arch: "x64",
    executable: "skillset",
    libc: "glibc",
    npmPackage: "@skillset/native-linux-x64-glibc",
    os: "linux",
    required: true,
    suffix: "linux-x64-glibc",
  },
  {
    arch: "x64",
    executable: "skillset.exe",
    npmPackage: "@skillset/native-win32-x64",
    os: "win32",
    required: true,
    suffix: "windows-x64",
  },
  {
    arch: "arm64",
    executable: "skillset",
    libc: "musl",
    npmPackage: "@skillset/native-linux-arm64-musl",
    os: "linux",
    required: false,
    suffix: "linux-arm64-musl",
  },
  {
    arch: "x64",
    executable: "skillset",
    libc: "musl",
    npmPackage: "@skillset/native-linux-x64-musl",
    os: "linux",
    required: false,
    suffix: "linux-x64-musl",
  },
] as const;

export const REQUIRED_NATIVE_DISTRIBUTIONS = NATIVE_DISTRIBUTIONS.filter(
  (distribution) => distribution.required
);

export function getNativeDistribution(suffix: string): NativeDistribution {
  const distribution = NATIVE_DISTRIBUTIONS.find(
    (candidate) => candidate.suffix === suffix
  );
  if (!distribution) {
    throw new Error(
      `Unsupported native target "${suffix}"; expected ${NATIVE_DISTRIBUTIONS.map((candidate) => candidate.suffix).join(", ")}`
    );
  }
  return distribution;
}

export function nativePackageDirectory(
  distribution: NativeDistribution
): string {
  return `apps/native-${distribution.suffix}`;
}
