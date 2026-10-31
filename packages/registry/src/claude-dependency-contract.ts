/** Pinned Claude 2.1.269 Sc/Ec dependency input grammar; no semver interpretation. */
export const CLAUDE_DEPENDENCY_PATTERN = /^[A-Za-z0-9][-A-Za-z0-9._]*(@[A-Za-z0-9][-A-Za-z0-9._]*)?(@\^[^@]*)?$/u;
export const CLAUDE_DEPENDENCY_NAME_PATTERN = /^[A-Za-z0-9][-A-Za-z0-9._]*$/u;
