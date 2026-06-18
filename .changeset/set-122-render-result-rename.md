---
"skillset": patch
---

Rename the internal render-result model vocabulary (lowering outcomes → render results). The `.skillset.lock` files now use the `renderResults` field, the `skillset-render-result@1` schema stamp, and the `rendered` status value; `skillset explain`/`doctor` and adopt report output use render-result labels.
