# References

## Authority and repository guidance

- Matt's October 29, 2026 conversation: one Astra owner; continuous high-quality backlog work; subagents/review worktrees; focused repairs integrated and restacked; disjoint separate stacks; draft PRs with external review settlement deferred; at most two routine local review rounds using GPT-6.1 Terra high/fast threads where available; proactive Linear management, issue comments only when needed for future reference, and simple project updates at milestone completion; committed local packet requested.
- [Repository instructions](../../../AGENTS.md), [contribution guidance](../../../CONTRIBUTING.md), [planning preferences](../PLANNING.md), and [documentation system](../../../docs/development/documentation-system.md).
- [Tenets](../../../docs/project/tenets.md), [ADR index](../../../docs/adrs/README.md), and [beta decision record](../../../docs/project/plans/beta-release.md). Read governing decisions before changing their contracts.
- Preparation checkout: main at 24800e02ed4e7150ea1bc7130c35603c98ea9da2, clean before this packet. This is provenance, not the executing thread's assumed base.

## Live work queue

- [Correctness and invariants](https://linear.app/outfitter/project/correctness-and-invariants-7aa91a8a02e1): SET-748 first fresh coding pickup; SET-686 and SET-726/689 unlock downstream work.
- [Authoring model](https://linear.app/outfitter/project/authoring-model-ffc62e95c9d4): finish/reconcile SET-554; independent subtracks use concrete prerequisites; SET-569 closes integration.
- [Release: beta to launch](https://linear.app/outfitter/project/release-beta-to-launch-ce62b966b1c0): SET-457/466 public surface; SET-478 finished-path gate.
- [Adoption and migration](https://linear.app/outfitter/project/adoption-and-migration-30bf72dfcb8a): SET-437 accepted architecture; SET-444 semantic fixture gate.
- [Guidance and docs](https://linear.app/outfitter/project/guidance-and-docs-da2ff75f4932): SET-708 already In Progress at catch-up.
- [Developer workflow and verification](https://linear.app/outfitter/project/developer-workflow-and-verification-93699cfa0caf): SET-770 first pull, then SET-603/771/772 (Bun 1.4.4 foundation); SET-760 remains separate research-only; release mechanics have separate owner gates.
- [Migration contract and execution plan](https://linear.app/outfitter/document/guided-adoption-migration-contract-and-execution-plan-cad53f1e2170), amended October 28.

## Supporting context

### Bun 1.4.4 foundation

- Matt's October 27 **Skillset: Bun 1.4.4 Upgrade Plan**, supplied in the October 29 conversation, authorizes the planning amendment. Its uninspected-repo assumptions are corrected in PLAN.md and the live issue briefs.
- [SET-770: baseline and applicability](https://linear.app/outfitter/issue/SET-770), [SET-603: toolchain upgrade](https://linear.app/outfitter/issue/SET-603), [SET-771: semantic compatibility](https://linear.app/outfitter/issue/SET-771), [SET-772: qualification](https://linear.app/outfitter/issue/SET-772), and [SET-773: optional built-ins assessment](https://linear.app/outfitter/issue/SET-773).
- Official release evidence: [Bun 1.4](https://bun.sh/blog/bun-v1.4), [1.4.1](https://bun.sh/blog/bun-v1.4.1), [1.4.2](https://bun.sh/blog/bun-v1.4.2), [1.4.3](https://bun.sh/blog/bun-v1.4.3), [1.4.4](https://bun.sh/blog/bun-v1.4.4). SET-770 owns the complete release-to-call-site applicability review.
- Local owners: [compiler YAML](../../../packages/core/src/yaml.ts), [authored YAML preservation](../../../packages/core/src/source-document.ts), [Workbench parsers](../../../packages/workbench/src/parser.ts), [structured output](../../../packages/core/src/structured-output.ts), [Bun policy tests](../../../scripts/__tests__/bootstrap.test.ts), and [release policy](../../../docs/development/package-releases.md).

### Earlier campaign context

- [Skillset lanes](https://app.notion.com/p/4071b36f46cb810ca322c1f2da414fc5): six-project overview, milestones, convergence points, settled October 28 decisions, filing rules. Its execution-lane interpretation is replaced by this packet; its work organization remains useful.
- [Earlier autonomous campaign playbook](https://app.notion.com/p/4071b36f46cb81ac90eded338e80765a): historical multi-role/multi-lane setup. This packet supersedes that execution topology. Do not recreate its coordinator/architect/recon fleet, schedules, or permissions from its templates.

Current Linear issue bodies, explicit decision comments, and delivery evidence must be refreshed at pickup. Supporting Notion pages are optional context; the local operating instructions are self-contained. Do not infer current GitHub/release state from these dated references.
