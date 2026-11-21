import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitSafeEnv } from "../packages/core/src/git-env";
import {
  buildHookRegistry,
  hookRegistryDir,
  hookRegistryJsonFiles,
  hookRegistrySource,
} from "./build-hook-registry";
import {
  checkConsumer,
  packRegistry,
  verifyTarball,
} from "./hook-registry-smoke";
import { PROPAGATION_WINDOW_MS } from "./publish-propagation";
import {
  NPM_PROVENANCE_PREDICATE,
  RELEASE_NPM_VERSION,
} from "./release-packages";

const root = path.join(import.meta.dir, "..");
const registry = "https://registry.npmjs.org";
const repository = "outfitter-dev/skillset";
const ref = "refs/heads/main";
const workflow = ".github/workflows/registry-qualification.yml";
const workflowRef = `${repository}/${workflow}@${ref}`;
const githubSource = `https://github.com/${repository}`;
const nodeFloor = "v18.0.0";
export const candidate = {
  name: "@skillset/registry",
  version: "0.0.1-qualify.0",
  tag: "registry-qualification",
} as const;
const packageSpec = `${candidate.name}@${candidate.version}`;
const escapedName = encodeURIComponent(candidate.name);
const tarballUrl = `${registry}/@skillset/registry/-/registry-${candidate.version}.tgz`;
const archive = "registry.tgz";
const baseline = {
  latest: "0.0.0-bootstrap.0",
  bootstrap: "0.0.0-bootstrap.0",
};
const shaPattern = /^[0-9a-f]{40}$/;
const sriPattern = /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/;

type RegistryDocument = {
  name?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<
    string,
    {
      dist?: {
        integrity?: string;
        tarball?: string;
        attestations?: { provenance?: { predicateType?: string } };
      };
    }
  >;
};

export type ReviewReceipt = typeof candidate & {
  sourceSha: string;
  integrity: string;
  tagsBefore: typeof baseline;
};

function checkedTags(document: RegistryDocument | null) {
  assert.ok(
    document?.name === candidate.name &&
      document.versions &&
      document["dist-tags"],
    "Existing @skillset/registry package identity is required"
  );
  const tags = document["dist-tags"];
  assert.ok(
    Object.hasOwn(document.versions, baseline.bootstrap),
    "Registry bootstrap version is missing"
  );
  const { latest, bootstrap } = tags;
  assert.deepEqual(
    { latest, bootstrap },
    baseline,
    "latest or bootstrap drifted"
  );
  return { tags, versions: document.versions };
}

export function assertVacant(document: RegistryDocument | null) {
  const { tags, versions } = checkedTags(document);
  assert.ok(
    !Object.hasOwn(versions, candidate.version),
    "Qualification version is occupied"
  );
  assert.ok(
    !Object.hasOwn(tags, candidate.tag),
    "Qualification tag is occupied"
  );
}

export function hasPublishedMetadata(
  document: RegistryDocument | null,
  receipt: ReviewReceipt
) {
  const { tags, versions } = checkedTags(document);
  const tagged = tags[candidate.tag];
  assert.ok(
    tagged === undefined || tagged === candidate.version,
    "Qualification tag points to another version"
  );
  const dist = versions[candidate.version]?.dist;
  if (!dist) return false;
  if (dist.integrity !== undefined) {
    assert.equal(
      dist.integrity,
      receipt.integrity,
      "Published archive digest differs from the approved archive"
    );
  }
  if (dist.tarball !== undefined)
    assert.equal(dist.tarball, tarballUrl, "Unexpected registry tarball URL");
  return (
    tagged === candidate.version &&
    dist.integrity === receipt.integrity &&
    dist.tarball === tarballUrl &&
    dist.attestations?.provenance?.predicateType === NPM_PROVENANCE_PREDICATE
  );
}

