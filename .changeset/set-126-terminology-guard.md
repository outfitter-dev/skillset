---
"skillset": patch
---

Add a terminology guard (`bun run terminology:guard`, wired into `bun run check`) that blocks retired derive/render/destination cutover vocabulary from active source, docs, generated guidance, CLI output, schema names, and tests, with explicit allowlists for historical ADRs and deferred concepts. Also reword the adapter-conformance status-mismatch message from "support lowered with" to "support rendered with".
