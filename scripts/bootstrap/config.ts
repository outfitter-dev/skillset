export type BootstrapCommand =
  | 'agent'
  | 'claude'
  | 'codex'
  | 'doctor'
  | 'repo'
  | 'teardown';
export type BunPolicy = 'compatible' | 'strict';

export interface BootstrapConfig {
  readonly agent: {
    readonly graphiteStackMaxLines: number;
  };
  readonly checks: {
    readonly optionalTools: readonly string[];
  };
  readonly cleanup: {
    readonly directories: readonly string[];
    readonly files: readonly string[];
  };
  readonly bun: {
    readonly versionFile: string;
  };
  readonly defaults: {
    readonly command: BootstrapCommand;
    readonly localBunPolicy: BunPolicy;
    readonly remoteBunPolicy: BunPolicy;
  };
  readonly root: {
    readonly envVars: readonly string[];
    readonly fallbackToGitRoot: boolean;
  };
}

export const loadBootstrapConfig = (): BootstrapConfig => ({
  agent: {
    graphiteStackMaxLines: 80,
  },
  bun: {
    versionFile: '.bun-version',
  },
  checks: {
    optionalTools: ['git', 'gh', 'rg', 'jq', 'direnv'],
  },
  cleanup: {
    directories: ['dist', '.skillset/build'],
    files: [],
  },
  defaults: {
    command: 'repo',
    localBunPolicy: 'compatible',
    remoteBunPolicy: 'strict',
  },
  root: {
    envVars: ['CODEX_WORKTREE_PATH', 'CLAUDE_PROJECT_DIR', 'GITHUB_WORKSPACE'],
    fallbackToGitRoot: true,
  },
});
