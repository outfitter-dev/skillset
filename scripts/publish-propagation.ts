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

// A successful publish can precede registry visibility by several minutes;
// 0.28.0 exceeded a five-minute window on its first native package.
export const PROPAGATION_WINDOW_MS = 900_000;
const propagationWindowSeconds = PROPAGATION_WINDOW_MS / 1000;

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
    const remaining = PROPAGATION_WINDOW_MS - (io.now() - started);
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
    if (elapsed >= PROPAGATION_WINDOW_MS) break;
    const wait = Math.min(delay, PROPAGATION_WINDOW_MS - elapsed);
    io.log(
      `skillset: waiting for ${name}@${version} registry integrity, provenance, and ${tag} propagation (${elapsed / 1000}/${propagationWindowSeconds}s; next check in ${wait / 1000}s)`
    );
    await io.sleep(wait);
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error(
    `${name}@${version} did not become visible with required integrity, npm provenance, and dist-tag ${tag} within ${propagationWindowSeconds}s; the version may already be published. Retry the protected release after checking registry state; do not republish manually.`
  );
}

function assertMatchingIntegrity(
  publication: Publication,
  document: RegistryDocument
): void {
  const registered = document.versions?.[publication.version]?.dist?.integrity;
  // Immutable mismatches cannot heal through propagation; never recover over them.
  if (registered !== undefined && registered !== publication.integrity) {
    throw new Error(
      `${publication.name}@${publication.version} registry integrity does not match the staged tarball`
    );
  }
}

export interface PendingPublication {
  readonly publication: Publication;
  /** True when this attempt's npm publish succeeded. */
  readonly published: boolean;
  /** The pre-publish registry document when the version was already occupied. */
  readonly document?: RegistryDocument;
}

/**
 * Publish at most once without waiting for registry visibility. An occupied
 * version is not success until `verifyPublication` proves it.
 */
export async function publishOnce(
  publication: Publication,
  io: PublicationIO
): Promise<PendingPublication> {
  const document = await io.read(publication.name);
  if (document?.versions?.[publication.version]) {
    assertMatchingIntegrity(publication, document);
    return { publication, published: false, document };
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
  return { publication, published: result.exitCode === 0 };
}

export async function verifyPublication(
  pending: PendingPublication,
  io: Omit<PublicationIO, "publish">
): Promise<void> {
  await waitForPublication(pending.publication, io, pending.document);
}

/**
 * Wait for every pending publication concurrently so one slow package does not
 * spend the others' windows, then report every package that never appeared.
 */
export async function verifyPublications(
  pending: readonly PendingPublication[],
  io: Omit<PublicationIO, "publish">
): Promise<void> {
  const results = await Promise.allSettled(
    pending.map((entry) => verifyPublication(entry, io))
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected"
      ? [
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        ]
      : []
  );
  if (failures.length === 1) throw new Error(failures[0]);
  if (failures.length > 1) {
    throw new Error(
      `${failures.length} packages did not verify:\n- ${failures.join("\n- ")}`
    );
  }
}

/** Publish at most once; an occupied version is successful only after verification. */
export async function publishAndVerify(
  publication: Publication,
  io: PublicationIO
): Promise<boolean> {
  const pending = await publishOnce(publication, io);
  await verifyPublication(pending, io);
  return pending.published;
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
  return registryState(publication, document);
}

function registryState(
  publication: Omit<Publication, "integrity">,
  document: RegistryDocument | null
): ReleaseRegistryState {
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

/** A later published package makes earlier absences possible propagation gaps. */
export async function readReleaseRegistryStates(
  publications: readonly Omit<Publication, "integrity">[],
  io: Omit<PublicationIO, "publish">
): Promise<ReleaseRegistryState[]> {
  const states = await Promise.all(
    publications.map((publication) => readReleaseRegistryState(publication, io))
  );
  const lastPublished = states.findLastIndex((state) => state.published);
  return Promise.all(
    states.map(async (state, index) => {
      // A missing suffix is a valid resume point; only apparent prefix gaps wait.
      if (state.published || index > lastPublished) return state;
      const publication = publications[index]!;
      const document = await waitForPublication(publication, io);
      return registryState(publication, document);
    })
  );
}
