# Acceptance-based issue closure

Closing completed work is a normal verified delivery step. Carry forward the user's applicable task or standing authorization and the host's actual policy; do not add another conversational approval when those already permit closure. A user opt-out (such as “leave this open”), changed scope, missing authorization or a real host/upstream approval gate still applies. A skill, CLI flag, actor label or local receipt cannot grant permission or override platform approval requirements. Listing TODOs or recording an idea alone does not authorize delivery or closure.

## Evaluate the actual acceptance boundary

Read the current Issue body, relevant discussion, linked decisions and required evidence before judging completion, and re-read before closing. Identify every original acceptance obligation; do not shrink it to the implemented subset or infer completion from a merged PR, code written, green CI, a Suo assertion or an environment manifest alone. Missing, stale or failed required evidence leaves work open. If scope is genuinely ambiguous, ask only about the unresolved acceptance decision while continuing independent work.

Distinguish measurement, definition, implementation, promotion and deployment. A measurement Issue can complete with the requested measurements, method, results and conclusions even if the result recommends future implementation. A definition-only Issue can complete without code. Implementation or promotion work requires its own stated checks and target, and deployment is required only when included in acceptance. Required product acceptance is evidence to obtain, not something a merge or closure can fabricate. Do not add a deployment or user-signoff gate absent from the actual contract.

Separately scoped follow-up work may remain open after the original scope is satisfied: link it explicitly and explain the boundary. If an original criterion remains unmet, leave the original Issue open, even if a child/follow-up tracks the remainder. Only an independently authorized, explicit scope decision may change that contract; record it transparently, never use follow-ups to hide unmet acceptance. Cancellation/duplicate resolution is a different authorized outcome, not completion.

## Execute and verify

1. Read fresh remote state for the exact owning repository and Issue number. Inspect existing closure reason/evidence. If already closed, do not reopen, re-close or post a duplicate completion comment; report its actual reason, without asserting newly completed acceptance. Flag contradictions without silently changing state.
2. For open work, reconcile all acceptance obligations with concrete evidence. Record a concise completion summary linking results, exact commits/PRs and checks as applicable, and separately scoped follow-ups. Use the existing completion comment if already present; do not repeatedly post it on retries. Do not introduce PR auto-close keywords until the full Issue scope is satisfied and closure is authorized, since merge could otherwise bypass this assessment.
3. When complete and authorized, close as completed through the available GitHub connector or CLI. Do not ask again merely because closure is a remote write. If a real gate blocks it, report the exact action, target and reason and follow host policy; continue independent work.
4. Read back the remote Issue after the write. Only confirmed closed state with the intended completion reason supports a completion-closure claim; report the Issue link and evidence. A successful request/local receipt without readback is unverified. If readback still shows open or a different reason, report the discrepancy rather than success.
5. After a timeout, pending request or uncertain result, query remote state and relevant existing comments before any retry. Preserve uncertainty. If still pending/unknown, stop the dependent write. A confirmed failed attempt requires inspecting effects and current authorization before a deliberate retry. Already-closed state is idempotent success for state reconciliation, not proof that the Issue met acceptance.

Issue closure is distinct from branch cleanup, installation updates, release publication and deployment. Follow their own scope and gates; report omitted/not-required, blocked and pending stages honestly.

## Optional deterministic assessment

`duet issue-completion FILE` is read-only and needs no coordinator. It validates supplied observations; it neither queries GitHub, executes closure, authenticates permissions nor judges natural-language scope/evidence. The agent must collect and semantically review authoritative sources. Do not commit these observations as a live ledger. Existing `work-index` and `receipt` schemas are unchanged.

Version 1 input has exactly:

```json
{
  "version": 1,
  "issue": {"url":"https://github.com/acme/project/issues/1","state":"open","reason":"unknown","observedAt":"2026-10-22T12:00:00Z"},
  "scopeReviewed": true,
  "requirements": [{"id":"measurement-report","scope":"measurement","criterion":"Report the agreed measurements and conclusions","state":"met","evidence":["https://github.com/acme/project/issues/1#issuecomment-123"]}],
  "authorization": "allowed",
  "optOut": false,
  "attempt": "none"
}
```

Issue state: open/closed/unknown; reason: completed/not_planned/unknown. Requirements must be nonempty with unique IDs, a nonempty criterion and evidence array; scope: measurement/definition/implementation/promotion/deployment/acceptance; state: met/unmet/unknown. Include every actual obligation, no invented deployment requirement. Empty evidence prevents completion. Authorization: allowed/required/denied/unknown; attempt: none/pending/uncertain/failed/succeeded. These are supplied assertions, never permission tokens.

The output separates acceptance `complete`/`gaps` from `closure` and `nextAction`. Future or over-24-hour Issue observations, unknown state and pending/uncertain attempts request `read-remote`; this time bound never replaces a fresh pre-write or post-write read. Already-closed records request no write regardless of acceptance/authorization, preserving actual reason. Incomplete/opted-out open work stays open; missing authorization blocks. Other prior attempts require reconciliation, not automatic retry. After a new provider read, supply the reconciled attempt state; never recycle a pre-write snapshot as readback. Only an open, complete, authorized, opted-in record with no outstanding attempt yields `close-with-existing-authorization`. That is guidance, not execution or a grant.
