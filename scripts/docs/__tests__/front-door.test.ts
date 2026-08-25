import { expect, test } from "bun:test";

import {
  authoredCommandDiagnostics,
  distributionFrontDoorDiagnostics,
  invariantLinkDiagnostics,
  readmeCommandDiagnostics,
} from "../front-door";

test("README package examples use canonical public commands", () => {
  expect(
    readmeCommandDiagnostics(
      [
        "bunx @skillset/cli init",
        "bunx @skillset/cli build --yes",
        "npx skillset@beta check",
        "skillset --version",
        "skillset --help",
        'skillset new skill "Review Notes" --yes',
        'skillset change reason @abcdef --reason "Clarify the reader-visible change."',
      ].join("\n")
    )
  ).toEqual([]);
  expect(readmeCommandDiagnostics("bunx @skillset/cli build --watch")[0]).toContain(
    "README.md documents an invalid command (build --watch)"
  );
  expect(
    readmeCommandDiagnostics("bunx @skillset/cli change nonsense")[0]
  ).toContain("README.md documents an invalid command (change nonsense)");
  expect(readmeCommandDiagnostics("skillset build --watch")[0]).toContain(
    "README.md documents an invalid command (build --watch)"
  );
});

test("authored docs validate direct and package-runner commands", () => {
  expect(
    authoredCommandDiagnostics(
      "docs/start/quickstart.md",
      [
        "skillset init",
        "skillset build --yes",
        "bunx @skillset/cli check --ci",
      ].join("\n")
    )
  ).toEqual([]);
  expect(
    authoredCommandDiagnostics(
      "docs/start/quickstart.md",
      "skillset build --watch"
    )[0]
  ).toContain(
    "docs/start/quickstart.md documents an invalid command (build --watch)"
  );
});

test("distribution docs keep the global-first route and exact alternatives", () => {
  const readme = [
    "# Skillset",
    "",
    "```bash",
    "npm install --global skillset",
    "skillset init",
    "```",
    "",
    "See [installation](docs/start/installation.md).",
  ].join("\n");
  const installation = [
    "# Install Skillset",
    "",
    "| Route | Install requirement | Command runtime |",
    "| --- | --- | --- |",
    "| npm global native | Node 18 and npm | Node 18 launcher; no Bun |",
    "| Homebrew native | Homebrew | Neither Bun nor Node |",
    "| GitHub native asset | archive tools | Neither Bun nor Node |",
    "| Bun global | Bun 1.4.0 | Bun 1.4.0 |",
    "",
    "npm install --global skillset",
    "brew install outfitter-dev/tap/skillset",
    "https://github.com/outfitter-dev/skillset/releases",
    "skillset-v<version>-darwin-arm64.tar.gz",
    "skillset-v<version>-darwin-x64.tar.gz",
    "skillset-v<version>-linux-arm64-glibc.tar.gz",
    "skillset-v<version>-linux-x64-glibc.tar.gz",
    "skillset-v<version>-windows-x64.zip",
    "skillset-v<version>-manifest.json",
    "skillset-v<version>-SHA256SUMS",
    "gh attestation verify <archive> --repo outfitter-dev/skillset",
    "bun add --global @skillset/cli",
    "bunx @skillset/cli --version",
    "bun add --dev @skillset/cli",
    "./scripts/bootstrap.sh repo",
    "",
    "`@skillset/cli` is the complete Skillset command surface in the slimmer Bun distribution.",
  ].join("\n");

  expect(
    distributionFrontDoorDiagnostics([
      { path: "README.md", source: readme },
      { path: "docs/start/installation.md", source: installation },
    ])
  ).toEqual([]);

  expect(
    distributionFrontDoorDiagnostics([
      {
        path: "README.md",
        source: readme.replace(
          "npm install --global skillset\nskillset init",
          "bunx @skillset/cli init"
        ),
      },
      {
        path: "docs/start/installation.md",
        source: `${installation}\nUse skillset-ci in CI.`,
      },
    ])
  ).toEqual([
    "README.md must lead with npm install --global skillset",
    "README.md must run skillset init after the global install",
    "docs/start/installation.md: retired public distribution name skillset-ci",
  ]);

  expect(
    distributionFrontDoorDiagnostics([
      {
        path: "README.md",
        source: readme.replace(
          "```bash\nnpm install --global skillset",
          "```bash\nbunx @skillset/cli init\nnpm install --global skillset"
        ),
      },
      { path: "docs/start/installation.md", source: installation },
    ])[0]
  ).toBe("README.md must lead with npm install --global skillset");
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
