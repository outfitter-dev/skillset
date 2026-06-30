export const HOOK_RUN_EVENTS = ["post-tool-use", "stop"] as const;

export type HookRunEvent = (typeof HOOK_RUN_EVENTS)[number];
export type HookSubcommand = "context" | "print" | "run";

export function isHookRunEvent(value: string | undefined): value is HookRunEvent {
  return value === "post-tool-use" || value === "stop";
}

export function readHookRunEvent(value: string | undefined): HookRunEvent {
  if (isHookRunEvent(value)) return value;
  throw new Error("skillset: expected hooks run event post-tool-use or stop");
}
