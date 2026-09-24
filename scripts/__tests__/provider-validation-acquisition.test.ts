import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

import {
  downloadVerified,
  isTransientAcquisitionNetworkError,
} from "../provider-validation-hosted";

const payload = new TextEncoder().encode("hosted-validator\n");
const integrity = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
const acquisition = {
  integrity,
  url: "https://example.test/validator.tgz",
};

const withTemporaryDirectory = async (
  operation: (root: string) => Promise<void>
): Promise<void> => {
  const root = await createTestFixtureRoot("skillset-provider-acquisition-");
  await operation(root);
};

const okResponse = (): Response =>
  new Response(payload, {
    headers: { "content-type": "application/octet-stream" },
    status: 200,
  });

describe("hosted provider validation acquisition", () => {
  test("treats Bun's unexpected socket close as transient", () => {
    expect(
      isTransientAcquisitionNetworkError(
        new Error(
          "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
        )
      )
    ).toBe(true);
    expect(
      isTransientAcquisitionNetworkError(
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })
      )
    ).toBe(true);
    expect(isTransientAcquisitionNetworkError(new Error("acquisition hash mismatch"))).toBe(
      false
    );
  });

  test("retries a closed socket and keeps the verified payload", async () => {
    await withTemporaryDirectory(async (root) => {
      const destination = join(root, "validator.tgz");
      let calls = 0;

      await downloadVerified(acquisition, destination, {
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error(
              "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
            );
          }
          return okResponse();
        },
        sleep: async () => undefined,
      });

      expect(calls).toBe(2);
      expect(Uint8Array.from(await readFile(destination))).toEqual(payload);
    });
  });

  test("retries a 503 then succeeds", async () => {
    await withTemporaryDirectory(async (root) => {
      const destination = join(root, "validator.tgz");
      let calls = 0;

      await downloadVerified(acquisition, destination, {
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response("unavailable", { status: 503 });
          }
          return okResponse();
        },
        sleep: async () => undefined,
      });

      expect(calls).toBe(2);
      expect(Uint8Array.from(await readFile(destination))).toEqual(payload);
    });
  });

  test("does not retry a 404", async () => {
    await withTemporaryDirectory(async (root) => {
      const destination = join(root, "validator.tgz");
      let calls = 0;

      await expect(
        downloadVerified(acquisition, destination, {
          fetch: async () => {
            calls += 1;
            return new Response("missing", { status: 404 });
          },
        })
      ).rejects.toThrow("failed to acquire https://example.test/validator.tgz: 404");
      expect(calls).toBe(1);
    });
  });

  test("does not retry a 429", async () => {
    await withTemporaryDirectory(async (root) => {
      let calls = 0;
      await expect(
        downloadVerified(acquisition, join(root, "validator.tgz"), {
          fetch: async () => {
            calls += 1;
            return new Response("rate limited", { status: 429 });
          },
        })
      ).rejects.toThrow("failed to acquire https://example.test/validator.tgz: 429");
      expect(calls).toBe(1);
    });
  });

  test("fails closed after exhausted transient retries", async () => {
    await withTemporaryDirectory(async (root) => {
      const destination = join(root, "validator.tgz");
      let calls = 0;

      await expect(
        downloadVerified(acquisition, destination, {
          fetch: async () => {
            calls += 1;
            throw new Error(
              "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
            );
          },
          sleep: async () => undefined,
        })
      ).rejects.toThrow("socket connection was closed unexpectedly");
      expect(calls).toBe(3);
    });
  });

  test("does not retry a hash mismatch after a complete download", async () => {
    await withTemporaryDirectory(async (root) => {
      const destination = join(root, "validator.tgz");
      let calls = 0;

      await expect(
        downloadVerified(
          { ...acquisition, integrity: `sha256:${"ab".repeat(32)}` },
          destination,
          {
            fetch: async () => {
              calls += 1;
              return okResponse();
            },
          }
        )
      ).rejects.toThrow("acquisition hash mismatch");
      expect(calls).toBe(1);
    });
  });
});