type PublicationIO<T> = {
  read: () => Promise<RegistryDocument | null>;
  publish: () => Promise<void>;
  prove: () => Promise<T | undefined>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<unknown>;
  log: (message: string) => void;
};

class TemporaryRegistryError extends Error {}

export async function publishOnce<T>(
  receipt: ReviewReceipt,
  io: PublicationIO<T>
) {
  assertVacant(await io.read());
  let reconciledAfterError = false;
  try {
    await io.publish();
  } catch {
    reconciledAfterError = true;
    io.log(
      "npm publish did not confirm success. Checking public registry evidence; will not retry."
    );
  }
  const deadline = io.now() + PROPAGATION_WINDOW_MS;
  let delay = 3000;
  while (io.now() < deadline) {
    try {
      if (hasPublishedMetadata(await io.read(), receipt)) {
        const evidence = await io.prove();
        if (evidence !== undefined) {
          // Detect changes that happened while verifying public evidence.
          assert.ok(
            hasPublishedMetadata(await io.read(), receipt),
            "Registry state changed during verification"
          );
          return { evidence, reconciledAfterError };
        }
      }
    } catch (error) {
      if (!(error instanceof TemporaryRegistryError)) throw error;
    }
    await io.sleep(Math.min(delay, Math.max(0, deadline - io.now())));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error(
    "Exact public integrity, tag and signed provenance did not resolve within the propagation window. The version may already be published; stop for maintainer review without republishing."
  );
}

async function getPublic(url: string, accept: string, missingAllowed = false) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: accept, "Cache-Control": "no-cache" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new TemporaryRegistryError(`Could not read ${url}`, { cause });
  }
  if (response.status === 404 && missingAllowed) return undefined;
  if (response.status === 429 || response.status >= 500) {
    throw new TemporaryRegistryError(`${url}: HTTP ${response.status}`);
  }
  assert.ok(response.ok, `${url}: HTTP ${response.status}`);
  return response;
}

async function readRegistry(): Promise<RegistryDocument | null> {
  const response = await getPublic(
    `${registry}/${escapedName}`,
    "application/json",
    true
  );
  return response ? ((await response.json()) as RegistryDocument) : null;
}

async function publicSource(sourceSha: string) {
  const entries = await Promise.all(
    hookRegistryJsonFiles.map(async (name) => {
      const url = `https://raw.githubusercontent.com/${repository}/${sourceSha}/${hookRegistrySource}/${name}`;
      const response = await getPublic(url, "application/octet-stream");
      assert.ok(response);
      return [name, Buffer.from(await response.arrayBuffer())] as const;
    })
  );
  return new Map<string, Buffer>(entries);
}

function integrity(bytes: Uint8Array) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function assertApproved(
  receipt: ReviewReceipt,
  sourceSha: string,
  approved: string,
  actual: string
) {
  assert.match(sourceSha, shaPattern);
  assert.match(
    approved,
    sriPattern,
    "An exact approved SHA-512 SRI is required"
  );
  assert.deepEqual(
    receipt,
    { ...candidate, sourceSha, integrity: approved, tagsBefore: baseline },
    "Review receipt does not match the approved source, tuple or digest"
  );
  assert.equal(
    actual,
    approved,
    "Archive digest differs from the approved digest"
  );
}

async function candidateManifest() {
  const { private: isPrivate, ...manifest } = await Bun.file(
    path.join(root, hookRegistryDir, "package.json")
  ).json();
  assert.equal(
    isPrivate,
    true,
    "The tracked registry manifest must remain private"
  );
  const product = await Bun.file(
    path.join(root, "apps/skillset/package.json")
  ).json();
  assert.ok(
    Bun.semver.order(candidate.version, product.version) < 0,
    "Qualification version must be below the coordinated product version"
  );
  return {
    ...manifest,
    version: candidate.version,
    repository: {
      type: "git",
      url: `git+${githubSource}.git`,
      directory: hookRegistryDir,
    },
    publishConfig: { access: "public", registry },
  };
}

