import {
  NATIVE_DISTRIBUTIONS,
  type NativeDistribution,
} from "../apps/skillset/src/native-distribution";

export type NativeArchiveKind = "tar.gz" | "zip";

export interface NativeTarget extends NativeDistribution {
  readonly archiveKind: NativeArchiveKind;
  readonly bunTarget:
    | "bun-darwin-arm64"
    | "bun-darwin-x64-baseline"
    | "bun-linux-arm64"
    | "bun-linux-arm64-musl"
    | "bun-linux-x64-baseline"
    | "bun-linux-x64-musl-baseline"
    | "bun-windows-x64-baseline";
}

const buildTargetBySuffix = {
  "darwin-arm64": {
    archiveKind: "tar.gz",
    bunTarget: "bun-darwin-arm64",
  },
  "darwin-x64": {
    archiveKind: "tar.gz",
    bunTarget: "bun-darwin-x64-baseline",
  },
  "linux-arm64-glibc": {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-arm64",
  },
  "linux-arm64-musl": {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-arm64-musl",
  },
  "linux-x64-glibc": {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-x64-baseline",
  },
  "linux-x64-musl": {
    archiveKind: "tar.gz",
    bunTarget: "bun-linux-x64-musl-baseline",
  },
  "windows-x64": {
    archiveKind: "zip",
    bunTarget: "bun-windows-x64-baseline",
  },
} as const satisfies Record<
  NativeDistribution["suffix"],
  Pick<NativeTarget, "archiveKind" | "bunTarget">
>;

export const NATIVE_TARGETS: readonly NativeTarget[] = NATIVE_DISTRIBUTIONS.map(
  (distribution) => ({
    ...distribution,
    ...buildTargetBySuffix[distribution.suffix],
  })
);

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
