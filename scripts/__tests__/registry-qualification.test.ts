import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  assertApproved,
  assertVacant,
  candidate,
  checkStatement,
  hasPublishedMetadata,
  publishOnce,
  type ReviewReceipt,
} from "../registry-qualification";

const sourceSha = "a".repeat(40);
const digest = createHash("sha512").update("reviewed archive").digest();
const integrity = `sha512-${digest.toString("base64")}`;
const tarball =
  "https://registry.npmjs.org/@skillset/registry/-/registry-0.0.1-qualify.0.tgz";
const predicateType = "https://slsa.dev/provenance/v1";
const tagsBefore = {
  latest: "0.0.0-bootstrap.0",
  bootstrap: "0.0.0-bootstrap.0",
};
const receipt: ReviewReceipt = {
  ...candidate,
  sourceSha,
  integrity,
  tagsBefore,
};

function vacant() {
  return {
    name: "@skillset/registry",
    "dist-tags": { ...tagsBefore },
    versions: { "0.0.0-bootstrap.0": {} },
  };
}

function published(
  overrides: {
    integrity?: string;
    tarball?: string;
    predicateType?: string;
  } = {}
) {
  return {
    ...vacant(),
    "dist-tags": { ...tagsBefore, "registry-qualification": "0.0.1-qualify.0" },
    versions: {
      ...vacant().versions,
      "0.0.1-qualify.0": {
        dist: {
          integrity: overrides.integrity ?? integrity,
          tarball: overrides.tarball ?? tarball,
          attestations: {
            provenance: {
              predicateType: overrides.predicateType ?? predicateType,
            },
          },
        },
      },
    },
  };
}

function statement() {
  return {
    _type: "https://in-toto.io/Statement/v1",
    predicateType,
    subject: [
      {
        name: "pkg:npm/%40skillset/registry@0.0.1-qualify.0",
        digest: { sha512: digest.toString("hex") },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/outfitter-dev/skillset",
            path: ".github/workflows/registry-qualification.yml",
          },
        },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/outfitter-dev/skillset@refs/heads/main",
            digest: { gitCommit: sourceSha },
          },
        ],
      },
    },
  };
}

const bundle = (value: object) => ({
  dsseEnvelope: {
    payloadType: "application/vnd.in-toto+json",
    payload: Buffer.from(JSON.stringify(value)).toString("base64"),
  },
});

describe("registry qualification boundaries", () => {
  test("requires the existing package, bootstrap and vacant candidate and tag", () => {
    expect(() => assertVacant(vacant())).not.toThrow();
    expect(() => assertVacant(null)).toThrow("package identity");
    expect(() => assertVacant({ ...vacant(), versions: {} })).toThrow(
      "bootstrap version"
    );
    expect(() => assertVacant(published())).toThrow("version is occupied");
    expect(() =>
      assertVacant({
        ...vacant(),
        "dist-tags": {
          ...tagsBefore,
          "registry-qualification": tagsBefore.bootstrap,
        },
      })
    ).toThrow("tag is occupied");
    for (const tag of ["latest", "bootstrap"]) {
      const drifted = { ...tagsBefore, [tag]: "0.0.0-stage" };
      expect(() => assertVacant({ ...vacant(), "dist-tags": drifted })).toThrow(
        "drifted"
      );
      expect(() =>
        hasPublishedMetadata({ ...published(), "dist-tags": drifted }, receipt)
      ).toThrow("drifted");
    }
  });

  test("requires the exact source, package tuple, original tags and archive SRI", () => {
    expect(() =>
      assertApproved(receipt, sourceSha, integrity, integrity)
    ).not.toThrow();
    expect(() => assertApproved(receipt, sourceSha, "", integrity)).toThrow(
      "exact approved SHA-512"
    );
    expect(() =>
      assertApproved(receipt, "b".repeat(40), integrity, integrity)
    ).toThrow("Review receipt");
    expect(() =>
      assertApproved(
        { ...receipt, tagsBefore: { ...tagsBefore, bootstrap: "0.0.0-stage" } },
        sourceSha,
        integrity,
        integrity
      )
    ).toThrow("Review receipt");
    expect(() =>
      assertApproved(receipt, sourceSha, integrity, "different")
    ).toThrow("Archive digest");
  });

  test("rejects metadata conflicts and distinguishes missing provenance from complete metadata", () => {
    expect(hasPublishedMetadata(vacant(), receipt)).toBe(false);
    expect(
      hasPublishedMetadata(published({ predicateType: "" }), receipt)
    ).toBe(false);
    expect(hasPublishedMetadata(published(), receipt)).toBe(true);
    expect(() =>
      hasPublishedMetadata(published({ integrity: "different" }), receipt)
    ).toThrow("digest differs");
    expect(() =>
      hasPublishedMetadata(
        published({ tarball: "https://elsewhere.invalid/archive" }),
        receipt
      )
    ).toThrow("tarball URL");
    expect(() =>
      hasPublishedMetadata(
        {
          ...published(),
          "dist-tags": {
            ...tagsBefore,
            "registry-qualification": tagsBefore.bootstrap,
          },
        },
        receipt
      )
    ).toThrow("tag points to another version");
  });

  test("requires the attested digest, repository, workflow and source commit", () => {
    expect(checkStatement(bundle(statement()), receipt)).toEqual(statement());
    for (const mutate of [
      (value: ReturnType<typeof statement>) => {
        value.subject[0]!.digest.sha512 = "different";
      },
      (value: ReturnType<typeof statement>) => {
        value.predicate.buildDefinition.externalParameters.workflow.repository +=
          "-fork";
      },
      (value: ReturnType<typeof statement>) => {
        value.predicate.buildDefinition.externalParameters.workflow.path =
          ".github/workflows/release.yml";
      },
      (value: ReturnType<typeof statement>) => {
        value.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit =
          "b".repeat(40);
      },
    ]) {
      const value = statement();
      mutate(value);
      expect(() => checkStatement(bundle(value), receipt)).toThrow();
    }
  });
});

