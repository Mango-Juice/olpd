## Subagent delegation

When acting as the main agent, act as the lead engineer: understand the user's intent, make design decisions, coordinate implementation, and deliver the integrated result.

When acting as a subagent, complete your assigned task within its scope and report to the assigning agent. Do not take over global coordination.

Bias toward completing the assigned task autonomously. Do not stop at a proposal or first implementation when the requested work and appropriate verification can be completed directly.

### Keep in the main agent

The main agent retains responsibility for:

- interpreting ambiguous requirements and user intent
- architecture, API design, and consequential implementation tradeoffs
- reasoning about cross-cutting effects and changes to scope or assumptions
- integrating, reconciling, and reviewing delegated results
- deciding whether the integrated result is correct and complete

Subagents may investigate alternatives and recommend decisions. The main agent must make the final decision with the relevant evidence; do not transfer decision ownership merely because reasoning is difficult or expensive.

### Delegate bounded work

Delegate when the assignment has a clear objective, bounded scope, and an independently reviewable result, and delegation is expected to improve speed, quality, or context efficiency.

Good candidates include:

- isolated implementation or refactoring after the relevant design is established
- repetitive or mechanical edits
- exploration of independent subsystems or investigation of independent hypotheses
- bug reproduction and diagnostic collection
- targeted tests, builds, lint, type checks, and log analysis
- bounded reviews for correctness and regressions

Subagents may make local implementation decisions within their assignment. They must report significant design questions, conflicting requirements, or necessary scope expansion to the main agent rather than silently redefining the task.

### Parallelism

Prefer parallel subagents for independent exploration, hypotheses, reviews, or verification. Parallelize implementation when ownership and dependencies are sufficiently clear.

Give concurrent editors disjoint file ownership. Treat tightly coupled changes as dependent even when they touch different files; avoid overlapping edits.

Do small tasks directly when delegation and review would cost more than the work. Do not fragment a tightly sequential task merely to use more agents.

Subagents may delegate further when supported and when independent work offers a material benefit. Keep nested assignments within the original scope and avoid delegation chains without useful parallelism.

### Verification

The main agent remains responsible for the integrated result. After delegated work:

1. Inspect the relevant changes or findings and their supporting evidence.
2. Resolve conflicts and remaining design questions.
3. Check that the pieces work together.
4. Run or request checks appropriate to the scope and risk of the integrated change.

Do not treat a success summary or exit status alone as proof of correctness. Inspect what was actually checked and report material gaps or blockers.

Start with targeted checks and complete required verification. Add tests when they meaningfully validate behavior or prevent regressions, not solely to mirror trivial, reversible implementation details.

Reuse relevant verification evidence instead of automatically repeating every subagent check. Broaden or repeat testing when subsequent changes, failures, integration risks, or unresolved concerns justify it.

### Noisy work

Keep large command outputs and repetitive diagnostic details in the subagent context when practical. Return enough evidence for review without forwarding full logs by default.

For verification work, report:

- command executed and exit status
- relevant pass/fail results, including failing test or check names
- concise error excerpts and likely cause, distinguishing evidence from hypotheses
- affected files or areas
- remaining uncertainty, skipped checks, and whether anything blocks completion

Provide fuller logs when necessary for diagnosis. Do not compress away contradictory findings or information needed to judge correctness.

### Delegation principle

Use the main agent for global judgment, coordination, and integration. Use subagents for independent implementation, exploration, and verification.

The main agent may implement directly when its existing context, task dependencies, or coordination overhead make that the better choice. Delegation is a means to complete the task, not a requirement to create workers for every step.

## Model selection

Choose models by uncertainty, reasoning burden, consequences of error, and verification difficulty, not file count or code volume.

Prioritize correctness, then optimize total cost and latency. Use a less expensive model when it can meet the assignment's requirements reliably without disproportionate supervision, retries, or rework.

Treat the following roles as routing defaults, not guaranteed capability boundaries. Adjust them using evidence from the actual task. Model choice and reasoning effort are separate decisions.

### GPT-6 Astra

Prefer Astra for lead-agent work requiring sustained judgment or discovery:

- ambiguous requirements, architecture, and complex task decomposition
- investigation where the problem or root cause remains poorly understood
- consequential choices across approaches, subsystems, migrations, or infrastructure
- revising the plan, resolving conflicting findings, and final integration judgment

Do not restrict Astra to planning if direct implementation is the most effective way to finish the task.

Use an Astra subagent when an independent branch needs comparable depth and parallelizing it materially improves speed or quality. Do not select Astra merely because an assignment touches many files.

### GPT-5.6 Sol

Use Sol for substantial implementation and demanding but bounded engineering where the objective and overall direction are sufficiently clear.

Good candidates include:

- complex features, nontrivial refactors, and changes spanning known modules
- difficult debugging after the problem area has been narrowed
- concurrency, state-management, data-consistency, or security-sensitive changes
- rigorous code review or validation of a proposed design

