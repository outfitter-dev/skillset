import { writeGitHubOutput } from "./publish";

export type MacosSigningPolicy = "unsigned";

export function resolveMacosSigningPolicy(
  value: string | undefined
): MacosSigningPolicy {
  if (value === "unsigned") return value;
  if (!value) {
    throw new Error(
      "SKILLSET_MACOS_SIGNING_POLICY must be explicitly set to unsigned before release automation can run"
    );
  }
  if (value === "required") {
    throw new Error(
      "macOS signing is required, but no protected signing and notarization implementation is configured"
    );
  }
  throw new Error(`Unsupported macOS signing policy: ${value}`);
}

if (import.meta.main) {
  try {
    const policy = resolveMacosSigningPolicy(
      process.env.SKILLSET_MACOS_SIGNING_POLICY
    );
    await writeGitHubOutput({ macos_signing_policy: policy });
    console.error(`skillset: macOS signing policy is ${policy}`);
  } catch (error) {
    console.error(`skillset: ${(error as Error).message}`);
    process.exit(1);
  }
}
