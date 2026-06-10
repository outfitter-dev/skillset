import type { BootstrapConfig } from "./config";
import { printAgentGitDiagnostics } from "./git";
import type { HostInfo } from "./host";
import { runRepoBootstrap } from "./repo";

export interface AgentBootstrapOptions {
  readonly config: BootstrapConfig;
  readonly force: boolean;
  readonly host: HostInfo;
  readonly repoRoot: string;
  readonly update: boolean;
}

export const runAgentBootstrap = async (
  options: AgentBootstrapOptions
): Promise<void> => {
  await runRepoBootstrap(options);
  printAgentGitDiagnostics(options.repoRoot, options.config.agent.graphiteStackMaxLines);
};
