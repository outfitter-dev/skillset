import { CLI_PRESENTATION_CATALOG } from "./cli-presentation";

export const USAGE = CLI_PRESENTATION_CATALOG.flatMap((entry) => entry.synopses)
  .map(
    (synopsis, index) =>
      `${index === 0 ? "usage:" : "      "} skillset ${synopsis}`
  )
  .join("\n");