function fakeIO(
  states: Array<ReturnType<typeof vacant> | ReturnType<typeof published> | null>
) {
  let elapsed = 0;
  return {
    read: mock(async () => (states.length > 1 ? states.shift()! : states[0]!)),
    publish: mock(async () => {}),
    prove: mock(async (): Promise<{ validSignature: boolean } | undefined> => ({
      validSignature: true,
    })),
    now: () => elapsed,
    sleep: async (milliseconds: number) => {
      elapsed += milliseconds;
    },
    log: mock(() => {}),
  };
}

describe("one-shot publication and reconciliation", () => {
  test("never publishes if the immediate vacancy recheck detects a race", async () => {
    const io = fakeIO([published()]);
    await expect(publishOnce(receipt, io)).rejects.toThrow(
      "version is occupied"
    );
    expect(io.publish).not.toHaveBeenCalled();
  });

  test("waits for attestation propagation after a successful publish", async () => {
    const io = fakeIO([vacant(), vacant(), published()]);
    io.prove.mockResolvedValueOnce(undefined);
    await expect(publishOnce(receipt, io)).resolves.toEqual({
      evidence: { validSignature: true },
      reconciledAfterError: false,
    });
    expect(io.publish).toHaveBeenCalledTimes(1);
    expect(io.prove).toHaveBeenCalledTimes(2);
  });

  test("reconciles ambiguous errors only when complete exact evidence is visible", async () => {
    const io = fakeIO([vacant(), published()]);
    io.publish.mockRejectedValueOnce(new Error("socket closed"));
    await expect(publishOnce(receipt, io)).resolves.toEqual({
      evidence: { validSignature: true },
      reconciledAfterError: true,
    });
    expect(io.publish).toHaveBeenCalledTimes(1);
  });

  test("stops without retry when provenance never arrives after an ambiguous error", async () => {
    const io = fakeIO([vacant(), published()]);
    io.publish.mockRejectedValueOnce(new Error("timeout"));
    io.prove.mockResolvedValue(undefined);
    await expect(publishOnce(receipt, io)).rejects.toThrow(
      "without republishing"
    );
    expect(io.publish).toHaveBeenCalledTimes(1);
  });

  test("stops on invalid signatures even if the registry advertises provenance", async () => {
    const io = fakeIO([vacant(), published()]);
    io.prove.mockRejectedValueOnce(new Error("invalid signature"));
    await expect(publishOnce(receipt, io)).rejects.toThrow("invalid signature");
    expect(io.publish).toHaveBeenCalledTimes(1);
  });

  test("stops if protected tags drift while verifying the archive", async () => {
    const io = fakeIO([
      vacant(),
      published(),
      {
        ...published(),
        "dist-tags": { ...published()["dist-tags"], latest: "0.0.0-stage" },
      },
    ]);
    await expect(publishOnce(receipt, io)).rejects.toThrow("drifted");
    expect(io.publish).toHaveBeenCalledTimes(1);
  });
});

test("workflow defaults to read-only, binds protected main and passes the same-run archive", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL(
        "../../.github/workflows/registry-qualification.yml",
        import.meta.url
      )
    ).text()
  ) as Record<string, any>;
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency.group).toBe("registry-qualification");
  const { preflight, publish, consumers } = workflow.jobs;
  expect(preflight.if).toContain(
    "github.repository == 'outfitter-dev/skillset'"
  );
  expect(preflight.if).toContain(
    "github.ref == 'refs/heads/main' && github.ref_protected"
  );
  expect(preflight.if).toContain("inputs.source_sha == github.sha");
  expect(preflight.permissions).toBeUndefined();
  expect(publish.if).toBe("inputs.publish && github.run_attempt == '1'");
  expect(publish.needs).toBe("preflight");
  expect(publish.environment).toBe("npm");
  expect(publish.permissions).toEqual({
    contents: "read",
    "id-token": "write",
  });
  expect(publish.steps).toContainEqual(
    expect.objectContaining({
      with: expect.objectContaining({
        "artifact-ids": "${{ needs.preflight.outputs.archive }}",
      }),
    })
  );
  expect(consumers.needs).toBe("publish");
  expect(consumers.permissions).toBeUndefined();
});
