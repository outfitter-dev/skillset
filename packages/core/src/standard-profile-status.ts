import {
  listStandardProfiles,
  type StandardProfile,
  type StandardProfileId,
  type StandardProfileLifecycleState,
} from "@skillset/registry";

import type { BuildScope, StandardProjectionPlan } from "./types";

export interface StandardProfileStatus {
  /** True only when an adopted, applicable profile participates in this build. */
  readonly active: boolean;
  readonly id: StandardProfileId;
  readonly lifecycle: StandardProfileLifecycleState;
  readonly scope: Exclude<BuildScope, "user">;
  readonly title: string;
  readonly version: string;
}

const PROFILE_SCOPES: Readonly<
  Record<StandardProfileId, Exclude<BuildScope, "user">>
> = {
  "agent-instructions": "project",
  "agent-plugins-1.0": "plugins",
  "agent-skills": "repo",
};

export function standardProfileStatuses(
  plan: StandardProjectionPlan,
  scopes: readonly BuildScope[] | undefined = undefined,
  profiles: readonly StandardProfile[] = listStandardProfiles()
): readonly StandardProfileStatus[] {
  const active = new Set(plan.adopted);
  return profiles.map((profile) => {
    const scope = PROFILE_SCOPES[profile.id];
    return {
      active:
        profile.lifecycle === "adopted" &&
        active.has(profile.id) &&
        (scopes === undefined || scopes.includes(scope)),
      id: profile.id,
      lifecycle: profile.lifecycle,
      scope,
      title: profile.title,
      version: profile.version,
    };
  });
}
