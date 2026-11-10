# Independent features and delivery receipts

When the project uses Suo, it remains authority for Unit identity, decisions, scope, rationale, dependencies, questions and expected assignee. Duet links those identities to implementation evidence. Record the intended assignee without asserting consent. Roles belong to tasks, not people. A single branch or PR can contain several features; select outcomes independently. “Keep replies and avatars, think more about the profile page” retains the profile page as experimental, even if the implementation shares history.

Before declaring delivery complete, inspect current Suo authority, Git/PR checks, main and integration refs, and the actual release/provider evidence for each requested environment. Check which remaining steps are authorized and perform those; a checklist is not deployment permission. Report outside repository authority a readable outcome per selected Unit for product decision, engineering checks, main merge, integration synchronization, each environment's deployed SHA, user acceptance and cleanup. Explicitly label omitted, blocked and not-authorized steps. Technical revision counters support the explanation; they are not the explanation.

`duet --project ROOT receipt FILE` makes a read-only projection from those source observations without initializing a coordinator or writing another status database. Input is version 2 with a `features` array. Each feature has stable authority `id`, readable `title`, current `definitionDigest` (use Suo schema 5 projection `coverageDigest`, a 64-character SHA-256), expected full code `sha`, optional `intendedOwner`, optional `remainingFeatures`, and observations named `product`, `checks`, `main`, `integration`, `acceptance`, `cleanup`, plus `environments` keyed by environment. Each observation has `state`, readable `summary`, `source` link/path, `observedAt` ISO time and a full `sha` for code/deployment evidence. State is one of pending, passed, failed, merged, synced, accepted, retained, completed, blocked, not-authorized, omitted, experimental or approved.

Product and acceptance observations must name the matching `featureId` and `definitionDigest`; acceptance also requires the exact code `sha`. Missing or mismatched identities make supplied success stale, even when just observed. A stable feature ID alone does not prove an unchanged definition.

This command does not query sources or authenticate assertions. The agent must fetch/inspect them and disclose query failures. Missing dimensions become omitted. Observations older than 24 hours, from the future or with another code SHA are marked stale; this freshness bound does not substitute for rechecking before acting. Source-branch and cherry-picked/main SHAs can differ: supply evidence for the target delivery SHA, preserving source references in the summary. Each feature can use its own expected SHA. Different environment SHAs remain visible and require reconciliation, never silent equivalence.

When `remainingFeatures` is nonempty the receipt reports retained branches regardless of a completed cleanup assertion. Even an empty list is not proof of disposability. Follow the existing cleanup reference's ownership, exact-tip, unpublished-history and recovery checks; merging a subset does not authorize deleting experiment branches with remaining unselected work. This receipt never deletes anything.

# Project preflight

`duet --project ROOT preflight --sha FULL_SHA --dry-run` reads `.duet/preflight.json` from that commit. Review its commands, then use `--approve-hooks` within existing authorization to execute them in a temporary detached worktree. Config: `{"version":1,"checks":[{"argv":["node","scripts/validate-release.cjs"],"timeoutMs":120000}]}`. Commands receive the existing restricted hook environment and no copied dependencies or credentials. Keep validators self-contained, or use project CI for dependency-heavy checks. Commands are reviewed code, not sandboxed by Duet.

Set optional `preflight: true` in persistent `.duet/alpha.json` to require these checks before dispatch, with both `--approve-hooks` and `--approve-deploy`. Default absent preserves existing behavior. Dry run lists the pinned validators without running them. Remote SHA and CI are checked again after validation. Missing inputs, validator failure and unapproved execution block dispatch. Project code owns manifest schemas, retained-data compatibility and migration rules; Duet does not hardcode a particular application's metadata. Passing validation neither grants deployment authority nor proves live health. The provider workflow must revalidate inputs at execution.

# Installation diagnostics

Run `duet --project ROOT doctor` through the actual selected installation. It reports the CLI package version, source installation receipt when present, checkout SHA, project instruction locations and divergent copied skills. It reports native update support separately from unknown configured settings and unverified update execution. Review instruction precedence yourself; text differences are not automatically semantic conflicts.

For Suo, compare the selected `suo --version` with its loaded skill frontmatter and installation source; mismatches block Product writes per its existing readiness rule. Verify each person's host separately. Use the native mechanisms in distribution documentation; never edit managed caches, add background updaters or claim catalog refresh proves activation. Retained Alpha data does not preclude Duet: use its persistent adapter or authorized project-native CI/CD.

# Repository completion association

An owning engineering Markdown record includes one block (details stay readable prose, not raw build logs):

````markdown
```duet-engineering
{"version":1,"units":[{"id":"unit:replies","fixes":["Reject replies to hidden conversations"],"validation":[{"criterionId":"visible-replies","path":"tests/replies.test.ts"}]}]}
```
````

The current Suo Unit's `documents` links this path and its coverage contains the mapped criteria/path. `completion --suo-cli /selected/runtime/dist/cli.js --sha FULL_SHA --ids unit:replies` reads committed Suo and Git blobs, checks exactly one owning record per selected Unit and current complete coverage, and reports gaps. Main/integration may have different prose/contracts. Validate each independently. No one-feature-one-branch rule exists. The generic `verifyCompletionAssociation` API also supports other configured task authority observations; it does not authenticate supplied observations.

This block deliberately has no self-commit SHA, CI result, PR current state, other-branch membership, acceptance result or environment status. Code/input fingerprints bind coverage without a self-reference loop. Put exact PR/CI/code and live deployment observations in the external delivery response, using the existing receipt projection; keep immutable source links in ordinary engineering prose only with their precise scope, never as current external facts.

# Build-bound runtime manifest

Project endpoints return exactly `{ "version":1, "component":"api", "revision":"FULL_SHA", "buildId":"ARTIFACT_BUILD_ID" }` with JSON content type and `Cache-Control: no-store`. Generate it with the artifact; never read revision solely from mutable runtime configuration. Use distinct endpoints/components for independently served web/API artifacts. Reuse project release identity/build mechanisms. No secrets, credentials or internal configuration belong here.

`manifest URL --component api --sha FULL_SHA` performs a fresh cache-busting request with redirects disabled and bounded response/time. Missing/malformed/failed/cache-ambiguous observations are unknown; exact component or revision differences are mismatch. This verifies one serving response, not a universal multi-instance claim. Project service workers must bypass manifest paths; deployment verification should check all independent components. No deployment, CDN purge or permission is implied.

# Issue delivery tail

A feature receipt or Unit completion association is not the whole Issue’s acceptance decision. Follow [issue closure](issue-closure.md) for the actual scope, existing authorization, idempotent closure and remote readback. Measurement completion can satisfy a measurement Issue without implementation or deployment. Report required-but-unfinished stages as blockers; mark stages outside acceptance not required rather than inventing a release gate.