async function requireNodeFloor() {
  const node = process.env.SKILLSET_REGISTRY_NODE;
  assert.ok(node, "Set SKILLSET_REGISTRY_NODE to the Node 18.0.0 executable");
  assert.equal(
    (await Bun.$`${node} --version`.quiet()).text().trim(),
    nodeFloor
  );
}

async function prepare(sourceSha: string, out: string) {
  await requireNodeFloor();
  assertVacant(await readRegistry());
  const manifest = await candidateManifest();
  const scratch = await mkdtemp(
    path.join(tmpdir(), "skillset-registry-qualification-")
  );
  try {
    const pkg = path.join(scratch, hookRegistryDir);
    const catalog = path.join(scratch, hookRegistrySource);
    await Promise.all([
      mkdir(pkg, { recursive: true }),
      mkdir(catalog, { recursive: true }),
      symlink(
        path.join(root, "node_modules"),
        path.join(scratch, "node_modules"),
        "dir"
      ),
    ]);
    await Promise.all([
      copyFile(path.join(root, "LICENSE"), path.join(scratch, "LICENSE")),
      ...hookRegistryJsonFiles.map((name) =>
        copyFile(
          path.join(root, hookRegistrySource, name),
          path.join(catalog, name)
        )
      ),
    ]);
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );
    await copyFile(
      path.join(root, hookRegistryDir, "README.md"),
      path.join(pkg, "README.md")
    );
    await buildHookRegistry(scratch);
    const packed = await packRegistry(pkg, scratch);
    await verifyTarball(
      packed,
      sourceSha,
      manifest,
      await publicSource(sourceSha)
    );
    await checkConsumer("node", scratch, packed);
    await checkConsumer("bun", scratch, packed);
    const receipt: ReviewReceipt = {
      ...candidate,
      sourceSha,
      integrity: integrity(await readFile(packed)),
      tagsBefore: baseline,
    };
    if (process.env.REGISTRY_APPROVED_INTEGRITY !== undefined) {
      assertApproved(
        receipt,
        sourceSha,
        process.env.REGISTRY_APPROVED_INTEGRITY,
        receipt.integrity
      );
    }
    await mkdir(out);
    await copyFile(packed, path.join(out, archive));
    await writeReceipt(path.join(out, "review.json"), receipt);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await Bun.write(
        process.env.GITHUB_STEP_SUMMARY,
        `Registry-only archive review receipt\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`
      );
    }
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

type ProvenanceBundle = {
  dsseEnvelope?: { payload?: string; payloadType?: string };
  verificationMaterial?: {
    certificate?: { rawBytes?: string };
    x509CertificateChain?: { certificates?: { rawBytes?: string }[] };
  };
};

export function checkStatement(
  bundle: ProvenanceBundle,
  receipt: ReviewReceipt
) {
  const envelope = bundle.dsseEnvelope;
  assert.ok(
    envelope?.payload &&
      envelope.payloadType === "application/vnd.in-toto+json",
    "Missing signed in-toto payload"
  );
  const statement = JSON.parse(
    Buffer.from(envelope.payload, "base64").toString("utf8")
  );
  assert.equal(statement._type, "https://in-toto.io/Statement/v1");
  assert.equal(statement.predicateType, NPM_PROVENANCE_PREDICATE);
  assert.deepEqual(
    statement.subject,
    [
      {
        name: `pkg:npm/%40skillset/registry@${candidate.version}`,
        digest: {
          sha512: Buffer.from(
            receipt.integrity.slice("sha512-".length),
            "base64"
          ).toString("hex"),
        },
      },
    ],
    "Provenance subject does not match the approved archive"
  );
  const definition = statement.predicate?.buildDefinition;
  assert.equal(
    definition?.buildType,
    "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"
  );
  assert.equal(
    definition.internalParameters?.github?.event_name,
    "workflow_dispatch"
  );
  assert.deepEqual(
    definition.externalParameters?.workflow,
    { ref, repository: githubSource, path: workflow },
    "Unexpected provenance workflow identity"
  );
  assert.deepEqual(
    definition.resolvedDependencies,
    [
      {
        uri: `git+${githubSource}@${ref}`,
        digest: { gitCommit: receipt.sourceSha },
      },
    ],
    "Provenance source does not match the approved SHA"
  );
  return statement;
}

