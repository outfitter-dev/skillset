# Public Skill Ownership and Handoffs

| Request or condition | Owner | Handoff or available guidance |
| --- | --- | --- |
| Broad request, uncertain reuse/provider scope, or machine installation | `skillset` router | Establish intent; use [preflight and recovery](preflight-and-recovery.md). Do not silently install. |
| New repository workspace, or reviewed adoption/import of existing material | `skillset-init` | Review source choice, originals and collisions; after setup/import, hand to maintain with the selected root and pending first build. |
| Established workspace: build, check, drift, inspect, reconcile or repair | `skillset-maintain` | Resolve ownership and preview changes. If setup is actually absent, hand to init; a missing output baseline alone does not mean setup is absent. |
| Provider capability, native terminology, equivalence or fidelity comparison | `skillset-provider-capabilities` | Identify intent and target scope; use qualified lookup or the bundled generated snapshot, preserving ambiguity and unknown outcomes. |
| Design or source configuration | No design/config specialist yet | [Capability design](capability-design.md) and [source authoring](source-authoring.md) provide guidance. |
| Eval, review or audit | No eval/review/audit specialist yet | Clarify the evidence needed. [Commands and checks](commands-and-checks.md) covers deterministic checks, not model behavior or an independent review. |
| Publish, release or distribution | No publish specialist yet | [Commands and checks](commands-and-checks.md) maps available previews. Publication and provider activation require separate authority. |
| Help or agent settings | No help/settings specialist yet | Read command-specific help or provider guidance; no invented specialist or unqualified command. |
| Disposable provider-native artifact or generic provider settings | Provider-native workflow | No Skillset workspace is required unless reuse or distribution makes it useful. |

Every handoff carries the repository path, requested outcome, preflight observations, source ownership, relevant diagnostics, reviewed changes and existing write authority. A skill invocation does not broaden that authority. If the destination is unavailable, report that and follow the relevant bundled guidance without claiming an invocation succeeded.
