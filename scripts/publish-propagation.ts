import {
  NPM_PROVENANCE_PREDICATE,
  type ReleaseRegistryState,
} from "./release-packages";

export type RegistryDocument = {
  "dist-tags"?: Record<string, string | undefined>;
  versions?: Record<
    string,
    {
      dist?: {
        attestations?: { provenance?: { predicateType?: unknown } };
        integrity?: unknown;
      };
    }
  >;
};

interface Publication {
  readonly name: string;
  readonly version: string;
  readonly tag: string;
  readonly integrity: string;
}

export interface PublicationIO {
  readonly read: (
    name: string,
    signal?: AbortSignal
  ) => Promise<RegistryDocument | null>;
  readonly publish: () => Promise<{ exitCode: number; stderr: string }>;
  readonly sleep: (milliseconds: number) => Promise<unknown>;
  readonly now: () => number;
  readonly log: (message: string) => void;
}

// A successful publish can precede registry visibility by several minutes.
const propagationWindowMs = 300_000;

export function isImmutableVersionConflict(
  stderr: string,
  version: string
): boolean {
  return stderr
    .split(/\r?\n/)
    .some(
      (line) =>
        line
          .trim()
          .endsWith(
            `You cannot publish over the previously published versions: ${version}.`
          ) ||
        line
          .trim()
          .endsWith(
            `You cannot publish over the previously published versions: ${version}`
          )
    );
}

async function waitForPublication(
  publication: Omit<Publication, "integrity"> & { readonly integrity?: string },
  io: Omit<PublicationIO, "publish">,
  initialDocument?: RegistryDocument
): Promise<RegistryDocument> {
  const { name, version, tag, integrity } = publication;
  const started = io.now();
  let delay = 3000;
  while (true) {
    const remaining = propagationWindowMs - (io.now() - started);
    if (remaining <= 0) break;
    const signal = AbortSignal.timeout(Math.ceil(remaining));
    let document: RegistryDocument | null;
    try {
      document = initialDocument ?? (await io.read(name, signal));
      initialDocument = undefined;
    } catch (error) {
      if (signal.aborted) break;
      throw error;
    }
    const published = document?.versions?.[version];
    // Immutable mismatches cannot heal through propagation; never recover over them.
    if (
      integrity !== undefined &&
      published?.dist?.integrity !== undefined &&
      published.dist.integrity !== integrity
    ) {
      throw new Error(
        `${name}@${version} registry integrity does not match the staged tarball`
      );
    }
    if (
      typeof published?.dist?.integrity === "string" &&
      (integrity === undefined || published.dist.integrity === integrity) &&
      published.dist.attestations?.provenance?.predicateType ===
        NPM_PROVENANCE_PREDICATE &&
      document?.["dist-tags"]?.[tag] === version
    )
      return document!;
    const elapsed = io.now() - started;
    if (elapsed >= propagationWindowMs) break;
    const wait = Math.min(delay, propagationWindowMs - elapsed);
    io.log(
      `skillset: waiting for ${name}@${version} registry integrity, provenance, and ${tag} propagation (${elapsed / 1000}/300s; next check in ${wait / 1000}s)`
    );
    await io.sleep(wait);
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error(
    `${name}@${version} did not become visible with required integrity, npm provenance, and dist-tag ${tag} within 300s; the version may already be published. Retry the protected release after checking registry state; do not republish manually.`
  );
}

/** Publish at most once; an occupied version is successful only after verification. */
export async function publishAndVerify(
  publication: Publication,
  io: PublicationIO
): Promise<boolean> {
  const document = await io.read(publication.name);
  if (document?.versions?.[publication.version]) {
    await waitForPublication(publication, io, document);
    return false;
  }
  const result = await io.publish();
  if (
    result.exitCode !== 0 &&
    !isImmutableVersionConflict(result.stderr, publication.version)
  ) {
    throw new Error(
      `npm publish ${publication.name}@${publication.version} failed with exit code ${result.exitCode}`
    );
  }
  if (result.exitCode !== 0) {
    io.log(
      `skillset: ${publication.name}@${publication.version} is occupied; verifying the staged artifact before continuing`
    );
  }
  await waitForPublication(publication, io);
  return result.exitCode === 0;
}

/** Planning waits for metadata on occupied versions, but never waits for absent packages. */
export async function readReleaseRegistryState(
  publication: Omit<Publication, "integrity">,
  io: Omit<PublicationIO, "publish">
): Promise<ReleaseRegistryState> {
  let document = await io.read(publication.name);
  if (document?.versions?.[publication.version]) {
    document = await waitForPublication(publication, io, document);
  }
  const published = document?.versions?.[publication.version];
  return {
    name: publication.name,
    published: Boolean(published),
    integrity:
      typeof published?.dist?.integrity === "string"
        ? published.dist.integrity
        : undefined,
    provenancePredicateType:
      typeof published?.dist?.attestations?.provenance?.predicateType ===
      "string"
        ? published.dist.attestations.provenance.predicateType
        : undefined,
    taggedVersion: document?.["dist-tags"]?.[publication.tag],
  };
}