async function provePublic(receipt: ReviewReceipt) {
  const attestation = await getPublic(
    `${registry}/-/npm/v1/attestations/${escapedName}@${candidate.version}`,
    "application/json",
    true
  );
  if (!attestation) return undefined;
  const { attestations } = (await attestation.json()) as {
    attestations: { predicateType: string; bundle: ProvenanceBundle }[];
  };
  const matches = attestations.filter(
    ({ predicateType }) => predicateType === NPM_PROVENANCE_PREDICATE
  );
  if (!matches.length) return undefined;
  assert.equal(matches.length, 1, "Expected exactly one npm provenance bundle");
  const { bundle } = matches[0]!;
  const statement = checkStatement(bundle, receipt);

  // Use the verifier and trust roots bundled by the pinned publisher.
  const npmModules = (await Bun.$`npm root --global`.quiet()).text().trim();
  const npmRequire = createRequire(path.join(npmModules, "npm/package.json"));
  const { verify } = npmRequire("sigstore");
  await verify(bundle, {
    certificateIssuer: "https://token.actions.githubusercontent.com",
    certificateIdentityURI: `https://github.com/${workflowRef}`,
    tlogThreshold: 1,
    ctLogThreshold: 1,
  });
  const material = bundle.verificationMaterial;
  const cert =
    material?.certificate?.rawBytes ??
    material?.x509CertificateChain?.certificates?.[0]?.rawBytes;
  assert.ok(cert, "No Fulcio signing certificate");
  const { X509Certificate } = npmRequire("@sigstore/core");
  const leaf = X509Certificate.parse(Buffer.from(cert, "base64"));
  // Fulcio Source Repository Digest and Build Signer Digest extensions.
  for (const oid of ["1.3.6.1.4.1.57264.1.13", "1.3.6.1.4.1.57264.1.10"]) {
    const digest = leaf
      .extension(oid)
      ?.valueObj.subs[0]?.value.toString("ascii");
    assert.equal(
      digest,
      receipt.sourceSha,
      "Fulcio certificate does not bind the approved SHA"
    );
  }

  const npmArchive = await getPublic(
    tarballUrl,
    "application/octet-stream",
    true
  );
  if (!npmArchive) return undefined;
  assert.equal(
    integrity(new Uint8Array(await npmArchive.arrayBuffer())),
    receipt.integrity,
    "Public archive bytes differ from the approved archive"
  );
  return {
    bundle,
    statement,
    tarballUrl,
    tagsAfter: { ...baseline, [candidate.tag]: candidate.version },
  };
}

function assertProtectedDispatch(sourceSha: string) {
  const e = process.env;
  assert.ok(
    e.GITHUB_ACTIONS === "true" &&
      e.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      e.GITHUB_REPOSITORY === repository &&
      e.GITHUB_REF === ref &&
      e.GITHUB_REF_PROTECTED === "true" &&
      e.GITHUB_SHA === sourceSha &&
      e.GITHUB_WORKFLOW_SHA === sourceSha &&
      e.GITHUB_WORKFLOW_REF === workflowRef &&
      e.GITHUB_RUN_ATTEMPT === "1" &&
      e.ACTIONS_ID_TOKEN_REQUEST_URL &&
      e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    "Publishing requires a fresh protected main dispatch with OIDC"
  );
}

