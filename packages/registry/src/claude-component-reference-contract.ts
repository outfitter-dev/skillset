/** Input reference predicates from the pinned Claude 2.1.269 shared schema. */
export const CLAUDE_COMPONENT_REFERENCE_POLICY: Readonly<Record<string, { readonly allowDot?: boolean; readonly suffix?: string }>> = {
  agents: { suffix: ".md" },
  commands: {},
  skills: { allowDot: true },
  outputStyles: {},
  themes: {},
  workflows: {},
};
