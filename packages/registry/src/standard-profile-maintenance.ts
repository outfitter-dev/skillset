import {
  hashStandardProfileSnapshot,
  listStandardProfiles,
  type StandardProfile,
  type StandardProfileId,
  type StandardProfileSnapshot,
} from "./standard-profiles";

export type StandardProfileMaintenanceSubcommand = "check" | "diff" | "update";

export interface StandardProfileFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
}

export type StandardProfileFetch = (
  url: string
) => Promise<StandardProfileFetchResponse>;

export interface StandardProfileMaintenanceOptions {
  readonly fetcher?: StandardProfileFetch;
  readonly profiles?: readonly StandardProfile[];
}

export type StandardProfileSnapshotStatus = "changed" | "error" | "matched";

export interface StandardProfileSnapshotCheck {
  readonly actualHash?: string;
  readonly error?: string;
  readonly expectedHash: string;
  readonly kind: StandardProfileSnapshot["kind"];
  readonly status: StandardProfileSnapshotStatus;
  readonly url: string;
}

export interface StandardProfileMaintenanceResult {
  readonly id: StandardProfileId;
  readonly lifecycle: StandardProfile["lifecycle"];
  readonly snapshots: readonly StandardProfileSnapshotCheck[];
  readonly status: StandardProfileSnapshotStatus;
  readonly title: string;
}

export interface StandardProfileMaintenanceReport {
  readonly changed: number;
  readonly command: StandardProfileMaintenanceSubcommand;
  readonly errors: number;
  readonly ok: boolean;
  readonly results: readonly StandardProfileMaintenanceResult[];
  readonly wrote: false;
}

/**
 * Reads live sources only for explicit maintenance. Update reports the same
 * candidate evidence as diff; it never writes or changes lifecycle state.
 */
export async function runStandardProfileMaintenance(
  command: StandardProfileMaintenanceSubcommand,
  options: StandardProfileMaintenanceOptions = {}
): Promise<StandardProfileMaintenanceReport> {
  const profiles = options.profiles ?? listStandardProfiles();
  const fetcher = options.fetcher ?? fetch;
  const results = await Promise.all(
    profiles.map((profile) => checkProfile(profile, fetcher))
  );
  const changed = results.filter(
    (result) => result.status === "changed"
  ).length;
  const errors = results.filter((result) => result.status === "error").length;
  return {
    changed,
    command,
    errors,
    ok: command === "check" ? changed === 0 && errors === 0 : errors === 0,
    results,
    wrote: false,
  };
}

async function checkProfile(
  profile: StandardProfile,
  fetcher: StandardProfileFetch
): Promise<StandardProfileMaintenanceResult> {
  const snapshots = await Promise.all(
    profile.provenance.snapshots.map((snapshot) =>
      checkSnapshot(snapshot, fetcher)
    )
  );
  const status = snapshots.some((snapshot) => snapshot.status === "error")
    ? "error"
    : snapshots.some((snapshot) => snapshot.status === "changed")
      ? "changed"
      : "matched";
  return {
    id: profile.id,
    lifecycle: profile.lifecycle,
    snapshots,
    status,
    title: profile.title,
  };
}

async function checkSnapshot(
  snapshot: StandardProfileSnapshot,
  fetcher: StandardProfileFetch
): Promise<StandardProfileSnapshotCheck> {
  try {
    const response = await fetcher(snapshot.currentUrl);
    if (!response.ok) {
      throw new Error(
        "failed to fetch " +
          snapshot.currentUrl +
          ": " +
          response.status +
          " " +
          response.statusText
      );
    }
    const actualHash = hashStandardProfileSnapshot({
      body: await response.text(),
    });
    return {
      actualHash,
      expectedHash: snapshot.contentHash,
      kind: snapshot.kind,
      status: actualHash === snapshot.contentHash ? "matched" : "changed",
      url: snapshot.currentUrl,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      expectedHash: snapshot.contentHash,
      kind: snapshot.kind,
      status: "error",
      url: snapshot.currentUrl,
    };
  }
}
