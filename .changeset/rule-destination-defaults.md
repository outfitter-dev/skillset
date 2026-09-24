---
"skillset": minor
---

Rename the remaining rule output and config vocabulary (ADR-0037). Render results and generated locks report `destination: "rule"` instead of `"instruction"`, and `skillset explain` reports rule source paths with the `source-rule` role instead of `source-instruction`. Target defaults accept `<target>.defaults.rules`; the retired `<target>.defaults.instructions` fails validation with an error naming the `rules` rewrite. The `project-instructions` feature ID is unchanged until SET-658.