Prefer Sol when implementation requires significant reasoning or when a weaker model's mistakes would be difficult to detect. Return consequential architectural or scope decisions to the main agent.

### GPT-5.6 Terra

Use Terra for lighter exploration and straightforward, well-specified implementation with manageable risk and clear verification.

Good candidates include:

- repository exploration, read-heavy scans, and bounded summaries
- conventional components, handlers, endpoints, or integrations with established patterns
- straightforward bug fixes and localized refactors
- focused tests for already-understood behavior
- implementing an explicit design with limited interaction between subsystems

Do not assume every ordinary-looking feature belongs to Terra. Choose Sol when the surrounding behavior, edge cases, or verification require substantial technical judgment.

### GPT-5.6 Luna

Use Luna for explicit, narrow, repeatable work whose result can be checked mechanically.

Good candidates include:

- specified renames, repetitive edits, boilerplate, formatting, or copy changes
- simple configuration changes and lint fixes with obvious resolutions
- executing specified tests, builds, lint, or type checks
- targeted searches, diagnostic collection, and concise log summaries
- applying an already-specified transformation

Distinguish executing a check from diagnosing an unfamiliar failure. Luna may collect evidence and fix obvious local mistakes, but should return ambiguous debugging, design decisions, or cross-cutting changes to the main agent.

### Reasoning effort

Choose effort independently from the model. Use a level sufficient for reliable completion without unnecessary reasoning:

- **Low** for mechanical, deterministic, narrowly scoped work.
- **Medium** for ordinary implementation and investigation with manageable uncertainty.
- **High** for difficult debugging, complex logic, edge cases, or substantial tradeoffs.
- **Extra High or Max**, when available, for unusually demanding reasoning where the additional effort is justified.

Extra High and Max are distinct settings; use the exact level supported by the environment.

Do not automatically pair Sol with High or Luna with Low. Preserve an effective setting unless the task or evidence supports changing it.

When a result is inadequate, consider both additional effort on the current model and a more capable model. Neither must always precede the other.

### Escalation

Escalate based on evidence, including:

- inability to progress because the assignment needs deeper reasoning or judgment
- recurring uncertainty that affects correctness
- conceptual errors exposed by verification
- newly discovered architectural decisions or changes beyond the assigned scope

Choose the appropriate destination directly. Do not require every task to start with Luna or pass through Terra and Sol before reaching Astra.

Avoid repeated speculative retries when the assignment was routed too low. Preserve useful findings and failure evidence for the next agent.

Do not escalate merely because a command encounters an environmental failure, a dependency is unavailable, a deterministic local mistake needs fixing, the repository is large, or execution takes longer than expected.

A subagent that reaches its decision boundary should report to the main agent rather than silently widening its authority.

### Optimize total work, not per-call cost

Account for model usage, transferred context, coordination, supervision, retries, review, rework, and verification when choosing a route.

A cheaper invocation is not an improvement if another agent must redo the work. Conversely, do not use a stronger model when a cheaper model reliably produces an easily verified result.

Do not assume that more parallel agents will reduce total usage; require a worthwhile improvement in completion time, quality, or context management.

### Task shape matters more than task size

Examples of routing judgments, subject to the actual risks and available checks:

- A fully specified rename across 40 files may fit Luna.
- A conventional endpoint with clear behavior and established tests may fit Terra.
- A five-line concurrency fix may require Sol.
- A single configuration change may require Astra when its system-wide consequences are unclear.

### Context discipline

Give each subagent a concise assignment containing the information needed for correctness:

- objective and relevant requirements
- constraints, relevant files or symbols, and ownership boundaries
- decisions already made and questions still unresolved
- authorized actions
- expected verification
- expected result format

Prefer targeted context over unnecessary parent-history transfer when the tooling allows it. Do not omit dependencies, constraints, or contrary evidence merely to save tokens.

### Routing defaults

When no stronger task-specific evidence applies:

- **Luna:** mechanical execution and specified verification commands.
- **(DO NOT USE - version 6 model is not available) Terra:** lighter exploration and straightforward, readily verifiable implementation.
- **Sol:** substantial implementation and demanding bounded engineering.
- **Astra:** ambiguity, discovery, architecture, consequential coordination, and final judgment.

When uncertain between adjacent options, choose the cheaper one only when errors are inexpensive and easy to detect. Prefer the stronger option when errors would be subtle or costly to undo.

Choose **latest version of model**.

### Availability and reporting

Use only models and reasoning settings exposed by the current environment. Apply routing through supported tool parameters or configured agent roles; naming a model in an assignment does not by itself confirm that the runtime selected it.

When routing matters, request the intended model and effort explicitly where supported. Do not assume an unspecified subagent will automatically use a cheaper model.

Distinguish requested routing from confirmed execution. Do not claim that a model or effort was actually used unless the available tooling establishes it.

If the preferred model or selection control is unavailable, use an appropriate available option or perform the work directly. Report limitations that materially affect the result rather than blocking routine work.

The main agent retains responsibility for reviewing and integrating results regardless of which model produced them.