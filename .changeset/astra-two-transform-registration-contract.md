---
"@skillset/transforms": patch
---

Reject contradictory transform registrations: report-only detectors may not carry renderers, and active mappings must supply their source recognizer and every declared destination renderer. Add built-in semantic collision coverage and contributor guidance requiring exact source/destination evidence rather than relying on reversible string substitutions.
