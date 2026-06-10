import { checkBunVersion } from "./bun";
import type { BootstrapConfig } from "./config";
import type { HostInfo } from "./host";
import { hasRepoInstallState } from "./repo";
import { collectToolStatus, printToolStatuses } from "./tools";

export const runDoctor = async (
  repoRoot: string,
  config: BootstrapConfig,
  host: HostInfo
): Promise<void> => {
  console.error("Skillset Bootstrap Doctor");
  console.error("-------------------------");
  console.error(`repo root: ${repoRoot}`);
  console.error(`provider: ${host.provider}`);
  console.error(`remote: ${String(host.remote)}`);

  const bun = checkBunVersion(repoRoot, host.bunPolicy, config.bun.versionFile);
  console.error("");
  console.error("Required checks");
  console.error(
    `  bun: ${bun.ok ? "ok" : "failed"}${bun.actual ? ` ${bun.actual}` : ""} (${bun.policy}; pinned ${bun.pinned})`
  );
  console.error(
    `  dependencies: ${(await hasRepoInstallState(repoRoot)) ? "ok" : "missing"}`
  );

  console.error("");
  printToolStatuses(
    "Optional capabilities",
    collectToolStatus(config.checks.optionalTools, repoRoot),
    true
  );
};
