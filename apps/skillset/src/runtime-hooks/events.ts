export const HOOK_RUN_EVENTS = ["pre-tool-use", "post-tool-use", "session-start", "stop"] as const;

export type HookRunEvent = (typeof HOOK_RUN_EVENTS)[number];
export type HookSubcommand = "context" | "print" | "run";

export function isHookRunEvent(value: string | undefined): value is HookRunEvent {
  return value === "pre-tool-use" || value === "post-tool-use" || value === "session-start" || value === "stop";
}

export function readHookRunEvent(value: string | undefined): HookRunEvent {
  if (isHookRunEvent(value)) return value;
  throw new Error(
    "skillset: expected hooks run event pre-tool-use, post-tool-use, session-start, or stop"
  );
}