async function publish(sourceSha: string, artifacts: string) {
  assertProtectedDispatch(sourceSha);
  assert.equal(
    (await Bun.$`npm --version`.quiet()).text().trim(),
    RELEASE_NPM_VERSION
  );
  const tarball = path.join(artifacts, archive);
  const receipt = (await Bun.file(
    path.join(artifacts, "review.json")
  ).json()) as ReviewReceipt;
  const approved = process.env.REGISTRY_APPROVED_INTEGRITY ?? "";
  assertApproved(
    receipt,
    sourceSha,
    approved,
    integrity(await readFile(tarball))
  );
  await verifyTarball(
    tarball,
    sourceSha,
    await candidateManifest(),
    await publicSource(sourceSha)
  );
  const npmEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(npm_|node_auth_token$)/i.test(key)
    )
  );
  const result = await publishOnce(receipt, {
    read: readRegistry,
    publish: async () => {
      const command = Bun.spawn(
        [
          "npm",
          "publish",
          tarball,
          "--registry",
          registry,
          "--tag",
          candidate.tag,
          "--access",
          "public",
          "--provenance",
          "--ignore-scripts",
          "--fetch-retries=0",
          "--userconfig=/dev/null",
          `--globalconfig=${path.join(artifacts, "unused-global-npmrc")}`,
        ],
        {
          cwd: artifacts,
          env: npmEnv,
          stdout: "inherit",
          stderr: "inherit",
          timeout: 120_000,
        }
      );
      assert.equal(
        await command.exited,
        0,
        "npm publish did not confirm success"
      );
    },
    prove: () => provePublic(receipt),
    now: Date.now,
    sleep: Bun.sleep,
    log: console.error,
  });
  await writeReceipt(path.join(artifacts, "publication.json"), {
    ...receipt,
    ...result.evidence,
    reconciledAfterError: result.reconciledAfterError,
    run: `${githubSource}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
}

async function verifyConsumers(sourceSha: string, out: string) {
  await requireNodeFloor();
  const approved = process.env.REGISTRY_APPROVED_INTEGRITY ?? "";
  const receipt: ReviewReceipt = {
    ...candidate,
    sourceSha,
    integrity: approved,
    tagsBefore: baseline,
  };
  assertApproved(receipt, sourceSha, approved, approved);
  const source = await publicSource(sourceSha);
  const scratch = await mkdtemp(
    path.join(tmpdir(), "skillset-registry-consumers-")
  );
  try {
    for (const runtime of ["node", "bun"] as const) {
      await checkConsumer(runtime, scratch, packageSpec, {
        version: candidate.version,
        source,
      });
    }
    assert.ok(
      hasPublishedMetadata(await readRegistry(), receipt),
      "Public qualification metadata changed during consumer verification"
    );
    await writeReceipt(out, {
      ...receipt,
      node: nodeFloor,
      bun: Bun.version,
      gitBytes: Object.fromEntries(
        [...source].map(([name, bytes]) => [
          name,
          createHash("sha256").update(bytes).digest("hex"),
        ])
      ),
    });
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

async function writeReceipt(file: string, value: object) {
  const json = JSON.stringify(value, null, 2) + "\n";
  await writeFile(file, json);
  console.log(json);
}

if (import.meta.main) {
  const [command, sha, destination, ...rest] = Bun.argv.slice(2);
  assert.ok(
    sha && destination && !rest.length && shaPattern.test(sha),
    "Usage: registry-qualification.ts <prepare|publish|verify-consumers> <source-sha> <output>"
  );
  const checkedOut = (
    await Bun.$`git rev-parse HEAD`.cwd(root).env(gitSafeEnv()).quiet()
  )
    .text()
    .trim();
  assert.equal(
    checkedOut,
    sha,
    "Checked-out SHA differs from the reviewed SHA"
  );
  if (command === "prepare") await prepare(sha, path.resolve(destination));
  else if (command === "publish") await publish(sha, path.resolve(destination));
  else if (command === "verify-consumers")
    await verifyConsumers(sha, path.resolve(destination));
  else throw new Error("Unknown registry qualification command");
}
