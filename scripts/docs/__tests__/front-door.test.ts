import { expect, test } from "bun:test";

import {
  invariantLinkDiagnostics,
  readmeCommandDiagnostics,
} from "../front-door";

test("README package examples use canonical public commands", () => {
  expect(
    readmeCommandDiagnostics(
      [
        "bunx skillset init",
        "bunx skillset build --yes",
        "npx skillset@beta check",
      ].join("\n")
    )
  ).toEqual([]);
  expect(readmeCommandDiagnostics("bunx skillset build --watch")[0]).toContain(
    "README.md documents an invalid command (build --watch)"
  );
  expect(
    readmeCommandDiagnostics("bunx skillset change nonsense")[0]
  ).toContain("README.md documents an invalid command (change nonsense)");
});

test("the activation invariant links to its canonical concept page", () => {
  const invariant =
    "Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration.";
  const requiredPages = [
    "README.md",
    "docs/README.md",
    "docs/start/build-versus-activation.md",
    "docs/why-skillset.md",
    "examples/first-author/README.md",
  ].map((path) => ({
    path,
    source:
      path === "docs/start/build-versus-activation.md"
        ? invariant
        : `${invariant} [Learn why](${path === "README.md" ? "docs/start/build-versus-activation.md" : path.startsWith("examples/") ? "../../docs/start/build-versus-activation.md" : "start/build-versus-activation.md"}).`,
  }));
  expect(invariantLinkDiagnostics([...requiredPages])).toEqual([]);
  expect(
    invariantLinkDiagnostics(
      requiredPages
        .filter(({ path }) => path !== "docs/why-skillset.md")
        .concat({ path: "docs/guide.md", source: invariant })
    )
  ).toContain(
    "docs/why-skillset.md: missing the canonical activation invariant"
  );
});
