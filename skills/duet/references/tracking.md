# Project tracking conventions

Declare the owning repository's GitHub Issues as the global work index. Suo is the current selected snapshot's product authority, including adopted but unimplemented definitions. Product design documents stay in Git; task state is maintained in Issues. No bidirectional synchronization, new service or independent ledger is required.

## Collection and capture

For global TODO/ongoing/unscoped next, query all relevant Issues and active PRs, paginate, inspect bodies and relevant discussion and closed outcomes. Resolve exact fetched main and linked candidate SHAs; use installed Suo inspect/export per snapshot with explicit root and ref. Keep each snapshot distinct. Compare Unit identity/definition/implementation applicability, not branch names or revision counters. Report gaps for missing work links, unknown/stale inputs and failed sources. No empty-backlog claim without complete reads.

For current-task next, use the active Issue's completion scope and unresolved prerequisites first. Use global discovery only when asked or when the task context is absent. Current Suo next is snapshot guidance, not the global backlog.

Before capture search open/closed Issues and PRs by behavior/context, then read likely matches. Same Unit does not imply same work; same idea in another branch may already be indexed. Reuse matching open work; inspect why closed before proposing genuinely distinct remaining work. No automatic reopening. If search is unavailable, report that prerequisite instead of filing blindly. A local temporary draft is unfiled, not shared success.

Write an objective and completion condition, with Unit IDs, exact-source links, PRs and branch links when available. Labels are lightweight. Read back the complete Issue body after a successful write. Only then replace the old live TODO authority with its pointer; retain design context without maintaining a second task state.

## Handoff intent and ownership

Interpret context, not a name parser or keyword engine. “hand this to the named engineer to implement” records intended owner, not uptake, work started, product acceptance or release permission. Resolve a verified GitHub identity only if actual assignment is requested; do not contact people or expand permissions. An authorized “I'll implement this” can establish a claim, not completed work. Roles belong to tasks: the same person can prototype one change and engineer another. Praise, quoted speech, negation and tentative ideas are not approval.

Record the requested action explicitly as decision, implementation, review, or unknown, with intended owner, uptake evidence and blocking conditions. A pending product decision belongs in “awaiting my decision” for its verified owner, not an implied implementation approval. Assignment is not acceptance; absence of acceptance evidence is unknown, not necessarily unclaimed. Keep a claim attributed to its actor so reassignment cannot transfer it. Preserve unresolved names without guessing identities.

Collect globally before projecting for a verified viewer: do not restrict discovery to the current branch or silently drop work lacking metadata. Show blockers and unknowns alongside every personal classification. Keep GitHub handoff observations separate from commit-local Suo definitions. No keyword classifier or extra state machine is required.

## Conversational product changes

Compare a requested behavior against current product definitions. Preserve an authorized bounded decision through the installed product tool's current update protocol; do not ask again for that same decision. Missing genuine choices stay unresolved. A bug restoring the existing contract needs no new product decision. Definition and code may promote independently. A definition-only PR never closes a broader implementation Issue. Product acceptance, implementation and delivery are separate.

A clean Git merge cannot establish semantic compatibility of two definitions for the same Unit. Review both pinned candidates and reconcile only within authorization. Abandoning an implementation approach closes that work as cancelled/not planned when authorized, not fixed, and does not revoke adopted product scope. A failed attempt with no reproducible defect must not be described as a delivered fix.

## Scope and cleanup

Partial promotion updates only the selected outcome. Keep inherited experiments and their Issues/design context. An agreed scope is not arbitrarily split. Stale coverage requests revalidation, not automatic reimplementation. Closed work on a stale branch first requires synchronization assessment. Direct main fixes sync back while preserving integration-specific definitions. Query actual environment manifests separately; merge is not deployment and no index grants Alpha/Production permission.

Before branch cleanup ensure no remaining active PR/work, unpromoted experiment, unique design context or unshared idea would be lost. Use the exact-tip lifecycle checks. Tracking work grants neither implementation nor acceptance authority.

## Delivery closure

Follow [acceptance-based issue closure](issue-closure.md) after completing authorized work. Existing applicable authorization avoids a redundant conversational question; host policy remains authoritative. Listing or capture alone never authorizes closure.
